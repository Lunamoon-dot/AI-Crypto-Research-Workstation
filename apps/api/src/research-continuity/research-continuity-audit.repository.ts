import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { JsonRecord } from '../database/journal.types';
import {
  ResearchContinuityAuditRepository,
  ResearchContinuityDebugAccessAuditFilters,
  ResearchContinuityDebugAccessAuditInput,
  ResearchContinuityOperationsHealthOptions,
  ResearchContinuityRepairRunCreateInput,
  ResearchContinuityRepairRunFilters,
  ResearchContinuityRepairRunFinalizeInput,
} from './research-continuity-audit.types';

export const RESEARCH_CONTINUITY_AUDIT_REPOSITORY = Symbol(
  'RESEARCH_CONTINUITY_AUDIT_REPOSITORY',
);

type PayloadRow = {
  payload_json: string | JsonRecord;
};

@Injectable()
export class PostgresResearchContinuityAuditRepository
  implements ResearchContinuityAuditRepository, OnModuleDestroy
{
  private readonly pool?: Pool;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (databaseUrl?.trim()) {
      this.pool = new Pool({ connectionString: databaseUrl });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async recordDebugAccessAudit(
    input: ResearchContinuityDebugAccessAuditInput,
  ): Promise<JsonRecord> {
    const id = input.id ?? `debug_audit_${randomUUID().replaceAll('-', '')}`;
    const requestedAt = input.requested_at ?? new Date().toISOString();
    const saved = await this.one(
      `INSERT INTO research_continuity_debug_access_audits (
         id, workspace_id, entry_id, research_run_id, symbol,
         requested_by_user_id, decision, reason, requested_at, metadata_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::jsonb)
       RETURNING ${debugAuditPayloadSql()} AS payload_json`,
      [
        id,
        input.workspace_id ?? null,
        input.entry_id,
        input.research_run_id ?? null,
        input.symbol ?? null,
        input.requested_by_user_id ?? null,
        input.decision,
        input.reason,
        requestedAt,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException('Debug access audit was not persisted.');
    }
    return saved;
  }

  async listDebugAccessAudits(
    filters: ResearchContinuityDebugAccessAuditFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const where = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (filters.entry_id) {
      params.push(filters.entry_id);
      where.push(`entry_id = $${params.length}`);
    }
    if (filters.decision) {
      params.push(filters.decision);
      where.push(`decision = $${params.length}`);
    }
    if (filters.reason) {
      params.push(filters.reason);
      where.push(`reason = $${params.length}`);
    }
    if (filters.requested_by_user_id) {
      params.push(filters.requested_by_user_id);
      where.push(`requested_by_user_id = $${params.length}`);
    }
    params.push(filters.limit);
    return this.many(
      `SELECT ${debugAuditPayloadSql()} AS payload_json
       FROM research_continuity_debug_access_audits
       WHERE ${where.join(' AND ')}
       ORDER BY requested_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  async createRepairRun(
    input: ResearchContinuityRepairRunCreateInput,
  ): Promise<JsonRecord> {
    const id = input.id ?? `repair_run_${randomUUID().replaceAll('-', '')}`;
    const requestedAt = input.requested_at ?? new Date().toISOString();
    const saved = await this.one(
      `INSERT INTO research_continuity_repair_runs (
         id, workspace_id, requested_by_user_id, requested_at, dry_run, status,
         idempotency_key, filters_json
       )
       VALUES ($1, $2, $3, $4::timestamptz, $5, 'started', $6, $7::jsonb)
       ON CONFLICT (workspace_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING ${repairRunPayloadSql()} || jsonb_build_object('_existing', false) AS payload_json`,
      [
        id,
        input.workspace_id,
        input.requested_by_user_id,
        requestedAt,
        input.dry_run,
        input.idempotency_key ?? null,
        JSON.stringify(input.filters),
      ],
    );
    if (saved) {
      return saved;
    }
    if (input.idempotency_key) {
      const existing = await this.selectRepairRunByIdempotencyKey(
        input.workspace_id,
        input.idempotency_key,
      );
      if (existing) {
        return existing;
      }
    }
    throw new ServiceUnavailableException('Repair run audit was not persisted.');
  }

  async finalizeRepairRun(
    id: string,
    workspaceId: string,
    result: ResearchContinuityRepairRunFinalizeInput,
  ): Promise<JsonRecord> {
    const saved = await this.one(
      `UPDATE research_continuity_repair_runs
       SET completed_at = $3::timestamptz,
           status = $4,
           requested_count = $5,
           repaired_count = $6,
           skipped_count = $7,
           failed_count = $8,
           created_entry_ids_json = $9::jsonb,
           results_json = $10::jsonb,
           error_message = $11
       WHERE id = $1 AND workspace_id = $2
       RETURNING ${repairRunPayloadSql()} AS payload_json`,
      [
        id,
        workspaceId,
        result.completed_at ?? new Date().toISOString(),
        result.status,
        result.requested_count,
        result.repaired_count,
        result.skipped_count,
        result.failed_count,
        JSON.stringify(result.created_entry_ids),
        JSON.stringify(result.results),
        result.error_message ?? null,
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException('Repair run audit was not finalized.');
    }
    return saved;
  }

  async getRepairRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${repairRunPayloadSql()} AS payload_json
       FROM research_continuity_repair_runs
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async listRepairRuns(
    filters: ResearchContinuityRepairRunFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const where = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (filters.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    if (filters.dry_run !== undefined) {
      params.push(filters.dry_run);
      where.push(`dry_run = $${params.length}`);
    }
    params.push(filters.limit);
    return this.many(
      `SELECT ${repairRunPayloadSql()} - 'results' AS payload_json
       FROM research_continuity_repair_runs
       WHERE ${where.join(' AND ')}
       ORDER BY requested_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  async getContinuityOperationsHealth(
    workspaceId: string,
    options: ResearchContinuityOperationsHealthOptions,
  ): Promise<JsonRecord> {
    const lookbackDays = Math.max(Math.trunc(options.lookbackDays), 1);
    const pool = this.requirePool();
    const result = await pool.query(
      `WITH recent_entries AS (
         SELECT status, entry_type
         FROM research_continuity_entries
         WHERE workspace_id = $1
           AND generated_at >= now() - ($2::text || ' days')::interval
       ),
       recent_completed_runs AS (
         SELECT id
         FROM research_runs
         WHERE workspace_id = $1
           AND status IN ('completed', 'completed_degraded')
           AND COALESCE(completed_at, started_at) >= now() - ($2::text || ' days')::interval
       ),
       missing_runs AS (
         SELECT COUNT(*)::int AS missing_entries_recent
         FROM recent_completed_runs run
         LEFT JOIN research_continuity_entries entry
           ON entry.workspace_id = $1
          AND entry.research_run_id = run.id
         WHERE entry.id IS NULL
       ),
       stale_state AS (
         SELECT COUNT(*)::int AS stale_symbols
         FROM research_continuity_states
         WHERE workspace_id = $1
           AND updated_at < now() - ($2::text || ' days')::interval
       ),
       last_repair AS (
         SELECT completed_at, requested_at, status
         FROM research_continuity_repair_runs
         WHERE workspace_id = $1
         ORDER BY requested_at DESC, id DESC
         LIMIT 1
       ),
       repair_failures AS (
         SELECT COUNT(*)::int AS count
         FROM research_continuity_repair_runs
         WHERE workspace_id = $1
           AND requested_at >= now() - interval '24 hours'
           AND (status IN ('failed', 'completed_with_failures') OR failed_count > 0)
       ),
       debug_counts AS (
         SELECT
           COUNT(*) FILTER (WHERE decision = 'allowed')::int AS allowed,
           COUNT(*) FILTER (WHERE decision = 'denied')::int AS denied
         FROM research_continuity_debug_access_audits
         WHERE workspace_id = $1
           AND requested_at >= now() - interval '24 hours'
       )
       SELECT jsonb_build_object(
         'workspace_id', $1,
         'lookback_days', $2::int,
         'audit_available', true,
         'missing_entries_recent',
           COALESCE((SELECT missing_entries_recent FROM missing_runs), 0),
         'degraded_entries_recent',
           COALESCE((SELECT COUNT(*) FROM recent_entries WHERE status = 'degraded' OR entry_type = 'degraded'), 0),
         'stale_symbols', COALESCE((SELECT stale_symbols FROM stale_state), 0),
         'last_repair_run_at',
           (SELECT COALESCE(completed_at, requested_at) FROM last_repair),
         'last_repair_status', (SELECT status FROM last_repair),
         'repair_failures_24h', COALESCE((SELECT count FROM repair_failures), 0),
         'debug_access_24h', COALESCE((SELECT allowed FROM debug_counts), 0),
         'debug_denied_24h', COALESCE((SELECT denied FROM debug_counts), 0)
       ) AS payload_json`,
      [workspaceId, lookbackDays],
    );
    return parsePayload(result.rows[0]?.payload_json ?? {});
  }

  private async selectRepairRunByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${repairRunPayloadSql()} || jsonb_build_object('_existing', true) AS payload_json
       FROM research_continuity_repair_runs
       WHERE workspace_id = $1
         AND idempotency_key = $2
       LIMIT 1`,
      [workspaceId, idempotencyKey],
    );
  }

  private async one(sql: string, params: unknown[]): Promise<JsonRecord | null> {
    const result = await this.requirePool().query<PayloadRow>(sql, params);
    const row = result.rows[0];
    return row ? parsePayload(row.payload_json) : null;
  }

  private async many(sql: string, params: unknown[]): Promise<JsonRecord[]> {
    const result = await this.requirePool().query<PayloadRow>(sql, params);
    return result.rows.map((row) => parsePayload(row.payload_json));
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Research continuity audit repository requires DATABASE_URL.',
      );
    }
    return this.pool;
  }
}

function debugAuditPayloadSql(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return `jsonb_build_object(
    'id', ${prefix}id,
    'workspace_id', ${prefix}workspace_id,
    'entry_id', ${prefix}entry_id,
    'research_run_id', ${prefix}research_run_id,
    'symbol', ${prefix}symbol,
    'requested_by_user_id', ${prefix}requested_by_user_id,
    'decision', ${prefix}decision,
    'reason', ${prefix}reason,
    'requested_at', ${prefix}requested_at,
    'metadata', ${prefix}metadata_json
  )`;
}

function repairRunPayloadSql(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return `jsonb_build_object(
    'id', ${prefix}id,
    'workspace_id', ${prefix}workspace_id,
    'requested_by_user_id', ${prefix}requested_by_user_id,
    'requested_at', ${prefix}requested_at,
    'completed_at', ${prefix}completed_at,
    'dry_run', ${prefix}dry_run,
    'status', ${prefix}status,
    'idempotency_key', ${prefix}idempotency_key,
    'filters', ${prefix}filters_json,
    'requested_count', ${prefix}requested_count,
    'repaired_count', ${prefix}repaired_count,
    'skipped_count', ${prefix}skipped_count,
    'failed_count', ${prefix}failed_count,
    'created_entry_ids', ${prefix}created_entry_ids_json,
    'results', ${prefix}results_json,
    'error_message', ${prefix}error_message
  )`;
}

function parsePayload(value: unknown): JsonRecord {
  if (typeof value === 'string') {
    return JSON.parse(value) as JsonRecord;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeDates(value as JsonRecord);
  }
  return {};
}

function normalizeDates(record: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}
