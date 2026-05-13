'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listTheses } from '@/api/theses';
import { queryKeys } from '@/api/query-keys';
import { useAuth } from '@/auth/auth-provider';
import {
  ConfidenceBadge,
  DirectionBadge,
  IdChip,
} from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

export function ThesisLibrary() {
  const auth = useAuth();
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState('');
  const query = useQuery({
    queryKey: queryKeys.theses({ limit: 100 }),
    queryFn: () => listTheses({ limit: 100 }, auth),
  });

  const theses = useMemo(() => {
    return (query.data ?? []).filter((thesis) => {
      const symbolOk = symbol
        ? thesis.symbol.toLowerCase().includes(symbol.toLowerCase())
        : true;
      const directionOk = direction ? thesis.direction === direction : true;
      return symbolOk && directionOk;
    });
  }, [direction, query.data, symbol]);

  return (
    <main className="page">
      <PageHeader
        title="Thesis library"
        description="Research memory with confidence, invalidation, evidence, and run links."
      />
      <Panel title="Filters">
        <div className="form-grid">
          <label className="label">
            Symbol
            <input
              className="input"
              placeholder="BTC"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            />
          </label>
          <label className="label">
            Direction
            <select
              className="select"
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
            >
              <option value="">All</option>
              <option value="bullish">bullish</option>
              <option value="bearish">bearish</option>
              <option value="neutral">neutral</option>
              <option value="watch">watch</option>
            </select>
          </label>
        </div>
      </Panel>
      <div style={{ height: 14 }} />
      <Panel title="Theses" description={`${theses.length} shown`}>
        {query.isLoading ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} /> : null}
        {query.data?.length === 0 ? <EmptyState label="No theses yet." /> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Setup</th>
                <th>Confidence</th>
                <th>Invalidation</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {theses.map((thesis) => (
                <tr key={thesis.id ?? `${thesis.symbol}-${thesis.created_at}`}>
                  <td>{formatDateTime(thesis.created_at)}</td>
                  <td>
                    <Link href={routes.thesis(thesis.id ?? '')}>
                      <strong>{thesis.symbol}</strong>
                    </Link>
                  </td>
                  <td><DirectionBadge value={thesis.direction} /></td>
                  <td>{thesis.setup_type}</td>
                  <td><ConfidenceBadge value={thesis.confidence} /></td>
                  <td>{thesis.invalidation_level || 'n/a'}</td>
                  <td><IdChip value={thesis.research_run_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
