import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class ThesesService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  list(limit = 50, userId?: string, workspaceHeader?: string) {
    return this.journal.listTheses(
      limit,
      this.resolveWorkspace(userId, workspaceHeader),
    );
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (!thesis) {
      throw new NotFoundException(`Thesis ${id} not found`);
    }
    return thesis;
  }

  async decide(
    id: string,
    action: string,
    notes = '',
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    await this.get(id, userId, workspaceId);
    return this.journal.recordThesisDecision(id, action, notes, workspaceId);
  }

  async review(
    id: string,
    result: string,
    notes = '',
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    await this.get(id, userId, workspaceId);
    return this.journal.recordThesisReview(id, result, notes, workspaceId);
  }

  private resolveWorkspace(userId?: string, workspaceHeader?: string): string {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    this.workspaces.assertAccess(user, workspaceId);
    return workspaceId;
  }
}
