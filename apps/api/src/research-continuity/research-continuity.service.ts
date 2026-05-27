import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { normalizeCryptoSymbol } from '../common/market-symbols';
import { ContinuityDeltaEngine } from './continuity-delta.engine';
import { ContinuityReportRenderer } from './continuity-report.renderer';
import { ContinuityStateProjector } from './continuity-state.projector';
import { ResearchSnapshotBuilder } from './research-snapshot.builder';
import {
  GenerateResearchContinuityDto,
  GenerateResearchContinuityResponse,
  ResearchContinuityEntriesResponse,
  ResearchContinuityEntryResponse,
  ResearchContinuityStateEnvelopeResponse,
  ResearchContinuityStateResponse,
  ResearchSnapshotResponse,
} from './dto/research-continuity.dto';

@Injectable()
export class ResearchContinuityService {
  private readonly snapshotBuilder = new ResearchSnapshotBuilder();
  private readonly deltaEngine = new ContinuityDeltaEngine();
  private readonly stateProjector = new ContinuityStateProjector();
  private readonly reportRenderer = new ContinuityReportRenderer();

  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async getRunContinuity(
    runId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityEntryResponse | null> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'viewer',
    );
    await this.getRunOrThrow(runId, workspaceId);
    const entry = await this.journal.getLatestResearchContinuityEntryForRun(
      runId,
      workspaceId,
    );
    return entry ? toEntryResponse(entry) : null;
  }

  async generateForRun(
    runId: string,
    dto: GenerateResearchContinuityDto = {},
    userId?: string,
    workspaceHeader?: string,
  ): Promise<GenerateResearchContinuityResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'editor',
    );
    return this.generateForRunInWorkspace(runId, workspaceId, Boolean(dto.force));
  }

  async generateForCompletedRun(
    runId: string,
    workspaceId: string,
  ): Promise<GenerateResearchContinuityResponse | null> {
    try {
      return await this.generateForRunInWorkspace(runId, workspaceId, false);
    } catch {
      return null;
    }
  }

  async getEntry(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityEntryResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'viewer',
    );
    const entry = await this.journal.getResearchContinuityEntry(id, workspaceId);
    if (!entry) {
      throw new NotFoundException(`Research continuity entry ${id} not found`);
    }
    return toEntryResponse(entry);
  }

  async getSymbolState(
    symbol: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityStateEnvelopeResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'viewer',
    );
    const normalizedSymbol = normalizeContinuitySymbol(symbol);
    const state = await this.journal.getResearchContinuityState(
      normalizedSymbol,
      workspaceId,
    );
    const latestEntryId = nullableString(state?.latest_entry_id);
    const latestEntry = latestEntryId
      ? await this.journal.getResearchContinuityEntry(latestEntryId, workspaceId)
      : null;
    return {
      symbol: normalizedSymbol,
      state: state ? toStateResponse(state) : null,
      latest_entry: latestEntry ? toEntryResponse(latestEntry) : null,
    };
  }

  async listSymbolEntries(
    symbol: string,
    filters: { limit?: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityEntriesResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'viewer',
    );
    const normalizedSymbol = normalizeContinuitySymbol(symbol);
    const entries = await this.journal.listResearchContinuityEntriesBySymbol(
      normalizedSymbol,
      normalizeLimit(filters.limit),
      workspaceId,
    );
    return {
      symbol: normalizedSymbol,
      entries: entries.map(toEntryResponse),
    };
  }

  private async generateForRunInWorkspace(
    runId: string,
    workspaceId: string,
    force: boolean,
  ): Promise<GenerateResearchContinuityResponse> {
    if (!force) {
      const existing = await this.journal.getLatestResearchContinuityEntryForRun(
        runId,
        workspaceId,
      );
      if (existing) {
        return { created: false, entry: toEntryResponse(existing) };
      }
    }

    const run = await this.getRunOrThrow(runId, workspaceId);
    const symbol = normalizeContinuitySymbol(stringValue(run.symbol));
    const previousState = await this.journal.getResearchContinuityState(
      symbol,
      workspaceId,
    );
    const previousEntryId = nullableString(previousState?.latest_entry_id);
    if (!isContinuityEligibleStatus(stringValue(run.status))) {
      const entry = await this.createSkippedEntry({
        run,
        symbol,
        workspaceId,
        previousEntryId,
        reason: 'run_not_completed',
      });
      return { created: true, entry: toEntryResponse(entry) };
    }

    const artifacts = await this.loadArtifacts(run, workspaceId);
    const build = this.snapshotBuilder.build({ run, ...artifacts });
    if (!build.snapshot) {
      const entry = await this.createSkippedEntry({
        run,
        symbol,
        workspaceId,
        previousEntryId,
        reason: build.skippedReason ?? 'insufficient_structured_data',
        quality: build.quality,
      });
      return { created: true, entry: toEntryResponse(entry) };
    }

    const snapshot = await this.journal.saveResearchSnapshot(
      build.snapshot,
      workspaceId,
    );
    const quality = recordValue(snapshot.data_quality ?? build.quality);
    const entryType =
      stringValue(quality.status) === 'degraded'
        ? 'degraded'
        : previousState
          ? 'delta'
          : 'baseline';
    const events = this.deltaEngine.compute(snapshot, previousState);
    const report = this.reportRenderer.render({
      entryType,
      snapshot,
      previousState,
      events,
    });
    const entry = await this.journal.saveResearchContinuityEntry(
      {
        id: `continuity_${safeId(runId)}_${randomUUID().replaceAll('-', '')}`,
        workspace_id: workspaceId,
        symbol,
        research_run_id: runId,
        current_snapshot_id: snapshot.id,
        previous_entry_id: previousEntryId,
        entry_type: entryType,
        status: entryType === 'degraded' ? 'degraded' : 'completed',
        generated_at: new Date().toISOString(),
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: quality,
        source_run_ids: [runId, nullableString(previousState?.latest_run_id)].filter(
          (id): id is string => Boolean(id),
        ),
        writer_metadata: report.writerMetadata,
        payload: {
          schema_version: 'research_continuity_entry.v1',
          deterministic: true,
        },
      },
      workspaceId,
    );
    const nextState = this.stateProjector.project(
      previousState,
      snapshot,
      entry,
      events,
    );
    if (nextState) {
      await this.journal.saveResearchContinuityState(nextState, workspaceId);
    }
    return { created: true, entry: toEntryResponse(entry) };
  }

  private async createSkippedEntry(input: {
    run: JsonRecord;
    symbol: string;
    workspaceId: string;
    previousEntryId: string | null;
    reason: string;
    quality?: JsonRecord;
  }): Promise<JsonRecord> {
    const runId = stringValue(input.run.id ?? input.run.run_id);
    const quality =
      input.quality ??
      ({
        score: 0,
        status: 'skipped',
        reasons: [input.reason],
        can_update_top_level_view: false,
      } satisfies JsonRecord);
    const events = [
      {
        event_type: 'continuity_skipped',
        severity: 'medium',
        from: null,
        to: null,
        item_key: null,
        reason: input.reason,
      },
    ];
    const report = this.reportRenderer.render({
      entryType: 'skipped',
      snapshot: null,
      previousState: null,
      events,
      skippedReason: input.reason,
    });
    return this.journal.saveResearchContinuityEntry(
      {
        id: `continuity_${safeId(runId)}_${randomUUID().replaceAll('-', '')}`,
        workspace_id: input.workspaceId,
        symbol: input.symbol,
        research_run_id: runId,
        current_snapshot_id: null,
        previous_entry_id: input.previousEntryId,
        entry_type: 'skipped',
        status: 'skipped',
        generated_at: new Date().toISOString(),
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: quality,
        source_run_ids: [runId],
        writer_metadata: report.writerMetadata,
        payload: {
          schema_version: 'research_continuity_entry.v1',
          skip_reason: input.reason,
        },
      },
      input.workspaceId,
    );
  }

  private async loadArtifacts(
    run: JsonRecord,
    workspaceId: string,
  ): Promise<{
    debate: JsonRecord | null;
    agentOpinions: JsonRecord[];
    thesis: JsonRecord | null;
    marketSnapshot: JsonRecord | null;
    signalSnapshot: JsonRecord | null;
  }> {
    const debateId = nullableString(run.debate_id);
    const thesisId = nullableString(run.thesis_id);
    const marketSnapshotId = nullableString(run.market_snapshot_id);
    const signalSnapshotId = nullableString(run.signal_snapshot_id);
    const [debate, thesis, marketSnapshot, signalSnapshot] = await Promise.all([
      debateId
        ? this.journal.getDebate(debateId, workspaceId)
        : Promise.resolve(null),
      thesisId
        ? this.journal.getThesis(thesisId, workspaceId)
        : Promise.resolve(null),
      marketSnapshotId
        ? this.journal.getMarketSnapshot(marketSnapshotId, workspaceId)
        : Promise.resolve(null),
      signalSnapshotId
        ? this.journal.getSignalSnapshot(signalSnapshotId, workspaceId)
        : Promise.resolve(null),
    ]);
    const agentOpinions = debateId
      ? await this.journal.listAgentOpinions(debateId, workspaceId)
      : [];
    return {
      debate,
      agentOpinions,
      thesis,
      marketSnapshot,
      signalSnapshot,
    };
  }

  private async getRunOrThrow(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const run = await this.journal.getResearchRun(runId, workspaceId);
    if (!run) {
      throw new NotFoundException(`Research run ${runId} not found`);
    }
    return run;
  }

  private async resolveWorkspaceAccess(
    userId: string | undefined,
    workspaceHeader: string | undefined,
    requiredRole: 'viewer' | 'editor',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }
}

function toEntryResponse(entry: JsonRecord): ResearchContinuityEntryResponse {
  return {
    id: nullableString(entry.id),
    workspace_id: stringValue(entry.workspace_id, 'local'),
    symbol: stringValue(entry.symbol),
    research_run_id: stringValue(entry.research_run_id),
    current_snapshot_id: nullableString(entry.current_snapshot_id),
    previous_entry_id: nullableString(entry.previous_entry_id),
    entry_type: entryTypeValue(entry.entry_type),
    status: entryStatusValue(entry.status),
    generated_at: nullableString(entry.generated_at),
    summary: stringValue(entry.summary),
    sections: arrayRecords(entry.sections).map((section) => ({
      title: stringValue(section.title),
      items: stringList(section.items),
      empty_state: stringValue(section.empty_state),
    })),
    events: arrayRecords(entry.events),
    snapshot_quality: recordValue(entry.snapshot_quality),
    source_run_ids: stringList(entry.source_run_ids),
    writer_metadata: recordValue(entry.writer_metadata),
    payload: recordValue(entry.payload ?? entry.payload_json),
  };
}

function toStateResponse(state: JsonRecord): ResearchContinuityStateResponse {
  return {
    id: nullableString(state.id),
    workspace_id: stringValue(state.workspace_id, 'local'),
    symbol: stringValue(state.symbol),
    current_snapshot_id: nullableString(state.current_snapshot_id),
    latest_entry_id: nullableString(state.latest_entry_id),
    latest_run_id: nullableString(state.latest_run_id),
    current_view: recordValue(state.current_view),
    active_items: arrayRecords(state.active_items),
    recent_resolved_items: arrayRecords(state.recent_resolved_items),
    recent_invalidated_items: arrayRecords(state.recent_invalidated_items),
    data_quality: recordValue(state.data_quality),
    updated_at: nullableString(state.updated_at),
    payload: recordValue(state.payload ?? state.payload_json),
  };
}

export function toSnapshotResponse(snapshot: JsonRecord): ResearchSnapshotResponse {
  return {
    id: nullableString(snapshot.id),
    workspace_id: stringValue(snapshot.workspace_id, 'local'),
    research_run_id: stringValue(snapshot.research_run_id),
    symbol: stringValue(snapshot.symbol),
    captured_at: nullableString(snapshot.captured_at),
    time_context: stringValue(snapshot.time_context, 'unspecified'),
    symbol_view: recordValue(snapshot.symbol_view),
    tracked_items: arrayRecords(snapshot.tracked_items),
    data_quality: recordValue(snapshot.data_quality),
    source_artifacts: recordValue(snapshot.source_artifacts),
    payload: recordValue(snapshot.payload ?? snapshot.payload_json),
  };
}

function entryTypeValue(value: unknown): ResearchContinuityEntryResponse['entry_type'] {
  const normalized = stringValue(value);
  return ['baseline', 'delta', 'degraded', 'skipped'].includes(normalized)
    ? (normalized as ResearchContinuityEntryResponse['entry_type'])
    : 'skipped';
}

function entryStatusValue(value: unknown): ResearchContinuityEntryResponse['status'] {
  const normalized = stringValue(value);
  return ['completed', 'degraded', 'skipped', 'failed'].includes(normalized)
    ? (normalized as ResearchContinuityEntryResponse['status'])
    : 'failed';
}

function isContinuityEligibleStatus(status: string): boolean {
  return status === 'completed' || status === 'completed_degraded';
}

function normalizeContinuitySymbol(symbol: string): string {
  return normalizeCryptoSymbol(symbol);
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 20;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const text = nullableString(value);
    return text ? [text] : [];
  }
  return value
    .map((item) => nullableString(item))
    .filter((item): item is string => Boolean(item));
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_');
}
