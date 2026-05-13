import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { toAlertResponse } from '../contracts/frontend-contract';
import { WorkspacesService } from '../workspaces/workspaces.service';

export type AlertListOptions = {
  symbol?: string;
  thesisId?: string;
  unreadOnly?: boolean;
  limit?: number;
};

@Injectable()
export class AlertsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(
    options: AlertListOptions,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const limit = clampLimit(options.limit ?? 50);
    const alerts = await this.journal.listAlerts(
      options.symbol,
      options.thesisId,
      options.unreadOnly ?? false,
      limit,
      workspaceId,
    );
    return alerts.map(toAlertResponse);
  }

  async markRead(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const alert = await this.journal.markAlertRead(id, workspaceId);
    return toAlertResponse(alert);
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

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}
