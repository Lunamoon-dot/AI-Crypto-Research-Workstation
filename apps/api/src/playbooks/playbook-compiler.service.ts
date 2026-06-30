import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  PlaybookCompileReportResponse,
  TradePlaybookResponse,
} from './playbook.types';
import {
  toPlaybookCompileReportResponse,
  toScenarioResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { evaluateScenario } from '../scenarios/scenario-evaluator';
import { ScenarioReliabilityService } from '../scenarios/scenario-reliability.service';
import { evaluateScenarioRuntimeDecision } from '../scenarios/scenario-runtime-evaluator';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class PlaybookCompilerService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly reliability: ScenarioReliabilityService,
  ) {}

  async compileScenario(
    scenario: JsonRecord,
    thesis: JsonRecord,
    workspaceId: string,
  ): Promise<PlaybookCompileReportResponse> {
    const response = toScenarioResponse(scenario, thesis);
    const recommendation = response.scenario_recommendation;
    const rejectionReasons: string[] = [];
    const warnings: string[] = [];

    if (!recommendation) {
      rejectionReasons.push('Missing scenario recommendation.');
    }
    const direction = playbookDirection(recommendation?.action_bias);
    if (recommendation?.action === 'avoid') {
      rejectionReasons.push('Recommendation is not directional.');
    }
    if (
      recommendation &&
      ['wait', 'review'].includes(recommendation.action) &&
      direction
    ) {
      warnings.push('Recommendation is wait/review; compiled as a conditional manual playbook only.');
    }
    if (response.runtime_decision.validity_status === 'expired') {
      rejectionReasons.push('Scenario is expired.');
    }
    if (response.runtime_decision.validity_status === 'invalidated') {
      rejectionReasons.push('Scenario is invalidated.');
    }
    warnings.push(
      ...response.runtime_decision.blocking_reasons.map(
        (reason) => `Runtime blocker: ${reason}`,
      ),
    );
    if (recommendation?.hard_gates.some((gate) => gate.status !== 'passed')) {
      rejectionReasons.push('Hard gates are pending.');
    }
    const trigger = firstCondition(
      recommendation?.required_conditions,
      response.decision_playbook?.entry_conditions,
    );
    if (!trigger) {
      rejectionReasons.push('Missing trigger.');
    }
    const invalidation = firstCondition(
      recommendation?.invalidation_conditions,
      response.decision_playbook?.invalidation_conditions,
    );
    if (!invalidation) {
      rejectionReasons.push('Missing invalidation.');
    }
    if (!direction) {
      rejectionReasons.push('Direction is not actionable.');
    }
    if (recommendation?.evidence_refs.length === 0) {
      rejectionReasons.push('Missing evidence refs.');
    }
    const marketType = marketTypeValue(thesis.market_type ?? response.payload.market_type);
    if (!marketType) {
      rejectionReasons.push('Missing market type.');
    }

    if (rejectionReasons.length > 0 || !recommendation || !trigger || !invalidation || !marketType || !direction) {
      return toPlaybookCompileReportResponse({
        version: 'playbook_compile_report.v1',
        eligible: false,
        playbook: null,
        rejection_reasons: unique(rejectionReasons),
        warnings,
      });
    }

    const playbook = toTradePlaybookResponse({
      version: 'trade_playbook.v1',
      id: `playbook_${randomUUID().replaceAll('-', '')}`,
      workspace_id: workspaceId,
      source_scenario_id: response.id ?? '',
      source_thesis_id: response.thesis_id,
      symbol: String(thesis.symbol ?? response.payload.symbol ?? ''),
      market_type: marketType,
      direction,
      horizon: response.horizon,
      entry: playbookEntry(trigger),
      invalidation: {
        condition: conditionText(invalidation),
        level: numberOrNull(invalidation.level),
      },
      targets: targetList(targetSource(response, thesis)),
      no_trade_conditions: [
        ...recommendation.blocking_reasons,
        ...recommendation.wait_for,
      ],
      risk_context: [
        ...recommendation.risk_notes,
        ...stringList(response.reliability_profile?.recent_lessons),
      ],
      sizing_policy: {
        mode: 'manual_context_only',
        notes: ['Manual sizing context only; no broker execution is implied.'],
      },
      evidence_refs: recommendation.evidence_refs,
      reliability_context: response.reliability_profile,
      compile_warnings: warnings,
      created_at: new Date().toISOString(),
    });
    const saved = await this.journal.saveTradePlaybook(
      playbook as unknown as JsonRecord,
      workspaceId,
    );
    return toPlaybookCompileReportResponse({
      version: 'playbook_compile_report.v1',
      eligible: true,
      playbook: saved,
      rejection_reasons: [],
      warnings,
    });
  }

  async compileScenarioById(
    scenarioId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PlaybookCompileReportResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    const scenario = await this.journal.getScenario(scenarioId, workspaceId);
    if (!scenario) {
      throw new NotFoundException(`Scenario ${scenarioId} not found`);
    }
    const thesis = await this.journal.getThesis(String(scenario.thesis_id ?? ''), workspaceId);
    if (!thesis) {
      throw new NotFoundException(`Thesis ${scenario.thesis_id} not found`);
    }
    const runtimeScenario = await this.scenarioWithRuntimeDecision(
      scenario,
      thesis,
      workspaceId,
    );
    const response = toScenarioResponse(runtimeScenario, thesis);
    const reliabilityProfile = await this.reliability.profileForScenario(
      response,
      thesis,
      workspaceId,
    );
    return this.compileScenario(
      {
        ...runtimeScenario,
        reliability_profile: reliabilityProfile,
      },
      thesis,
      workspaceId,
    );
  }

  async listForScenario(
    scenarioId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<TradePlaybookResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    return (await optionalScenarioLifecycleRows(() =>
      this.journal.listTradePlaybooksForScenario(scenarioId, workspaceId),
    )).map(toTradePlaybookResponse);
  }

  async getPlaybook(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<TradePlaybookResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    const playbook = await this.journal.getTradePlaybook(id, workspaceId);
    if (!playbook) {
      throw new NotFoundException(`Playbook ${id} not found`);
    }
    return toTradePlaybookResponse(playbook);
  }

  private async resolveWorkspace(
    userId: string | undefined,
    workspaceHeader: string | undefined,
    role: 'viewer' | 'editor',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, role);
    return workspaceId;
  }

  private async scenarioWithRuntimeDecision(
    scenario: JsonRecord,
    thesis: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const payload = recordValue(scenario.payload ?? scenario.payload_json);
    const symbol = String(thesis.symbol ?? payload.symbol ?? '');
    const snapshot = symbol
      ? await this.journal.getLatestMarketSnapshot(symbol, workspaceId)
      : null;
    const existingRuntime = recordValue(
      scenario.runtime_decision ?? payload.runtime_decision,
    );
    if (!snapshot && existingRuntime.version === 'scenario_runtime_decision.v1') {
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
      decision_playbook: recordValue(payload.decision_playbook),
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
        ...recordValue(scenarioForRuntime.payload),
        runtime_decision: runtimeDecision,
      },
    };
  }
}

function firstCondition(...groups: Array<unknown[] | undefined>): JsonRecord | null {
  for (const group of groups) {
    for (const item of group ?? []) {
      const record = recordValue(item);
      if (record.type) {
        return record;
      }
    }
  }
  return null;
}

function playbookDirection(value: unknown): 'long' | 'short' | null {
  if (value === 'long') {
    return 'long';
  }
  if (value === 'short') {
    return 'short';
  }
  return null;
}

function playbookEntry(condition: JsonRecord): TradePlaybookResponse['entry'] {
  return {
    type: condition.zone_low !== undefined || condition.zone_high !== undefined
      ? 'zone'
      : condition.level !== undefined
        ? 'level'
        : 'condition',
    condition: conditionText(condition),
    level: numberOrNull(condition.level),
    zone_low: numberOrNull(condition.zone_low),
    zone_high: numberOrNull(condition.zone_high),
  };
}

function conditionText(condition: JsonRecord): string {
  const type = String(condition.type ?? 'condition').replaceAll('_', ' ');
  const level = numberOrNull(condition.level);
  if (level !== null) {
    return `${type} ${level}`;
  }
  const low = numberOrNull(condition.zone_low);
  const high = numberOrNull(condition.zone_high);
  if (low !== null && high !== null) {
    return `${type} ${low}-${high}`;
  }
  return type;
}

function targetList(value: unknown): TradePlaybookResponse['targets'] {
  return stringList(value).map((item, index) => ({
    label: `Target ${index + 1}`,
    level: numberOrNull(item.match(/\d+(?:\.\d+)?/)?.[0]),
    rationale: item,
  }));
}

function targetSource(
  response: ReturnType<typeof toScenarioResponse>,
  thesis: JsonRecord,
): unknown {
  const thesisPayload = recordValue(thesis.payload ?? thesis.payload_json);
  return (
    response.payload.targets ??
    response.payload.target_zones ??
    thesis.targets ??
    thesis.target_zones ??
    thesisPayload.targets ??
    thesisPayload.target_zones
  );
}

function marketTypeValue(value: unknown): 'spot' | 'perp' | null {
  return value === 'perp' ? 'perp' : 'spot';
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
