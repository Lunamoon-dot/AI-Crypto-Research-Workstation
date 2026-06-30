import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { EngineRunRequest, JsonRecord } from '../database/journal.types';
import { ResearchContinuityService } from '../research-continuity/research-continuity.service';
import {
  JobLifecycleRecord,
  JobLifecycleService,
} from './job-lifecycle.service';
import { PythonEngineClient } from './python-engine.client';
import { ResearchJobProcessor } from './research-job.processor';
import { SqliteJournalSyncService } from './sqlite-journal-sync.service';

export interface EnqueuedJob {
  id: string;
  backend: 'bullmq' | 'memory' | 'inline';
  result?: JsonRecord;
}

export interface JobStatusResponse {
  id: string;
  run_id: string;
  workspace_id: string;
  backend: 'bullmq' | 'memory' | 'inline';
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  attempts: number;
  max_attempts: number;
  progress: JsonRecord;
  heartbeat_at: string | null;
  cancellation_requested_at: string | null;
  timeout_at: string | null;
  result_summary?: JsonRecord;
  result?: JsonRecord;
}

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly memoryJobs: EngineRunRequest[] = [];
  private readonly connection?: IORedis;
  private readonly queue?: Queue<EngineRunRequest>;
  private readonly processor: ResearchJobProcessor;
  private readonly lifecycle: JobLifecycleService;
  private readonly ownsLifecycle: boolean;
  private memoryProcessing = false;
  private destroyed = false;

  constructor(
    private readonly pythonEngine: PythonEngineClient,
    @Optional()
    private readonly sqliteSync?: SqliteJournalSyncService,
    @Optional()
    lifecycle?: JobLifecycleService,
    @Optional()
    private readonly continuity?: ResearchContinuityService,
  ) {
    this.lifecycle = lifecycle ?? new JobLifecycleService();
    this.ownsLifecycle = !lifecycle;
    this.processor = new ResearchJobProcessor(
      this.pythonEngine,
      this.lifecycle,
      this.sqliteSync,
      this.continuity,
    );
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && resolveExecutionMode() === 'bullmq') {
      this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      this.queue = new Queue<EngineRunRequest>('research-runs', {
        connection: this.connection,
      });
    }
  }

  async enqueueResearchRun(request: EngineRunRequest): Promise<EnqueuedJob> {
    const executionMode = resolveExecutionMode();
    const timeoutMs = resolveJobTimeoutMs();
    if (executionMode === 'inline') {
      const id = `inline_${randomUUID()}`;
      await this.lifecycle.create({
        id,
        request,
        backend: 'inline',
        maxAttempts: 1,
      });
      try {
        const syncedResult = await this.processor.process(request, {
          jobId: id,
          backend: 'inline',
          attempt: 1,
          maxAttempts: 1,
          timeoutMs,
        });
        return {
          id,
          backend: 'inline',
          result: syncedResult,
        };
      } catch (error) {
        throw error;
      }
    }
    if (executionMode === 'bullmq' && !this.queue) {
      throw new ServiceUnavailableException(
        'REDIS_URL is required when JOBS_EXECUTION_MODE=bullmq.',
      );
    }
    if (executionMode === 'bullmq' && this.queue) {
      const attempts = resolveJobAttempts();
      await this.lifecycle.create({
        id: request.run_id,
        request,
        backend: 'bullmq',
        queueName: 'research-runs',
        queueJobId: request.run_id,
        maxAttempts: attempts,
      });
      try {
        const job = await this.queue.add('research.run', request, {
          jobId: request.run_id,
          attempts,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
        if (String(job.id) !== request.run_id) {
          await this.lifecycle.create({
            id: request.run_id,
            request,
            backend: 'bullmq',
            queueName: 'research-runs',
            queueJobId: String(job.id),
            maxAttempts: attempts,
          });
        }
      } catch (error) {
        await this.lifecycle.markFailed(request.run_id, {
          code: 'enqueue_failed',
          message:
            error instanceof Error ? error.message : 'Failed to enqueue job.',
        });
        throw error;
      }
      return {
        id: request.run_id,
        backend: 'bullmq',
      };
    }
    await this.lifecycle.create({
      id: request.run_id,
      request,
      backend: 'memory',
      maxAttempts: 1,
    });
    this.memoryJobs.push(request);
    this.scheduleMemoryProcessing();
    return { id: request.run_id, backend: 'memory' };
  }

  async findExistingResearchRunJob(
    runId: string,
  ): Promise<EnqueuedJob | null> {
    const record = await this.lifecycle.get(runId);
    if (!record) {
      return null;
    }
    return {
      id: record.id,
      backend: record.backend,
      result: record.result_summary ?? undefined,
    };
  }

  listMemoryJobs(): EngineRunRequest[] {
    return [...this.memoryJobs];
  }

  async getJobStatus(id: string): Promise<JobStatusResponse> {
    const lifecycleRecord = await this.lifecycle.get(id);
    if (lifecycleRecord) {
      const reconciled = await this.reconcileLifecycleStatus(lifecycleRecord);
      return this.toLifecycleStatus(reconciled);
    }
    if (this.queue) {
      const queueJob = await this.queue.getJob(id);
      if (queueJob) {
        return this.toBullMqStatus(queueJob);
      }
    }
    throw new NotFoundException(`Job ${id} not found`);
  }

  async getJobRequest(id: string): Promise<EngineRunRequest | null> {
    const lifecycleRecord = await this.lifecycle.get(id);
    if (lifecycleRecord) {
      return lifecycleRecord.request;
    }
    const queueJob = await this.queue?.getJob(id);
    return queueJob?.data ?? null;
  }

  async listJobStatuses(
    workspaceId: string,
    limit = 50,
  ): Promise<JobStatusResponse[]> {
    const records = await this.lifecycle.list(workspaceId, limit);
    const reconciled = await Promise.all(
      records.map((record) => this.reconcileLifecycleStatus(record)),
    );
    return reconciled
      .map((record) => this.toLifecycleStatus(record))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async cancelJob(id: string): Promise<JobStatusResponse> {
    const record = await this.lifecycle.get(id);
    if (!record) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    if (record.status === 'queued') {
      this.removeMemoryJob(record.run_id);
      const queueJob = await this.queue?.getJob(record.queue_job_id ?? record.id);
      try {
        await queueJob?.remove();
        const cancelled = await this.lifecycle.markCancelled(record.id);
        return this.toLifecycleStatus(cancelled ?? record);
      } catch {
        const requested = await this.lifecycle.requestCancellation(record.id);
        return this.toLifecycleStatus(requested ?? record);
      }
    }
    const cancelled = await this.lifecycle.requestCancellation(record.id);
    return this.toLifecycleStatus(cancelled ?? record);
  }

  async removeResearchRunJobs(runIds: string[]): Promise<void> {
    for (const runId of runIds) {
      const record = await this.lifecycle.get(runId);
      if (!record) {
        continue;
      }
      this.removeMemoryJob(record.run_id);
      const queueJob = await this.queue?.getJob(record.queue_job_id ?? record.id);
      try {
        await queueJob?.remove();
      } catch {
        await this.lifecycle.requestCancellation(record.id);
      }
      await this.lifecycle.remove(record.id);
    }
  }

  async onModuleDestroy() {
    this.destroyed = true;
    this.memoryJobs.length = 0;
    await this.queue?.close();
    await this.connection?.quit();
    if (this.ownsLifecycle) {
      await this.lifecycle.onModuleDestroy();
    }
  }

  private scheduleMemoryProcessing(): void {
    if (this.destroyed || this.memoryProcessing) {
      return;
    }
    setTimeout(() => {
      void this.processMemoryJobs();
    }, 0);
  }

  private async processMemoryJobs(): Promise<void> {
    if (this.destroyed || this.memoryProcessing) {
      return;
    }
    this.memoryProcessing = true;
    try {
      while (!this.destroyed) {
        const request = this.memoryJobs.shift();
        if (!request) {
          return;
        }
        try {
          await this.processor.process(request, {
            jobId: request.run_id,
            backend: 'memory',
            attempt: 1,
            maxAttempts: 1,
            timeoutMs: resolveJobTimeoutMs(),
          });
        } catch {
          // The processor has already persisted failure details.
        }
      }
    } finally {
      this.memoryProcessing = false;
      if (!this.destroyed && this.memoryJobs.length > 0) {
        this.scheduleMemoryProcessing();
      }
    }
  }

  private removeMemoryJob(runId: string): void {
    const index = this.memoryJobs.findIndex((job) => job.run_id === runId);
    if (index !== -1) {
      this.memoryJobs.splice(index, 1);
    }
  }

  private async reconcileLifecycleStatus(
    record: JobLifecycleRecord,
  ): Promise<JobLifecycleRecord> {
    if (record.status !== 'running') {
      return record;
    }

    const staleHeartbeat = isHeartbeatStale(record.heartbeat_at);
    const orphanedMemoryJob =
      record.backend === 'memory' &&
      !this.memoryProcessing &&
      !this.memoryJobs.some((job) => job.run_id === record.run_id);

    if (!staleHeartbeat && !orphanedMemoryJob) {
      return record;
    }

    const message = orphanedMemoryJob
      ? 'Memory research job stopped before completion; the API process is no longer running the engine for this run.'
      : 'Research job heartbeat expired before completion.';
    const timedOut = await this.lifecycle.markTimedOut(record.id, {
      message,
      resultSummary: {
        status: 'timed_out',
        run_id: record.run_id,
        workspace_id: record.workspace_id,
        error: message,
      },
    });
    return timedOut ?? record;
  }

  private toLifecycleStatus(record: JobLifecycleRecord): JobStatusResponse {
    return {
      id: record.id,
      run_id: record.run_id,
      workspace_id: record.workspace_id,
      backend: record.backend,
      status: record.status,
      created_at: record.created_at,
      started_at: record.started_at,
      completed_at: record.completed_at,
      error_code: record.error_code,
      error_message: record.error_message,
      retry_count: Math.max(record.attempts - 1, 0),
      attempts: record.attempts,
      max_attempts: record.max_attempts,
      progress: record.progress,
      heartbeat_at: record.heartbeat_at,
      cancellation_requested_at: record.cancellation_requested_at,
      timeout_at: record.timeout_at,
      result_summary: record.result_summary ?? undefined,
      result: record.result_summary ?? undefined,
    };
  }

  private async toBullMqStatus(
    job: Job<EngineRunRequest>,
  ): Promise<JobStatusResponse> {
    const state = await job.getState();
    const status = mapBullMqState(state);
    return {
      id: String(job.id),
      run_id: job.data.run_id,
      workspace_id: job.data.workspace_id,
      backend: 'bullmq',
      status,
      created_at: new Date(job.timestamp).toISOString(),
      started_at: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      completed_at: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
      error_code: job.failedReason ? 'job_failed' : null,
      error_message: job.failedReason ?? null,
      retry_count: job.attemptsMade,
      attempts: job.attemptsMade,
      max_attempts: Number(job.opts.attempts ?? 1),
      progress: progressRecord(job.progress),
      heartbeat_at: null,
      cancellation_requested_at: null,
      timeout_at: null,
      result_summary: resultRecord(job.returnvalue),
      result: resultRecord(job.returnvalue),
    };
  }
}

function resolveExecutionMode(): 'inline' | 'bullmq' | 'memory' {
  const raw = (process.env.JOBS_EXECUTION_MODE ?? 'memory')
    .trim()
    .toLowerCase();
  if (['bullmq', 'queue', 'redis'].includes(raw)) {
    return 'bullmq';
  }
  if (['memory', 'in-memory', 'noop'].includes(raw)) {
    return 'memory';
  }
  return 'inline';
}

function mapBullMqState(state: string): string {
  if (state === 'completed') {
    return 'completed';
  }
  if (state === 'failed') {
    return 'failed';
  }
  if (state === 'active') {
    return 'running';
  }
  if (state === 'delayed' || state === 'waiting' || state === 'waiting-children') {
    return 'queued';
  }
  return state;
}

function progressRecord(progress: Job['progress']): JsonRecord {
  if (progress && typeof progress === 'object') {
    return progress as JsonRecord;
  }
  if (typeof progress === 'number') {
    return { value: progress };
  }
  return {};
}

function resultRecord(value: unknown): JsonRecord | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

function isHeartbeatStale(heartbeatAt: string | null): boolean {
  const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  if (!Number.isFinite(heartbeatMs)) {
    return true;
  }
  return Date.now() - heartbeatMs > resolveJobStaleHeartbeatMs();
}

function resolveJobStaleHeartbeatMs(): number {
  const raw = Number(process.env.JOB_STALE_HEARTBEAT_MS ?? 120_000);
  if (!Number.isFinite(raw) || raw < 30_000) {
    return 120_000;
  }
  return Math.trunc(raw);
}

function resolveJobAttempts(): number {
  const raw = Number(process.env.JOB_MAX_ATTEMPTS ?? 3);
  if (!Number.isFinite(raw) || raw < 1) {
    return 3;
  }
  return Math.min(Math.trunc(raw), 10);
}

function resolveJobTimeoutMs(): number | undefined {
  const raw = Number(process.env.JOB_TIMEOUT_MS ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return Math.trunc(raw);
}
