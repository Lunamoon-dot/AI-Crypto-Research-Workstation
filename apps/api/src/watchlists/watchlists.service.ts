import { Inject, Injectable } from '@nestjs/common';
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
    const watchlists = await this.journal.listWatchlists(limit, workspaceId);
    return watchlists.map(toWatchlistResponse);
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
