import type {
  ScenarioChartOverlay,
  ScenarioChartProjectionResponse,
  VisualOpportunityProjectionV1,
  VisualOverlayStatusV1,
  VisualOverlayV1,
  VisualPointV1,
} from '@/types';

export type VisualOverlayShape =
  | {
      kind: 'line';
      id: string;
      role: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      label: string;
      status: VisualOverlayStatusV1;
    }
  | {
      kind: 'rect';
      id: string;
      role: string;
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
      status: VisualOverlayStatusV1;
    }
  | {
      kind: 'path';
      id: string;
      role: string;
      d: string;
      label: string;
      status: VisualOverlayStatusV1;
    }
  | {
      kind: 'marker';
      id: string;
      role: string;
      x: number;
      y: number;
      label: string;
      status: VisualOverlayStatusV1;
    };

export type VisualOverlaySummaryItem = {
  id: string;
  label: string;
  value: string;
  status: VisualOverlayStatusV1;
};

type CoordinateAdapter = {
  width: number;
  height: number;
  timeToX: (time: string) => number | null;
  priceToY: (price: number) => number | null;
};

type DensityOptions = {
  compact: boolean;
};

const DUPLICATE_LEGACY_ROLES = new Set(['current_price', 'entry', 'target']);

export function legacyOverlaysForScenarioChart(
  projection: ScenarioChartProjectionResponse | null,
  simulationOverlays: ScenarioChartOverlay[],
): ScenarioChartOverlay[] {
  if (!projection) {
    return [];
  }
  const overlays = [...projection.overlays, ...simulationOverlays];
  if (!projection.visual_projection) {
    return overlays;
  }
  const filtered = overlays.filter((overlay) => {
    if (overlay.type === 'event_marker') {
      return false;
    }
    return !DUPLICATE_LEGACY_ROLES.has(overlay.role);
  });
  return collapseSamePriceDecisionThresholds(filtered);
}

export function projectVisualOverlays(
  projection: VisualOpportunityProjectionV1,
  adapter: CoordinateAdapter,
  options: DensityOptions,
): VisualOverlayShape[] {
  const shapes: VisualOverlayShape[] = [];
  for (const overlay of projection.overlays) {
    if (isCurrentPriceOverlay(overlay)) {
      continue;
    }
    const shape = projectOverlay(overlay, adapter);
    if (shape) {
      shapes.push(shape);
    }
  }
  return options.compact ? compactShapes(shapes) : shapes;
}

export function visualOverlaySummaryItems(
  projection: VisualOpportunityProjectionV1,
  options: DensityOptions,
): VisualOverlaySummaryItem[] {
  const items = projection.overlays
    .filter((overlay) => overlay.type !== 'box' && !isCurrentPriceOverlay(overlay))
    .map(summaryItem)
    .filter((item): item is VisualOverlaySummaryItem => item !== null)
    .sort(compareSummaryPriority);
  return options.compact ? items.slice(0, 4) : items.slice(0, 7);
}

function collapseSamePriceDecisionThresholds(
  overlays: ScenarioChartOverlay[],
): ScenarioChartOverlay[] {
  const output: ScenarioChartOverlay[] = [];
  const skipIds = new Set<string>();
  for (const overlay of overlays) {
    if (skipIds.has(overlay.id)) {
      continue;
    }
    if (
      overlay.type === 'horizontal_line' &&
      overlay.role === 'trigger' &&
      overlay.source === 'decision_playbook'
    ) {
      const matchingInvalidation = overlays.find((candidate) =>
        candidate.type === 'horizontal_line' &&
        candidate.role === 'invalidation' &&
        candidate.source === 'decision_playbook' &&
        samePrice(candidate.price, overlay.price)
      );
      if (matchingInvalidation) {
        skipIds.add(matchingInvalidation.id);
        output.push({
          ...overlay,
          id: `${overlay.id}:${matchingInvalidation.id}`,
          label: combinedThresholdLabel(overlay.label, matchingInvalidation.label),
          status: combinedStatus(overlay.status, matchingInvalidation.status),
        });
        continue;
      }
    }
    output.push(overlay);
  }
  return output;
}

function isCurrentPriceOverlay(overlay: VisualOverlayV1): boolean {
  return overlay.role === 'current_price';
}

function projectOverlay(
  overlay: VisualOverlayV1,
  adapter: CoordinateAdapter,
): VisualOverlayShape | null {
  if (overlay.type === 'line') {
    const start = projectPoint(overlay.points[0], adapter);
    const end = projectPoint(overlay.points[1], adapter);
    if (!start || !end) return null;
    return {
      kind: 'line',
      id: overlay.id,
      role: overlay.role,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      label: overlay.label ?? titleCase(overlay.role),
      status: overlay.status ?? 'active',
    };
  }
  if (overlay.type === 'zone' || overlay.type === 'box') {
    const startTime =
      overlay.type === 'zone'
        ? overlay.time_start ?? null
        : overlay.time_start;
    const endTime =
      overlay.type === 'zone'
        ? overlay.time_end ?? null
        : overlay.time_end;
    const startX = adapter.timeToX(startTime ?? endTime ?? '');
    const endX = adapter.timeToX(endTime ?? startTime ?? '');
    const yLow = adapter.priceToY(overlay.price_low);
    const yHigh = adapter.priceToY(overlay.price_high);
    if (
      startX === null ||
      endX === null ||
      yLow === null ||
      yHigh === null
    ) {
      return null;
    }
    const x = clamp(Math.min(startX, endX), 0, adapter.width);
    const x2 = clamp(Math.max(startX, endX), 0, adapter.width);
    const y = clamp(Math.min(yLow, yHigh), 0, adapter.height);
    const y2 = clamp(Math.max(yLow, yHigh), 0, adapter.height);
    return {
      kind: 'rect',
      id: overlay.id,
      role: overlay.role,
      x,
      y,
      width: x2 - x,
      height: y2 - y,
      label: overlay.label ?? titleCase(overlay.role),
      status: overlay.status ?? 'active',
    };
  }
  if (overlay.type === 'path') {
    const points = overlay.points
      .map((point) => projectPoint(point, adapter))
      .filter((point): point is { x: number; y: number } => point !== null);
    if (points.length < 2) {
      return null;
    }
    return {
      kind: 'path',
      id: overlay.id,
      role: overlay.role,
      d: points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' '),
      label: overlay.label ?? titleCase(overlay.role),
      status: 'active',
    };
  }
  const point = projectPoint(overlay.point, adapter);
  if (!point) {
    return null;
  }
  return {
    kind: 'marker',
    id: overlay.id,
    role: overlay.role,
    x: point.x,
    y: point.y,
    label: overlay.label ?? titleCase(overlay.role),
    status: overlay.status ?? 'active',
  };
}

function projectPoint(
  point: VisualPointV1,
  adapter: CoordinateAdapter,
): { x: number; y: number } | null {
  const x = adapter.timeToX(point.time);
  const y = adapter.priceToY(point.price);
  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: clamp(x, 0, adapter.width),
    y: clamp(y, 0, adapter.height),
  };
}

function compactShapes(shapes: VisualOverlayShape[]): VisualOverlayShape[] {
  return shapes.filter((shape) => shape.kind !== 'path' || shape.role !== 'setup_path');
}

function summaryItem(overlay: VisualOverlayV1): VisualOverlaySummaryItem | null {
  if (overlay.type === 'line') {
    return {
      id: overlay.id,
      label: titleCase(overlay.role),
      value: formatNumber(overlay.points[0].price),
      status: overlay.status ?? 'active',
    };
  }
  if (overlay.type === 'zone') {
    return {
      id: overlay.id,
      label: titleCase(overlay.role),
      value: `${formatNumber(overlay.price_low)} - ${formatNumber(overlay.price_high)}`,
      status: overlay.status ?? 'active',
    };
  }
  if (overlay.type === 'path') {
    return {
      id: overlay.id,
      label: 'Setup path',
      value: overlay.path_semantics === 'planned_setup_path'
        ? 'Planned setup path'
        : titleCase(overlay.path_semantics),
      status: 'active',
    };
  }
  if (overlay.type === 'marker') {
    return {
      id: overlay.id,
      label: titleCase(overlay.role),
      value: `${formatDateTime(overlay.point.time)} @ ${formatNumber(overlay.point.price)}`,
      status: overlay.status ?? 'active',
    };
  }
  return null;
}

function compareSummaryPriority(
  left: VisualOverlaySummaryItem,
  right: VisualOverlaySummaryItem,
): number {
  return summaryPriority(left.label) - summaryPriority(right.label);
}

function summaryPriority(label: string): number {
  if (label === 'Entry') return 0;
  if (label === 'Risk Exit') return 1;
  if (label === 'Target') return 2;
  if (label === 'Expiry') return 3;
  if (label === 'Paper Fill') return 4;
  if (label === 'Paper Exit') return 5;
  if (label === 'Current Price') return 6;
  return 10;
}

function combinedThresholdLabel(triggerLabel: string, invalidationLabel: string): string {
  if (triggerLabel === invalidationLabel) {
    return triggerLabel;
  }
  return `${triggerLabel} / ${invalidationLabel}`;
}

function combinedStatus(
  triggerStatus: ScenarioChartOverlay['status'],
  invalidationStatus: ScenarioChartOverlay['status'],
): ScenarioChartOverlay['status'] {
  if (triggerStatus === 'failed' || invalidationStatus === 'failed') {
    return 'failed';
  }
  if (triggerStatus === 'blocked' || invalidationStatus === 'blocked') {
    return 'blocked';
  }
  if (triggerStatus === 'active' || invalidationStatus === 'active') {
    return 'active';
  }
  if (triggerStatus === 'passed' || invalidationStatus === 'passed') {
    return 'passed';
  }
  return 'unknown';
}

function titleCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

function samePrice(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
