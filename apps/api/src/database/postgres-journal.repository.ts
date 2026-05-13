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

  async listResearchRuns(
    filters: {
      symbol?: string;
      status?: string;
      limit: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const where = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (filters.symbol) {
      params.push(filters.symbol);
      where.push(`symbol = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    params.push(filters.limit);
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'symbol', symbol,
         'asset_class', asset_class,
         'timeframe', timeframe,
         'status', status,
         'started_at', started_at,
         'completed_at', completed_at,
         'market_snapshot_id', market_snapshot_id,
         'signal_snapshot_id', signal_snapshot_id,
         'debate_id', debate_id,
         'thesis_id', thesis_id,
         'decision_id', decision_id,
         'user_decision_id', user_decision_id,
         'outcome_review_id', outcome_review_id,
         'degradation_reasons', degradation_reasons_json,
         'missing_core_data', missing_core_data_json,
         'missing_optional_data', missing_optional_data_json
       ) AS payload_json
       FROM research_runs
       WHERE ${where.join(' AND ')}
       ORDER BY started_at DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  async getResearchRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'symbol', symbol,
         'asset_class', asset_class,
         'timeframe', timeframe,
         'status', status,
         'started_at', started_at,
         'completed_at', completed_at,
         'market_snapshot_id', market_snapshot_id,
         'signal_snapshot_id', signal_snapshot_id,
         'debate_id', debate_id,
         'thesis_id', thesis_id,
         'decision_id', decision_id,
         'user_decision_id', user_decision_id,
         'outcome_review_id', outcome_review_id,
         'degradation_reasons', degradation_reasons_json,
         'missing_core_data', missing_core_data_json,
         'missing_optional_data', missing_optional_data_json
       ) AS payload_json
       FROM research_runs
       WHERE id = $1 AND workspace_id = $2`,
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

  async getMarketSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'research_run_id', research_run_id,
         'symbol', symbol,
         'captured_at', captured_at,
         'current_price', current_price,
         'source', source,
         'source_timestamp', source_timestamp,
         'payload', payload_json
       ) AS payload_json
       FROM market_snapshots
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async getSignalSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'research_run_id', research_run_id,
         'symbol', symbol,
         'captured_at', captured_at,
         'composite_signal_id', composite_signal_id,
         'signal_count', signal_count,
         'bullish_count', bullish_count,
         'bearish_count', bearish_count,
         'neutral_count', neutral_count,
         'stale_count', stale_count,
         'unknown_freshness_count', unknown_freshness_count,
         'payload', payload_json
       ) AS payload_json
       FROM signal_snapshots
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async getDebate(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return this.one(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'research_run_id', research_run_id,
         'symbol', symbol,
         'consensus_stance', consensus_stance,
         'conflict_level', conflict_level,
         'created_at', created_at,
         'payload', payload_json
       ) AS payload_json
       FROM debates
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async listAgentOpinions(
    debateId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'debate_id', debate_id,
         'research_run_id', research_run_id,
         'agent_name', agent_name,
         'agent_role', agent_role,
         'stance', stance,
         'confidence', confidence,
         'created_at', created_at,
         'payload', payload_json
       ) AS payload_json
       FROM agent_opinions
       WHERE debate_id = $1 AND workspace_id = $2
       ORDER BY created_at ASC, id ASC`,
      [debateId, workspaceId],
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

  async listScenarios(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'thesis_id', thesis_id,
         'probability_band', probability_band,
         'suggested_user_action', suggested_user_action,
         'payload', payload_json
       ) AS payload_json
       FROM scenarios
       WHERE thesis_id = $1 AND workspace_id = $2
       ORDER BY id ASC`,
      [thesisId, workspaceId],
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
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'name', name,
         'enabled', enabled,
         'created_at', created_at
       ) AS payload_json
       FROM watchlists
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  async createWatchlist(
    input: { name: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = `watch_${randomUUID().replaceAll('-', '')}`;
    const createdAt = new Date().toISOString();
    const payload = {
      id,
      workspace_id: workspaceId,
      name: input.name,
      enabled: input.enabled ?? true,
      created_at: createdAt,
    };
    const watchlist = await this.one(
      `INSERT INTO watchlists
       (id, workspace_id, name, enabled, created_at, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'name', name,
         'enabled', enabled,
         'created_at', created_at
       ) AS payload_json`,
      [
        id,
        workspaceId,
        input.name,
        payload.enabled ? 1 : 0,
        createdAt,
        JSON.stringify(payload),
      ],
    );
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    return watchlist;
  }

  async getWatchlist(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'name', name,
         'enabled', enabled,
         'created_at', created_at
       ) AS payload_json
       FROM watchlists
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async listWatchlistItems(
    watchlistId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'watchlist_id', watchlist_id,
         'item_type', item_type,
         'symbol', symbol,
         'thesis_id', thesis_id,
         'setup_type', setup_type,
         'enabled', enabled,
         'created_at', created_at
       ) AS payload_json
       FROM watchlist_items
       WHERE watchlist_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC`,
      [watchlistId, workspaceId],
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
       (id, workspace_id, watchlist_id, item_type, symbol, thesis_id, setup_type, enabled, created_at, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        id,
        workspaceId,
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

  async updateWatchlist(
    id: string,
    input: { name?: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord> {
    const existing = await this.getWatchlist(id, workspaceId);
    if (!existing) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    const name = input.name ?? stringValue(existing.name, '');
    const enabled = input.enabled ?? booleanValue(existing.enabled, true);
    const payload = {
      ...existing,
      id,
      workspace_id: workspaceId,
      name,
      enabled,
    };
    const watchlist = await this.one(
      `UPDATE watchlists
       SET name = $3,
           enabled = $4,
           payload_json = payload_json || $5::jsonb
       WHERE id = $1 AND workspace_id = $2
       RETURNING payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'name', name,
         'enabled', enabled,
         'created_at', created_at
       ) AS payload_json`,
      [id, workspaceId, name, enabled ? 1 : 0, JSON.stringify(payload)],
    );
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    return watchlist;
  }

  async removeWatchlistItem(
    watchlistId: string,
    itemId: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const removed = await this.one(
      `DELETE FROM watchlist_items
       WHERE id = $1 AND watchlist_id = $2 AND workspace_id = $3
       RETURNING jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'watchlist_id', watchlist_id,
         'removed', true
       ) AS payload_json`,
      [itemId, watchlistId, workspaceId],
    );
    if (!removed) {
      throw new NotFoundException(`Watchlist item ${itemId} not found`);
    }
    return removed;
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

  async listAlerts(
    symbol: string | undefined,
    thesisId: string | undefined,
    unreadOnly: boolean,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const filters = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (symbol) {
      params.push(symbol);
      filters.push(`symbol = $${params.length}`);
    }
    if (thesisId) {
      params.push(thesisId);
      filters.push(`thesis_id = $${params.length}`);
    }
    if (unreadOnly) {
      filters.push('read_at IS NULL');
    }
    params.push(limit);
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'alert_type', alert_type,
         'symbol', symbol,
         'thesis_id', thesis_id,
         'watchlist_item_id', watchlist_item_id,
         'trigger_key', trigger_key,
         'created_at', created_at,
         'read_at', read_at,
         'message', message,
         'payload', payload_json
       ) AS payload_json
       FROM alerts
       WHERE ${filters.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  async markAlertRead(id: string, workspaceId: string): Promise<JsonRecord> {
    const readAt = new Date().toISOString();
    const alert = await this.one(
      `UPDATE alerts
       SET read_at = COALESCE(read_at, $3),
           payload_json = payload_json || jsonb_build_object('read_at', COALESCE(read_at, $3))
       WHERE id = $1 AND workspace_id = $2
       RETURNING payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'alert_type', alert_type,
         'symbol', symbol,
         'thesis_id', thesis_id,
         'watchlist_item_id', watchlist_item_id,
         'trigger_key', trigger_key,
         'created_at', created_at,
         'read_at', read_at,
         'message', message,
         'payload', payload_json
       ) AS payload_json`,
      [id, workspaceId, readAt],
    );
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    return alert;
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

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
}
