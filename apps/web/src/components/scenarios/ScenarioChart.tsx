import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';
import { formatDateTime, formatNumber } from '@/lib/format';
import type {
  MarketOhlcvCandleResponse,
  ScenarioChartOverlay,
  ScenarioChartProjectionResponse,
  SimulationDetailResponse,
} from '@/types';
import { renderScenarioOverlays } from './scenario-chart-overlays';
import { buildSimulationOverlays } from './scenario-simulation-overlays';
import {
  legacyOverlaysForScenarioChart,
  projectVisualOverlays,
  visualOverlaySummaryItems,
  type VisualOverlayShape,
  type VisualOverlaySummaryItem,
} from './visual-opportunity-overlays';

type ScenarioChartProps = {
  compact?: boolean;
  isLoading?: boolean;
  projection: ScenarioChartProjectionResponse | null;
  simulation?: SimulationDetailResponse | null;
};

export function ScenarioChart({
  compact = false,
  isLoading = false,
  projection,
  simulation = null,
}: ScenarioChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visualShapes, setVisualShapes] = useState<VisualOverlayShape[]>([]);
  const height = compact ? 170 : 240;
  const candles = useMemo(() => (
    projection?.candles.map(toChartCandle).filter(isChartCandle) ?? []
  ), [projection]);
  const stalePlaybook =
    projection?.source_versions.trade_playbook_status === 'stale';
  const staleReasons = useMemo(
    () =>
      projection
        ? [
            ...(projection.source_versions.stale_reasons ?? []),
            ...projection.warnings.filter(
              (warning) => warning === 'trade_playbook_stale',
            ),
          ]
        : [],
    [projection],
  );
  const overlayLimit = compact ? 4 : 7;
  const simulationOverlays = useMemo(
    () => buildSimulationOverlays(simulation),
    [simulation],
  );
  const visualProjection = projection?.visual_projection ?? null;
  const overlays = useMemo(
    () => legacyOverlaysForScenarioChart(projection, simulationOverlays),
    [projection, simulationOverlays],
  );
  const visualSummaryItems = useMemo(
    () =>
      visualProjection
        ? visualOverlaySummaryItems(visualProjection, { compact })
        : [],
    [compact, visualProjection],
  );
  const chartWarnings = useMemo(
    () => uniqueStrings([
      ...(projection?.warnings ?? []),
      ...(visualProjection?.warnings ?? []),
      ...staleReasons,
    ]),
    [projection?.warnings, staleReasons, visualProjection?.warnings],
  );

  useEffect(() => {
    if (!containerRef.current || !projection || projection.candles.length === 0) {
      setVisualShapes([]);
      return;
    }
    const container = containerRef.current;
    const chart = createChart(container, {
      height,
      width: container.clientWidth,
      layout: {
        background: { type: ColorType.Solid, color: '#05070a' },
        textColor: '#cbd5e1',
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.12)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.12)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.24)',
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.24)',
        timeVisible: true,
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#34d399',
      downColor: '#ff5d67',
      borderVisible: false,
      wickUpColor: '#34d399',
      wickDownColor: '#ff5d67',
    });

    candleSeries.setData(candles);
    const markerPlugin = createSeriesMarkers(candleSeries, []);
    renderScenarioOverlays(
      {
        createPriceLine: candleSeries.createPriceLine.bind(candleSeries),
        setMarkers: markerPlugin.setMarkers.bind(markerPlugin),
      },
      overlays,
    );
    chart.timeScale().fitContent();
    const updateVisualShapes = () => {
      if (!visualProjection) {
        setVisualShapes([]);
        return;
      }
      setVisualShapes(projectVisualOverlays(
        visualProjection,
        {
          width: container.clientWidth,
          height,
          timeToX: (time) => {
            const timestamp = Date.parse(time);
            if (!Number.isFinite(timestamp)) return null;
            return chart.timeScale().timeToCoordinate(
              Math.floor(timestamp / 1000) as UTCTimestamp,
            );
          },
          priceToY: (price) => candleSeries.priceToCoordinate(price),
        },
        { compact },
      ));
    };
    updateVisualShapes();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height,
      });
      updateVisualShapes();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      setVisualShapes([]);
      chart.remove();
    };
  }, [candles, compact, height, overlays, projection, visualProjection]);

  if (isLoading) {
    return (
      <div className={chartClassName(compact)}>
        <div className="scenario-chart-surface scenario-chart-empty">Loading chart...</div>
      </div>
    );
  }

  if (!projection || projection.candles.length === 0) {
    return (
      <div className={chartClassName(compact)}>
        <div className="scenario-chart-surface scenario-chart-empty">
          <strong>Chart unavailable</strong>
          <span>{projection?.warnings.join(' | ') || 'No candles are available for this scenario.'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={chartClassName(compact)}>
      <div className="scenario-chart-meta">
        <span className="badge primary">
          {visualProjection
            ? formatOpportunityBadge(visualProjection.opportunity)
            : `${titleCase(projection.mode)} chart`}
        </span>
        {visualProjection ? (
          <span className="badge">{titleCase(visualProjection.opportunity.side)}</span>
        ) : null}
        <span className="badge">{projection.interval}</span>
        <span className="badge">
          Price {formatNumber(projection.live_state.current_price)}
        </span>
        {stalePlaybook ? (
          <span className="badge warning">Stale playbook</span>
        ) : (
          <span className="badge">{titleCase(projection.source_versions.trade_playbook_status)} playbook</span>
        )}
      </div>

      <div className="scenario-chart-surface-wrap" style={{ minHeight: height }}>
        <div
          aria-label={`${projection.symbol} scenario chart`}
          className="scenario-chart-surface"
          ref={containerRef}
          style={{ minHeight: height }}
        />
        {visualProjection ? (
          <svg
            aria-hidden="true"
            className="visual-opportunity-svg"
            height={height}
            viewBox={`0 0 ${containerRef.current?.clientWidth ?? 0} ${height}`}
            width={containerRef.current?.clientWidth ?? 0}
          >
            {visualShapes.map((shape) => renderVisualShape(shape))}
          </svg>
        ) : null}
      </div>

      <div className="scenario-chart-status">
        <span>{projection.live_state.commentary}</span>
        <span>Updated {formatDateTime(projection.generated_at)}</span>
      </div>

      {chartWarnings.length > 0 ? (
        <ul className="scenario-chart-warning-list">
          {chartWarnings.slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {visualProjection && visualSummaryItems.length > 0 ? (
        <ul className="scenario-chart-overlay-list" aria-label="Visual opportunity overlays">
          {visualSummaryItems.slice(0, overlayLimit).map((item) => (
            <li
              aria-label={visualSummaryTooltip(item)}
              key={item.id}
              title={visualSummaryTooltip(item)}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      ) : overlays.length > 0 ? (
        <ul className="scenario-chart-overlay-list" aria-label="Scenario chart overlays">
          {overlays.slice(0, overlayLimit).map((overlay) => (
            <li
              aria-label={overlayTooltip(overlay)}
              key={overlay.id}
              title={overlayTooltip(overlay)}
            >
              <span>{overlayLabel(overlay)}</span>
              <strong>{overlayValue(overlay)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatOpportunityBadge(
  opportunity: NonNullable<ScenarioChartProjectionResponse['visual_projection']>['opportunity'],
): string {
  if (opportunity.kind === 'watch_scenario') {
    return `${titleCase(opportunity.status)} watch`;
  }
  if (opportunity.kind === 'paper_position') {
    return `${titleCase(opportunity.status)} paper position`;
  }
  if (opportunity.kind === 'diagnostic') {
    return `${titleCase(opportunity.status)} diagnostic`;
  }
  return `${titleCase(opportunity.status)} setup`;
}

function renderVisualShape(shape: VisualOverlayShape) {
  const color = visualShapeColor(shape);
  if (shape.kind === 'line') {
    return (
      <g key={shape.id}>
        <line
          className={`visual-opportunity-line visual-opportunity-${shape.role}`}
          stroke={color}
          strokeDasharray={shape.role === 'current_price' ? undefined : '5 4'}
          strokeWidth={shape.status === 'active' || shape.status === 'passed' ? 2 : 1}
          x1={shape.x1}
          x2={shape.x2}
          y1={shape.y1}
          y2={shape.y2}
        />
        <text fill={color} x={Math.min(shape.x1, shape.x2) + 6} y={shape.y1 - 6}>
          {shape.label}
        </text>
      </g>
    );
  }
  if (shape.kind === 'rect') {
    return (
      <g key={shape.id}>
        <rect
          className={`visual-opportunity-rect visual-opportunity-${shape.role}`}
          fill={color}
          fillOpacity={shape.role === 'risk_box' ? 0.16 : 0.12}
          height={Math.max(shape.height, 2)}
          stroke={color}
          strokeOpacity={0.72}
          strokeWidth={1}
          width={Math.max(shape.width, 1)}
          x={shape.x}
          y={shape.y}
        />
        <text fill={color} x={shape.x + 6} y={shape.y + 14}>
          {shape.label}
        </text>
      </g>
    );
  }
  if (shape.kind === 'path') {
    return (
      <g key={shape.id}>
        <path
          className={`visual-opportunity-path visual-opportunity-${shape.role}`}
          d={shape.d}
          fill="none"
          stroke={color}
          strokeDasharray="6 5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
      </g>
    );
  }
  return (
    <g key={shape.id}>
      <circle
        className={`visual-opportunity-marker visual-opportunity-${shape.role}`}
        cx={shape.x}
        cy={shape.y}
        fill={color}
        r={4}
      />
      <text fill={color} x={shape.x + 7} y={shape.y - 7}>
        {shape.label}
      </text>
    </g>
  );
}

function chartClassName(compact: boolean): string {
  return compact ? 'scenario-chart-shell scenario-chart-shell-compact' : 'scenario-chart-shell';
}

function toChartCandle(candle: MarketOhlcvCandleResponse): CandlestickData<UTCTimestamp> | null {
  const timestamp = Date.parse(candle.time);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return {
    time: Math.floor(timestamp / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function isChartCandle(
  candle: CandlestickData<UTCTimestamp> | null,
): candle is CandlestickData<UTCTimestamp> {
  return candle !== null;
}

function overlayLabel(overlay: ScenarioChartOverlay): string {
  return `${titleCase(overlay.role)} | ${overlay.label}`;
}

function overlayValue(overlay: ScenarioChartOverlay): string {
  if (overlay.type === 'price_zone') {
    return `${formatNumber(overlay.price_low)} - ${formatNumber(overlay.price_high)}`;
  }
  if (overlay.type === 'horizontal_line') {
    return formatNumber(overlay.price);
  }
  return overlay.time ? formatDateTime(overlay.time) : 'event';
}

function overlayTooltip(overlay: ScenarioChartOverlay): string {
  return `${overlayLabel(overlay)}: ${overlayValue(overlay)} (${titleCase(overlay.status)})`;
}

function visualSummaryTooltip(item: VisualOverlaySummaryItem): string {
  return `${item.label}: ${item.value} (${titleCase(item.status)})`;
}

function visualShapeColor(shape: VisualOverlayShape): string {
  if (shape.status === 'failed' || shape.status === 'blocked') {
    return '#ff5d67';
  }
  if (shape.status === 'passed') {
    return '#34d399';
  }
  if (shape.role === 'risk_exit' || shape.role === 'risk_box') {
    return '#f59e0b';
  }
  if (shape.role === 'target' || shape.role === 'reward_box') {
    return '#62f0df';
  }
  if (shape.role === 'current_price') {
    return '#dbeafe';
  }
  if (shape.role === 'paper_fill' || shape.role === 'paper_exit') {
    return '#f8fafc';
  }
  return '#94a3b8';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function titleCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
