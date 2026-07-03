import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  toScenarioResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { evaluateTradePlaybookFreshness } from '../playbooks/playbook-freshness';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import {
  MarketChartInterval,
  MarketOhlcvCandleResponse,
  MarketOhlcvService,
} from '../market-data/market-ohlcv.service';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionConditionRole,
  ScenarioRuntimeDecision,
} from './scenario-decision.types';
import {
  conditionIntervalsForPlaybook,
  evaluateScenarioCondition,
  type ScenarioConditionEvaluationContext,
} from './scenario-condition-evaluator';
import {
  ScenarioContext,
  ScenarioContextLoaderService,
} from './scenario-context-loader.service';
import { evaluateScenarioRuntimeDecision } from './scenario-runtime-evaluator';
import type {
  ScenarioConditionEvaluationResponse,
  ScenarioConditionEvaluationStatus,
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
  ScenarioTargetProgressResponse,
} from './scenario-chart.types';
import { scenarioTransitionEvents } from './scenario-live-transitions';

@Injectable()
export class ScenarioLiveStateService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly ohlcv: MarketOhlcvService,
    private readonly contextLoader: ScenarioContextLoaderService,
  ) {}

  async getLiveState(
    scenarioId: string,
    workspaceId: string,
  ): Promise<ScenarioLiveStateResponse> {
    const context = await this.contextLoader.load({
      scenarioId,
      workspaceId,
      eventLimit: 20,
    });
    return this.getLiveStateFromContext(context);
  }

  async getLiveStateFromContext(
    context: ScenarioContext,
  ): Promise<ScenarioLiveStateResponse> {
    return buildScenarioLiveState(await this.toLiveStateContext(context));
  }

  async refreshLiveState(
    scenarioId: string,
    workspaceId: string,
  ): Promise<ScenarioLiveStateResponse> {
    const previousSnapshot =
      (await this.journal.getLatestScenarioLiveStateSnapshot?.(
        scenarioId,
        workspaceId,
      )) ?? null;
    const context = await this.contextLoader.load({
      scenarioId,
      workspaceId,
      eventLimit: 20,
    });
    const state = await this.getLiveStateFromContext(context);
    for (const event of scenarioTransitionEvents({
      previous: liveStateFromSnapshot(previousSnapshot),
      current: state,
      thesisId: context.thesisId || null,
      marketSnapshotId: nullableString(context.snapshot?.id),
    })) {
      await this.journal.saveScenarioEvent(event as unknown as JsonRecord, workspaceId);
    }
    await this.journal.saveScenarioLiveStateSnapshot?.(
      {
        id: scenarioLiveStateSnapshotId(state),
        workspace_id: workspaceId,
        scenario_id: scenarioId,
        market_snapshot_id: nullableString(context.snapshot?.id),
        evaluated_at: state.evaluated_at,
        state,
        source_hash: stateSourceHash(state),
      },
      workspaceId,
    );
    return this.getLiveState(scenarioId, workspaceId);
  }

  private async toLiveStateContext(
    context: ScenarioContext,
  ): Promise<LiveStateContext> {
    const evaluatedAt = new Date().toISOString();
    const baseResponse = toScenarioResponse(context.scenario, context.thesis);
    const closedCandlesByInterval = await this.loadClosedCandles({
      workspaceId: context.workspaceId,
      symbol: context.symbol,
      marketType: context.marketType,
      intervals: conditionIntervalsForPlaybook(baseResponse.decision_playbook),
      limit: 120,
    });
    const conditionContext: ScenarioConditionEvaluationContext = {
      currentPrice: nullableNumber(context.snapshot?.current_price),
      evaluatedAt,
      marketSnapshotId: nullableString(context.snapshot?.id),
      closedCandlesByInterval,
    };
    const runtime = evaluateScenarioRuntimeDecision(
      context.scenario,
      context.snapshot,
      evaluatedAt,
      conditionContext,
    );
    const scenarioWithRuntime = {
      ...context.scenario,
      runtime_decision: runtime,
      payload: {
        ...context.payload,
        runtime_decision: runtime,
      },
    };
    const response = toScenarioResponse(scenarioWithRuntime, context.thesis);
    const latestPlaybook = currentPlaybook(context.playbooks[0] ?? null, response);
    return {
      scenarioId: context.scenarioId,
      workspaceId: context.workspaceId,
      thesisId: context.thesisId,
      response,
      runtime,
      snapshot: context.snapshot,
      latestPlaybook,
      events: context.events,
      evaluatedAt,
      conditionContext,
    };
  }

  private async loadClosedCandles(input: {
    workspaceId: string;
    symbol: string;
    marketType: 'spot' | 'perp';
    intervals: MarketChartInterval[];
    limit: number;
  }): Promise<Partial<Record<MarketChartInterval, MarketOhlcvCandleResponse[]>>> {
    if (!input.symbol || input.intervals.length === 0) {
      return {};
    }
    const entries = await Promise.all(
      input.intervals.map(async (interval) => {
        const response = await this.ohlcv.getOhlcv({
          workspaceId: input.workspaceId,
          symbol: input.symbol,
          marketType: input.marketType,
          interval,
          limit: String(input.limit),
        });
        return [interval, response.candles] as const;
      }),
    );
    return Object.fromEntries(entries);
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
  conditionContext: ScenarioConditionEvaluationContext;
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
        context.conditionContext,
      )
    : [];
  const targetProgress = targetProgressFor(
    context.latestPlaybook,
    currentPrice,
    context.evaluatedAt,
  );
  const latestEvent = latestEventRecord(context.events);
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
    latest_event: latestEvent ? toScenarioEventResponse(latestEvent) : null,
  };
}

function conditionEvaluationsFor(
  entryConditions: ScenarioDecisionCondition[],
  invalidationConditions: ScenarioDecisionCondition[],
  avoidConditions: ScenarioDecisionCondition[],
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluationResponse[] {
  const rows: ScenarioConditionEvaluationResponse[] = [];
  addConditionRows(rows, entryConditions, 'entry', context);
  addConditionRows(rows, invalidationConditions, 'invalidation', context);
  addConditionRows(rows, avoidConditions, 'avoid', context);
  return rows;
}

function addConditionRows(
  rows: ScenarioConditionEvaluationResponse[],
  conditions: ScenarioDecisionCondition[],
  fallbackRole: ScenarioDecisionConditionRole,
  context: ScenarioConditionEvaluationContext,
): void {
  for (const [index, condition] of conditions.entries()) {
    const role = condition.role ?? fallbackRole;
    const label = condition.label ?? conditionLabel(condition);
    const evaluation = evaluateScenarioCondition(condition, context);
    const status = conditionStatus(role, conditionResultFromEvaluation(evaluation));
    rows.push({
      id:
        condition.id ??
        `decision_${role}_${index}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      label,
      role,
      type: condition.type,
      status,
      reason: conditionReason(role, status, evaluation.reason),
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

function latestEventRecord(events: JsonRecord[]): JsonRecord | null {
  return [...events].sort(
    (left, right) =>
      String(right.event_time ?? '').localeCompare(String(left.event_time ?? '')) ||
      eventPriority(right.event_type) - eventPriority(left.event_type) ||
      String(right.id ?? '').localeCompare(String(left.id ?? '')),
  )[0] ?? null;
}

function eventPriority(eventType: unknown): number {
  if (
    eventType === 'scenario.invalidated' ||
    eventType === 'scenario.triggered' ||
    eventType === 'scenario.expired' ||
    eventType === 'scenario.overextended'
  ) {
    return 3;
  }
  if (eventType === 'scenario.target_hit') {
    return 2;
  }
  if (
    eventType === 'scenario.condition_passed' ||
    eventType === 'scenario.condition_failed'
  ) {
    return 1;
  }
  return 0;
}

function liveStateFromSnapshot(
  snapshot: JsonRecord | null,
): ScenarioLiveStateResponse | null {
  const state = recordValue(snapshot?.state ?? snapshot?.state_json);
  return state.version === 'scenario_live_state.v1'
    ? (state as unknown as ScenarioLiveStateResponse)
    : null;
}

function scenarioLiveStateSnapshotId(state: ScenarioLiveStateResponse): string {
  return `scenario_live_state_${createHash('sha256')
    .update(`${state.workspace_id}:${state.scenario_id}:${state.evaluated_at}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function stateSourceHash(state: ScenarioLiveStateResponse): string {
  return createHash('sha256')
    .update(JSON.stringify({
      scenario_id: state.scenario_id,
      trigger_status: state.trigger_status,
      validity_status: state.validity_status,
      condition_evaluations: state.condition_evaluations.map((condition) => ({
        id: condition.id,
        status: condition.status,
      })),
      target_progress: state.target_progress.map((target) => ({
        label: target.label,
        status: target.status,
      })),
    }))
    .digest('hex')
    .slice(0, 16);
}

function currentPlaybook(
  playbook: JsonRecord | null,
  scenario: ReturnType<typeof toScenarioResponse>,
): TradePlaybookResponse | null {
  if (!playbook) {
    return null;
  }
  return evaluateTradePlaybookFreshness(toTradePlaybookResponse(playbook), {
    scenario: scenario.payload,
    decisionPlaybook: scenario.decision_playbook,
    recommendation: scenario.scenario_recommendation,
    runtimeDecision: scenario.runtime_decision,
  });
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
  fallbackReason: string,
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
  return fallbackReason;
}

function conditionResultFromEvaluation(
  evaluation: {
    status: 'passed' | 'failed' | 'pending' | 'unknown';
  },
): 'matched' | 'failed' | 'unknown' {
  if (evaluation.status === 'passed') {
    return 'matched';
  }
  if (evaluation.status === 'failed') {
    return 'failed';
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
