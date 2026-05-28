import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import {
  ResearchSnapshotBuilder,
  ResearchSnapshotBuildResult,
} from './research-snapshot.builder';
import {
  GenerateResearchContinuityDto,
  GenerateResearchContinuityResponse,
  RESEARCH_CONTINUITY_REPAIR_CASE_TYPES,
  RESEARCH_CONTINUITY_REPAIR_VERSION,
  ResearchContinuityEntriesResponse,
  ResearchContinuityEntryResponse,
  ResearchContinuityRepairCandidateResponse,
  ResearchContinuityRepairCaseType,
  ResearchContinuityRepairPreviewFilters,
  ResearchContinuityRepairPreviewResponse,
  ResearchContinuityRepairRunResponse,
  ResearchContinuityRepairRunResultResponse,
  ResearchContinuityStateEnvelopeResponse,
  ResearchContinuityStateResponse,
  ResearchSnapshotResponse,
  RunResearchContinuityRepairDto,
} from './dto/research-continuity.dto';

interface NormalizedRepairFilters {
  symbol?: string;
  from?: string;
  to?: string;
  caseTypes: ResearchContinuityRepairCaseType[];
  limit: number;
}

interface RepairCandidate extends ResearchContinuityRepairCandidateResponse {
  run: JsonRecord;
  currentEntry: JsonRecord | null;
  sourceEntryId: string | null;
}

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

  async previewRepair(
    filters: ResearchContinuityRepairPreviewFilters,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityRepairPreviewResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'editor',
    );
    const normalized = normalizeRepairFilters(filters, false);
    const candidates = await this.discoverRepairCandidates(
      normalized,
      workspaceId,
    );
    return {
      dry_run: true,
      candidate_count: candidates.length,
      candidates: candidates.map(toRepairCandidateResponse),
    };
  }

  async runRepair(
    dto: RunResearchContinuityRepairDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityRepairRunResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'editor',
    );
    const normalized = normalizeRepairFilters(dto, true);
    const dryRun = dto.dry_run !== false;
    const candidates = await this.discoverRepairCandidates(
      normalized,
      workspaceId,
    );
    const results: ResearchContinuityRepairRunResultResponse[] = [];
    for (const candidate of candidates) {
      if (dryRun) {
        results.push(toDryRunResult(candidate));
        continue;
      }
      results.push(await this.executeRepairCandidate(candidate, workspaceId, userId));
    }
    return {
      dry_run: dryRun,
      requested_count: results.length,
      repaired_count: results.filter(
        (result) => result.action === 'created_repair_entry',
      ).length,
      skipped_count: results.filter((result) =>
        [
          'already_repaired',
          'already_has_continuity',
          'dry_run',
          'not_eligible',
          'not_improved',
        ].includes(result.action),
      ).length,
      failed_count: results.filter((result) => result.action === 'failed').length,
      results,
    };
  }

  private async discoverRepairCandidates(
    filters: NormalizedRepairFilters,
    workspaceId: string,
  ): Promise<RepairCandidate[]> {
    const runs = await this.journal.listResearchRunsForContinuityRepair(
      {
        symbol: filters.symbol,
        from: filters.from,
        to: filters.to,
        limit: filters.limit,
      },
      workspaceId,
    );
    const candidates: RepairCandidate[] = [];
    for (const run of runs) {
      const runId = stringValue(run.id ?? run.run_id);
      if (!runId) {
        continue;
      }
      const currentEntry =
        await this.journal.getLatestResearchContinuityEntryForRun(
          runId,
          workspaceId,
        );
      for (const caseType of filters.caseTypes) {
        candidates.push(
          await this.evaluateRepairCandidate(run, currentEntry, caseType, workspaceId),
        );
      }
    }
    return candidates;
  }

  private async evaluateRepairCandidate(
    run: JsonRecord,
    currentEntry: JsonRecord | null,
    caseType: ResearchContinuityRepairCaseType,
    workspaceId: string,
  ): Promise<RepairCandidate> {
    const runId = stringValue(run.id ?? run.run_id);
    const symbol = normalizeContinuitySymbol(stringValue(run.symbol));
    const runCompletedAt = runTimestamp(run);
    const sourceEntryId =
      caseType === 'missing_continuity'
        ? null
        : nullableString(currentEntry?.id);
    const repaired = await this.journal.findResearchContinuityRepairEntry(
      {
        runId,
        caseType,
        repairVersion: RESEARCH_CONTINUITY_REPAIR_VERSION,
        sourceEntryId,
      },
      workspaceId,
    );
    const candidateId = repairIdentityKey(runId, caseType, sourceEntryId);
    const base = {
      candidate_id: candidateId,
      run_id: runId,
      symbol,
      run_completed_at: runCompletedAt,
      case_type: caseType,
      current_entry_id: nullableString(currentEntry?.id),
      current_entry_status: nullableString(currentEntry?.status),
      current_entry_type: nullableString(currentEntry?.entry_type),
      repair_version:
        RESEARCH_CONTINUITY_REPAIR_VERSION as typeof RESEARCH_CONTINUITY_REPAIR_VERSION,
      run,
      currentEntry,
      sourceEntryId,
    };

    if (repaired) {
      return {
        ...base,
        eligible: false,
        reason: 'Repair entry already exists for this deterministic repair identity.',
        blocked_reason: 'already_repaired',
        predicted_action: 'already_repaired',
      };
    }

    if (caseType === 'missing_continuity') {
      if (currentEntry) {
        return {
          ...base,
          eligible: false,
          reason: 'Run already has a continuity entry.',
          blocked_reason: 'already_has_continuity',
          predicted_action: 'already_has_continuity',
        };
      }
      const build = await this.buildSnapshotForRun(run, workspaceId);
      return {
        ...base,
        eligible: true,
        reason: build.snapshot
          ? 'Completed run has no continuity entry and can be backfilled.'
          : `Completed run has no continuity entry; repair would record ${build.skippedReason ?? 'insufficient_structured_data'}.`,
        blocked_reason: null,
        predicted_action: 'create_repair_entry',
      };
    }

    if (!currentEntry) {
      return {
        ...base,
        eligible: false,
        reason: 'Run has no continuity entry for this repair case.',
        blocked_reason: 'missing_current_entry',
        predicted_action: 'not_eligible',
      };
    }

    if (caseType === 'skipped_or_degraded') {
      const currentStatus = stringValue(currentEntry.status);
      if (!['skipped', 'degraded'].includes(currentStatus)) {
        return {
          ...base,
          eligible: false,
          reason: 'Latest continuity entry is not skipped or degraded.',
          blocked_reason: 'current_entry_not_skipped_or_degraded',
          predicted_action: 'not_eligible',
        };
      }
      const build = await this.buildSnapshotForRun(run, workspaceId);
      if (!build.snapshot) {
        return {
          ...base,
          eligible: false,
          reason: `Snapshot builder still cannot produce continuity: ${build.skippedReason ?? 'insufficient_structured_data'}.`,
          blocked_reason: build.skippedReason ?? 'insufficient_structured_data',
          predicted_action: 'not_improved',
        };
      }
      if (
        qualityRank(stringValue(build.quality.status)) <=
        qualityRank(currentStatus)
      ) {
        return {
          ...base,
          eligible: false,
          reason: 'Current artifacts do not improve the skipped or degraded entry.',
          blocked_reason: 'not_improved',
          predicted_action: 'not_improved',
        };
      }
      return {
        ...base,
        eligible: true,
        reason: 'Current artifacts can produce an improved continuity entry.',
        blocked_reason: null,
        predicted_action: 'create_repair_entry',
      };
    }

    const legacyReason = await this.legacyEvidenceReason(
      currentEntry,
      run,
      workspaceId,
    );
    if (!legacyReason) {
      return {
        ...base,
        eligible: false,
        reason: 'Latest continuity entry already carries V1.2 evidence metadata.',
        blocked_reason: 'not_legacy_evidence',
        predicted_action: 'not_eligible',
      };
    }
    const build = await this.buildSnapshotForRun(run, workspaceId);
    if (!build.snapshot) {
      return {
        ...base,
        eligible: false,
        reason: `Legacy evidence repair cannot rebuild a snapshot: ${build.skippedReason ?? 'insufficient_structured_data'}.`,
        blocked_reason: build.skippedReason ?? 'insufficient_structured_data',
        predicted_action: 'not_eligible',
      };
    }
    return {
      ...base,
      eligible: true,
      reason: legacyReason,
      blocked_reason: null,
      predicted_action: 'create_repair_entry',
    };
  }

  private async executeRepairCandidate(
    candidate: RepairCandidate,
    workspaceId: string,
    userId?: string,
  ): Promise<ResearchContinuityRepairRunResultResponse> {
    if (!candidate.eligible) {
      return toSkippedRepairResult(candidate);
    }
    try {
      const repaired = await this.journal.findResearchContinuityRepairEntry(
        {
          runId: candidate.run_id,
          caseType: candidate.case_type,
          repairVersion: RESEARCH_CONTINUITY_REPAIR_VERSION,
          sourceEntryId: candidate.sourceEntryId,
        },
        workspaceId,
      );
      if (repaired) {
        return {
          ...baseRepairResult(candidate),
          action: 'already_repaired',
          previous_entry_id: nullableString(candidate.currentEntry?.id),
          new_entry_id: nullableString(repaired.id),
          reason: 'Repair entry already exists for this deterministic repair identity.',
        };
      }
      if (candidate.case_type === 'missing_continuity') {
        const latest =
          await this.journal.getLatestResearchContinuityEntryForRun(
            candidate.run_id,
            workspaceId,
          );
        if (latest && !isRepairEntry(latest)) {
          return {
            ...baseRepairResult(candidate),
            action: 'already_has_continuity',
            previous_entry_id: nullableString(latest.id),
            reason: 'A normal continuity entry appeared before repair execution.',
          };
        }
      }

      const build = await this.buildSnapshotForRun(candidate.run, workspaceId);
      if (!build.snapshot) {
        if (candidate.case_type !== 'missing_continuity') {
          return {
            ...baseRepairResult(candidate),
            action: 'not_improved',
            previous_entry_id: nullableString(candidate.currentEntry?.id),
            reason: build.skippedReason ?? 'insufficient_structured_data',
          };
        }
        const entry = await this.createRepairSkippedEntry({
          candidate,
          workspaceId,
          reason: build.skippedReason ?? 'insufficient_structured_data',
          quality: build.quality,
          userId,
        });
        return {
          ...baseRepairResult(candidate),
          action: 'created_repair_entry',
          previous_entry_id: nullableString(candidate.currentEntry?.id),
          new_entry_id: nullableString(entry.id),
          state_updated: false,
          reason: 'Skipped repair entry created for audit visibility.',
        };
      }

      const entry = await this.createRepairEntry({
        candidate,
        build,
        workspaceId,
        userId,
      });
      return entry;
    } catch (error) {
      return {
        ...baseRepairResult(candidate),
        action: 'failed',
        previous_entry_id: nullableString(candidate.currentEntry?.id),
        reason: 'Repair execution failed.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async createRepairEntry(input: {
    candidate: RepairCandidate;
    build: ResearchSnapshotBuildResult;
    workspaceId: string;
    userId?: string;
  }): Promise<ResearchContinuityRepairRunResultResponse> {
    const { candidate, workspaceId } = input;
    const runId = candidate.run_id;
    const previous = await this.loadHistoricalPreviousContext(
      candidate.symbol,
      candidate.run_completed_at,
      workspaceId,
    );
    const builtSnapshot = input.build.snapshot;
    if (!builtSnapshot) {
      throw new BadRequestException('repair snapshot is unavailable');
    }
    const existingSnapshot = await this.journal.getResearchSnapshotByRun(
      runId,
      workspaceId,
    );
    const snapshot: JsonRecord = existingSnapshot
      ? {
          ...builtSnapshot,
          id: nullableString(existingSnapshot.id) ?? builtSnapshot.id,
          research_run_id: runId,
        }
      : await this.journal.saveResearchSnapshot(builtSnapshot, workspaceId);
    const snapshotForProjection: JsonRecord = {
      ...snapshot,
      research_run_id: runId,
    };
    const quality = recordValue(snapshotForProjection.data_quality ?? input.build.quality);
    const entryType =
      stringValue(quality.status) === 'degraded'
        ? 'degraded'
        : previous.state
          ? 'delta'
          : 'baseline';
    const events = this.deltaEngine.compute(snapshotForProjection, previous.state);
    const canUpdateState = await this.shouldUpdateStateFromRepair(
      candidate,
      entryType === 'degraded' ? 'degraded' : 'completed',
      workspaceId,
    );
    const repair = repairMetadata({
      candidate,
      previousContextEntryId: previous.entryId,
      reason: candidate.reason,
      stateUpdated: canUpdateState,
      userId: input.userId,
    });
    const report = this.reportRenderer.render({
      entryType,
      snapshot: snapshotForProjection,
      previousState: previous.state,
      events,
      repairContext: repair,
    });
    const entry = await this.journal.saveResearchContinuityEntry(
      {
        id: `continuity_${safeId(runId)}_repair_${randomUUID().replaceAll('-', '')}`,
        workspace_id: workspaceId,
        symbol: candidate.symbol,
        research_run_id: runId,
        current_snapshot_id: nullableString(snapshotForProjection.id),
        previous_entry_id: previous.entryId,
        entry_type: entryType,
        status: entryType === 'degraded' ? 'degraded' : 'completed',
        generated_at: new Date().toISOString(),
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: quality,
        source_run_ids: [runId, previous.runId].filter(
          (id): id is string => Boolean(id),
        ),
        writer_metadata: report.writerMetadata,
        payload: {
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
          deterministic: true,
          repair,
        },
      },
      workspaceId,
    );

    let stateUpdated = false;
    if (canUpdateState && stringValue(entry.status) === 'completed') {
      const nextState = this.stateProjector.project(
        previous.state,
        snapshotForProjection,
        entry,
        events,
      );
      if (nextState) {
        await this.journal.saveResearchContinuityState(nextState, workspaceId);
        stateUpdated = true;
      }
    }
    return {
      ...baseRepairResult(candidate),
      action: 'created_repair_entry',
      previous_entry_id: previous.entryId,
      new_entry_id: nullableString(entry.id),
      state_updated: stateUpdated,
      reason: stateUpdated
        ? 'Repair entry created and continuity state updated.'
        : 'Repair entry created without moving continuity state.',
    };
  }

  private async createRepairSkippedEntry(input: {
    candidate: RepairCandidate;
    workspaceId: string;
    reason: string;
    quality: JsonRecord;
    userId?: string;
  }): Promise<JsonRecord> {
    const previous = await this.loadHistoricalPreviousContext(
      input.candidate.symbol,
      input.candidate.run_completed_at,
      input.workspaceId,
    );
    const repair = repairMetadata({
      candidate: input.candidate,
      previousContextEntryId: previous.entryId,
      reason: input.reason,
      stateUpdated: false,
      userId: input.userId,
    });
    const events = [
      {
        event_type: 'continuity_repair_skipped',
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
      previousState: previous.state,
      events,
      skippedReason: input.reason,
      repairContext: repair,
    });
    return this.journal.saveResearchContinuityEntry(
      {
        id: `continuity_${safeId(input.candidate.run_id)}_repair_${randomUUID().replaceAll('-', '')}`,
        workspace_id: input.workspaceId,
        symbol: input.candidate.symbol,
        research_run_id: input.candidate.run_id,
        current_snapshot_id: null,
        previous_entry_id: previous.entryId,
        entry_type: 'skipped',
        status: 'skipped',
        generated_at: new Date().toISOString(),
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: input.quality,
        source_run_ids: [input.candidate.run_id],
        writer_metadata: report.writerMetadata,
        payload: {
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
          skip_reason: input.reason,
          repair,
        },
      },
      input.workspaceId,
    );
  }

  private async shouldUpdateStateFromRepair(
    candidate: RepairCandidate,
    newStatus: string,
    workspaceId: string,
  ): Promise<boolean> {
    if (newStatus !== 'completed') {
      return false;
    }
    const latestRun = await this.journal.getLatestCompletedResearchRunForContinuity(
      candidate.symbol,
      workspaceId,
    );
    if (stringValue(latestRun?.id ?? latestRun?.run_id) === candidate.run_id) {
      return true;
    }
    const state = await this.journal.getResearchContinuityState(
      candidate.symbol,
      workspaceId,
    );
    return (
      nullableString(state?.latest_run_id) === candidate.run_id ||
      (candidate.sourceEntryId !== null &&
        nullableString(state?.latest_entry_id) === candidate.sourceEntryId)
    );
  }

  private async loadHistoricalPreviousContext(
    symbol: string,
    completedAt: string | null,
    workspaceId: string,
  ): Promise<{
    entryId: string | null;
    runId: string | null;
    state: JsonRecord | null;
  }> {
    if (!completedAt) {
      return { entryId: null, runId: null, state: null };
    }
    const previousEntry =
      await this.journal.getLatestResearchContinuityEntryBeforeRun(
        symbol,
        completedAt,
        workspaceId,
      );
    if (!previousEntry) {
      return { entryId: null, runId: null, state: null };
    }
    const previousRunId = nullableString(previousEntry.research_run_id);
    const snapshot = previousRunId
      ? await this.journal.getResearchSnapshotByRun(previousRunId, workspaceId)
      : null;
    return {
      entryId: nullableString(previousEntry.id),
      runId: previousRunId,
      state: snapshot
        ? stateFromEntryAndSnapshot(previousEntry, snapshot)
        : null,
    };
  }

  private async legacyEvidenceReason(
    entry: JsonRecord,
    run: JsonRecord,
    workspaceId: string,
  ): Promise<string | null> {
    const payload = recordValue(entry.payload ?? entry.payload_json);
    if (stringValue(payload.evidence_contract_version) !== 'research_evidence.v1.2') {
      return 'entry payload missing research_evidence.v1.2 contract';
    }
    const runId = stringValue(run.id ?? run.run_id);
    const snapshot = await this.journal.getResearchSnapshotByRun(
      runId,
      workspaceId,
    );
    const quality = recordValue(
      snapshot?.data_quality ?? entry.snapshot_quality,
    );
    const trackedItems = arrayRecords(snapshot?.tracked_items);
    if (
      trackedItems.some((item) => !nullableString(item.evidence_quality))
    ) {
      return 'tracked items missing evidence_quality';
    }
    for (const key of [
      'observed_evidence_coverage',
      'reasoning_only_item_count',
      'missing_evidence_item_count',
      'no_evidence_item_count',
    ]) {
      if (quality[key] === undefined || quality[key] === null) {
        return `snapshot quality missing ${key}`;
      }
    }
    return null;
  }

  private async buildSnapshotForRun(
    run: JsonRecord,
    workspaceId: string,
  ): Promise<ResearchSnapshotBuildResult> {
    const artifacts = await this.loadArtifacts(run, workspaceId);
    return this.snapshotBuilder.build({ run, ...artifacts });
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
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
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
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
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

function normalizeRepairFilters(
  filters: ResearchContinuityRepairPreviewFilters | RunResearchContinuityRepairDto,
  requireExecutionFields: boolean,
): NormalizedRepairFilters {
  const caseTypes = parseRepairCaseTypes(filters.case_types);
  if (requireExecutionFields && caseTypes.length === 0) {
    throw new BadRequestException('case_types is required');
  }
  const limit = normalizeRepairLimit(filters.limit, requireExecutionFields);
  const from = normalizeOptionalDate(filters.from, 'from');
  const to = normalizeOptionalDate(filters.to, 'to');
  if (from && to && from > to) {
    throw new BadRequestException('from must be before to');
  }
  const symbol = filters.symbol
    ? normalizeContinuitySymbol(filters.symbol)
    : undefined;
  return {
    symbol,
    from,
    to,
    caseTypes:
      caseTypes.length > 0
        ? caseTypes
        : [...RESEARCH_CONTINUITY_REPAIR_CASE_TYPES],
    limit,
  };
}

function parseRepairCaseTypes(
  value: string | ResearchContinuityRepairCaseType[] | undefined,
): ResearchContinuityRepairCaseType[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const normalized = raw
    .map((item) => String(item).trim())
    .filter(Boolean);
  const invalid = normalized.filter(
    (item) =>
      !RESEARCH_CONTINUITY_REPAIR_CASE_TYPES.includes(
        item as ResearchContinuityRepairCaseType,
      ),
  );
  if (invalid.length > 0) {
    throw new BadRequestException(`Unsupported repair case type: ${invalid[0]}`);
  }
  return [...new Set(normalized)] as ResearchContinuityRepairCaseType[];
}

function normalizeRepairLimit(
  value: number | string | undefined,
  required: boolean,
): number {
  if ((value === undefined || value === null || value === '') && required) {
    throw new BadRequestException('limit is required');
  }
  const parsed =
    value === undefined || value === null || value === '' ? 25 : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('limit must be a number');
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function normalizeOptionalDate(
  value: string | undefined,
  name: string,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException(`${name} must be a valid date`);
  }
  return date.toISOString();
}

function toRepairCandidateResponse(
  candidate: RepairCandidate,
): ResearchContinuityRepairCandidateResponse {
  return {
    candidate_id: candidate.candidate_id,
    run_id: candidate.run_id,
    symbol: candidate.symbol,
    run_completed_at: candidate.run_completed_at,
    case_type: candidate.case_type,
    current_entry_id: candidate.current_entry_id,
    current_entry_status: candidate.current_entry_status,
    current_entry_type: candidate.current_entry_type,
    eligible: candidate.eligible,
    reason: candidate.reason,
    blocked_reason: candidate.blocked_reason ?? null,
    predicted_action: candidate.predicted_action,
    repair_version: candidate.repair_version,
  };
}

function toDryRunResult(
  candidate: RepairCandidate,
): ResearchContinuityRepairRunResultResponse {
  if (candidate.eligible) {
    return {
      ...baseRepairResult(candidate),
      action: 'dry_run',
      previous_entry_id: nullableString(candidate.currentEntry?.id),
      reason: candidate.reason,
    };
  }
  return toSkippedRepairResult(candidate);
}

function toSkippedRepairResult(
  candidate: RepairCandidate,
): ResearchContinuityRepairRunResultResponse {
  const action =
    candidate.predicted_action === 'already_repaired'
      ? 'already_repaired'
      : candidate.predicted_action === 'already_has_continuity'
        ? 'already_has_continuity'
        : candidate.predicted_action === 'not_improved'
          ? 'not_improved'
          : 'not_eligible';
  return {
    ...baseRepairResult(candidate),
    action,
    previous_entry_id: nullableString(candidate.currentEntry?.id),
    reason: candidate.reason,
  };
}

function baseRepairResult(
  candidate: RepairCandidate,
): Omit<
  ResearchContinuityRepairRunResultResponse,
  'action' | 'reason'
> {
  return {
    candidate_id: candidate.candidate_id,
    run_id: candidate.run_id,
    symbol: candidate.symbol,
    case_type: candidate.case_type,
    previous_entry_id: null,
    new_entry_id: null,
    state_updated: false,
    error: null,
  };
}

function repairMetadata(input: {
  candidate: RepairCandidate;
  previousContextEntryId: string | null;
  reason: string;
  stateUpdated: boolean;
  userId?: string;
}): JsonRecord {
  const repairedAt = new Date().toISOString();
  return {
    is_repair: true,
    repair_version: RESEARCH_CONTINUITY_REPAIR_VERSION,
    case_type: input.candidate.case_type,
    reason: input.reason,
    identity_key: input.candidate.candidate_id,
    source_run_id: input.candidate.run_id,
    source_entry_id: input.candidate.sourceEntryId,
    previous_context_entry_id: input.previousContextEntryId,
    created_from: 'manual_repair',
    requested_by: 'api',
    requested_by_user_id: input.userId ?? null,
    dry_run: false,
    state_updated: input.stateUpdated,
    repaired_at: repairedAt,
  };
}

function repairIdentityKey(
  runId: string,
  caseType: ResearchContinuityRepairCaseType,
  sourceEntryId: string | null,
): string {
  return `${RESEARCH_CONTINUITY_REPAIR_VERSION}:${caseType}:${runId}:${sourceEntryId ?? 'none'}`;
}

function stateFromEntryAndSnapshot(
  entry: JsonRecord,
  snapshot: JsonRecord,
): JsonRecord {
  return {
    id: `historical_${stringValue(entry.id)}`,
    workspace_id: stringValue(entry.workspace_id, 'local'),
    symbol: stringValue(entry.symbol),
    current_snapshot_id: nullableString(entry.current_snapshot_id ?? snapshot.id),
    latest_entry_id: nullableString(entry.id),
    latest_run_id: nullableString(entry.research_run_id),
    current_view: recordValue(snapshot.symbol_view),
    active_items: arrayRecords(snapshot.tracked_items),
    recent_resolved_items: [],
    recent_invalidated_items: [],
    data_quality: recordValue(snapshot.data_quality ?? entry.snapshot_quality),
    updated_at: nullableString(entry.generated_at),
    payload: recordValue(entry.payload ?? entry.payload_json),
  };
}

function isRepairEntry(entry: JsonRecord): boolean {
  return Boolean(recordValue(recordValue(entry.payload ?? entry.payload_json).repair).is_repair);
}

function runTimestamp(run: JsonRecord): string | null {
  return nullableString(run.completed_at ?? run.started_at ?? run.created_at);
}

function qualityRank(value: string): number {
  if (value === 'clean' || value === 'completed') {
    return 2;
  }
  if (value === 'degraded') {
    return 1;
  }
  return 0;
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
