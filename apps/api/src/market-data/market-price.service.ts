import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { normalizeCryptoSymbol } from '../common/market-symbols';

export type PriceResolution = {
  symbol: string;
  price: number | null;
  source: 'override' | 'live' | 'snapshot' | 'missing';
  snapshot?: JsonRecord;
  warning?: string;
};

@Injectable()
export class MarketPriceService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  async resolveFreshPrice(
    symbol: string,
    workspaceId: string,
    overrides: Record<string, number>,
  ): Promise<PriceResolution> {
    const normalizedSymbol = normalizeCryptoSymbol(symbol);
    const override = priceOverride(normalizedSymbol, overrides);
    if (override !== null) {
      return { symbol: normalizedSymbol, price: override, source: 'override' };
    }

    const liveEnabled = envFlag('PRICE_REFRESH_ON_CHECK', true);
    if (liveEnabled) {
      try {
        const snapshot = await this.refreshExchangePrice(normalizedSymbol, workspaceId);
        return {
          symbol: normalizedSymbol,
          price: numberValue(snapshot.current_price),
          source: 'live',
          snapshot,
        };
      } catch (error) {
        const fallback = await this.snapshotPrice(normalizedSymbol, workspaceId);
        return {
          ...fallback,
          warning: `live price refresh failed for ${normalizedSymbol}: ${errorMessage(error)}`,
        };
      }
    }

    return this.snapshotPrice(normalizedSymbol, workspaceId);
  }

  async refreshExchangePrice(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const ticker = await fetchBinanceTicker(symbol);
    const capturedAt = new Date().toISOString();
    const payload = {
      id: `market_live_${randomUUID().replaceAll('-', '')}`,
      workspace_id: workspaceId,
      research_run_id: null,
      symbol,
      captured_at: capturedAt,
      current_price: ticker.price,
      source: ticker.source,
      source_timestamp: ticker.sourceTimestamp,
      payload: {
        provider: 'binance',
        exchange_symbol: ticker.exchangeSymbol,
        raw: ticker.raw,
      },
    };
    return this.journal.saveMarketSnapshot(payload, workspaceId);
  }

  private async snapshotPrice(
    symbol: string,
    workspaceId: string,
  ): Promise<PriceResolution> {
    const snapshot = await this.journal.getLatestMarketSnapshot(symbol, workspaceId);
    const price = numberValue(snapshot?.current_price);
    return {
      symbol,
      price,
      source: price === null ? 'missing' : 'snapshot',
      snapshot: snapshot ?? undefined,
    };
  }
}

type BinanceTicker = {
  exchangeSymbol: string;
  price: number;
  source: string;
  sourceTimestamp: string;
  raw: JsonRecord;
};

async function fetchBinanceTicker(symbol: string): Promise<BinanceTicker> {
  const exchangeSymbol = toBinanceSymbol(symbol);
  const baseUrl = (
    process.env.PRICE_FEED_BASE_URL ?? 'https://api.binance.com'
  ).replace(/\/+$/, '');
  const timeoutMs = numberEnv('PRICE_FEED_TIMEOUT_MS', 2500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${baseUrl}/api/v3/ticker/price?symbol=${encodeURIComponent(exchangeSymbol)}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`binance ticker returned HTTP ${response.status}`);
    }
    const raw = (await response.json()) as JsonRecord;
    const price = numberValue(raw.price);
    if (price === null) {
      throw new Error(`binance ticker returned no numeric price for ${symbol}`);
    }
    return {
      exchangeSymbol,
      price,
      source: `binance:${exchangeSymbol}`,
      sourceTimestamp: new Date().toISOString(),
      raw,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function toBinanceSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function priceOverride(
  symbol: string,
  overrides: Record<string, number>,
): number | null {
  const candidates = [
    symbol,
    symbol.toUpperCase(),
    symbol.replace('/', ''),
    symbol.replace('/', '').toUpperCase(),
  ];
  for (const key of candidates) {
    const value = overrides[key];
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
