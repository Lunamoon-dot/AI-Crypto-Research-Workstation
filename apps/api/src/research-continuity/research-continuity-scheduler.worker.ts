import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { AuthService } from '../auth/auth.service';
import { loadWorkspaceEnv } from '../config/env';
import { JsonRecord } from '../database/journal.types';
import { PostgresJournalRepository } from '../database/postgres-journal.repository';
import { PostgresResearchContinuityAuditRepository } from './research-continuity-audit.repository';
import { PostgresResearchContinuitySettingsRepository } from './research-continuity-settings.repository';
import { ResearchContinuityService } from './research-continuity.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const DEFAULT_ACTOR = 'system:research-continuity-scheduler';
const DEFAULT_HEALTH_FILE = '/tmp/lunacrypto-continuity-scheduler-health';

interface SchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  actor: string;
  healthFile: string;
}

async function bootstrap() {
  loadWorkspaceEnv();
  const config = resolveSchedulerConfig();
  const workerId = `continuity-scheduler:${hostname()}:${process.pid}:${randomUUID()}`;

  touchHealthFile(config, workerId, { status: config.enabled ? 'starting' : 'disabled' });
  if (!config.enabled) {
    console.log('Research continuity scheduler worker is disabled.');
    return;
  }

  const journal = new PostgresJournalRepository();
  const audit = new PostgresResearchContinuityAuditRepository();
  const settings = new PostgresResearchContinuitySettingsRepository();
  const workspaces = new WorkspacesService();
  const continuity = new ResearchContinuityService(
    journal,
    audit,
    settings,
    new AuthService(),
    workspaces,
  );
  let tickInProgress = false;
  let shuttingDown = false;

  const runTick = async () => {
    if (tickInProgress || shuttingDown) {
      return;
    }
    tickInProgress = true;
    const tickStartedAt = new Date();
    try {
      const claimed = await settings.claimDueWorkspaceSettings({
        worker_id: workerId,
        now: tickStartedAt.toISOString(),
        limit: config.batchSize,
        lease_seconds: config.leaseSeconds,
      });
      let processed = 0;
      for (const row of claimed) {
        await processClaim({
          row,
          config,
          workerId,
          continuity,
          settings,
        });
        processed += 1;
      }
      touchHealthFile(config, workerId, {
        status: 'ok',
        claimed: claimed.length,
        processed,
        last_tick_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error(error);
      touchHealthFile(config, workerId, {
        status: 'error',
        error: sanitizeSchedulerError(error),
        last_tick_at: new Date().toISOString(),
      });
    } finally {
      tickInProgress = false;
    }
  };

  touchHealthFile(config, workerId, { status: 'ok' });
  await runTick();
  const interval = setInterval(() => {
    void runTick();
  }, config.intervalMs);

  const shutdown = async () => {
    shuttingDown = true;
    clearInterval(interval);
    await journal.onModuleDestroy();
    await audit.onModuleDestroy();
    await settings.onModuleDestroy();
    await workspaces.onModuleDestroy();
    touchHealthFile(config, workerId, { status: 'stopped' });
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  console.log(
    `Research continuity scheduler worker ${workerId} polling every ${config.intervalMs}ms.`,
  );
}

async function processClaim(input: {
  row: JsonRecord;
  config: SchedulerConfig;
  workerId: string;
  continuity: ResearchContinuityService;
  settings: PostgresResearchContinuitySettingsRepository;
}): Promise<void> {
  const workspaceId = String(input.row.workspace_id ?? '');
  if (!workspaceId) {
    return;
  }
  const now = new Date();
  try {
    const result = await input.continuity.runDueScheduledRepairForWorkspace(
      workspaceId,
      input.config.actor,
      { now, source: 'worker' },
    );
    if (result.skipped_reason === null) {
      const status = result.repair_run?.status;
      if (status === 'completed' || status === 'completed_with_failures') {
        await input.settings.markSchedulerSuccess({
          workspace_id: workspaceId,
          worker_id: input.workerId,
          completed_at: now.toISOString(),
          last_scheduled_repair_run_id: String(result.audit_run_id),
          next_scheduled_repair_due_at: String(result.next_scheduled_repair_due_at),
        });
        return;
      }
      throw new Error(`Scheduled repair run ${result.audit_run_id} is ${status ?? 'unavailable'}`);
    }
    if (
      result.skipped_reason === 'scheduler_disabled' ||
      result.skipped_reason === 'not_due' ||
      result.skipped_reason === 'no_case_types'
    ) {
      await input.settings.clearSchedulerLease({
        workspace_id: workspaceId,
        worker_id: input.workerId,
        cleared_at: now.toISOString(),
      });
      return;
    }
    if (result.skipped_reason === 'worker_lease_active') {
      return;
    }
    throw new Error(`Scheduled repair skipped: ${result.skipped_reason}`);
  } catch (error) {
    await markFailure(input.settings, input.row, input.workerId, workspaceId, error);
  }
}

async function markFailure(
  settings: PostgresResearchContinuitySettingsRepository,
  row: JsonRecord,
  workerId: string,
  workspaceId: string,
  error: unknown,
): Promise<void> {
  const failedAt = new Date();
  const consecutiveFailures = numberValue(row.consecutive_scheduler_failures) + 1;
  const retryAt = new Date(
    failedAt.getTime() + schedulerBackoffMs(consecutiveFailures),
  ).toISOString();
  await settings.markSchedulerFailure({
    workspace_id: workspaceId,
    worker_id: workerId,
    failed_at: failedAt.toISOString(),
    error_message: sanitizeSchedulerError(error),
    next_scheduler_retry_at: retryAt,
    consecutive_scheduler_failures: consecutiveFailures,
  });
}

function schedulerBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 1) return 5 * 60 * 1000;
  if (consecutiveFailures === 2) return 15 * 60 * 1000;
  if (consecutiveFailures === 3) return 60 * 60 * 1000;
  return 6 * 60 * 60 * 1000;
}

function resolveSchedulerConfig(): SchedulerConfig {
  return {
    enabled: process.env.RESEARCH_CONTINUITY_SCHEDULER_ENABLED === 'true',
    intervalMs: readPositiveInteger(
      process.env.RESEARCH_CONTINUITY_SCHEDULER_INTERVAL_MS,
      60_000,
    ),
    batchSize: readPositiveInteger(
      process.env.RESEARCH_CONTINUITY_SCHEDULER_BATCH_SIZE,
      1,
    ),
    leaseSeconds: readPositiveInteger(
      process.env.RESEARCH_CONTINUITY_SCHEDULER_LEASE_SECONDS,
      300,
    ),
    actor:
      process.env.RESEARCH_CONTINUITY_SCHEDULER_ACTOR?.trim() || DEFAULT_ACTOR,
    healthFile:
      process.env.RESEARCH_CONTINUITY_SCHEDULER_HEALTH_FILE?.trim() ||
      DEFAULT_HEALTH_FILE,
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function touchHealthFile(
  config: SchedulerConfig,
  workerId: string,
  extra: JsonRecord = {},
): void {
  mkdirSync(dirname(config.healthFile), { recursive: true });
  writeFileSync(
    config.healthFile,
    JSON.stringify({
      service: 'continuity-scheduler',
      worker_id: workerId,
      enabled: config.enabled,
      checked_at: new Date().toISOString(),
      ...extra,
    }),
    'utf8',
  );
}

function sanitizeSchedulerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
