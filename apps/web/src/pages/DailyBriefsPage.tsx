import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarDays, FileText, RefreshCw, RotateCcw } from 'lucide-react';
import { createDailyBrief, listDailyBriefs } from '@/services/briefs';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { listWatchlists } from '@/services/watchlists';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BriefCard } from '@/components/research/brief-card';
import { BentoGrid, MetricTile } from '@/components/research/bento';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { isPastOrTodayIsoDate, todayIsoDate } from '@/lib/format';
import { routes } from '@/lib/routes';

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
      setSelectedOnly(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.dailyBriefsRoot() });
    },
  });
  const visibleBriefs = useMemo(
    () =>
      (query.data ?? []).filter((brief) =>
        isPastOrTodayIsoDate(brief.brief_date, today),
      ),
    [query.data, today],
  );
  const latest = visibleBriefs[0];

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

  function resetFilters() {
    setDate('');
    setSelectedOnly(true);
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
          value={query.isLoading ? '...' : visibleBriefs.length}
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

        <Panel
          action={<Link className="button ghost" to={routes.watchlists}>Watchlists</Link>}
          className="span-4 emphasis"
          title="Brief filters"
        >
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
                disabled={watchlists.isLoading || watchlists.isError}
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
            {watchlists.isLoading ? <LoadingState label="Loading watchlists..." /> : null}
            {watchlists.isError ? <ErrorState error={watchlists.error} /> : null}
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
            <div className="top-strip-meta">
              <button
                className="button primary"
                disabled={generateMutation.isPending || !watchlistId || futureDate}
                type="submit"
              >
                <RefreshCw aria-hidden size={16} />
                {generateMutation.isPending ? 'Creating brief' : 'Create brief'}
              </button>
              <button className="button" onClick={resetFilters} type="button">
                <RotateCcw aria-hidden size={16} />
                Reset filters
              </button>
            </div>
          </form>
        </Panel>

        <Panel
          className="span-8"
          title={selectedOnly ? 'Brief archive for selected watchlist' : 'Workspace brief archive'}
        >
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState error={query.error} /> : null}
          {!query.isLoading && visibleBriefs.length === 0 ? <EmptyState label="No briefs found." /> : null}
          <div className="stack">
            {visibleBriefs.map((brief, index) => (
              <BriefCard
                brief={brief}
                featured={index === 0}
                key={brief.id ?? `${brief.title}-${brief.created_at}`}
              />
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}
