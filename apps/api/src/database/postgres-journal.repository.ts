import { ServiceUnavailableException } from '@nestjs/common';
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

  async getResearchRun(id: string): Promise<JsonRecord | null> {
    return this.one('SELECT payload_json FROM research_runs WHERE id = $1', [id]);
  }

  async listRunEvents(runId: string): Promise<JsonRecord[]> {
    return this.many(
      `SELECT jsonb_build_object(
         'id', id,
         'research_run_id', research_run_id,
         'thesis_id', thesis_id,
         'event_type', event_type,
         'created_at', created_at,
         'message', message,
         'payload', payload_json
       ) AS payload_json
       FROM run_events
       WHERE research_run_id = $1
       ORDER BY created_at ASC`,
      [runId],
    );
  }

  async listTheses(limit: number): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json FROM trade_theses
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
  }

  async getThesis(id: string): Promise<JsonRecord | null> {
    return this.one('SELECT payload_json FROM trade_theses WHERE id = $1', [id]);
  }

  async recordThesisDecision(
    thesisId: string,
    action: string,
    notes: string,
  ): Promise<JsonRecord> {
    const id = `decision_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
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
  ): Promise<JsonRecord> {
    const id = `outcome_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
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
  ): Promise<JsonRecord[]> {
    if (symbol) {
      return this.many(
        `SELECT payload_json FROM signals
         WHERE symbol = $1
         ORDER BY observed_at DESC
         LIMIT $2`,
        [symbol, limit],
      );
    }
    return this.many(
      `SELECT payload_json FROM signals
       ORDER BY observed_at DESC
       LIMIT $1`,
      [limit],
    );
  }

  async listWatchlists(limit: number): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json FROM watchlists
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
  }

  async addWatchlistItem(
    watchlistId: string,
    item: JsonRecord,
  ): Promise<JsonRecord> {
    const id = `watch_item_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
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
  ): Promise<JsonRecord[]> {
    if (date) {
      return this.many(
        `SELECT payload_json FROM market_briefs
         WHERE brief_date = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [date, limit],
      );
    }
    return this.many(
      `SELECT payload_json FROM market_briefs
       ORDER BY brief_date DESC, created_at DESC
       LIMIT $1`,
      [limit],
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
