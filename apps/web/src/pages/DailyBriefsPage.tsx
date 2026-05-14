import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarDays, FileText, RefreshCw } from 'lucide-react';
import { createDailyBrief, listDailyBriefs } from '@/services/briefs';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { listWatchlists } from '@/services/watchlists';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { IdChip } from '@/components/research/badges';
import { BentoGrid, MetricTile } from '@/components/research/bento';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDate, formatDateTime, todayIsoDate } from '@/lib/format';

export function DailyBriefsPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const [watchlistId, setWatchlistId] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(true);
  const today = todayIsoDate();
  const futureDate = Boolean(date && date > today);
  const query = useQuery({
    queryKey: queryKeys.dailyBriefs({
      date,
      limit: 50,
      watchlist_id: selectedOnly ? watchlistId : undefined,
    }),
    queryFn: () =>
      listDailyBriefs(
        {
          date: date || undefined,
          limit: 50,
          watchlist_id: selectedOnly ? watchlistId : undefined,
        },
        auth,
      ),
    enabled: !selectedOnly || Boolean(watchlistId),
  });
  const watchlists = useQuery({
    queryKey: queryKeys.watchlists({ limit: 100 }),
    queryFn: () => listWatchlists({ limit: 100 }, auth),
  });
  const generateMutation = useMutation({
    mutationFn: () =>
      createDailyBrief(
        {
          watchlist_id: watchlistId || watchlists.data?.[0]?.id || undefined,
          date: date || undefined,
          alerts_limit: 20,
          evaluate_snapshots: true,
          save: true,
        },
        auth,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-briefs'] });
    },
  });
  const latest = query.data?.[0];

  useEffect(() => {
    if (!watchlistId && watchlists.data?.[0]?.id) {
      setWatchlistId(watchlists.data[0].id);
    }
  }, [watchlistId, watchlists.data]);

  function submitGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (futureDate) {
      return;
    }
    generateMutation.mutate();
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="06 Briefs Archive"
        title="Daily briefs"
        description="Focused archive view for persisted market briefs and their linked thesis/signal references."
      />
      <BentoGrid>
        <MetricTile
          className="span-4"
          icon={<Archive size={18} />}
          label={selectedOnly ? 'Selected briefs' : 'Workspace briefs'}
          tone="primary"
          value={query.isLoading ? '...' : query.data?.length ?? 0}
        />
        <MetricTile
          className="span-4"
          icon={<CalendarDays size={18} />}
          label="Date filter"
          tone="warning"
          value={date || 'All'}
        />
        <MetricTile
          className="span-4"
          icon={<FileText size={18} />}
          label="Latest"
          meta={latest?.brief_date ?? 'No brief'}
          value={latest ? 'Ready' : 'None'}
        />

        <Panel className="span-4 emphasis" title="Brief filters">
          <form className="stack" onSubmit={submitGenerate}>
            <label className="label">
              Date
              <input
                className="input"
                max={today}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            {futureDate ? (
              <div className="callout warning">
                Brief dates cannot be in the future. Choose today or an earlier date.
              </div>
            ) : null}
            <label className="label">
              Watchlist
              <select
                className="select"
                value={watchlistId}
                onChange={(event) => setWatchlistId(event.target.value)}
              >
                {watchlists.data?.map((watchlist) => (
                  <option key={watchlist.id ?? watchlist.name} value={watchlist.id ?? ''}>
                    {watchlist.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-check">
              <input
                checked={selectedOnly}
                disabled={!watchlistId}
                onChange={(event) => setSelectedOnly(event.target.checked)}
                type="checkbox"
              />
              Selected watchlist only
            </label>
            {watchlists.data?.length === 0 ? <span className="badge warning">no watchlists</span> : null}
            {generateMutation.isError ? <span className="badge risk">{errorMessage(generateMutation.error)}</span> : null}
            {generateMutation.data ? <span className="badge constructive">brief saved</span> : null}
            <button
              className="button primary"
              disabled={generateMutation.isPending || !watchlistId || futureDate}
              type="submit"
            >
              <RefreshCw aria-hidden size={16} />
              Create brief from this watchlist
            </button>
          </form>
        </Panel>

        <Panel
          className="span-8"
          title={selectedOnly ? 'Brief archive for selected watchlist' : 'Workspace brief archive'}
        >
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState error={query.error} /> : null}
          {query.data?.length === 0 ? <EmptyState label="No briefs found." /> : null}
          <div className="stack">
            {query.data?.map((brief, index) => (
              <div className={index === 0 ? 'state-card' : 'list-row'} key={brief.id ?? `${brief.title}-${brief.created_at}`}>
                <div className="row">
                  <strong>{brief.title || 'Untitled brief'}</strong>
                  <span className={index === 0 ? 'badge primary' : 'badge'}>{formatDate(brief.brief_date)}</span>
                </div>
                <p className="muted">{brief.summary || 'No summary.'}</p>
                <div className="small muted">
                  {brief.watchlist_name || 'default'} | {formatDateTime(brief.created_at)}
                </div>
                <div className="top-strip-meta">
                  {brief.thesis_ids.map((id) => <IdChip key={`thesis-${id}`} value={id} />)}
                  {brief.signal_ids.map((id) => <IdChip key={`signal-${id}`} value={id} />)}
                </div>
                <div className="stack">
                  {brief.key_points.map((point) => (
                    <div className="small" key={point}>{point}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}
