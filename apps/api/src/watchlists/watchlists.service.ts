import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  toWatchlistItemResponse,
  toWatchlistResponse,
} from '../contracts/frontend-contract';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { UpdateWatchlistDto } from './dto/update-watchlist.dto';

@Injectable()
export class WatchlistsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(limit = 50, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const watchlists = await this.journal.listWatchlists(
      normalizeLimit(limit),
      workspaceId,
    );
    return watchlists.map(toWatchlistResponse);
  }

  async create(
    dto: CreateWatchlistDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const watchlist = await this.journal.createWatchlist(
      { name: dto.name.trim(), enabled: dto.enabled },
      workspaceId,
    );
    return toWatchlistResponse(watchlist);
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const watchlist = await this.journal.getWatchlist(id, workspaceId);
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    return toWatchlistResponse(watchlist);
  }

  async items(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const watchlist = await this.journal.getWatchlist(id, workspaceId);
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    const items = await this.journal.listWatchlistItems(id, workspaceId);
    return items.map(toWatchlistItemResponse);
  }

  async addItem(
    id: string,
    dto: AddWatchlistItemDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const item = await this.journal.addWatchlistItem(id, { ...dto }, workspaceId);
    return toWatchlistItemResponse(item);
  }

  async update(
    id: string,
    dto: UpdateWatchlistDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const watchlist = await this.journal.updateWatchlist(
      id,
      {
        name: dto.name?.trim(),
        enabled: dto.enabled,
      },
      workspaceId,
    );
    return toWatchlistResponse(watchlist);
  }

  async removeItem(
    id: string,
    itemId: string,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    return this.journal.removeWatchlistItem(id, itemId, workspaceId);
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
    requiredRole: 'viewer' | 'editor' = 'viewer',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}
