import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  JournalRepository,
  JsonRecord,
  ResearchRunFailure,
  SignalSummary,
  ThesisDecisionIntent,
  ThesisReviewMetrics,
} from './journal.types';

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

  async markResearchRunFailed(
    id: string,
    workspaceId: string,
    failure: ResearchRunFailure,
  ): Promise<JsonRecord | null> {
    const pool = this.requirePool();
    const client = await pool.connect();
    const completedAt = failure.completedAt ?? new Date().toISOString();
    const reason = stringValue(failure.reason, 'run_failed');
    const message = stringValue(failure.message, 'Research run failed.');
    const eventId = `event_${randomUUID().replaceAll('-', '')}`;
    const eventPayload = {
      event: 'research_run_failed',
      failure_reason: reason,
      message,
      run_id: id,
      workspace_id: workspaceId,
      source: 'api',
      timeline_event_type: 'run.failed',
      timeline_schema: 'v1',
    };

    try {
      await client.query('BEGIN');
      const result = await client.query<PayloadRow>(
        `UPDATE research_runs
         SET status = 'failed',
             completed_at = COALESCE(completed_at, $3::timestamptz),
             degradation_reasons_json =
               CASE
                 WHEN COALESCE(degradation_reasons_json, '[]'::jsonb) ? $4
                   THEN COALESCE(degradation_reasons_json, '[]'::jsonb)
                 ELSE COALESCE(degradation_reasons_json, '[]'::jsonb) || jsonb_build_array($4::text)
               END,
             missing_core_data_json =
               CASE
                 WHEN COALESCE(missing_core_data_json, '[]'::jsonb) ? $4
                   THEN COALESCE(missing_core_data_json, '[]'::jsonb)
                 ELSE COALESCE(missing_core_data_json, '[]'::jsonb) || jsonb_build_array($4::text)
               END,
             payload_json = COALESCE(payload_json, '{}'::jsonb) || jsonb_build_object(
               'status', 'failed',
               'completed_at', $3::timestamptz,
               'degradation_reasons',
                 CASE
                   WHEN COALESCE(degradation_reasons_json, '[]'::jsonb) ? $4
                     THEN COALESCE(degradation_reasons_json, '[]'::jsonb)
                   ELSE COALESCE(degradation_reasons_json, '[]'::jsonb) || jsonb_build_array($4::text)
                 END,
               'missing_core_data',
                 CASE
                   WHEN COALESCE(missing_core_data_json, '[]'::jsonb) ? $4
                     THEN COALESCE(missing_core_data_json, '[]'::jsonb)
                   ELSE COALESCE(missing_core_data_json, '[]'::jsonb) || jsonb_build_array($4::text)
                 END
             )
         WHERE id = $1
           AND workspace_id = $2
           AND status IN ('created', 'queued', 'running')
         RETURNING payload_json || jsonb_build_object(
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
         ) AS payload_json`,
        [id, workspaceId, completedAt, reason],
      );

      const updated = result.rows[0]
        ? parsePayload(result.rows[0].payload_json)
        : null;
      if (updated) {
        await client.query(
          `INSERT INTO run_events
           (id, workspace_id, research_run_id, thesis_id, event_type, created_at, message, payload_json)
           VALUES ($1, $2, $3, NULL, 'run.failed', $4::timestamptz, $5, $6::jsonb)`,
          [
            eventId,
            workspaceId,
            id,
            completedAt,
            message,
            JSON.stringify(eventPayload),
          ],
        );
      }

      await client.query('COMMIT');
      return updated ?? this.getResearchRun(id, workspaceId);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
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

  async getLatestMarketSnapshot(
    symbol: string,
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
       WHERE workspace_id = $1 AND symbol = $2
       ORDER BY captured_at DESC
       LIMIT 1`,
      [workspaceId, symbol],
    );
  }

  async saveMarketSnapshot(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = stringValue(snapshot.id, `market_${randomUUID().replaceAll('-', '')}`);
    const symbol = stringValue(snapshot.symbol, '');
    const capturedAt = stringValue(snapshot.captured_at, new Date().toISOString());
    const source = stringValue(snapshot.source, 'api_price_feed');
    const sourceTimestamp = nullableString(snapshot.source_timestamp) ?? capturedAt;
    const payload = {
      ...snapshot,
      id,
      workspace_id: workspaceId,
      research_run_id: nullableString(snapshot.research_run_id),
      symbol,
      captured_at: capturedAt,
      current_price: numberValue(snapshot.current_price),
      source,
      source_timestamp: sourceTimestamp,
    };
    const saved = await this.one(
      `INSERT INTO market_snapshots
       (id, workspace_id, research_run_id, symbol, captured_at, current_price, source, source_timestamp, payload_json)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::timestamptz, $9::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         research_run_id = EXCLUDED.research_run_id,
         symbol = EXCLUDED.symbol,
         captured_at = EXCLUDED.captured_at,
         current_price = EXCLUDED.current_price,
         source = EXCLUDED.source,
         source_timestamp = EXCLUDED.source_timestamp,
         payload_json = EXCLUDED.payload_json
       RETURNING payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'research_run_id', research_run_id,
         'symbol', symbol,
         'captured_at', captured_at,
         'current_price', current_price,
         'source', source,
         'source_timestamp', source_timestamp,
         'payload', payload_json
       ) AS payload_json`,
      [
        id,
        workspaceId,
        payload.research_run_id,
        symbol,
        capturedAt,
        payload.current_price,
        source,
        sourceTimestamp,
        JSON.stringify(payload),
      ],
    );
    if (!saved) {
      throw new NotFoundException(`Market snapshot ${id} not found`);
    }
    return saved;
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
    intent: ThesisDecisionIntent = {},
  ): Promise<JsonRecord> {
    await this.assertThesisInWorkspace(thesisId, workspaceId);
    const id = `decision_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
      workspace_id: workspaceId,
      thesis_id: thesisId,
      action,
      user_notes: notes,
      entry: stringValue(intent.entry, ''),
      stop_loss: stringValue(intent.stop_loss, ''),
      take_profit: stringValue(intent.take_profit, ''),
      position_intent: stringValue(intent.position_intent, ''),
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
    metrics: ThesisReviewMetrics = {},
  ): Promise<JsonRecord> {
    await this.assertThesisInWorkspace(thesisId, workspaceId);
    const id = `outcome_${randomUUID().replaceAll('-', '')}`;
    const payload = {
      id,
      workspace_id: workspaceId,
      thesis_id: thesisId,
      result,
      lessons: notes,
      max_favorable_excursion: numberValue(metrics.max_favorable_excursion),
      max_adverse_excursion: numberValue(metrics.max_adverse_excursion),
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

  async listOutcomeReviews(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const filters = ['t.workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (symbol) {
      params.push(symbol);
      filters.push(`t.symbol = $${params.length}`);
    }
    params.push(limit);
    return this.many(
      `SELECT o.payload_json || jsonb_build_object(
         'id', o.id,
         'workspace_id', t.workspace_id,
         'thesis_id', o.thesis_id,
         'result', o.result,
         'reviewed_at', o.reviewed_at,
         'invalidated', o.invalidated,
         'symbol', t.symbol,
         'direction', t.direction,
         'setup_type', t.setup_type,
         'confidence', t.confidence,
         'thesis_created_at', t.created_at,
         'thesis_payload', t.payload_json
       ) AS payload_json
       FROM outcome_reviews o
       JOIN trade_theses t ON t.id = o.thesis_id
       WHERE ${filters.join(' AND ')}
       ORDER BY o.reviewed_at DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  async getSignal(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'research_run_id', research_run_id,
         'signal_snapshot_id', signal_snapshot_id,
         'symbol', symbol,
         'signal_type', signal_type,
         'direction', direction,
         'confidence', confidence,
         'observed_at', observed_at,
         'source', source,
         'source_timestamp', source_timestamp,
         'payload', payload_json
       ) AS payload_json
       FROM signals
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async listSignals(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    if (symbol) {
      return this.many(
        `SELECT payload_json || jsonb_build_object(
           'id', id,
           'workspace_id', workspace_id,
           'research_run_id', research_run_id,
           'signal_snapshot_id', signal_snapshot_id,
           'symbol', symbol,
           'signal_type', signal_type,
           'direction', direction,
           'confidence', confidence,
           'observed_at', observed_at,
           'source', source,
           'source_timestamp', source_timestamp
         ) AS payload_json
         FROM signals
         WHERE workspace_id = $1 AND symbol = $2
         ORDER BY observed_at DESC
         LIMIT $3`,
        [workspaceId, symbol, limit],
      );
    }
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'research_run_id', research_run_id,
         'signal_snapshot_id', signal_snapshot_id,
         'symbol', symbol,
         'signal_type', signal_type,
         'direction', direction,
         'confidence', confidence,
         'observed_at', observed_at,
         'source', source,
         'source_timestamp', source_timestamp
       ) AS payload_json
       FROM signals
       WHERE workspace_id = $1
       ORDER BY observed_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  async summarizeSignals(
    symbol: string | undefined,
    workspaceId: string,
  ): Promise<SignalSummary> {
    const where = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (symbol) {
      params.push(symbol);
      where.push(`symbol = $${params.length}`);
    }
    const pool = this.requirePool();
    const result = await pool.query<
      Record<keyof SignalSummary, number | string>
    >(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE normalized_direction LIKE '%bull%' OR normalized_direction LIKE '%long%'
         )::int AS bullish,
         COUNT(*) FILTER (
           WHERE normalized_direction LIKE '%bear%' OR normalized_direction LIKE '%short%'
         )::int AS bearish,
         COUNT(*) FILTER (
           WHERE NOT (
             normalized_direction LIKE '%bull%' OR
             normalized_direction LIKE '%long%' OR
             normalized_direction LIKE '%bear%' OR
             normalized_direction LIKE '%short%'
           )
         )::int AS neutral
       FROM (
         SELECT LOWER(COALESCE(direction, '')) AS normalized_direction
         FROM signals
         WHERE ${where.join(' AND ')}
       ) scoped_signals`,
      params,
    );
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      bullish: Number(row?.bullish ?? 0),
      bearish: Number(row?.bearish ?? 0),
      neutral: Number(row?.neutral ?? 0),
    };
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

  async listEnabledWatchlists(limit: number): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'name', name,
         'enabled', enabled,
         'created_at', created_at
       ) AS payload_json
       FROM watchlists
       WHERE enabled <> 0
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
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

  async getWatchlistByName(
    name: string,
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
       WHERE name = $1 AND workspace_id = $2`,
      [name, workspaceId],
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
    watchlistName?: string,
    throughDate?: string,
  ): Promise<JsonRecord[]> {
    const filters = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (date) {
      params.push(date);
      filters.push(`brief_date = $${params.length}`);
    }
    if (throughDate) {
      params.push(throughDate);
      filters.push(`brief_date <= $${params.length}`);
    }
    if (watchlistName) {
      params.push(watchlistName);
      filters.push(`watchlist_name = $${params.length}`);
    }
    params.push(limit);
    return this.many(
      `SELECT payload_json FROM market_briefs
       WHERE ${filters.join(' AND ')}
       ORDER BY brief_date DESC, created_at DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  async getLatestMarketBrief(
    watchlistName: string | undefined,
    beforeDate: string | undefined,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const filters = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (watchlistName) {
      params.push(watchlistName);
      filters.push(`watchlist_name = $${params.length}`);
    }
    if (beforeDate) {
      params.push(beforeDate);
      filters.push(`brief_date < $${params.length}`);
    }
    return this.one(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'brief_date', brief_date,
         'watchlist_name', watchlist_name,
         'title', title,
         'created_at', created_at,
         'previous_brief_id', previous_brief_id,
         'payload', payload_json
       ) AS payload_json
       FROM market_briefs
       WHERE ${filters.join(' AND ')}
       ORDER BY brief_date DESC, created_at DESC
       LIMIT 1`,
      params,
    );
  }

  async saveMarketBrief(
    brief: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved = await this.one(
      `INSERT INTO market_briefs
       (id, workspace_id, brief_date, watchlist_name, title, created_at, previous_brief_id, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         brief_date = EXCLUDED.brief_date,
         watchlist_name = EXCLUDED.watchlist_name,
         title = EXCLUDED.title,
         created_at = EXCLUDED.created_at,
         previous_brief_id = EXCLUDED.previous_brief_id,
         payload_json = EXCLUDED.payload_json
       RETURNING payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'brief_date', brief_date,
         'watchlist_name', watchlist_name,
         'title', title,
         'created_at', created_at,
         'previous_brief_id', previous_brief_id,
         'payload', payload_json
       ) AS payload_json`,
      [
        stringValue(brief.id, ''),
        workspaceId,
        stringValue(brief.brief_date, new Date().toISOString().slice(0, 10)),
        stringValue(brief.watchlist_name, 'default'),
        stringValue(brief.title, 'Market Brief'),
        stringValue(brief.created_at, new Date().toISOString()),
        nullableString(brief.previous_brief_id),
        JSON.stringify(brief),
      ],
    );
    if (!saved) {
      throw new NotFoundException(`Market brief ${brief.id} not found`);
    }
    return saved;
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

  async findAlert(
    alertType: string,
    thesisId: string | undefined,
    watchlistItemId: string | undefined,
    triggerKey: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
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
       WHERE workspace_id = $1
         AND alert_type = $2
         AND trigger_key = $3
         AND COALESCE(thesis_id, '') = COALESCE($4, '')
         AND COALESCE(watchlist_item_id, '') = COALESCE($5, '')
       LIMIT 1`,
      [
        workspaceId,
        alertType,
        triggerKey,
        thesisId ?? null,
        watchlistItemId ?? null,
      ],
    );
  }

  async createAlert(alert: JsonRecord, workspaceId: string): Promise<JsonRecord> {
    const saved = await this.one(
      `INSERT INTO alerts
       (id, workspace_id, alert_type, symbol, thesis_id, watchlist_item_id, trigger_key, created_at, read_at, message, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
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
      [
        stringValue(alert.id, ''),
        workspaceId,
        stringValue(alert.alert_type, ''),
        stringValue(alert.symbol, ''),
        nullableString(alert.thesis_id),
        nullableString(alert.watchlist_item_id),
        nullableString(alert.trigger_key),
        stringValue(alert.created_at, new Date().toISOString()),
        nullableString(alert.read_at),
        stringValue(alert.message, ''),
        JSON.stringify(alert),
      ],
    );
    if (!saved) {
      throw new NotFoundException(`Alert ${alert.id} not found`);
    }
    return saved;
  }

  async listProviderHealth(limit: number): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'provider', provider,
         'component', component,
         'status', status,
         'checked_at', checked_at,
         'latency_ms', latency_ms,
         'error_type', error_type,
         'error_message', error_message,
         'payload', payload_json
       ) AS payload_json
       FROM provider_health
       ORDER BY checked_at DESC
       LIMIT $1`,
      [limit],
    );
  }

  async listLlmCalls(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT c.payload_json || jsonb_build_object(
         'id', c.id,
         'workspace_id', COALESCE(r.workspace_id, t.workspace_id),
         'research_run_id', c.research_run_id,
         'thesis_id', c.thesis_id,
         'provider', c.provider,
         'model', c.model,
         'stage', c.stage,
         'agent', c.agent,
         'input_tokens', c.input_tokens,
         'output_tokens', c.output_tokens,
         'latency_ms', c.latency_ms,
         'status', c.status,
         'error_type', c.error_type,
         'error_message', c.error_message,
         'created_at', c.created_at,
         'payload', c.payload_json
       ) AS payload_json
       FROM llm_calls c
       LEFT JOIN research_runs r ON r.id = c.research_run_id
       LEFT JOIN trade_theses t ON t.id = c.thesis_id
       WHERE COALESCE(r.workspace_id, t.workspace_id, $1) = $1
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  async listDataFreshnessChecks(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT f.payload_json || jsonb_build_object(
         'id', f.id,
         'workspace_id', r.workspace_id,
         'research_run_id', f.research_run_id,
         'symbol', f.symbol,
         'source', f.source,
         'source_timestamp', f.source_timestamp,
         'observed_timestamp', f.observed_timestamp,
         'age_seconds', f.age_seconds,
         'threshold_seconds', f.threshold_seconds,
         'status', f.status,
         'payload', f.payload_json
       ) AS payload_json
       FROM data_freshness_checks f
       LEFT JOIN research_runs r ON r.id = f.research_run_id
       WHERE COALESCE(r.workspace_id, $1) = $1
       ORDER BY f.observed_timestamp DESC
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

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Keep the original database error visible to the caller.
  }
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
