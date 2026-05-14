import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  AddWatchlistItemRequest,
  CheckWatchlistRequest,
  CreateWatchlistRequest,
  RemoveWatchlistItemResponse,
  UpdateWatchlistRequest,
  WatchlistCheckResponse,
  WatchlistItemResponse,
  WatchlistResponse,
} from '@/types';

export function listWatchlists(
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WatchlistResponse[]>(
    '/watchlists',
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}

export function createWatchlist(
  request: CreateWatchlistRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WatchlistResponse>(
    '/watchlists',
    { method: 'POST', body: request },
    auth,
  );
}

export function getWatchlist(id: string, auth: WorkspaceRequestContext) {
  return apiRequest<WatchlistResponse>(
    `/watchlists/${encodeURIComponent(id)}`,
    {},
    auth,
  );
}

export function getWatchlistItems(id: string, auth: WorkspaceRequestContext) {
  return apiRequest<WatchlistItemResponse[]>(
    `/watchlists/${encodeURIComponent(id)}/items`,
    {},
    auth,
  );
}

export function addWatchlistItem(
  id: string,
  request: AddWatchlistItemRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WatchlistItemResponse>(
    `/watchlists/${encodeURIComponent(id)}/items`,
    { method: 'POST', body: request },
    auth,
  );
}

export function updateWatchlist(
  id: string,
  request: UpdateWatchlistRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WatchlistResponse>(
    `/watchlists/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: request },
    auth,
  );
}

export function removeWatchlistItem(
  watchlistId: string,
  itemId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<RemoveWatchlistItemResponse>(
    `/watchlists/${encodeURIComponent(watchlistId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
    auth,
  );
}

export function checkWatchlist(
  id: string,
  request: CheckWatchlistRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WatchlistCheckResponse>(
    `/watchlists/${encodeURIComponent(id)}/check`,
    { method: 'POST', body: request },
    auth,
  );
}
