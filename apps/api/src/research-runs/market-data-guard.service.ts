import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { runPythonEngineJson } from '../jobs/python-engine.client';

export interface MarketDataGuardRequest {
  symbol: string;
  assetClass: string;
  marketType: 'spot' | 'perp';
  analysisDate: string;
  configProfile: string;
  exchange: string | null;
}

@Injectable()
export class MarketDataGuardService {
  async assertAvailable(request: MarketDataGuardRequest): Promise<void> {
    if (request.assetClass.trim().toLowerCase() !== 'crypto') {
      return;
    }
    if (isDisabled()) {
      return;
    }

    const result = await validateMarketData(request);
    if (result.available === true) {
      return;
    }

    const message =
      stringField(result.message) ??
      `Market data is unavailable for ${request.symbol}; research was not queued.`;
    if (result.retryable === true) {
      throw new ServiceUnavailableException(message);
    }
    throw new BadRequestException(message);
  }
}

async function validateMarketData(
  request: MarketDataGuardRequest,
): Promise<Record<string, unknown>> {
  try {
    return await runPythonEngineJson(validationArgs(request), {
      timeoutMs: resolveValidationTimeoutMs(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown validation error.';
    throw new ServiceUnavailableException(
      `Could not verify market data for ${request.symbol}; research was not queued: ${detail}`,
    );
  }
}

function validationArgs(request: MarketDataGuardRequest): string[] {
  const args = [
    'validate-market',
    '--symbol',
    request.symbol,
    '--analysis-date',
    request.analysisDate,
    '--asset-class',
    request.assetClass,
    '--market-type',
    request.marketType,
  ];
  const profile = request.configProfile.trim();
  if (profile && profile.toLowerCase() !== 'default') {
    args.push('--profile', profile);
  }
  if (request.exchange) {
    args.push('--exchange', request.exchange);
  }
  return args;
}

function resolveValidationTimeoutMs(): number {
  const raw = Number(process.env.MARKET_DATA_GUARD_TIMEOUT_MS ?? 30_000);
  if (!Number.isFinite(raw) || raw < 5_000) {
    return 30_000;
  }
  return Math.trunc(raw);
}

function isDisabled(): boolean {
  return ['1', 'true', 'yes'].includes(
    String(process.env.MARKET_DATA_GUARD_DISABLED ?? '').trim().toLowerCase(),
  );
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
