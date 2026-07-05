import type { SimulationDetailResponse, ExecutionEventResponse } from '../paper-execution/paper-execution.types';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import type {
  ScenarioChartProjectionResponse,
  VisualOpportunityProjectionV1,
  VisualOverlayStatusV1,
  VisualOverlayV1,
  VisualPointV1,
} from './scenario-chart.types';

type VisualProjectionInput = {
  chart: Omit<ScenarioChartProjectionResponse, 'visual_projection'>;
  playbook: TradePlaybookResponse | null;
  simulation?: SimulationDetailResponse | null;
};

export function buildVisualOpportunityProjection(
  input: VisualProjectionInput,
): VisualOpportunityProjectionV1 {
  const { chart, simulation } = input;
  const playbook = simulation?.playbook_snapshot ?? input.playbook;
  const warnings = uniqueStrings([
    ...chart.warnings,
    ...(playbook?.compile_warnings ?? []),
    ...(playbook?.stale_reasons ?? []),
  ]);
  const startTime = chart.candles[0]?.time ?? chart.generated_at;
  const endTime =
    chart.candles[chart.candles.length - 1]?.time ??
    simulation?.setup_expiry_at ??
    chart.generated_at;
  const currentPrice = chart.live_state.current_price;
  const overlays: VisualOverlayV1[] = [];
  const labels: VisualOpportunityProjectionV1['labels'] = [];

  if (!playbook) {
    warnings.push('missing_trade_playbook');
    addCurrentPrice(overlays, chart, startTime, endTime);
    return baseProjection({
      chart,
      simulation,
      side: 'neutral',
      kind: 'watch_setup',
      status: 'watching',
      overlays,
      labels,
      warnings,
      playbook: null,
    });
  }

  const side = playbook.direction === 'short'
    ? 'short'
    : playbook.direction === 'long'
      ? 'long'
      : 'neutral';
  const entry = entryGeometry(playbook);
  const riskExit = numberValue(simulation?.assumptions.risk_exit.level) ??
    numberValue(playbook.invalidation.level);
  const firstTarget = firstNumericTarget(playbook);
  const chartable =
    side !== 'neutral' &&
    entry.reference !== null &&
    riskExit !== null &&
    firstTarget !== null;

  if (!chartable) {
    warnings.push('non_chartable_trade_playbook');
    addCurrentPrice(overlays, chart, startTime, endTime);
    labels.push({
      id: `${chart.scenario_id}:not_chartable`,
      text: 'Narrative checkpoint',
      point: currentPrice === null ? null : { time: endTime, price: currentPrice },
      source_ref: { type: 'trade_playbook', id: playbook.id, field: 'direction' },
    });
    return baseProjection({
      chart,
      simulation,
      side: 'neutral',
      kind: 'narrative_checkpoint',
      status: 'not_chartable',
      overlays,
      labels,
      warnings,
      playbook,
    });
  }

  if (entry.zone) {
    overlays.push({
      type: 'zone',
      id: `${playbook.id}:visual-entry-zone`,
      role: 'entry',
      price_low: entry.zone.low,
      price_high: entry.zone.high,
      time_start: startTime,
      time_end: endTime,
      label: playbook.entry.condition || 'Entry area',
      opacity: 0.18,
      status: entryStatus(simulation),
      source_ref: { type: 'trade_playbook', id: playbook.id, field: 'entry' },
    });
  } else if (entry.reference !== null) {
    overlays.push(lineOverlay({
      id: `${playbook.id}:visual-entry`,
      role: 'entry',
      price: entry.reference,
      startTime,
      endTime,
      label: playbook.entry.condition || 'Entry',
      status: entryStatus(simulation),
      sourceRef: { type: 'trade_playbook', id: playbook.id, field: 'entry.level' },
    }));
  }

  overlays.push(lineOverlay({
    id: `${playbook.id}:visual-risk-exit`,
    role: 'risk_exit',
    price: riskExit,
    startTime,
    endTime,
    label: playbook.invalidation.condition || 'Risk exit',
    status: riskExitStatus(simulation),
    sourceRef: { type: 'trade_playbook', id: playbook.id, field: 'invalidation.level' },
  }));
  overlays.push(lineOverlay({
    id: `${playbook.id}:visual-target-0`,
    role: 'target',
    price: firstTarget.level,
    startTime,
    endTime,
    label: firstTarget.label,
    status: targetStatus(simulation),
    sourceRef: { type: 'trade_playbook', id: playbook.id, field: 'targets.0.level' },
  }));
  addCurrentPrice(overlays, chart, startTime, endTime);

  const entryReference = numberValue(simulation?.position?.average_entry_price) ??
    entry.reference;
  addRiskRewardBoxes({
    overlays,
    playbook,
    side,
    entryReference,
    riskExit,
    target: firstTarget.level,
    startTime,
    endTime,
    warnings,
  });
  addSetupPath({
    overlays,
    chart,
    playbook,
    currentPrice,
    entryReference,
    target: firstTarget.level,
    endTime,
  });
  addExpiryOverlay(overlays, simulation, chart, startTime);
  addSimulationMarkers(overlays, simulation);

  return baseProjection({
    chart,
    simulation,
    side,
    kind: 'trade_setup',
    status: opportunityStatus(simulation),
    overlays,
    labels,
    warnings,
    playbook,
  });
}

function baseProjection(input: {
  chart: Omit<ScenarioChartProjectionResponse, 'visual_projection'>;
  simulation?: SimulationDetailResponse | null;
  side: VisualOpportunityProjectionV1['opportunity']['side'];
  kind: VisualOpportunityProjectionV1['opportunity']['kind'];
  status: VisualOpportunityProjectionV1['opportunity']['status'];
  overlays: VisualOverlayV1[];
  labels: VisualOpportunityProjectionV1['labels'];
  warnings: string[];
  playbook: TradePlaybookResponse | null;
}): VisualOpportunityProjectionV1 {
  return {
    schema_version: 'visual_opportunity_projection.v1',
    id: `${input.chart.scenario_id}:visual_opportunity`,
    workspace_id: input.chart.workspace_id,
    scenario_id: input.chart.scenario_id,
    thesis_id: input.chart.thesis_id,
    symbol: input.chart.symbol,
    timeframe: input.chart.interval,
    generated_at: input.chart.generated_at,
    source_versions: {
      trade_playbook_id: input.playbook?.id ?? null,
      trade_playbook_hash: input.simulation?.source_hashes.trade_playbook ?? null,
      simulation_run_id: input.simulation?.id ?? null,
      scenario_chart_projection_hash: null,
      scenario_chart_generated_at: input.chart.generated_at,
      technical_pattern_snapshot_id: null,
    },
    opportunity: {
      kind: input.kind,
      side: input.side,
      status: input.status,
      confidence: input.chart.live_state.recommended_action === 'review'
        ? undefined
        : confidenceFromStatus(input.chart.live_state.trigger_status),
      stale_reasons: uniqueStrings([
        ...input.chart.source_versions.stale_reasons,
        ...(input.playbook?.stale_reasons ?? []),
      ]),
    },
    overlays: input.overlays,
    labels: input.labels,
    warnings: uniqueStrings(input.warnings),
  };
}

function addRiskRewardBoxes(input: {
  overlays: VisualOverlayV1[];
  playbook: TradePlaybookResponse;
  side: 'long' | 'short';
  entryReference: number | null;
  riskExit: number;
  target: number;
  startTime: string;
  endTime: string;
  warnings: string[];
}): void {
  const { entryReference, riskExit, target } = input;
  if (entryReference === null) {
    input.warnings.push('missing_entry_reference_price');
    return;
  }
  const saneLong = input.side === 'long' && riskExit < entryReference && target > entryReference;
  const saneShort = input.side === 'short' && riskExit > entryReference && target < entryReference;
  if (!saneLong && !saneShort) {
    input.warnings.push('invalid_risk_reward_geometry');
    return;
  }
  input.overlays.push({
    type: 'box',
    id: `${input.playbook.id}:risk-box`,
    role: 'risk_box',
    time_start: input.startTime,
    time_end: input.endTime,
    price_low: Math.min(entryReference, riskExit),
    price_high: Math.max(entryReference, riskExit),
    label: 'Risk box',
    status: 'active',
    source_ref: { type: 'trade_playbook', id: input.playbook.id, field: 'invalidation.level' },
  });
  input.overlays.push({
    type: 'box',
    id: `${input.playbook.id}:reward-box`,
    role: 'reward_box',
    time_start: input.startTime,
    time_end: input.endTime,
    price_low: Math.min(entryReference, target),
    price_high: Math.max(entryReference, target),
    label: 'Reward box',
    status: 'active',
    source_ref: { type: 'trade_playbook', id: input.playbook.id, field: 'targets.0.level' },
  });
}

function addSetupPath(input: {
  overlays: VisualOverlayV1[];
  chart: Omit<ScenarioChartProjectionResponse, 'visual_projection'>;
  playbook: TradePlaybookResponse;
  currentPrice: number | null;
  entryReference: number | null;
  target: number;
  endTime: string;
}): void {
  if (input.currentPrice === null || input.entryReference === null) {
    return;
  }
  const startTime = input.chart.candles[0]?.time ?? input.chart.generated_at;
  const midTime = input.chart.candles[Math.max(0, Math.floor(input.chart.candles.length / 2))]?.time ??
    input.endTime;
  input.overlays.push({
    type: 'path',
    id: `${input.playbook.id}:setup-path`,
    role: 'setup_path',
    path_semantics: 'planned_setup_path',
    points: [
      { time: startTime, price: input.currentPrice },
      { time: midTime, price: input.entryReference },
      { time: input.endTime, price: input.target },
    ],
    arrow_end: true,
    label: 'Planned setup path',
    confidence: input.chart.live_state.trigger_status === 'triggered' ? 0.75 : 0.5,
    source_ref: { type: 'trade_playbook', id: input.playbook.id, field: 'entry' },
  });
}

function addCurrentPrice(
  overlays: VisualOverlayV1[],
  chart: Omit<ScenarioChartProjectionResponse, 'visual_projection'>,
  startTime: string,
  endTime: string,
): void {
  if (chart.live_state.current_price === null) {
    return;
  }
  overlays.push(lineOverlay({
    id: `${chart.scenario_id}:visual-current-price`,
    role: 'current_price',
    price: chart.live_state.current_price,
    startTime,
    endTime,
    label: 'Current price',
    status: 'active',
    sourceRef: { type: 'scenario_chart_projection', id: chart.scenario_id, field: 'live_state.current_price' },
  }));
}

function addExpiryOverlay(
  overlays: VisualOverlayV1[],
  simulation: SimulationDetailResponse | null | undefined,
  chart: Omit<ScenarioChartProjectionResponse, 'visual_projection'>,
  startTime: string,
): void {
  if (!simulation?.setup_expiry_at || hasEvent(simulation, 'setup_expired')) {
    return;
  }
  const price = chart.live_state.current_price ??
    numberValue(simulation.position?.average_entry_price);
  if (price === null) {
    return;
  }
  overlays.push({
    type: 'marker',
    id: `${simulation.id}:setup-expiry`,
    role: 'expiry',
    point: { time: simulation.setup_expiry_at, price },
    label: 'Setup expiry',
    status: 'active',
    source_ref: { type: 'simulation_run', id: simulation.id, field: 'setup_expiry_at' },
  });
  overlays.push({
    type: 'box',
    id: `${simulation.id}:expiry-window`,
    role: 'expiry',
    time_start: startTime,
    time_end: simulation.setup_expiry_at,
    price_low: price,
    price_high: price,
    label: 'Setup validity window',
    status: 'active',
    source_ref: { type: 'simulation_run', id: simulation.id, field: 'setup_expiry_at' },
  });
}

function addSimulationMarkers(
  overlays: VisualOverlayV1[],
  simulation: SimulationDetailResponse | null | undefined,
): void {
  if (!simulation) {
    return;
  }
  for (const event of simulation.events) {
    const role = simulationMarkerRole(event);
    const price = numberValue(event.price) ??
      numberValue(simulation.position?.average_entry_price);
    if (!role || !event.market_time || price === null) {
      continue;
    }
    overlays.push({
      type: 'marker',
      id: event.id,
      role,
      point: { time: event.market_time, price },
      label: simulationEventLabel(event),
      event_id: event.id,
      status: simulationEventStatus(event),
      source_ref: { type: 'execution_event', id: event.id, field: 'event_type' },
    });
  }
}

function lineOverlay(input: {
  id: string;
  role: Extract<VisualOverlayV1, { type: 'line' }>['role'];
  price: number;
  startTime: string;
  endTime: string;
  label: string;
  status: VisualOverlayStatusV1;
  sourceRef: Extract<VisualOverlayV1, { type: 'line' }>['source_ref'];
}): Extract<VisualOverlayV1, { type: 'line' }> {
  return {
    type: 'line',
    id: input.id,
    role: input.role,
    points: [
      { time: input.startTime, price: input.price },
      { time: input.endTime, price: input.price },
    ],
    label: input.label,
    style: input.role === 'current_price' ? 'solid' : 'dashed',
    status: input.status,
    source_ref: input.sourceRef,
  };
}

function entryGeometry(playbook: TradePlaybookResponse): {
  reference: number | null;
  zone: { low: number; high: number } | null;
} {
  const low = numberValue(playbook.entry.zone_low);
  const high = numberValue(playbook.entry.zone_high);
  if (low !== null && high !== null) {
    return {
      reference: (low + high) / 2,
      zone: { low: Math.min(low, high), high: Math.max(low, high) },
    };
  }
  const level = numberValue(playbook.entry.level);
  return { reference: level, zone: null };
}

function firstNumericTarget(
  playbook: TradePlaybookResponse,
): { label: string; level: number } | null {
  for (const target of playbook.targets) {
    const level = numberValue(target.level);
    if (level !== null) {
      return { label: target.label || 'Target', level };
    }
  }
  return null;
}

function opportunityStatus(
  simulation?: SimulationDetailResponse | null,
): VisualOpportunityProjectionV1['opportunity']['status'] {
  if (!simulation) {
    return 'waiting_entry';
  }
  if (simulation.status === 'cancelled') return 'cancelled';
  if (simulation.status === 'failed') return 'blocked';
  if (simulation.status === 'waiting_for_trigger' || simulation.status === 'created') {
    return 'waiting_entry';
  }
  if (simulation.status === 'entry_triggered' || simulation.status === 'order_pending') {
    return 'entry_touched';
  }
  if (simulation.status === 'position_open') return 'open';
  if (simulation.outcome?.close_reason === 'target') return 'target_hit';
  if (
    simulation.outcome?.close_reason === 'stop' ||
    simulation.outcome?.close_reason === 'thesis_invalidation'
  ) {
    return 'risk_exit_hit';
  }
  if (simulation.outcome?.close_reason === 'setup_expiry') return 'expired';
  return simulation.position?.status === 'closed' ? 'blocked' : 'waiting_entry';
}

function entryStatus(simulation?: SimulationDetailResponse | null): VisualOverlayStatusV1 {
  return simulation?.events.some((event) =>
    ['entry_zone_entered', 'entry_condition_confirmed', 'paper_order_filled', 'position_opened'].includes(event.event_type))
    ? 'passed'
    : 'active';
}

function riskExitStatus(simulation?: SimulationDetailResponse | null): VisualOverlayStatusV1 {
  return simulation?.events.some((event) =>
    event.event_type === 'stop_hit' || event.event_type === 'invalidation_hit')
    ? 'failed'
    : 'active';
}

function targetStatus(simulation?: SimulationDetailResponse | null): VisualOverlayStatusV1 {
  return simulation?.events.some((event) =>
    event.event_type === 'target_hit' ||
    event.event_type === 'position_partially_closed' ||
    (event.event_type === 'position_closed' && event.reason_code === 'target'))
    ? 'passed'
    : 'active';
}

function simulationMarkerRole(
  event: ExecutionEventResponse,
): Extract<VisualOverlayV1, { type: 'marker' }>['role'] | null {
  if (event.event_type === 'paper_order_filled' || event.event_type === 'position_opened') {
    return 'paper_fill';
  }
  if (
    event.event_type === 'target_hit' ||
    event.event_type === 'position_partially_closed' ||
    event.event_type === 'stop_hit' ||
    event.event_type === 'invalidation_hit' ||
    event.event_type === 'position_closed'
  ) {
    return 'paper_exit';
  }
  if (event.event_type === 'setup_expired') {
    return 'expiry';
  }
  return null;
}

function simulationEventStatus(event: ExecutionEventResponse): VisualOverlayStatusV1 {
  if (
    event.event_type === 'target_hit' ||
    event.event_type === 'position_partially_closed' ||
    (event.event_type === 'position_closed' && event.reason_code === 'target')
  ) {
    return 'passed';
  }
  if (
    event.event_type === 'stop_hit' ||
    event.event_type === 'invalidation_hit' ||
    (event.event_type === 'position_closed' &&
      (event.reason_code === 'stop' || event.reason_code === 'thesis_invalidation'))
  ) {
    return 'failed';
  }
  if (event.event_type === 'setup_expired') {
    return 'blocked';
  }
  return 'active';
}

function simulationEventLabel(event: ExecutionEventResponse): string {
  if (event.event_type === 'paper_order_filled') return 'Paper fill';
  if (event.event_type === 'position_opened') return 'Paper open';
  if (event.event_type === 'target_hit') return 'Target hit';
  if (event.event_type === 'position_partially_closed') return 'Partial target';
  if (event.event_type === 'stop_hit') return 'Risk exit hit';
  if (event.event_type === 'invalidation_hit') return 'Invalidation hit';
  if (event.event_type === 'setup_expired') return 'Setup expired';
  if (event.event_type === 'position_closed') return 'Paper exit';
  return event.reason_code || event.event_type;
}

function hasEvent(
  simulation: SimulationDetailResponse,
  eventType: ExecutionEventResponse['event_type'],
): boolean {
  return simulation.events.some((event) => event.event_type === eventType);
}

function confidenceFromStatus(
  status: string,
): number | undefined {
  if (status === 'triggered') return 0.8;
  if (status === 'near_trigger') return 0.65;
  if (status === 'watching') return 0.5;
  return undefined;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
