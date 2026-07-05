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
import { playbookSourceHashes } from './playbook-source-hash';
import {
  toPlaybookCompileReportResponse,
  toScenarioResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { evaluateScenario } from '../scenarios/scenario-evaluator';
import { ScenarioReliabilityService } from '../scenarios/scenario-reliability.service';
import { evaluateScenarioRuntimeDecision } from '../scenarios/scenario-runtime-evaluator';
import { firstPriceLevelFromText } from '../scenarios/scenario-text-conditions';
import {
  conditionEntryLevel,
  multiStageSetupRequiresSequence,
} from '../scenarios/sequenced-setup-guard';
import { WorkspacesService } from '../workspaces/workspaces.service';

const MULTI_STAGE_SETUP_REJECTION =
  'Multi-stage setup requires sequenced setup; refusing flat trade playbook.';

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
      ['wait', 'review'].includes(recommendation.action)
    ) {
      rejectionReasons.push('Recommendation action is wait/review.');
    }
    if (response.runtime_decision.validity_status === 'expired') {
      rejectionReasons.push('Scenario is expired.');
    }
    if (response.runtime_decision.validity_status === 'invalidated') {
      rejectionReasons.push('Scenario is invalidated.');
    }
    const runtimeBlockers = response.runtime_decision.blocking_reasons;
    warnings.push(
      ...runtimeBlockers.map(
        (reason) => `Runtime blocker: ${reason}`,
      ),
    );
    if (
      hasHardRuntimeBlocker(
        response.runtime_decision.validity_status,
        runtimeBlockers,
      )
    ) {
      rejectionReasons.push('Runtime decision has unresolved blockers.');
    }
    if (recommendation?.hard_gates.some((gate) => gate.status !== 'passed')) {
      rejectionReasons.push('Hard gates are pending.');
    }
    const invalidation = firstCondition(
      recommendation?.invalidation_conditions,
      response.decision_playbook?.invalidation_conditions,
    );
    if (!invalidation) {
      rejectionReasons.push('Missing invalidation.');
    }
    const rawTargets = targetList(targetSource(response, thesis));
    const hasEntryCandidate = hasPriceEntryCondition(
      recommendation?.required_conditions,
      response.decision_playbook?.entry_conditions,
    );
    const trigger = firstEntryCondition(
      direction,
      invalidation,
      rawTargets,
      recommendation?.required_conditions,
      response.decision_playbook?.entry_conditions,
    );
    if (!trigger) {
      rejectionReasons.push(
        hasEntryCandidate
          ? 'No coherent entry condition.'
          : 'Missing entry or trigger condition.',
      );
    }
    if (
      requiresSequencedSetup({
        direction,
        trigger,
        recommendation,
        decisionPlaybook: response.decision_playbook,
        scenario,
        payload: response.payload,
      })
    ) {
      rejectionReasons.push(MULTI_STAGE_SETUP_REJECTION);
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

    const entry = playbookEntry(trigger);
    const targets = directionalTargets(rawTargets, direction, entry);
    const filteredTargetCount = rawTargets.length - targets.length;
    if (filteredTargetCount > 0) {
      warnings.push(`Filtered ${filteredTargetCount} target(s) outside ${direction} playbook direction.`);
    }
    const numericRawTargetCount = rawTargets.filter(
      (target) => target.level !== null,
    ).length;
    const numericTargetCount = targets.filter(
      (target) => target.level !== null,
    ).length;
    if (numericRawTargetCount > 0 && numericTargetCount === 0) {
      rejectionReasons.push('No directional targets remain after validation.');
    }
    if (rejectionReasons.length > 0) {
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
      entry,
      invalidation: {
        condition: conditionText(invalidation),
        level: numberOrNull(invalidation.level),
      },
      targets,
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
      compiler_version: 'playbook_compiler.v2',
      source_hashes: playbookSourceHashes({
        scenario: response.payload,
        decisionPlaybook: response.decision_playbook,
        recommendation,
        runtimeDecision: response.runtime_decision,
      }),
      status: 'current',
      stale_reasons: [],
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

function firstEntryCondition(
  direction: 'long' | 'short' | null,
  invalidation: JsonRecord | null,
  targets: TradePlaybookResponse['targets'],
  ...groups: Array<unknown[] | undefined>
): JsonRecord | null {
  for (const group of groups) {
    for (const item of group ?? []) {
      const record = recordValue(item);
      if (!isPriceEntryCondition(record)) {
        continue;
      }
      if (entryConditionIsCoherent(record, direction, invalidation, targets)) {
        return record;
      }
    }
  }
  return null;
}

function requiresSequencedSetup(input: {
  direction: 'long' | 'short' | null;
  trigger: JsonRecord | null;
  recommendation: ReturnType<typeof toScenarioResponse>['scenario_recommendation'];
  decisionPlaybook: ReturnType<typeof toScenarioResponse>['decision_playbook'];
  scenario: JsonRecord;
  payload: JsonRecord;
}): boolean {
  if (!input.direction || !input.trigger) {
    return false;
  }
  return multiStageSetupRequiresSequence({
    direction: input.direction,
    entryLevel: conditionEntryLevel(input.trigger, input.direction),
    conditions: [
      ...(input.recommendation?.required_conditions ?? []),
      ...(input.decisionPlaybook?.entry_conditions ?? []),
    ],
    textSources: preconditionTexts(input),
  });
}

function preconditionTexts(input: {
  recommendation: ReturnType<typeof toScenarioResponse>['scenario_recommendation'];
  decisionPlaybook: ReturnType<typeof toScenarioResponse>['decision_playbook'];
  scenario: JsonRecord;
  payload: JsonRecord;
}): unknown[] {
  return [
    ...stringList(input.recommendation?.wait_for),
    input.recommendation?.summary,
    ...stringList(input.decisionPlaybook?.wait_for),
    input.decisionPlaybook?.rationale,
    input.scenario.condition,
    input.scenario.expected_behavior,
    input.payload.condition,
    input.payload.expected_behavior,
  ];
}

function hasPriceEntryCondition(...groups: Array<unknown[] | undefined>): boolean {
  return groups.some((group) =>
    (group ?? []).some((item) => isPriceEntryCondition(recordValue(item))),
  );
}

function isPriceEntryCondition(condition: JsonRecord): boolean {
  const role = String(condition.role ?? '');
  if (role === 'watch' || role === 'confirmation' || role === 'avoid') {
    return false;
  }
  const type = String(condition.type ?? '');
  return (
    role === 'entry' ||
    role === 'trigger' ||
    type === 'price_above' ||
    type === 'price_below' ||
    type === 'price_in_zone' ||
    type === 'price_reclaim_level' ||
    type === 'price_reject_level'
  );
}

function entryConditionIsCoherent(
  condition: JsonRecord,
  direction: 'long' | 'short' | null,
  invalidation: JsonRecord | null,
  targets: TradePlaybookResponse['targets'],
): boolean {
  if (!direction) {
    return true;
  }
  const entry = playbookEntry(condition);
  const entryLevel = entryReferenceLevel(entry, direction);
  if (entryLevel === null) {
    return true;
  }
  const invalidationLevel = numberOrNull(invalidation?.level);
  if (invalidationLevel !== null) {
    if (direction === 'long' && invalidationLevel >= entryLevel) {
      return false;
    }
    if (direction === 'short' && invalidationLevel <= entryLevel) {
      return false;
    }
  }
  const numericTargets = targets
    .map((target) => target.level)
    .filter((level): level is number => level !== null);
  if (numericTargets.length === 0) {
    return true;
  }
  return numericTargets.some((level) =>
    direction === 'long' ? level > entryLevel : level < entryLevel,
  );
}

function entryReferenceLevel(
  entry: TradePlaybookResponse['entry'],
  direction: 'long' | 'short',
): number | null {
  return numberOrNull(
    entry.level ?? (direction === 'long' ? entry.zone_high : entry.zone_low),
  );
}

function hasHardRuntimeBlocker(
  validityStatus: unknown,
  blockers: string[],
): boolean {
  if (validityStatus === 'overextended' || validityStatus === 'conflicted') {
    return true;
  }
  return blockers.some(
    (reason) =>
      reason === 'Price is overextended from trigger.' ||
      reason === 'Scenario action bias does not match entry direction.',
  );
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
    level: firstPriceLevelFromText(item),
    rationale: item,
  }));
}

function directionalTargets(
  targets: TradePlaybookResponse['targets'],
  direction: 'long' | 'short',
  entry: TradePlaybookResponse['entry'],
): TradePlaybookResponse['targets'] {
  const entryLevel = numberOrNull(
    entry.level ?? (direction === 'long' ? entry.zone_high : entry.zone_low),
  );
  if (entryLevel === null) {
    return targets;
  }
  return targets.filter((target) => {
    if (target.level === null) {
      return true;
    }
    return direction === 'long'
      ? target.level > entryLevel
      : target.level < entryLevel;
  });
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
