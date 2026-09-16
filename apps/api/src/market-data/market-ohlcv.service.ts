import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { normalizeCryptoSymbol } from '../common/market-symbols';

export type MarketChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type MarketType = 'spot' | 'perp';
export type MarketOhlcvProvider = 'binance' | 'bitget';

export interface MarketOhlcvCandleResponse {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface MarketOhlcvResponse {
  symbol: string;
  market_type: MarketType;
  interval: MarketChartInterval;
  from: string;
  to: string;
  source: string;
  provider: string;
  generated_at: string;
  candles: MarketOhlcvCandleResponse[];
  warning: string | null;
}

export interface MarketOhlcvRequest {
  workspaceId: string;
  symbol?: string;
  marketType?: string;
  interval?: string;
  from?: string;
  to?: string;
  limit?: string;
  provider?: string;
  exchange?: string;
}

type NormalizedOhlcvRequest = {
  workspaceId: string;
  symbol: string;
  marketType: MarketType;
  provider: MarketOhlcvProvider;
  interval: MarketChartInterval;
  from: Date;
  to: Date;
  pageLimit: number;
  estimatedCandles: number;
};

type CachedOhlcv = {
  expiresAt: number;
  response: MarketOhlcvResponse;
};

const INTERVAL_MS: Record<MarketChartInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

const DEFAULT_RANGE_MS: Record<MarketChartInterval, number> = {
  '1m': 6 * 60 * 60_000,
  '5m': 24 * 60 * 60_000,
  '15m': 3 * 24 * 60 * 60_000,
  '1h': 14 * 24 * 60 * 60_000,
  '4h': 60 * 24 * 60 * 60_000,
  '1d': 365 * 24 * 60 * 60_000,
};

const MARKET_INTERVALS = new Set<string>(Object.keys(INTERVAL_MS));
const PROVIDER_PAGE_LIMITS: Record<MarketOhlcvProvider, number> = {
  binance: 1000,
  bitget: 1000,
};

@Injectable()
export class MarketOhlcvService {
  private readonly cache = new Map<string, CachedOhlcv>();

  async getOhlcv(request: MarketOhlcvRequest): Promise<MarketOhlcvResponse> {
    const normalized = normalizeRequest(request);
    const generatedAt = new Date().toISOString();

    if (!envFlag('OHLCV_REFRESH_ENABLED', true)) {
      return {
        symbol: normalized.symbol,
        market_type: normalized.marketType,
        interval: normalized.interval,
        from: normalized.from.toISOString(),
        to: normalized.to.toISOString(),
        source: 'disabled',
        provider: normalized.provider,
        generated_at: generatedAt,
        candles: [],
        warning: 'OHLCV refresh is disabled.',
      };
    }

    const cacheKey = ohlcvCacheKey(normalized);
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.response;
    }

    const provider = await this.fetchProviderCandles(normalized);
    const response: MarketOhlcvResponse = {
      symbol: normalized.symbol,
      market_type: normalized.marketType,
      interval: normalized.interval,
      from: normalized.from.toISOString(),
      to: normalized.to.toISOString(),
      source: provider.source,
      provider: provider.provider,
      generated_at: generatedAt,
      candles: provider.candles,
      warning:
        provider.candles.length === 0
          ? 'Provider returned no usable OHLCV candles.'
          : null,
    };
    this.remember(cacheKey, response);
    return response;
  }

  private async fetchProviderCandles(request: NormalizedOhlcvRequest): Promise<{
    source: string;
    provider: string;
    candles: MarketOhlcvCandleResponse[];
  }> {
    const candlesByTime = new Map<number, MarketOhlcvCandleResponse>();
    const intervalMs = INTERVAL_MS[request.interval];
    const finalToMs = request.to.getTime();
    const maxPages = Math.ceil(request.estimatedCandles / request.pageLimit) + 2;
    let pageFromMs = request.from.getTime();
    let pagesFetched = 0;

    try {
      while (pageFromMs < finalToMs && pagesFetched < maxPages) {
        pagesFetched += 1;
        const pageToMs = Math.min(
          finalToMs,
          pageFromMs + request.pageLimit * intervalMs,
        );
        if (pageToMs <= pageFromMs) {
          break;
        }
        const pageCandles = await this.fetchProviderPage(
          request,
          new Date(pageFromMs),
          new Date(pageToMs),
        );
        const pageTimes: number[] = [];
        for (const candle of pageCandles) {
          const timeMs = Date.parse(candle.time);
          if (
            !Number.isFinite(timeMs) ||
            timeMs < request.from.getTime() ||
            timeMs > finalToMs
          ) {
            continue;
          }
          pageTimes.push(timeMs);
          candlesByTime.set(timeMs, candle);
        }
        if (pageTimes.length === 0) {
          pageFromMs = pageToMs;
          continue;
        }
        pageFromMs = Math.max(...pageTimes) + intervalMs;
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        `OHLCV provider request failed: ${errorMessage(error)}`,
      );
    }

    return {
      source: providerSource(request.provider, request.marketType),
      provider: request.provider,
      candles: [...candlesByTime.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, candle]) => candle),
    };
  }

  private async fetchProviderPage(
    request: NormalizedOhlcvRequest,
    from: Date,
    to: Date,
  ): Promise<MarketOhlcvCandleResponse[]> {
    const url =
      request.provider === 'bitget'
        ? bitgetCandlesUrl(request, from, to)
        : binanceKlinesUrl(request, from, to);
    const raw = await this.fetchJson(url);
    return request.provider === 'bitget'
      ? normalizeBitgetPayload(raw)
      : normalizeBinancePayload(raw);
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      numberEnv('OHLCV_TIMEOUT_MS', 4000),
    );
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `OHLCV provider returned HTTP ${response.status}.`,
        );
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }

  private remember(cacheKey: string, response: MarketOhlcvResponse): void {
    const ttlMs = numberEnv('OHLCV_CACHE_TTL_MS', 30_000);
    if (ttlMs <= 0) {
      return;
    }
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + ttlMs,
      response,
    });
    const maxEntries = Math.max(1, numberEnv('OHLCV_CACHE_MAX_ENTRIES', 200));
    while (this.cache.size > maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }
}

function normalizeRequest(request: MarketOhlcvRequest): NormalizedOhlcvRequest {
  const symbol = String(request.symbol ?? '').trim();
  if (!symbol) {
    throw new BadRequestException('symbol is required.');
  }
  const normalizedSymbol = normalizeCryptoSymbol(symbol);
  const marketType = normalizeMarketType(request.marketType);
  const provider = normalizeProvider(request.provider, request.exchange);
  const interval = normalizeInterval(request.interval);
  const to = parseDateQuery(request.to, 'to') ?? new Date();
  const requestedFrom =
    parseDateQuery(request.from, 'from') ??
    new Date(to.getTime() - DEFAULT_RANGE_MS[interval]);
  if (requestedFrom.getTime() >= to.getTime()) {
    throw new BadRequestException('from must be before to.');
  }

  const providerLimitCap = PROVIDER_PAGE_LIMITS[provider];
  const limitCap = Math.min(
    Math.max(numberEnv('OHLCV_MAX_LIMIT', providerLimitCap), 1),
    providerLimitCap,
  );
  const pageLimit = normalizeLimit(request.limit, limitCap);
  const estimatedCandles = Math.ceil(
    (to.getTime() - requestedFrom.getTime()) / INTERVAL_MS[interval],
  );
  const maxRangeCandles = Math.min(
    Math.max(numberEnv('OHLCV_MAX_RANGE_CANDLES', 5000), 1),
    10_000,
  );
  if (estimatedCandles > maxRangeCandles) {
    throw new BadRequestException(
      `Range is too large for ${interval}; narrow the date range or use a larger interval.`,
    );
  }

  return {
    workspaceId: String(request.workspaceId || 'local'),
    symbol: normalizedSymbol,
    marketType,
    provider,
    interval,
    from: requestedFrom,
    to,
    pageLimit,
    estimatedCandles,
  };
}

function normalizeMarketType(value: string | undefined): MarketType {
  const normalized = String(value ?? 'perp')
    .trim()
    .toLowerCase();
  if (normalized === 'spot' || normalized === 'perp') {
    return normalized;
  }
  throw new BadRequestException('market_type must be spot or perp.');
}

function normalizeProvider(
  provider: string | undefined,
  exchange: string | undefined,
): MarketOhlcvProvider {
  const normalized = String(
    provider ??
      exchange ??
      process.env.OHLCV_PROVIDER ??
      process.env.OHLCV_EXCHANGE ??
      'binance',
  )
    .trim()
    .toLowerCase()
    .replaceAll('_', '-');
  if (normalized === 'binance') {
    return 'binance';
  }
  if (normalized === 'bitget') {
    return 'bitget';
  }
  throw new BadRequestException('provider must be binance or bitget.');
}

function normalizeInterval(value: string | undefined): MarketChartInterval {
  const normalized = String(value ?? '15m').trim();
  if (MARKET_INTERVALS.has(normalized)) {
    return normalized as MarketChartInterval;
  }
  throw new BadRequestException(`Unsupported OHLCV interval: ${normalized}.`);
}

function normalizeLimit(value: string | undefined, limitCap: number): number {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return limitCap;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException('limit must be a positive integer.');
  }
  return Math.min(parsed, limitCap);
}

function parseDateQuery(value: string | undefined, label: string): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException(`${label} must be a valid ISO date.`);
  }
  return parsed;
}

function normalizeBinancePayload(raw: unknown): MarketOhlcvCandleResponse[] {
  if (!Array.isArray(raw)) {
    throw new ServiceUnavailableException(
      'OHLCV provider returned an invalid payload.',
    );
  }
  return normalizeOhlcvRows(raw);
}

function normalizeBitgetPayload(raw: unknown): MarketOhlcvCandleResponse[] {
  if (!isRecord(raw)) {
    throw new ServiceUnavailableException(
      'OHLCV provider returned an invalid payload.',
    );
  }
  const code = String(raw.code ?? '');
  if (code && code !== '00000') {
    throw new ServiceUnavailableException(
      `OHLCV provider returned error ${code}: ${String(raw.msg ?? 'unknown')}`,
    );
  }
  if (!Array.isArray(raw.data)) {
    throw new ServiceUnavailableException(
      'OHLCV provider returned an invalid payload.',
    );
  }
  return normalizeOhlcvRows(raw.data);
}

function normalizeOhlcvRows(rawRows: unknown[]): MarketOhlcvCandleResponse[] {
  const byTime = new Map<number, MarketOhlcvCandleResponse>();
  for (const row of rawRows) {
    if (!Array.isArray(row) || row.length < 6) {
      continue;
    }
    const timeMs = numberValue(row[0]);
    const open = numberValue(row[1]);
    const high = numberValue(row[2]);
    const low = numberValue(row[3]);
    const close = numberValue(row[4]);
    const volume = nullableNumberValue(row[5]);
    if (
      timeMs === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === 'invalid'
    ) {
      continue;
    }
    byTime.set(timeMs, {
      time: new Date(timeMs).toISOString(),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, candle]) => candle);
}

function binanceKlinesUrl(
  request: NormalizedOhlcvRequest,
  from: Date,
  to: Date,
): URL {
  const baseUrl = providerBaseUrl(request.provider, request.marketType);
  const path =
    request.marketType === 'perp' ? '/fapi/v1/klines' : '/api/v3/klines';
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('symbol', toExchangeSymbol(request.symbol));
  url.searchParams.set('interval', request.interval);
  url.searchParams.set('startTime', String(from.getTime()));
  url.searchParams.set('endTime', String(to.getTime()));
  url.searchParams.set('limit', String(request.pageLimit));
  return url;
}

function bitgetCandlesUrl(
  request: NormalizedOhlcvRequest,
  from: Date,
  to: Date,
): URL {
  const baseUrl = providerBaseUrl(request.provider, request.marketType);
  const path =
    request.marketType === 'perp'
      ? '/api/v2/mix/market/candles'
      : '/api/v2/spot/market/candles';
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('symbol', toExchangeSymbol(request.symbol));
  url.searchParams.set('granularity', bitgetGranularity(request.interval, request.marketType));
  url.searchParams.set('startTime', String(from.getTime()));
  url.searchParams.set('endTime', String(to.getTime()));
  url.searchParams.set('limit', String(request.pageLimit));
  if (request.marketType === 'perp') {
    url.searchParams.set(
      'productType',
      String(process.env.OHLCV_BITGET_PRODUCT_TYPE ?? 'usdt-futures'),
    );
  }
  return url;
}

function bitgetGranularity(
  interval: MarketChartInterval,
  marketType: MarketType,
): string {
  if (marketType === 'spot') {
    const spotGranularity: Record<MarketChartInterval, string> = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '1h': '1h',
      '4h': '4h',
      '1d': '1day',
    };
    return spotGranularity[interval];
  }
  const perpGranularity: Record<MarketChartInterval, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1h': '1H',
    '4h': '4H',
    '1d': '1D',
  };
  return perpGranularity[interval];
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

function providerBaseUrl(
  provider: MarketOhlcvProvider,
  marketType: MarketType,
): string {
  if (provider === 'bitget') {
    return String(
      process.env.OHLCV_BITGET_BASE_URL ?? 'https://api.bitget.com',
    ).replace(/\/+$/, '');
  }
  const envName =
    marketType === 'perp' ? 'OHLCV_PERP_BASE_URL' : 'OHLCV_SPOT_BASE_URL';
  const fallback =
    marketType === 'perp' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  return String(process.env[envName] ?? fallback).replace(/\/+$/, '');
}

function providerSource(
  provider: MarketOhlcvProvider,
  marketType: MarketType,
): string {
  return provider === 'bitget'
    ? `bitget:${marketType}:candles`
    : `binance:${marketType}:klines`;
}

function toExchangeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ohlcvCacheKey(request: NormalizedOhlcvRequest): string {
  return [
    request.workspaceId,
    request.symbol,
    request.marketType,
    request.provider,
    request.interval,
    request.from.toISOString(),
    request.to.toISOString(),
    request.pageLimit,
  ].join('|');
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
