import { Inject, Injectable } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';

@Injectable()
export class WatchlistsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  list(limit = 50, userId?: string, workspaceHeader?: string) {
    return this.journal.listWatchlists(
      limit,
      this.resolveWorkspace(userId, workspaceHeader),
    );
  }

  addItem(
    id: string,
    dto: AddWatchlistItemDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    return this.journal.addWatchlistItem(
      id,
      { ...dto },
      this.resolveWorkspace(userId, workspaceHeader),
    );
  }

  private resolveWorkspace(userId?: string, workspaceHeader?: string): string {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    this.workspaces.assertAccess(user, workspaceId);
    return workspaceId;
  }
}
