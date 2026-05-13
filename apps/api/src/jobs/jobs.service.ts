import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { EngineRunRequest, JsonRecord } from '../database/journal.types';
import { PythonEngineClient } from './python-engine.client';

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
}

type StoredJob = JobStatusResponse & {
  request: EngineRunRequest;
};

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly memoryJobs: EngineRunRequest[] = [];
  private readonly jobStatuses = new Map<string, StoredJob>();
  private readonly connection?: IORedis;
  private readonly queue?: Queue<EngineRunRequest>;

  constructor(private readonly pythonEngine: PythonEngineClient) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      this.queue = new Queue<EngineRunRequest>('research-runs', {
        connection: this.connection,
      });
    }
  }

  async enqueueResearchRun(request: EngineRunRequest): Promise<EnqueuedJob> {
    const now = new Date().toISOString();
    if (process.env.JOBS_EXECUTION_MODE === 'inline') {
      const id = `inline_${randomUUID()}`;
      const status = this.setStatus(id, request, 'inline', {
        status: 'running',
        created_at: now,
        started_at: now,
      });
      try {
        const result = await this.pythonEngine.runInline(request);
        const resultStatus =
          typeof result.status === 'string' ? result.status : 'completed';
        this.setStatus(id, request, 'inline', {
          ...status,
          status: resultStatus,
          completed_at: new Date().toISOString(),
        });
        return {
          id,
          backend: 'inline',
          result,
        };
      } catch (error) {
        this.setStatus(id, request, 'inline', {
          ...status,
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_code: 'engine_failed',
          error_message:
            error instanceof Error ? error.message : 'Inline engine failed.',
        });
        throw error;
      }
    }
    const baseStatus = {
      status: 'queued',
      created_at: now,
      started_at: null,
      completed_at: null,
      error_code: null,
      error_message: null,
      retry_count: 0,
    };
    if (this.queue) {
      const job = await this.queue.add('research.run', request, {
        jobId: request.run_id,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
      this.setStatus(String(job.id), request, 'bullmq', baseStatus);
      return {
        id: String(job.id),
        backend: 'bullmq',
      };
    }
    this.memoryJobs.push(request);
    this.setStatus(request.run_id, request, 'memory', baseStatus);
    return { id: request.run_id, backend: 'memory' };
  }

  listMemoryJobs(): EngineRunRequest[] {
    return [...this.memoryJobs];
  }

  async getJobStatus(id: string): Promise<JobStatusResponse> {
    const stored = this.jobStatuses.get(id);
    if (this.queue) {
      const queueJob = await this.queue.getJob(id);
      if (queueJob) {
        return this.toBullMqStatus(queueJob, stored);
      }
    }
    if (!stored) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return {
      id: stored.id,
      run_id: stored.run_id,
      workspace_id: stored.workspace_id,
      backend: stored.backend,
      status: stored.status,
      created_at: stored.created_at,
      started_at: stored.started_at,
      completed_at: stored.completed_at,
      error_code: stored.error_code,
      error_message: stored.error_message,
      retry_count: stored.retry_count,
    };
  }

  async onModuleDestroy() {
    await this.queue?.close();
    await this.connection?.quit();
  }

  private setStatus(
    id: string,
    request: EngineRunRequest,
    backend: 'bullmq' | 'memory' | 'inline',
    status: Partial<JobStatusResponse>,
  ): StoredJob {
    const previous = this.jobStatuses.get(id);
    const next: StoredJob = {
      id,
      run_id: request.run_id,
      workspace_id: request.workspace_id,
      backend,
      status: status.status ?? previous?.status ?? 'queued',
      created_at:
        status.created_at ?? previous?.created_at ?? new Date().toISOString(),
      started_at: status.started_at ?? previous?.started_at ?? null,
      completed_at: status.completed_at ?? previous?.completed_at ?? null,
      error_code: status.error_code ?? previous?.error_code ?? null,
      error_message: status.error_message ?? previous?.error_message ?? null,
      retry_count: status.retry_count ?? previous?.retry_count ?? 0,
      request,
    };
    this.jobStatuses.set(id, next);
    return next;
  }

  private async toBullMqStatus(
    job: Job<EngineRunRequest>,
    stored: StoredJob | undefined,
  ): Promise<JobStatusResponse> {
    const state = await job.getState();
    return {
      id: String(job.id),
      run_id: job.data.run_id,
      workspace_id: job.data.workspace_id,
      backend: 'bullmq',
      status: mapBullMqState(state),
      created_at:
        stored?.created_at ?? new Date(job.timestamp).toISOString(),
      started_at: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : stored?.started_at ?? null,
      completed_at: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : stored?.completed_at ?? null,
      error_code: job.failedReason ? 'job_failed' : stored?.error_code ?? null,
      error_message: job.failedReason ?? stored?.error_message ?? null,
      retry_count: job.attemptsMade,
    };
  }
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
