import { useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';
import { formatDateTime, formatNumber } from '@/lib/format';
import type {
  MarketOhlcvCandleResponse,
  ScenarioChartOverlay,
  ScenarioChartProjectionResponse,
} from '@/types';
import { renderScenarioOverlays } from './scenario-chart-overlays';

type ScenarioChartProps = {
  compact?: boolean;
  isLoading?: boolean;
  projection: ScenarioChartProjectionResponse | null;
};

export function ScenarioChart({
  compact = false,
  isLoading = false,
  projection,
}: ScenarioChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const height = compact ? 170 : 240;
  const candles = useMemo(() => (
    projection?.candles.map(toChartCandle).filter(isChartCandle) ?? []
  ), [projection]);
  const stalePlaybook =
    projection?.source_versions.trade_playbook_status === 'stale';
  const staleReasons = projection
    ? [
        ...(projection.source_versions.stale_reasons ?? []),
        ...projection.warnings.filter((warning) => warning === 'trade_playbook_stale'),
      ]
    : [];
  const overlayLimit = compact ? 4 : 7;

  useEffect(() => {
    if (!containerRef.current || !projection || projection.candles.length === 0) {
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
    renderScenarioOverlays(candleSeries, projection.overlays);
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height,
      });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles, height, projection]);

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
        <span className="badge primary">{titleCase(projection.mode)} chart</span>
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

      <div
        aria-label={`${projection.symbol} scenario chart`}
        className="scenario-chart-surface"
        ref={containerRef}
        style={{ minHeight: height }}
      />

      <div className="scenario-chart-status">
        <span>{projection.live_state.commentary}</span>
        <span>Updated {formatDateTime(projection.generated_at)}</span>
      </div>

      {stalePlaybook && staleReasons.length > 0 ? (
        <ul className="scenario-chart-warning-list">
          {staleReasons.slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {projection.overlays.length > 0 ? (
        <ul className="scenario-chart-overlay-list" aria-label="Scenario chart overlays">
          {projection.overlays.slice(0, overlayLimit).map((overlay) => (
            <li key={overlay.id}>
              <span>{overlayLabel(overlay)}</span>
              <strong>{overlayValue(overlay)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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

function titleCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
