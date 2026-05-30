import {
  ConflictException,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { JsonRecord } from '../database/journal.types';
import type {
  ResearchContinuityMarkScheduledRepairRunInput,
  ResearchContinuitySchedulerClaimOptions,
  ResearchContinuitySchedulerFailureInput,
  ResearchContinuitySchedulerLeaseClearInput,
  ResearchContinuitySchedulerSuccessInput,
  ResearchContinuitySettingsRepository,
  ResearchContinuityWorkspaceSettingsUpsertInput,
} from './research-continuity-settings.types';

export const RESEARCH_CONTINUITY_SETTINGS_REPOSITORY = Symbol(
  'RESEARCH_CONTINUITY_SETTINGS_REPOSITORY',
);

type PayloadRow = {
  payload_json: string | JsonRecord;
};

@Injectable()
export class PostgresResearchContinuitySettingsRepository
  implements ResearchContinuitySettingsRepository, OnModuleDestroy
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

  async getWorkspaceSettings(workspaceId: string): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${settingsPayloadSql()} AS payload_json
       FROM research_continuity_workspace_settings
       WHERE workspace_id = $1`,
      [workspaceId],
    );
  }

  async upsertWorkspaceSettings(
    input: ResearchContinuityWorkspaceSettingsUpsertInput,
  ): Promise<JsonRecord> {
    const updatedAt = input.updated_at ?? new Date().toISOString();
    const saved = await this.one(
      `INSERT INTO research_continuity_workspace_settings (
         workspace_id,
         scheduled_repair_mode,
         scheduled_repair_case_types_json,
         scheduled_repair_interval_hours,
         scheduled_repair_lookback_days,
         scheduled_repair_limit,
         next_scheduled_repair_due_at,
         updated_by_user_id,
         updated_at
       )
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::timestamptz, $8, $9::timestamptz)
       ON CONFLICT (workspace_id)
       DO UPDATE SET
         scheduled_repair_mode = EXCLUDED.scheduled_repair_mode,
         scheduled_repair_case_types_json = EXCLUDED.scheduled_repair_case_types_json,
         scheduled_repair_interval_hours = EXCLUDED.scheduled_repair_interval_hours,
         scheduled_repair_lookback_days = EXCLUDED.scheduled_repair_lookback_days,
         scheduled_repair_limit = EXCLUDED.scheduled_repair_limit,
         next_scheduled_repair_due_at = EXCLUDED.next_scheduled_repair_due_at,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = EXCLUDED.updated_at
       RETURNING ${settingsPayloadSql()} AS payload_json`,
      [
        input.workspace_id,
        input.scheduled_repair_mode,
        JSON.stringify(input.scheduled_repair_case_types),
        input.scheduled_repair_interval_hours,
        input.scheduled_repair_lookback_days,
        input.scheduled_repair_limit,
        input.next_scheduled_repair_due_at ?? null,
        input.updated_by_user_id,
        updatedAt,
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException(
        'Research continuity settings were not persisted.',
      );
    }
    return saved;
  }

  async markScheduledRepairRun(
    input: ResearchContinuityMarkScheduledRepairRunInput,
  ): Promise<JsonRecord> {
    const saved = await this.one(
      `UPDATE research_continuity_workspace_settings
       SET last_scheduled_repair_at = $2::timestamptz,
           last_scheduled_repair_run_id = $3,
           next_scheduled_repair_due_at = $4::timestamptz
       WHERE workspace_id = $1
       RETURNING ${settingsPayloadSql()} AS payload_json`,
      [
        input.workspace_id,
        input.last_scheduled_repair_at ?? new Date().toISOString(),
        input.last_scheduled_repair_run_id,
        input.next_scheduled_repair_due_at,
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException(
        'Research continuity settings were not updated.',
      );
    }
    return saved;
  }

  async claimDueWorkspaceSettings(
    options: ResearchContinuitySchedulerClaimOptions,
  ): Promise<JsonRecord[]> {
    const result = await this.requirePool().query<PayloadRow>(
      `WITH due AS (
         SELECT workspace_id
         FROM research_continuity_workspace_settings
         WHERE scheduled_repair_mode IN ('dry_run', 'enabled')
           AND COALESCE(next_scheduled_repair_due_at, $2::timestamptz) <= $2::timestamptz
           AND COALESCE(next_scheduler_retry_at, $2::timestamptz) <= $2::timestamptz
           AND (
             scheduler_lease_expires_at IS NULL
             OR scheduler_lease_expires_at <= $2::timestamptz
           )
         ORDER BY next_scheduled_repair_due_at ASC NULLS FIRST, updated_at ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE research_continuity_workspace_settings settings
       SET scheduler_lease_owner = $1,
           scheduler_lease_expires_at = $2::timestamptz + make_interval(secs => $4),
           last_scheduler_attempt_at = $2::timestamptz,
           updated_at = $2::timestamptz
       FROM due
       WHERE settings.workspace_id = due.workspace_id
       RETURNING ${settingsPayloadSql('settings')} AS payload_json`,
      [
        options.worker_id,
        options.now,
        options.limit,
        options.lease_seconds,
      ],
    );
    return result.rows.map((row) => parsePayload(row.payload_json));
  }

  async markSchedulerSuccess(
    input: ResearchContinuitySchedulerSuccessInput,
  ): Promise<JsonRecord> {
    const saved = await this.one(
      `UPDATE research_continuity_workspace_settings
       SET scheduler_lease_owner = NULL,
           scheduler_lease_expires_at = NULL,
           last_scheduler_success_at = $3::timestamptz,
           last_scheduler_error = NULL,
           consecutive_scheduler_failures = 0,
           next_scheduler_retry_at = NULL,
           last_scheduled_repair_at = $3::timestamptz,
           last_scheduled_repair_run_id = $4,
           next_scheduled_repair_due_at = $5::timestamptz,
           updated_at = $3::timestamptz
       WHERE workspace_id = $1
         AND scheduler_lease_owner = $2
       RETURNING ${settingsPayloadSql()} AS payload_json`,
      [
        input.workspace_id,
        input.worker_id,
        input.completed_at,
        input.last_scheduled_repair_run_id,
        input.next_scheduled_repair_due_at,
      ],
    );
    return requireLeaseGuardedUpdate(saved);
  }

  async markSchedulerFailure(
    input: ResearchContinuitySchedulerFailureInput,
  ): Promise<JsonRecord> {
    const saved = await this.one(
      `UPDATE research_continuity_workspace_settings
       SET scheduler_lease_owner = NULL,
           scheduler_lease_expires_at = NULL,
           last_scheduler_attempt_at = $3::timestamptz,
           last_scheduler_error = $4,
           consecutive_scheduler_failures = $5,
           next_scheduler_retry_at = $6::timestamptz,
           updated_at = $3::timestamptz
       WHERE workspace_id = $1
         AND scheduler_lease_owner = $2
       RETURNING ${settingsPayloadSql()} AS payload_json`,
      [
        input.workspace_id,
        input.worker_id,
        input.failed_at,
        input.error_message,
        input.consecutive_scheduler_failures,
        input.next_scheduler_retry_at,
      ],
    );
    return requireLeaseGuardedUpdate(saved);
  }

  async clearSchedulerLease(
    input: ResearchContinuitySchedulerLeaseClearInput,
  ): Promise<JsonRecord> {
    const saved = await this.one(
      `UPDATE research_continuity_workspace_settings
       SET scheduler_lease_owner = NULL,
           scheduler_lease_expires_at = NULL
       WHERE workspace_id = $1
         AND scheduler_lease_owner = $2
       RETURNING ${settingsPayloadSql()} AS payload_json`,
      [input.workspace_id, input.worker_id],
    );
    return requireLeaseGuardedUpdate(saved);
  }

  private async one(sql: string, params: unknown[]): Promise<JsonRecord | null> {
    const result = await this.requirePool().query<PayloadRow>(sql, params);
    const row = result.rows[0];
    return row ? parsePayload(row.payload_json) : null;
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Research continuity settings repository requires DATABASE_URL.',
      );
    }
    return this.pool;
  }
}

function settingsPayloadSql(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return `jsonb_build_object(
    'workspace_id', ${prefix}workspace_id,
    'scheduled_repair_mode', ${prefix}scheduled_repair_mode,
    'scheduled_repair_case_types', ${prefix}scheduled_repair_case_types_json,
    'scheduled_repair_interval_hours', ${prefix}scheduled_repair_interval_hours,
    'scheduled_repair_lookback_days', ${prefix}scheduled_repair_lookback_days,
    'scheduled_repair_limit', ${prefix}scheduled_repair_limit,
    'next_scheduled_repair_due_at', ${prefix}next_scheduled_repair_due_at,
    'last_scheduled_repair_at', ${prefix}last_scheduled_repair_at,
    'last_scheduled_repair_run_id', ${prefix}last_scheduled_repair_run_id,
    'scheduler_lease_owner', ${prefix}scheduler_lease_owner,
    'scheduler_lease_expires_at', ${prefix}scheduler_lease_expires_at,
    'last_scheduler_attempt_at', ${prefix}last_scheduler_attempt_at,
    'last_scheduler_success_at', ${prefix}last_scheduler_success_at,
    'last_scheduler_error', ${prefix}last_scheduler_error,
    'consecutive_scheduler_failures', ${prefix}consecutive_scheduler_failures,
    'next_scheduler_retry_at', ${prefix}next_scheduler_retry_at,
    'updated_by_user_id', ${prefix}updated_by_user_id,
    'updated_at', ${prefix}updated_at
  )`;
}

function requireLeaseGuardedUpdate(saved: JsonRecord | null): JsonRecord {
  if (!saved) {
    throw new ConflictException(
      'Research continuity scheduler lease is no longer owned by this worker.',
    );
  }
  return saved;
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
