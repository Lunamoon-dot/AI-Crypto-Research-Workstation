import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { JsonRecord } from '../database/journal.types';
import type {
  ResearchContinuityMarkScheduledRepairRunInput,
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
    'updated_by_user_id', ${prefix}updated_by_user_id,
    'updated_at', ${prefix}updated_at
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
