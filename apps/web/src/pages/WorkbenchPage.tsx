import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  Bell,
  ClipboardList,
  Clock3,
  FileText,
  GitBranch,
  ListChecks,
  Radar,
  ScrollText,
  ShieldAlert,
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
import { getWorkbenchAttention } from '@/services/workbench';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid } from '@/components/research/bento';
import { DirectionBadge, ConfidenceBadge, StatusBadge } from '@/components/research/badges';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import type {
  AttentionItemResponse,
  AttentionPriority,
  AttentionQueueResponse,
  BriefResponse,
  ResearchRunResponse,
  ScenarioResponse,
  SignalResponse,
  ThesisResponse,
  WatchlistResponse,
} from '@/types';

const signalTypeLimit = 5;
const signalSymbolLimit = 6;
const attentionPageSize = 5;

export function WorkbenchPage() {
  const auth = useWorkspaceStore();
  const [commandDraft, setCommandDraft] = useState(
    'Review the critical queue, compare it with today brief, then open the highest-risk thesis.',
  );
  const [attentionPages, setAttentionPages] = useState<Record<AttentionPriority, number>>({
    critical: 1,
    review: 1,
    info: 1,
  });
  const attention = useQuery({
    queryKey: queryKeys.workbenchAttention({ limit: 10 }),
    queryFn: () => getWorkbenchAttention({ limit: 10 }, auth),
    staleTime: 30_000,
  });
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
    queryKey: queryKeys.signals({ limit: 24 }),
    queryFn: () => listSignals({ limit: 24 }, auth),
  });
  const watchlists = useQuery({
    queryKey: queryKeys.watchlists({ limit: 8 }),
    queryFn: () => listWatchlists({ limit: 8 }, auth),
  });
  const runs = useQuery({
    queryKey: queryKeys.researchRuns({ limit: 12 }),
    queryFn: () => listResearchRuns({ limit: 12 }, auth),
  });

  const latestBrief = attention.data?.latest_brief ?? briefs.data?.[0];
  const criticalCount =
    attention.data?.queues.find((queue) => queue.priority === 'critical')?.items
      .length ?? 0;
  const reviewCount =
    attention.data?.queues.find((queue) => queue.priority === 'review')?.items
      .length ?? 0;
  const infoCount =
    attention.data?.queues.find((queue) => queue.priority === 'info')?.items.length ?? 0;
  const unreadCount =
    attention.data?.notifications.filter(
      (notification) => notification.status === 'unread',
    ).length ?? 0;
  const degradedRunCount =
    runs.data?.filter(
      (run) =>
        run.status === 'degraded' ||
        (run.degradation_reasons ?? []).length > 0 ||
        (run.missing_core_data ?? []).length > 0,
    ).length ?? 0;

  return (
    <main className="page workbench-page">
      <PageHeader
        eyebrow="01 Workbench"
        title="Research operating desk"
        description="Prioritized attention, morning brief, thesis review, signals, watchlists, and active research runs in one daily workspace."
        action={
          <div className="page-header-action-stack">
            <HeaderStats
              stats={[
                {
                  icon: <ListChecks aria-hidden size={14} />,
                  label: 'Critical',
                  meta: 'Needs action',
                  tone: 'risk',
                  value: attention.isLoading ? '...' : criticalCount,
                },
                {
                  icon: <TrendingUp aria-hidden size={14} />,
                  label: 'Review',
                  meta: 'Queue items',
                  tone: 'warning',
                  value: attention.isLoading ? '...' : reviewCount,
                },
                {
                  icon: <Signal aria-hidden size={14} />,
                  label: 'Signals',
                  meta: 'Latest feed',
                  tone: 'primary',
                  value: signals.isLoading ? '...' : signals.data?.length ?? 0,
                },
                {
                  icon: <Bell aria-hidden size={14} />,
                  label: 'Unread',
                  meta: 'Notifications',
                  tone: 'risk',
                  value: attention.isLoading ? '...' : unreadCount,
                },
              ]}
            />
          </div>
        }
      />

      <div className="workbench-layout">
        <div className="workbench-main">
          <Panel
            className="span-12 attention-panel workbench-attention-panel"
            title="Attention command center"
            description="Ranked operating issues from the active workspace."
            action={
              <div className="top-strip-meta">
                <span className="badge risk">{criticalCount} critical</span>
                <span className="badge warning">{reviewCount} review</span>
                <span className="badge primary">{infoCount} info</span>
              </div>
            }
          >
            {attention.isLoading ? <LoadingState label="Loading attention queue..." /> : null}
            {attention.isError ? <ErrorState error={attention.error} /> : null}
            {attention.data?.items.length === 0 ? (
              <div className="attention-empty">
                <EmptyState label="No urgent items. Start new research or refresh watchlist checks." />
                <Link className="button primary" to={routes.researchNew}>
                  <Radar aria-hidden size={16} />
                  New research run
                </Link>
              </div>
            ) : null}
            <div className="attention-queues">
              {attention.data?.queues.map((queue) => (
                <AttentionQueueSection
                  currentPage={attentionPages[queue.priority]}
                  key={queue.priority}
                  onPageChange={(page) =>
                    setAttentionPages((current) => ({
                      ...current,
                      [queue.priority]: page,
                    }))
                  }
                  queue={queue}
                />
              ))}
            </div>
          </Panel>

          <BentoGrid className="workbench-core-grid">
            <MorningBriefPanel
              attentionError={attention.error}
              attentionIsError={attention.isError}
              attentionIsLoading={attention.isLoading}
              brief={latestBrief}
              briefActions={attention.data?.brief_actions ?? []}
              briefError={briefs.error}
              briefIsError={briefs.isError}
              briefIsLoading={briefs.isLoading}
            />

            <ThesisInboxPanel
              isError={theses.isError}
              isLoading={theses.isLoading}
              error={theses.error}
              theses={theses.data ?? []}
            />

            <SignalMatrixPanel
              isError={signals.isError}
              isLoading={signals.isLoading}
              error={signals.error}
              signals={signals.data ?? []}
            />

            <RunPipelinePanel
              degradedRunCount={degradedRunCount}
              isError={runs.isError}
              isLoading={runs.isLoading}
              error={runs.error}
              runs={runs.data ?? []}
            />
          </BentoGrid>
        </div>

        <BentoGrid className="workbench-rail" aria-label="Workbench secondary panels">
          <AlertRail
            alerts={alerts.data ?? []}
            error={alerts.error}
            isError={alerts.isError}
            isLoading={alerts.isLoading}
          />
          <WatchlistRail
            error={watchlists.error}
            isError={watchlists.isError}
            isLoading={watchlists.isLoading}
            watchlists={watchlists.data ?? []}
          />
          <ActiveScenariosRail
            isLoading={attention.isLoading}
            scenarios={attention.data?.active_scenarios ?? []}
          />
          <Panel
            className="workbench-command-rail"
            title="Command context"
            description="Carry the current desk context into the next workflow."
          >
            <div className="stack">
              <textarea
                className="input command-composer"
                value={commandDraft}
                onChange={(event) => setCommandDraft(event.target.value)}
                rows={5}
              />
              <div className="top-strip-meta">
                <span className="badge risk">{criticalCount} critical</span>
                <span className="badge warning">{reviewCount} review</span>
                <span className="badge">{degradedRunCount} degraded run(s)</span>
              </div>
              <div className="workbench-rail-actions">
                <Link className="button primary" to={routes.researchNew}>
                  <Radar aria-hidden size={15} />
                  Launch research
                </Link>
                <Link className="button" to={routes.theses}>
                  <ScrollText aria-hidden size={15} />
                  Thesis inbox
                </Link>
              </div>
            </div>
          </Panel>
        </BentoGrid>
      </div>
    </main>
  );
}

function ActiveScenariosRail({
  isLoading,
  scenarios,
}: {
  isLoading: boolean;
  scenarios: ScenarioResponse[];
}) {
  return (
    <Panel
      className="workbench-active-scenarios"
      title="Active scenarios"
      description="Top evaluated scenario triggers."
    >
      {isLoading ? <LoadingState label="Loading scenarios..." /> : null}
      {!isLoading && scenarios.length === 0 ? (
        <EmptyState label="No active scenarios." />
      ) : null}
      {scenarios.length ? (
        <div className="stack">
          {scenarios.slice(0, 5).map((scenario) => (
            <Link
              className="attention-item compact"
              key={scenario.id ?? scenario.condition}
              to={routes.thesis(scenario.thesis_id)}
            >
              <div className="attention-item-top">
                <strong>{scenario.scenario_name || scenario.condition}</strong>
                <span className="badge">
                  {scenario.runtime_decision.recommended_action.replaceAll('_', ' ')}
                </span>
              </div>
              <p>{scenario.runtime_decision.status_reason || scenario.status_reason || scenario.condition}</p>
            </Link>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function AttentionQueueSection({
  currentPage,
  onPageChange,
  queue,
}: {
  currentPage: number;
  onPageChange: (page: number) => void;
  queue: AttentionQueueResponse;
}) {
  const pageCount = Math.max(1, Math.ceil(queue.items.length / attentionPageSize));
  const safePage = Math.min(Math.max(currentPage, 1), pageCount);
  const firstIndex = (safePage - 1) * attentionPageSize;
  const visibleItems = queue.items.slice(firstIndex, firstIndex + attentionPageSize);
  const firstVisible = queue.items.length === 0 ? 0 : firstIndex + 1;
  const lastVisible = Math.min(firstIndex + attentionPageSize, queue.items.length);

  return (
    <section className="attention-group">
      <div className="attention-group-header">
        <span className={`badge ${priorityTone(queue.priority)}`}>{queue.label}</span>
        <span className="small muted">{queue.items.length} item(s)</span>
      </div>
      <div className="attention-page-meta">
        {queue.items.length > 0 ? (
          <span>
            Showing {firstVisible}-{lastVisible} of {queue.items.length}
          </span>
        ) : (
          <span>No items in this lane</span>
        )}
      </div>
      <div className="attention-items">
        {queue.items.length === 0 ? (
          <div className="attention-placeholder">
            No {queue.label.toLowerCase()} items.
          </div>
        ) : null}
        {visibleItems.map((item) => (
          <AttentionItem item={item} key={item.id} />
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="attention-pagination" aria-label={`${queue.label} pages`}>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
            <button
              aria-current={page === safePage ? 'page' : undefined}
              className={`attention-page-button${page === safePage ? ' active' : ''}`}
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MorningBriefPanel({
  attentionError,
  attentionIsError,
  attentionIsLoading,
  brief,
  briefActions,
  briefError,
  briefIsError,
  briefIsLoading,
}: {
  attentionError: unknown;
  attentionIsError: boolean;
  attentionIsLoading: boolean;
  brief: BriefResponse | null | undefined;
  briefActions: AttentionItemResponse[];
  briefError: unknown;
  briefIsError: boolean;
  briefIsLoading: boolean;
}) {
  const keyPoints = brief?.key_points ?? [];
  const topRisks = brief?.top_risks ?? [];
  const topSetups = brief?.top_setups ?? [];
  const assetSummaries = brief?.asset_summaries ?? [];

  return (
    <Panel
      className="span-7 emphasis morning-brief-panel"
      title="Morning brief"
      description="Daily context tied to unresolved queue actions."
      action={
        brief ? (
          <span className="badge primary">{brief.brief_date ?? 'undated'}</span>
        ) : null
      }
    >
      {briefIsLoading || attentionIsLoading ? (
        <LoadingState label="Loading daily brief..." />
      ) : null}
      {briefIsError ? <ErrorState error={briefError} /> : null}
      {attentionIsError ? <ErrorState error={attentionError} /> : null}
      {!brief && !briefIsLoading && !attentionIsLoading ? (
        <EmptyState label="No daily brief has been written yet." />
      ) : null}
      {brief ? (
        <div className="stack lg">
          <div className="brief-headline">
            <div>
              <h3>{brief.title || 'Untitled brief'}</h3>
              <div className="small muted">
                {brief.watchlist_name || 'default'} | {formatDateTime(brief.created_at)}
              </div>
            </div>
            <Link className="button ghost" to={routes.briefsDaily}>
              <FileText aria-hidden size={15} />
              Archive
            </Link>
          </div>
          <p className="brief-summary">{brief.summary || 'No summary.'}</p>
          {briefActions.length ? (
            <div className="brief-action-list">
              {briefActions.slice(0, 3).map((item) => (
                <AttentionItem compact item={item} key={item.id} />
              ))}
            </div>
          ) : null}
          <div className="brief-focus-grid">
            <BriefFocusBlock icon={<ListChecks aria-hidden size={15} />} title="Key points" items={keyPoints} />
            <BriefFocusBlock icon={<ShieldAlert aria-hidden size={15} />} title="Top risks" items={topRisks} tone="risk" />
            <BriefFocusBlock icon={<GitBranch aria-hidden size={15} />} title="Top setups" items={topSetups} tone="constructive" />
          </div>
          {assetSummaries.length ? (
            <div className="brief-asset-strip">
              {assetSummaries.slice(0, 4).map((asset) => (
                <div className="brief-asset-card" key={`${asset.symbol}-${asset.source_timestamp}`}>
                  <div className="row">
                    <strong>{asset.symbol}</strong>
                    <DirectionBadge value={asset.trend_direction} />
                  </div>
                  <span className="small muted">{asset.market_regime}</span>
                  <p>{asset.summary || 'No asset summary.'}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function BriefFocusBlock({
  icon,
  items,
  title,
  tone = 'primary',
}: {
  icon: ReactNode;
  items: string[];
  title: string;
  tone?: 'primary' | 'constructive' | 'risk';
}) {
  return (
    <section className="brief-focus-block">
      <div className="brief-focus-title">
        <span className={`badge ${tone}`}>{icon}</span>
        <strong>{title}</strong>
      </div>
      {items.length ? (
        <ul>
          {items.slice(0, 3).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <span className="small muted">No items recorded.</span>
      )}
    </section>
  );
}

function ThesisInboxPanel({
  error,
  isError,
  isLoading,
  theses,
}: {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  theses: ThesisResponse[];
}) {
  return (
    <Panel
      className="span-5 thesis-inbox-panel"
      title="Thesis inbox"
      description="Decision-ready theses sorted for quick review."
      action={
        <Link className="button ghost" to={routes.theses}>
          <ArrowUpRight aria-hidden size={15} />
          Open
        </Link>
      }
    >
      {isLoading ? <LoadingState label="Loading theses..." /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {theses.length === 0 && !isLoading ? (
        <EmptyState label="No theses yet. Run research first." />
      ) : null}
      {theses.length ? (
        <div className="thesis-inbox-list" aria-label="Thesis inbox">
          {theses.slice(0, 6).map((thesis) => (
            <Link
              className="thesis-inbox-row"
              to={routes.thesis(thesis.id ?? '')}
              key={thesis.id ?? thesis.symbol}
            >
              <div className="thesis-inbox-primary">
                <strong>{thesis.symbol}</strong>
                <span className="small muted">{thesis.summary.rating || thesis.setup_type}</span>
              </div>
              <div className="thesis-inbox-badges">
                <DirectionBadge value={thesis.direction} />
                <ConfidenceBadge value={thesis.confidence} />
              </div>
              <div className="thesis-inbox-copy">
                <span>
                  <span className="chip-prefix">Invalidation</span>
                  {thesis.invalidation_level || 'n/a'}
                </span>
                <span>
                  <span className="chip-prefix">Monitor</span>
                  {thesis.monitor_next.slice(0, 1).join(', ') || 'decision review'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function SignalMatrixPanel({
  error,
  isError,
  isLoading,
  signals,
}: {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  signals: SignalResponse[];
}) {
  const symbols = uniqueValues(signals.map((signal) => signal.symbol)).slice(
    0,
    signalSymbolLimit,
  );
  const signalTypes = uniqueValues(signals.map((signal) => signal.signal_type)).slice(
    0,
    signalTypeLimit,
  );
  const visibleSignalTypes = signalTypes.length ? signalTypes : ['signal'];

  return (
    <Panel
      className="span-8 signal-matrix-panel"
      title="Signal matrix"
      description="Symbol by signal type, direction, source, and freshness."
      action={
        <Link className="button ghost" to={routes.signals}>
          <Signal aria-hidden size={15} />
          Signals
        </Link>
      }
    >
      {isLoading ? <LoadingState label="Loading signals..." /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {signals.length === 0 && !isLoading ? <EmptyState label="No signals yet." /> : null}
      {signals.length ? (
        <div
          className="signal-matrix"
          style={{ '--signal-column-count': visibleSignalTypes.length } as CSSProperties}
        >
          <div className="signal-matrix-header">
            <span>Symbol</span>
            {visibleSignalTypes.map((type) => (
              <span key={type}>{compactLabel(type)}</span>
            ))}
          </div>
          {symbols.map((symbol) => (
            <div className="signal-matrix-row" key={symbol}>
              <strong>{symbol}</strong>
              {visibleSignalTypes.map((type) => {
                const signal = signals.find(
                  (item) => item.symbol === symbol && item.signal_type === type,
                );
                return <SignalMatrixCell key={`${symbol}-${type}`} signal={signal} />;
              })}
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function SignalMatrixCell({ signal }: { signal?: SignalResponse }) {
  if (!signal) {
    return <span className="signal-cell empty">No read</span>;
  }

  return (
    <Link
      className={`signal-cell ${directionTone(signal.direction)}`}
      to={signal.id ? routes.signal(signal.id) : routes.signals}
    >
      <span>{compactLabel(signal.direction)}</span>
      <small>{signal.source || 'source n/a'}</small>
      <small>{freshnessLabel(signal.observed_at)}</small>
    </Link>
  );
}

function RunPipelinePanel({
  degradedRunCount,
  error,
  isError,
  isLoading,
  runs,
}: {
  degradedRunCount: number;
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  runs: ResearchRunResponse[];
}) {
  const stages = [
    { key: 'queued', label: 'Queued', tone: 'primary' },
    { key: 'running', label: 'Running', tone: 'warning' },
    { key: 'completed', label: 'Completed', tone: 'constructive' },
    { key: 'degraded', label: 'Degraded', tone: 'warning' },
    { key: 'failed', label: 'Failed', tone: 'risk' },
  ];

  return (
    <Panel
      className="span-4 run-pipeline-panel"
      title="Run pipeline"
      description="Recent research jobs by operating state."
      action={
        <Link className="button ghost" to={routes.researchHistory}>
          <Activity aria-hidden size={15} />
          History
        </Link>
      }
    >
      {isLoading ? <LoadingState label="Loading runs..." /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {runs.length === 0 && !isLoading ? <EmptyState label="No research runs found." /> : null}
      {runs.length ? (
        <div className="stack lg">
          <div className="run-pipeline-track">
            {stages.map((stage) => (
              <div className={`pipeline-node ${stage.tone}`} key={stage.key}>
                <span className="small muted">{stage.label}</span>
                <strong>
                  {stage.key === 'degraded'
                    ? degradedRunCount
                    : runs.filter((run) => normalizeRunStatus(run) === stage.key).length}
                </strong>
              </div>
            ))}
          </div>
          <div className="stack">
            {runs.slice(0, 5).map((run) => (
              <Link
                className="run-pipeline-row"
                to={routes.researchRun(run.run_id ?? run.id ?? '')}
                key={run.id ?? run.run_id ?? `${run.symbol}-${run.started_at}`}
              >
                <div>
                  <strong>{run.symbol}</strong>
                  <span className="small muted">
                    {run.market_type} | {formatDateTime(run.started_at)}
                  </span>
                </div>
                <StatusBadge value={run.status} />
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function AlertRail({
  alerts,
  error,
  isError,
  isLoading,
}: {
  alerts: Array<{
    id: string | null;
    symbol: string;
    alert_type: string;
    message: string;
    created_at: string | null;
  }>;
  error: unknown;
  isError: boolean;
  isLoading: boolean;
}) {
  return (
    <Panel
      className="workbench-alert-rail"
      title="Unread alerts"
      description="Watchlist events that still need attention."
      action={
        <Link className="button ghost" to={routes.alerts}>
          <Bell aria-hidden size={15} />
          Alerts
        </Link>
      }
    >
      {isLoading ? <LoadingState label="Loading alerts..." /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {alerts.length === 0 && !isLoading ? <EmptyState label="No unread alerts." /> : null}
      <div className="stack">
        {alerts.slice(0, 6).map((alert) => (
          <div className="rail-alert-row" key={alert.id ?? alert.message}>
            <div className="row">
              <strong>{alert.symbol || 'n/a'}</strong>
              <span className="badge warning">{alert.alert_type}</span>
            </div>
            <p>{alert.message}</p>
            <span className="small muted">{formatDateTime(alert.created_at)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function WatchlistRail({
  error,
  isError,
  isLoading,
  watchlists,
}: {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  watchlists: WatchlistResponse[];
}) {
  return (
    <Panel
      className="workbench-watchlist-rail"
      title="Watchlists"
      description="Monitoring scopes used by checks and briefs."
      action={
        <Link className="button ghost" to={routes.watchlists}>
          <ClipboardList aria-hidden size={15} />
          Open
        </Link>
      }
    >
      {isLoading ? <LoadingState label="Loading watchlists..." /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {watchlists.length === 0 && !isLoading ? (
        <EmptyState label="No watchlists found." />
      ) : null}
      <div className="stack">
        {watchlists.slice(0, 5).map((watchlist) => (
          <div className="watchlist-rail-row" key={watchlist.id ?? watchlist.name}>
            <div className="row">
              <strong>{watchlist.name}</strong>
              <span className={watchlist.enabled ? 'badge constructive' : 'badge'}>
                {watchlist.enabled ? 'enabled' : 'paused'}
              </span>
            </div>
            <span className="small muted">
              <Clock3 aria-hidden size={13} /> {formatDateTime(watchlist.created_at)}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AttentionItem({
  compact = false,
  item,
}: {
  compact?: boolean;
  item: AttentionItemResponse;
}) {
  return (
    <Link
      className={`attention-item ${compact ? 'compact' : ''}`}
      to={item.action.href}
    >
      <div className="attention-item-main">
        <div className="row">
          <strong>{item.title}</strong>
          <span className={`badge ${priorityTone(item.priority)}`}>
            {Math.round(item.score)}
          </span>
        </div>
        <p>{item.summary}</p>
        <div className="attention-badges">
          {item.symbol ? (
            <span className="badge degraded">
              <span className="chip-prefix">symbol</span>
              {item.symbol}
            </span>
          ) : null}
          {item.badges.map((badge) => (
            <span className={`badge ${badgeTone(badge.tone)}`} key={`${item.id}-${badge.label}`}>
              <span className="chip-prefix">{badge.label}</span>
              {badge.value}
            </span>
          ))}
        </div>
      </div>
      <span className="button ghost">{item.action.label}</span>
    </Link>
  );
}

function priorityTone(priority: AttentionPriority): string {
  if (priority === 'critical') {
    return 'risk';
  }
  if (priority === 'review') {
    return 'warning';
  }
  return 'primary';
}

function badgeTone(tone: string): string {
  return ['risk', 'warning', 'primary', 'constructive', 'degraded'].includes(tone)
    ? tone
    : '';
}

function directionTone(direction: string): string {
  const normalized = direction.toLowerCase();
  if (normalized.includes('bear') || normalized.includes('short') || normalized.includes('down')) {
    return 'risk';
  }
  if (normalized.includes('bull') || normalized.includes('long') || normalized.includes('up')) {
    return 'constructive';
  }
  return 'neutral';
}

function freshnessLabel(value: string | null): string {
  if (!value) {
    return 'freshness n/a';
  }
  const observed = new Date(value).getTime();
  if (Number.isNaN(observed)) {
    return 'freshness n/a';
  }
  const minutes = Math.max(0, Math.floor((Date.now() - observed) / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function compactLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.slice(0, 7))
    .join(' ');
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeRunStatus(run: ResearchRunResponse): string {
  if (
    run.status === 'degraded' ||
    (run.degradation_reasons ?? []).length > 0 ||
    (run.missing_core_data ?? []).length > 0
  ) {
    return 'degraded';
  }
  if (run.status === 'failed' || run.status === 'error') {
    return 'failed';
  }
  if (run.status === 'running' || run.status === 'active') {
    return 'running';
  }
  if (run.status === 'queued' || run.status === 'pending') {
    return 'queued';
  }
  if (run.status === 'completed' || run.status === 'succeeded') {
    return 'completed';
  }
  return run.status;
}
