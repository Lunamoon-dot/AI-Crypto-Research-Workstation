import { Injectable } from '@nestjs/common';
import { JsonRecord } from '../database/journal.types';
import {
  MarketChartInterval,
  MarketOhlcvResponse,
  MarketOhlcvService,
} from '../market-data/market-ohlcv.service';
import {
  toScenarioResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { evaluateTradePlaybookFreshness } from '../playbooks/playbook-freshness';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import type { SimulationDetailResponse } from '../paper-execution/paper-execution.types';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionPlaybook,
  ScenarioRecommendation,
} from './scenario-decision.types';
import { tradePlaybookRequiresSequencedSetup } from './sequenced-setup-guard';
import { ScenarioContextLoaderService } from './scenario-context-loader.service';
import type {
  ScenarioChartOverlay,
  ScenarioChartProjectionResponse,
  ScenarioConditionEvaluationResponse,
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
} from './scenario-chart.types';
import { ScenarioLiveStateService } from './scenario-live-state.service';
import { buildVisualOpportunityProjection } from './visual-opportunity-projection';

@Injectable()
export class ScenarioChartProjectionService {
  constructor(
    private readonly contextLoader: ScenarioContextLoaderService,
    private readonly ohlcv: MarketOhlcvService,
    private readonly liveState: ScenarioLiveStateService,
  ) {}

  async getProjection(input: {
    scenarioId: string;
    workspaceId: string;
    interval?: string;
    limit?: string;
    simulation?: SimulationDetailResponse | null;
  }): Promise<ScenarioChartProjectionResponse> {
    const context = await this.contextLoader.load({
      scenarioId: input.scenarioId,
      workspaceId: input.workspaceId,
      eventLimit: 50,
    });
    const liveState = await this.liveState.getLiveStateFromContext(context);
    const scenarioResponse = toScenarioResponse(context.scenario, context.thesis);
    const latestPlaybook = currentPlaybook(
      context.playbooks[0] ?? null,
      scenarioResponse,
    );
    const candles = context.symbol
      ? await this.ohlcv.getOhlcv({
          workspaceId: input.workspaceId,
          symbol: context.symbol,
          marketType: context.marketType,
          interval: input.interval,
          limit: input.limit,
        })
      : emptyOhlcv(
          input.workspaceId,
          context.marketType,
          chartIntervalValue(input.interval),
        );
    return buildScenarioChartProjection({
      scenarioId: input.scenarioId,
      workspaceId: input.workspaceId,
      thesisId: context.thesisId,
      symbol: context.symbol,
      marketType: context.marketType,
      decisionPlaybook: scenarioResponse.decision_playbook,
      scenarioRecommendation: scenarioResponse.scenario_recommendation,
      latestPlaybook,
      liveState,
      ohlcv: candles,
      events: context.events,
      simulation: input.simulation ?? null,
    });
  }
}

function buildScenarioChartProjection(input: {
  workspaceId: string;
  scenarioId: string;
  thesisId: string;
  symbol: string;
  marketType: 'spot' | 'perp';
  decisionPlaybook: ScenarioDecisionPlaybook | null;
  scenarioRecommendation: ScenarioRecommendation | null;
  latestPlaybook: TradePlaybookResponse | null;
  liveState: ScenarioLiveStateResponse;
  ohlcv: MarketOhlcvResponse;
  events: JsonRecord[];
  simulation: SimulationDetailResponse | null;
}): ScenarioChartProjectionResponse {
  const currentTradePlaybook =
    input.latestPlaybook?.status === 'current' ? input.latestPlaybook : null;
  const chartDecisionPlaybook =
    input.decisionPlaybook ?? playbookFromRecommendation(input.scenarioRecommendation);
  const enabledTradePlaybook =
    currentTradePlaybook &&
    !tradePlaybookRequiresSequencedSetup(currentTradePlaybook, chartDecisionPlaybook)
      ? currentTradePlaybook
      : null;
  const overlays: ScenarioChartOverlay[] = [
    ...decisionPlaybookOverlays(
      chartDecisionPlaybook,
      input.liveState.condition_evaluations,
    ),
    ...tradePlaybookOverlays(enabledTradePlaybook, input.liveState),
    ...currentPriceOverlay(input.liveState),
    ...eventOverlays(input.events),
  ];
  const warnings = [
    input.ohlcv.warning,
    input.ohlcv.candles.length === 0 ? 'candles_unavailable' : null,
    input.latestPlaybook && input.latestPlaybook.status !== 'current'
      ? `trade_playbook_${input.latestPlaybook.status}`
      : null,
    currentTradePlaybook && !enabledTradePlaybook
      ? 'trade_playbook_requires_sequenced_setup'
      : null,
    ...(input.latestPlaybook?.stale_reasons ?? []),
  ].filter((warning): warning is string => Boolean(warning));
  const projectionWithoutVisual: Omit<ScenarioChartProjectionResponse, 'visual_projection'> = {
    version: 'scenario_chart_projection.v1',
    workspace_id: input.workspaceId,
    scenario_id: input.scenarioId,
    thesis_id: input.thesisId,
    mode: enabledTradePlaybook ? 'trade' : 'watch',
    symbol: input.symbol,
    market_type: input.marketType,
    interval: input.ohlcv.interval,
    generated_at: input.ohlcv.generated_at,
    source_versions: {
      decision_playbook_source: chartDecisionPlaybook?.source ?? 'missing',
      trade_playbook_id: input.latestPlaybook?.id ?? null,
      trade_playbook_status: input.latestPlaybook?.status ?? 'missing',
      stale_reasons: input.latestPlaybook?.stale_reasons ?? [],
    },
    candles: input.ohlcv.candles,
    overlays,
    live_state: input.liveState,
    warnings,
  };
  return {
    ...projectionWithoutVisual,
    visual_projection: buildVisualOpportunityProjection({
      chart: projectionWithoutVisual,
      playbook: currentTradePlaybook,
      simulation: input.simulation,
    }),
  };
}

function playbookFromRecommendation(
  recommendation: ScenarioRecommendation | null,
): ScenarioDecisionPlaybook | null {
  if (!recommendation) {
    return null;
  }
  return {
    version: 'scenario_decision_playbook.v1',
    source: recommendation.source,
    generated_at: recommendation.generated_at,
    generated_from_run_id: null,
    action_bias: recommendation.action_bias,
    confidence: recommendation.confidence,
    preferred_action_if_triggered: recommendation.action,
    fallback_action: 'wait',
    near_trigger_threshold_pct: 2,
    validity_window: {
      valid_from: recommendation.evaluation_window.starts_at,
      valid_until: recommendation.valid_until,
      timeframe: recommendation.evaluation_window.horizon,
      rationale: 'Derived from scenario recommendation for chart projection.',
      refresh_policy: 'refresh_on_next_research_run',
    },
    entry_conditions: recommendation.required_conditions.map((condition) => ({
      ...condition,
      role: condition.role ?? 'trigger',
    })),
    avoid_if: [],
    invalidation_conditions: recommendation.invalidation_conditions.map((condition) => ({
      ...condition,
      role: condition.role ?? 'invalidation',
    })),
    wait_for: recommendation.wait_for,
    risk_notes: recommendation.risk_notes,
    evidence_refs: recommendation.evidence_refs,
    rationale: recommendation.summary,
  };
}

function decisionPlaybookOverlays(
  playbook: ScenarioDecisionPlaybook | null,
  evaluations: ScenarioConditionEvaluationResponse[],
): ScenarioChartOverlay[] {
  if (!playbook) {
    return [];
  }
  const overlays: ScenarioChartOverlay[] = [];
  for (const condition of playbook.entry_conditions) {
    if (condition.type === 'price_in_zone') {
      const zone = zoneValue(condition);
      const role = zoneOverlayRole(condition.role ?? 'entry');
      if (zone && role) {
        overlays.push({
          id: overlayId(`decision_${role}`, condition),
          type: 'price_zone',
          role,
          source: 'decision_playbook',
          price_low: zone.low,
          price_high: zone.high,
          label: condition.label ?? titleForRole(role),
          status: overlayStatus(condition, evaluations),
        });
      }
      continue;
    }
    if (condition.role === 'trigger') {
      const level = nullableNumber(condition.level);
      if (level !== null) {
        overlays.push({
          id: overlayId('decision_trigger', condition),
          type: 'horizontal_line',
          role: 'trigger',
          source: 'decision_playbook',
          price: level,
          label: condition.label ?? 'Trigger',
          status: overlayStatus(condition, evaluations),
        });
      }
    }
  }
  for (const condition of playbook.invalidation_conditions) {
    if (condition.type === 'price_in_zone') {
      const zone = zoneValue(condition);
      if (zone) {
        overlays.push({
          id: overlayId('decision_invalidation', condition),
          type: 'price_zone',
          role: 'invalidation',
          source: 'decision_playbook',
          price_low: zone.low,
          price_high: zone.high,
          label: condition.label ?? 'Invalidation',
          status: overlayStatus(condition, evaluations),
        });
      }
      continue;
    }
    const level = nullableNumber(condition.level);
    if (level === null) {
      continue;
    }
    overlays.push({
      id: overlayId('decision_invalidation', condition),
      type: 'horizontal_line',
      role: 'invalidation',
      source: 'decision_playbook',
      price: level,
      label: condition.label ?? 'Invalidation',
      status: overlayStatus(condition, evaluations),
    });
  }
  for (const condition of playbook.avoid_if) {
    if (condition.type !== 'price_in_zone') {
      continue;
    }
    const zone = zoneValue(condition);
    if (!zone) {
      continue;
    }
    overlays.push({
      id: overlayId('decision_avoid', condition),
      type: 'price_zone',
      role: 'avoid',
      source: 'decision_playbook',
      price_low: zone.low,
      price_high: zone.high,
      label: condition.label ?? 'Avoid zone',
      status: overlayStatus(condition, evaluations),
    });
  }
  return overlays;
}

function tradePlaybookOverlays(
  playbook: TradePlaybookResponse | null,
  liveState: ScenarioLiveStateResponse,
): ScenarioChartOverlay[] {
  if (!playbook) {
    return [];
  }
  const overlays: ScenarioChartOverlay[] = [];
  if (playbook.entry.type === 'zone') {
    const low = nullableNumber(playbook.entry.zone_low);
    const high = nullableNumber(playbook.entry.zone_high);
    if (low !== null && high !== null) {
      overlays.push({
        id: `${playbook.id}:entry_zone`,
        type: 'price_zone',
        role: 'entry',
        source: 'trade_playbook',
        price_low: Math.min(low, high),
        price_high: Math.max(low, high),
        label: playbook.entry.condition || 'Manual entry zone',
        status: 'active',
      });
    }
  } else if (playbook.entry.level !== null) {
    overlays.push({
      id: `${playbook.id}:entry`,
      type: 'horizontal_line',
      role: 'entry',
      source: 'trade_playbook',
      price: playbook.entry.level,
      label: playbook.entry.condition || 'Manual entry',
      status: 'active',
    });
  }
  if (playbook.invalidation.level !== null) {
    overlays.push({
      id: `${playbook.id}:invalidation`,
      type: 'horizontal_line',
      role: 'invalidation',
      source: 'trade_playbook',
      price: playbook.invalidation.level,
      label: playbook.invalidation.condition || 'Manual invalidation',
      status: 'active',
    });
  }
  for (const target of playbook.targets) {
    if (target.level === null) {
      continue;
    }
    overlays.push({
      id: `${playbook.id}:target:${target.label}`,
      type: 'horizontal_line',
      role: 'target',
      source: 'trade_playbook',
      price: target.level,
      label: target.label,
      status: targetStatus(target.label, liveState),
    });
  }
  return overlays;
}

function currentPriceOverlay(
  liveState: ScenarioLiveStateResponse,
): ScenarioChartOverlay[] {
  if (liveState.current_price === null) {
    return [];
  }
  return [
    {
      id: `${liveState.scenario_id}:current_price`,
      type: 'horizontal_line',
      role: 'current_price',
      source: 'runtime',
      price: liveState.current_price,
      label: 'Current price',
      status: 'active',
    },
  ];
}

function eventOverlays(events: JsonRecord[]): ScenarioChartOverlay[] {
  return events.map((event) => {
    const eventType = stringValue(event.event_type, 'scenario.generated');
    return {
      id: stringValue(event.id),
      type: 'event_marker',
      role: 'event',
      source: 'runtime',
      time: stringValue(event.event_time),
      price: nullableNumber(recordValue(event.payload).current_price),
      label: stringValue(event.summary, eventType),
      status: eventStatus(eventType),
    };
  });
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

function overlayStatus(
  condition: ScenarioDecisionCondition,
  evaluations: ScenarioConditionEvaluationResponse[],
): ScenarioChartOverlay['status'] {
  const evaluation = condition.id
    ? evaluations.find((item) => item.id === condition.id)
    : evaluations.find((item) => item.label === (condition.label ?? conditionLabel(condition)));
  if (!evaluation) {
    return 'unknown';
  }
  if (evaluation.status === 'passed') {
    return 'passed';
  }
  if (evaluation.status === 'failed') {
    return 'failed';
  }
  if (evaluation.status === 'unknown') {
    return 'unknown';
  }
  return 'active';
}

function targetStatus(
  label: string,
  liveState: ScenarioLiveStateResponse,
): ScenarioChartOverlay['status'] {
  const target = liveState.target_progress.find((item) => item.label === label);
  if (!target) {
    return 'active';
  }
  if (target.status === 'hit') {
    return 'passed';
  }
  if (target.status === 'unknown') {
    return 'unknown';
  }
  return 'active';
}

function eventStatus(eventType: string): ScenarioChartOverlay['status'] {
  if (
    eventType === 'scenario.invalidated' ||
    eventType === 'scenario.condition_failed' ||
    eventType === 'scenario.expired' ||
    eventType === 'scenario.overextended'
  ) {
    return 'failed';
  }
  if (
    eventType === 'scenario.triggered' ||
    eventType === 'scenario.condition_passed' ||
    eventType === 'scenario.target_hit'
  ) {
    return 'passed';
  }
  return 'active';
}

function zoneValue(
  condition: ScenarioDecisionCondition,
): { low: number; high: number } | null {
  const low = nullableNumber(condition.zone_low);
  const high = nullableNumber(condition.zone_high);
  if (low === null || high === null) {
    return null;
  }
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function zoneOverlayRole(
  role: ScenarioDecisionCondition['role'],
): Extract<ScenarioChartOverlay, { type: 'price_zone' }>['role'] | null {
  if (
    role === 'watch' ||
    role === 'trigger' ||
    role === 'entry' ||
    role === 'invalidation' ||
    role === 'target' ||
    role === 'avoid'
  ) {
    return role;
  }
  return null;
}

function titleForRole(
  role: Extract<ScenarioChartOverlay, { type: 'price_zone' }>['role'],
): string {
  return `${role.charAt(0).toUpperCase()}${role.slice(1)} zone`;
}

function overlayId(prefix: string, condition: ScenarioDecisionCondition): string {
  return `${prefix}:${condition.id ?? conditionLabel(condition)}`;
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

function emptyOhlcv(
  workspaceId: string,
  marketType: 'spot' | 'perp',
  interval: MarketChartInterval,
): MarketOhlcvResponse {
  const generatedAt = new Date().toISOString();
  return {
    symbol: '',
    market_type: marketType,
    interval,
    from: generatedAt,
    to: generatedAt,
    source: 'missing_symbol',
    provider: 'local',
    generated_at: generatedAt,
    candles: [],
    warning: `No symbol is available for workspace ${workspaceId}.`,
  };
}

function chartIntervalValue(value: unknown): MarketChartInterval {
  if (
    value === '1m' ||
    value === '5m' ||
    value === '15m' ||
    value === '1h' ||
    value === '4h' ||
    value === '1d'
  ) {
    return value;
  }
  return '15m';
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
