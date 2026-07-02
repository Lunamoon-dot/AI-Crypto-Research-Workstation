import { createHash } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  toScenarioResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { playbookSourceHashes } from '../playbooks/playbook-source-hash';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionConditionRole,
  ScenarioRuntimeDecision,
} from './scenario-decision.types';
import { evaluateScenarioRuntimeDecision } from './scenario-runtime-evaluator';
import type {
  ScenarioConditionEvaluationResponse,
  ScenarioConditionEvaluationStatus,
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
  ScenarioTargetProgressResponse,
} from './scenario-chart.types';

@Injectable()
export class ScenarioLiveStateService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  async getLiveState(
    scenarioId: string,
    workspaceId: string,
  ): Promise<ScenarioLiveStateResponse> {
    const context = await this.loadContext(scenarioId, workspaceId);
    return buildScenarioLiveState(context);
  }

  async refreshLiveState(
    scenarioId: string,
    workspaceId: string,
  ): Promise<ScenarioLiveStateResponse> {
    const context = await this.loadContext(scenarioId, workspaceId);
    const state = buildScenarioLiveState(context);
    for (const event of eventsFromState(state, context.thesisId)) {
      await this.journal.saveScenarioEvent(event as unknown as JsonRecord, workspaceId);
    }
    return this.getLiveState(scenarioId, workspaceId);
  }

  private async loadContext(
    scenarioId: string,
    workspaceId: string,
  ): Promise<LiveStateContext> {
    const scenario = await this.journal.getScenario(scenarioId, workspaceId);
    if (!scenario) {
      throw new NotFoundException('Scenario not found.');
    }
    const payload = recordValue(scenario.payload ?? scenario.payload_json);
    const thesisId = stringValue(scenario.thesis_id);
    const thesis = thesisId
      ? await this.journal.getThesis(thesisId, workspaceId)
      : null;
    const symbol = stringValue(thesis?.symbol ?? scenario.symbol ?? payload.symbol);
    const snapshot = symbol
      ? await this.journal.getLatestMarketSnapshot(symbol, workspaceId)
      : null;
    const evaluatedAt = new Date().toISOString();
    const runtime = evaluateScenarioRuntimeDecision(
      scenario,
      snapshot,
      evaluatedAt,
    );
    const scenarioWithRuntime = {
      ...scenario,
      runtime_decision: runtime,
      payload: {
        ...payload,
        runtime_decision: runtime,
      },
    };
    const response = toScenarioResponse(scenarioWithRuntime, thesis);
    const rawPlaybooks = await this.journal.listTradePlaybooksForScenario(
      scenarioId,
      workspaceId,
    );
    const latestPlaybook = currentPlaybook(rawPlaybooks[0] ?? null, response);
    const events = await this.journal.listScenarioEvents(
      scenarioId,
      workspaceId,
      20,
    );
    return {
      scenarioId,
      workspaceId,
      thesisId,
      response,
      runtime,
      snapshot,
      latestPlaybook,
      events,
      evaluatedAt,
    };
  }
}

interface LiveStateContext {
  scenarioId: string;
  workspaceId: string;
  thesisId: string;
  response: ReturnType<typeof toScenarioResponse>;
  runtime: ScenarioRuntimeDecision;
  snapshot: JsonRecord | null;
  latestPlaybook: TradePlaybookResponse | null;
  events: JsonRecord[];
  evaluatedAt: string;
}

function buildScenarioLiveState(
  context: LiveStateContext,
): ScenarioLiveStateResponse {
  const currentPrice = nullableNumber(context.snapshot?.current_price);
  const conditionEvaluations = context.response.decision_playbook
    ? conditionEvaluationsFor(
        context.response.decision_playbook.entry_conditions,
        context.response.decision_playbook.invalidation_conditions,
        context.response.decision_playbook.avoid_if,
        currentPrice,
      )
    : [];
  const targetProgress = targetProgressFor(
    context.latestPlaybook,
    currentPrice,
    context.evaluatedAt,
  );
  return {
    version: 'scenario_live_state.v1',
    scenario_id: context.scenarioId,
    workspace_id: context.workspaceId,
    evaluated_at: context.evaluatedAt,
    current_price: currentPrice,
    trigger_status: context.runtime.trigger_status,
    validity_status: context.runtime.validity_status,
    recommended_action: context.runtime.recommended_action,
    distance_to_trigger: context.runtime.distance_to_trigger,
    condition_evaluations: conditionEvaluations,
    target_progress: targetProgress,
    blockers: context.runtime.blocking_reasons,
    commentary: commentaryFor(context.runtime, targetProgress),
    latest_event: context.events[0]
      ? toScenarioEventResponse(context.events[0])
      : null,
  };
}

function conditionEvaluationsFor(
  entryConditions: ScenarioDecisionCondition[],
  invalidationConditions: ScenarioDecisionCondition[],
  avoidConditions: ScenarioDecisionCondition[],
  currentPrice: number | null,
): ScenarioConditionEvaluationResponse[] {
  const rows: ScenarioConditionEvaluationResponse[] = [];
  addConditionRows(rows, entryConditions, 'entry', currentPrice);
  addConditionRows(rows, invalidationConditions, 'invalidation', currentPrice);
  addConditionRows(rows, avoidConditions, 'avoid', currentPrice);
  return rows;
}

function addConditionRows(
  rows: ScenarioConditionEvaluationResponse[],
  conditions: ScenarioDecisionCondition[],
  fallbackRole: ScenarioDecisionConditionRole,
  currentPrice: number | null,
): void {
  for (const [index, condition] of conditions.entries()) {
    const role = condition.role ?? fallbackRole;
    const label = condition.label ?? conditionLabel(condition);
    const status = conditionStatus(role, conditionResult(condition, currentPrice));
    rows.push({
      id:
        condition.id ??
        `decision_${role}_${index}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      label,
      role,
      type: condition.type,
      status,
      reason: conditionReason(role, status),
      level: nullableNumber(condition.level),
      zone_low: nullableNumber(condition.zone_low),
      zone_high: nullableNumber(condition.zone_high),
      source: 'decision_playbook',
    });
  }
}

function targetProgressFor(
  playbook: TradePlaybookResponse | null,
  currentPrice: number | null,
  evaluatedAt: string,
): ScenarioTargetProgressResponse[] {
  if (!playbook || playbook.status !== 'current') {
    return [];
  }
  return playbook.targets.map((target) => {
    const level = target.level;
    if (level === null || currentPrice === null) {
      return {
        label: target.label,
        level,
        status: 'unknown',
        hit_at: null,
        rationale: target.rationale,
      };
    }
    const hit =
      playbook.direction === 'short'
        ? currentPrice <= level
        : currentPrice >= level;
    return {
      label: target.label,
      level,
      status: hit ? 'hit' : 'pending',
      hit_at: hit ? evaluatedAt : null,
      rationale: target.rationale,
    };
  });
}

function eventsFromState(
  state: ScenarioLiveStateResponse,
  thesisId: string,
): ScenarioEventResponse[] {
  const events: ScenarioEventResponse[] = [];
  if (state.validity_status === 'invalidated') {
    events.push(scenarioEvent(state, thesisId, 'scenario.invalidated', 'validity:invalidated', 'Scenario invalidated.'));
  }
  if (state.validity_status === 'expired') {
    events.push(scenarioEvent(state, thesisId, 'scenario.expired', 'validity:expired', 'Scenario expired.'));
  }
  if (state.validity_status === 'overextended') {
    events.push(scenarioEvent(state, thesisId, 'scenario.overextended', 'validity:overextended', 'Scenario overextended.'));
  }
  if (state.trigger_status === 'triggered') {
    events.push(scenarioEvent(state, thesisId, 'scenario.triggered', 'trigger:triggered', 'Scenario triggered.'));
  }
  if (state.trigger_status === 'near_trigger') {
    events.push(scenarioEvent(state, thesisId, 'scenario.near_trigger', 'trigger:near', 'Scenario near trigger.'));
  }
  for (const target of state.target_progress) {
    if (target.status === 'hit') {
      events.push(
        scenarioEvent(
          state,
          thesisId,
          'scenario.target_hit',
          `target:${target.label}`,
          `Target hit: ${target.label}.`,
        ),
      );
    }
  }
  for (const condition of state.condition_evaluations) {
    if (condition.status === 'passed') {
      events.push(
        scenarioEvent(
          state,
          thesisId,
          'scenario.condition_passed',
          `condition:${condition.id}:passed`,
          `Condition passed: ${condition.label}.`,
        ),
      );
    }
    if (condition.status === 'failed') {
      events.push(
        scenarioEvent(
          state,
          thesisId,
          'scenario.condition_failed',
          `condition:${condition.id}:failed`,
          `Condition failed: ${condition.label}.`,
        ),
      );
    }
  }
  return events;
}

function scenarioEvent(
  state: ScenarioLiveStateResponse,
  thesisId: string,
  eventType: ScenarioEventResponse['event_type'],
  eventKey: string,
  summary: string,
): ScenarioEventResponse {
  return {
    version: 'scenario_event.v1',
    id: scenarioEventId({
      workspaceId: state.workspace_id,
      scenarioId: state.scenario_id,
      eventType,
      eventKey,
    }),
    workspace_id: state.workspace_id,
    scenario_id: state.scenario_id,
    thesis_id: thesisId || null,
    event_type: eventType,
    event_time: state.evaluated_at,
    summary,
    payload: {
      trigger_status: state.trigger_status,
      validity_status: state.validity_status,
      recommended_action: state.recommended_action,
      current_price: state.current_price,
      event_key: eventKey,
    },
    created_at: state.evaluated_at,
  };
}

function scenarioEventId(input: {
  workspaceId: string;
  scenarioId: string;
  eventType: string;
  eventKey: string;
}): string {
  return `scenario_event_${createHash('sha256')
    .update(`${input.workspaceId}:${input.scenarioId}:${input.eventType}:${input.eventKey}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function toScenarioEventResponse(value: JsonRecord): ScenarioEventResponse {
  return {
    version: 'scenario_event.v1',
    id: stringValue(value.id),
    workspace_id: stringValue(value.workspace_id, 'local'),
    scenario_id: stringValue(value.scenario_id),
    thesis_id: nullableString(value.thesis_id),
    event_type: scenarioEventType(value.event_type),
    event_time: stringValue(value.event_time),
    summary: stringValue(value.summary),
    payload: recordValue(value.payload),
    created_at: stringValue(value.created_at),
  };
}

function currentPlaybook(
  playbook: JsonRecord | null,
  scenario: ReturnType<typeof toScenarioResponse>,
): TradePlaybookResponse | null {
  if (!playbook) {
    return null;
  }
  const storedHashes = recordValue(playbook.source_hashes);
  if (Object.keys(storedHashes).length === 0) {
    return toTradePlaybookResponse(playbook);
  }
  const currentHashes = playbookSourceHashes({
    scenario: scenario.payload,
    decisionPlaybook: scenario.decision_playbook,
    recommendation: scenario.scenario_recommendation,
    runtimeDecision: scenario.runtime_decision,
  });
  const staleReasons = staleReasonsFor(storedHashes, currentHashes);
  return toTradePlaybookResponse(
    staleReasons.length === 0
      ? playbook
      : { ...playbook, status: 'stale', stale_reasons: staleReasons },
  );
}

function staleReasonsFor(
  storedHashes: JsonRecord,
  currentHashes: TradePlaybookResponse['source_hashes'],
): string[] {
  const reasons: string[] = [];
  addStaleReason(reasons, storedHashes.scenario, currentHashes.scenario, 'source_scenario_changed');
  addStaleReason(reasons, storedHashes.decision_playbook, currentHashes.decision_playbook, 'source_decision_playbook_changed');
  addStaleReason(reasons, storedHashes.recommendation, currentHashes.recommendation, 'source_recommendation_changed');
  addStaleReason(reasons, storedHashes.runtime_decision, currentHashes.runtime_decision, 'source_runtime_decision_changed');
  return reasons;
}

function addStaleReason(
  reasons: string[],
  storedHash: unknown,
  currentHash: string,
  reason: string,
): void {
  const stored = nullableString(storedHash);
  if (stored && stored !== currentHash) {
    reasons.push(reason);
  }
}

function conditionStatus(
  role: ScenarioDecisionConditionRole,
  result: 'matched' | 'failed' | 'unknown',
): ScenarioConditionEvaluationStatus {
  if (result === 'unknown') {
    return 'unknown';
  }
  if (role === 'invalidation' || role === 'avoid') {
    return result === 'matched' ? 'failed' : 'pending';
  }
  return result === 'matched' ? 'passed' : 'pending';
}

function conditionReason(
  role: ScenarioDecisionConditionRole,
  status: ScenarioConditionEvaluationStatus,
): string {
  if (status === 'passed') {
    return 'Condition is currently satisfied.';
  }
  if (status === 'failed' && (role === 'invalidation' || role === 'avoid')) {
    return 'Blocking condition is currently active.';
  }
  if (status === 'pending') {
    return 'Condition is not currently satisfied.';
  }
  return 'Condition cannot be evaluated from the latest price.';
}

function conditionResult(
  condition: ScenarioDecisionCondition,
  currentPrice: number | null,
): 'matched' | 'failed' | 'unknown' {
  if (currentPrice === null) {
    return 'unknown';
  }
  if (condition.type === 'price_above' || condition.type === 'price_reclaim_level') {
    return typeof condition.level === 'number'
      ? currentPrice >= condition.level
        ? 'matched'
        : 'failed'
      : 'unknown';
  }
  if (condition.type === 'price_below' || condition.type === 'price_reject_level') {
    return typeof condition.level === 'number'
      ? currentPrice <= condition.level
        ? 'matched'
        : 'failed'
      : 'unknown';
  }
  if (condition.type === 'price_in_zone') {
    return typeof condition.zone_low === 'number' &&
      typeof condition.zone_high === 'number'
      ? currentPrice >= condition.zone_low && currentPrice <= condition.zone_high
        ? 'matched'
        : 'failed'
      : 'unknown';
  }
  return 'unknown';
}

function conditionLabel(condition: ScenarioDecisionCondition): string {
  if (typeof condition.level === 'number') {
    return `${condition.type}:${condition.level}`;
  }
  if (
    typeof condition.zone_low === 'number' &&
    typeof condition.zone_high === 'number'
  ) {
    return `${condition.type}:${condition.zone_low}-${condition.zone_high}`;
  }
  return condition.type;
}

function commentaryFor(
  runtime: ScenarioRuntimeDecision,
  targets: ScenarioTargetProgressResponse[],
): string {
  if (runtime.validity_status === 'invalidated') {
    return 'Scenario is invalidated.';
  }
  if (runtime.validity_status === 'expired') {
    return 'Scenario is expired.';
  }
  if (runtime.validity_status === 'overextended') {
    return 'Scenario is overextended.';
  }
  if (runtime.blocking_reasons.length > 0) {
    return `Scenario requires review: ${runtime.blocking_reasons.join(', ')}.`;
  }
  const hitTargets = targets.filter((target) => target.status === 'hit').length;
  if (hitTargets > 0) {
    return `Scenario has ${hitTargets} target hit.`;
  }
  if (runtime.trigger_status === 'triggered' && runtime.validity_status === 'valid') {
    return 'Scenario is triggered and valid.';
  }
  if (runtime.trigger_status === 'near_trigger') {
    return 'Scenario is near trigger and valid.';
  }
  return `Scenario is ${runtime.trigger_status} with ${runtime.validity_status} validity.`;
}

function scenarioEventType(value: unknown): ScenarioEventResponse['event_type'] {
  const eventType = stringValue(value);
  if (
    eventType === 'scenario.generated' ||
    eventType === 'scenario.near_trigger' ||
    eventType === 'scenario.triggered' ||
    eventType === 'scenario.condition_passed' ||
    eventType === 'scenario.condition_failed' ||
    eventType === 'scenario.target_hit' ||
    eventType === 'scenario.weakened' ||
    eventType === 'scenario.invalidated' ||
    eventType === 'scenario.expired' ||
    eventType === 'scenario.overextended'
  ) {
    return eventType;
  }
  return 'scenario.generated';
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
