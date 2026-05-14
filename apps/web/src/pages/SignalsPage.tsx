import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, Filter, Signal, Table2 } from 'lucide-react';
import { listAlerts } from '@/services/alerts';
import { countSignals, listSignals } from '@/services/signals';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid, MetricTile } from '@/components/research/bento';
import { ConfidenceBadge, DirectionBadge } from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

export function SignalsPage() {
  const auth = useWorkspaceStore();
  const [symbol, setSymbol] = useState('');
  const query = useQuery({
    queryKey: queryKeys.signals({ symbol, limit: 100 }),
    queryFn: () => listSignals({ symbol: symbol || undefined, limit: 100 }, auth),
  });
  const countQuery = useQuery({
    queryKey: queryKeys.signalsCount({ symbol }),
    queryFn: () => countSignals({ symbol: symbol || undefined }, auth),
  });
  const alertsQuery = useQuery({
    queryKey: queryKeys.alerts({ unread: true, limit: 10 }),
    queryFn: () => listAlerts({ unread: true, limit: 10 }, auth),
  });

  const directionCounts = countQuery.data ?? {
    total: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
  };
  const loadedRows = query.data?.length ?? 0;

  return (
    <main className="page">
      <PageHeader
        eyebrow="05 Signals Explorer"
        title="Signal explorer"
        description="Inspect deterministic evidence, source timestamps, and alert pressure in a table-first workspace."
      />

      <BentoGrid>
        <MetricTile
          className="span-4"
          icon={<Signal size={18} />}
          label="Total signals"
          meta={`${directionCounts.bullish} bullish + ${directionCounts.bearish} bearish + ${directionCounts.neutral} neutral/other`}
          tone="primary"
          value={countQuery.isLoading ? '...' : directionCounts.total}
        />
        <MetricTile
          className="span-2"
          label="Bullish"
          tone="constructive"
          value={directionCounts.bullish}
        />
        <MetricTile
          className="span-2"
          label="Bearish"
          tone="risk"
          value={directionCounts.bearish}
        />
        <MetricTile
          className="span-2"
          label="Neutral / other"
          tone="warning"
          value={directionCounts.neutral}
        />
        <MetricTile
          className="span-2"
          icon={<AlertTriangle size={18} />}
          label="Unread alerts"
          tone="warning"
          value={alertsQuery.isLoading ? '...' : alertsQuery.data?.length ?? 0}
        />

        <Panel
          className="span-8 emphasis"
          title="Signals data table"
          description="Filter by symbol and scan confidence, direction, source, and summary"
          action={<Filter aria-hidden size={17} />}
        >
          <label className="label" style={{ marginBottom: 14 }}>
            Symbol
            <input
              className="input"
              placeholder="BTC"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            />
          </label>
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

        <Panel className="span-4" title="Alerts inbox" description="Signal-linked notifications">
          {alertsQuery.isLoading ? <LoadingState /> : null}
          {alertsQuery.isError ? <ErrorState error={alertsQuery.error} /> : null}
          {alertsQuery.data?.length === 0 ? <EmptyState label="No unread alerts." /> : null}
          <div className="stack">
            {alertsQuery.data?.map((alert) => (
              <div className="list-row" key={alert.id ?? alert.message}>
                <div className="row">
                  <strong>{alert.symbol || 'n/a'}</strong>
                  <span className="badge warning">{alert.alert_type}</span>
                </div>
                <div className="small">{alert.message}</div>
                <div className="small muted">{formatDateTime(alert.created_at)}</div>
                {alert.thesis_id ? (
                  <Link className="badge primary" to={routes.thesis(alert.thesis_id)}>
                    open thesis
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="span-12" title="Table footer" description="Current explorer scope">
          <div className="top-strip-meta">
            <span className="badge">
              <Table2 aria-hidden size={14} />
              {loadedRows} of {directionCounts.total} loaded
            </span>
            <span className="badge primary">{symbol || 'all symbols'}</span>
            <span className="badge">API backed</span>
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}
