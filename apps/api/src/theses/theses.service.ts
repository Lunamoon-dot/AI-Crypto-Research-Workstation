import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
  ThesisDecisionIntent,
  ThesisReviewMetrics,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  ExportedJournal,
  SqliteJournalSyncService,
} from '../jobs/sqlite-journal-sync.service';
import {
  toScenarioResponse,
  toThesisDecisionResponse,
  toThesisResponse,
  toThesisReviewResponse,
} from '../contracts/frontend-contract';
import { clampListLimit } from '../common/query-limit';

@Injectable()
export class ThesesService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    @Optional()
    private readonly sqliteSync?: SqliteJournalSyncService,
  ) {}

  async list(limit = 50, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const theses = await this.journal.listTheses(
      clampListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      workspaceId,
    );
    return theses.map(toThesisResponse);
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (thesis) {
      return toThesisResponse(thesis);
    }
    const sqliteThesis = await this.thesisFromSqlite(id, workspaceId);
    if (sqliteThesis) {
      return toThesisResponse(sqliteThesis);
    }
    throw new NotFoundException(`Thesis ${id} not found`);
  }

  async scenarios(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (thesis) {
      const scenarios = await this.journal.listScenarios(id, workspaceId);
      return scenarios.map(toScenarioResponse);
    }
    const sqlite = await this.sqliteSync?.exportThesis(id);
    const sqliteThesis = sqlite ? thesisFromExport(sqlite, id, workspaceId) : null;
    if (!sqliteThesis) {
      throw new NotFoundException(`Thesis ${id} not found`);
    }
    return scenariosFromExport(sqlite!, id, workspaceId).map(toScenarioResponse);
  }

  async decide(
    id: string,
    action: string,
    notes = '',
    userId?: string,
    workspaceHeader?: string,
    intent?: ThesisDecisionIntent,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.get(id, userId, workspaceId);
    const decision = await this.journal.recordThesisDecision(
      id,
      action,
      notes,
      workspaceId,
      intent,
    );
    return toThesisDecisionResponse(decision);
  }

  async review(
    id: string,
    result: string,
    notes = '',
    userId?: string,
    workspaceHeader?: string,
    metrics?: ThesisReviewMetrics,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.get(id, userId, workspaceId);
    const review = await this.journal.recordThesisReview(
      id,
      result,
      notes,
      workspaceId,
      metrics,
    );
    return toThesisReviewResponse(review);
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

  private async thesisFromSqlite(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const exported = await this.sqliteSync?.exportThesis(id);
    return exported ? thesisFromExport(exported, id, workspaceId) : null;
  }
}

function thesisFromExport(
  exported: ExportedJournal,
  id: string,
  workspaceId: string,
): JsonRecord | null {
  return (
    rows(exported, 'trade_theses').find(
      (thesis) =>
        stringField(thesis.id) === id &&
        stringField(thesis.workspace_id ?? 'local') === workspaceId,
    ) ?? null
  );
}

function scenariosFromExport(
  exported: ExportedJournal,
  thesisId: string,
  workspaceId: string,
): JsonRecord[] {
  return rows(exported, 'scenarios').filter(
    (scenario) =>
      stringField(scenario.thesis_id) === thesisId &&
      stringField(scenario.workspace_id ?? workspaceId) === workspaceId,
  );
}

function rows(exported: ExportedJournal, table: string): JsonRecord[] {
  return (exported[table] ?? []).map(normalizeSqliteRow);
}

function normalizeSqliteRow(row: JsonRecord): JsonRecord {
  const normalized: JsonRecord = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = key.endsWith('_json') ? parseJsonValue(value) : value;
  }
  const payload = recordFromValue(normalized.payload_json);
  if (payload) {
    const columns = { ...normalized };
    Object.assign(normalized, payload, columns, {
      payload,
      payload_json: payload,
    });
  }
  return normalized;
}

function recordFromValue(value: unknown): JsonRecord | null {
  const parsed = parseJsonValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as JsonRecord;
  }
  return null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringField(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}
