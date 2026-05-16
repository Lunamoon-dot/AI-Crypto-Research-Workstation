import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  ClipboardList,
  FileText,
  Radar,
  Signal,
  TrendingUp,
} from 'lucide-react';
import { listAlerts } from '@/services/alerts';
import { listDailyBriefs } from '@/services/briefs';
import { queryKeys } from '@/services/query-keys';
import { listResearchRuns } from '@/services/research-runs';
import { listSignals } from '@/services/signals';
import { listTheses } from '@/services/theses';
import { listWatchlists } from '@/services/watchlists';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid } from '@/components/research/bento';
import { DirectionBadge, ConfidenceBadge, StatusBadge } from '@/components/research/badges';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

export function WorkbenchPage() {
  const auth = useWorkspaceStore();
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

  const latestBrief = briefs.data?.[0];

  return (
    <main className="page">
      <PageHeader
        eyebrow="01 Workbench"
        title="Daily operating view"
        description="Briefs, thesis review, signals, and runs."
        action={
          <div className="page-header-action-stack">
            <HeaderStats
              stats={[
                {
                  icon: <FileText aria-hidden size={14} />,
                  label: 'Latest brief',
                  meta: latestBrief?.brief_date ?? 'No brief available',
                  tone: 'primary',
                  value: briefs.isLoading ? '...' : latestBrief ? 'Ready' : 'None',
                },
                {
                  icon: <TrendingUp aria-hidden size={14} />,
                  label: 'Open theses',
                  meta: 'Latest artifacts',
                  tone: 'constructive',
                  value: theses.isLoading ? '...' : theses.data?.length ?? 0,
                },
                {
                  icon: <Signal aria-hidden size={14} />,
                  label: 'Signals',
                  meta: 'Evidence feed',
                  tone: 'warning',
                  value: signals.isLoading ? '...' : signals.data?.length ?? 0,
                },
                {
                  icon: <Bell aria-hidden size={14} />,
                  label: 'Unread alerts',
                  meta: 'Watchlist changes',
                  tone: 'risk',
                  value: alerts.isLoading ? '...' : alerts.data?.length ?? 0,
                },
              ]}
            />
            <Link className="button primary" to={routes.researchNew}>
              <Radar aria-hidden size={16} />
              New research run
            </Link>
          </div>
        }
      />

      <BentoGrid>
        <Panel className="span-7 emphasis" title="Latest brief" description="Daily market context">
          {briefs.isLoading ? <LoadingState /> : null}
          {briefs.isError ? <ErrorState error={briefs.error} /> : null}
          {briefs.data?.length === 0 ? (
            <EmptyState label="No daily brief has been written yet." />
          ) : null}
          {latestBrief ? (
            <div className="stack lg">
              <div className="row start">
                <div>
                  <h3 style={{ margin: 0 }}>{latestBrief.title || 'Untitled brief'}</h3>
                  <div className="small muted">
                    {latestBrief.watchlist_name || 'default'} | {formatDateTime(latestBrief.created_at)}
                  </div>
                </div>
                <span className="badge primary">{latestBrief.brief_date ?? 'n/a'}</span>
              </div>
              <p className="muted" style={{ margin: 0 }}>{latestBrief.summary || 'No summary.'}</p>
              <div className="grid two">
                {latestBrief.key_points.slice(0, 4).map((point) => (
                  <div className="state-card" key={point}>{point}</div>
                ))}
              </div>
              <Link className="button" to={routes.briefsDaily}>
                Open archive
              </Link>
            </div>
          ) : null}
        </Panel>

        <Panel className="span-5" title="Thesis inbox" description="Items needing human review">
          {theses.isLoading ? <LoadingState /> : null}
          {theses.isError ? <ErrorState error={theses.error} /> : null}
          {theses.data?.length === 0 ? (
            <EmptyState label="No theses yet. Run research first." />
          ) : null}
          <div className="stack">
            {theses.data?.slice(0, 5).map((thesis) => (
              <Link
                className="list-row"
                to={routes.thesis(thesis.id ?? '')}
                key={thesis.id ?? thesis.symbol}
              >
                <div className="row">
                  <strong>{thesis.symbol}</strong>
                  <DirectionBadge value={thesis.direction} />
                </div>
                <div className="row small">
                  <span className="muted">{thesis.setup_type}</span>
                  <ConfidenceBadge value={thesis.confidence} />
                </div>
                <div className="small muted">Invalidation: {thesis.invalidation_level || 'n/a'}</div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel className="span-8" title="Composite signal board" description="Latest source-backed signal cards">
          {signals.isLoading ? <LoadingState /> : null}
          {signals.isError ? <ErrorState error={signals.error} /> : null}
          {signals.data?.length === 0 ? <EmptyState label="No signals yet." /> : null}
          <div className="grid two">
            {signals.data?.slice(0, 6).map((signal) => (
              <div className="state-card" key={signal.id ?? `${signal.symbol}-${signal.observed_at}`}>
                <div className="row">
                  <strong>{signal.symbol}</strong>
                  <DirectionBadge value={signal.direction} />
                </div>
                <div className="small muted">
                  {signal.signal_type} | {signal.source}
                </div>
                <div className="small">{signal.summary || 'No summary.'}</div>
                <div className="small muted">{formatDateTime(signal.observed_at)}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="span-4" title="Unread alerts" description="Alerts requiring attention">
          {alerts.isLoading ? <LoadingState /> : null}
          {alerts.isError ? <ErrorState error={alerts.error} /> : null}
          {alerts.data?.length === 0 ? <EmptyState label="No unread alerts." /> : null}
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

        <Panel className="span-6" title="Recent runs" description="Persisted research jobs">
          {runs.isLoading ? <LoadingState /> : null}
          {runs.isError ? <ErrorState error={runs.error} /> : null}
          {runs.data?.length === 0 ? <EmptyState label="No research runs found." /> : null}
          <div className="stack">
            {runs.data?.slice(0, 6).map((run) => (
              <Link
                className="list-row"
                to={routes.researchRun(run.run_id ?? run.id ?? '')}
                key={run.id ?? run.run_id ?? `${run.symbol}-${run.started_at}`}
              >
                <div className="row">
                  <strong>{run.symbol}</strong>
                  <StatusBadge value={run.status} />
                </div>
                <div className="small muted">
                  {run.market_type} | {formatDateTime(run.started_at)}
                </div>
                <div className="small muted">Thesis: {run.thesis_id ?? 'pending'}</div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel className="span-6" title="Watchlists" description="Monitoring scopes">
          {watchlists.isLoading ? <LoadingState /> : null}
          {watchlists.isError ? <ErrorState error={watchlists.error} /> : null}
          {watchlists.data?.length === 0 ? (
            <EmptyState label="No watchlists found." />
          ) : null}
          <div className="stack">
            {watchlists.data?.slice(0, 6).map((watchlist) => (
              <div className="list-row" key={watchlist.id ?? watchlist.name}>
                <div className="row">
                  <strong>{watchlist.name}</strong>
                  <span className={watchlist.enabled ? 'badge constructive' : 'badge'}>
                    {watchlist.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div className="small muted">
                  <ClipboardList aria-hidden size={13} /> {formatDateTime(watchlist.created_at)}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}
