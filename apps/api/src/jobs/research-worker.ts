import 'reflect-metadata';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { writeFileSync } from 'node:fs';
import { AuthService } from '../auth/auth.service';
import { loadWorkspaceEnv } from '../config/env';
import { EngineRunRequest } from '../database/journal.types';
import { PostgresJournalRepository } from '../database/postgres-journal.repository';
import { PostgresResearchContinuityAuditRepository } from '../research-continuity/research-continuity-audit.repository';
import { PostgresResearchContinuitySettingsRepository } from '../research-continuity/research-continuity-settings.repository';
import { ResearchContinuityService } from '../research-continuity/research-continuity.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { JobLifecycleService } from './job-lifecycle.service';
import { PythonEngineClient } from './python-engine.client';
import { ResearchJobProcessor } from './research-job.processor';
import { SqliteJournalSyncService } from './sqlite-journal-sync.service';

const HEALTH_FILE =
  process.env.WORKER_HEALTH_FILE ?? '/tmp/lunacrypto-worker-health';

async function bootstrap() {
  loadWorkspaceEnv();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required to start the research BullMQ worker.');
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const lifecycle = new JobLifecycleService();
  const sqliteSync = new SqliteJournalSyncService();
  const journal = new PostgresJournalRepository();
  const continuityAudit = new PostgresResearchContinuityAuditRepository();
  const continuitySettings = new PostgresResearchContinuitySettingsRepository();
  const workspaces = new WorkspacesService();
  const continuity = new ResearchContinuityService(
    journal,
    continuityAudit,
    continuitySettings,
    new AuthService(),
    workspaces,
  );
  const processor = new ResearchJobProcessor(
    new PythonEngineClient(),
    lifecycle,
    sqliteSync,
    continuity,
  );
  const heartbeat = setInterval(touchHealthFile, 10_000);
  touchHealthFile();

  const worker = new Worker<EngineRunRequest>(
    'research-runs',
    async (job) => {
      touchHealthFile();
      if (job.name !== 'research.run') {
        throw new Error(`Unsupported research queue job: ${job.name}`);
      }
      await job.updateProgress({ phase: 'engine' });
      const result = await processor.process(job.data, {
        jobId: String(job.id ?? job.data.run_id),
        backend: 'bullmq',
        attempt: job.attemptsMade + 1,
        maxAttempts: Number(job.opts.attempts ?? 1),
        timeoutMs: resolveJobTimeoutMs(),
      });
      await job.updateProgress({ phase: 'completed' });
      touchHealthFile();
      return result;
    },
    {
      connection,
      concurrency: resolveWorkerConcurrency(),
    },
  );

  worker.on('failed', (job, error) => {
    touchHealthFile();
    if (!job) {
      return;
    }
    void lifecycle.markFailed(String(job.id ?? job.data.run_id), {
      code: 'worker_failed',
      message: error.message,
    });
  });
  worker.on('completed', () => {
    touchHealthFile();
  });

  const shutdown = async () => {
    clearInterval(heartbeat);
    await worker.close();
    await connection.quit();
    await sqliteSync.onModuleDestroy();
    await lifecycle.onModuleDestroy();
    await journal.onModuleDestroy();
    await continuityAudit.onModuleDestroy();
    await continuitySettings.onModuleDestroy();
    await workspaces.onModuleDestroy();
  };
  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  console.log(
    `Research BullMQ worker listening on research-runs with concurrency ${resolveWorkerConcurrency()}.`,
  );
}

function resolveWorkerConcurrency(): number {
  const raw = Number(process.env.JOB_WORKER_CONCURRENCY ?? 1);
  if (!Number.isFinite(raw) || raw < 1) {
    return 1;
  }
  return Math.min(Math.trunc(raw), 16);
}

function resolveJobTimeoutMs(): number | undefined {
  const raw = Number(process.env.JOB_TIMEOUT_MS ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return Math.trunc(raw);
}

function touchHealthFile(): void {
  writeFileSync(
    HEALTH_FILE,
    JSON.stringify({
      status: 'ok',
      service: 'worker',
      checked_at: new Date().toISOString(),
    }),
    'utf8',
  );
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
