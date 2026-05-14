import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { listAlerts, markAlertRead } from '@/services/alerts';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { IdChip } from '@/components/research/badges';
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
  const mutation = useMutation({
    mutationFn: (id: string) => markAlertRead(id, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts({}) });
    },
  });

  return (
    <main className="page">
      <PageHeader title="Alerts" description="Research alerts and watchlist changes." />
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
