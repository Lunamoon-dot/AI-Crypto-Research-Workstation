import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { EngineRunRequest, JsonRecord } from '../database/journal.types';
import { PythonEngineClient } from './python-engine.client';

export interface EnqueuedJob {
  id: string;
  backend: 'bullmq' | 'memory' | 'inline';
  result?: JsonRecord;
}

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly memoryJobs: EngineRunRequest[] = [];
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
    if (process.env.JOBS_EXECUTION_MODE === 'inline') {
      return {
        id: `inline_${randomUUID()}`,
        backend: 'inline',
        result: await this.pythonEngine.runInline(request),
      };
    }
    if (this.queue) {
      const job = await this.queue.add('research.run', request, {
        jobId: request.run_id,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
      return { id: String(job.id), backend: 'bullmq' };
    }
    this.memoryJobs.push(request);
    return { id: request.run_id, backend: 'memory' };
  }

  listMemoryJobs(): EngineRunRequest[] {
    return [...this.memoryJobs];
  }

  async onModuleDestroy() {
    await this.queue?.close();
    await this.connection?.quit();
  }
}
