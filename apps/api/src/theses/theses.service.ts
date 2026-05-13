import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  toScenarioResponse,
  toThesisDecisionResponse,
  toThesisResponse,
  toThesisReviewResponse,
} from '../contracts/frontend-contract';

@Injectable()
export class ThesesService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  list(limit = 50, userId?: string, workspaceHeader?: string) {
    return this.journal
      .listTheses(limit, this.resolveWorkspace(userId, workspaceHeader))
      .then((theses) => theses.map(toThesisResponse));
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (!thesis) {
      throw new NotFoundException(`Thesis ${id} not found`);
    }
    return toThesisResponse(thesis);
  }

  async scenarios(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    await this.get(id, userId, workspaceId);
    const scenarios = await this.journal.listScenarios(id, workspaceId);
    return scenarios.map(toScenarioResponse);
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
    const decision = await this.journal.recordThesisDecision(
      id,
      action,
      notes,
      workspaceId,
    );
    return toThesisDecisionResponse(decision);
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
    const review = await this.journal.recordThesisReview(
      id,
      result,
      notes,
      workspaceId,
    );
    return toThesisReviewResponse(review);
  }

  private resolveWorkspace(userId?: string, workspaceHeader?: string): string {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    this.workspaces.assertAccess(user, workspaceId);
    return workspaceId;
  }
}
