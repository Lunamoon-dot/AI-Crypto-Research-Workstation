import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ClipboardCheck, FileText, Play, UserCircle } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { WorkspaceSwitcher } from '@/components/navigation/WorkspaceSwitcher';
import { markAlertRead } from '@/services/alerts';
import { createDailyBrief } from '@/services/briefs';
import { queryKeys } from '@/services/query-keys';
import { createResearchRun } from '@/services/research-runs';
import { checkWatchlist, listWatchlists } from '@/services/watchlists';
import { getWorkbenchAttention } from '@/services/workbench';
import { errorMessage } from '@/services/client';
import { formatDateTime, todayIsoDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import { researchRunRequestSchema } from '@/schemas/research-run';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type { NotificationResponse } from '@/types';

const titles: Array<[string, string]> = [
  [routes.workbench, 'Daily operating view'],
  [routes.researchNew, 'Research launcher'],
  ['/research/runs', 'Research workspace'],
  [routes.performance, 'Thesis reliability'],
  [routes.theses, 'Thesis library'],
  [routes.signals, 'Signal explorer'],
  [routes.watchlists, 'Watchlists and briefs'],
  [routes.briefsDaily, 'Daily briefs archive'],
  [routes.operations, 'Operations'],
  [routes.settings, 'Settings'],
];

export function TopCommandStrip() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [profile, setProfile] = useState('default');
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const isWorkbench = pathname === routes.workbench;
  const attention = useQuery({
    queryKey: queryKeys.workbenchAttention({ limit: 10 }),
    queryFn: () => getWorkbenchAttention({ limit: 10 }, auth),
    staleTime: 30_000,
    refetchInterval: notificationsOpen ? 30_000 : false,
  });
  const watchlists = useQuery({
    queryKey: queryKeys.watchlists({ limit: 6, scope: 'top-command-strip' }),
    queryFn: () => listWatchlists({ limit: 6 }, auth),
    enabled: isWorkbench,
    staleTime: 45_000,
  });
  const defaultWatchlist =
    watchlists.data?.find((watchlist) => watchlist.enabled) ?? watchlists.data?.[0];
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
  const runMutation = useMutation({
    mutationFn: () =>
      createResearchRun(
        researchRunRequestSchema.parse({
          workspace_id: auth.workspaceId,
          symbol: symbol.trim(),
          asset_class: 'crypto',
          market_type: marketType,
          analysis_date: todayIsoDate(),
          analysts: ['market', 'news', 'social', 'onchain'],
          config_profile: profile,
        }),
        auth,
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.researchRunsRoot() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workbenchAttention({ limit: 10 }),
      });
      navigate(routes.researchRun(result.run_id, result.job_id));
    },
  });
  const checkMutation = useMutation({
    mutationFn: () => {
      if (!defaultWatchlist?.id) {
        throw new Error('No watchlist is available.');
      }
      return checkWatchlist(defaultWatchlist.id, {}, auth);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.alertsRoot() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.workbench() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workbenchAttention({ limit: 10 }),
      });
    },
  });
  const briefMutation = useMutation({
    mutationFn: () =>
      createDailyBrief(
        {
          watchlist_id: defaultWatchlist?.id ?? undefined,
          watchlist_name: defaultWatchlist?.id ? undefined : defaultWatchlist?.name,
          date: todayIsoDate(),
          evaluate_snapshots: true,
          save: true,
        },
        auth,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.dailyBriefsRoot() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.workbench() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workbenchAttention({ limit: 10 }),
      });
    },
  });
  const title =
    titles.find(([href]) => pathname === href || pathname.startsWith(href))?.[1] ??
    'Evidence-first crypto research';
  const unreadCount =
    attention.data?.notifications.filter((notification) => notification.status === 'unread')
      .length ?? 0;
  const commandError =
    runMutation.error ?? checkMutation.error ?? briefMutation.error ?? null;

  function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (symbol.trim()) {
      runMutation.mutate();
    }
  }

  return (
    <header className="top-strip">
      <div>
        <p className="top-strip-title">{title}</p>
        <div className="small muted">Local research mode | API-backed workstation</div>
      </div>
      <div className="top-strip-actions">
        {isWorkbench ? (
          <form className="top-command-form" onSubmit={submitRun}>
            <input
              aria-label="Research symbol"
              className="top-command-input"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            />
            <select
              aria-label="Market type"
              className="top-command-select"
              value={marketType}
              onChange={(event) => setMarketType(event.target.value as 'spot' | 'perp')}
            >
              <option value="spot">Spot</option>
              <option value="perp">Perp</option>
            </select>
            <select
              aria-label="Research profile"
              className="top-command-select"
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
            >
              <option value="default">default</option>
              <option value="fast">fast</option>
              <option value="deep">deep</option>
              <option value="low-cost">low-cost</option>
            </select>
            <button
              className="button primary"
              disabled={runMutation.isPending || !symbol.trim()}
              type="submit"
            >
              <Play aria-hidden size={15} />
              <span className="top-command-label">
                {runMutation.isPending ? 'Running' : 'Run'}
              </span>
            </button>
            <button
              className="button"
              disabled={watchlists.isLoading || checkMutation.isPending || !defaultWatchlist}
              type="button"
              onClick={() => checkMutation.mutate()}
            >
              <ClipboardCheck aria-hidden size={15} />
              <span className="top-command-label">
                {checkMutation.isPending ? 'Checking' : 'Check'}
              </span>
            </button>
            <button
              className="button"
              disabled={watchlists.isLoading || briefMutation.isPending || !defaultWatchlist}
              type="button"
              onClick={() => briefMutation.mutate()}
            >
              <FileText aria-hidden size={15} />
              <span className="top-command-label">
                {briefMutation.isPending ? 'Briefing' : 'Brief'}
              </span>
            </button>
            {commandError ? (
              <span className="top-command-feedback">{errorMessage(commandError)}</span>
            ) : null}
          </form>
        ) : null}
        <WorkspaceSwitcher />
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
