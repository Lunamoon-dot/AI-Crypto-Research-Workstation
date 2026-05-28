import {
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  AgentCalibrationSourceFilters,
  JournalRepository,
  JsonRecord,
  MaturedEvaluationThesisFilters,
  MonitoringJobClaimInput,
  MonitoringJobFailure,
  MonitoringJobInput,
  MonitoringRetentionPolicy,
  ResearchRunFailure,
  SignalSummary,
  SymbolCalibrationThesisFilters,
  ThesisDecisionIntent,
  ThesisEvaluationInput,
  ThesisEvaluationListFilters,
  ThesisEvaluationNaturalKey,
  ThesisEvaluationPromotionIdempotencyKey,
  ThesisEvaluationPromotionInput,
  ThesisEvaluationPromotionListFilters,
  ThesisEvaluationRunIdempotencyKey,
  ThesisEvaluationRunInput,
  ThesisEvaluationRunListFilters,
  ThesisEvaluationUpsertResult,
  ThesisReviewMetrics,
} from './journal.types';

type PayloadRow = {
  payload_json: string | JsonRecord;
};

type CreatedPayloadRow = PayloadRow & {
  created: boolean;
};

export class PostgresJournalRepository implements JournalRepository, OnModuleDestroy {
  private readonly pool?: Pool;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (databaseUrl) {
      this.pool = new Pool({ connectionString: databaseUrl });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
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

  async getResearchSnapshotByRun(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${researchSnapshotPayloadSql()} AS payload_json
       FROM research_snapshots
       WHERE research_run_id = $1 AND workspace_id = $2
       ORDER BY captured_at DESC
       LIMIT 1`,
      [runId, workspaceId],
    );
  }

  async saveResearchSnapshot(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = stringValue(snapshot.id, `snapshot_${randomUUID().replaceAll('-', '')}`);
    const researchRunId = stringValue(snapshot.research_run_id, '');
    const symbol = stringValue(snapshot.symbol, '');
    const capturedAt = stringValue(snapshot.captured_at, new Date().toISOString());
    const timeContext = stringValue(snapshot.time_context, 'unspecified');
    const payload = {
      ...snapshot,
      id,
      workspace_id: workspaceId,
      research_run_id: researchRunId,
      symbol,
      captured_at: capturedAt,
      time_context: timeContext,
      symbol_view: recordOrDefault(snapshot.symbol_view, {}),
      tracked_items: arrayFromUnknown(snapshot.tracked_items),
      data_quality: recordOrDefault(snapshot.data_quality, {}),
      source_artifacts: recordOrDefault(snapshot.source_artifacts, {}),
    };
    const saved = await this.one(
      `INSERT INTO research_snapshots
       (id, workspace_id, research_run_id, symbol, captured_at, time_context, symbol_view_json, tracked_items_json, data_quality_json, source_artifacts_json, payload_json)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)
       ON CONFLICT (workspace_id, research_run_id) DO UPDATE SET
         id = EXCLUDED.id,
         symbol = EXCLUDED.symbol,
         captured_at = EXCLUDED.captured_at,
         time_context = EXCLUDED.time_context,
         symbol_view_json = EXCLUDED.symbol_view_json,
         tracked_items_json = EXCLUDED.tracked_items_json,
         data_quality_json = EXCLUDED.data_quality_json,
         source_artifacts_json = EXCLUDED.source_artifacts_json,
         payload_json = EXCLUDED.payload_json
        RETURNING ${researchSnapshotPayloadSql()} AS payload_json`,
      [
        id,
        workspaceId,
        researchRunId,
        symbol,
        capturedAt,
        timeContext,
        JSON.stringify(payload.symbol_view),
        JSON.stringify(payload.tracked_items),
        JSON.stringify(payload.data_quality),
        JSON.stringify(payload.source_artifacts),
        JSON.stringify(payload),
      ],
    );
    if (!saved) {
      throw new NotFoundException(`Research snapshot ${id} not found`);
    }
    return saved;
  }

  async getResearchContinuityEntry(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${researchContinuityEntryPayloadSql()} AS payload_json
       FROM research_continuity_entries
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async getLatestResearchContinuityEntryForRun(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${researchContinuityEntryPayloadSql()} AS payload_json
       FROM research_continuity_entries
       WHERE research_run_id = $1 AND workspace_id = $2
       ORDER BY generated_at DESC, id DESC
       LIMIT 1`,
      [runId, workspaceId],
    );
  }

  async listResearchContinuityEntriesBySymbol(
    symbol: string,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT ${researchContinuityEntryPayloadSql()} AS payload_json
       FROM research_continuity_entries
       WHERE workspace_id = $1 AND symbol = $2
       ORDER BY generated_at DESC, id DESC
       LIMIT $3`,
      [workspaceId, symbol, limit],
    );
  }

  async saveResearchContinuityEntry(
    entry: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = stringValue(entry.id, `continuity_${randomUUID().replaceAll('-', '')}`);
    const symbol = stringValue(entry.symbol, '');
    const researchRunId = stringValue(entry.research_run_id, '');
    const generatedAt = stringValue(entry.generated_at, new Date().toISOString());
    const payload = {
      ...entry,
      id,
      workspace_id: workspaceId,
      symbol,
      research_run_id: researchRunId,
      current_snapshot_id: nullableString(entry.current_snapshot_id),
      previous_entry_id: nullableString(entry.previous_entry_id),
      entry_type: stringValue(entry.entry_type, 'skipped'),
      status: stringValue(entry.status, 'skipped'),
      generated_at: generatedAt,
      summary: stringValue(entry.summary, ''),
      sections: arrayFromUnknown(entry.sections),
      events: arrayFromUnknown(entry.events),
      snapshot_quality: recordOrDefault(entry.snapshot_quality, {}),
      source_run_ids: arrayFromUnknown(entry.source_run_ids),
      writer_metadata: recordOrDefault(entry.writer_metadata, {}),
    };
    const saved = await this.one(
      `INSERT INTO research_continuity_entries
       (id, workspace_id, symbol, research_run_id, current_snapshot_id, previous_entry_id, entry_type, status, generated_at, summary, sections_json, events_json, snapshot_quality_json, source_run_ids_json, writer_metadata_json, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb)
       RETURNING ${researchContinuityEntryPayloadSql()} AS payload_json`,
      [
        id,
        workspaceId,
        symbol,
        researchRunId,
        payload.current_snapshot_id,
        payload.previous_entry_id,
        payload.entry_type,
        payload.status,
        generatedAt,
        payload.summary,
        JSON.stringify(payload.sections),
        JSON.stringify(payload.events),
        JSON.stringify(payload.snapshot_quality),
        JSON.stringify(payload.source_run_ids),
        JSON.stringify(payload.writer_metadata),
        JSON.stringify(payload),
      ],
    );
    if (!saved) {
      throw new NotFoundException(`Research continuity entry ${id} not found`);
    }
    return saved;
  }

  async getResearchContinuityState(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${researchContinuityStatePayloadSql()} AS payload_json
       FROM research_continuity_states
       WHERE symbol = $1 AND workspace_id = $2`,
      [symbol, workspaceId],
    );
  }

  async saveResearchContinuityState(
    state: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = stringValue(state.id, `continuity_state_${randomUUID().replaceAll('-', '')}`);
    const symbol = stringValue(state.symbol, '');
    const updatedAt = stringValue(state.updated_at, new Date().toISOString());
    const payload = {
      ...state,
      id,
      workspace_id: workspaceId,
      symbol,
      current_snapshot_id: nullableString(state.current_snapshot_id),
      latest_entry_id: nullableString(state.latest_entry_id),
      latest_run_id: nullableString(state.latest_run_id),
      current_view: recordOrDefault(state.current_view, {}),
      active_items: arrayFromUnknown(state.active_items),
      recent_resolved_items: arrayFromUnknown(state.recent_resolved_items),
      recent_invalidated_items: arrayFromUnknown(state.recent_invalidated_items),
      data_quality: recordOrDefault(state.data_quality, {}),
      updated_at: updatedAt,
    };
    const saved = await this.one(
      `INSERT INTO research_continuity_states
       (id, workspace_id, symbol, current_snapshot_id, latest_entry_id, latest_run_id, current_view_json, active_items_json, recent_resolved_items_json, recent_invalidated_items_json, data_quality_json, updated_at, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::timestamptz, $13::jsonb)
       ON CONFLICT (workspace_id, symbol) DO UPDATE SET
         current_snapshot_id = EXCLUDED.current_snapshot_id,
         latest_entry_id = EXCLUDED.latest_entry_id,
         latest_run_id = EXCLUDED.latest_run_id,
         current_view_json = EXCLUDED.current_view_json,
         active_items_json = EXCLUDED.active_items_json,
         recent_resolved_items_json = EXCLUDED.recent_resolved_items_json,
         recent_invalidated_items_json = EXCLUDED.recent_invalidated_items_json,
         data_quality_json = EXCLUDED.data_quality_json,
         updated_at = EXCLUDED.updated_at,
         payload_json = EXCLUDED.payload_json
       RETURNING ${researchContinuityStatePayloadSql()} AS payload_json`,
      [
        id,
        workspaceId,
        symbol,
        payload.current_snapshot_id,
        payload.latest_entry_id,
        payload.latest_run_id,
        JSON.stringify(payload.current_view),
        JSON.stringify(payload.active_items),
        JSON.stringify(payload.recent_resolved_items),
        JSON.stringify(payload.recent_invalidated_items),
        JSON.stringify(payload.data_quality),
        updatedAt,
        JSON.stringify(payload),
      ],
    );
    if (!saved) {
      throw new NotFoundException(`Research continuity state ${symbol} not found`);
    }
    return saved;
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

  async listThesesForMaturedEvaluation(
    filters: MaturedEvaluationThesisFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const where = ['workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (filters.symbol) {
      params.push(filters.symbol);
      where.push(`symbol = $${params.length}`);
    }
    params.push(filters.limit);
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'symbol', symbol,
         'created_at', created_at
       ) AS payload_json
       FROM trade_theses
       WHERE ${where.join(' AND ')}
       ORDER BY created_at ASC, id ASC
       LIMIT $${params.length}`,
      params,
    );
  }

  async listThesesForSymbolCalibration(
    filters: SymbolCalibrationThesisFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT payload_json || jsonb_build_object(
         'id', id,
         'workspace_id', workspace_id,
         'symbol', symbol,
         'direction', direction,
         'confidence', confidence,
         'created_at', created_at
       ) AS payload_json
       FROM trade_theses
       WHERE workspace_id = $1
         AND symbol = $2
         AND created_at::date >= $3::date
         AND created_at::date <= $4::date
       ORDER BY created_at DESC, id ASC`,
      [workspaceId, filters.symbol, filters.periodStart, filters.periodEnd],
    );
  }

  async listAgentCalibrationSourceRows(
    filters: AgentCalibrationSourceFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const params: unknown[] = [
      workspaceId,
      filters.periodStart,
      filters.periodEnd,
      filters.windowDays,
    ];
    const symbolFilter = filters.symbol
      ? `AND COALESCE(run_thesis.symbol, fallback_thesis.symbol, rr.symbol, d.symbol) = $5`
      : '';
    if (filters.symbol) {
      params.push(filters.symbol);
    }

    return this.many(
      `SELECT jsonb_build_object(
         'opinion_id', ao.id,
         'workspace_id', ao.workspace_id,
         'agent_name', ao.agent_name,
         'agent_role', ao.agent_role,
         'agent_stance', ao.stance,
         'confidence', ao.confidence,
         'created_at', ao.created_at,
         'debate_id', ao.debate_id,
         'research_run_id', ao.research_run_id,
         'thesis_id', COALESCE(run_thesis.id, fallback_thesis.id),
         'symbol', COALESCE(run_thesis.symbol, fallback_thesis.symbol, rr.symbol, d.symbol),
         'thesis_direction', COALESCE(run_thesis.direction, fallback_thesis.direction),
         'thesis_created_at', COALESCE(run_thesis.created_at, fallback_thesis.created_at),
         'evaluation_id', e.id,
         'evaluation_result', e.result
       ) AS payload_json
       FROM agent_opinions ao
       LEFT JOIN research_runs rr
         ON rr.id = ao.research_run_id
        AND rr.workspace_id = ao.workspace_id
       LEFT JOIN debates d
         ON d.id = ao.debate_id
        AND d.workspace_id = ao.workspace_id
       LEFT JOIN trade_theses run_thesis
         ON run_thesis.id = rr.thesis_id
        AND run_thesis.workspace_id = ao.workspace_id
       LEFT JOIN LATERAL (
         SELECT ft.*
         FROM trade_theses ft
         WHERE ft.workspace_id = ao.workspace_id
           AND ft.research_run_id = ao.research_run_id
         ORDER BY ft.created_at DESC, ft.id ASC
         LIMIT 1
       ) fallback_thesis ON run_thesis.id IS NULL
       LEFT JOIN thesis_evaluations e
         ON e.workspace_id = ao.workspace_id
        AND e.thesis_id = COALESCE(run_thesis.id, fallback_thesis.id)
        AND e.window_days = $4
        AND e.evaluation_start = COALESCE(run_thesis.created_at, fallback_thesis.created_at)::date
        AND e.evaluation_end = (
          COALESCE(run_thesis.created_at, fallback_thesis.created_at)::date
          + ($4 * INTERVAL '1 day')
        )::date
       WHERE ao.workspace_id = $1
         AND (
           (
             COALESCE(run_thesis.id, fallback_thesis.id) IS NOT NULL
             AND COALESCE(run_thesis.created_at, fallback_thesis.created_at)::date >= $2::date
             AND COALESCE(run_thesis.created_at, fallback_thesis.created_at)::date <= $3::date
           )
           OR (
             COALESCE(run_thesis.id, fallback_thesis.id) IS NULL
             AND ao.created_at::date >= $2::date
             AND ao.created_at::date <= $3::date
           )
         )
         ${symbolFilter}
       ORDER BY ao.created_at DESC, ao.research_run_id ASC, ao.agent_role ASC, ao.id ASC`,
      params,
    );
  }

  async getThesisEvaluationByNaturalKey(
    key: ThesisEvaluationNaturalKey,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${evaluationPayloadSql('e')} AS payload_json
       FROM thesis_evaluations e
       WHERE e.workspace_id = $1
         AND e.thesis_id = $2
         AND e.window_days = $3
         AND e.evaluation_start = $4::date
         AND e.evaluation_end = $5::date`,
      [
        workspaceId,
        key.thesisId,
        key.windowDays,
        key.evaluationStart,
        key.evaluationEnd,
      ],
    );
  }

  async upsertThesisEvaluation(
    input: ThesisEvaluationInput,
    workspaceId: string,
  ): Promise<ThesisEvaluationUpsertResult> {
    const pool = this.requirePool();
    const id = stringValue(
      input.id,
      `evaluation_${randomUUID().replaceAll('-', '')}`,
    );
    const evaluatedAt =
      nullableString(input.evaluated_at) ?? new Date().toISOString();
    const warnings = JSON.stringify(input.warnings ?? []);
    const evidence = JSON.stringify(input.evidence ?? {});
    const payload = {
      ...(input.payload ?? {}),
      id,
      workspace_id: workspaceId,
      thesis_id: input.thesis_id,
      outcome_review_id: input.outcome_review_id ?? null,
      symbol: input.symbol,
      window_days: input.window_days,
      evaluation_start: input.evaluation_start,
      evaluation_end: input.evaluation_end,
      evaluated_at: evaluatedAt,
      result: input.result,
      max_favorable_excursion: input.max_favorable_excursion ?? null,
      max_adverse_excursion: input.max_adverse_excursion ?? null,
      invalidated: input.invalidated ?? false,
      warnings: input.warnings ?? [],
      evidence: input.evidence ?? {},
    };
    const result = await pool.query<CreatedPayloadRow>(
      `WITH inserted AS (
         INSERT INTO thesis_evaluations (
           id, workspace_id, thesis_id, outcome_review_id, symbol, window_days,
           evaluation_start, evaluation_end, evaluated_at, result,
           max_favorable_excursion, max_adverse_excursion, invalidated,
           warnings_json, evidence_json, payload_json
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12,
           $13, $14::jsonb, $15::jsonb, $16::jsonb
         )
         ON CONFLICT (
           workspace_id, thesis_id, window_days, evaluation_start, evaluation_end
         ) DO NOTHING
         RETURNING true AS created, ${evaluationPayloadSql()} AS payload_json
       )
       SELECT created, payload_json FROM inserted
       UNION ALL
       SELECT false AS created, ${evaluationPayloadSql('e')} AS payload_json
       FROM thesis_evaluations e
       WHERE e.workspace_id = $2
         AND e.thesis_id = $3
         AND e.window_days = $6
         AND e.evaluation_start = $7::date
         AND e.evaluation_end = $8::date
         AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [
        id,
        workspaceId,
        input.thesis_id,
        input.outcome_review_id ?? null,
        input.symbol,
        input.window_days,
        input.evaluation_start,
        input.evaluation_end,
        evaluatedAt,
        input.result,
        numberValue(input.max_favorable_excursion),
        numberValue(input.max_adverse_excursion),
        booleanValue(input.invalidated, false),
        warnings,
        evidence,
        JSON.stringify(payload),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ServiceUnavailableException('Thesis evaluation was not persisted.');
    }
    return {
      created: row.created,
      evaluation: parsePayload(row.payload_json),
    };
  }

  async listThesisEvaluations(
    filters: ThesisEvaluationListFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const where = ['e.workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (filters.thesisId) {
      params.push(filters.thesisId);
      where.push(`e.thesis_id = $${params.length}`);
    }
    params.push(filters.limit);
    return this.many(
      `SELECT ${evaluationPayloadSql('e')} AS payload_json
       FROM thesis_evaluations e
       WHERE ${where.join(' AND ')}
       ORDER BY e.evaluated_at DESC, e.id DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  async getThesisEvaluation(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${evaluationPayloadSql('e')} AS payload_json
       FROM thesis_evaluations e
       WHERE e.id = $1 AND e.workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async linkThesisEvaluationOutcomeReview(
    id: string,
    outcomeReviewId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `UPDATE thesis_evaluations
       SET outcome_review_id = $3,
           payload_json = payload_json || jsonb_build_object('outcome_review_id', $3)
       WHERE id = $1 AND workspace_id = $2
       RETURNING ${evaluationPayloadSql()} AS payload_json`,
      [id, workspaceId, outcomeReviewId],
    );
  }

  async listThesisEvaluationRuns(
    filters: ThesisEvaluationRunListFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT ${evaluationRunPayloadSql('r')} AS payload_json
       FROM thesis_evaluation_runs r
       WHERE r.workspace_id = $1
         AND r.canonical_evaluation_id = $2
       ORDER BY r.requested_at DESC, r.id ASC
       LIMIT $3`,
      [workspaceId, filters.canonicalEvaluationId, filters.limit],
    );
  }

  async getThesisEvaluationRunByIdempotencyKey(
    key: ThesisEvaluationRunIdempotencyKey,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${evaluationRunPayloadSql('r')} AS payload_json
       FROM thesis_evaluation_runs r
       WHERE r.workspace_id = $1
         AND r.canonical_evaluation_id = $2
         AND r.idempotency_key = $3`,
      [workspaceId, key.canonicalEvaluationId, key.idempotencyKey],
    );
  }

  async getThesisEvaluationRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${evaluationRunPayloadSql('r')} AS payload_json
       FROM thesis_evaluation_runs r
       WHERE r.id = $1 AND r.workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async createThesisEvaluationRun(
    input: ThesisEvaluationRunInput,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = stringValue(
      input.id,
      `evaluation_rerun_${randomUUID().replaceAll('-', '')}`,
    );
    const requestedAt =
      nullableString(input.requested_at) ?? new Date().toISOString();
    const warnings = input.warnings ?? [];
    const evidence = input.evidence ?? {};
    const diff = input.diff ?? {};
    const payload = {
      ...(input.payload ?? {}),
      id,
      workspace_id: workspaceId,
      canonical_evaluation_id: input.canonical_evaluation_id,
      thesis_id: input.thesis_id,
      symbol: input.symbol,
      window_days: input.window_days,
      evaluation_start: input.evaluation_start,
      evaluation_end: input.evaluation_end,
      requested_by_user_id: input.requested_by_user_id ?? null,
      requested_at: requestedAt,
      evaluated_at: input.evaluated_at ?? null,
      source: input.source,
      reason: input.reason,
      notes: input.notes ?? null,
      idempotency_key: input.idempotency_key ?? null,
      status: input.status,
      result: input.result ?? null,
      max_favorable_excursion: input.max_favorable_excursion ?? null,
      max_adverse_excursion: input.max_adverse_excursion ?? null,
      invalidated: input.invalidated ?? null,
      warnings,
      evidence,
      diff,
      error_type: input.error_type ?? null,
      error_message: input.error_message ?? null,
    };
    const saved = await this.one(
      `INSERT INTO thesis_evaluation_runs (
         id, workspace_id, canonical_evaluation_id, thesis_id, symbol,
         window_days, evaluation_start, evaluation_end, requested_by_user_id,
         requested_at, evaluated_at, source, reason, notes, idempotency_key,
         status, result, max_favorable_excursion, max_adverse_excursion,
         invalidated, warnings_json, evidence_json, diff_json, error_type,
         error_message, payload_json
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb,
         $23::jsonb, $24, $25, $26::jsonb
       )
       RETURNING ${evaluationRunPayloadSql()} AS payload_json`,
      [
        id,
        workspaceId,
        input.canonical_evaluation_id,
        input.thesis_id,
        input.symbol,
        input.window_days,
        input.evaluation_start,
        input.evaluation_end,
        input.requested_by_user_id ?? null,
        requestedAt,
        input.evaluated_at ?? null,
        input.source,
        input.reason,
        input.notes ?? null,
        input.idempotency_key ?? null,
        input.status,
        input.result ?? null,
        numberValue(input.max_favorable_excursion),
        numberValue(input.max_adverse_excursion),
        input.invalidated ?? null,
        JSON.stringify(warnings),
        JSON.stringify(evidence),
        JSON.stringify(diff),
        input.error_type ?? null,
        input.error_message ?? null,
        JSON.stringify(payload),
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException(
        'Thesis evaluation rerun was not persisted.',
      );
    }
    return saved;
  }

  async listThesisEvaluationPromotions(
    filters: ThesisEvaluationPromotionListFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT ${evaluationPromotionPayloadSql('p')} AS payload_json
       FROM thesis_evaluation_promotions p
       WHERE p.workspace_id = $1
         AND p.canonical_evaluation_id = $2
       ORDER BY p.promoted_at DESC, p.id ASC
       LIMIT $3`,
      [workspaceId, filters.canonicalEvaluationId, filters.limit],
    );
  }

  async getLatestThesisEvaluationPromotion(
    canonicalEvaluationId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${evaluationPromotionPayloadSql('p')} AS payload_json
       FROM thesis_evaluation_promotions p
       WHERE p.workspace_id = $1
         AND p.canonical_evaluation_id = $2
       ORDER BY p.promoted_at DESC, p.id ASC
       LIMIT 1`,
      [workspaceId, canonicalEvaluationId],
    );
  }

  async getThesisEvaluationPromotionByIdempotencyKey(
    key: ThesisEvaluationPromotionIdempotencyKey,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${evaluationPromotionPayloadSql('p')} AS payload_json
       FROM thesis_evaluation_promotions p
       WHERE p.workspace_id = $1
         AND p.canonical_evaluation_id = $2
         AND p.idempotency_key = $3`,
      [workspaceId, key.canonicalEvaluationId, key.idempotencyKey],
    );
  }

  async createThesisEvaluationPromotion(
    input: ThesisEvaluationPromotionInput,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = stringValue(
      input.id,
      `promotion_${randomUUID().replaceAll('-', '')}`,
    );
    const promotedAt =
      nullableString(input.promoted_at) ?? new Date().toISOString();
    const payload = {
      ...(input.payload ?? {}),
      id,
      workspace_id: workspaceId,
      canonical_evaluation_id: input.canonical_evaluation_id,
      promoted_rerun_id: input.promoted_rerun_id ?? null,
      action: input.action,
      promoted_by_user_id: input.promoted_by_user_id ?? null,
      promoted_at: promotedAt,
      reason: input.reason,
      notes: input.notes ?? null,
      idempotency_key: input.idempotency_key ?? null,
    };
    const saved = await this.one(
      `INSERT INTO thesis_evaluation_promotions (
         id, workspace_id, canonical_evaluation_id, promoted_rerun_id, action,
         promoted_by_user_id, promoted_at, reason, notes, idempotency_key,
         payload_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING ${evaluationPromotionPayloadSql()} AS payload_json`,
      [
        id,
        workspaceId,
        input.canonical_evaluation_id,
        input.promoted_rerun_id ?? null,
        input.action,
        input.promoted_by_user_id ?? null,
        promotedAt,
        input.reason,
        input.notes ?? null,
        input.idempotency_key ?? null,
        JSON.stringify(payload),
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException(
        'Thesis evaluation promotion event was not persisted.',
      );
    }
    return saved;
  }

  async getThesisMonitorPlan(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${monitorPlanPayloadSql('p')} AS payload_json
       FROM thesis_monitor_plans p
       WHERE p.thesis_id = $1 AND p.workspace_id = $2`,
      [thesisId, workspaceId],
    );
  }

  async saveThesisMonitorPlan(
    plan: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const now = new Date().toISOString();
    const payload = { ...plan, workspace_id: workspaceId };
    const saved = await this.one(
      `INSERT INTO thesis_monitor_plans (
         id, workspace_id, thesis_id, baseline_run_id, symbol, market_type,
         status, created_at, updated_at, baseline_price, baseline_price_source,
         baseline_observed_at, entry_low, entry_high, invalidation_level,
         invalidation_direction, targets_json, scenario_triggers_json,
         missing_fields_json, price_interval_minutes, signal_interval_minutes,
         memo_interval_minutes, watch_distance_pct, review_distance_pct,
         consecutive_review_to_rerun, consecutive_invalidation_to_rerun,
         run_memo_on_review, run_memo_on_rerun_full, skip_memo_if_no_new_pulses,
         enabled_signal_factors_json, scheduler_enabled, latest_pulse_id,
         latest_memo_id, latest_status, latest_price, latest_trigger_reasons_json,
         last_pulse_at, next_pulse_due_at, last_memo_at, next_memo_due_at,
         payload_json
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22,
         $23, $24, $25, $26, $27, $28, $29, $30::jsonb, $31, $32, $33,
         $34, $35, $36::jsonb, $37, $38, $39, $40, $41::jsonb
       )
       ON CONFLICT (workspace_id, thesis_id) DO UPDATE SET
         baseline_run_id = EXCLUDED.baseline_run_id,
         symbol = EXCLUDED.symbol,
         market_type = EXCLUDED.market_type,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at,
         baseline_price = EXCLUDED.baseline_price,
         baseline_price_source = EXCLUDED.baseline_price_source,
         baseline_observed_at = EXCLUDED.baseline_observed_at,
         entry_low = EXCLUDED.entry_low,
         entry_high = EXCLUDED.entry_high,
         invalidation_level = EXCLUDED.invalidation_level,
         invalidation_direction = EXCLUDED.invalidation_direction,
         targets_json = EXCLUDED.targets_json,
         scenario_triggers_json = EXCLUDED.scenario_triggers_json,
         missing_fields_json = EXCLUDED.missing_fields_json,
         price_interval_minutes = EXCLUDED.price_interval_minutes,
         signal_interval_minutes = EXCLUDED.signal_interval_minutes,
         memo_interval_minutes = EXCLUDED.memo_interval_minutes,
         watch_distance_pct = EXCLUDED.watch_distance_pct,
         review_distance_pct = EXCLUDED.review_distance_pct,
         consecutive_review_to_rerun = EXCLUDED.consecutive_review_to_rerun,
         consecutive_invalidation_to_rerun = EXCLUDED.consecutive_invalidation_to_rerun,
         run_memo_on_review = EXCLUDED.run_memo_on_review,
         run_memo_on_rerun_full = EXCLUDED.run_memo_on_rerun_full,
         skip_memo_if_no_new_pulses = EXCLUDED.skip_memo_if_no_new_pulses,
         enabled_signal_factors_json = EXCLUDED.enabled_signal_factors_json,
         scheduler_enabled = EXCLUDED.scheduler_enabled,
         latest_pulse_id = EXCLUDED.latest_pulse_id,
         latest_memo_id = EXCLUDED.latest_memo_id,
         latest_status = EXCLUDED.latest_status,
         latest_price = EXCLUDED.latest_price,
         latest_trigger_reasons_json = EXCLUDED.latest_trigger_reasons_json,
         last_pulse_at = EXCLUDED.last_pulse_at,
         next_pulse_due_at = EXCLUDED.next_pulse_due_at,
         last_memo_at = EXCLUDED.last_memo_at,
         next_memo_due_at = EXCLUDED.next_memo_due_at,
         payload_json = EXCLUDED.payload_json
       RETURNING ${monitorPlanPayloadSql()} AS payload_json`,
      [
        stringValue(plan.id, `monitor_plan_${randomUUID().replaceAll('-', '')}`),
        workspaceId,
        stringValue(plan.thesis_id, ''),
        nullableString(plan.baseline_run_id),
        stringValue(plan.symbol, ''),
        stringValue(plan.market_type, 'spot'),
        stringValue(plan.status, 'draft'),
        nullableString(plan.created_at) ?? now,
        nullableString(plan.updated_at) ?? now,
        numberValue(plan.baseline_price),
        stringValue(plan.baseline_price_source, 'missing'),
        nullableString(plan.baseline_observed_at),
        numberValue(plan.entry_low),
        numberValue(plan.entry_high),
        numberValue(plan.invalidation_level),
        nullableString(plan.invalidation_direction),
        jsonArrayParam(plan.targets ?? plan.targets_json),
        jsonArrayParam(plan.scenario_triggers ?? plan.scenario_triggers_json),
        jsonArrayParam(plan.missing_fields ?? plan.missing_fields_json),
        integerValue(plan.price_interval_minutes, 5),
        integerValue(plan.signal_interval_minutes, 15),
        integerValue(plan.memo_interval_minutes, 240),
        numberValue(plan.watch_distance_pct) ?? 5,
        numberValue(plan.review_distance_pct) ?? 2,
        integerValue(plan.consecutive_review_to_rerun, 3),
        integerValue(plan.consecutive_invalidation_to_rerun, 2),
        booleanValue(plan.run_memo_on_review, true),
        booleanValue(plan.run_memo_on_rerun_full, true),
        booleanValue(plan.skip_memo_if_no_new_pulses, true),
        jsonArrayParam(
          plan.enabled_signal_factors ?? plan.enabled_signal_factors_json,
        ),
        booleanValue(plan.scheduler_enabled, false),
        nullableString(plan.latest_pulse_id),
        nullableString(plan.latest_memo_id),
        nullableString(plan.latest_status),
        numberValue(plan.latest_price),
        jsonArrayParam(
          plan.latest_trigger_reasons ?? plan.latest_trigger_reasons_json,
        ),
        nullableString(plan.last_pulse_at),
        nullableString(plan.next_pulse_due_at),
        nullableString(plan.last_memo_at),
        nullableString(plan.next_memo_due_at),
        JSON.stringify(payload),
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException('Monitor plan was not persisted.');
    }
    return saved;
  }

  async listThesisPulses(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT ${pulsePayloadSql('p')} AS payload_json
       FROM thesis_pulses p
       WHERE p.thesis_id = $1 AND p.workspace_id = $2
       ORDER BY p.observed_at DESC, p.id DESC
       LIMIT $3`,
      [thesisId, workspaceId, limit],
    );
  }

  async saveThesisPulse(
    pulse: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const pool = this.requirePool();
    const client = await pool.connect();
    const payload = { ...pulse, workspace_id: workspaceId };
    const pulseId = stringValue(
      pulse.id,
      `pulse_${randomUUID().replaceAll('-', '')}`,
    );
    const observedAt = nullableString(pulse.observed_at) ?? new Date().toISOString();
    try {
      await client.query('BEGIN');
      const result = await client.query<PayloadRow>(
        `INSERT INTO thesis_pulses (
           id, workspace_id, thesis_id, monitor_plan_id, baseline_run_id, symbol,
           market_type, pulse_type, bucket_start, observed_at, current_price,
           baseline_price, price_change_pct, distance_to_entry_pct,
           distance_to_invalidation_pct, nearest_target,
           distance_to_nearest_target_pct, signal_bias, signal_confidence,
           signal_delta, scenario_status, score, status, suggested_action,
           trigger_reasons_json, hard_triggers_json, missing_data_json,
           payload_json
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb,
           $26::jsonb, $27::jsonb, $28::jsonb
         )
         ON CONFLICT (workspace_id, thesis_id, bucket_start, pulse_type)
         DO UPDATE SET
           monitor_plan_id = EXCLUDED.monitor_plan_id,
           baseline_run_id = EXCLUDED.baseline_run_id,
           symbol = EXCLUDED.symbol,
           market_type = EXCLUDED.market_type,
           observed_at = EXCLUDED.observed_at,
           current_price = EXCLUDED.current_price,
           baseline_price = EXCLUDED.baseline_price,
           price_change_pct = EXCLUDED.price_change_pct,
           distance_to_entry_pct = EXCLUDED.distance_to_entry_pct,
           distance_to_invalidation_pct = EXCLUDED.distance_to_invalidation_pct,
           nearest_target = EXCLUDED.nearest_target,
           distance_to_nearest_target_pct = EXCLUDED.distance_to_nearest_target_pct,
           signal_bias = EXCLUDED.signal_bias,
           signal_confidence = EXCLUDED.signal_confidence,
           signal_delta = EXCLUDED.signal_delta,
           scenario_status = EXCLUDED.scenario_status,
           score = EXCLUDED.score,
           status = EXCLUDED.status,
           suggested_action = EXCLUDED.suggested_action,
           trigger_reasons_json = EXCLUDED.trigger_reasons_json,
           hard_triggers_json = EXCLUDED.hard_triggers_json,
           missing_data_json = EXCLUDED.missing_data_json,
           payload_json = EXCLUDED.payload_json
         RETURNING ${pulsePayloadSql()} AS payload_json`,
        [
          pulseId,
          workspaceId,
          stringValue(pulse.thesis_id, ''),
          stringValue(pulse.monitor_plan_id, ''),
          nullableString(pulse.baseline_run_id),
          stringValue(pulse.symbol, ''),
          stringValue(pulse.market_type, 'spot'),
          stringValue(pulse.pulse_type, 'manual'),
          nullableString(pulse.bucket_start) ?? observedAt,
          observedAt,
          numberValue(pulse.current_price),
          numberValue(pulse.baseline_price),
          numberValue(pulse.price_change_pct),
          numberValue(pulse.distance_to_entry_pct),
          numberValue(pulse.distance_to_invalidation_pct),
          numberValue(pulse.nearest_target),
          numberValue(pulse.distance_to_nearest_target_pct),
          stringValue(pulse.signal_bias, 'unknown'),
          numberValue(pulse.signal_confidence),
          numberValue(pulse.signal_delta),
          stringValue(pulse.scenario_status, 'none'),
          integerValue(pulse.score, 0),
          stringValue(pulse.status, 'watch'),
          stringValue(pulse.suggested_action, 'inspect_chart'),
          jsonArrayParam(pulse.trigger_reasons ?? pulse.trigger_reasons_json),
          jsonArrayParam(pulse.hard_triggers ?? pulse.hard_triggers_json),
          jsonArrayParam(pulse.missing_data ?? pulse.missing_data_json),
          JSON.stringify(payload),
        ],
      );
      const saved = parsePayload(result.rows[0]!.payload_json);
      await client.query(
        `UPDATE thesis_monitor_plans
         SET latest_pulse_id = $1,
             latest_status = $2,
             latest_price = $3,
             latest_trigger_reasons_json = $4::jsonb,
             last_pulse_at = $5,
             next_pulse_due_at = COALESCE($6::timestamptz, next_pulse_due_at),
             updated_at = now(),
             payload_json = payload_json || jsonb_build_object(
               'latest_pulse_id', $1,
               'latest_status', $2,
               'latest_price', $3,
               'latest_trigger_reasons', $4::jsonb,
               'last_pulse_at', $5::timestamptz,
               'next_pulse_due_at', COALESCE($6::timestamptz, next_pulse_due_at)
             )
         WHERE workspace_id = $7 AND thesis_id = $8`,
        [
          stringValue(saved.id, pulseId),
          stringValue(saved.status, 'watch'),
          numberValue(saved.current_price),
          jsonArrayParam(saved.trigger_reasons),
          observedAt,
          nullableString(pulse.next_pulse_due_at),
          workspaceId,
          stringValue(saved.thesis_id, ''),
        ],
      );
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listThesisPulseMemos(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]> {
    return this.many(
      `SELECT ${memoPayloadSql('m')} AS payload_json
       FROM thesis_pulse_memos m
       WHERE m.thesis_id = $1 AND m.workspace_id = $2
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      [thesisId, workspaceId, limit],
    );
  }

  async saveThesisPulseMemo(
    memo: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const pool = this.requirePool();
    const client = await pool.connect();
    const payload = { ...memo, workspace_id: workspaceId };
    const memoId = stringValue(
      memo.id,
      `pulse_memo_${randomUUID().replaceAll('-', '')}`,
    );
    const createdAt = nullableString(memo.created_at) ?? new Date().toISOString();
    try {
      await client.query('BEGIN');
      const result = await client.query<PayloadRow>(
        `INSERT INTO thesis_pulse_memos (
           id, workspace_id, thesis_id, monitor_plan_id, baseline_run_id,
           memo_type, window_start, window_end, created_at, status, summary,
           what_changed_json, why_it_matters_json, what_to_watch_next_json,
           recommended_action, rerun_full_recommended, confidence,
           referenced_pulse_ids_json, prompt_version, provider, model,
           payload_json
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
           $13::jsonb, $14::jsonb, $15, $16, $17, $18::jsonb, $19, $20,
           $21, $22::jsonb
         )
         ON CONFLICT (workspace_id, thesis_id, window_start, window_end, memo_type)
         DO UPDATE SET
           monitor_plan_id = EXCLUDED.monitor_plan_id,
           baseline_run_id = EXCLUDED.baseline_run_id,
           created_at = EXCLUDED.created_at,
           status = EXCLUDED.status,
           summary = EXCLUDED.summary,
           what_changed_json = EXCLUDED.what_changed_json,
           why_it_matters_json = EXCLUDED.why_it_matters_json,
           what_to_watch_next_json = EXCLUDED.what_to_watch_next_json,
           recommended_action = EXCLUDED.recommended_action,
           rerun_full_recommended = EXCLUDED.rerun_full_recommended,
           confidence = EXCLUDED.confidence,
           referenced_pulse_ids_json = EXCLUDED.referenced_pulse_ids_json,
           prompt_version = EXCLUDED.prompt_version,
           provider = EXCLUDED.provider,
           model = EXCLUDED.model,
           payload_json = EXCLUDED.payload_json
         RETURNING ${memoPayloadSql()} AS payload_json`,
        [
          memoId,
          workspaceId,
          stringValue(memo.thesis_id, ''),
          stringValue(memo.monitor_plan_id, ''),
          nullableString(memo.baseline_run_id),
          stringValue(memo.memo_type, 'manual'),
          nullableString(memo.window_start) ?? createdAt,
          nullableString(memo.window_end) ?? createdAt,
          createdAt,
          stringValue(memo.status, 'watch'),
          stringValue(memo.summary, ''),
          jsonArrayParam(memo.what_changed ?? memo.what_changed_json),
          jsonArrayParam(memo.why_it_matters ?? memo.why_it_matters_json),
          jsonArrayParam(memo.what_to_watch_next ?? memo.what_to_watch_next_json),
          stringValue(memo.recommended_action, 'inspect_chart'),
          booleanValue(memo.rerun_full_recommended, false),
          numberValue(memo.confidence),
          jsonArrayParam(
            memo.referenced_pulse_ids ?? memo.referenced_pulse_ids_json,
          ),
          stringValue(memo.prompt_version, 'pulse_memo.v1'),
          stringValue(memo.provider, 'unknown'),
          stringValue(memo.model, 'unknown'),
          JSON.stringify(payload),
        ],
      );
      const saved = parsePayload(result.rows[0]!.payload_json);
      await client.query(
        `UPDATE thesis_monitor_plans
         SET latest_memo_id = $1,
             last_memo_at = $2,
             next_memo_due_at = COALESCE($3::timestamptz, next_memo_due_at),
             updated_at = now(),
             payload_json = payload_json || jsonb_build_object(
               'latest_memo_id', $1,
               'last_memo_at', $2::timestamptz,
               'next_memo_due_at', COALESCE($3::timestamptz, next_memo_due_at)
             )
         WHERE workspace_id = $4 AND thesis_id = $5`,
        [
          stringValue(saved.id, memoId),
          createdAt,
          nullableString(memo.next_memo_due_at),
          workspaceId,
          stringValue(saved.thesis_id, ''),
        ],
      );
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async enqueueMonitoringJob(input: MonitoringJobInput): Promise<JsonRecord> {
    const saved = await this.one(
      `INSERT INTO monitoring_jobs (
         id, workspace_id, thesis_id, job_type, status, priority, run_after,
         attempt_count, max_attempts, idempotency_key, request_json, created_at,
         updated_at
       )
       VALUES (
         $1, $2, $3, $4, 'queued', $5, $6, 0, $7, $8, $9::jsonb, now(), now()
       )
       ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET
         request_json = monitoring_jobs.request_json,
         updated_at = monitoring_jobs.updated_at
       RETURNING ${monitoringJobPayloadSql()} AS payload_json`,
      [
        `monitor_job_${randomUUID().replaceAll('-', '')}`,
        input.workspaceId,
        input.thesisId ?? null,
        input.jobType,
        input.priority ?? 0,
        input.runAfter ?? new Date().toISOString(),
        input.maxAttempts ?? 3,
        input.idempotencyKey,
        JSON.stringify(input.request),
      ],
    );
    if (!saved) {
      throw new ServiceUnavailableException('Monitoring job was not enqueued.');
    }
    return saved;
  }

  async claimMonitoringJobs(
    workspaceId: string,
    input: MonitoringJobClaimInput,
  ): Promise<JsonRecord[]> {
    const now = input.now ?? new Date().toISOString();
    return this.many(
      `WITH claimed AS (
         SELECT id
         FROM monitoring_jobs
         WHERE workspace_id = $1
           AND status = 'queued'
           AND run_after <= $2
         ORDER BY priority DESC, run_after ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $3
       )
       UPDATE monitoring_jobs j
       SET status = 'running',
           locked_at = $2,
           locked_by = $4,
           started_at = COALESCE(started_at, $2),
           attempt_count = attempt_count + 1,
           error_type = NULL,
           error_message = NULL,
           updated_at = $2
       FROM claimed
       WHERE j.id = claimed.id
       RETURNING ${monitoringJobPayloadSql('j')} AS payload_json`,
      [workspaceId, now, Math.max(1, input.limit), input.workerId],
    );
  }

  async completeMonitoringJob(
    id: string,
    workspaceId: string,
    result: JsonRecord,
  ): Promise<JsonRecord | null> {
    return this.one(
      `UPDATE monitoring_jobs
       SET status = 'succeeded',
           locked_at = NULL,
           locked_by = NULL,
           completed_at = now(),
           result_json = $3::jsonb,
           error_type = NULL,
           error_message = NULL,
           updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING ${monitoringJobPayloadSql()} AS payload_json`,
      [id, workspaceId, JSON.stringify(result)],
    );
  }

  async failMonitoringJob(
    id: string,
    workspaceId: string,
    failure: MonitoringJobFailure,
  ): Promise<JsonRecord | null> {
    return this.one(
      `UPDATE monitoring_jobs
       SET status =
             CASE
               WHEN $5::boolean AND attempt_count < max_attempts THEN 'queued'
               WHEN attempt_count >= max_attempts THEN 'dead_letter'
               ELSE 'failed'
             END,
           run_after =
             CASE
               WHEN $5::boolean AND attempt_count < max_attempts
                 THEN COALESCE($6::timestamptz, now() + make_interval(secs => LEAST(3600, attempt_count * 60)))
               ELSE run_after
             END,
           locked_at = NULL,
           locked_by = NULL,
           completed_at =
             CASE
               WHEN $5::boolean AND attempt_count < max_attempts THEN NULL
               ELSE now()
             END,
           error_type = $3,
           error_message = $4,
           result_json = $7::jsonb,
           updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING ${monitoringJobPayloadSql()} AS payload_json`,
      [
        id,
        workspaceId,
        failure.errorType,
        failure.errorMessage,
        failure.retryable,
        failure.runAfter ?? null,
        JSON.stringify(failure.result ?? {}),
      ],
    );
  }

  async runMonitoringRetention(
    workspaceId: string,
    policy: MonitoringRetentionPolicy,
  ): Promise<JsonRecord> {
    const pool = this.requirePool();
    const client = await pool.connect();
    const startedAt = policy.now ?? new Date().toISOString();
    const runId = `monitor_retention_${randomUUID().replaceAll('-', '')}`;
    const pulseCutoff = addDaysIso(startedAt, -policy.pulseKeepDays);
    const memoCutoff = addDaysIso(startedAt, -policy.memoKeepDays);
    const succeededJobCutoff = addDaysIso(startedAt, -policy.succeededJobKeepDays);
    const failedJobCutoff = addDaysIso(startedAt, -policy.failedJobKeepDays);
    try {
      await client.query('BEGIN');
      const pulseCount = await countRetentionCandidates(
        client,
        `WITH ranked AS (
           SELECT id,
             row_number() OVER (
               PARTITION BY workspace_id, thesis_id
               ORDER BY observed_at DESC, id DESC
             ) AS row_number
           FROM thesis_pulses
           WHERE workspace_id = $1
         )
         SELECT COUNT(*)::int AS count
         FROM thesis_pulses p
         JOIN ranked r ON r.id = p.id
         WHERE p.workspace_id = $1
           AND p.observed_at < $2
           AND r.row_number > $3`,
        [workspaceId, pulseCutoff, policy.pulseKeepLatestPerThesis],
      );
      const memoCount = await countRetentionCandidates(
        client,
        `SELECT COUNT(*)::int AS count
         FROM thesis_pulse_memos
         WHERE workspace_id = $1 AND created_at < $2`,
        [workspaceId, memoCutoff],
      );
      const jobCount = await countRetentionCandidates(
        client,
        `SELECT COUNT(*)::int AS count
         FROM monitoring_jobs
         WHERE workspace_id = $1
           AND (
             (status = 'succeeded' AND COALESCE(completed_at, updated_at) < $2)
             OR (status IN ('failed', 'dead_letter', 'cancelled') AND COALESCE(completed_at, updated_at) < $3)
           )`,
        [workspaceId, succeededJobCutoff, failedJobCutoff],
      );

      if (!policy.dryRun) {
        await client.query(
          `WITH ranked AS (
             SELECT id,
               row_number() OVER (
                 PARTITION BY workspace_id, thesis_id
                 ORDER BY observed_at DESC, id DESC
               ) AS row_number
             FROM thesis_pulses
             WHERE workspace_id = $1
           )
           DELETE FROM thesis_pulses p
           USING ranked r
           WHERE p.id = r.id
             AND p.workspace_id = $1
             AND p.observed_at < $2
             AND r.row_number > $3`,
          [workspaceId, pulseCutoff, policy.pulseKeepLatestPerThesis],
        );
        await client.query(
          `DELETE FROM thesis_pulse_memos
           WHERE workspace_id = $1 AND created_at < $2`,
          [workspaceId, memoCutoff],
        );
        await client.query(
          `DELETE FROM monitoring_jobs
           WHERE workspace_id = $1
             AND (
               (status = 'succeeded' AND COALESCE(completed_at, updated_at) < $2)
               OR (status IN ('failed', 'dead_letter', 'cancelled') AND COALESCE(completed_at, updated_at) < $3)
             )`,
          [workspaceId, succeededJobCutoff, failedJobCutoff],
        );
      }

      const completedAt = new Date().toISOString();
      const payload: JsonRecord = {
        id: runId,
        workspace_id: workspaceId,
        started_at: startedAt,
        completed_at: completedAt,
        dry_run: policy.dryRun,
        deleted_pulses: pulseCount,
        deleted_memos: memoCount,
        deleted_jobs: jobCount,
        protected_tables: [
          'trade_theses',
          'research_runs',
          'user_decisions',
          'outcome_reviews',
          'market_snapshots',
          'signal_snapshots',
        ],
        policy,
      };
      const result = await client.query<PayloadRow>(
        `INSERT INTO monitoring_retention_runs (
           id, workspace_id, started_at, completed_at, dry_run, deleted_pulses,
           deleted_memos, deleted_jobs, error, policy_json, payload_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9::jsonb, $10::jsonb)
         RETURNING payload_json AS payload_json`,
        [
          runId,
          workspaceId,
          startedAt,
          completedAt,
          policy.dryRun,
          pulseCount,
          memoCount,
          jobCount,
          JSON.stringify(policy),
          JSON.stringify(payload),
        ],
      );
      await client.query('COMMIT');
      return parsePayload(result.rows[0]!.payload_json);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getMonitoringOperationsHealth(
    workspaceId: string,
  ): Promise<JsonRecord> {
    const pool = this.requirePool();
    const [queue, scheduler, workers, retention, memoHealth] =
      await Promise.all([
        pool.query<{
          queued: string;
          running: string;
          failed: string;
          dead_letter: string;
          oldest_queued_at: Date | string | null;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
             COUNT(*) FILTER (WHERE status = 'running')::text AS running,
             COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
             COUNT(*) FILTER (WHERE status = 'dead_letter')::text AS dead_letter,
             MIN(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at
           FROM monitoring_jobs
           WHERE workspace_id = $1`,
          [workspaceId],
        ),
        pool.query<{
          enabled_plans: string;
          due_plans: string;
          last_enqueue_at: Date | string | null;
          last_enqueue_error: string | null;
        }>(
          `SELECT
             (SELECT COUNT(*)::text FROM thesis_monitor_plans
              WHERE workspace_id = $1 AND scheduler_enabled = true AND status = 'active') AS enabled_plans,
             (SELECT COUNT(*)::text FROM thesis_monitor_plans
              WHERE workspace_id = $1 AND scheduler_enabled = true AND status = 'active'
                AND (COALESCE(next_pulse_due_at, now()) <= now()
                  OR COALESCE(next_memo_due_at, now()) <= now())) AS due_plans,
             (SELECT MAX(created_at) FROM monitoring_jobs
              WHERE workspace_id = $1 AND job_type IN ('thesis_pulse_run', 'thesis_pulse_memo_run')) AS last_enqueue_at,
             (SELECT error_message FROM monitoring_jobs
              WHERE workspace_id = $1
                AND job_type IN ('thesis_pulse_run', 'thesis_pulse_memo_run')
                AND status IN ('failed', 'dead_letter')
              ORDER BY updated_at DESC LIMIT 1) AS last_enqueue_error`,
          [workspaceId],
        ),
        pool.query<{
          active_workers: string;
          last_success_at: Date | string | null;
          last_error_at: Date | string | null;
          recent_error_types: unknown;
        }>(
          `SELECT
             COUNT(DISTINCT locked_by) FILTER (WHERE status = 'running' AND locked_by IS NOT NULL)::text AS active_workers,
             MAX(completed_at) FILTER (WHERE status = 'succeeded') AS last_success_at,
             MAX(updated_at) FILTER (WHERE status IN ('failed', 'dead_letter')) AS last_error_at,
             COALESCE(jsonb_agg(DISTINCT error_type) FILTER (WHERE error_type IS NOT NULL), '[]'::jsonb) AS recent_error_types
           FROM monitoring_jobs
           WHERE workspace_id = $1`,
          [workspaceId],
        ),
        pool.query<{
          last_run_at: Date | string | null;
          last_deleted_counts: unknown;
          last_error: string | null;
        }>(
          `SELECT
             completed_at AS last_run_at,
             jsonb_build_object(
               'deleted_pulses', deleted_pulses,
               'deleted_memos', deleted_memos,
               'deleted_jobs', deleted_jobs,
               'dry_run', dry_run
             ) AS last_deleted_counts,
             error AS last_error
           FROM monitoring_retention_runs
           WHERE workspace_id = $1
           ORDER BY started_at DESC
           LIMIT 1`,
          [workspaceId],
        ),
        pool.query<{
          recent_calls: string;
          failed_calls: string;
          average_latency_ms: string | null;
        }>(
          `SELECT
             COUNT(*)::text AS recent_calls,
             COUNT(*) FILTER (WHERE status NOT IN ('success', 'ok'))::text AS failed_calls,
             AVG(latency_ms)::text AS average_latency_ms
           FROM llm_calls c
           LEFT JOIN trade_theses t ON t.id = c.thesis_id
           WHERE COALESCE(t.workspace_id, $1) = $1
             AND COALESCE(c.stage, '') IN ('pulse_memo', 'thesis_pulse_memo', 'memo')`,
          [workspaceId],
        ),
      ]);
    const queueRow = queue.rows[0];
    const schedulerRow = scheduler.rows[0];
    const workersRow = workers.rows[0];
    const retentionRow = retention.rows[0];
    const memoRow = memoHealth.rows[0];
    const recentCalls = integerValue(memoRow?.recent_calls, 0);
    const failedCalls = integerValue(memoRow?.failed_calls, 0);
    return {
      monitoring_queue: {
        queued: integerValue(queueRow?.queued, 0),
        running: integerValue(queueRow?.running, 0),
        failed: integerValue(queueRow?.failed, 0),
        dead_letter: integerValue(queueRow?.dead_letter, 0),
        oldest_queued_at: isoStringOrNull(queueRow?.oldest_queued_at),
      },
      monitoring_scheduler: {
        enabled_plans: integerValue(schedulerRow?.enabled_plans, 0),
        due_plans: integerValue(schedulerRow?.due_plans, 0),
        last_enqueue_at: isoStringOrNull(schedulerRow?.last_enqueue_at),
        last_enqueue_error: schedulerRow?.last_enqueue_error ?? null,
      },
      monitoring_workers: {
        active_workers: integerValue(workersRow?.active_workers, 0),
        last_success_at: isoStringOrNull(workersRow?.last_success_at),
        last_error_at: isoStringOrNull(workersRow?.last_error_at),
        recent_error_types: arrayFromUnknown(workersRow?.recent_error_types),
      },
      monitoring_retention: {
        last_run_at: isoStringOrNull(retentionRow?.last_run_at),
        last_deleted_counts: recordOrDefault(
          retentionRow?.last_deleted_counts,
          {
            deleted_pulses: 0,
            deleted_memos: 0,
            deleted_jobs: 0,
            dry_run: true,
          },
        ),
        last_error: retentionRow?.last_error ?? null,
      },
      llm_memo_health: {
        recent_calls: recentCalls,
        failure_rate: recentCalls > 0 ? failedCalls / recentCalls : null,
        average_latency_ms: numberValue(memoRow?.average_latency_ms),
      },
    };
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
      metadata: metrics.metadata ?? {},
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

  async getOutcomeReview(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
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
       WHERE o.id = $1 AND t.workspace_id = $2`,
      [id, workspaceId],
    );
  }

  async getSignal(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT s.payload_json || jsonb_build_object(
         'id', s.id,
         'workspace_id', s.workspace_id,
         'research_run_id', snapshot_ref.research_run_id,
         'signal_snapshot_id', snapshot_ref.signal_snapshot_id,
         'symbol', s.symbol,
         'signal_type', s.signal_type,
         'direction', s.direction,
         'confidence', s.confidence,
         'observed_at', s.observed_at,
         'source', s.source,
         'source_timestamp', s.source_timestamp,
         'payload', s.payload_json
       ) AS payload_json
       FROM signals s
       LEFT JOIN LATERAL (
         SELECT
           ss.id AS signal_snapshot_id,
           ss.research_run_id
         FROM signal_snapshots ss
         WHERE ss.workspace_id = s.workspace_id
           AND ss.payload_json->'signal_ids' ? s.id
         ORDER BY ss.captured_at DESC, ss.id DESC
         LIMIT 1
       ) snapshot_ref ON true
       WHERE s.id = $1 AND s.workspace_id = $2`,
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
        `SELECT s.payload_json || jsonb_build_object(
           'id', s.id,
           'workspace_id', s.workspace_id,
           'research_run_id', snapshot_ref.research_run_id,
           'signal_snapshot_id', snapshot_ref.signal_snapshot_id,
           'symbol', s.symbol,
           'signal_type', s.signal_type,
           'direction', s.direction,
           'confidence', s.confidence,
           'observed_at', s.observed_at,
           'source', s.source,
           'source_timestamp', s.source_timestamp
         ) AS payload_json
         FROM signals s
         LEFT JOIN LATERAL (
           SELECT
             ss.id AS signal_snapshot_id,
             ss.research_run_id
           FROM signal_snapshots ss
           WHERE ss.workspace_id = s.workspace_id
             AND ss.payload_json->'signal_ids' ? s.id
           ORDER BY ss.captured_at DESC, ss.id DESC
           LIMIT 1
         ) snapshot_ref ON true
         WHERE s.workspace_id = $1 AND s.symbol = $2
         ORDER BY s.observed_at DESC
         LIMIT $3`,
        [workspaceId, symbol, limit],
      );
    }
    return this.many(
      `SELECT s.payload_json || jsonb_build_object(
         'id', s.id,
         'workspace_id', s.workspace_id,
         'research_run_id', snapshot_ref.research_run_id,
         'signal_snapshot_id', snapshot_ref.signal_snapshot_id,
         'symbol', s.symbol,
         'signal_type', s.signal_type,
         'direction', s.direction,
         'confidence', s.confidence,
         'observed_at', s.observed_at,
         'source', s.source,
         'source_timestamp', s.source_timestamp
       ) AS payload_json
       FROM signals s
       LEFT JOIN LATERAL (
         SELECT
           ss.id AS signal_snapshot_id,
           ss.research_run_id
         FROM signal_snapshots ss
         WHERE ss.workspace_id = s.workspace_id
           AND ss.payload_json->'signal_ids' ? s.id
         ORDER BY ss.captured_at DESC, ss.id DESC
         LIMIT 1
       ) snapshot_ref ON true
       WHERE s.workspace_id = $1
       ORDER BY s.observed_at DESC
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

  async removeWatchlist(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id, workspace_id, name
         FROM watchlists
         WHERE id = $1 AND workspace_id = $2
         FOR UPDATE`,
        [id, workspaceId],
      );
      const watchlist = existing.rows[0];
      if (!watchlist) {
        throw new NotFoundException(`Watchlist ${id} not found`);
      }
      const items = await client.query(
        `SELECT id
         FROM watchlist_items
         WHERE watchlist_id = $1 AND workspace_id = $2`,
        [id, workspaceId],
      );
      const itemIds = items.rows
        .map((row) => nullableString(row.id))
        .filter((itemId): itemId is string => itemId !== null);
      if (itemIds.length > 0) {
        await client.query(
          `UPDATE alerts
           SET watchlist_item_id = NULL,
               payload_json = payload_json || jsonb_build_object('watchlist_item_removed', true)
           WHERE workspace_id = $1 AND watchlist_item_id = ANY($2::text[])`,
          [workspaceId, itemIds],
        );
      }
      await client.query(
        `DELETE FROM watchlist_items
         WHERE watchlist_id = $1 AND workspace_id = $2`,
        [id, workspaceId],
      );
      await client.query(
        `DELETE FROM watchlists
         WHERE id = $1 AND workspace_id = $2`,
        [id, workspaceId],
      );
      await client.query('COMMIT');
      return {
        id,
        workspace_id: workspaceId,
        name: stringValue(watchlist.name, ''),
        removed: true,
        removed_item_count: itemIds.length,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
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

function integerValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function jsonArrayParam(value: unknown): string {
  const parsed = parseJsonValue(value);
  return JSON.stringify(Array.isArray(parsed) ? parsed : []);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isoStringOrNull(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function addDaysIso(value: string, days: number): string {
  return new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
}

function arrayFromUnknown(value: unknown): unknown[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

function recordOrDefault(
  value: unknown,
  fallback: JsonRecord,
): JsonRecord {
  const parsed = parseJsonValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as JsonRecord;
  }
  return fallback;
}

async function countRetentionCandidates(
  client: PoolClient,
  sql: string,
  params: unknown[],
): Promise<number> {
  const result = await client.query<{ count: number | string }>(sql, params);
  return integerValue(result.rows[0]?.count, 0);
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

function researchSnapshotPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'research_run_id', ${p}research_run_id,
    'symbol', ${p}symbol,
    'captured_at', ${p}captured_at,
    'time_context', ${p}time_context,
    'symbol_view', ${p}symbol_view_json,
    'symbol_view_json', ${p}symbol_view_json,
    'tracked_items', ${p}tracked_items_json,
    'tracked_items_json', ${p}tracked_items_json,
    'data_quality', ${p}data_quality_json,
    'data_quality_json', ${p}data_quality_json,
    'source_artifacts', ${p}source_artifacts_json,
    'source_artifacts_json', ${p}source_artifacts_json,
    'payload', ${p}payload_json
  )`;
}

function researchContinuityEntryPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'symbol', ${p}symbol,
    'research_run_id', ${p}research_run_id,
    'current_snapshot_id', ${p}current_snapshot_id,
    'previous_entry_id', ${p}previous_entry_id,
    'entry_type', ${p}entry_type,
    'status', ${p}status,
    'generated_at', ${p}generated_at,
    'summary', ${p}summary,
    'sections', ${p}sections_json,
    'sections_json', ${p}sections_json,
    'events', ${p}events_json,
    'events_json', ${p}events_json,
    'snapshot_quality', ${p}snapshot_quality_json,
    'snapshot_quality_json', ${p}snapshot_quality_json,
    'source_run_ids', ${p}source_run_ids_json,
    'source_run_ids_json', ${p}source_run_ids_json,
    'writer_metadata', ${p}writer_metadata_json,
    'writer_metadata_json', ${p}writer_metadata_json,
    'payload', ${p}payload_json
  )`;
}

function researchContinuityStatePayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'symbol', ${p}symbol,
    'current_snapshot_id', ${p}current_snapshot_id,
    'latest_entry_id', ${p}latest_entry_id,
    'latest_run_id', ${p}latest_run_id,
    'current_view', ${p}current_view_json,
    'current_view_json', ${p}current_view_json,
    'active_items', ${p}active_items_json,
    'active_items_json', ${p}active_items_json,
    'recent_resolved_items', ${p}recent_resolved_items_json,
    'recent_resolved_items_json', ${p}recent_resolved_items_json,
    'recent_invalidated_items', ${p}recent_invalidated_items_json,
    'recent_invalidated_items_json', ${p}recent_invalidated_items_json,
    'data_quality', ${p}data_quality_json,
    'data_quality_json', ${p}data_quality_json,
    'updated_at', ${p}updated_at,
    'payload', ${p}payload_json
  )`;
}

function evaluationPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'thesis_id', ${p}thesis_id,
    'outcome_review_id', ${p}outcome_review_id,
    'symbol', ${p}symbol,
    'window_days', ${p}window_days,
    'evaluation_start', ${p}evaluation_start,
    'evaluation_end', ${p}evaluation_end,
    'evaluated_at', ${p}evaluated_at,
    'result', ${p}result,
    'max_favorable_excursion', ${p}max_favorable_excursion,
    'max_adverse_excursion', ${p}max_adverse_excursion,
    'invalidated', ${p}invalidated,
    'warnings', ${p}warnings_json,
    'warnings_json', ${p}warnings_json,
    'evidence', ${p}evidence_json,
    'evidence_json', ${p}evidence_json,
    'payload', ${p}payload_json
  )`;
}

function evaluationRunPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'canonical_evaluation_id', ${p}canonical_evaluation_id,
    'thesis_id', ${p}thesis_id,
    'symbol', ${p}symbol,
    'window_days', ${p}window_days,
    'evaluation_start', ${p}evaluation_start,
    'evaluation_end', ${p}evaluation_end,
    'requested_by_user_id', ${p}requested_by_user_id,
    'requested_at', ${p}requested_at,
    'evaluated_at', ${p}evaluated_at,
    'source', ${p}source,
    'reason', ${p}reason,
    'notes', ${p}notes,
    'idempotency_key', ${p}idempotency_key,
    'status', ${p}status,
    'result', ${p}result,
    'max_favorable_excursion', ${p}max_favorable_excursion,
    'max_adverse_excursion', ${p}max_adverse_excursion,
    'invalidated', ${p}invalidated,
    'warnings', ${p}warnings_json,
    'warnings_json', ${p}warnings_json,
    'evidence', ${p}evidence_json,
    'evidence_json', ${p}evidence_json,
    'diff', ${p}diff_json,
    'diff_json', ${p}diff_json,
    'error_type', ${p}error_type,
    'error_message', ${p}error_message,
    'payload', ${p}payload_json
  )`;
}

function evaluationPromotionPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'canonical_evaluation_id', ${p}canonical_evaluation_id,
    'promoted_rerun_id', ${p}promoted_rerun_id,
    'action', ${p}action,
    'promoted_by_user_id', ${p}promoted_by_user_id,
    'promoted_at', ${p}promoted_at,
    'reason', ${p}reason,
    'notes', ${p}notes,
    'idempotency_key', ${p}idempotency_key,
    'payload', ${p}payload_json
  )`;
}

function monitorPlanPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'thesis_id', ${p}thesis_id,
    'baseline_run_id', ${p}baseline_run_id,
    'symbol', ${p}symbol,
    'market_type', ${p}market_type,
    'status', ${p}status,
    'created_at', ${p}created_at,
    'updated_at', ${p}updated_at,
    'baseline_price', ${p}baseline_price,
    'baseline_price_source', ${p}baseline_price_source,
    'baseline_observed_at', ${p}baseline_observed_at,
    'entry_low', ${p}entry_low,
    'entry_high', ${p}entry_high,
    'invalidation_level', ${p}invalidation_level,
    'invalidation_direction', ${p}invalidation_direction,
    'targets', ${p}targets_json,
    'targets_json', ${p}targets_json,
    'scenario_triggers', ${p}scenario_triggers_json,
    'scenario_triggers_json', ${p}scenario_triggers_json,
    'missing_fields', ${p}missing_fields_json,
    'missing_fields_json', ${p}missing_fields_json,
    'price_interval_minutes', ${p}price_interval_minutes,
    'signal_interval_minutes', ${p}signal_interval_minutes,
    'memo_interval_minutes', ${p}memo_interval_minutes,
    'watch_distance_pct', ${p}watch_distance_pct,
    'review_distance_pct', ${p}review_distance_pct,
    'consecutive_review_to_rerun', ${p}consecutive_review_to_rerun,
    'consecutive_invalidation_to_rerun', ${p}consecutive_invalidation_to_rerun,
    'run_memo_on_review', ${p}run_memo_on_review,
    'run_memo_on_rerun_full', ${p}run_memo_on_rerun_full,
    'skip_memo_if_no_new_pulses', ${p}skip_memo_if_no_new_pulses,
    'enabled_signal_factors', ${p}enabled_signal_factors_json,
    'enabled_signal_factors_json', ${p}enabled_signal_factors_json,
    'scheduler_enabled', ${p}scheduler_enabled,
    'latest_pulse_id', ${p}latest_pulse_id,
    'latest_memo_id', ${p}latest_memo_id,
    'latest_status', ${p}latest_status,
    'latest_price', ${p}latest_price,
    'latest_trigger_reasons', ${p}latest_trigger_reasons_json,
    'latest_trigger_reasons_json', ${p}latest_trigger_reasons_json,
    'last_pulse_at', ${p}last_pulse_at,
    'next_pulse_due_at', ${p}next_pulse_due_at,
    'last_memo_at', ${p}last_memo_at,
    'next_memo_due_at', ${p}next_memo_due_at,
    'payload', ${p}payload_json
  )`;
}

function pulsePayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'thesis_id', ${p}thesis_id,
    'monitor_plan_id', ${p}monitor_plan_id,
    'baseline_run_id', ${p}baseline_run_id,
    'symbol', ${p}symbol,
    'market_type', ${p}market_type,
    'pulse_type', ${p}pulse_type,
    'bucket_start', ${p}bucket_start,
    'observed_at', ${p}observed_at,
    'current_price', ${p}current_price,
    'baseline_price', ${p}baseline_price,
    'price_change_pct', ${p}price_change_pct,
    'distance_to_entry_pct', ${p}distance_to_entry_pct,
    'distance_to_invalidation_pct', ${p}distance_to_invalidation_pct,
    'nearest_target', ${p}nearest_target,
    'distance_to_nearest_target_pct', ${p}distance_to_nearest_target_pct,
    'signal_bias', ${p}signal_bias,
    'signal_confidence', ${p}signal_confidence,
    'signal_delta', ${p}signal_delta,
    'scenario_status', ${p}scenario_status,
    'score', ${p}score,
    'status', ${p}status,
    'suggested_action', ${p}suggested_action,
    'trigger_reasons', ${p}trigger_reasons_json,
    'trigger_reasons_json', ${p}trigger_reasons_json,
    'hard_triggers', ${p}hard_triggers_json,
    'hard_triggers_json', ${p}hard_triggers_json,
    'missing_data', ${p}missing_data_json,
    'missing_data_json', ${p}missing_data_json,
    'payload', ${p}payload_json
  )`;
}

function memoPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'thesis_id', ${p}thesis_id,
    'monitor_plan_id', ${p}monitor_plan_id,
    'baseline_run_id', ${p}baseline_run_id,
    'memo_type', ${p}memo_type,
    'window_start', ${p}window_start,
    'window_end', ${p}window_end,
    'created_at', ${p}created_at,
    'status', ${p}status,
    'summary', ${p}summary,
    'what_changed', ${p}what_changed_json,
    'what_changed_json', ${p}what_changed_json,
    'why_it_matters', ${p}why_it_matters_json,
    'why_it_matters_json', ${p}why_it_matters_json,
    'what_to_watch_next', ${p}what_to_watch_next_json,
    'what_to_watch_next_json', ${p}what_to_watch_next_json,
    'recommended_action', ${p}recommended_action,
    'rerun_full_recommended', ${p}rerun_full_recommended,
    'confidence', ${p}confidence,
    'referenced_pulse_ids', ${p}referenced_pulse_ids_json,
    'referenced_pulse_ids_json', ${p}referenced_pulse_ids_json,
    'prompt_version', ${p}prompt_version,
    'provider', ${p}provider,
    'model', ${p}model,
    'payload', ${p}payload_json
  )`;
}

function monitoringJobPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'thesis_id', ${p}thesis_id,
    'job_type', ${p}job_type,
    'status', ${p}status,
    'priority', ${p}priority,
    'run_after', ${p}run_after,
    'attempt_count', ${p}attempt_count,
    'max_attempts', ${p}max_attempts,
    'locked_at', ${p}locked_at,
    'locked_by', ${p}locked_by,
    'started_at', ${p}started_at,
    'completed_at', ${p}completed_at,
    'error_type', ${p}error_type,
    'error_message', ${p}error_message,
    'idempotency_key', ${p}idempotency_key,
    'request', ${p}request_json,
    'request_json', ${p}request_json,
    'result', ${p}result_json,
    'result_json', ${p}result_json,
    'created_at', ${p}created_at,
    'updated_at', ${p}updated_at
  )`;
}
