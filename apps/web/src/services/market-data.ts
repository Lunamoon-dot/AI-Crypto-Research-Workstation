import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  MarketChartInterval,
  MarketOhlcvResponse,
} from '@/types';

export function getMarketOhlcv(
  auth: WorkspaceRequestContext,
  params: {
    symbol: string;
    market_type?: 'spot' | 'perp';
    provider?: 'binance' | 'bitget';
    exchange?: string;
    interval?: MarketChartInterval;
    from?: string;
    to?: string;
    limit?: number;
  },
): Promise<MarketOhlcvResponse> {
  return apiRequest<MarketOhlcvResponse>(
    '/market-data/ohlcv',
    {
      query: {
        symbol: params.symbol,
        market_type: params.market_type ?? 'spot',
        provider: params.provider,
        exchange: params.exchange,
        interval: params.interval ?? '15m',
        from: params.from,
        to: params.to,
        limit: params.limit,
      },
    },
    auth,
  );
}
