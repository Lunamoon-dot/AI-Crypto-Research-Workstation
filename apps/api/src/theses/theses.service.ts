import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  toRunThesisPulseResponse,
  toRunThesisPulseMemoResponse,
  toThesisResponse,
  toThesisMonitorPlanResponse,
  toThesisPulseMemoResponse,
  toThesisPulseResponse,
  toThesisReviewResponse,
} from '../contracts/frontend-contract';
import { clampListLimit } from '../common/query-limit';
import { PythonEngineClient } from '../jobs/python-engine.client';
import {
  PatchThesisMonitorPlanDto,
  RunThesisPulseMemoDto,
  RunThesisPulseDto,
} from './dto/thesis-monitoring.dto';

@Injectable()
export class ThesesService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    @Optional()
    private readonly pythonEngine?: PythonEngineClient,
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

  async monitorPlan(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    await this.assertThesisReadable(id, workspaceId);
    const existing = await this.monitorPlanFromStorage(id, workspaceId);
    if (existing) {
      return toThesisMonitorPlanResponse(existing);
    }
    const result = await this.runMonitorPlanEngine(id, workspaceId);
    if (result.error_type) {
      throw engineError(result, `Monitor plan for thesis ${id} is unavailable`);
    }
    const plan = recordFromValue(result.monitor_plan);
    if (!plan) {
      throw new ServiceUnavailableException(
        `Monitor plan for thesis ${id} was not returned by the engine`,
      );
    }
    return toThesisMonitorPlanResponse(plan);
  }

  async updateMonitorPlan(
    id: string,
    dto: PatchThesisMonitorPlanDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.assertThesisReadable(id, workspaceId);
    const result = await this.runMonitorPlanEngine(id, workspaceId, dto as JsonRecord);
    if (result.error_type) {
      throw engineError(result, `Monitor plan for thesis ${id} was not updated`);
    }
    const plan = recordFromValue(result.monitor_plan);
    if (!plan) {
      throw new ServiceUnavailableException(
        `Monitor plan for thesis ${id} was not returned by the engine`,
      );
    }
    return toThesisMonitorPlanResponse(plan);
  }

  async runPulse(
    id: string,
    dto: RunThesisPulseDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.assertThesisReadable(id, workspaceId);
    if (!this.pythonEngine) {
      throw new ServiceUnavailableException('Python engine client is unavailable.');
    }
    const result = await this.pythonEngine.runPulse({
      thesis_id: id,
      workspace_id: workspaceId,
      force: dto?.force ?? false,
      observed_at: dto?.observed_at,
      metadata: { source: 'api' },
    });
    if (result.error_type) {
      throw engineError(result, `Pulse for thesis ${id} failed`);
    }
    return toRunThesisPulseResponse(result);
  }

  async pulses(
    id: string,
    limit = 200,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    await this.assertThesisReadable(id, workspaceId);
    const rows = await this.pulsesFromStorage(
      id,
      workspaceId,
      clampListLimit(limit, { defaultLimit: 200, maxLimit: 1000 }),
    );
    return rows
      .map(toThesisPulseResponse)
      .sort((a, b) =>
        String(a.observed_at ?? '').localeCompare(String(b.observed_at ?? '')),
      );
  }

  async runPulseMemo(
    id: string,
    dto: RunThesisPulseMemoDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.assertThesisReadable(id, workspaceId);
    if (!this.pythonEngine) {
      throw new ServiceUnavailableException('Python engine client is unavailable.');
    }
    const result = await this.pythonEngine.runPulseMemo({
      thesis_id: id,
      workspace_id: workspaceId,
      force: dto?.force ?? false,
      window_minutes: dto?.window_minutes,
      observed_at: dto?.observed_at,
      metadata: { source: 'api', pulse_memo: { llm_enabled: true } },
    });
    if (result.error_type) {
      throw engineError(result, `Pulse memo for thesis ${id} failed`);
    }
    return toRunThesisPulseMemoResponse(result);
  }

  async pulseMemos(
    id: string,
    limit = 50,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    await this.assertThesisReadable(id, workspaceId);
    const rows = await this.pulseMemosFromStorage(
      id,
      workspaceId,
      clampListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
    );
    return rows
      .map(toThesisPulseMemoResponse)
      .sort((a, b) =>
        String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
      );
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

  private async assertThesisReadable(
    id: string,
    workspaceId: string,
  ): Promise<void> {
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (thesis) {
      return;
    }
    const sqliteThesis = await this.thesisFromSqlite(id, workspaceId);
    if (sqliteThesis) {
      return;
    }
    throw new NotFoundException(`Thesis ${id} not found`);
  }

  private async monitorPlanFromStorage(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const fromJournal = await this.journal.getThesisMonitorPlan?.(id, workspaceId);
    if (fromJournal) {
      return fromJournal;
    }
    const sqlite = await this.sqliteSync?.exportThesis(id);
    return sqlite
      ? rows(sqlite, 'thesis_monitor_plans').find(
          (plan) =>
            stringField(plan.thesis_id) === id &&
            stringField(plan.workspace_id ?? 'local') === workspaceId,
        ) ?? null
      : null;
  }

  private async pulsesFromStorage(
    id: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]> {
    const fromJournal = await this.journal.listThesisPulses?.(
      id,
      workspaceId,
      limit,
    );
    if (fromJournal) {
      return fromJournal;
    }
    const sqlite = await this.sqliteSync?.exportThesis(id);
    return sqlite
      ? rows(sqlite, 'thesis_pulses')
          .filter(
            (pulse) =>
              stringField(pulse.thesis_id) === id &&
              stringField(pulse.workspace_id ?? 'local') === workspaceId,
          )
          .slice(0, limit)
      : [];
  }

  private async pulseMemosFromStorage(
    id: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]> {
    const fromJournal = await this.journal.listThesisPulseMemos?.(
      id,
      workspaceId,
      limit,
    );
    if (fromJournal) {
      return fromJournal;
    }
    const sqlite = await this.sqliteSync?.exportThesis(id);
    return sqlite
      ? rows(sqlite, 'thesis_pulse_memos')
          .filter(
            (memo) =>
              stringField(memo.thesis_id) === id &&
              stringField(memo.workspace_id ?? 'local') === workspaceId,
          )
          .slice(0, limit)
      : [];
  }

  private async runMonitorPlanEngine(
    id: string,
    workspaceId: string,
    updates: JsonRecord = {},
  ): Promise<JsonRecord> {
    if (!this.pythonEngine) {
      throw new ServiceUnavailableException('Python engine client is unavailable.');
    }
    return this.pythonEngine.monitorPlan({
      thesis_id: id,
      workspace_id: workspaceId,
      updates,
      metadata: { source: 'api' },
    });
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

function engineError(result: JsonRecord, fallback: string): Error {
  const message = String(result.error ?? fallback);
  const type = String(result.error_type ?? '');
  if (type.includes('ValueError')) {
    return new BadRequestException(message);
  }
  return new ServiceUnavailableException(message);
}
