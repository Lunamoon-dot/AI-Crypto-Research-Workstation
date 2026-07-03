import {
  LineStyle,
  type ISeriesApi,
  type LineWidth,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { ScenarioChartOverlay } from '@/types';

type CandleSeries = Pick<ISeriesApi<'Candlestick', Time>, 'createPriceLine'> & {
  setMarkers: (markers: SeriesMarker<Time>[]) => void;
};

export function renderScenarioOverlays(
  candleSeries: CandleSeries,
  overlays: ScenarioChartOverlay[],
) {
  const markers = overlays
    .filter(
      (overlay): overlay is Extract<ScenarioChartOverlay, { type: 'event_marker' }> =>
        overlay.type === 'event_marker',
    )
    .map((overlay) => ({
      time: Math.floor(new Date(overlay.time).getTime() / 1000) as Time,
      position: 'aboveBar' as const,
      color: overlayColor(overlay),
      shape: 'circle' as const,
      text: overlay.label,
    }))
    .filter((marker) => Number.isFinite(marker.time as number));
  if (markers.length > 0) {
    candleSeries.setMarkers(markers);
  }

  overlays.forEach((overlay) => {
    if (overlay.type === 'price_zone') {
      renderZoneBoundary(candleSeries, overlay, overlay.price_low, 'low');
      renderZoneBoundary(candleSeries, overlay, overlay.price_high, 'high');
      return;
    }

    if (overlay.type === 'horizontal_line') {
      if (overlay.role === 'target') {
        renderHorizontalLine(candleSeries, overlay);
        return;
      }
      if (overlay.role === 'invalidation') {
        renderHorizontalLine(candleSeries, overlay);
        return;
      }
      renderHorizontalLine(candleSeries, overlay);
    }
  });
}

function renderZoneBoundary(
  candleSeries: CandleSeries,
  overlay: Extract<ScenarioChartOverlay, { type: 'price_zone' }>,
  price: number,
  boundary: 'low' | 'high',
) {
  candleSeries.createPriceLine({
    price,
    color: overlayColor(overlay),
    lineWidth: lineWidthForStatus(overlay.status),
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: `${overlay.label} ${boundary}`,
  });
}

function renderHorizontalLine(
  candleSeries: CandleSeries,
  overlay: Extract<ScenarioChartOverlay, { type: 'horizontal_line' }>,
) {
  candleSeries.createPriceLine({
    price: overlay.price,
    color: overlayColor(overlay),
    lineWidth: lineWidthForStatus(overlay.status),
    lineStyle: overlay.role === 'current_price' ? LineStyle.Solid : LineStyle.Dashed,
    axisLabelVisible: true,
    title: overlay.label,
  });
}

function overlayColor(overlay: ScenarioChartOverlay): string {
  if (overlay.status === 'failed' || overlay.status === 'blocked') {
    return '#ff5d67';
  }
  if (overlay.status === 'passed') {
    return '#34d399';
  }
  if (overlay.role === 'invalidation' || overlay.role === 'avoid') {
    return '#f59e0b';
  }
  if (overlay.role === 'target') {
    return '#62f0df';
  }
  if (overlay.role === 'current_price') {
    return '#dbeafe';
  }
  return '#94a3b8';
}

function lineWidthForStatus(status: ScenarioChartOverlay['status']): LineWidth {
  return status === 'active' || status === 'passed' ? 2 : 1;
}
