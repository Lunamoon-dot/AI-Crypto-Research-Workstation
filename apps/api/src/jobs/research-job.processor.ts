import { Injectable, Optional } from '@nestjs/common';
import { EngineRunRequest, JsonRecord } from '../database/journal.types';
import {
  JobBackend,
  JobLifecycleService,
} from './job-lifecycle.service';
import { PythonEngineClient } from './python-engine.client';
import {
  SqliteJournalSyncResult,
  SqliteJournalSyncService,
} from './sqlite-journal-sync.service';

type PostgresSyncAudit = {
  status: 'completed' | 'skipped' | 'failed';
  synced_tables: string[];
  sqlite_path: string | null;
  error: string | null;
  tables?: Record<string, number>;
};

export interface ResearchJobProcessorContext {
  jobId: string;
  backend: JobBackend;
  attempt: number;
  maxAttempts: number;
  timeoutMs?: number;
}

@Injectable()
export class ResearchJobProcessor {
  constructor(
    private readonly pythonEngine: PythonEngineClient,
    private readonly lifecycle: JobLifecycleService,
    private readonly sqliteSync?: SqliteJournalSyncService,
  ) {}

  async process(
    request: EngineRunRequest,
    context: ResearchJobProcessorContext,
  ): Promise<JsonRecord> {
    const timeoutAt = context.timeoutMs
      ? new Date(Date.now() + context.timeoutMs).toISOString()
      : null;
    const cancellation =
      (await this.lifecycle.get(context.jobId)) ??
      (await this.lifecycle.create({
        id: context.jobId,
        request,
        backend: context.backend,
        queueName: context.backend === 'bullmq' ? 'research-runs' : undefined,
        queueJobId: context.backend === 'bullmq' ? context.jobId : undefined,
        maxAttempts: context.maxAttempts,
        timeoutAt,
      }));
    if (cancellation?.cancellation_requested_at) {
      await this.lifecycle.markCancelled(
        context.jobId,
        'Job was cancelled before execution started.',
      );
      return {
        status: 'cancelled',
        run_id: request.run_id,
        workspace_id: request.workspace_id,
      };
    }

    await this.lifecycle.markRunning(context.jobId, {
      attempts: context.attempt,
      progress: {
        phase: 'engine',
        attempt: context.attempt,
        max_attempts: context.maxAttempts,
      },
      timeoutAt,
    });

    const abort = new AbortController();
    const heartbeat = this.startHeartbeat(context.jobId);
    let abortReason: 'timeout' | 'cancelled' | null = null;
    const timeout = context.timeoutMs
      ? setTimeout(() => {
          abortReason = 'timeout';
          abort.abort();
        }, context.timeoutMs)
      : null;
    timeout?.unref?.();
    const cancellationWatch = this.startCancellationWatch(
      context.jobId,
      abort,
      () => abortReason,
      (reason) => {
        abortReason = reason;
      },
    );

    try {
      const result = await this.runEngineAndSync(request, abort.signal);
      const status = resultStatus(result);
      if (status === 'failed') {
        await this.lifecycle.markFailed(context.jobId, {
          code: stringValue(result.error_type, 'engine_failed'),
          message: stringValue(result.error, 'Research engine failed.'),
          resultSummary: result,
        });
      } else {
        await this.lifecycle.markCompleted(context.jobId, result);
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Research engine failed.';
      if (abort.signal.aborted && abortReason === 'cancelled') {
        await this.lifecycle.markCancelled(
          context.jobId,
          'Research run was cancelled while the engine was executing.',
        );
      } else if (abort.signal.aborted) {
        await this.lifecycle.markTimedOut(context.jobId, {
          message: `Research engine exceeded ${context.timeoutMs}ms timeout.`,
          resultSummary: {
            status: 'timed_out',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
            error: message,
          },
        });
      } else {
        await this.lifecycle.markFailed(context.jobId, {
          code: 'engine_failed',
          message,
          resultSummary: {
            status: 'failed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
            error: message,
          },
        });
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      clearInterval(heartbeat);
      clearInterval(cancellationWatch);
    }
  }

  private startHeartbeat(jobId: string): NodeJS.Timeout {
    const heartbeatMs = resolveHeartbeatMs();
    const heartbeat = setInterval(() => {
      void this.lifecycle.heartbeat(jobId, { phase: 'engine' });
    }, heartbeatMs);
    heartbeat.unref?.();
    return heartbeat;
  }

  private startCancellationWatch(
    jobId: string,
    abort: AbortController,
    currentReason: () => 'timeout' | 'cancelled' | null,
    setReason: (reason: 'cancelled') => void,
  ): NodeJS.Timeout {
    const watch = setInterval(() => {
      void this.lifecycle.get(jobId).then((record) => {
        if (
          record?.cancellation_requested_at &&
          !abort.signal.aborted &&
          currentReason() === null
        ) {
          setReason('cancelled');
          abort.abort();
        }
      });
    }, 1000);
    watch.unref?.();
    return watch;
  }

  private async runEngineAndSync(
    request: EngineRunRequest,
    signal: AbortSignal,
  ): Promise<JsonRecord> {
    const result = await this.pythonEngine.runInline(request, { signal });
    const status = resultStatus(result);
    await this.lifecycle.heartbeat(request.run_id, { phase: 'postgres_sync' });
    try {
      const sync = await this.syncRun(request, result, {
        publishSignals: shouldPublishSignals(status),
      });
      return {
        ...result,
        postgres_sync: postgresSyncAudit(sync, result),
      };
    } catch (error) {
      return {
        ...result,
        warnings: uniqueStrings([...stringList(result.warnings), 'postgres_sync_failed']),
        postgres_sync: {
          status: 'failed',
          synced_tables: [],
          sqlite_path: optionalString(result.journal_path) ?? null,
          error: errorMessage(error),
        },
      };
    }
  }

  private async syncRun(
    request: EngineRunRequest,
    result: JsonRecord,
    options: { publishSignals: boolean },
  ): Promise<SqliteJournalSyncResult | null> {
    return (
      (await this.sqliteSync?.syncRun(request.run_id, request.workspace_id, {
        sqlitePath: optionalString(result.journal_path),
        publishSignals: options.publishSignals,
      })) ??
      null
    );
  }
}

function resolveHeartbeatMs(): number {
  const raw = Number(process.env.JOB_HEARTBEAT_MS ?? 15000);
  if (!Number.isFinite(raw) || raw < 1000) {
    return 15000;
  }
  return Math.trunc(raw);
}

function resultStatus(result: JsonRecord): string {
  return typeof result.status === 'string' ? result.status : 'completed';
}

function shouldPublishSignals(status: string): boolean {
  return ['completed', 'completed_degraded'].includes(status);
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return fallback;
}

function postgresSyncAudit(
  sync: SqliteJournalSyncResult | null,
  result: JsonRecord,
): PostgresSyncAudit {
  if (!sync) {
    return {
      status: 'skipped',
      synced_tables: [],
      sqlite_path: optionalString(result.journal_path) ?? null,
      error: null,
    };
  }
  return {
    status: 'completed',
    synced_tables: sync.synced_tables ?? syncedTablesFromCounts(sync.tables),
    sqlite_path: sync.sqlite_path ?? optionalString(result.journal_path) ?? null,
    error: null,
    tables: sync.tables,
  };
}

function syncedTablesFromCounts(tables: Record<string, number> | undefined): string[] {
  return Object.entries(tables ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([table]) => table);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return undefined;
}
