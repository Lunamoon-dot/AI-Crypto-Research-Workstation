import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
  ThesisDecisionIntent,
  ThesisReviewMetrics,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  ExportedJournal,
  SqliteJournalSyncService,
} from '../jobs/sqlite-journal-sync.service';
import {
  toScenarioResponse,
  toThesisDecisionResponse,
  toThesisResponse,
  toThesisReviewResponse,
} from '../contracts/frontend-contract';
import { clampListLimit } from '../common/query-limit';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { playbookSourceHashes } from '../playbooks/playbook-source-hash';
import { ScenarioReliabilityService } from '../scenarios/scenario-reliability.service';
import {
  latestUsableBacktestRun,
  latestValidScenarioEvaluation,
} from '../scenarios/scenario-lifecycle-artifacts';
import { evaluateScenario } from '../scenarios/scenario-evaluator';
import { evaluateScenarioRuntimeDecision } from '../scenarios/scenario-runtime-evaluator';

@Injectable()
export class ThesesService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly reliability: ScenarioReliabilityService,
    @Optional()
    private readonly sqliteSync?: SqliteJournalSyncService,
  ) {}

  async list(limit = 50, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const theses = await this.journal.listTheses(
      clampListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      workspaceId,
    );
    return theses.map(toThesisResponse);
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (thesis) {
      return toThesisResponse(thesis);
    }
    const sqliteThesis = await this.thesisFromSqlite(id, workspaceId);
    if (sqliteThesis) {
      return toThesisResponse(sqliteThesis);
    }
    throw new NotFoundException(`Thesis ${id} not found`);
  }

  async scenarios(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (thesis) {
      const scenarios = await this.journal.listScenarios(id, workspaceId);
      const enriched = await Promise.all(
        scenarios.map((scenario) =>
          this.enrichScenarioLifecycle(scenario, thesis, workspaceId),
        ),
      );
      return enriched.map((scenario) => toScenarioResponse(scenario, thesis));
    }
    const sqlite = await this.sqliteSync?.exportThesis(id);
    const sqliteThesis = sqlite ? thesisFromExport(sqlite, id, workspaceId) : null;
    if (!sqliteThesis) {
      throw new NotFoundException(`Thesis ${id} not found`);
    }
    return scenariosFromExport(sqlite!, id, workspaceId).map((scenario) =>
      toScenarioResponse(scenario, sqliteThesis),
    );
  }

  async decide(
    id: string,
    action: string,
    notes = '',
    userId?: string,
    workspaceHeader?: string,
    intent?: ThesisDecisionIntent,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.get(id, userId, workspaceId);
    const decision = await this.journal.recordThesisDecision(
      id,
      action,
      notes,
      workspaceId,
      intent,
    );
    return toThesisDecisionResponse(decision);
  }

  async review(
    id: string,
    result: string,
    notes = '',
    userId?: string,
    workspaceHeader?: string,
    metrics?: ThesisReviewMetrics,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.get(id, userId, workspaceId);
    const review = await this.journal.recordThesisReview(
      id,
      result,
      notes,
      workspaceId,
      metrics,
    );
    return toThesisReviewResponse(review);
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
    requiredRole: 'viewer' | 'editor' = 'viewer',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }

  private async thesisFromSqlite(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const exported = await this.sqliteSync?.exportThesis(id);
    return exported ? thesisFromExport(exported, id, workspaceId) : null;
  }

  private async enrichScenarioLifecycle(
    scenario: JsonRecord,
    thesis: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const scenarioId = stringField(scenario.id);
    if (!scenarioId) {
      return scenario;
    }
    const scenarioWithRuntime = await this.scenarioWithRuntimeDecision(
      scenario,
      thesis,
      workspaceId,
    );
    const baseResponse = toScenarioResponse(scenarioWithRuntime, thesis);
    const [evaluations, playbooks, reliabilityProfile] = await Promise.all([
      optionalScenarioLifecycleRows(() =>
        this.journal.listScenarioEvaluations(scenarioId, workspaceId),
      ),
      optionalScenarioLifecycleRows(() =>
        this.journal.listTradePlaybooksForScenario(scenarioId, workspaceId),
      ),
      this.reliability.profileForScenario(baseResponse, thesis, workspaceId),
    ]);
    const latestPlaybook = playbookWithStaleness(playbooks[0] ?? null, baseResponse);
    const backtests = latestPlaybook
      ? await optionalScenarioLifecycleRows(() =>
          this.journal.listBacktestRunsForPlaybook(
            String(latestPlaybook.id ?? ''),
            workspaceId,
          ),
        )
      : [];
    const latestBacktest = latestUsableBacktestRun(backtests);
    const tradeEvents = latestBacktest
      ? await optionalScenarioLifecycleRows(() =>
          this.journal.listBacktestTradeEvents(
            String(latestBacktest.id ?? ''),
            workspaceId,
          ),
        )
      : [];
    return {
      ...scenarioWithRuntime,
      latest_evaluation: latestValidScenarioEvaluation(evaluations),
      latest_playbook: latestPlaybook,
      latest_backtest: latestBacktest
        ? { ...latestBacktest, trade_events: tradeEvents }
        : null,
      reliability_profile: reliabilityProfile,
    };
  }

  private async scenarioWithRuntimeDecision(
    scenario: JsonRecord,
    thesis: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const payload = recordFromValue(scenario.payload ?? scenario.payload_json) ?? {};
    const symbol = stringField(thesis.symbol ?? payload.symbol);
    const snapshot = symbol
      ? await this.journal.getLatestMarketSnapshot(symbol, workspaceId)
      : null;
    const existingRuntime = recordFromValue(
      scenario.runtime_decision ?? payload.runtime_decision,
    );
    if (!snapshot && existingRuntime?.version === 'scenario_runtime_decision.v1') {
      return scenario;
    }
    const nowIso = new Date().toISOString();
    const evaluation = evaluateScenario(scenario, snapshot, nowIso);
    const scenarioForRuntime = {
      ...scenario,
      status: evaluation.status,
      status_reason: evaluation.status_reason,
      distance_to_trigger: evaluation.distance_to_trigger,
      last_evaluated_at: evaluation.last_evaluated_at,
      trigger_spec: evaluation.trigger_spec,
      decision_playbook: recordFromValue(payload.decision_playbook) ?? {},
      payload: {
        ...payload,
        status: evaluation.status,
        status_reason: evaluation.status_reason,
        distance_to_trigger: evaluation.distance_to_trigger,
        last_evaluated_at: evaluation.last_evaluated_at,
        trigger_spec: evaluation.trigger_spec,
      },
    };
    const runtimeDecision = evaluateScenarioRuntimeDecision(
      scenarioForRuntime,
      snapshot,
      nowIso,
    );
    return {
      ...scenarioForRuntime,
      runtime_decision: runtimeDecision,
      payload: {
        ...recordFromValue(scenarioForRuntime.payload),
        runtime_decision: runtimeDecision,
      },
    };
  }

}

function thesisFromExport(
  exported: ExportedJournal,
  id: string,
  workspaceId: string,
): JsonRecord | null {
  return (
    rows(exported, 'trade_theses').find(
      (thesis) =>
        stringField(thesis.id) === id &&
        stringField(thesis.workspace_id ?? 'local') === workspaceId,
    ) ?? null
  );
}

function scenariosFromExport(
  exported: ExportedJournal,
  thesisId: string,
  workspaceId: string,
): JsonRecord[] {
  return rows(exported, 'scenarios').filter(
    (scenario) =>
      stringField(scenario.thesis_id) === thesisId &&
      stringField(scenario.workspace_id ?? workspaceId) === workspaceId,
  );
}

function rows(exported: ExportedJournal, table: string): JsonRecord[] {
  return (exported[table] ?? []).map(normalizeSqliteRow);
}

function normalizeSqliteRow(row: JsonRecord): JsonRecord {
  const normalized: JsonRecord = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = key.endsWith('_json') ? parseJsonValue(value) : value;
  }
  const payload = recordFromValue(normalized.payload_json);
  if (payload) {
    const columns = { ...normalized };
    Object.assign(normalized, payload, columns, {
      payload,
      payload_json: payload,
    });
    applyJsonColumnAliases(normalized);
  }
  return normalized;
}

function applyJsonColumnAliases(row: JsonRecord): void {
  for (const [key, value] of Object.entries(row)) {
    if (!key.endsWith('_json') || key === 'payload_json') {
      continue;
    }
    row[key.slice(0, -5)] = value;
  }
}

function recordFromValue(value: unknown): JsonRecord | null {
  const parsed = parseJsonValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as JsonRecord;
  }
  return null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringField(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function playbookWithStaleness(
  playbook: JsonRecord | null,
  response: ReturnType<typeof toScenarioResponse>,
): JsonRecord | null {
  if (!playbook) {
    return null;
  }
  const storedHashes = recordFromValue(playbook.source_hashes);
  if (!storedHashes || Object.keys(storedHashes).length === 0) {
    return playbook;
  }
  const currentHashes = playbookSourceHashes({
    scenario: response.payload,
    decisionPlaybook: response.decision_playbook,
    recommendation: response.scenario_recommendation,
    runtimeDecision: response.runtime_decision,
  });
  const staleReasons: string[] = [];
  addStaleReason(
    staleReasons,
    storedHashes.scenario,
    currentHashes.scenario,
    'source_scenario_changed',
  );
  addStaleReason(
    staleReasons,
    storedHashes.decision_playbook,
    currentHashes.decision_playbook,
    'source_decision_playbook_changed',
  );
  addStaleReason(
    staleReasons,
    storedHashes.recommendation,
    currentHashes.recommendation,
    'source_recommendation_changed',
  );
  addStaleReason(
    staleReasons,
    storedHashes.runtime_decision,
    currentHashes.runtime_decision,
    'source_runtime_decision_changed',
  );
  if (staleReasons.length === 0) {
    return {
      ...playbook,
      status: playbook.status ?? 'current',
      stale_reasons: [],
    };
  }
  return {
    ...playbook,
    status: 'stale',
    stale_reasons: staleReasons,
  };
}

function addStaleReason(
  staleReasons: string[],
  storedHash: unknown,
  currentHash: string,
  reason: string,
): void {
  const stored = stringField(storedHash);
  if (stored && stored !== currentHash) {
    staleReasons.push(reason);
  }
}
