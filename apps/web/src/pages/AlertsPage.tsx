import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, RadioTower } from 'lucide-react';
import {
  getAlertSchedulerStatus,
  listAlerts,
  markAlertRead,
  runAlertScheduler,
} from '@/services/alerts';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { DataPair } from '@/components/research/bento';
import { IdChip } from '@/components/research/badges';
import { HeaderStats } from '@/components/research/header-stats';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

export function AlertsPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.alerts({ unread: unreadOnly, limit: 100 }),
    queryFn: () => listAlerts({ unread: unreadOnly, limit: 100 }, auth),
  });
  const scheduler = useQuery({
    queryKey: queryKeys.alertScheduler(),
    queryFn: () => getAlertSchedulerStatus(auth),
  });
  const mutation = useMutation({
    mutationFn: (id: string) => markAlertRead(id, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertsRoot() });
    },
  });
  const runSchedulerMutation = useMutation({
    mutationFn: () => runAlertScheduler(auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertScheduler() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertsRoot() });
    },
  });
  const alerts = query.data ?? [];
  const unreadCount = alerts.filter((alert) => !alert.read_at).length;

  return (
    <main className="page">
      <PageHeader
        title="Alerts"
        description="Research alerts and continuity changes."
        action={
          <HeaderStats
            stats={[
              {
                icon: <Bell aria-hidden size={14} />,
                label: 'Alerts shown',
                meta: unreadOnly ? 'unread only' : 'latest 100',
                tone: 'primary',
                value: query.isLoading ? '...' : alerts.length,
              },
              {
                icon: <AlertTriangle aria-hidden size={14} />,
                label: 'Unread',
                tone: unreadCount > 0 ? 'warning' : 'constructive',
                value: query.isLoading ? '...' : unreadCount,
              },
              {
                icon: <RadioTower aria-hidden size={14} />,
                label: 'Scheduler',
                meta: scheduler.data?.last_run_at ? formatDateTime(scheduler.data.last_run_at) : 'No run yet',
                tone: scheduler.data?.enabled ? 'constructive' : 'degraded',
                value: scheduler.data?.enabled ? 'enabled' : 'manual',
              },
              {
                icon: <CheckCircle2 aria-hidden size={14} />,
                label: 'Enabled scopes',
                meta: 'workspace scopes',
                value: scheduler.data?.workspace_enabled_watchlists ?? '...',
              },
            ]}
          />
        }
      />
      <div className="grid two">
        <Panel title="Filters">
          <label className="badge">
            <input
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
              type="checkbox"
            />
            unread only
          </label>
        </Panel>
        <Panel
          title="Scheduler"
          description="Workspace alert polling status and manual check."
          action={
            <button
              className="button"
              disabled={runSchedulerMutation.isPending}
              onClick={() => runSchedulerMutation.mutate()}
              type="button"
            >
              {runSchedulerMutation.isPending ? 'Checking' : 'Run check'}
            </button>
          }
        >
          {scheduler.isLoading ? <LoadingState /> : null}
          {scheduler.isError ? <ErrorState error={scheduler.error} /> : null}
          <div className="stack">
            <DataPair
              label="Status"
              value={
                <span className={scheduler.data?.enabled ? 'badge constructive' : 'badge'}>
                  {scheduler.data?.enabled ? 'enabled' : 'manual'}
                </span>
              }
            />
            <DataPair label="Interval" value={`${scheduler.data?.interval_ms ?? 0} ms`} />
            <DataPair label="Enabled scopes" value={scheduler.data?.workspace_enabled_watchlists ?? 0} />
            <DataPair label="Last run" value={formatDateTime(scheduler.data?.last_run_at)} />
            {runSchedulerMutation.data ? (
              <div className="callout">
                Checked {runSchedulerMutation.data.checked_watchlists} scope(s), created{' '}
                {runSchedulerMutation.data.alerts_created} alert(s).
              </div>
            ) : null}
            {scheduler.data?.last_error ? (
              <div className="callout warning">{scheduler.data.last_error}</div>
            ) : null}
          </div>
        </Panel>
      </div>
      <div style={{ height: 14 }} />
      <Panel title="Inbox">
        {query.isLoading ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} /> : null}
        {query.data?.length === 0 ? <EmptyState label="No alerts found." /> : null}
        <div className="stack">
          {query.data?.map((alert) => (
            <div className="list-row" key={alert.id ?? alert.message}>
              <div className="row">
                <div>
                  <strong>{alert.symbol || 'n/a'}</strong>
                  <div className="small muted">{formatDateTime(alert.created_at)}</div>
                </div>
                <span className={alert.read_at ? 'badge' : 'badge warning'}>
                  {alert.read_at ? 'read' : 'unread'}
                </span>
              </div>
              <div>{alert.message}</div>
              <div className="top-strip-meta">
                <span className="badge">{alert.alert_type}</span>
                <IdChip value={alert.trigger_key} />
                {alert.thesis_id ? (
                  <Link className="badge" to={routes.thesis(alert.thesis_id)}>
                    thesis {alert.thesis_id}
                  </Link>
                ) : null}
              </div>
              <JsonView value={alert.payload} />
              {!alert.read_at && alert.id ? (
                <button
                  className="button"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(alert.id as string)}
                  type="button"
                >
                  Mark read
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
    </main>
  );
}
