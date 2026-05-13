'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listAlerts } from '@/api/alerts';
import { listDailyBriefs } from '@/api/briefs';
import { queryKeys } from '@/api/query-keys';
import { listResearchRuns } from '@/api/research-runs';
import { listSignals } from '@/api/signals';
import { listTheses } from '@/api/theses';
import { listWatchlists } from '@/api/watchlists';
import { useAuth } from '@/auth/auth-provider';
import { DirectionBadge, ConfidenceBadge } from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

export function WorkbenchPage() {
  const auth = useAuth();
  const briefs = useQuery({
    queryKey: queryKeys.dailyBriefs({ limit: 1 }),
    queryFn: () => listDailyBriefs({ limit: 1 }, auth),
  });
  const alerts = useQuery({
    queryKey: queryKeys.alerts({ unread: true, limit: 8 }),
    queryFn: () => listAlerts({ unread: true, limit: 8 }, auth),
  });
  const theses = useQuery({
    queryKey: queryKeys.theses({ limit: 8 }),
    queryFn: () => listTheses({ limit: 8 }, auth),
  });
  const signals = useQuery({
    queryKey: queryKeys.signals({ limit: 12 }),
    queryFn: () => listSignals({ limit: 12 }, auth),
  });
  const watchlists = useQuery({
    queryKey: queryKeys.watchlists({ limit: 8 }),
    queryFn: () => listWatchlists({ limit: 8 }, auth),
  });
  const runs = useQuery({
    queryKey: queryKeys.researchRuns({ limit: 8 }),
    queryFn: () => listResearchRuns({ limit: 8 }, auth),
  });

  return (
    <main className="page">
      <PageHeader
        title="Workbench"
        description="Daily research command center backed by the current API."
        action={
          <Link className="button primary" href={routes.researchNew}>
            Run research
          </Link>
        }
      />
      <div className="grid two">
        <Panel title="Latest brief" description="Daily market context">
          {briefs.isLoading ? <LoadingState /> : null}
          {briefs.isError ? <ErrorState error={briefs.error} /> : null}
          {briefs.data?.length === 0 ? (
            <EmptyState label="No daily brief has been written yet." />
          ) : null}
          {briefs.data?.[0] ? (
            <div className="stack">
              <div className="row">
                <strong>{briefs.data[0].title || 'Untitled brief'}</strong>
                <span className="badge">{briefs.data[0].brief_date ?? 'n/a'}</span>
              </div>
              <p className="muted">{briefs.data[0].summary || 'No summary.'}</p>
              <div className="stack">
                {briefs.data[0].key_points.slice(0, 4).map((point) => (
                  <div className="small" key={point}>
                    {point}
                  </div>
                ))}
              </div>
              <Link className="button" href={routes.briefsDaily}>
                Open briefs
              </Link>
            </div>
          ) : null}
        </Panel>

        <Panel title="Unread alerts" description="Research updates to inspect">
          {alerts.isLoading ? <LoadingState /> : null}
          {alerts.isError ? <ErrorState error={alerts.error} /> : null}
          {alerts.data?.length === 0 ? (
            <EmptyState label="No unread alerts." />
          ) : null}
          <div className="stack">
            {alerts.data?.slice(0, 8).map((alert) => (
              <div className="list-row" key={alert.id ?? alert.message}>
                <div className="row">
                  <strong>{alert.symbol || 'n/a'}</strong>
                  <span className="badge warning">{alert.alert_type}</span>
                </div>
                <div className="small">{alert.message}</div>
                <div className="small muted">{formatDateTime(alert.created_at)}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent theses" description="Latest research artifacts">
          {theses.isLoading ? <LoadingState /> : null}
          {theses.isError ? <ErrorState error={theses.error} /> : null}
          {theses.data?.length === 0 ? (
            <EmptyState label="No theses yet. Run research first." />
          ) : null}
          <div className="stack">
            {theses.data?.slice(0, 8).map((thesis) => (
              <Link
                className="list-row"
                href={routes.thesis(thesis.id ?? '')}
                key={thesis.id ?? thesis.symbol}
              >
                <div className="row">
                  <strong>{thesis.symbol}</strong>
                  <DirectionBadge value={thesis.direction} />
                </div>
                <div className="row small">
                  <span>{thesis.setup_type}</span>
                  <ConfidenceBadge value={thesis.confidence} />
                </div>
                <div className="small muted">Invalidation: {thesis.invalidation_level || 'n/a'}</div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Recent runs" description="Research jobs persisted by the API">
          {runs.isLoading ? <LoadingState /> : null}
          {runs.isError ? <ErrorState error={runs.error} /> : null}
          {runs.data?.length === 0 ? (
            <EmptyState label="No research runs found." />
          ) : null}
          <div className="stack">
            {runs.data?.map((run) => (
              <Link
                className="list-row"
                href={routes.researchRun(run.run_id ?? run.id ?? '')}
                key={run.id ?? run.run_id ?? `${run.symbol}-${run.started_at}`}
              >
                <div className="row">
                  <strong>{run.symbol}</strong>
                  <span className="badge">{run.status}</span>
                </div>
                <div className="small muted">
                  {run.market_type} | {formatDateTime(run.started_at)}
                </div>
                <div className="small muted">
                  Thesis: {run.thesis_id ?? 'pending'}
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Signals" description="Deterministic evidence feed">
          {signals.isLoading ? <LoadingState /> : null}
          {signals.isError ? <ErrorState error={signals.error} /> : null}
          {signals.data?.length === 0 ? <EmptyState label="No signals yet." /> : null}
          <div className="stack">
            {signals.data?.slice(0, 10).map((signal) => (
              <div className="list-row" key={signal.id ?? `${signal.symbol}-${signal.observed_at}`}>
                <div className="row">
                  <strong>{signal.symbol}</strong>
                  <DirectionBadge value={signal.direction} />
                </div>
                <div className="small muted">
                  {signal.signal_type} | {signal.source} | {formatDateTime(signal.observed_at)}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Watchlists" description="Monitoring scopes">
          {watchlists.isLoading ? <LoadingState /> : null}
          {watchlists.isError ? <ErrorState error={watchlists.error} /> : null}
          {watchlists.data?.length === 0 ? (
            <EmptyState label="No watchlists found." />
          ) : null}
          <div className="stack">
            {watchlists.data?.map((watchlist) => (
              <div className="list-row" key={watchlist.id ?? watchlist.name}>
                <div className="row">
                  <strong>{watchlist.name}</strong>
                  <span className={watchlist.enabled ? 'badge constructive' : 'badge'}>
                    {watchlist.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div className="small muted">{formatDateTime(watchlist.created_at)}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}
