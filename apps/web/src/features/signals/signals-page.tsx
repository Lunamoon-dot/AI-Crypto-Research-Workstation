'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listSignals } from '@/api/signals';
import { queryKeys } from '@/api/query-keys';
import { useAuth } from '@/auth/auth-provider';
import { ConfidenceBadge, DirectionBadge } from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';

export function SignalsPage() {
  const auth = useAuth();
  const [symbol, setSymbol] = useState('');
  const query = useQuery({
    queryKey: queryKeys.signals({ symbol, limit: 100 }),
    queryFn: () => listSignals({ symbol: symbol || undefined, limit: 100 }, auth),
  });

  return (
    <main className="page">
      <PageHeader
        title="Signal explorer"
        description="Inspect deterministic evidence and source timestamps."
      />
      <Panel title="Filters">
        <label className="label">
          Symbol
          <input
            className="input"
            placeholder="BTC"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </label>
      </Panel>
      <div style={{ height: 14 }} />
      <Panel title="Signals">
        {query.isLoading ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} /> : null}
        {query.data?.length === 0 ? <EmptyState label="No signals found." /> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Observed</th>
                <th>Symbol</th>
                <th>Type</th>
                <th>Direction</th>
                <th>Confidence</th>
                <th>Source</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((signal) => (
                <tr key={signal.id ?? `${signal.symbol}-${signal.observed_at}`}>
                  <td>{formatDateTime(signal.observed_at)}</td>
                  <td><strong>{signal.symbol}</strong></td>
                  <td>{signal.signal_type}</td>
                  <td><DirectionBadge value={signal.direction} /></td>
                  <td><ConfidenceBadge value={signal.confidence} /></td>
                  <td>
                    {signal.source}
                    <div className="small muted">{formatDateTime(signal.source_timestamp)}</div>
                  </td>
                  <td>{signal.summary || 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
