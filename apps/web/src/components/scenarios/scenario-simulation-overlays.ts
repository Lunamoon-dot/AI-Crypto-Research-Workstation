import type {
  ExecutionEventResponse,
  JsonRecord,
  ScenarioChartOverlay,
  SimulationDetailResponse,
} from '@/types';

export function buildSimulationOverlays(
  simulation: SimulationDetailResponse | null,
): ScenarioChartOverlay[] {
  if (!simulation) {
    return [];
  }
  const overlays: ScenarioChartOverlay[] = [];
  const hitTargetIndexes = targetIndexesForHitEvents(simulation.events);
  const hasEntryProgress = simulation.events.some((event) =>
    [
      'entry_zone_entered',
      'entry_condition_confirmed',
      'paper_order_created',
      'paper_order_filled',
      'position_opened',
    ].includes(event.event_type));
  const hasStopOrInvalidationHit = simulation.events.some((event) =>
    event.event_type === 'stop_hit' || event.event_type === 'invalidation_hit');

  const plannedEntry = simulation.playbook_snapshot.entry;
  const entryLow = decimalNumber(plannedEntry.zone_low);
  const entryHigh = decimalNumber(plannedEntry.zone_high);
  const entryLevel = decimalNumber(plannedEntry.level);
  if (entryLow !== null && entryHigh !== null) {
    overlays.push({
      id: `${simulation.id}-paper-entry-zone`,
      type: 'price_zone',
      role: 'entry',
      source: 'trade_playbook',
      price_low: Math.min(entryLow, entryHigh),
      price_high: Math.max(entryLow, entryHigh),
      label: 'Paper entry zone',
      status: hasEntryProgress ? 'passed' : 'active',
    });
  } else if (entryLevel !== null) {
    overlays.push({
      id: `${simulation.id}-paper-entry-plan`,
      type: 'horizontal_line',
      role: 'entry',
      source: 'trade_playbook',
      price: entryLevel,
      label: 'Paper entry',
      status: hasEntryProgress ? 'passed' : 'active',
    });
  }

  const riskExitPrice =
    assumptionLevel(simulation.assumptions, 'risk_exit') ??
    decimalNumber(simulation.playbook_snapshot.invalidation.level);
  if (riskExitPrice !== null) {
    overlays.push({
      id: `${simulation.id}-paper-stop`,
      type: 'horizontal_line',
      role: 'invalidation',
      source: 'runtime',
      price: riskExitPrice,
      label: 'Paper stop',
      status: hasStopOrInvalidationHit ? 'failed' : 'active',
    });
  }

  const thesisInvalidationPrice = assumptionLevel(
    simulation.assumptions,
    'thesis_invalidation',
  );
  if (
    thesisInvalidationPrice !== null &&
    (riskExitPrice === null || !samePrice(thesisInvalidationPrice, riskExitPrice))
  ) {
    overlays.push({
      id: `${simulation.id}-thesis-invalidation`,
      type: 'horizontal_line',
      role: 'invalidation',
      source: 'runtime',
      price: thesisInvalidationPrice,
      label: 'Thesis invalidation',
      status: hasStopOrInvalidationHit ? 'failed' : 'active',
    });
  }

  simulation.playbook_snapshot.targets.forEach((target, index) => {
    const targetPrice = decimalNumber(target.level);
    if (targetPrice === null) {
      return;
    }
    overlays.push({
      id: `${simulation.id}-paper-target-${index}`,
      type: 'horizontal_line',
      role: 'target',
      source: 'trade_playbook',
      price: targetPrice,
      label: targetLabel(target.label, index),
      status: hitTargetIndexes.has(index) ? 'passed' : 'active',
    });
  });

  const entryPrice = decimalNumber(simulation.position?.average_entry_price);
  if (entryPrice !== null) {
    overlays.push({
      id: `${simulation.id}-paper-entry`,
      type: 'horizontal_line',
      role: 'entry',
      source: 'runtime',
      price: entryPrice,
      label: 'Paper avg entry',
      status: simulation.position?.status === 'closed' ? 'passed' : 'active',
    });
  }

  if (simulation.setup_expiry_at && !hasSetupExpiredEvent(simulation.events)) {
    overlays.push({
      id: `${simulation.id}-setup-expiry`,
      type: 'event_marker',
      role: 'event',
      source: 'runtime',
      time: simulation.setup_expiry_at,
      price: null,
      label: 'Setup expiry',
      status: 'active',
    });
  }

  for (const event of simulation.events) {
    if (!event.market_time || !isSimulationMarkerEvent(event.event_type)) {
      continue;
    }
    overlays.push({
      id: event.id,
      type: 'event_marker',
      role: 'event',
      source: 'runtime',
      time: event.market_time,
      price: decimalNumber(event.price),
      label: simulationEventLabel(event),
      status: simulationEventStatus(event),
    });
  }
  return overlays;
}

function targetIndexesForHitEvents(events: ExecutionEventResponse[]): Set<number> {
  const indexes = new Set<number>();
  for (const event of events) {
    if (
      event.target_index !== null &&
      (event.event_type === 'target_hit' ||
        event.event_type === 'position_partially_closed' ||
        (event.event_type === 'position_closed' && event.reason_code === 'target'))
    ) {
      indexes.add(event.target_index);
    }
  }
  return indexes;
}

function hasSetupExpiredEvent(events: ExecutionEventResponse[]): boolean {
  return events.some((event) => event.event_type === 'setup_expired');
}

function isSimulationMarkerEvent(eventType: string): boolean {
  return [
    'entry_zone_entered',
    'paper_order_filled',
    'position_opened',
    'target_hit',
    'position_partially_closed',
    'stop_hit',
    'invalidation_hit',
    'setup_expired',
    'position_timeout_hit',
    'data_end_reached',
    'position_closed',
    'simulation_cancelled',
    'simulation_failed',
  ].includes(eventType);
}

function simulationEventLabel(event: ExecutionEventResponse): string {
  const { event_type: eventType, reason_code: reasonCode } = event;
  if (eventType === 'position_opened') return 'Paper open';
  if (eventType === 'position_closed') return `Paper close: ${titleCase(reasonCode)}`;
  if (eventType === 'position_partially_closed') {
    const target = targetDescriptor(event.target_index);
    return target ? `Partial close: ${target}` : 'Partial close';
  }
  if (eventType === 'target_hit') {
    const target = targetDescriptor(event.target_index);
    return target ? `${titleCase(target)} hit` : 'Target hit';
  }
  if (eventType === 'stop_hit') {
    return reasonCode === 'ambiguous_intrabar' ? 'Ambiguous candle' : 'Stop hit';
  }
  if (eventType === 'invalidation_hit') return 'Invalidation hit';
  if (eventType === 'setup_expired') return 'Setup expired';
  if (eventType === 'position_timeout_hit') return 'Position timeout';
  if (eventType === 'data_end_reached') return 'Data end';
  if (eventType === 'simulation_cancelled') return 'Simulation cancelled';
  if (eventType === 'simulation_failed') return 'Simulation failed';
  if (eventType === 'paper_order_filled') return 'Paper fill';
  return titleCase(reasonCode || eventType);
}

function simulationEventStatus(event: ExecutionEventResponse): ScenarioChartOverlay['status'] {
  const { event_type: eventType, reason_code: reasonCode } = event;
  if (
    eventType === 'target_hit' ||
    eventType === 'position_partially_closed' ||
    (eventType === 'position_closed' && reasonCode === 'target')
  ) {
    return 'passed';
  }
  if (
    eventType === 'stop_hit' ||
    eventType === 'invalidation_hit' ||
    eventType === 'simulation_cancelled' ||
    eventType === 'simulation_failed' ||
    (eventType === 'position_closed' &&
      (reasonCode === 'stop' || reasonCode === 'thesis_invalidation'))
  ) {
    return 'failed';
  }
  if (
    eventType === 'setup_expired' ||
    eventType === 'position_timeout_hit' ||
    eventType === 'data_end_reached' ||
    reasonCode === 'ambiguous_intrabar'
  ) {
    return 'blocked';
  }
  return 'active';
}

function targetLabel(rawLabel: string, index: number): string {
  const label = rawLabel.trim();
  return label ? `Paper ${label}` : `Paper target ${index + 1}`;
}

function targetDescriptor(targetIndex: number | null): string | null {
  if (targetIndex === null) {
    return null;
  }
  return `target ${targetIndex + 1}`;
}

function titleCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function decimalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assumptionLevel(assumptions: JsonRecord, key: string): number | null {
  const value = assumptions[key];
  if (!isRecord(value)) {
    return null;
  }
  return decimalNumber(value.level as string | number | null | undefined);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function samePrice(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.00000001;
}
