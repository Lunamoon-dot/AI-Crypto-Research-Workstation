import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  MarketChartInterval,
  MarketOhlcvResponse,
  MarketOhlcvService,
} from '../market-data/market-ohlcv.service';
import {
  toScenarioResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { playbookSourceHashes } from '../playbooks/playbook-source-hash';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionPlaybook,
} from './scenario-decision.types';
import type {
  ScenarioChartOverlay,
  ScenarioChartProjectionResponse,
  ScenarioConditionEvaluationResponse,
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
} from './scenario-chart.types';
import { ScenarioLiveStateService } from './scenario-live-state.service';

@Injectable()
export class ScenarioChartProjectionService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly ohlcv: MarketOhlcvService,
    private readonly liveState: ScenarioLiveStateService,
  ) {}

  async getProjection(input: {
    scenarioId: string;
    workspaceId: string;
    interval?: string;
    limit?: string;
  }): Promise<ScenarioChartProjectionResponse> {
    const scenario = await this.journal.getScenario(
      input.scenarioId,
      input.workspaceId,
    );
    if (!scenario) {
      throw new NotFoundException('Scenario not found.');
    }
    const payload = recordValue(scenario.payload ?? scenario.payload_json);
    const thesisId = stringValue(scenario.thesis_id);
    const thesis = thesisId
      ? await this.journal.getThesis(thesisId, input.workspaceId)
      : null;
    const symbol = stringValue(thesis?.symbol ?? scenario.symbol ?? payload.symbol);
    const marketType = marketTypeValue(thesis?.market_type ?? scenario.market_type);
    const liveState = await this.liveState.getLiveState(
      input.scenarioId,
      input.workspaceId,
    );
    const scenarioResponse = toScenarioResponse(scenario, thesis);
    const rawPlaybooks = await this.journal.listTradePlaybooksForScenario(
      input.scenarioId,
      input.workspaceId,
    );
    const latestPlaybook = currentPlaybook(rawPlaybooks[0] ?? null, scenarioResponse);
    const events = await this.journal.listScenarioEvents(
      input.scenarioId,
      input.workspaceId,
      50,
    );
    const candles = symbol
      ? await this.ohlcv.getOhlcv({
          workspaceId: input.workspaceId,
          symbol,
          marketType,
          interval: input.interval,
          limit: input.limit,
        })
      : emptyOhlcv(input.workspaceId, marketType, chartIntervalValue(input.interval));
    return buildScenarioChartProjection({
      workspaceId: input.workspaceId,
      scenarioId: input.scenarioId,
      thesisId,
      symbol,
      marketType,
      decisionPlaybook: scenarioResponse.decision_playbook,
      latestPlaybook,
      liveState,
      ohlcv: candles,
      events,
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
  latestPlaybook: TradePlaybookResponse | null;
  liveState: ScenarioLiveStateResponse;
  ohlcv: MarketOhlcvResponse;
  events: JsonRecord[];
}): ScenarioChartProjectionResponse {
  const currentTradePlaybook =
    input.latestPlaybook?.status === 'current' ? input.latestPlaybook : null;
  const overlays: ScenarioChartOverlay[] = [
    ...decisionPlaybookOverlays(
      input.decisionPlaybook,
      input.liveState.condition_evaluations,
    ),
    ...tradePlaybookOverlays(currentTradePlaybook, input.liveState),
    ...currentPriceOverlay(input.liveState),
    ...eventOverlays(input.events),
  ];
  const warnings = [
    input.ohlcv.warning,
    input.ohlcv.candles.length === 0 ? 'candles_unavailable' : null,
    input.latestPlaybook && input.latestPlaybook.status !== 'current'
      ? `trade_playbook_${input.latestPlaybook.status}`
      : null,
    ...(input.latestPlaybook?.stale_reasons ?? []),
  ].filter((warning): warning is string => Boolean(warning));
  return {
    version: 'scenario_chart_projection.v1',
    workspace_id: input.workspaceId,
    scenario_id: input.scenarioId,
    thesis_id: input.thesisId,
    mode: currentTradePlaybook ? 'trade' : 'watch',
    symbol: input.symbol,
    market_type: input.marketType,
    interval: input.ohlcv.interval,
    generated_at: input.ohlcv.generated_at,
    source_versions: {
      decision_playbook_source: input.decisionPlaybook?.source ?? 'missing',
      trade_playbook_id: input.latestPlaybook?.id ?? null,
      trade_playbook_status: input.latestPlaybook?.status ?? 'missing',
    },
    candles: input.ohlcv.candles,
    overlays,
    live_state: input.liveState,
    warnings,
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
    if (condition.role === 'watch' && condition.type === 'price_in_zone') {
      const zone = zoneValue(condition);
      if (zone) {
        overlays.push({
          id: overlayId('decision_watch', condition),
          type: 'price_zone',
          role: 'watch',
          source: 'decision_playbook',
          price_low: zone.low,
          price_high: zone.high,
          label: condition.label ?? 'Watch zone',
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

function marketTypeValue(value: unknown): 'spot' | 'perp' {
  return value === 'perp' ? 'perp' : 'spot';
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
