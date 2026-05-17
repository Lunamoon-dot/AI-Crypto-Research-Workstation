import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
  MonitoringJobType,
} from '../database/journal.types';
import {
  ThesisMonitorPlanResponse,
  toRunThesisPulseMemoResponse,
  toRunThesisPulseResponse,
  toThesisMonitorPlanResponse,
} from '../contracts/frontend-contract';
import {
  EngineMonitorPlanRequest,
  EnginePulseMemoRequest,
  EnginePulseRequest,
  PythonEngineClient,
} from '../jobs/python-engine.client';

export interface EnqueueDueMonitoringJobsResult {
  jobs: JsonRecord[];
  skippedReason: string | null;
}

export interface MonitoringWorkerRunResult {
  claimed: number;
  succeeded: number;
  failed: number;
  worker_id: string;
}

@Injectable()
export class MonitoringJobsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    @Optional()
    private readonly pythonEngine?: PythonEngineClient,
  ) {}

  async enqueueDueJobsForPlan(
    plan: ThesisMonitorPlanResponse,
    observedAt = new Date(),
  ): Promise<EnqueueDueMonitoringJobsResult> {
    this.requireQueue();
    if (!plan.scheduler_enabled) {
      return { jobs: [], skippedReason: 'scheduler_disabled' };
    }
    if (plan.status !== 'active') {
      return { jobs: [], skippedReason: `plan_${plan.status || 'not_active'}` };
    }

    const jobs: JsonRecord[] = [];
    const pulseDueAt = dueAt(
      plan.last_pulse_at,
      plan.next_pulse_due_at,
      plan.price_interval_minutes,
      observedAt,
    );
    const signalDueAt = dueAt(
      plan.last_pulse_at,
      null,
      plan.signal_interval_minutes,
      observedAt,
    );
    const pulseDueReason =
      pulseDueAt.getTime() <= observedAt.getTime()
        ? 'price_interval'
        : signalDueAt.getTime() <= observedAt.getTime()
          ? 'signal_interval'
          : null;
    if (pulseDueReason) {
      const bucketStart = bucketFor(observedAt, plan.price_interval_minutes);
      jobs.push(
        await this.enqueue({
          plan,
          jobType: 'thesis_pulse_run',
          idempotencyKey: [
            'monitoring',
            plan.workspace_id,
            plan.thesis_id,
            'pulse',
            bucketStart.toISOString(),
            pulseDueReason,
          ].join(':'),
          request: {
            thesis_id: plan.thesis_id,
            workspace_id: plan.workspace_id,
            force: false,
            observed_at: observedAt.toISOString(),
            metadata: {
              source: 'durable_thesis_scheduler',
              due_reason: pulseDueReason,
            },
          },
        }),
      );
    }

    const latestStatus = plan.latest_status;
    const severityMemoDue =
      (latestStatus === 'review' && plan.run_memo_on_review) ||
      (latestStatus === 'rerun_full' && plan.run_memo_on_rerun_full);
    const memoDueAt = dueAt(
      plan.last_memo_at,
      plan.next_memo_due_at,
      plan.memo_interval_minutes,
      observedAt,
    );
    const hasPulseEvidence = Boolean(plan.latest_pulse_id);
    if (hasPulseEvidence && (severityMemoDue || memoDueAt <= observedAt)) {
      const windowEnd = bucketFor(observedAt, plan.memo_interval_minutes);
      const windowStart = addMinutes(windowEnd, -plan.memo_interval_minutes);
      jobs.push(
        await this.enqueue({
          plan,
          jobType: 'thesis_pulse_memo_run',
          idempotencyKey: [
            'monitoring',
            plan.workspace_id,
            plan.thesis_id,
            'memo',
            windowStart.toISOString(),
            windowEnd.toISOString(),
          ].join(':'),
          request: {
            thesis_id: plan.thesis_id,
            workspace_id: plan.workspace_id,
            force: false,
            window_minutes: plan.memo_interval_minutes,
            observed_at: observedAt.toISOString(),
            metadata: {
              source: 'durable_thesis_scheduler',
              pulse_memo: { llm_enabled: true },
            },
          },
        }),
      );
    }

    return {
      jobs,
      skippedReason: jobs.length > 0 ? null : 'not_due',
    };
  }

  async runClaimedJobs(
    workspaceId: string,
    options: {
      limit?: number;
      concurrency?: number;
      workerId?: string;
      now?: string;
    } = {},
  ): Promise<MonitoringWorkerRunResult> {
    if (!this.pythonEngine) {
      throw new ServiceUnavailableException('Python engine client is unavailable.');
    }
    if (!this.journal.claimMonitoringJobs) {
      throw new ServiceUnavailableException(
        'Monitoring job claiming requires Postgres repository support.',
      );
    }
    const workerId =
      options.workerId ?? `monitor_worker_${randomUUID().replaceAll('-', '')}`;
    const jobs = await this.journal.claimMonitoringJobs(workspaceId, {
      limit: options.limit ?? 10,
      workerId,
      now: options.now,
    });
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 8));
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;
    const runOne = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          await this.processJob(job, workspaceId);
          succeeded += 1;
        } catch {
          failed += 1;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, () => runOne()),
    );
    return {
      claimed: jobs.length,
      succeeded,
      failed,
      worker_id: workerId,
    };
  }

  async runRetention(
    workspaceId: string,
    options: { dryRun?: boolean; now?: string } = {},
  ): Promise<JsonRecord> {
    if (!this.journal.runMonitoringRetention) {
      throw new ServiceUnavailableException(
        'Monitoring retention requires Postgres repository support.',
      );
    }
    return this.journal.runMonitoringRetention(workspaceId, {
      dryRun: options.dryRun ?? true,
      pulseKeepDays: intFromEnv('MONITORING_RETENTION_PULSE_DAYS', 30),
      pulseKeepLatestPerThesis: intFromEnv(
        'MONITORING_RETENTION_PULSE_KEEP_LATEST',
        10_000,
      ),
      memoKeepDays: intFromEnv('MONITORING_RETENTION_MEMO_DAYS', 180),
      succeededJobKeepDays: intFromEnv(
        'MONITORING_RETENTION_SUCCEEDED_JOB_DAYS',
        30,
      ),
      failedJobKeepDays: intFromEnv('MONITORING_RETENTION_FAILED_JOB_DAYS', 180),
      now: options.now,
    });
  }

  private async enqueue(input: {
    plan: ThesisMonitorPlanResponse;
    jobType: MonitoringJobType;
    idempotencyKey: string;
    request: JsonRecord;
  }): Promise<JsonRecord> {
    this.requireQueue();
    return this.journal.enqueueMonitoringJob!({
      workspaceId: input.plan.workspace_id,
      thesisId: input.plan.thesis_id,
      jobType: input.jobType,
      runAfter: new Date().toISOString(),
      priority: input.jobType === 'thesis_pulse_memo_run' ? 5 : 10,
      maxAttempts: input.jobType === 'thesis_pulse_memo_run' ? 2 : 3,
      idempotencyKey: input.idempotencyKey,
      request: input.request,
    });
  }

  private async processJob(job: JsonRecord, workspaceId: string): Promise<void> {
    const id = stringValue(job.id);
    const jobType = stringValue(job.job_type);
    const request = recordValue(job.request ?? job.request_json);
    try {
      if (jobType === 'monitor_plan_build') {
        const result = await this.pythonEngine!.monitorPlan(
          request as unknown as EngineMonitorPlanRequest,
        );
        if (result.error_type) {
          throw monitoringEngineError(result);
        }
        const plan = recordValue(result.monitor_plan);
        const saved = await this.persistPlan(plan, workspaceId);
        await this.complete(id, workspaceId, { monitor_plan: saved });
        return;
      }
      if (jobType === 'thesis_pulse_run') {
        const result = await this.pythonEngine!.runPulse(
          request as unknown as EnginePulseRequest,
        );
        if (result.error_type) {
          throw monitoringEngineError(result);
        }
        const pulse = recordValue(result.pulse);
        const saved = await this.persistPulse(
          Object.keys(pulse).length > 0 ? pulse : result,
          workspaceId,
        );
        await this.complete(id, workspaceId, {
          ...toRunThesisPulseResponse({ ...result, pulse: saved }),
          pulse: saved,
        });
        return;
      }
      if (jobType === 'thesis_pulse_memo_run') {
        const result = await this.pythonEngine!.runPulseMemo(
          request as unknown as EnginePulseMemoRequest,
        );
        if (result.error_type) {
          throw monitoringEngineError(result);
        }
        const memo = recordValue(result.memo);
        const saved =
          Object.keys(memo).length > 0
            ? await this.persistMemo(memo, workspaceId)
            : null;
        await this.complete(id, workspaceId, {
          ...toRunThesisPulseMemoResponse({ ...result, memo: saved }),
          memo: saved,
        });
        return;
      }
      if (jobType === 'monitoring_retention_run') {
        const dryRun = booleanValue(request.dry_run, true);
        const retention = await this.runRetention(workspaceId, { dryRun });
        await this.complete(id, workspaceId, retention);
        return;
      }
      throw new Error(`Unsupported monitoring job type: ${jobType}`);
    } catch (error) {
      const retryable = retryableMonitoringError(error);
      const runAfter = retryable ? addSecondsIso(new Date(), 60) : null;
      await this.fail(id, workspaceId, {
        error_type: errorType(error),
        error_message: errorMessage(error),
        retryable,
        run_after: runAfter,
      });
      throw error;
    }
  }

  private async persistPlan(
    plan: JsonRecord,
    workspaceId: string,
  ): Promise<ThesisMonitorPlanResponse> {
    if (!this.journal.saveThesisMonitorPlan) {
      throw new ServiceUnavailableException(
        'Product monitoring mode requires Postgres monitor plan writes.',
      );
    }
    return toThesisMonitorPlanResponse(
      await this.journal.saveThesisMonitorPlan(plan, workspaceId),
    );
  }

  private async persistPulse(
    pulse: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    if (!this.journal.saveThesisPulse) {
      throw new ServiceUnavailableException(
        'Product monitoring mode requires Postgres pulse writes.',
      );
    }
    return this.journal.saveThesisPulse(pulse, workspaceId);
  }

  private async persistMemo(
    memo: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    if (!this.journal.saveThesisPulseMemo) {
      throw new ServiceUnavailableException(
        'Product monitoring mode requires Postgres memo writes.',
      );
    }
    return this.journal.saveThesisPulseMemo(memo, workspaceId);
  }

  private async complete(
    id: string,
    workspaceId: string,
    result: JsonRecord,
  ): Promise<void> {
    if (!this.journal.completeMonitoringJob) {
      throw new ServiceUnavailableException(
        'Monitoring job completion requires Postgres repository support.',
      );
    }
    await this.journal.completeMonitoringJob(id, workspaceId, result);
  }

  private async fail(
    id: string,
    workspaceId: string,
    failure: {
      error_type: string;
      error_message: string;
      retryable: boolean;
      run_after: string | null;
    },
  ): Promise<void> {
    if (!this.journal.failMonitoringJob) {
      return;
    }
    await this.journal.failMonitoringJob(id, workspaceId, {
      errorType: failure.error_type,
      errorMessage: failure.error_message,
      retryable: failure.retryable,
      runAfter: failure.run_after,
    });
  }

  private requireQueue(): void {
    if (!this.journal.enqueueMonitoringJob) {
      throw new ServiceUnavailableException(
        'Durable monitoring scheduler requires Postgres monitoring_jobs support.',
      );
    }
  }
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

function bucketFor(value: Date, intervalMinutes: number): Date {
  const intervalMs = clampNumber(intervalMinutes, 1, 1440) * 60_000;
  return new Date(Math.floor(value.getTime() / intervalMs) * intervalMs);
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

function addSecondsIso(value: Date, seconds: number): string {
  return new Date(value.getTime() + seconds * 1000).toISOString();
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function recordValue(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return String(value);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function monitoringEngineError(result: JsonRecord): Error {
  const error = new Error(errorMessage(result.error ?? 'Monitoring engine failed.'));
  error.name = errorType(result.error_type ?? 'engine_error');
  return error;
}

function retryableMonitoringError(error: unknown): boolean {
  const type = errorType(error);
  const message = errorMessage(error).toLowerCase();
  if (type.includes('ValueError') || type.includes('ValidationError')) {
    return false;
  }
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('rate') ||
    message.includes('temporar') ||
    type.includes('Timeout') ||
    type.includes('ServiceUnavailable')
  );
}

function errorType(error: unknown): string {
  if (error instanceof Error) {
    return error.name || 'Error';
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Error';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}
