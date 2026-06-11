import {
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  AgentCalibrationSourceFilters,
  ContinuityRepairIdentity,
  ContinuityRepairRunFilters,
  JournalRepository,
  JsonRecord,
  MaturedEvaluationThesisFilters,
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

  async listResearchRunsForContinuityRepair(
    filters: ContinuityRepairRunFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const where = [
      'workspace_id = $1',
      "status IN ('completed', 'completed_degraded')",
    ];
    const params: unknown[] = [workspaceId];
    if (filters.symbol) {
      params.push(filters.symbol);
      where.push(`symbol = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`COALESCE(completed_at, started_at) >= $${params.length}::timestamptz`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`COALESCE(completed_at, started_at) <= $${params.length}::timestamptz`);
    }
    params.push(filters.limit);
    return this.many(
      `SELECT ${researchRunPayloadSql()} AS payload_json
       FROM research_runs
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(completed_at, started_at) ASC, id ASC
       LIMIT $${params.length}`,
      params,
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

  async getLatestResearchContinuityEntryBeforeRun(
    symbol: string,
    before: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${researchContinuityEntryPayloadSql('entry')} AS payload_json
       FROM research_continuity_entries entry
       JOIN research_runs run
         ON run.id = entry.research_run_id
        AND run.workspace_id = entry.workspace_id
       WHERE entry.workspace_id = $1
         AND entry.symbol = $2
         AND COALESCE(run.completed_at, run.started_at) < $3::timestamptz
         AND entry.current_snapshot_id IS NOT NULL
         AND entry.status IN ('completed', 'degraded')
       ORDER BY COALESCE(run.completed_at, run.started_at) DESC,
                entry.generated_at DESC,
                entry.id DESC
       LIMIT 1`,
      [workspaceId, symbol, before],
    );
  }

  async getLatestCompletedResearchRunForContinuity(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${researchRunPayloadSql()} AS payload_json
       FROM research_runs
       WHERE workspace_id = $1
         AND symbol = $2
         AND status IN ('completed', 'completed_degraded')
       ORDER BY COALESCE(completed_at, started_at) DESC, id DESC
       LIMIT 1`,
      [workspaceId, symbol],
    );
  }

  async findResearchContinuityRepairEntry(
    identity: ContinuityRepairIdentity,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.one(
      `SELECT ${researchContinuityEntryPayloadSql()} AS payload_json
       FROM research_continuity_entries
       WHERE workspace_id = $1
         AND research_run_id = $2
         AND COALESCE(
           payload_json#>>'{payload,repair,repair_version}',
           payload_json#>>'{repair,repair_version}'
         ) = $3
         AND COALESCE(
           payload_json#>>'{payload,repair,case_type}',
           payload_json#>>'{repair,case_type}'
         ) = $4
         AND COALESCE(
           payload_json#>>'{payload,repair,source_entry_id}',
           payload_json#>>'{repair,source_entry_id}',
           ''
         ) = COALESCE($5, '')
       ORDER BY generated_at DESC, id DESC
       LIMIT 1`,
      [
        workspaceId,
        identity.runId,
        identity.repairVersion,
        identity.caseType,
        identity.sourceEntryId ?? '',
      ],
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
       ORDER BY CASE payload_json->>'horizon'
         WHEN 'short_term' THEN 1
         WHEN 'mid_term' THEN 2
         WHEN 'long_term' THEN 3
         ELSE 4
       END, id ASC`,
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
       LEFT JOIN research_runs rr
         ON rr.workspace_id = s.workspace_id
        AND rr.id = snapshot_ref.research_run_id
       WHERE s.id = $1 AND s.workspace_id = $2
         AND (
           snapshot_ref.research_run_id IS NULL OR
           rr.status IN ('completed', 'completed_degraded')
         )`,
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
         LEFT JOIN research_runs rr
           ON rr.workspace_id = s.workspace_id
          AND rr.id = snapshot_ref.research_run_id
         WHERE s.workspace_id = $1 AND s.symbol = $2
           AND (
             snapshot_ref.research_run_id IS NULL OR
             rr.status IN ('completed', 'completed_degraded')
           )
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
       LEFT JOIN research_runs rr
         ON rr.workspace_id = s.workspace_id
        AND rr.id = snapshot_ref.research_run_id
       WHERE s.workspace_id = $1
         AND (
           snapshot_ref.research_run_id IS NULL OR
           rr.status IN ('completed', 'completed_degraded')
         )
       ORDER BY s.observed_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
  }

  async summarizeSignals(
    symbol: string | undefined,
    workspaceId: string,
  ): Promise<SignalSummary> {
    const where = ['s.workspace_id = $1'];
    const params: unknown[] = [workspaceId];
    if (symbol) {
      params.push(symbol);
      where.push(`s.symbol = $${params.length}`);
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
         FROM signals s
         LEFT JOIN LATERAL (
           SELECT ss.research_run_id
           FROM signal_snapshots ss
           WHERE ss.workspace_id = s.workspace_id
             AND ss.payload_json->'signal_ids' ? s.id
           ORDER BY ss.captured_at DESC, ss.id DESC
           LIMIT 1
         ) snapshot_ref ON true
         LEFT JOIN research_runs rr
           ON rr.workspace_id = s.workspace_id
          AND rr.id = snapshot_ref.research_run_id
         WHERE ${where.join(' AND ')}
           AND (
             snapshot_ref.research_run_id IS NULL OR
             rr.status IN ('completed', 'completed_degraded')
           )
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

function researchRunPayloadSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}payload_json || jsonb_build_object(
    'id', ${p}id,
    'workspace_id', ${p}workspace_id,
    'symbol', ${p}symbol,
    'asset_class', ${p}asset_class,
    'timeframe', ${p}timeframe,
    'status', ${p}status,
    'started_at', ${p}started_at,
    'completed_at', ${p}completed_at,
    'market_snapshot_id', ${p}market_snapshot_id,
    'signal_snapshot_id', ${p}signal_snapshot_id,
    'debate_id', ${p}debate_id,
    'thesis_id', ${p}thesis_id,
    'decision_id', ${p}decision_id,
    'user_decision_id', ${p}user_decision_id,
    'outcome_review_id', ${p}outcome_review_id,
    'degradation_reasons', ${p}degradation_reasons_json,
    'missing_core_data', ${p}missing_core_data_json,
    'missing_optional_data', ${p}missing_optional_data_json
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
