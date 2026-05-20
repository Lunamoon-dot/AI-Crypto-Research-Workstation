import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type TickMarkType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  Maximize2,
  RefreshCw,
  RotateCcw,
  Target,
} from 'lucide-react';
import { EmptyState, LoadingState } from '@/components/ui/state';
import { errorMessage } from '@/services/client';
import {
  subscribeMarketCandles,
  type MarketRealtimeMarketType,
  type MarketRealtimeProvider,
  type MarketRealtimeStatus,
  type MarketRealtimeTrade,
} from '@/services/market-realtime';
import type {
  MarketChartInterval,
  MarketChartType,
  MarketOhlcvCandleResponse,
  ThesisMonitorPlanResponse,
  ThesisPulseMemoResponse,
  ThesisPulseResponse,
} from '@/types';

export type MarketChartRange = '1D' | '7D' | '30D' | 'THESIS' | 'ALL';

export type ThesisChartOverlays = {
  thesisLevels: boolean;
  pulses: boolean;
  memos: boolean;
  volume: boolean;
};

type MainSeriesApi = ISeriesApi<SeriesType>;
type MainSeriesKind = 'area' | 'candles' | 'line';
type VolumeSeriesApi = ISeriesApi<'Histogram'>;
type MarkerApi = {
  setMarkers: (markers: SeriesMarker<Time>[]) => void;
};
type PriceRange = { max: number; min: number };
type PulsePlacement = 'inside' | 'snapped' | 'time_only';
type PulseMarkerResolution = {
  placement: PulsePlacement;
  time: UTCTimestamp;
};

const INTERVALS: MarketChartInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const RANGES: MarketChartRange[] = ['1D', '7D', '30D', 'THESIS', 'ALL'];
const CHART_TYPES: MarketChartType[] = ['candles', 'line', 'area'];

const INTERVAL_SECONDS: Record<MarketChartInterval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14_400,
  '1d': 86_400,
};
const PRICE_DECIMAL_PLACES = 4;
const PRICE_FORMAT = {
  minMove: 1 / 10 ** PRICE_DECIMAL_PLACES,
  precision: PRICE_DECIMAL_PLACES,
  type: 'price' as const,
};
const REALTIME_TRADE_FLUSH_MS = 250;

const PULSE_COLORS: Record<string, string> = {
  calm: '#34d399',
  watch: '#f59e0b',
  review: '#f97316',
  invalidated: '#ef4444',
  rerun_full: '#ef4444',
};
const MARKET_TIME_LOCALE = 'vi-VN';
const MARKET_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const MARKET_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(MARKET_TIME_LOCALE, {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: MARKET_TIME_ZONE,
  year: 'numeric',
});
const MARKET_TIME_FORMATTER = new Intl.DateTimeFormat(MARKET_TIME_LOCALE, {
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  timeZone: MARKET_TIME_ZONE,
});
const MARKET_DAY_FORMATTER = new Intl.DateTimeFormat(MARKET_TIME_LOCALE, {
  day: '2-digit',
  month: '2-digit',
  timeZone: MARKET_TIME_ZONE,
});
const PULSE_STATUS_RANK: Record<string, number> = {
  calm: 0,
  watch: 1,
  review: 2,
  invalidated: 3,
  rerun_full: 3,
};

export function ThesisMarketChart({
  candleError,
  candleWarning,
  candles,
  chartType,
  interval,
  isLoadingCandles,
  marketType,
  memos,
  onChartTypeChange,
  onIntervalChange,
  onRangeChange,
  onRefresh,
  onSelectPulse,
  onToggleOverlay,
  plan,
  pulses,
  range,
  realtimeProvider,
  selectedPulseId,
  visibleOverlays,
}: {
  plan: ThesisMonitorPlanResponse;
  pulses: ThesisPulseResponse[];
  memos: ThesisPulseMemoResponse[];
  candles: MarketOhlcvCandleResponse[];
  isLoadingCandles: boolean;
  candleError: unknown;
  candleWarning?: string | null;
  interval: MarketChartInterval;
  marketType: MarketRealtimeMarketType;
  range: MarketChartRange;
  realtimeProvider?: MarketRealtimeProvider;
  chartType: MarketChartType;
  visibleOverlays: ThesisChartOverlays;
  selectedPulseId?: string | null;
  onIntervalChange: (interval: MarketChartInterval) => void;
  onRangeChange: (range: MarketChartRange) => void;
  onChartTypeChange: (chartType: MarketChartType) => void;
  onToggleOverlay: (overlay: keyof ThesisChartOverlays) => void;
  onSelectPulse?: (pulseId: string | null) => void;
  onRefresh?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<MainSeriesApi | null>(null);
  const volumeSeriesRef = useRef<VolumeSeriesApi | null>(null);
  const markerApiRef = useRef<MarkerApi | null>(null);
  const mainSeriesKindRef = useRef<MainSeriesKind | null>(null);
  const lastSeriesTimeRef = useRef<UTCTimestamp | null>(null);
  const latestCandleRef = useRef<MarketOhlcvCandleResponse | null>(null);
  const latestTradeRef = useRef<MarketRealtimeTrade | null>(null);
  const priceLinesRef = useRef<Array<{ series: MainSeriesApi; line: IPriceLine }>>(
    [],
  );
  const dataLengthRef = useRef(0);
  const autoFitKeyRef = useRef<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<MarketRealtimeStatus>({
    message: 'Realtime candles idle.',
    state: 'idle',
  });
  const [realtimeCandlesByTime, setRealtimeCandlesByTime] = useState<
    Record<string, MarketOhlcvCandleResponse>
  >({});

  const sortedCandles = useMemo(
    () => normalizeCandles([...candles, ...Object.values(realtimeCandlesByTime)]),
    [candles, realtimeCandlesByTime],
  );
  const fallbackLineData = useMemo(() => pulseLineData(pulses), [pulses]);
  const candleData = useMemo<CandlestickData<Time>[]>(
    () => candleSeriesData(sortedCandles),
    [sortedCandles],
  );
  const marketLineData = useMemo<LineData<Time>[]>(
    () => candleCloseLineData(sortedCandles),
    [sortedCandles],
  );
  const visiblePriceRange = useMemo(
    () => priceRangeForCandles(sortedCandles),
    [sortedCandles],
  );
  const visibleTimes = useMemo(
    () =>
      (candleData.length > 0
        ? candleData.map((item) => item.time)
        : fallbackLineData.map((item) => item.time)
      ).filter(isUtcTimestamp),
    [candleData, fallbackLineData],
  );
  const selectedPulse = useMemo(
    () => pulses.find((pulse) => pulse.id === selectedPulseId) ?? null,
    [pulses, selectedPulseId],
  );
  const pulseVisibility = useMemo(
    () => summarizePulseVisibility(pulses, visibleTimes, interval),
    [interval, pulses, visibleTimes],
  );
  const selectedPulsePlacement = selectedPulse
    ? pulsePlacement(selectedPulse, visibleTimes, interval)
    : null;
  const usesPulseFallback = candleData.length === 0 && fallbackLineData.length > 0;
  const mainSeriesKind: MainSeriesKind =
    chartType === 'candles' && candleData.length > 0
      ? 'candles'
      : chartType === 'area'
        ? 'area'
        : 'line';
  const mainSeriesData = useMemo<
    CandlestickData<Time>[] | LineData<Time>[]
  >(
    () =>
      mainSeriesKind === 'candles'
        ? candleData
        : candleData.length > 0
          ? marketLineData
          : fallbackLineData,
    [candleData, fallbackLineData, mainSeriesKind, marketLineData],
  );
  const markerData = useMemo(
    () =>
      buildMarkers({
        interval,
        memos,
        plan,
        priceRange: visiblePriceRange,
        pulses,
        selectedPulseId,
        times: visibleTimes,
        visibleOverlays,
      }),
    [
      interval,
      memos,
      plan,
      pulses,
      selectedPulseId,
      visibleOverlays,
      visiblePriceRange,
      visibleTimes,
    ],
  );
  const volumeBars = useMemo(() => volumeData(sortedCandles), [sortedCandles]);
  const autoFitKey = useMemo(
    () => chartAutoFitKey(interval, range, mainSeriesData),
    [interval, mainSeriesData, range],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const chart = createChart(container, {
      autoSize: false,
      width: Math.max(container.clientWidth, 320),
      height: Math.max(container.clientHeight, 360),
      layout: {
        background: { type: ColorType.Solid, color: '#0b0b0f' },
        textColor: '#d4d4d8',
        attributionLogo: true,
      },
      localization: {
        locale: MARKET_TIME_LOCALE,
        timeFormatter: formatChartDateTime,
      },
      grid: {
        vertLines: { color: 'rgba(63, 63, 70, 0.34)' },
        horzLines: { color: 'rgba(63, 63, 70, 0.34)' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'rgba(63, 63, 70, 0.72)',
      },
      timeScale: {
        borderColor: 'rgba(63, 63, 70, 0.72)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: formatChartAxisTick,
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.max(Math.floor(entry?.contentRect.width ?? 0), 320);
      const height = Math.max(Math.floor(entry?.contentRect.height ?? 0), 320);
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    const crosshairHandler = (param: MouseEventParams<Time>) => {
      const legend = legendRef.current;
      const series = mainSeriesRef.current;
      if (!legend || !series) {
        return;
      }
      const data = param.seriesData.get(series) as unknown;
      legend.textContent = legendText(data, param.time);
    };
    chart.subscribeCrosshairMove(crosshairHandler);

    return () => {
      chart.unsubscribeCrosshairMove(crosshairHandler);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markerApiRef.current = null;
      mainSeriesKindRef.current = null;
      lastSeriesTimeRef.current = null;
      latestCandleRef.current = null;
      latestTradeRef.current = null;
      priceLinesRef.current = [];
      autoFitKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return undefined;
    }

    clearMainSeries(chart);
    const series = createMainSeries(chart, mainSeriesKind);
    mainSeriesRef.current = series;
    mainSeriesKindRef.current = mainSeriesKind;
    markerApiRef.current = createSeriesMarkers(series, []);

    return () => {
      markerApiRef.current?.setMarkers([]);
      markerApiRef.current = null;
      clearPriceLines();
      if (mainSeriesRef.current === series) {
        chart.removeSeries(series);
        mainSeriesRef.current = null;
        mainSeriesKindRef.current = null;
      }
    };
  }, [mainSeriesKind]);

  useEffect(() => {
    const series = mainSeriesRef.current;
    const seriesKind = mainSeriesKindRef.current;
    if (!series || !seriesKind) {
      return;
    }
    if (seriesKind === 'candles') {
      series.setData(mainSeriesData as CandlestickData<Time>[]);
    } else {
      if (seriesKind === 'line') {
        (series as ISeriesApi<'Line'>).applyOptions({
          color: usesPulseFallback ? '#f59e0b' : '#e5e7eb',
        });
      }
      series.setData(mainSeriesData as LineData<Time>[]);
    }
    dataLengthRef.current = mainSeriesData.length;
    lastSeriesTimeRef.current = lastSeriesTimestamp(mainSeriesData);
    latestCandleRef.current =
      sortedCandles.at(-1) ?? candleFromLastLine(mainSeriesData);
  }, [mainSeriesData, sortedCandles, usesPulseFallback]);

  useEffect(() => {
    if (!mainSeriesRef.current) {
      return;
    }
    markerApiRef.current?.setMarkers(markerData);
  }, [markerData, mainSeriesKind]);

  useEffect(() => {
    clearPriceLines();
    const series = mainSeriesRef.current;
    if (series) {
      attachPriceLines(series, plan, visibleOverlays.thesisLevels);
    }
    return () => {
      clearPriceLines();
    };
  }, [mainSeriesKind, plan, visibleOverlays.thesisLevels]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    if (!visibleOverlays.volume || candleData.length === 0) {
      clearVolumeSeries(chart);
      return;
    }
    if (!volumeSeriesRef.current) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: 'rgba(113, 113, 122, 0.38)',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;
    }
    volumeSeriesRef.current.setData(volumeBars);
  }, [candleData.length, visibleOverlays.volume, volumeBars]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || mainSeriesData.length === 0 || !autoFitKey) {
      return;
    }
    if (autoFitKeyRef.current === autoFitKey) {
      return;
    }
    autoFitKeyRef.current = autoFitKey;
    chart.timeScale().fitContent();
  }, [autoFitKey, mainSeriesData.length]);

  useEffect(() => {
    if (!selectedPulse) {
      return;
    }
    const rawTime = toChartTime(selectedPulse.observed_at);
    const time = rawTime
      ? resolvePulseMarkerTime(rawTime, visibleTimes, interval).time
      : null;
    if (time) {
      focusAroundTime(time, interval);
    }
  }, [interval, selectedPulse, visibleTimes]);

  useEffect(() => {
    setRealtimeCandlesByTime({});
  }, [interval, marketType, plan.symbol, realtimeProvider]);

  useEffect(() => {
    if (!realtimeProvider || !plan.symbol) {
      setRealtimeStatus({
        message: 'Realtime candles waiting for market provider.',
        state: 'idle',
      });
      return undefined;
    }

    return subscribeMarketCandles({
      interval,
      marketType,
      onCandle: applyRealtimeCandle,
      onStatus: setRealtimeStatus,
      onTrade: applyRealtimeTrade,
      provider: realtimeProvider,
      symbol: plan.symbol,
    });
  }, [interval, marketType, plan.symbol, realtimeProvider]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const trade = latestTradeRef.current;
      if (!trade) {
        return;
      }
      latestTradeRef.current = null;
      updateCandleFromTrade(trade);
    }, REALTIME_TRADE_FLUSH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [interval]);

  function applyRealtimeCandle(candle: MarketOhlcvCandleResponse) {
    const time = toChartTime(candle.time);
    const series = mainSeriesRef.current;
    const seriesKind = mainSeriesKindRef.current;
    if (!time || !series || !seriesKind || !validCandle(candle)) {
      return;
    }

    const lastTime = lastSeriesTimeRef.current;
    if (lastTime !== null && time < lastTime) {
      return;
    }

    setRealtimeCandlesByTime((current) => ({
      ...current,
      [String(time)]: candle,
    }));

    if (seriesKind === 'candles') {
      (series as ISeriesApi<'Candlestick'>).update(candleToSeriesData(candle, time));
    } else {
      const linePoint = candleToLineData(candle, time);
      if (seriesKind === 'area') {
        (series as ISeriesApi<'Area'>).update(linePoint);
      } else {
        (series as ISeriesApi<'Line'>).update(linePoint);
      }
    }

    volumeSeriesRef.current?.update(candleToVolumeBar(candle, time));

    if (lastTime === null || time > lastTime) {
      dataLengthRef.current += 1;
      lastSeriesTimeRef.current = time;
    }
    latestCandleRef.current = candle;
  }

  function applyRealtimeTrade(trade: MarketRealtimeTrade) {
    latestTradeRef.current = trade;
  }

  function updateCandleFromTrade(trade: MarketRealtimeTrade) {
    const time = toChartTime(trade.time);
    if (!time || !Number.isFinite(trade.price)) {
      return;
    }
    const bucketTime = bucketStartTime(time, interval);
    const current = latestCandleRef.current;
    const currentTime = toChartTime(current?.time);
    if (currentTime !== null && bucketTime < currentTime) {
      return;
    }

    const candle =
      current && currentTime === bucketTime
        ? {
            ...current,
            close: trade.price,
            high: Math.max(current.high, trade.price),
            low: Math.min(current.low, trade.price),
          }
        : {
            time: new Date(bucketTime * 1000).toISOString(),
            open: current?.close ?? trade.price,
            high: Math.max(current?.close ?? trade.price, trade.price),
            low: Math.min(current?.close ?? trade.price, trade.price),
            close: trade.price,
            volume: trade.size,
          };
    applyRealtimeCandle(candle);
  }

  function createMainSeries(
    chart: IChartApi,
    seriesKind: MainSeriesKind,
  ): MainSeriesApi {
    if (seriesKind === 'candles') {
      return chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#86efac',
        wickDownColor: '#fca5a5',
        priceFormat: PRICE_FORMAT,
      }) as MainSeriesApi;
    }
    if (seriesKind === 'area') {
      return chart.addSeries(AreaSeries, {
        lineColor: '#38bdf8',
        topColor: 'rgba(56, 189, 248, 0.28)',
        bottomColor: 'rgba(56, 189, 248, 0.02)',
        lineWidth: 2,
        priceFormat: PRICE_FORMAT,
      }) as MainSeriesApi;
    }
    return chart.addSeries(LineSeries, {
      color: '#e5e7eb',
      lineWidth: 2,
      priceFormat: PRICE_FORMAT,
    }) as MainSeriesApi;
  }

  function clearMainSeries(chart: IChartApi) {
    markerApiRef.current?.setMarkers([]);
    markerApiRef.current = null;
    clearPriceLines();
    if (mainSeriesRef.current) {
      chart.removeSeries(mainSeriesRef.current);
      mainSeriesRef.current = null;
      mainSeriesKindRef.current = null;
    }
  }

  function clearVolumeSeries(chart: IChartApi) {
    if (volumeSeriesRef.current) {
      chart.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
  }

  function clearPriceLines() {
    for (const { series, line } of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    priceLinesRef.current = [];
  }

  function attachPriceLines(
    series: MainSeriesApi,
    currentPlan: ThesisMonitorPlanResponse,
    enabled: boolean,
  ) {
    if (!enabled) {
      return;
    }
    for (const level of thesisLevels(currentPlan)) {
      const line = series.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: level.style,
        axisLabelVisible: true,
        title: level.label,
      });
      priceLinesRef.current.push({ series, line });
    }
  }

  function fitLatest() {
    const chart = chartRef.current;
    if (!chart || dataLengthRef.current === 0) {
      return;
    }
    const last = dataLengthRef.current + 5;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, dataLengthRef.current - 120),
      to: last,
    });
  }

  function fitThesis() {
    const range = thesisVisibleRange(plan, pulses, memos);
    if (!range) {
      chartRef.current?.timeScale().fitContent();
      return;
    }
    chartRef.current?.timeScale().setVisibleRange(range);
  }

  function resetZoom() {
    chartRef.current?.timeScale().fitContent();
  }

  function focusAroundTime(time: UTCTimestamp, currentInterval: MarketChartInterval) {
    const span = Math.max(INTERVAL_SECONDS[currentInterval] * 18, 3600);
    chartRef.current?.timeScale().setVisibleRange({
      from: (time - span) as UTCTimestamp,
      to: (time + span) as UTCTimestamp,
    });
  }

  return (
    <section className="thesis-market-chart">
      <div className="market-chart-toolbar" aria-label="Market chart controls">
        <SegmentedControl
          label="Interval"
          onSelect={onIntervalChange}
          options={INTERVALS}
          value={interval}
        />
        <SegmentedControl
          label="Range"
          onSelect={onRangeChange}
          options={RANGES}
          value={range}
        />
        <SegmentedControl
          label="Type"
          onSelect={onChartTypeChange}
          options={CHART_TYPES}
          value={chartType}
        />
        <div className="market-chart-toggle-group" aria-label="Chart overlays">
          {(
            [
              ['thesisLevels', 'Levels'],
              ['pulses', 'Pulse events'],
              ['memos', 'Memos'],
              ['volume', 'Volume'],
            ] as Array<[keyof ThesisChartOverlays, string]>
          ).map(([key, label]) => (
            <button
              className={`market-toggle ${visibleOverlays[key] ? 'active' : ''}`}
              key={key}
              onClick={() => onToggleOverlay(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="market-chart-actions">
          <button className="button icon" onClick={onRefresh} title="Refresh" type="button">
            <RefreshCw aria-hidden size={15} />
          </button>
          <button
            className="button icon"
            onClick={fitLatest}
            title="Fit latest"
            type="button"
          >
            <Maximize2 aria-hidden size={15} />
          </button>
          <button
            className="button icon"
            onClick={fitThesis}
            title="Fit thesis"
            type="button"
          >
            <Target aria-hidden size={15} />
          </button>
          <button
            className="button icon"
            onClick={resetZoom}
            title="Reset zoom"
            type="button"
          >
            <RotateCcw aria-hidden size={15} />
          </button>
        </div>
      </div>

      <div className="market-chart-status-row">
        <div className="market-chart-legend" ref={legendRef}>
          Move crosshair over the chart for OHLCV.
        </div>
        {isLoadingCandles ? <span className="badge primary">loading candles</span> : null}
        {usesPulseFallback ? (
          <span className="badge warning">pulse-only fallback</span>
        ) : null}
        {candleWarning ? <span className="badge warning">{candleWarning}</span> : null}
        {candleError ? (
          <span className="badge risk">candles unavailable: {errorMessage(candleError)}</span>
        ) : null}
        {visibleOverlays.pulses && pulseVisibility.total > 0 ? (
          <span className="badge primary">
            pulse events {pulseVisibility.plotted}/{pulseVisibility.total} on chart
          </span>
        ) : null}
        {pulseVisibility.snapped > 0 ? (
          <span className="badge warning">
            {pulseVisibility.snapped} snapped to nearest candle
          </span>
        ) : null}
        {pulseVisibility.newer > 0 ? (
          <span className="badge warning">
            {pulseVisibility.newer} newer than candles
          </span>
        ) : null}
        {pulseVisibility.older > 0 ? (
          <span className="badge warning">
            {pulseVisibility.older} older than candles
          </span>
        ) : null}
        {selectedPulsePlacement === 'snapped' ? (
          <span className="badge warning">selected pulse snapped to nearest candle</span>
        ) : null}
        {selectedPulsePlacement === 'time_only' ? (
          <span className="badge warning">selected pulse has no matching candle</span>
        ) : null}
        {realtimeStatus.state !== 'idle' ? (
          <span className={`badge ${realtimeStatusTone(realtimeStatus.state)}`}>
            {realtimeStatusLabel(realtimeStatus)}
          </span>
        ) : null}
      </div>

      <div className="market-chart-shell">
        <div className="market-chart-canvas" ref={containerRef} />
        {isLoadingCandles && candles.length === 0 && pulses.length === 0 ? (
          <div className="market-chart-overlay-state">
            <LoadingState label="Loading market candles..." />
          </div>
        ) : null}
        {!isLoadingCandles && candleData.length === 0 && fallbackLineData.length === 0 ? (
          <div className="market-chart-overlay-state">
            <EmptyState label="No candles or pulse prices are available yet." />
          </div>
        ) : null}
      </div>

      <div className="market-chart-footer">
        <span>{plan.symbol}</span>
        <span>{plan.market_type}</span>
        {realtimeProvider ? <span>{realtimeProvider} realtime</span> : null}
        <span>{sortedCandles.length} candles</span>
        <span>{pulses.length} pulse events</span>
        <button
          className="button ghost"
          disabled={!selectedPulseId}
          onClick={() => onSelectPulse?.(null)}
          type="button"
        >
          Clear pulse focus
        </button>
      </div>
    </section>
  );
}

function SegmentedControl<T extends string>({
  label,
  onSelect,
  options,
  value,
}: {
  label: string;
  options: T[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="market-chart-segment">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            className={option === value ? 'active' : ''}
            key={option}
            onClick={() => onSelect(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function normalizeCandles(
  candles: MarketOhlcvCandleResponse[],
): MarketOhlcvCandleResponse[] {
  const byTime = new Map<number, MarketOhlcvCandleResponse>();
  for (const candle of candles) {
    const time = toChartTime(candle.time);
    if (
      time === null ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      continue;
    }
    byTime.set(Number(time), candle);
  }
  return [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, candle]) => candle);
}

function pulseLineData(pulses: ThesisPulseResponse[]): LineData<Time>[] {
  const points = new Map<number, LineData<Time>>();
  for (const pulse of pulses) {
    if (pulse.current_price === null || !Number.isFinite(pulse.current_price)) {
      continue;
    }
    const time = toChartTime(pulse.observed_at);
    if (!time) {
      continue;
    }
    points.set(time, { time, value: pulse.current_price });
  }
  return [...points.values()].sort((left, right) => Number(left.time) - Number(right.time));
}

function candleSeriesData(
  candles: MarketOhlcvCandleResponse[],
): CandlestickData<Time>[] {
  const data: CandlestickData<Time>[] = [];
  for (const candle of candles) {
    const time = toChartTime(candle.time);
    if (!time) {
      continue;
    }
    data.push({
      time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  }
  return data;
}

function candleCloseLineData(
  candles: MarketOhlcvCandleResponse[],
): LineData<Time>[] {
  const data: LineData<Time>[] = [];
  for (const candle of candles) {
    const time = toChartTime(candle.time);
    if (!time) {
      continue;
    }
    data.push({ time, value: candle.close });
  }
  return data;
}

function candleToSeriesData(
  candle: MarketOhlcvCandleResponse,
  time: UTCTimestamp,
): CandlestickData<Time> {
  return {
    time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function candleToLineData(
  candle: MarketOhlcvCandleResponse,
  time: UTCTimestamp,
): LineData<Time> {
  return { time, value: candle.close };
}

function priceRangeForCandles(
  candles: MarketOhlcvCandleResponse[],
): PriceRange | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    if (Number.isFinite(candle.low)) {
      min = Math.min(min, candle.low);
    }
    if (Number.isFinite(candle.high)) {
      max = Math.max(max, candle.high);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { max, min } : null;
}

function volumeData(candles: MarketOhlcvCandleResponse[]): HistogramData<Time>[] {
  const data: HistogramData<Time>[] = [];
  for (const candle of candles) {
    const time = toChartTime(candle.time);
    if (!time) {
      continue;
    }
    data.push({
      time,
      value: candle.volume ?? 0,
      color:
        candle.close >= candle.open
          ? 'rgba(52, 211, 153, 0.32)'
          : 'rgba(239, 68, 68, 0.32)',
    });
  }
  return data;
}

function candleToVolumeBar(
  candle: MarketOhlcvCandleResponse,
  time: UTCTimestamp,
): HistogramData<Time> {
  return {
    time,
    value: candle.volume ?? 0,
    color:
      candle.close >= candle.open
        ? 'rgba(52, 211, 153, 0.32)'
        : 'rgba(239, 68, 68, 0.32)',
  };
}

function lastSeriesTimestamp(
  data: Array<CandlestickData<Time> | LineData<Time>>,
): UTCTimestamp | null {
  const last = data.at(-1)?.time;
  return isUtcTimestamp(last) ? last : null;
}

function candleFromLastLine(
  data: Array<CandlestickData<Time> | LineData<Time>>,
): MarketOhlcvCandleResponse | null {
  const last = data.at(-1);
  if (!last || !isUtcTimestamp(last.time)) {
    return null;
  }
  if (isOhlcData(last)) {
    return {
      time: new Date(last.time * 1000).toISOString(),
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: null,
    };
  }
  if (isLineData(last)) {
    return {
      time: new Date(last.time * 1000).toISOString(),
      open: last.value,
      high: last.value,
      low: last.value,
      close: last.value,
      volume: null,
    };
  }
  return null;
}

function bucketStartTime(
  time: UTCTimestamp,
  interval: MarketChartInterval,
): UTCTimestamp {
  const intervalSeconds = INTERVAL_SECONDS[interval];
  return (Math.floor(Number(time) / intervalSeconds) * intervalSeconds) as UTCTimestamp;
}

function chartAutoFitKey(
  interval: MarketChartInterval,
  range: MarketChartRange,
  data: Array<{ time: Time }>,
): string | null {
  if (data.length === 0) {
    return null;
  }
  const first = data[0]?.time;
  const last = data.at(-1)?.time;
  return `${range}:${interval}:${String(first)}:${String(last)}:${data.length}`;
}

function validCandle(candle: MarketOhlcvCandleResponse): boolean {
  return (
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  );
}

function realtimeStatusTone(
  state: MarketRealtimeStatus['state'],
): 'primary' | 'constructive' | 'warning' | 'risk' {
  if (state === 'connected') {
    return 'constructive';
  }
  if (state === 'connecting' || state === 'reconnecting') {
    return 'primary';
  }
  if (state === 'error' || state === 'unavailable') {
    return 'risk';
  }
  return 'warning';
}

function realtimeStatusLabel(status: MarketRealtimeStatus): string {
  if (status.state === 'connected') {
    return `live ${status.provider ?? 'market'}`;
  }
  if (status.state === 'connecting') {
    return 'live connecting';
  }
  if (status.state === 'reconnecting') {
    return 'live reconnecting';
  }
  if (status.state === 'error') {
    return `live error: ${status.message}`;
  }
  if (status.state === 'unavailable') {
    return 'live unavailable';
  }
  return 'live closed';
}

function buildMarkers({
  interval,
  memos,
  plan,
  priceRange,
  pulses,
  selectedPulseId,
  times,
  visibleOverlays,
}: {
  plan: ThesisMonitorPlanResponse;
  pulses: ThesisPulseResponse[];
  memos: ThesisPulseMemoResponse[];
  interval: MarketChartInterval;
  priceRange: PriceRange | null;
  selectedPulseId?: string | null;
  times: UTCTimestamp[];
  visibleOverlays: ThesisChartOverlays;
}): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  if (visibleOverlays.pulses) {
    markers.push(...planAnchorMarkers(plan, priceRange, times, interval));

    const pulseMarkers = new Map<
      number,
      {
        action: string;
        count: number;
        price: number | null;
        score: number;
        selected: boolean;
        status: string;
        time: UTCTimestamp;
      }
    >();
    for (const pulse of pulses) {
      const rawTime = toChartTime(pulse.observed_at);
      if (!rawTime) {
        continue;
      }
      const resolution = resolvePulseMarkerTime(rawTime, times, interval);
      const selected = pulse.id === selectedPulseId;
      const existing = pulseMarkers.get(Number(resolution.time));
      const status = higherPulseStatus(existing?.status, pulse.status);
      const score = Number.isFinite(pulse.score) ? pulse.score : 0;
      const price =
        pulse.current_price !== null && Number.isFinite(pulse.current_price)
          ? pulse.current_price
          : existing?.price ?? null;
      pulseMarkers.set(Number(resolution.time), {
        action: pulse.suggested_action || existing?.action || '',
        count: (existing?.count ?? 0) + 1,
        price,
        score: Math.max(existing?.score ?? 0, score),
        selected: Boolean(existing?.selected || selected),
        status,
        time: resolution.time,
      });
    }
    for (const marker of pulseMarkers.values()) {
      const color = PULSE_COLORS[marker.status] ?? '#a1a1aa';
      const text = marker.selected
        ? `selected ${marker.status} pulse`
        : marker.count > 1
          ? `${marker.count} ${marker.status} pulses`
        : marker.status === 'calm'
          ? undefined
          : marker.action || marker.status;
      const base = {
        color,
        shape: marker.selected ? ('arrowUp' as const) : ('circle' as const),
        size: pulseDotSize(marker),
        text,
        time: marker.time,
      };
      markers.push(
        marker.price !== null && priceIsVisible(marker.price, priceRange)
          ? {
              ...base,
              position: 'atPriceMiddle',
              price: marker.price,
            }
          : {
              ...base,
              position: marker.selected
                ? 'aboveBar'
                : marker.status === 'invalidated'
                  ? 'belowBar'
                  : 'inBar',
            },
      );
    }
  }
  if (visibleOverlays.memos) {
    const pulseById = new Map(
      pulses
        .filter((pulse) => pulse.id)
        .map((pulse) => [String(pulse.id), pulse] as const),
    );
    for (const memo of memos) {
      const referenced = memo.referenced_pulse_ids
        .map((pulseId) => pulseById.get(pulseId))
        .filter((pulse): pulse is ThesisPulseResponse => Boolean(pulse));
      if (referenced.length === 0 && !memo.created_at) {
        continue;
      }
      const latestReferenced = referenced
        .slice()
        .sort((left, right) =>
          String(left.observed_at ?? '').localeCompare(String(right.observed_at ?? '')),
        )
        .at(-1);
      const rawTime = toChartTime(latestReferenced?.observed_at ?? memo.created_at);
      if (!rawTime) {
        continue;
      }
      markers.push({
        time: resolvePulseMarkerTime(rawTime, times, interval).time,
        position: 'belowBar',
        color: '#38bdf8',
        shape: 'square',
        text: memo.status ? `memo ${memo.status}` : 'memo',
        size: memoDotSize(referenced.length),
      });
    }
  }
  return markers.sort((left, right) => Number(left.time) - Number(right.time));
}

function planAnchorMarkers(
  plan: ThesisMonitorPlanResponse,
  priceRange: PriceRange | null,
  times: UTCTimestamp[],
  interval: MarketChartInterval,
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  const createdTime = toChartTime(plan.created_at);
  if (createdTime) {
    const resolved = resolvePulseMarkerTime(createdTime, times, interval);
    markers.push({
      color: '#a78bfa',
      position: 'belowBar',
      shape: 'arrowUp',
      size: 0.9,
      text: 'thesis created',
      time: resolved.time,
    });
  }

  const baselineTime = toChartTime(plan.baseline_observed_at);
  if (!baselineTime) {
    return markers;
  }

  const baselinePrice =
    plan.baseline_price !== null && Number.isFinite(plan.baseline_price)
      ? plan.baseline_price
      : null;
  const resolved = resolvePulseMarkerTime(baselineTime, times, interval);
  const base = {
    color: '#38bdf8',
    shape: 'circle' as const,
    size: 0.95,
    text: 'baseline',
    time: resolved.time,
  };
  markers.push(
    baselinePrice !== null && priceIsVisible(baselinePrice, priceRange)
      ? {
          ...base,
          position: 'atPriceMiddle',
          price: baselinePrice,
        }
      : {
          ...base,
          position: 'inBar',
        },
  );
  return markers;
}

function pulseDotSize(marker: {
  count: number;
  score: number;
  selected: boolean;
  status: string;
}): number {
  if (marker.selected) {
    return 1.35;
  }
  const statusBase =
    marker.status === 'calm'
      ? 0.55
      : marker.status === 'watch'
        ? 0.78
        : 0.92;
  const scoreBoost = Math.min(Math.max(marker.score, 0), 100) / 220;
  const countBoost = Math.min(Math.max(marker.count - 1, 0), 4) * 0.12;
  return roundMarkerSize(statusBase + scoreBoost + countBoost);
}

function memoDotSize(referencedPulseCount: number): number {
  return roundMarkerSize(0.82 + Math.min(referencedPulseCount, 4) * 0.08);
}

function roundMarkerSize(value: number): number {
  return Math.round(value * 100) / 100;
}

function higherPulseStatus(left: string | undefined, right: string): string {
  if (!left) {
    return right;
  }
  return (PULSE_STATUS_RANK[right] ?? 0) > (PULSE_STATUS_RANK[left] ?? 0)
    ? right
    : left;
}

function priceIsVisible(price: number, range: PriceRange | null): boolean {
  if (!range) {
    return true;
  }
  const span = Math.max(range.max - range.min, Math.abs(range.max) * 0.01, 1);
  const padding = span * 0.05;
  return price >= range.min - padding && price <= range.max + padding;
}

function thesisLevels(plan: ThesisMonitorPlanResponse): Array<{
  label: string;
  price: number;
  color: string;
  style: LineStyle;
}> {
  const levels: Array<{
    label: string;
    price: number;
    color: string;
    style: LineStyle;
  }> = [];
  if (plan.baseline_price !== null && Number.isFinite(plan.baseline_price)) {
    levels.push({
      label: `baseline ${numberLabel(plan.baseline_price)}`,
      price: plan.baseline_price,
      color: '#a78bfa',
      style: LineStyle.Solid,
    });
  }
  if (plan.entry_low !== null && Number.isFinite(plan.entry_low)) {
    levels.push({
      label: `entry low ${numberLabel(plan.entry_low)}`,
      price: plan.entry_low,
      color: '#f59e0b',
      style: LineStyle.Dotted,
    });
  }
  if (plan.entry_high !== null && Number.isFinite(plan.entry_high)) {
    levels.push({
      label: `entry high ${numberLabel(plan.entry_high)}`,
      price: plan.entry_high,
      color: '#f59e0b',
      style: LineStyle.Dotted,
    });
  }
  if (
    plan.invalidation_level !== null &&
    Number.isFinite(plan.invalidation_level)
  ) {
    levels.push({
      label: `invalid ${numberLabel(plan.invalidation_level)}`,
      price: plan.invalidation_level,
      color: '#ef4444',
      style: LineStyle.Dashed,
    });
  }
  for (const target of plan.targets) {
    if (!Number.isFinite(target.price)) {
      continue;
    }
    levels.push({
      label: `${target.label || 'target'} ${numberLabel(target.price)}`,
      price: target.price,
      color: '#38bdf8',
      style: LineStyle.Dashed,
    });
  }
  return levels;
}

function thesisVisibleRange(
  plan: ThesisMonitorPlanResponse,
  pulses: ThesisPulseResponse[],
  memos: ThesisPulseMemoResponse[],
): { from: UTCTimestamp; to: UTCTimestamp } | null {
  const timestamps = [
    plan.baseline_observed_at,
    plan.created_at,
    plan.last_pulse_at,
    ...pulses.map((pulse) => pulse.observed_at),
    ...memos.map((memo) => memo.created_at),
  ]
    .map(toChartTime)
    .filter(isUtcTimestamp);
  if (timestamps.length === 0) {
    return null;
  }
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps, toChartTime(new Date().toISOString()) ?? 0);
  const padding = Math.max((max - min) * 0.12, 3600);
  return {
    from: (min - padding) as UTCTimestamp,
    to: (max + padding) as UTCTimestamp,
  };
}

function summarizePulseVisibility(
  pulses: ThesisPulseResponse[],
  visibleTimes: UTCTimestamp[],
  interval: MarketChartInterval,
): {
  newer: number;
  older: number;
  plotted: number;
  snapped: number;
  total: number;
} {
  const summary = {
    newer: 0,
    older: 0,
    plotted: 0,
    snapped: 0,
    total: pulses.length,
  };
  const first = visibleTimes[0] ?? null;
  const last = visibleTimes.at(-1) ?? null;
  for (const pulse of pulses) {
    const time = toChartTime(pulse.observed_at);
    if (!time) {
      continue;
    }
    const placement = pulsePlacement(pulse, visibleTimes, interval);
    if (!placement) {
      continue;
    }
    summary.plotted += 1;
    if (placement === 'snapped') {
      summary.snapped += 1;
    } else if (placement === 'time_only') {
      if (last !== null && time > last) {
        summary.newer += 1;
      } else if (first !== null && time < first) {
        summary.older += 1;
      }
    }
  }
  return summary;
}

function pulsePlacement(
  pulse: ThesisPulseResponse,
  visibleTimes: UTCTimestamp[],
  interval: MarketChartInterval,
): PulsePlacement | null {
  const time = toChartTime(pulse.observed_at);
  if (!time) {
    return null;
  }
  return resolvePulseMarkerTime(time, visibleTimes, interval).placement;
}

function resolvePulseMarkerTime(
  value: UTCTimestamp,
  times: UTCTimestamp[],
  interval: MarketChartInterval,
): PulseMarkerResolution {
  if (times.length === 0) {
    return { placement: 'time_only', time: bucketChartTime(value, interval) };
  }
  const bucketTime = bucketChartTime(value, interval);
  if (times.includes(bucketTime)) {
    return { placement: 'inside', time: bucketTime };
  }
  const nearest = nearestLoadedTime(value, times);
  const first = times[0];
  const last = times[times.length - 1];
  if (value >= first && value <= last) {
    return { placement: 'snapped', time: nearest.time };
  }
  if (nearest.distance <= snapToleranceSeconds(interval)) {
    return { placement: 'snapped', time: nearest.time };
  }
  return { placement: 'time_only', time: bucketChartTime(value, interval) };
}

function nearestLoadedTime(
  value: UTCTimestamp,
  times: UTCTimestamp[],
): { distance: number; time: UTCTimestamp } {
  let best = times[0];
  let bestDistance = Math.abs(Number(value) - Number(best));
  for (const time of times) {
    const distance = Math.abs(Number(value) - Number(time));
    if (distance < bestDistance) {
      best = time;
      bestDistance = distance;
    }
  }
  return { distance: bestDistance, time: best };
}

function snapToleranceSeconds(interval: MarketChartInterval): number {
  return Math.max(INTERVAL_SECONDS[interval] * 4, 3600);
}

function bucketChartTime(
  value: UTCTimestamp,
  interval: MarketChartInterval,
): UTCTimestamp {
  const intervalSeconds = INTERVAL_SECONDS[interval];
  return (Math.floor(Number(value) / intervalSeconds) * intervalSeconds) as UTCTimestamp;
}

function toChartTime(value: string | null | undefined): UTCTimestamp | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed / 1000) as UTCTimestamp;
}

function isUtcTimestamp(value: Time | null | undefined): value is UTCTimestamp {
  return typeof value === 'number' && Number.isFinite(value);
}

function legendText(data: unknown, time: Time | undefined): string {
  const dateLabel =
    typeof time === 'number'
      ? formatChartDateTime(time as UTCTimestamp)
      : 'n/a';
  if (isOhlcData(data)) {
    return `${dateLabel}  O ${numberLabel(data.open)}  H ${numberLabel(data.high)}  L ${numberLabel(data.low)}  C ${numberLabel(data.close)}`;
  }
  if (isLineData(data)) {
    return `${dateLabel}  close ${numberLabel(data.value)}`;
  }
  return 'Move crosshair over the chart for OHLCV.';
}

function formatChartAxisTick(
  time: Time,
  tickMarkType: TickMarkType,
): string | null {
  const date = dateFromChartTime(time);
  if (!date) {
    return null;
  }
  return tickMarkType <= 2
    ? MARKET_DAY_FORMATTER.format(date)
    : MARKET_TIME_FORMATTER.format(date);
}

function formatChartDateTime(time: Time): string {
  const date = dateFromChartTime(time);
  return date ? MARKET_DATE_TIME_FORMATTER.format(date) : 'n/a';
}

function dateFromChartTime(time: Time): Date | null {
  if (typeof time === 'number') {
    return new Date(time * 1000);
  }
  if (typeof time === 'string') {
    const parsed = new Date(time);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof time === 'object' &&
    time !== null &&
    'year' in time &&
    'month' in time &&
    'day' in time
  ) {
    const businessDay = time as { day: number; month: number; year: number };
    return new Date(
      Date.UTC(businessDay.year, businessDay.month - 1, businessDay.day),
    );
  }
  return null;
}

function isOhlcData(value: unknown): value is {
  open: number;
  high: number;
  low: number;
  close: number;
} {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Number.isFinite((value as { open?: unknown }).open) &&
      Number.isFinite((value as { high?: unknown }).high) &&
      Number.isFinite((value as { low?: unknown }).low) &&
      Number.isFinite((value as { close?: unknown }).close),
  );
}

function isLineData(value: unknown): value is { value: number } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Number.isFinite((value as { value?: unknown }).value),
  );
}

function numberLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return Intl.NumberFormat(undefined, {
    maximumFractionDigits: PRICE_DECIMAL_PLACES,
    minimumFractionDigits: PRICE_DECIMAL_PLACES,
  }).format(value);
}

export default ThesisMarketChart;
