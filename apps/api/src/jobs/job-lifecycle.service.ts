import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { EngineRunRequest, JsonRecord } from '../database/journal.types';
import { shouldUseLocalPostgresFallback } from '../database/postgres-availability';

export type JobBackend = 'bullmq' | 'memory' | 'inline';

export type JobLifecycleStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface JobLifecycleRecord {
  id: string;
  run_id: string;
  workspace_id: string;
  backend: JobBackend;
  queue_name: string | null;
  queue_job_id: string | null;
  status: JobLifecycleStatus;
  request: EngineRunRequest;
  attempts: number;
  max_attempts: number;
  progress: JsonRecord;
  heartbeat_at: string | null;
  cancellation_requested_at: string | null;
  timeout_at: string | null;
  result_summary: JsonRecord | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface CreateJobLifecycleInput {
  id: string;
  request: EngineRunRequest;
  backend: JobBackend;
  queueName?: string;
  queueJobId?: string;
  maxAttempts?: number;
  timeoutAt?: string | null;
}

export interface JobLifecycleUpdate {
  status?: JobLifecycleStatus;
  attempts?: number;
  progress?: JsonRecord;
  heartbeatAt?: string | null;
  cancellationRequestedAt?: string | null;
  timeoutAt?: string | null;
  resultSummary?: JsonRecord | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

@Injectable()
export class JobLifecycleService implements OnModuleDestroy {
  private readonly databaseUrl?: string;
  private readonly pool?: Pool;
  private schemaReady?: Promise<void>;
  private postgresUnavailable = false;
  private readonly records = new Map<string, JobLifecycleRecord>();
  private readonly aliases = new Map<string, string>();

  constructor() {
    this.databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
    if (this.databaseUrl) {
      this.pool = new Pool({ connectionString: this.databaseUrl });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async create(input: CreateJobLifecycleInput): Promise<JobLifecycleRecord> {
    const now = new Date().toISOString();
    const record: JobLifecycleRecord = {
      id: input.id,
      run_id: input.request.run_id,
      workspace_id: input.request.workspace_id,
      backend: input.backend,
      queue_name: input.queueName ?? null,
      queue_job_id: input.queueJobId ?? null,
      status: 'queued',
      request: input.request,
      attempts: 0,
      max_attempts: input.maxAttempts ?? 1,
      progress: { phase: 'queued' },
      heartbeat_at: null,
      cancellation_requested_at: null,
      timeout_at: input.timeoutAt ?? null,
      result_summary: null,
      error_code: null,
      error_message: null,
      created_at: now,
      started_at: null,
      completed_at: null,
      updated_at: now,
    };
    this.storeMemory(record);
    if (!this.shouldUsePostgres()) {
      return record;
    }
    try {
      await this.ensureSchema();
      const saved = await this.upsert(record);
      this.storeMemory(saved);
      return saved;
    } catch (error) {
      if (this.disablePostgresForLocalFallback(error)) {
        return record;
      }
      throw error;
    }
  }

  async get(idOrRunId: string): Promise<JobLifecycleRecord | null> {
    const localId = this.aliases.get(idOrRunId) ?? idOrRunId;
    const local = this.records.get(localId);
    if (!this.shouldUsePostgres()) {
      return local ?? null;
    }
    try {
      await this.ensureSchema();
      const result = await this.pool!.query<JobLifecycleRow>(
        `SELECT *
         FROM research_jobs
         WHERE id = $1 OR run_id = $1 OR queue_job_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [idOrRunId],
      );
      const row = result.rows[0];
      if (!row) {
        return local ?? null;
      }
      const record = recordFromRow(row);
      this.storeMemory(record);
      return record;
    } catch (error) {
      if (this.disablePostgresForLocalFallback(error)) {
        return local ?? null;
      }
      throw error;
    }
  }

  async list(
    workspaceId: string,
    limit = 50,
  ): Promise<JobLifecycleRecord[]> {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
    if (!this.shouldUsePostgres()) {
      return this.listMemory(workspaceId, normalizedLimit);
    }
    try {
      await this.ensureSchema();
      const result = await this.pool!.query<JobLifecycleRow>(
        `SELECT *
         FROM research_jobs
         WHERE workspace_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [workspaceId, normalizedLimit],
      );
      const records = result.rows.map(recordFromRow);
      records.forEach((record) => this.storeMemory(record));
      return records;
    } catch (error) {
      if (this.disablePostgresForLocalFallback(error)) {
        return this.listMemory(workspaceId, normalizedLimit);
      }
      throw error;
    }
  }

  private listMemory(
    workspaceId: string,
    normalizedLimit: number,
  ): JobLifecycleRecord[] {
    return [...this.records.values()]
      .filter((record) => record.workspace_id === workspaceId)
      .sort((left, right) =>
        right.created_at.localeCompare(left.created_at),
      )
      .slice(0, normalizedLimit);
  }

  private shouldUsePostgres(): boolean {
    return Boolean(this.pool && !this.postgresUnavailable);
  }

  private disablePostgresForLocalFallback(error: unknown): boolean {
    if (!shouldUseLocalPostgresFallback(this.databaseUrl, error)) {
      return false;
    }
    this.postgresUnavailable = true;
    this.schemaReady = undefined;
    return true;
  }

  async markRunning(
    idOrRunId: string,
    update: { attempts: number; progress?: JsonRecord; timeoutAt?: string | null },
  ): Promise<JobLifecycleRecord | null> {
    return this.update(idOrRunId, {
      status: 'running',
      attempts: update.attempts,
      progress: update.progress ?? { phase: 'engine' },
      heartbeatAt: new Date().toISOString(),
      timeoutAt: update.timeoutAt,
      startedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
    });
  }

  async heartbeat(
    idOrRunId: string,
    progress?: JsonRecord,
  ): Promise<JobLifecycleRecord | null> {
    return this.update(idOrRunId, {
      heartbeatAt: new Date().toISOString(),
      progress,
    });
  }

  async markCompleted(
    idOrRunId: string,
    resultSummary: JsonRecord,
  ): Promise<JobLifecycleRecord | null> {
    return this.update(idOrRunId, {
      status: 'completed',
      progress: { phase: 'completed' },
      heartbeatAt: new Date().toISOString(),
      resultSummary,
      errorCode: null,
      errorMessage: null,
      completedAt: new Date().toISOString(),
    });
  }

  async markFailed(
    idOrRunId: string,
    failure: { code: string; message: string; resultSummary?: JsonRecord | null },
  ): Promise<JobLifecycleRecord | null> {
    return this.update(idOrRunId, {
      status: 'failed',
      progress: { phase: 'failed' },
      heartbeatAt: new Date().toISOString(),
      resultSummary: failure.resultSummary ?? null,
      errorCode: failure.code,
      errorMessage: failure.message,
      completedAt: new Date().toISOString(),
    });
  }

  async markTimedOut(
    idOrRunId: string,
    failure: { message: string; resultSummary?: JsonRecord | null },
  ): Promise<JobLifecycleRecord | null> {
    return this.update(idOrRunId, {
      status: 'timed_out',
      progress: { phase: 'timed_out' },
      heartbeatAt: new Date().toISOString(),
      resultSummary: failure.resultSummary ?? null,
      errorCode: 'job_timed_out',
      errorMessage: failure.message,
      completedAt: new Date().toISOString(),
    });
  }

  async requestCancellation(
    idOrRunId: string,
  ): Promise<JobLifecycleRecord | null> {
    const existing = await this.get(idOrRunId);
    if (!existing) {
      return null;
    }
    return this.update(idOrRunId, {
      status: existing.status === 'queued' ? 'cancelled' : existing.status,
      cancellationRequestedAt: new Date().toISOString(),
      progress:
        existing.status === 'queued'
          ? { phase: 'cancelled' }
          : { ...existing.progress, cancellation_requested: true },
      completedAt:
        existing.status === 'queued' ? new Date().toISOString() : undefined,
    });
  }

  async markCancelled(
    idOrRunId: string,
    message = 'Job was cancelled.',
  ): Promise<JobLifecycleRecord | null> {
    return this.update(idOrRunId, {
      status: 'cancelled',
      progress: { phase: 'cancelled' },
      heartbeatAt: new Date().toISOString(),
      cancellationRequestedAt: new Date().toISOString(),
      errorCode: 'job_cancelled',
      errorMessage: message,
      completedAt: new Date().toISOString(),
    });
  }

  private async update(
    idOrRunId: string,
    update: JobLifecycleUpdate,
  ): Promise<JobLifecycleRecord | null> {
    const current = await this.get(idOrRunId);
    if (!current) {
      return null;
    }
    const now = new Date().toISOString();
    const next: JobLifecycleRecord = {
      ...current,
      status: update.status ?? current.status,
      attempts: update.attempts ?? current.attempts,
      progress: update.progress ?? current.progress,
      heartbeat_at:
        update.heartbeatAt === undefined
          ? current.heartbeat_at
          : update.heartbeatAt,
      cancellation_requested_at:
        update.cancellationRequestedAt === undefined
          ? current.cancellation_requested_at
          : update.cancellationRequestedAt,
      timeout_at:
        update.timeoutAt === undefined ? current.timeout_at : update.timeoutAt,
      result_summary:
        update.resultSummary === undefined
          ? current.result_summary
          : update.resultSummary,
      error_code:
        update.errorCode === undefined ? current.error_code : update.errorCode,
      error_message:
        update.errorMessage === undefined
          ? current.error_message
          : update.errorMessage,
      started_at:
        update.startedAt === undefined
          ? current.started_at
          : current.started_at ?? update.startedAt,
      completed_at:
        update.completedAt === undefined
          ? current.completed_at
          : update.completedAt,
      updated_at: now,
    };
    this.storeMemory(next);
    if (!this.shouldUsePostgres()) {
      return next;
    }
    try {
      await this.ensureSchema();
      const saved = await this.upsert(next);
      this.storeMemory(saved);
      return saved;
    } catch (error) {
      if (this.disablePostgresForLocalFallback(error)) {
        return next;
      }
      throw error;
    }
  }

  private storeMemory(record: JobLifecycleRecord): void {
    this.records.set(record.id, record);
    this.aliases.set(record.run_id, record.id);
    if (record.queue_job_id) {
      this.aliases.set(record.queue_job_id, record.id);
    }
  }

  private async upsert(record: JobLifecycleRecord): Promise<JobLifecycleRecord> {
    const result = await this.pool!.query<JobLifecycleRow>(
      `INSERT INTO research_jobs (
         id,
         run_id,
         workspace_id,
         queue_backend,
         queue_name,
         queue_job_id,
         status,
         request_json,
         attempts,
         max_attempts,
         progress_json,
         heartbeat_at,
         cancellation_requested_at,
         timeout_at,
         result_summary_json,
         error_code,
         error_message,
         created_at,
         started_at,
         completed_at,
         updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12,
         $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21
       )
       ON CONFLICT (id) DO UPDATE SET
         run_id = EXCLUDED.run_id,
         workspace_id = EXCLUDED.workspace_id,
         queue_backend = EXCLUDED.queue_backend,
         queue_name = EXCLUDED.queue_name,
         queue_job_id = EXCLUDED.queue_job_id,
         status = EXCLUDED.status,
         request_json = EXCLUDED.request_json,
         attempts = EXCLUDED.attempts,
         max_attempts = EXCLUDED.max_attempts,
         progress_json = EXCLUDED.progress_json,
         heartbeat_at = EXCLUDED.heartbeat_at,
         cancellation_requested_at = EXCLUDED.cancellation_requested_at,
         timeout_at = EXCLUDED.timeout_at,
         result_summary_json = EXCLUDED.result_summary_json,
         error_code = EXCLUDED.error_code,
         error_message = EXCLUDED.error_message,
         started_at = COALESCE(research_jobs.started_at, EXCLUDED.started_at),
         completed_at = EXCLUDED.completed_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        record.id,
        record.run_id,
        record.workspace_id,
        record.backend,
        record.queue_name,
        record.queue_job_id,
        record.status,
        JSON.stringify(record.request),
        record.attempts,
        record.max_attempts,
        JSON.stringify(record.progress),
        record.heartbeat_at,
        record.cancellation_requested_at,
        record.timeout_at,
        JSON.stringify(record.result_summary ?? {}),
        record.error_code,
        record.error_message,
        record.created_at,
        record.started_at,
        record.completed_at,
        record.updated_at,
      ],
    );
    return recordFromRow(result.rows[0]!);
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool!.query(RESEARCH_JOBS_SCHEMA_SQL).then(
      () => undefined,
    );
    await this.schemaReady;
  }
}

interface JobLifecycleRow {
  id: string;
  run_id: string;
  workspace_id: string;
  queue_backend: JobBackend;
  queue_name: string | null;
  queue_job_id: string | null;
  status: JobLifecycleStatus;
  request_json: JsonRecord | string;
  attempts: number;
  max_attempts: number;
  progress_json: JsonRecord | string;
  heartbeat_at: Date | string | null;
  cancellation_requested_at: Date | string | null;
  timeout_at: Date | string | null;
  result_summary_json: JsonRecord | string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
}

function recordFromRow(row: JobLifecycleRow): JobLifecycleRecord {
  const resultSummary = parseJson(row.result_summary_json);
  return {
    id: row.id,
    run_id: row.run_id,
    workspace_id: row.workspace_id,
    backend: row.queue_backend,
    queue_name: row.queue_name,
    queue_job_id: row.queue_job_id,
    status: row.status,
    request: parseJson(row.request_json) as unknown as EngineRunRequest,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    progress: parseJson(row.progress_json),
    heartbeat_at: isoOrNull(row.heartbeat_at),
    cancellation_requested_at: isoOrNull(row.cancellation_requested_at),
    timeout_at: isoOrNull(row.timeout_at),
    result_summary:
      resultSummary && Object.keys(resultSummary).length > 0
        ? resultSummary
        : null,
    error_code: row.error_code,
    error_message: row.error_message,
    created_at: iso(row.created_at),
    started_at: isoOrNull(row.started_at),
    completed_at: isoOrNull(row.completed_at),
    updated_at: iso(row.updated_at),
  };
}

function parseJson(value: JsonRecord | string | null): JsonRecord {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as JsonRecord;
  }
  return value;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

const RESEARCH_JOBS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  queue_backend TEXT NOT NULL,
  queue_name TEXT,
  queue_job_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out')
  ),
  request_json JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  heartbeat_at TIMESTAMPTZ,
  cancellation_requested_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  result_summary_json JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_jobs_run_created
ON research_jobs(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_jobs_workspace_status
ON research_jobs(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_jobs_heartbeat
ON research_jobs(status, heartbeat_at);
`;
