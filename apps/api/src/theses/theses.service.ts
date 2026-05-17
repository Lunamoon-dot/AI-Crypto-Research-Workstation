import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
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
  ThesisMonitorPlanResponse,
  ThesisSchedulerRunResponse,
  ThesisSchedulerStatusResponse,
} from '../contracts/frontend-contract';
import { clampListLimit } from '../common/query-limit';
import { PythonEngineClient } from '../jobs/python-engine.client';
import { MonitoringJobsService } from './monitoring-jobs.service';
import {
  PatchThesisMonitorPlanDto,
  RunThesisPulseMemoDto,
  RunThesisPulseDto,
  RunThesisSchedulerDto,
} from './dto/thesis-monitoring.dto';

type ThesisSchedulerRuntime = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastResult: ThesisSchedulerRunResponse | null;
};

const MIN_SCHEDULER_DELAY_MS = 1_000;
const MAX_SCHEDULER_DELAY_MS = 2_147_483_647;

@Injectable()
export class ThesesService implements OnModuleDestroy {
  private readonly logger = new Logger(ThesesService.name);
  private readonly schedulerRuntimes = new Map<string, ThesisSchedulerRuntime>();

  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    @Optional()
    private readonly pythonEngine?: PythonEngineClient,
    @Optional()
    private readonly sqliteSync?: SqliteJournalSyncService,
    @Optional()
    private readonly monitoringJobs?: MonitoringJobsService,
  ) {}

  onModuleDestroy(): void {
    for (const runtime of this.schedulerRuntimes.values()) {
      if (runtime.timer) {
        clearTimeout(runtime.timer);
      }
    }
    this.schedulerRuntimes.clear();
  }

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
    const plan = toThesisMonitorPlanResponse(
      await this.ensureMonitorPlanRecord(id, workspaceId),
    );
    this.syncSchedulerTimer(plan);
    return plan;
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
    const response = toThesisMonitorPlanResponse(
      await this.persistMonitorPlanIfNeeded(plan, workspaceId),
    );
    this.syncSchedulerTimer(response);
    return response;
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
    if (monitoringProductMode()) {
      await this.ensureMonitorPlanRecord(id, workspaceId);
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
    return toRunThesisPulseResponse(
      await this.persistPulseResultIfNeeded(result, workspaceId),
    );
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
    if (monitoringProductMode()) {
      await this.ensureMonitorPlanRecord(id, workspaceId);
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
    return toRunThesisPulseMemoResponse(
      await this.persistMemoResultIfNeeded(result, workspaceId),
    );
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

  async schedulerStatus(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ThesisSchedulerStatusResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    await this.assertThesisReadable(id, workspaceId);
    const plan = toThesisMonitorPlanResponse(
      await this.ensureMonitorPlanRecord(id, workspaceId),
    );
    this.syncSchedulerTimer(plan);
    return this.schedulerStatusFromPlan(plan);
  }

  async resumeScheduler(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ThesisSchedulerStatusResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.assertThesisReadable(id, workspaceId);
    const result = await this.runMonitorPlanEngine(id, workspaceId, {
      status: 'active',
      scheduler_enabled: true,
    });
    if (result.error_type) {
      throw engineError(result, `Scheduler for thesis ${id} was not resumed`);
    }
    const plan = recordFromValue(result.monitor_plan);
    if (!plan) {
      throw new ServiceUnavailableException(
        `Monitor plan for thesis ${id} was not returned by the engine`,
      );
    }
    const persisted = toThesisMonitorPlanResponse(
      await this.persistMonitorPlanIfNeeded(plan, workspaceId),
    );
    this.syncSchedulerTimer(persisted);
    return this.schedulerStatusFromPlan(persisted);
  }

  async pauseScheduler(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ThesisSchedulerStatusResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.assertThesisReadable(id, workspaceId);
    const result = await this.runMonitorPlanEngine(id, workspaceId, {
      scheduler_enabled: false,
    });
    if (result.error_type) {
      throw engineError(result, `Scheduler for thesis ${id} was not paused`);
    }
    const plan = recordFromValue(result.monitor_plan);
    if (!plan) {
      throw new ServiceUnavailableException(
        `Monitor plan for thesis ${id} was not returned by the engine`,
      );
    }
    const response = toThesisMonitorPlanResponse(
      await this.persistMonitorPlanIfNeeded(plan, workspaceId),
    );
    this.clearSchedulerTimer(response.thesis_id, response.workspace_id);
    return this.schedulerStatusFromPlan(response);
  }

  async runSchedulerDue(
    id: string,
    dto: RunThesisSchedulerDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ThesisSchedulerRunResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    await this.assertThesisReadable(id, workspaceId);
    return this.runThesisSchedulerDue(id, workspaceId, dto?.observed_at);
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

  private async ensureMonitorPlanRecord(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const existing = await this.monitorPlanFromStorage(id, workspaceId);
    if (existing) {
      return existing;
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
    return this.persistMonitorPlanIfNeeded(plan, workspaceId);
  }

  private async monitorPlanFromStorage(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const fromJournal = await this.journal.getThesisMonitorPlan?.(id, workspaceId);
    if (fromJournal) {
      return fromJournal;
    }
    if (monitoringProductMode() && !allowSqliteMonitoringFallback()) {
      return null;
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
    if (monitoringProductMode() && !allowSqliteMonitoringFallback()) {
      this.requireProductMonitoringRead('thesis_pulses');
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
    if (monitoringProductMode() && !allowSqliteMonitoringFallback()) {
      this.requireProductMonitoringRead('thesis_pulse_memos');
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

  private async persistMonitorPlanIfNeeded(
    plan: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    if (!monitoringProductMode()) {
      return plan;
    }
    if (!this.journal.saveThesisMonitorPlan) {
      throw new ServiceUnavailableException(
        'Product monitoring mode requires Postgres monitor plan writes.',
      );
    }
    return this.journal.saveThesisMonitorPlan(plan, workspaceId);
  }

  private async persistPulseResultIfNeeded(
    result: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    if (!monitoringProductMode()) {
      return result;
    }
    if (!this.journal.saveThesisPulse) {
      throw new ServiceUnavailableException(
        'Product monitoring mode requires Postgres pulse writes.',
      );
    }
    const pulse = recordFromValue(result.pulse) ?? result;
    const saved = await this.journal.saveThesisPulse(pulse, workspaceId);
    return { ...result, pulse: saved };
  }

  private async persistMemoResultIfNeeded(
    result: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    if (!monitoringProductMode()) {
      return result;
    }
    const memo = recordFromValue(result.memo);
    if (!memo) {
      return result;
    }
    if (!this.journal.saveThesisPulseMemo) {
      throw new ServiceUnavailableException(
        'Product monitoring mode requires Postgres pulse memo writes.',
      );
    }
    const saved = await this.journal.saveThesisPulseMemo(memo, workspaceId);
    return { ...result, memo: saved };
  }

  private requireProductMonitoringRead(tableName: string): never {
    throw new ServiceUnavailableException(
      `Product monitoring mode requires Postgres ${tableName} read support; enable MONITORING_SQLITE_FALLBACK=true only for explicit migration fallback.`,
    );
  }

  private async runThesisSchedulerDue(
    id: string,
    workspaceId: string,
    observedAt?: string,
  ): Promise<ThesisSchedulerRunResponse> {
    const runtime = this.runtimeFor(id, workspaceId);
    const checkedAt = parseObservedAt(observedAt);
    if (monitoringProductMode()) {
      const plan = toThesisMonitorPlanResponse(
        await this.ensureMonitorPlanRecord(id, workspaceId),
      );
      if (!this.monitoringJobs) {
        throw new ServiceUnavailableException(
          'Durable monitoring scheduler is unavailable.',
        );
      }
      const enqueued = await this.monitoringJobs.enqueueDueJobsForPlan(
        plan,
        checkedAt,
      );
      const result = this.schedulerRunResult({
        thesisId: id,
        workspaceId,
        checkedAt,
        skippedReason:
          enqueued.jobs.length > 0 ? null : enqueued.skippedReason ?? 'not_due',
        plan,
        queuedJobIds: enqueued.jobs.map((job) => stringField(job.id) ?? ''),
        queueBackend: monitoringQueueBackend(),
      });
      runtime.lastRunAt = result.checked_at;
      runtime.lastError = null;
      runtime.lastResult = result;
      runtime.nextRunAt = nextSchedulerRunAt(plan, checkedAt).toISOString();
      return result;
    }
    if (runtime.running) {
      const plan = toThesisMonitorPlanResponse(
        await this.ensureMonitorPlanRecord(id, workspaceId),
      );
      return this.schedulerRunResult({
        thesisId: id,
        workspaceId,
        checkedAt,
        skippedReason: 'already_running',
        plan,
      });
    }

    runtime.running = true;
    let result: ThesisSchedulerRunResponse | null = null;
    try {
      let plan = toThesisMonitorPlanResponse(
        await this.ensureMonitorPlanRecord(id, workspaceId),
      );
      if (!plan.scheduler_enabled) {
        result = this.schedulerRunResult({
          thesisId: id,
          workspaceId,
          checkedAt,
          skippedReason: 'scheduler_disabled',
          plan,
        });
        return result;
      }
      if (plan.status !== 'active') {
        result = this.schedulerRunResult({
          thesisId: id,
          workspaceId,
          checkedAt,
          skippedReason: `plan_${plan.status || 'not_active'}`,
          plan,
        });
        return result;
      }
      if (!this.pythonEngine) {
        throw new ServiceUnavailableException('Python engine client is unavailable.');
      }

      const pulseDueAt = dueAt(
        plan.last_pulse_at,
        plan.next_pulse_due_at,
        plan.price_interval_minutes,
        checkedAt,
      );
      const signalDueAt = dueAt(
        plan.last_pulse_at,
        null,
        plan.signal_interval_minutes,
        checkedAt,
      );
      const pulseDueReason =
        pulseDueAt.getTime() <= checkedAt.getTime()
          ? 'price_interval'
          : signalDueAt.getTime() <= checkedAt.getTime()
            ? 'signal_interval'
            : null;

      let pulse = null;
      if (pulseDueReason) {
        const pulseResult = await this.pythonEngine.runPulse({
          thesis_id: id,
          workspace_id: workspaceId,
          force: false,
          observed_at: checkedAt.toISOString(),
          metadata: { source: 'thesis_scheduler', due_reason: pulseDueReason },
        });
        if (pulseResult.error_type) {
          throw engineError(pulseResult, `Scheduled pulse for thesis ${id} failed`);
        }
        pulse = toRunThesisPulseResponse(pulseResult);
      }

      const planAfterPulse = await this.monitorPlanFromStorage(id, workspaceId);
      if (planAfterPulse) {
        plan = toThesisMonitorPlanResponse(planAfterPulse);
      }
      const latestStatus = pulse?.pulse?.status ?? plan.latest_status;
      const severityMemoDue =
        (latestStatus === 'review' && plan.run_memo_on_review) ||
        (latestStatus === 'rerun_full' && plan.run_memo_on_rerun_full);
      const memoDueAt = dueAt(
        plan.last_memo_at,
        plan.next_memo_due_at,
        plan.memo_interval_minutes,
        checkedAt,
      );
      const hasPulseEvidence = Boolean(pulse?.pulse?.id ?? plan.latest_pulse_id);
      let memo = null;
      if (hasPulseEvidence && (severityMemoDue || memoDueAt <= checkedAt)) {
        const memoResult = await this.pythonEngine.runPulseMemo({
          thesis_id: id,
          workspace_id: workspaceId,
          force: false,
          window_minutes: plan.memo_interval_minutes,
          observed_at: checkedAt.toISOString(),
          metadata: { source: 'thesis_scheduler', pulse_memo: { llm_enabled: true } },
        });
        if (memoResult.error_type) {
          throw engineError(memoResult, `Scheduled pulse memo for thesis ${id} failed`);
        }
        memo = toRunThesisPulseMemoResponse(memoResult);
      }

      const finalPlanRecord = await this.monitorPlanFromStorage(id, workspaceId);
      const finalPlan = finalPlanRecord
        ? toThesisMonitorPlanResponse(finalPlanRecord)
        : plan;
      result = this.schedulerRunResult({
        thesisId: id,
        workspaceId,
        checkedAt,
        skippedReason: pulse || memo ? null : 'not_due',
        pulse,
        memo,
        plan: finalPlan,
      });
      return result;
    } catch (error) {
      runtime.lastRunAt = checkedAt.toISOString();
      runtime.lastError = errorMessage(error);
      throw error;
    } finally {
      runtime.running = false;
      if (result) {
        runtime.lastRunAt = result.checked_at;
        runtime.lastError = null;
        runtime.lastResult = result;
        if (result.plan) {
          this.syncSchedulerTimer(result.plan);
        }
      }
    }
  }

  private schedulerRunResult(input: {
    thesisId: string;
    workspaceId: string;
    checkedAt: Date;
    skippedReason: string | null;
    pulse?: ReturnType<typeof toRunThesisPulseResponse> | null;
    memo?: ReturnType<typeof toRunThesisPulseMemoResponse> | null;
    plan: ThesisMonitorPlanResponse | null;
    queuedJobIds?: string[];
    queueBackend?: string | null;
  }): ThesisSchedulerRunResponse {
    const queuedJobIds = (input.queuedJobIds ?? []).filter(Boolean);
    return {
      workspace_id: input.workspaceId,
      thesis_id: input.thesisId,
      checked_at: input.checkedAt.toISOString(),
      skipped_reason: input.skippedReason,
      queued: queuedJobIds.length > 0,
      queued_job_ids: queuedJobIds,
      queue_backend: input.queueBackend ?? null,
      ran_pulse: Boolean(input.pulse),
      ran_memo: Boolean(input.memo),
      pulse: input.pulse ?? null,
      memo: input.memo ?? null,
      plan: input.plan,
    };
  }

  private syncSchedulerTimer(plan: ThesisMonitorPlanResponse): void {
    const runtime = this.runtimeFor(plan.thesis_id, plan.workspace_id);
    if (runtime.timer) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    runtime.nextRunAt = null;
    if (plan.status !== 'active' || !plan.scheduler_enabled) {
      return;
    }
    const nextRunAt = nextSchedulerRunAt(plan, new Date());
    runtime.nextRunAt = nextRunAt.toISOString();
    if (monitoringProductMode()) {
      return;
    }
    if (runtime.running) {
      return;
    }
    const delayMs = clampNumber(
      nextRunAt.getTime() - Date.now(),
      MIN_SCHEDULER_DELAY_MS,
      MAX_SCHEDULER_DELAY_MS,
    );
    runtime.timer = setTimeout(() => {
      runtime.timer = null;
      runtime.nextRunAt = null;
      void this.runThesisSchedulerDue(plan.thesis_id, plan.workspace_id).catch(
        (error) => {
          const failed = this.runtimeFor(plan.thesis_id, plan.workspace_id);
          failed.lastRunAt = new Date().toISOString();
          failed.lastError = errorMessage(error);
          this.logger.warn(
            `Thesis scheduler failed for ${plan.workspace_id}/${plan.thesis_id}: ${errorMessage(error)}`,
          );
          this.syncSchedulerTimer(plan);
        },
      );
    }, delayMs);
    runtime.timer.unref?.();
  }

  private clearSchedulerTimer(thesisId: string, workspaceId: string): void {
    const runtime = this.runtimeFor(thesisId, workspaceId);
    if (runtime.timer) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    runtime.nextRunAt = null;
  }

  private schedulerStatusFromPlan(
    plan: ThesisMonitorPlanResponse,
  ): ThesisSchedulerStatusResponse {
    const runtime = this.runtimeFor(plan.thesis_id, plan.workspace_id);
    const enabled = plan.status === 'active' && plan.scheduler_enabled;
    return {
      workspace_id: plan.workspace_id,
      thesis_id: plan.thesis_id,
      enabled,
      scheduled: Boolean(runtime.timer),
      running: runtime.running,
      product_mode: monitoringProductMode(),
      queue_backend: monitoringProductMode() ? monitoringQueueBackend() : null,
      plan_status: plan.status,
      scheduler_enabled: plan.scheduler_enabled,
      price_interval_minutes: plan.price_interval_minutes,
      signal_interval_minutes: plan.signal_interval_minutes,
      memo_interval_minutes: plan.memo_interval_minutes,
      next_pulse_due_at: dueAt(
        plan.last_pulse_at,
        plan.next_pulse_due_at,
        plan.price_interval_minutes,
        new Date(),
      ).toISOString(),
      next_signal_due_at: dueAt(
        plan.last_pulse_at,
        null,
        plan.signal_interval_minutes,
        new Date(),
      ).toISOString(),
      next_memo_due_at: dueAt(
        plan.last_memo_at,
        plan.next_memo_due_at,
        plan.memo_interval_minutes,
        new Date(),
      ).toISOString(),
      next_run_at: enabled ? runtime.nextRunAt : null,
      last_run_at: runtime.lastRunAt,
      last_error: runtime.lastError,
      last_result: runtime.lastResult,
    };
  }

  private runtimeFor(thesisId: string, workspaceId: string): ThesisSchedulerRuntime {
    const key = `${workspaceId}:${thesisId}`;
    const existing = this.schedulerRuntimes.get(key);
    if (existing) {
      return existing;
    }
    const runtime: ThesisSchedulerRuntime = {
      timer: null,
      running: false,
      nextRunAt: null,
      lastRunAt: null,
      lastError: null,
      lastResult: null,
    };
    this.schedulerRuntimes.set(key, runtime);
    return runtime;
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
    applyJsonColumnAliases(normalized);
  }
  return normalized;
}

function applyJsonColumnAliases(row: JsonRecord): void {
  for (const [key, value] of Object.entries(row)) {
    if (!key.endsWith('_json') || key === 'payload_json') {
      continue;
    }
    row[key.slice(0, -5)] = value;
  }
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

function monitoringProductMode(): boolean {
  const mode = (
    process.env.MONITORING_PERSISTENCE ??
    process.env.MONITORING_MODE ??
    ''
  ).toLowerCase();
  return (
    mode === 'postgres' ||
    mode === 'product' ||
    process.env.MONITORING_PRODUCT_MODE === 'true'
  );
}

function allowSqliteMonitoringFallback(): boolean {
  return process.env.MONITORING_SQLITE_FALLBACK === 'true';
}

function monitoringQueueBackend(): string {
  return 'postgres';
}

function parseObservedAt(value: string | undefined): Date {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function dueAt(
  lastRunAt: string | null | undefined,
  explicitNextRunAt: string | null | undefined,
  intervalMinutes: number,
  now: Date,
): Date {
  const explicit = dateValue(explicitNextRunAt);
  if (explicit) {
    return explicit;
  }
  const last = dateValue(lastRunAt);
  if (!last) {
    return now;
  }
  return addMinutes(last, clampNumber(intervalMinutes, 1, 1440));
}

function nextSchedulerRunAt(
  plan: ThesisMonitorPlanResponse,
  now: Date,
): Date {
  return minDate([
    dueAt(
      plan.last_pulse_at,
      plan.next_pulse_due_at,
      plan.price_interval_minutes,
      now,
    ),
    dueAt(plan.last_pulse_at, null, plan.signal_interval_minutes, now),
    dueAt(plan.last_memo_at, plan.next_memo_due_at, plan.memo_interval_minutes, now),
  ]);
}

function dateValue(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function minDate(values: Date[]): Date {
  return values.reduce((best, candidate) =>
    candidate.getTime() < best.getTime() ? candidate : best,
  );
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function engineError(result: JsonRecord, fallback: string): Error {
  const message = String(result.error ?? fallback);
  const type = String(result.error_type ?? '');
  if (type.includes('ValueError')) {
    return new BadRequestException(message);
  }
  return new ServiceUnavailableException(message);
}
