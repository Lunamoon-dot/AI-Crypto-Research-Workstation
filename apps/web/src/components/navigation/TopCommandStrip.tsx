import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, UserCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { WorkspaceSwitcher } from '@/components/navigation/WorkspaceSwitcher';
import { markAlertRead } from '@/services/alerts';
import { queryKeys } from '@/services/query-keys';
import { getWorkbenchAttention } from '@/services/workbench';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { findNavigationTitle } from '@/navigation/nav-groups';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type { NotificationResponse } from '@/types';

export function TopCommandStrip() {
  const { pathname, search } = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const attention = useQuery({
    queryKey: queryKeys.workbenchAttention({ limit: 10 }),
    queryFn: () => getWorkbenchAttention({ limit: 10 }, auth),
    staleTime: 30_000,
    refetchInterval: notificationsOpen ? 30_000 : false,
  });
  const readMutation = useMutation({
    mutationFn: (id: string) => markAlertRead(id, auth),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.alertsRoot() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.workbench() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workbenchAttention({ limit: 10 }),
      });
    },
  });
  const title = findNavigationTitle(`${pathname}${search}`);
  const fixedSymbolWorkspaceOnly = pathname.startsWith('/research-continuity');
  const unreadCount =
    attention.data?.notifications.filter((notification) => notification.status === 'unread')
      .length ?? 0;

  return (
    <header className="top-strip">
      <div>
        <p className="top-strip-title">{title}</p>
        <div className="small muted">Local research mode | API-backed workstation</div>
      </div>
      <div className="top-strip-actions">
        <WorkspaceSwitcher fixedOnly={fixedSymbolWorkspaceOnly} />
        <button
          className="button icon ghost notification-trigger"
          aria-label="Notifications"
          aria-expanded={notificationsOpen}
          type="button"
          onClick={() => setNotificationsOpen((open) => !open)}
        >
          <Bell aria-hidden size={16} />
          {unreadCount > 0 ? <span className="notification-dot">{unreadCount}</span> : null}
        </button>
        {notificationsOpen ? (
          <NotificationDrawer
            isError={attention.isError}
            isLoading={attention.isLoading}
            notifications={attention.data?.notifications ?? []}
            onClose={() => setNotificationsOpen(false)}
            onMarkRead={(id) => readMutation.mutate(id)}
            markingId={readMutation.variables}
          />
        ) : null}
        <button className="button icon ghost" aria-label="Account" type="button">
          <UserCircle aria-hidden size={16} />
        </button>
      </div>
    </header>
  );
}

function NotificationDrawer({
  isError,
  isLoading,
  notifications,
  onClose,
  onMarkRead,
  markingId,
}: {
  isError: boolean;
  isLoading: boolean;
  notifications: NotificationResponse[];
  onClose: () => void;
  onMarkRead: (id: string) => void;
  markingId: string | undefined;
}) {
  return (
    <div className="notification-drawer" role="dialog" aria-label="Notifications">
      <div className="notification-drawer-header">
        <div>
          <strong>Notifications</strong>
          <span>{notifications.length} current event(s)</span>
        </div>
        <Link className="button ghost" to={routes.alerts} onClick={onClose}>
          Alerts
        </Link>
      </div>
      {isLoading ? <div className="notification-empty">Loading notifications...</div> : null}
      {isError ? <div className="notification-empty">Notification feed is unavailable.</div> : null}
      {!isLoading && !isError && notifications.length === 0 ? (
        <div className="notification-empty">No current notifications.</div>
      ) : null}
      <div className="notification-list">
        {notifications.map((notification) => (
          <div className="notification-row" key={notification.id}>
            <Link to={notification.action.href} onClick={onClose}>
              <div className="row">
                <strong>{notification.title}</strong>
                <span className={`badge ${priorityTone(notification.priority)}`}>
                  {notification.priority}
                </span>
              </div>
              <p>{notification.message}</p>
              <div className="notification-meta">
                <span>{notification.source}</span>
                <span>{formatDateTime(notification.created_at)}</span>
              </div>
            </Link>
            {notification.type === 'alert' && notification.source_id ? (
              <button
                className="button icon ghost"
                aria-label="Mark notification read"
                disabled={markingId === notification.source_id}
                type="button"
                onClick={() => onMarkRead(notification.source_id ?? '')}
              >
                <Check aria-hidden size={15} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function priorityTone(priority: string): string {
  if (priority === 'critical') {
    return 'risk';
  }
  if (priority === 'review') {
    return 'warning';
  }
  return 'primary';
}
