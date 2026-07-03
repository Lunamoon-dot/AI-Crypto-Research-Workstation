import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { WorkspacesService } from '../workspaces/workspaces.service';

export type ScenarioFeedbackLessonScope =
  | 'scenario'
  | 'signal'
  | 'playbook'
  | 'data_quality';

export type ScenarioFeedbackMarketType = 'spot' | 'perp' | 'unknown';

export type ScenarioFeedbackConfidence = 'low' | 'medium' | 'high';

export interface ScenarioFeedbackLesson {
  id: string;
  scope: ScenarioFeedbackLessonScope;
  horizon: string;
  market_type: ScenarioFeedbackMarketType;
  statement: string;
  confidence: ScenarioFeedbackConfidence;
  evidence_count: number;
}

export interface ScenarioFeedbackGate {
  id: string;
  reason: string;
  applies_to: 'entry' | 'confirmation' | 'invalidation' | 'playbook_compile';
}

export interface ScenarioFeedbackPlaybookResponse {
  version: 'scenario_feedback_playbook.v1';
  workspace_id: string;
  symbol: string;
  generated_at: string;
  source_evaluation_ids: string[];
  source_signal_report_ids: string[];
  lessons: ScenarioFeedbackLesson[];
  gates: ScenarioFeedbackGate[];
  exclusions: string[];
}

type BuildFeedbackInput = {
  workspaceId: string;
  symbol: string;
};

@Injectable()
export class ScenarioFeedbackPlaybookService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async latest(
    symbol: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioFeedbackPlaybookResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const latest = await this.journal.getLatestScenarioFeedbackPlaybook(
      normalizeSymbol(symbol),
      workspaceId,
    );
    if (!latest) {
      throw new NotFoundException(`Scenario feedback playbook for ${symbol} not found`);
    }
    return toScenarioFeedbackPlaybook(latest);
  }

  async rebuild(
    symbol: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioFeedbackPlaybookResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    return this.buildForSymbol({ workspaceId, symbol });
  }

  async buildForSymbol(input: BuildFeedbackInput): Promise<ScenarioFeedbackPlaybookResponse> {
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol) {
      throw new BadRequestException('symbol is required.');
    }
    const evaluations = await optionalScenarioLifecycleRows(() =>
      this.journal.listScenarioEvaluationsForReliability(
        { symbol, limit: 100 },
        input.workspaceId,
      ),
    );
    const reports = await this.listSignalReports(symbol, input.workspaceId);
    const generatedAt = new Date().toISOString();
    const feedback: ScenarioFeedbackPlaybookResponse = {
      version: 'scenario_feedback_playbook.v1',
      workspace_id: input.workspaceId,
      symbol,
      generated_at: generatedAt,
      source_evaluation_ids: stringList(evaluations.map((item) => item.id)),
      source_signal_report_ids: stringList(reports.map((item) => item.id)),
      lessons: lessonsFromArtifacts(evaluations, reports),
      gates: gatesFromArtifacts(evaluations, reports),
      exclusions: ['raw_continuity_context', 'raw_scenario_prose', 'raw_signal_rows'],
    };
    const id = scenarioFeedbackPlaybookId(feedback);
    const saved = await this.journal.saveScenarioFeedbackPlaybook(
      { ...feedback, id },
      input.workspaceId,
    );
    return toScenarioFeedbackPlaybook(saved);
  }

  private async listSignalReports(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    if (!this.journal.listSignalEvaluationReports) {
      return [];
    }
    try {
      return await this.journal.listSignalEvaluationReports(
        { symbol, limit: 50 },
        workspaceId,
      );
    } catch (error) {
      if (isMissingSignalEvaluationTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return workspaceId;
  }
}

function lessonsFromArtifacts(
  evaluations: JsonRecord[],
  reports: JsonRecord[],
): ScenarioFeedbackLesson[] {
  const lessons = new Map<string, { lesson: ScenarioFeedbackLesson; count: number }>();
  for (const evaluation of evaluations) {
    const result = stringValue(evaluation.result, 'inconclusive');
    const horizon = stringValue(evaluation.horizon, 'unknown');
    const marketType = marketTypeValue(evaluation.market_type);
    if (result === 'invalidated') {
      addLesson(lessons, {
        scope: 'scenario',
        horizon,
        market_type: marketType,
        statement: 'Require trigger confirmation and invalidation review before acting on similar scenarios.',
      });
    } else if (result === 'hit') {
      addLesson(lessons, {
        scope: 'scenario',
        horizon,
        market_type: marketType,
        statement: 'Preserve trigger confirmation discipline for similar successful scenarios.',
      });
    } else if (result === 'mixed') {
      addLesson(lessons, {
        scope: 'playbook',
        horizon,
        market_type: marketType,
        statement: 'Treat mixed outcomes as review-only until entry, confirmation, and invalidation are explicit.',
      });
    } else {
      addLesson(lessons, {
        scope: 'data_quality',
        horizon,
        market_type: marketType,
        statement: 'Avoid strong scenario conclusions when the evaluation window is inconclusive.',
      });
    }
    if (evaluation.data_quality !== 'complete') {
      addLesson(lessons, {
        scope: 'data_quality',
        horizon,
        market_type: marketType,
        statement: 'Do not score scenario branches without complete evaluation evidence.',
      });
    }
  }
  for (const report of reports) {
    const warnings = stringList(report.quality_warnings ?? report.warnings);
    if (warnings.length > 0) {
      addLesson(lessons, {
        scope: 'signal',
        horizon: signalHorizon(report),
        market_type: 'unknown',
        statement: 'Treat signal feedback as incomplete while quality warnings remain.',
      });
    }
  }
  return [...lessons.values()].map(({ lesson, count }) => ({
    ...lesson,
    evidence_count: count,
    confidence: confidenceForCount(count),
  }));
}

function gatesFromArtifacts(
  evaluations: JsonRecord[],
  reports: JsonRecord[],
): ScenarioFeedbackGate[] {
  const gates = new Map<string, ScenarioFeedbackGate>();
  if (evaluations.some((item) => item.result === 'invalidated')) {
    addGate(gates, {
      applies_to: 'invalidation',
      reason: 'Review invalidation evidence before considering entries on similar scenarios.',
    });
  }
  if (evaluations.some((item) => item.data_quality !== 'complete')) {
    addGate(gates, {
      applies_to: 'playbook_compile',
      reason: 'Block playbook compilation when scenario evaluation evidence is incomplete.',
    });
  }
  if (reports.some((item) => stringList(item.quality_warnings ?? item.warnings).length > 0)) {
    addGate(gates, {
      applies_to: 'confirmation',
      reason: 'Require signal-quality warning review before treating confirmation as passed.',
    });
  }
  return [...gates.values()];
}

function addLesson(
  lessons: Map<string, { lesson: ScenarioFeedbackLesson; count: number }>,
  input: Omit<ScenarioFeedbackLesson, 'id' | 'confidence' | 'evidence_count'>,
): void {
  const key = [
    input.scope,
    input.horizon,
    input.market_type,
    input.statement,
  ].join('|');
  const existing = lessons.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  lessons.set(key, {
    count: 1,
    lesson: {
      ...input,
      id: idFromParts('scenario_feedback_lesson', key),
      confidence: 'low',
      evidence_count: 1,
    },
  });
}

function addGate(
  gates: Map<string, ScenarioFeedbackGate>,
  input: Omit<ScenarioFeedbackGate, 'id'>,
): void {
  const key = `${input.applies_to}|${input.reason}`;
  gates.set(key, {
    ...input,
    id: idFromParts('scenario_feedback_gate', key),
  });
}

function toScenarioFeedbackPlaybook(row: JsonRecord): ScenarioFeedbackPlaybookResponse {
  return {
    version: 'scenario_feedback_playbook.v1',
    workspace_id: stringValue(row.workspace_id),
    symbol: stringValue(row.symbol),
    generated_at: stringValue(row.generated_at, new Date().toISOString()),
    source_evaluation_ids: stringList(row.source_evaluation_ids),
    source_signal_report_ids: stringList(row.source_signal_report_ids),
    lessons: records(row.lessons).map((lesson) => ({
      id: stringValue(lesson.id),
      scope: lessonScopeValue(lesson.scope),
      horizon: stringValue(lesson.horizon, 'unknown'),
      market_type: marketTypeValue(lesson.market_type),
      statement: stringValue(lesson.statement),
      confidence: confidenceValue(lesson.confidence),
      evidence_count: integerValue(lesson.evidence_count, 1),
    })),
    gates: records(row.gates).map((gate) => ({
      id: stringValue(gate.id),
      reason: stringValue(gate.reason),
      applies_to: gateTargetValue(gate.applies_to),
    })),
    exclusions: stringList(row.exclusions),
  };
}

function scenarioFeedbackPlaybookId(feedback: ScenarioFeedbackPlaybookResponse): string {
  return idFromParts(
    'scenario_feedback_playbook',
    feedback.workspace_id,
    feedback.symbol,
    feedback.generated_at,
  );
}

function idFromParts(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}`;
}

function confidenceForCount(count: number): ScenarioFeedbackConfidence {
  if (count >= 5) {
    return 'high';
  }
  if (count >= 2) {
    return 'medium';
  }
  return 'low';
}

function lessonScopeValue(value: unknown): ScenarioFeedbackLessonScope {
  return value === 'signal' ||
    value === 'playbook' ||
    value === 'data_quality' ||
    value === 'scenario'
    ? value
    : 'scenario';
}

function marketTypeValue(value: unknown): ScenarioFeedbackMarketType {
  return value === 'spot' || value === 'perp' ? value : 'unknown';
}

function confidenceValue(value: unknown): ScenarioFeedbackConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function gateTargetValue(value: unknown): ScenarioFeedbackGate['applies_to'] {
  return value === 'confirmation' ||
    value === 'invalidation' ||
    value === 'playbook_compile' ||
    value === 'entry'
    ? value
    : 'entry';
}

function signalHorizon(report: JsonRecord): string {
  const horizon = integerValue(report.horizon_minutes, 0);
  return horizon > 0 ? `${horizon}m` : 'unknown';
}

function normalizeSymbol(value: unknown): string {
  return stringValue(value).trim().toUpperCase();
}

function stringValue(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => stringValue(item).trim())
    .filter((item) => item.length > 0);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => isRecord(item))
    : [];
}

function integerValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function isMissingSignalEvaluationTableError(error: unknown): boolean {
  const code = isRecord(error) ? String(error.code ?? '') : '';
  if (code !== '42P01' && code !== 'P2021') {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('signal_evaluation_reports');
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
