import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { JournalRepository, JsonRecord } from './journal.types';

type PayloadRow = {
  payload_json: string | JsonRecord;
};

export class PostgresJournalRepository implements JournalRepository {
  private readonly pool?: Pool;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (databaseUrl) {
      this.pool = new Pool({ connectionString: databaseUrl });
    }
  }

  async getResearchRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      'SELECT payload_json FROM research_runs WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
  }

  async listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]> {
    return this.many(
      `SELECT jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'research_run_id', research_run_id,
         'thesis_id', thesis_id,
         'event_type', event_type,
         'created_at', created_at,
         'message', message,
         'payload', payload_json
       ) AS payload_json
       FROM run_events
       WHERE research_run_id = $1 AND workspace_id = $2
       ORDER BY created_at ASC`,
      [runId, workspaceId],
    );
  }

  async listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json FROM trade_theses
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  async getThesis(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return this.one(
      'SELECT payload_json FROM trade_theses WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
  }

  async recordThesisDecision(
    thesisId: string,
    action: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    await this.assertThesisInWorkspace(thesisId, workspaceId);
    const id = `decision_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
      workspace_id: workspaceId,
      thesis_id: thesisId,
      action,
      user_notes: notes,
      decided_at: new Date().toISOString(),
    };
    await this.exec(
      `INSERT INTO user_decisions
       (id, thesis_id, action, decided_at, user_notes, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [id, thesisId, action, payload.decided_at, notes, JSON.stringify(payload)],
    );
    return payload;
  }

  async recordThesisReview(
    thesisId: string,
    result: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    await this.assertThesisInWorkspace(thesisId, workspaceId);
    const id = `outcome_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
      workspace_id: workspaceId,
      thesis_id: thesisId,
      result,
      lessons: notes,
      reviewed_at: new Date().toISOString(),
      invalidated: result === 'invalidated',
    };
    await this.exec(
      `INSERT INTO outcome_reviews
       (id, thesis_id, result, reviewed_at, invalidated, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        id,
        thesisId,
        result,
        payload.reviewed_at,
        payload.invalidated ? 1 : 0,
        JSON.stringify(payload),
      ],
    );
    return payload;
  }

  async listSignals(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    if (symbol) {
      return this.many(
        `SELECT payload_json FROM signals
         WHERE workspace_id = $1 AND symbol = $2
         ORDER BY observed_at DESC
         LIMIT $3`,
        [workspaceId, symbol, limit],
      );
    }
    return this.many(
      `SELECT payload_json FROM signals
       WHERE workspace_id = $1
       ORDER BY observed_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  async listWatchlists(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json FROM watchlists
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  async addWatchlistItem(
    watchlistId: string,
    item: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const watchlist = await this.one(
      'SELECT payload_json FROM watchlists WHERE id = $1 AND workspace_id = $2',
      [watchlistId, workspaceId],
    );
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${watchlistId} not found`);
    }
    const id = `watch_item_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      item_type: item.item_type ?? 'symbol',
      symbol: item.symbol ?? null,
      thesis_id: item.thesis_id ?? null,
      setup_type: item.setup_type ?? null,
      enabled: true,
      created_at: new Date().toISOString(),
    };
    await this.exec(
      `INSERT INTO watchlist_items
       (id, watchlist_id, item_type, symbol, thesis_id, setup_type, enabled, created_at, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        id,
        watchlistId,
        payload.item_type,
        payload.symbol,
        payload.thesis_id,
        payload.setup_type,
        1,
        payload.created_at,
        JSON.stringify(payload),
      ],
    );
    return payload;
  }

  async listDailyBriefs(
    date: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    if (date) {
      return this.many(
        `SELECT payload_json FROM market_briefs
         WHERE workspace_id = $1 AND brief_date = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [workspaceId, date, limit],
      );
    }
    return this.many(
      `SELECT payload_json FROM market_briefs
       WHERE workspace_id = $1
       ORDER BY brief_date DESC, created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  private async one(sql: string, params: unknown[]): Promise<JsonRecord | null> {
    const pool = this.requirePool();
    const result = await pool.query<PayloadRow>(sql, params);
    const row = result.rows[0];
    return row ? parsePayload(row.payload_json) : null;
  }

  private async many(sql: string, params: unknown[]): Promise<JsonRecord[]> {
    const pool = this.requirePool();
    const result = await pool.query<PayloadRow>(sql, params);
    return result.rows.map((row) => parsePayload(row.payload_json));
  }

  private async exec(sql: string, params: unknown[]): Promise<void> {
    const pool = this.requirePool();
    await pool.query(sql, params);
  }

  private async assertThesisInWorkspace(
    thesisId: string,
    workspaceId: string,
  ): Promise<void> {
    const thesis = await this.one(
      'SELECT payload_json FROM trade_theses WHERE id = $1 AND workspace_id = $2',
      [thesisId, workspaceId],
    );
    if (!thesis) {
      throw new NotFoundException(`Thesis ${thesisId} not found`);
    }
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'DATABASE_URL is required for NestJS journal reads and writes.',
      );
    }
    return this.pool;
  }
}

function parsePayload(value: string | JsonRecord): JsonRecord {
  if (typeof value === 'string') {
    return JSON.parse(value) as JsonRecord;
  }
  return value;
}
