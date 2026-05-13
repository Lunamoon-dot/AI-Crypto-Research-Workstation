'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addWatchlistItem,
  createWatchlist,
  getWatchlistItems,
  listWatchlists,
  removeWatchlistItem,
  updateWatchlist,
} from '@/api/watchlists';
import { errorMessage } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { useAuth } from '@/auth/auth-provider';
import { IdChip } from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';

export function WatchlistsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.watchlists({ limit: 100 }),
    queryFn: () => listWatchlists({ limit: 100 }, auth),
  });
  const [watchlistId, setWatchlistId] = useState('');
  const selectedWatchlist =
    query.data?.find((watchlist) => watchlist.id === watchlistId) ?? null;
  const itemsQuery = useQuery({
    queryKey: queryKeys.watchlistItems(watchlistId),
    queryFn: () => getWatchlistItems(watchlistId, auth),
    enabled: Boolean(watchlistId),
  });
  const [newWatchlistName, setNewWatchlistName] = useState('Core watchlist');
  const [rename, setRename] = useState('');
  const [itemType, setItemType] = useState('symbol');
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [thesisId, setThesisId] = useState('');
  const [setupType, setSetupType] = useState('');
  useEffect(() => {
    if (!watchlistId && query.data?.[0]?.id) {
      setWatchlistId(query.data[0].id);
    }
  }, [query.data, watchlistId]);

  useEffect(() => {
    setRename(selectedWatchlist?.name ?? '');
  }, [selectedWatchlist?.id, selectedWatchlist?.name]);

  const createMutation = useMutation({
    mutationFn: () =>
      createWatchlist({ name: newWatchlistName, enabled: true }, auth),
    onSuccess: (watchlist) => {
      setNewWatchlistName('');
      setWatchlistId(watchlist.id ?? '');
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlists({}) });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlists({}) });
    },
  });

  const addMutation = useMutation({
    mutationFn: () =>
      addWatchlistItem(
        watchlistId,
        {
          item_type: itemType,
          symbol: itemType === 'symbol' ? symbol : undefined,
          thesis_id: itemType === 'thesis' ? thesisId : undefined,
          setup_type: itemType === 'setup_type' ? setupType : undefined,
        },
        auth,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.watchlistItems(watchlistId),
      });
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
    addMutation.mutate();
  }

  return (
    <main className="page">
      <PageHeader title="Watchlists" description="Local monitoring scopes from the API." />
      <div className="grid two">
        <Panel title="Existing watchlists">
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState error={query.error} /> : null}
          {query.data?.length === 0 ? <EmptyState label="No watchlists found." /> : null}
          <div className="stack">
            {query.data?.map((watchlist) => (
              <button
                className={`list-row${watchlist.id === watchlistId ? ' active' : ''}`}
                key={watchlist.id ?? watchlist.name}
                onClick={() => setWatchlistId(watchlist.id ?? '')}
                type="button"
              >
                <div className="row">
                  <strong>{watchlist.name}</strong>
                  <span className={watchlist.enabled ? 'badge constructive' : 'badge'}>
                    {watchlist.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div className="row small muted">
                  <span>{formatDateTime(watchlist.created_at)}</span>
                  <IdChip value={watchlist.id} />
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Create watchlist">
          <form className="stack" onSubmit={submitCreate}>
            <label className="label">
              Name
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
              Create watchlist
            </button>
          </form>
        </Panel>

        <Panel title="Selected watchlist">
          {selectedWatchlist ? (
            <div className="stack">
              <div className="row">
                <strong>{selectedWatchlist.name}</strong>
                <span className={selectedWatchlist.enabled ? 'badge constructive' : 'badge'}>
                  {selectedWatchlist.enabled ? 'enabled' : 'disabled'}
                </span>
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
                  <button className="button" disabled={updateMutation.isPending} type="submit">
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
                    {selectedWatchlist.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </form>
              {updateMutation.isError ? <span className="badge risk">{errorMessage(updateMutation.error)}</span> : null}
            </div>
          ) : (
            <EmptyState label="Select or create a watchlist." />
          )}
        </Panel>

        <Panel title="Watch items">
          {!watchlistId ? <EmptyState label="Select a watchlist to view items." /> : null}
          {itemsQuery.isLoading ? <LoadingState /> : null}
          {itemsQuery.isError ? <ErrorState error={itemsQuery.error} /> : null}
          {itemsQuery.data?.length === 0 ? <EmptyState label="No items in this watchlist." /> : null}
          <div className="stack">
            {itemsQuery.data?.map((item) => (
              <div className="list-row" key={item.id ?? `${item.item_type}-${item.symbol}`}>
                <div className="row">
                  <strong>{item.symbol ?? item.thesis_id ?? item.setup_type ?? 'watch item'}</strong>
                  <span className={item.enabled ? 'badge constructive' : 'badge'}>
                    {item.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div className="top-strip-meta">
                  <span className="badge">{item.item_type}</span>
                  <IdChip value={item.id} />
                </div>
                {item.id ? (
                  <button
                    className="button"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(item.id as string)}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Add watch item">
          <form className="stack" onSubmit={submitItem}>
            <label className="label">
              Watchlist ID
              <input
                className="input"
                value={watchlistId}
                onChange={(event) => setWatchlistId(event.target.value)}
                required
              />
            </label>
            <label className="label">
              Item type
              <select
                className="select"
                value={itemType}
                onChange={(event) => setItemType(event.target.value)}
              >
                <option value="symbol">symbol</option>
                <option value="thesis">thesis</option>
                <option value="setup_type">setup_type</option>
              </select>
            </label>
            {itemType === 'symbol' ? (
              <label className="label">
                Symbol
                <input className="input" value={symbol} onChange={(event) => setSymbol(event.target.value)} />
              </label>
            ) : null}
            {itemType === 'thesis' ? (
              <label className="label">
                Thesis ID
                <input className="input" value={thesisId} onChange={(event) => setThesisId(event.target.value)} />
              </label>
            ) : null}
            {itemType === 'setup_type' ? (
              <label className="label">
                Setup type
                <input className="input" value={setupType} onChange={(event) => setSetupType(event.target.value)} />
              </label>
            ) : null}
            {addMutation.isError ? <span className="badge risk">{errorMessage(addMutation.error)}</span> : null}
            {addMutation.isSuccess ? <span className="badge constructive">item added</span> : null}
            <button className="button primary" disabled={addMutation.isPending || !watchlistId} type="submit">
              Add item
            </button>
          </form>
        </Panel>
      </div>
    </main>
  );
}
