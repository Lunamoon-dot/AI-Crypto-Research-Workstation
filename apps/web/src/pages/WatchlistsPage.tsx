import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  ClipboardList,
  Edit3,
  FileText,
  PauseCircle,
  PlayCircle,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { createDailyBrief, listDailyBriefs } from '@/services/briefs';
import { listTheses } from '@/services/theses';
import {
  addWatchlistItem,
  checkWatchlist,
  createWatchlist,
  getWatchlistItems,
  listWatchlists,
  removeWatchlistItem,
  updateWatchlist,
} from '@/services/watchlists';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import {
  ConfidenceBadge,
  DirectionBadge,
  IdChip,
} from '@/components/research/badges';
import { BriefCard } from '@/components/research/brief-card';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import {
  formatConfidence,
  formatDate,
  formatDateTime,
  isPastOrTodayIsoDate,
  todayIsoDate,
} from '@/lib/format';
import { routes } from '@/lib/routes';
import type { ThesisResponse, WatchlistItemResponse } from '@/types';

type TrackMode = 'symbol' | 'thesis';

const QUICK_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];

export function WatchlistsPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedThesisId = searchParams.get('track_thesis') ?? '';
  const query = useQuery({
    queryKey: queryKeys.watchlists({ limit: 100 }),
    queryFn: () => listWatchlists({ limit: 100 }, auth),
  });
  const thesesQuery = useQuery({
    queryKey: queryKeys.theses({ limit: 100 }),
    queryFn: () => listTheses({ limit: 100 }, auth),
  });
  const [watchlistId, setWatchlistId] = useState('');
  const selectedWatchlist =
    query.data?.find((watchlist) => watchlist.id === watchlistId) ?? null;
  const itemsQuery = useQuery({
    queryKey: queryKeys.watchlistItems(watchlistId),
    queryFn: () => getWatchlistItems(watchlistId, auth),
    enabled: Boolean(watchlistId),
  });
  const [briefsSelectedOnly, setBriefsSelectedOnly] = useState(true);
  const briefsQuery = useQuery({
    queryKey: queryKeys.dailyBriefs({
      limit: 8,
      watchlist_id: briefsSelectedOnly ? watchlistId : undefined,
    }),
    queryFn: () =>
      listDailyBriefs(
        {
          limit: 8,
          watchlist_id: briefsSelectedOnly ? watchlistId : undefined,
        },
        auth,
      ),
    enabled: !briefsSelectedOnly || Boolean(watchlistId),
  });
  const [newWatchlistName, setNewWatchlistName] = useState('Core watchlist');
  const [rename, setRename] = useState('');
  const [watchlistSearch, setWatchlistSearch] = useState('');
  const [trackMode, setTrackMode] = useState<TrackMode>(
    requestedThesisId ? 'thesis' : 'symbol',
  );
  const [symbol, setSymbol] = useState('BTC/USDT');
  const normalizedSymbol = useMemo(() => normalizeSymbolInput(symbol), [symbol]);
  const [selectedThesisId, setSelectedThesisId] = useState(requestedThesisId);
  const [thesisSearch, setThesisSearch] = useState('');
  const today = todayIsoDate();

  useEffect(() => {
    if (!watchlistId && query.data?.[0]?.id) {
      setWatchlistId(query.data[0].id);
    }
  }, [query.data, watchlistId]);

  useEffect(() => {
    setRename(selectedWatchlist?.name ?? '');
  }, [selectedWatchlist?.id, selectedWatchlist?.name]);

  useEffect(() => {
    if (requestedThesisId) {
      setTrackMode('thesis');
      setSelectedThesisId(requestedThesisId);
    }
  }, [requestedThesisId]);

  const thesesById = useMemo(() => {
    return new Map(
      (thesesQuery.data ?? [])
        .filter((thesis) => thesis.id)
        .map((thesis) => [thesis.id as string, thesis]),
    );
  }, [thesesQuery.data]);

  const selectedThesis = selectedThesisId
    ? thesesById.get(selectedThesisId) ?? null
    : null;

  const filteredWatchlists = useMemo(() => {
    const search = watchlistSearch.trim().toLowerCase();
    if (!search) {
      return query.data ?? [];
    }
    return (query.data ?? []).filter((watchlist) =>
      `${watchlist.name} ${watchlist.id ?? ''}`.toLowerCase().includes(search),
    );
  }, [query.data, watchlistSearch]);

  const thesisOptions = useMemo(() => {
    const search = thesisSearch.trim().toLowerCase();
    return (thesesQuery.data ?? []).filter((thesis) => {
      if (!search) {
        return true;
      }
      return thesisSelectLabel(thesis).toLowerCase().includes(search);
    });
  }, [thesesQuery.data, thesisSearch]);
  const visibleThesisOptions = thesisOptions.slice(0, 8);

  const createMutation = useMutation({
    mutationFn: () =>
      createWatchlist({ name: newWatchlistName, enabled: true }, auth),
    onSuccess: (watchlist) => {
      setNewWatchlistName('');
      setWatchlistId(watchlist.id ?? '');
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlistsRoot() });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (request: { id: string; name?: string; enabled?: boolean }) =>
      updateWatchlist(
        request.id,
        { name: request.name, enabled: request.enabled },
        auth,
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlistsRoot() });
    },
  });

  const addMutation = useMutation({
    mutationFn: () =>
      addWatchlistItem(
        watchlistId,
        trackMode === 'symbol'
          ? {
              item_type: 'symbol',
              symbol: normalizedSymbol,
            }
          : {
              item_type: 'thesis',
              thesis_id: selectedThesisId,
              symbol: selectedThesis?.symbol,
            },
        auth,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.watchlistItems(watchlistId),
      });
      if (trackMode === 'symbol') {
        setSymbol(normalizedSymbol || 'BTC/USDT');
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) =>
      removeWatchlistItem(watchlistId, itemId, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.watchlistItems(watchlistId),
      });
    },
  });

  const checkMutation = useMutation({
    mutationFn: () => checkWatchlist(watchlistId, {}, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertsRoot() });
    },
  });

  const briefMutation = useMutation({
    mutationFn: () =>
      createDailyBrief(
        {
          watchlist_id: watchlistId,
          evaluate_snapshots: true,
          save: true,
        },
        auth,
    ),
    onSuccess: () => {
      setBriefsSelectedOnly(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.dailyBriefsRoot() });
    },
  });

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate();
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedWatchlist?.id) {
      updateMutation.mutate({ id: selectedWatchlist.id, name: rename });
    }
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canTrack) {
      return;
    }
    addMutation.mutate();
  }

  const enabledCount = query.data?.filter((watchlist) => watchlist.enabled).length ?? 0;
  const visibleBriefs = useMemo(
    () =>
      (briefsQuery.data ?? []).filter((brief) =>
        isPastOrTodayIsoDate(brief.brief_date, today),
      ),
    [briefsQuery.data, today],
  );
  const latestBrief = visibleBriefs[0];
  const canRename =
    Boolean(selectedWatchlist?.id) &&
    Boolean(rename.trim()) &&
    rename.trim() !== selectedWatchlist?.name;
  const canTrack =
    Boolean(watchlistId) &&
    (trackMode === 'symbol' ? Boolean(normalizedSymbol) : Boolean(selectedThesisId));
  const selectedDisabled = selectedWatchlist && !selectedWatchlist.enabled;

  return (
    <main className="page">
      <PageHeader
        eyebrow="06 Watchlists & Briefs"
        title="Watchlists and briefs"
        description="Track symbols or research theses, check alerts against saved thesis conditions, then create a brief from the selected watchlist."
      />
      <BentoGrid>
        <MetricTile
          className="span-3"
          icon={<ClipboardList size={18} />}
          label="Watchlists"
          tone="primary"
          value={query.isLoading ? '...' : query.data?.length ?? 0}
        />
        <MetricTile
          className="span-3"
          icon={<RadioTower size={18} />}
          label="Active"
          tone="constructive"
          value={enabledCount}
        />
        <MetricTile
          className="span-3"
          icon={<Archive size={18} />}
          label="Selected tracks"
          value={itemsQuery.isLoading ? '...' : itemsQuery.data?.length ?? 0}
        />
        <MetricTile
          className="span-3"
          icon={<FileText size={18} />}
          label={briefsSelectedOnly ? 'Selected briefs' : 'Workspace briefs'}
          tone="warning"
          value={briefsQuery.isLoading ? '...' : visibleBriefs.length}
        />

        <Panel className="span-4 emphasis" title="Watchlists" description="Select the monitoring scope">
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState error={query.error} /> : null}
          {query.data?.length === 0 ? <EmptyState label="No watchlists found." /> : null}
          {query.data && query.data.length > 0 ? (
            <label className="label">
              Search
              <div className="input-with-icon">
                <Search aria-hidden size={16} />
                <input
                  value={watchlistSearch}
                  onChange={(event) => setWatchlistSearch(event.target.value)}
                  placeholder="Core, alt, watch_..."
                />
              </div>
            </label>
          ) : null}
          {query.data && query.data.length > 0 && filteredWatchlists.length === 0 ? (
            <EmptyState label="No watchlist matches this search." />
          ) : null}
          <div className="stack">
            {filteredWatchlists.map((watchlist) => (
              <button
                className={`list-row${watchlist.id === watchlistId ? ' active' : ''}`}
                key={watchlist.id ?? watchlist.name}
                onClick={() => setWatchlistId(watchlist.id ?? '')}
                type="button"
              >
                <div className="row">
                  <strong>{watchlist.name}</strong>
                  <span className={watchlist.enabled ? 'badge constructive' : 'badge warning'}>
                    {watchlist.enabled ? 'active' : 'paused'}
                  </span>
                </div>
                <div className="row small muted">
                  <span>Created {formatDateTime(watchlist.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="divider" />
          <form className="compact-create" onSubmit={submitCreate}>
            <label className="label">
              New watchlist
              <input
                className="input"
                value={newWatchlistName}
                onChange={(event) => setNewWatchlistName(event.target.value)}
                required
              />
            </label>
            {createMutation.isError ? <span className="badge risk">{errorMessage(createMutation.error)}</span> : null}
            {createMutation.isSuccess ? <span className="badge constructive">watchlist created</span> : null}
            <button className="button primary" disabled={createMutation.isPending} type="submit">
              <Plus aria-hidden size={16} />
              {createMutation.isPending ? 'Creating' : 'Create'}
            </button>
          </form>
        </Panel>

        <Panel
          className="span-8 emphasis"
          title="Add track"
          description={selectedWatchlist ? `Destination: ${selectedWatchlist.name}` : 'Select a destination watchlist'}
        >
          <form className="stack lg" onSubmit={submitItem}>
            <label className="label">
              Add to watchlist
              <select
                className="select"
                disabled={query.isLoading || query.isError || query.data?.length === 0}
                value={watchlistId}
                onChange={(event) => setWatchlistId(event.target.value)}
              >
                <option value="">Select watchlist</option>
                {query.data?.map((watchlist) => (
                  <option key={watchlist.id ?? watchlist.name} value={watchlist.id ?? ''}>
                    {watchlist.name}{watchlist.enabled ? '' : ' (paused)'}
                  </option>
                ))}
              </select>
            </label>

            <div className="segmented-control" aria-label="Track type">
              <button
                aria-pressed={trackMode === 'symbol'}
                className={`segment-button${trackMode === 'symbol' ? ' active' : ''}`}
                onClick={() => setTrackMode('symbol')}
                type="button"
              >
                Symbol
              </button>
              <button
                aria-pressed={trackMode === 'thesis'}
                className={`segment-button${trackMode === 'thesis' ? ' active' : ''}`}
                onClick={() => setTrackMode('thesis')}
                type="button"
              >
                Thesis
              </button>
            </div>

            {trackMode === 'symbol' ? (
              <div className="stack">
                <label className="label">
                  Symbol
                  <input
                    className="input"
                    value={symbol}
                    onBlur={() => setSymbol(normalizedSymbol || symbol.trim())}
                    onChange={(event) => setSymbol(event.target.value)}
                    placeholder="ETH/USDT"
                  />
                </label>
                <div className="symbol-chip-row" aria-label="Quick symbols">
                  {QUICK_SYMBOLS.map((quickSymbol) => (
                    <button
                      className={`symbol-chip${normalizedSymbol === quickSymbol ? ' active' : ''}`}
                      key={quickSymbol}
                      onClick={() => setSymbol(quickSymbol)}
                      type="button"
                    >
                      {quickSymbol.replace('/USDT', '')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {trackMode === 'thesis' ? (
              <div className="stack">
                <label className="label">
                  Search thesis
                  <div className="input-with-icon">
                    <Search aria-hidden size={16} />
                    <input
                      value={thesisSearch}
                      onChange={(event) => setThesisSearch(event.target.value)}
                      placeholder="ETH, long, run_b97..."
                    />
                  </div>
                </label>
                {thesesQuery.isLoading ? <LoadingState label="Loading theses..." /> : null}
                {thesesQuery.isError ? <ErrorState error={thesesQuery.error} /> : null}
                {!thesesQuery.isLoading && visibleThesisOptions.length === 0 ? (
                  <EmptyState label="No thesis matches this search." />
                ) : null}
                <div className="thesis-option-list">
                  {visibleThesisOptions.map((thesis) => (
                    <button
                      className={`thesis-option${thesis.id === selectedThesisId ? ' active' : ''}`}
                      key={thesis.id ?? thesis.symbol}
                      onClick={() => setSelectedThesisId(thesis.id ?? '')}
                      type="button"
                    >
                      <span className="row">
                        <strong>{thesis.symbol}</strong>
                        <DirectionBadge value={thesis.direction} />
                      </span>
                      <span className="row small muted">
                        <span>{thesis.setup_type || invalidationText(thesis)}</span>
                        <ConfidenceBadge value={thesis.confidence} />
                      </span>
                      <span className="small muted">{shortId(thesis.research_run_id || thesis.id || 'manual')}</span>
                    </button>
                  ))}
                </div>
                {requestedThesisId && !selectedThesis && !thesesQuery.isLoading ? (
                  <span className="badge warning">Requested thesis is not in this workspace.</span>
                ) : null}
              </div>
            ) : null}

            {selectedWatchlist && !selectedWatchlist.enabled ? (
              <div className="callout warning">This watchlist is paused. Tracks can be added, but checks stay paused.</div>
            ) : null}
            {addMutation.isError ? <span className="badge risk">{errorMessage(addMutation.error)}</span> : null}
            {addMutation.isSuccess ? <span className="badge constructive">tracking added</span> : null}
            <button className="button primary" disabled={addMutation.isPending || !canTrack} type="submit">
              <Plus aria-hidden size={16} />
              {trackMode === 'thesis' ? 'Add selected thesis' : `Add ${normalizedSymbol || 'symbol'}`}
            </button>
          </form>
        </Panel>

        <Panel
          className="span-5"
          title="Selected watchlist"
          description="Alert checks and brief creation run only when this watchlist is active."
        >
          {selectedWatchlist ? (
            <div className="stack">
              <div className="row">
                <strong>{selectedWatchlist.name}</strong>
                <span className={selectedWatchlist.enabled ? 'badge constructive' : 'badge warning'}>
                  {selectedWatchlist.enabled ? 'active' : 'paused'}
                </span>
              </div>
              {selectedDisabled ? (
                <div className="callout warning">
                  This watchlist is paused, so alert checks and brief creation are disabled.
                </div>
              ) : null}
              <div className="stack small">
                <DataPair label="Tracks" value={itemsQuery.isLoading ? '...' : itemsQuery.data?.length ?? 0} />
                <DataPair label="Latest brief" value={latestBrief?.brief_date ? formatDate(latestBrief.brief_date) : 'n/a'} />
                <DataPair label="Created" value={formatDateTime(selectedWatchlist.created_at)} />
              </div>
              <form className="stack" onSubmit={submitRename}>
                <label className="label">
                  Rename
                  <input
                    className="input"
                    value={rename}
                    onChange={(event) => setRename(event.target.value)}
                    required
                  />
                </label>
                <div className="top-strip-meta">
                  <button className="button" disabled={updateMutation.isPending || !canRename} type="submit">
                    <Edit3 aria-hidden size={16} />
                    Rename
                  </button>
                  <button
                    className="button"
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({
                        id: selectedWatchlist.id ?? '',
                        enabled: !selectedWatchlist.enabled,
                      })
                    }
                    type="button"
                  >
                    {selectedWatchlist.enabled ? (
                      <PauseCircle aria-hidden size={16} />
                    ) : (
                      <PlayCircle aria-hidden size={16} />
                    )}
                    {selectedWatchlist.enabled ? 'Pause watchlist' : 'Resume watchlist'}
                  </button>
                </div>
              </form>
              {updateMutation.isError ? <span className="badge risk">{errorMessage(updateMutation.error)}</span> : null}
              <div className="top-strip-meta">
                <button
                  className="button"
                  disabled={checkMutation.isPending || !selectedWatchlist.enabled}
                  onClick={() => checkMutation.mutate()}
                  type="button"
                >
                  <Activity aria-hidden size={16} />
                  {checkMutation.isPending ? 'Checking alerts' : 'Check alerts'}
                </button>
                <button
                  className="button"
                  disabled={briefMutation.isPending || !selectedWatchlist.enabled}
                  onClick={() => briefMutation.mutate()}
                  type="button"
                >
                  <RefreshCw aria-hidden size={16} />
                  {briefMutation.isPending ? 'Creating brief' : 'Create brief'}
                </button>
              </div>
              {checkMutation.isError ? <span className="badge risk">{errorMessage(checkMutation.error)}</span> : null}
              {briefMutation.isError ? <span className="badge risk">{errorMessage(briefMutation.error)}</span> : null}
              {checkMutation.data ? (
                <div className="callout">
                  Checked {checkMutation.data.checked_items} track(s) and created{' '}
                  {checkMutation.data.alerts_created.length} alert(s).
                  {checkMutation.data.skipped_items.length > 0 ? (
                    <div className="small muted">
                      Skipped: {checkMutation.data.skipped_items.join(', ')}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {briefMutation.data ? (
                <span className="badge constructive">brief saved</span>
              ) : null}
            </div>
          ) : (
            <EmptyState label="Select or create a watchlist." />
          )}
        </Panel>

        <Panel
          className="span-7"
          title={selectedWatchlist ? `${selectedWatchlist.name} tracks` : 'Watchlist tracks'}
          description="Thesis tracks carry stance, invalidation, confidence, and source run context."
        >
          {!watchlistId ? <EmptyState label="Select a watchlist to view tracks." /> : null}
          {itemsQuery.isLoading ? <LoadingState /> : null}
          {itemsQuery.isError ? <ErrorState error={itemsQuery.error} /> : null}
          {itemsQuery.data?.length === 0 ? <EmptyState label="No tracks in this watchlist." /> : null}
          <div className="grid two">
            {itemsQuery.data?.map((item) => (
              <WatchlistItemCard
                item={item}
                key={item.id ?? `${item.item_type}-${item.symbol}-${item.thesis_id}`}
                onRemove={(itemId) => removeMutation.mutate(itemId)}
                removing={removeMutation.isPending}
                thesis={item.thesis_id ? thesesById.get(item.thesis_id) ?? null : null}
              />
            ))}
          </div>
        </Panel>

        <Panel className="span-12" title="Brief archive" description="Review saved briefs without mixing scopes by default.">
          <div className="row start" style={{ marginBottom: 12 }}>
            <label className="inline-check">
              <input
                checked={briefsSelectedOnly}
                disabled={!watchlistId}
                onChange={(event) => setBriefsSelectedOnly(event.target.checked)}
                type="checkbox"
              />
              Selected watchlist only
            </label>
            {selectedWatchlist && briefsSelectedOnly ? (
              <span className="badge primary">{selectedWatchlist.name}</span>
            ) : (
              <span className="badge warning">All watchlists</span>
            )}
          </div>
          {briefsQuery.isLoading ? <LoadingState /> : null}
          {briefsQuery.isError ? <ErrorState error={briefsQuery.error} /> : null}
          {!briefsQuery.isLoading && visibleBriefs.length === 0 ? <EmptyState label="No briefs found." /> : null}
          {latestBrief ? <BriefCard brief={latestBrief} featured /> : null}
          <div className="grid two">
            {visibleBriefs.slice(1).map((brief) => (
              <BriefCard
                brief={brief}
                key={brief.id ?? `${brief.title}-${brief.created_at}`}
              />
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function WatchlistItemCard({
  item,
  thesis,
  onRemove,
  removing,
}: {
  item: WatchlistItemResponse;
  thesis: ThesisResponse | null;
  onRemove: (itemId: string) => void;
  removing: boolean;
}) {
  if (item.item_type === 'thesis') {
    return (
      <div className="state-card">
        <div className="row">
          <strong>{thesis?.symbol ?? item.symbol ?? 'Research thesis'}</strong>
          {thesis ? <DirectionBadge value={thesis.direction} /> : <span className="badge warning">missing thesis</span>}
        </div>
        {thesis ? (
          <>
            <p className="small muted">{thesis.summary.action_summary || thesis.thesis_text || 'No summary.'}</p>
            <div className="stack small">
              <DataPair label="Invalidation" value={invalidationText(thesis)} />
              <DataPair label="Confidence" value={<ConfidenceBadge value={thesis.confidence} />} />
              <DataPair label="Source run" value={<IdChip value={thesis.research_run_id} />} />
            </div>
            <Link className="button" to={routes.thesis(thesis.id ?? '')}>
              Open thesis
            </Link>
          </>
        ) : (
          <p className="small muted">The saved thesis could not be found in this workspace.</p>
        )}
        <ItemFooter item={item} onRemove={onRemove} removing={removing} />
      </div>
    );
  }

  if (item.item_type === 'symbol') {
    return (
      <div className="state-card">
        <div className="row">
          <strong>{item.symbol || 'Symbol'}</strong>
          <span className={item.enabled ? 'badge constructive' : 'badge warning'}>
            {item.enabled ? 'active' : 'paused'}
          </span>
        </div>
        <p className="small muted">Track a symbol only. Briefs include the latest saved market snapshot when available.</p>
        <ItemFooter item={item} onRemove={onRemove} removing={removing} />
      </div>
    );
  }

  return (
    <div className="state-card">
      <div className="row">
        <strong>{item.setup_type || 'Setup watch'}</strong>
        <span className={item.enabled ? 'badge constructive' : 'badge warning'}>
          {item.enabled ? 'active' : 'paused'}
        </span>
      </div>
      <p className="small muted">Setup type watch retained from existing data.</p>
      <ItemFooter item={item} onRemove={onRemove} removing={removing} />
    </div>
  );
}

function ItemFooter({
  item,
  onRemove,
  removing,
}: {
  item: WatchlistItemResponse;
  onRemove: (itemId: string) => void;
  removing: boolean;
}) {
  return item.id ? (
    <button
      className="button"
      disabled={removing}
      onClick={() => onRemove(item.id as string)}
      type="button"
    >
      <Trash2 aria-hidden size={16} />
      Remove
    </button>
  ) : null;
}

function thesisSelectLabel(thesis: ThesisResponse): string {
  const confidence =
    thesis.confidence === null ? 'unknown confidence' : `confidence ${formatConfidence(thesis.confidence)}`;
  const source = thesis.research_run_id ? `from ${shortId(thesis.research_run_id)}` : 'manual thesis';
  return `${thesis.symbol} | ${thesis.direction || 'watch'} | ${confidence} | ${source}`;
}

function invalidationText(thesis: ThesisResponse): string {
  const invalidation = thesis.invalidation_level || thesis.summary.invalidation;
  if (!invalidation) {
    return 'n/a';
  }
  if (/\b(above|below|over|under)\b/i.test(invalidation)) {
    return invalidation;
  }
  const direction = thesis.direction.toLowerCase();
  const prefix = direction.includes('short') || direction.includes('bear') ? 'above' : 'below';
  return `${prefix} ${invalidation}`;
}

function normalizeSymbolInput(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return '';
  }
  if (normalized.includes('/')) {
    return normalized;
  }
  for (const delimiter of ['-', '_', ':']) {
    if (normalized.includes(delimiter)) {
      const [base, quote] = normalized.split(delimiter, 2);
      return base && quote ? `${base}/${normalizeQuote(quote)}` : normalized;
    }
  }
  for (const quote of ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH']) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return `${normalized.slice(0, -quote.length)}/${normalizeQuote(quote)}`;
    }
  }
  if (normalized.endsWith('DT') && normalized.length > 2) {
    return `${normalized.slice(0, -2)}/USDT`;
  }
  return `${normalized}/USDT`;
}

function normalizeQuote(quote: string): string {
  return quote === 'USD' ? 'USDT' : quote;
}

function shortId(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 12)}...`;
}
