import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  toSignalDetailResponse,
  toSignalResponse,
} from '../contracts/frontend-contract';
import { normalizeOptionalCryptoSymbol } from '../common/market-symbols';
import { clampListLimit } from '../common/query-limit';

@Injectable()
export class SignalsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(
    symbol?: string,
    limit = 50,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    const signals = await this.journal.listSignals(
      normalizeOptionalCryptoSymbol(symbol),
      clampListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      workspaceId,
    );
    return signals.map(toSignalResponse);
  }

  async count(symbol?: string, userId?: string, workspaceHeader?: string) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return this.journal.summarizeSignals(
      normalizeOptionalCryptoSymbol(symbol),
      workspaceId,
    );
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    const signal = await this.journal.getSignal(id, workspaceId);
    if (!signal) {
      throw new NotFoundException(`Signal ${id} not found`);
    }
    return toSignalDetailResponse(signal);
  }
}
