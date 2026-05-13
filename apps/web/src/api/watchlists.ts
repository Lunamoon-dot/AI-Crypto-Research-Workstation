import { AuthContextValue } from '@/auth/auth-types';
import { apiRequest } from '@/api/client';
import {
  AddWatchlistItemRequest,
  CreateWatchlistRequest,
  RemoveWatchlistItemResponse,
  UpdateWatchlistRequest,
  WatchlistItemResponse,
  WatchlistResponse,
} from '@/api/types';

export function listWatchlists(
  params: { limit?: number },
  auth: AuthContextValue,
) {
  return apiRequest<WatchlistResponse[]>(
    '/watchlists',
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}

export function createWatchlist(
  request: CreateWatchlistRequest,
  auth: AuthContextValue,
) {
  return apiRequest<WatchlistResponse>(
    '/watchlists',
    { method: 'POST', body: request },
    auth,
  );
}

export function getWatchlist(id: string, auth: AuthContextValue) {
  return apiRequest<WatchlistResponse>(
    `/watchlists/${encodeURIComponent(id)}`,
    {},
    auth,
  );
}

export function getWatchlistItems(id: string, auth: AuthContextValue) {
  return apiRequest<WatchlistItemResponse[]>(
    `/watchlists/${encodeURIComponent(id)}/items`,
    {},
    auth,
  );
}

export function addWatchlistItem(
  id: string,
  request: AddWatchlistItemRequest,
  auth: AuthContextValue,
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
  auth: AuthContextValue,
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
  auth: AuthContextValue,
) {
  return apiRequest<RemoveWatchlistItemResponse>(
    `/watchlists/${encodeURIComponent(watchlistId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
    auth,
  );
}
