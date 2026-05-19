import type {
  MarketChartInterval,
  MarketOhlcvCandleResponse,
} from '@/types';

export type MarketRealtimeProvider = 'binance' | 'bitget';
export type MarketRealtimeMarketType = 'spot' | 'perp';
export type MarketRealtimeState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'unavailable'
  | 'error';

export type MarketRealtimeStatus = {
  message: string;
  provider?: MarketRealtimeProvider;
  state: MarketRealtimeState;
};

export type MarketRealtimeTrade = {
  price: number;
  size: number | null;
  time: string;
};

export type MarketRealtimeSubscription = {
  interval: MarketChartInterval;
  marketType: MarketRealtimeMarketType;
  onCandle: (candle: MarketOhlcvCandleResponse) => void;
  onStatus?: (status: MarketRealtimeStatus) => void;
  onTrade?: (trade: MarketRealtimeTrade) => void;
  provider: MarketRealtimeProvider;
  symbol: string;
};

type SocketConnection = {
  provider: MarketRealtimeProvider;
  subscribeMessage?: unknown;
  url: string;
};

const MAX_RECONNECT_ATTEMPTS = 4;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000];

export function subscribeMarketCandles({
  interval,
  marketType,
  onCandle,
  onStatus,
  onTrade,
  provider,
  symbol,
}: MarketRealtimeSubscription): () => void {
  if (typeof WebSocket === 'undefined') {
    onStatus?.({
      message: 'Realtime socket is unavailable in this browser.',
      provider,
      state: 'unavailable',
    });
    return () => undefined;
  }

  const connection = marketSocketConnection({
    interval,
    marketType,
    provider,
    symbol,
  });
  if (!connection) {
    onStatus?.({
      message: 'Realtime socket cannot be opened for this market.',
      provider,
      state: 'unavailable',
    });
    return () => undefined;
  }
  const activeConnection = connection;

  let closed = false;
  let reconnectAttempts = 0;
  let reconnectTimer: number | undefined;
  let pingTimer: number | undefined;
  let socket: WebSocket | null = null;

  function clearTimers() {
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (pingTimer !== undefined) {
      window.clearInterval(pingTimer);
      pingTimer = undefined;
    }
  }

  function connect() {
    if (closed) {
      return;
    }

    onStatus?.({
      message:
        reconnectAttempts > 0
          ? `Reconnecting ${provider} realtime candles.`
          : `Connecting ${provider} realtime candles.`,
      provider,
      state: reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
    });

    socket = new WebSocket(activeConnection.url);

    socket.onopen = () => {
      reconnectAttempts = 0;
      onStatus?.({
        message: `${provider} realtime candles connected.`,
        provider,
        state: 'connected',
      });
      if (activeConnection.subscribeMessage) {
        socket?.send(JSON.stringify(activeConnection.subscribeMessage));
      }
      if (provider === 'bitget') {
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send('ping');
          }
        }, 30_000);
      }
    };

    socket.onmessage = (event) => {
      if (closed) {
        return;
      }
      try {
        const update = parseRealtimeUpdate(provider, event.data);
        for (const candle of update.candles) {
          onCandle(candle);
        }
        for (const trade of update.trades) {
          onTrade?.(trade);
        }
      } catch (error) {
        onStatus?.({
          message: realtimeErrorMessage(error),
          provider,
          state: 'error',
        });
      }
    };

    socket.onerror = () => {
      if (closed) {
        return;
      }
      onStatus?.({
        message: `${provider} realtime socket error.`,
        provider,
        state: 'error',
      });
    };

    socket.onclose = () => {
      if (pingTimer !== undefined) {
        window.clearInterval(pingTimer);
        pingTimer = undefined;
      }
      if (closed) {
        return;
      }
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        onStatus?.({
          message: `${provider} realtime candles disconnected.`,
          provider,
          state: 'closed',
        });
        return;
      }
      const delayMs =
        RECONNECT_DELAYS_MS[
          Math.min(reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)
        ];
      reconnectAttempts += 1;
      onStatus?.({
        message: `Reconnecting ${provider} realtime candles.`,
        provider,
        state: 'reconnecting',
      });
      reconnectTimer = window.setTimeout(connect, delayMs);
    };
  }

  connect();

  return () => {
    closed = true;
    clearTimers();
    socket?.close();
    socket = null;
  };
}

export function normalizeMarketRealtimeProvider(
  value: string | null | undefined,
): MarketRealtimeProvider | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'binance' || normalized === 'bitget') {
    return normalized;
  }
  return undefined;
}

function marketSocketConnection({
  interval,
  marketType,
  provider,
  symbol,
}: {
  interval: MarketChartInterval;
  marketType: MarketRealtimeMarketType;
  provider: MarketRealtimeProvider;
  symbol: string;
}): SocketConnection | null {
  const exchangeSymbol = toExchangeSymbol(symbol);
  if (!exchangeSymbol) {
    return null;
  }

  if (provider === 'binance') {
    const streamPath = `${exchangeSymbol.toLowerCase()}@kline_${interval}/${exchangeSymbol.toLowerCase()}@trade`;
    const baseUrl =
      marketType === 'perp'
        ? envUrl(
            'VITE_MARKET_WS_BINANCE_PERP_STREAM_URL',
            'wss://fstream.binance.com/stream',
          )
        : envUrl(
            'VITE_MARKET_WS_BINANCE_SPOT_STREAM_URL',
            'wss://stream.binance.com:9443/stream',
          );
    return {
      provider,
      url: `${baseUrl}?streams=${streamPath}`,
    };
  }

  return {
    provider,
    subscribeMessage: {
      op: 'subscribe',
      args: [
        {
          instType: marketType === 'perp' ? 'USDT-FUTURES' : 'SPOT',
          channel: bitgetCandleChannel(interval),
          instId: exchangeSymbol,
        },
        {
          instType: marketType === 'perp' ? 'USDT-FUTURES' : 'SPOT',
          channel: 'trade',
          instId: exchangeSymbol,
        },
      ],
    },
    url: envUrl('VITE_MARKET_WS_BITGET_URL', 'wss://ws.bitget.com/v2/ws/public'),
  };
}

function parseRealtimeUpdate(
  provider: MarketRealtimeProvider,
  payload: unknown,
): { candles: MarketOhlcvCandleResponse[]; trades: MarketRealtimeTrade[] } {
  if (typeof payload !== 'string' || payload === 'pong') {
    return { candles: [], trades: [] };
  }
  const parsed = JSON.parse(payload) as unknown;
  return provider === 'bitget'
    ? bitgetRealtimeUpdate(parsed)
    : binanceRealtimeUpdate(parsed);
}

function binanceRealtimeUpdate(value: unknown): {
  candles: MarketOhlcvCandleResponse[];
  trades: MarketRealtimeTrade[];
} {
  const data = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(data)) {
    return { candles: [], trades: [] };
  }
  if (isRecord(data.k)) {
    const kline = data.k;
    const candle = candleFromValues(
      kline.t,
      kline.o,
      kline.h,
      kline.l,
      kline.c,
      kline.v,
    );
    return { candles: candle ? [candle] : [], trades: [] };
  }
  if (data.e === 'trade') {
    const trade = tradeFromValues(data.T, data.p, data.q);
    return { candles: [], trades: trade ? [trade] : [] };
  }
  return { candles: [], trades: [] };
}

function bitgetRealtimeUpdate(value: unknown): {
  candles: MarketOhlcvCandleResponse[];
  trades: MarketRealtimeTrade[];
} {
  if (!isRecord(value)) {
    return { candles: [], trades: [] };
  }
  if (value.event === 'error') {
    throw new Error(String(value.msg ?? 'Bitget realtime subscription failed.'));
  }
  if (!Array.isArray(value.data)) {
    return { candles: [], trades: [] };
  }
  const channel = isRecord(value.arg) ? String(value.arg.channel ?? '') : '';
  if (channel === 'trade') {
    return {
      candles: [],
      trades: value.data
        .map((row) =>
          isRecord(row) ? tradeFromValues(row.ts, row.price, row.size) : null,
        )
        .filter((trade): trade is MarketRealtimeTrade => Boolean(trade)),
    };
  }
  return {
    candles: value.data
      .map((row) =>
        Array.isArray(row)
          ? candleFromValues(row[0], row[1], row[2], row[3], row[4], row[5])
          : null,
      )
      .filter((candle): candle is MarketOhlcvCandleResponse => Boolean(candle)),
    trades: [],
  };
}

function candleFromValues(
  timeMsValue: unknown,
  openValue: unknown,
  highValue: unknown,
  lowValue: unknown,
  closeValue: unknown,
  volumeValue: unknown,
): MarketOhlcvCandleResponse | null {
  const timeMs = numberValue(timeMsValue);
  const open = numberValue(openValue);
  const high = numberValue(highValue);
  const low = numberValue(lowValue);
  const close = numberValue(closeValue);
  const volume = nullableNumberValue(volumeValue);
  if (
    timeMs === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === 'invalid'
  ) {
    return null;
  }
  return {
    time: new Date(timeMs).toISOString(),
    open,
    high,
    low,
    close,
    volume,
  };
}

function tradeFromValues(
  timeMsValue: unknown,
  priceValue: unknown,
  sizeValue: unknown,
): MarketRealtimeTrade | null {
  const timeMs = numberValue(timeMsValue);
  const price = numberValue(priceValue);
  const size = nullableNumberValue(sizeValue);
  if (timeMs === null || price === null || size === 'invalid') {
    return null;
  }
  return {
    time: new Date(timeMs).toISOString(),
    price,
    size,
  };
}

function bitgetCandleChannel(interval: MarketChartInterval): string {
  const channels: Record<MarketChartInterval, string> = {
    '1m': 'candle1m',
    '5m': 'candle5m',
    '15m': 'candle15m',
    '1h': 'candle1H',
    '4h': 'candle4H',
    '1d': 'candle1D',
  };
  return channels[interval];
}

function envUrl(name: string, fallback: string): string {
  const value = import.meta.env[name] as string | undefined;
  return String(value || fallback).replace(/\/+$/, '');
}

function toExchangeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableNumberValue(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 'invalid';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function realtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
