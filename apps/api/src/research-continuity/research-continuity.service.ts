import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import { redactForDebug } from '../common/redaction';
import { ContinuityDeltaEngine } from './continuity-delta.engine';
import {
  buildLegacyThinReport,
  ContinuityReportRenderer,
  RESEARCH_CONTINUITY_THIN_REPORT_VERSION,
} from './continuity-report.renderer';
import {
  buildDiffReport,
  buildDiffSummary,
} from './continuity-diff-report.presenter';
import {
  buildContinuityTimeline,
} from './continuity-timeline.presenter';
import { isResearchContinuityDebugEnabled } from './research-continuity.config';
import { ContinuityStateProjector } from './continuity-state.projector';
import {
  ResearchSnapshotBuilder,
  ResearchSnapshotBuildResult,
} from './research-snapshot.builder';
import {
  GenerateResearchContinuityDto,
  GenerateResearchContinuityResponse,
  RESEARCH_CONTINUITY_DEBUG_PERMISSION,
  RESEARCH_CONTINUITY_REPAIR_CASE_TYPES,
  RESEARCH_CONTINUITY_REPAIR_VERSION,
  RESEARCH_CONTINUITY_SCHEDULED_REPAIR_MODES,
  ResearchContinuityEntriesResponse,
  ResearchContinuityDebugAccessAuditResponse,
  ResearchContinuityEntryDebugResponse,
  ResearchContinuityEntryDetailResponse,
  ResearchContinuityEntryResponse,
  ResearchContinuityEntrySummaryResponse,
  ResearchContinuityEvidenceDigestResponse,
  ResearchContinuityLifecycleItemType,
  ResearchContinuityLifecycleStatus,
  ResearchContinuityMaterialEventDigestResponse,
  ResearchContinuityQualityExplanationResponse,
  ResearchContinuityRepairCandidateResponse,
  ResearchContinuityRepairCaseType,
  ResearchContinuityRepairPreviewFilters,
  ResearchContinuityRepairPreviewResponse,
  ResearchContinuityRepairRunDetailResponse,
  ResearchContinuityRepairRunResponse,
  ResearchContinuityRepairRunResultResponse,
  ResearchContinuityRepairRunSummaryResponse,
  ResearchContinuityScheduledRepairMode,
  ResearchContinuitySchedulerRunDueResponse,
  ResearchContinuitySchedulerStatusResponse,
  ResearchContinuityStateTransitionDigestResponse,
  ResearchContinuityStateEnvelopeResponse,
  ResearchContinuityStateResponse,
  ResearchContinuityThinReport,
  ResearchContinuityThinSectionId,
  ResearchContinuityTimelineResponse,
  ResearchContinuityWorkspaceSettingsResponse,
  ResearchSnapshotResponse,
  RunResearchContinuityRepairDto,
  UpdateResearchContinuitySettingsDto,
} from './dto/research-continuity.dto';
import {
  RESEARCH_CONTINUITY_AUDIT_REPOSITORY,
} from './research-continuity-audit.repository';
import type {
  ResearchContinuityAuditRepository,
  ResearchContinuityDebugAccessAuditFilters,
  ResearchContinuityDebugAuditDecision,
  ResearchContinuityDebugAuditReason,
  ResearchContinuityRepairRunFilters,
  ResearchContinuityRepairRunStatus,
} from './research-continuity-audit.types';
import {
  RESEARCH_CONTINUITY_SETTINGS_REPOSITORY,
} from './research-continuity-settings.repository';
import type {
  ResearchContinuitySettingsRepository,
} from './research-continuity-settings.types';

interface NormalizedRepairFilters {
  symbol?: string;
  from?: string;
  to?: string;
  caseTypes: ResearchContinuityRepairCaseType[];
  limit: number;
}

interface ResearchContinuityTimelineFilters {
  include_context?: boolean;
  item_type?: ResearchContinuityLifecycleItemType;
  limit?: number;
  status?: ResearchContinuityLifecycleStatus;
}

interface RepairCandidate extends ResearchContinuityRepairCandidateResponse {
  run: JsonRecord;
  currentEntry: JsonRecord | null;
  sourceEntryId: string | null;
}

interface ScheduledRepairRunOptions {
  now?: Date;
  source?: 'manual' | 'worker';
}

const DEFAULT_SCHEDULED_REPAIR_CASE_TYPES: ResearchContinuityRepairCaseType[] = [
  'missing_continuity',
  'legacy_evidence',
];

@Injectable()
export class ResearchContinuityService {
  private readonly snapshotBuilder = new ResearchSnapshotBuilder();
  private readonly deltaEngine = new ContinuityDeltaEngine();
  private readonly stateProjector = new ContinuityStateProjector();
  private readonly reportRenderer = new ContinuityReportRenderer();

  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    @Inject(RESEARCH_CONTINUITY_AUDIT_REPOSITORY)
    private readonly audit: ResearchContinuityAuditRepository,
    @Inject(RESEARCH_CONTINUITY_SETTINGS_REPOSITORY)
    private readonly settings: ResearchContinuitySettingsRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async getRunContinuity(
    runId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityEntrySummaryResponse | null> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'viewer',
    );
    const canViewDebug = await this.canViewDebug(userId, workspaceId);
    await this.getRunOrThrow(runId, workspaceId);
    const entry = await this.journal.getLatestResearchContinuityEntryForRun(
      runId,
      workspaceId,
    );
    return entry ? toEntrySummaryResponse(entry, canViewDebug) : null;
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
    return this.generateForRunInWorkspace(
      runId,
      workspaceId,
      Boolean(dto.force),
      userId,
    );
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
  ): Promise<ResearchContinuityEntryDetailResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'viewer',
    );
    const canViewDebug = await this.canViewDebug(userId, workspaceId);
    const entry = await this.journal.getResearchContinuityEntry(id, workspaceId);
    if (!entry) {
      throw new NotFoundException(`Research continuity entry ${id} not found`);
    }
    return toEntryDetailResponse(entry, canViewDebug);
  }

  async getEntryDebug(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityEntryDebugResponse> {
    const entryId = stringValue(id).trim();
    const requestedByUserId = trimOptional(userId);
    const requestedWorkspaceId = trimOptional(workspaceHeader);
    if (!isResearchContinuityDebugEnabled()) {
      await this.tryRecordDebugAccessAudit({
        entryId,
        workspaceId: requestedWorkspaceId,
        requestedByUserId,
        decision: 'denied',
        reason: 'disabled_by_policy',
      });
      throwDebugDisabled();
    }

    let resolvedUserId: string;
    try {
      resolvedUserId = this.auth.resolveUser(userId);
    } catch (error) {
      await this.tryRecordDebugAccessAudit({
        entryId,
        workspaceId: requestedWorkspaceId,
        requestedByUserId,
        decision: 'denied',
        reason: 'missing_user',
      });
      throw error;
    }

    let workspaceId: string;
    try {
      workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    } catch (error) {
      await this.tryRecordDebugAccessAudit({
        entryId,
        workspaceId: null,
        requestedByUserId: resolvedUserId,
        decision: 'denied',
        reason: 'missing_workspace',
      });
      throwDebugPermissionRequired(error);
    }

    try {
      await this.workspaces.assertAccess(resolvedUserId, workspaceId, 'editor');
    } catch (error) {
      const reason = await this.debugPermissionDeniedReason(
        error,
        resolvedUserId,
        workspaceId,
      );
      await this.tryRecordDebugAccessAudit({
        entryId,
        workspaceId,
        requestedByUserId: resolvedUserId,
        decision: 'denied',
        reason,
      });
      throwDebugPermissionRequired(error);
    }
    const entry = await this.journal.getResearchContinuityEntry(entryId, workspaceId);
    if (!entry) {
      await this.tryRecordDebugAccessAudit({
        entryId,
        workspaceId,
        requestedByUserId: resolvedUserId,
        decision: 'denied',
        reason: 'entry_not_found',
      });
      throw new NotFoundException(`Research continuity entry ${entryId} not found`);
    }
    await this.audit.recordDebugAccessAudit({
      workspace_id: workspaceId,
      entry_id: entryId,
      research_run_id: nullableString(entry.research_run_id),
      symbol: nullableString(entry.symbol),
      requested_by_user_id: resolvedUserId,
      decision: 'allowed',
      reason: 'allowed',
      requested_at: new Date().toISOString(),
      metadata: {
        source: 'research_continuity_debug',
      },
    });
    return toEntryDebugResponse(entry, resolvedUserId);
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
    const canViewDebug = await this.canViewDebug(userId, workspaceId);
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
      latest_entry: latestEntry ? toEntrySummaryResponse(latestEntry, canViewDebug) : null,
    };
  }

  async buildEngineContinuityContext(
    symbol: string,
    workspaceId: string,
    marketType: 'spot' | 'perp' | string,
  ): Promise<JsonRecord | null> {
    const normalizedSymbol = normalizeContinuitySymbol(symbol);
    const normalizedMarketType = normalizeEngineMarketType(marketType);
    const state = await this.journal.getResearchContinuityState(
      normalizedSymbol,
      workspaceId,
    );
    const latestEntryId = nullableString(state?.latest_entry_id);
    if (!state || !latestEntryId) {
      return null;
    }
    const latestEntry = await this.journal.getResearchContinuityEntry(
      latestEntryId,
      workspaceId,
    );
    if (!latestEntry) {
      return null;
    }
    const latestRunId = nullableString(latestEntry.research_run_id);
    const latestRun = latestRunId
      ? await this.journal.getResearchRun(latestRunId, workspaceId)
      : null;
    if (!engineRunMatchesContext(latestRun, normalizedSymbol, normalizedMarketType)) {
      return null;
    }
    return buildLatestContinuityContext({
      state,
      latestEntry,
      latestRun,
      marketType: normalizedMarketType,
      workspaceId,
      symbol: normalizedSymbol,
    });
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
    const canViewDebug = await this.canViewDebug(userId, workspaceId);
    const normalizedSymbol = normalizeContinuitySymbol(symbol);
    const entries = await this.journal.listResearchContinuityEntriesBySymbol(
      normalizedSymbol,
      normalizeLimit(filters.limit),
      workspaceId,
    );
    return {
      symbol: normalizedSymbol,
      entries: entries.map((entry) => toEntrySummaryResponse(entry, canViewDebug)),
    };
  }

  async getSymbolTimeline(
    symbol: string,
    filters: ResearchContinuityTimelineFilters = {},
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityTimelineResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'viewer',
    );
    const normalizedSymbol = normalizeContinuitySymbol(symbol);
    const limit = normalizeTimelineLimit(filters.limit);
    const fetchedEntries = await this.journal.listResearchContinuityEntriesBySymbol(
      normalizedSymbol,
      limit + 1,
      workspaceId,
    );
    const entries = fetchedEntries.slice(0, limit);
    const runIds = new Set<string>();
    for (const entry of entries) {
      const runId = nullableString(entry.research_run_id);
      if (runId) {
        runIds.add(runId);
      }
      const repairSourceRunId = nullableString(
        recordValue(continuityEntryPayload(entry).repair).source_run_id,
      );
      if (repairSourceRunId) {
        runIds.add(repairSourceRunId);
      }
    }
    const runs = new Map<string, JsonRecord>();
    await Promise.all(
      [...runIds].map(async (runId) => {
        const run = await this.journal.getResearchRun(runId, workspaceId);
        if (run) {
          runs.set(runId, run);
        }
      }),
    );

    return buildContinuityTimeline({
      entries,
      entryLimit: limit,
      fetchedEntryCount: fetchedEntries.length,
      filters: {
        itemType: normalizeTimelineItemType(filters.item_type),
        status: normalizeTimelineStatus(filters.status),
      },
      includeContext: Boolean(filters.include_context),
      runs,
      symbol: normalizedSymbol,
      workspaceId,
    });
  }

  async getWorkspaceSettings(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityWorkspaceSettingsResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'admin',
    );
    const settings = await this.settings.getWorkspaceSettings(workspaceId);
    return toWorkspaceSettingsResponse(settings, workspaceId);
  }

  async updateWorkspaceSettings(
    dto: UpdateResearchContinuitySettingsDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityWorkspaceSettingsResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'admin',
    );
    const updatedByUserId = this.auth.resolveUser(userId);
    const current = toWorkspaceSettingsResponse(
      await this.settings.getWorkspaceSettings(workspaceId),
      workspaceId,
    );
    const nextMode = scheduledRepairModeValue(
      dto.scheduled_repair_mode ?? current.scheduled_repair_mode,
    );
    const nextCaseTypes = normalizeScheduledRepairCaseTypes(
      dto.scheduled_repair_case_types ?? current.scheduled_repair_case_types,
      nextMode,
    );
    const now = new Date().toISOString();
    const wasDisabled = current.scheduled_repair_mode === 'disabled';
    const becomesActive = nextMode === 'dry_run' || nextMode === 'enabled';
    const nextDue =
      becomesActive && wasDisabled && !current.next_scheduled_repair_due_at
        ? now
        : current.next_scheduled_repair_due_at;
    const saved = await this.settings.upsertWorkspaceSettings({
      workspace_id: workspaceId,
      scheduled_repair_mode: nextMode,
      scheduled_repair_case_types: nextCaseTypes,
      scheduled_repair_interval_hours: normalizeIntegerRange(
        dto.scheduled_repair_interval_hours ??
          current.scheduled_repair_interval_hours,
        1,
        168,
        'scheduled_repair_interval_hours',
      ),
      scheduled_repair_lookback_days: normalizeIntegerRange(
        dto.scheduled_repair_lookback_days ??
          current.scheduled_repair_lookback_days,
        1,
        365,
        'scheduled_repair_lookback_days',
      ),
      scheduled_repair_limit: normalizeIntegerRange(
        dto.scheduled_repair_limit ?? current.scheduled_repair_limit,
        1,
        100,
        'scheduled_repair_limit',
      ),
      next_scheduled_repair_due_at: nextDue,
      updated_by_user_id: updatedByUserId,
      updated_at: now,
    });
    return toWorkspaceSettingsResponse(saved, workspaceId);
  }

  async getSchedulerStatus(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuitySchedulerStatusResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'admin',
    );
    const settings = toWorkspaceSettingsResponse(
      await this.settings.getWorkspaceSettings(workspaceId),
      workspaceId,
    );
    return this.schedulerStatusFromSettings(settings, workspaceId);
  }

  async runDueScheduledRepair(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuitySchedulerRunDueResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'admin',
    );
    const actor = this.auth.resolveUser(userId);
    return this.runDueScheduledRepairForWorkspace(workspaceId, actor, {
      source: 'manual',
    });
  }

  async runDueScheduledRepairForWorkspace(
    workspaceId: string,
    actorUserId: string,
    options: ScheduledRepairRunOptions = {},
  ): Promise<ResearchContinuitySchedulerRunDueResponse> {
    const source = options.source ?? 'manual';
    const now = options.now ?? new Date();
    let settingsRow: JsonRecord | null;
    try {
      settingsRow = await this.settings.getWorkspaceSettings(workspaceId);
    } catch (error) {
      if (!isRepositoryUnavailable(error)) {
        throw error;
      }
      return schedulerSkippedResponse(
        workspaceId,
        defaultWorkspaceSettings(workspaceId),
        'settings_unavailable',
        now,
      );
    }
    const settings = toWorkspaceSettingsResponse(settingsRow, workspaceId);
    if (!settingsRow || settings.scheduled_repair_mode === 'disabled') {
      return schedulerSkippedResponse(
        workspaceId,
        settings,
        'scheduler_disabled',
        now,
      );
    }
    if (source === 'manual' && hasActiveSchedulerLease(settings, now)) {
      return schedulerSkippedResponse(
        workspaceId,
        settings,
        'worker_lease_active',
        now,
      );
    }
    if (!isSchedulerDue(settings, now)) {
      return schedulerSkippedResponse(workspaceId, settings, 'not_due', now);
    }
    const caseTypes = runnableScheduledRepairCaseTypes(settings);
    if (caseTypes.length === 0) {
      return schedulerSkippedResponse(workspaceId, settings, 'no_case_types', now);
    }
    const nowIso = now.toISOString();
    const dueBasis = settings.next_scheduled_repair_due_at ?? nowIso;
    const repairRun = await this.runRepairForWorkspace(
      {
        from: addHours(now, -settings.scheduled_repair_lookback_days * 24).toISOString(),
        to: nowIso,
        case_types: caseTypes,
        limit: settings.scheduled_repair_limit,
        dry_run: settings.scheduled_repair_mode === 'dry_run',
        idempotency_key: `research-continuity-scheduler:${workspaceId}:${dueBasis}`,
      },
      workspaceId,
      actorUserId,
      nowIso,
    );
    await this.ensureScheduledRepairRunCompleted(
      repairRun.audit_run_id,
      workspaceId,
    );
    const nextDue = addHours(
      now,
      settings.scheduled_repair_interval_hours,
    ).toISOString();
    if (source === 'worker') {
      return {
        workspace_id: workspaceId,
        due: true,
        skipped_reason: null,
        dry_run: repairRun.dry_run,
        audit_run_id: repairRun.audit_run_id,
        repair_run: repairRun,
        next_scheduled_repair_due_at: nextDue,
      };
    }
    const marked = await this.settings.markScheduledRepairRun({
      workspace_id: workspaceId,
      last_scheduled_repair_at: nowIso,
      last_scheduled_repair_run_id: repairRun.audit_run_id,
      next_scheduled_repair_due_at: nextDue,
    });
    const savedSettings = toWorkspaceSettingsResponse(marked, workspaceId);
    return {
      workspace_id: workspaceId,
      due: true,
      skipped_reason: null,
      dry_run: repairRun.dry_run,
      audit_run_id: repairRun.audit_run_id,
      repair_run: repairRun,
      next_scheduled_repair_due_at:
        savedSettings.next_scheduled_repair_due_at,
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
      'admin',
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
      'admin',
    );
    const requestedByUserId = this.auth.resolveUser(userId);
    return this.runRepairForWorkspace(dto, workspaceId, requestedByUserId);
  }

  private async runRepairForWorkspace(
    dto: RunResearchContinuityRepairDto,
    workspaceId: string,
    requestedByUserId: string,
    requestedAt = new Date().toISOString(),
  ): Promise<ResearchContinuityRepairRunResponse> {
    const normalized = normalizeRepairFilters(dto, true);
    const dryRun = dto.dry_run !== false;
    const auditRun = await this.audit.createRepairRun({
      workspace_id: workspaceId,
      requested_by_user_id: requestedByUserId,
      requested_at: requestedAt,
      dry_run: dryRun,
      idempotency_key: trimOptional(dto.idempotency_key),
      filters: repairFiltersJson(normalized),
    });
    if (booleanValue(auditRun._existing, false)) {
      return toRepairRunResponse(auditRun);
    }

    try {
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
        results.push(
          await this.executeRepairCandidate(
            candidate,
            workspaceId,
            requestedByUserId,
          ),
        );
      }
      const counts = summarizeRepairResults(results);
      const finalized = await this.audit.finalizeRepairRun(
        stringValue(auditRun.id),
        workspaceId,
        {
          status: counts.failed_count > 0 ? 'completed_with_failures' : 'completed',
          requested_count: counts.requested_count,
          repaired_count: counts.repaired_count,
          skipped_count: counts.skipped_count,
          failed_count: counts.failed_count,
          created_entry_ids: createdEntryIds(results),
          results,
          error_message: null,
        },
      );
      return toRepairRunResponse(finalized);
    } catch (error) {
      await this.audit.finalizeRepairRun(stringValue(auditRun.id), workspaceId, {
        status: 'failed',
        requested_count: 0,
        repaired_count: 0,
        skipped_count: 0,
        failed_count: 0,
        created_entry_ids: [],
        results: [],
        error_message: sanitizedErrorMessage(error),
      });
      throw error;
    }
  }

  async listDebugAccessAudits(
    filters: Partial<ResearchContinuityDebugAccessAuditFilters>,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityDebugAccessAuditResponse[]> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'admin',
    );
    const rows = await this.audit.listDebugAccessAudits(
      normalizeDebugAuditFilters(filters),
      workspaceId,
    );
    return rows.map(toDebugAccessAuditResponse);
  }

  async listRepairRuns(
    filters: Partial<ResearchContinuityRepairRunFilters>,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityRepairRunSummaryResponse[]> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'admin',
    );
    const rows = await this.audit.listRepairRuns(
      normalizeRepairRunFilters(filters),
      workspaceId,
    );
    return rows.map(toRepairRunSummaryResponse);
  }

  async getRepairRun(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchContinuityRepairRunDetailResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(
      userId,
      workspaceHeader,
      'admin',
    );
    const run = await this.audit.getRepairRun(id, workspaceId);
    if (!run) {
      throw new NotFoundException(`Research continuity repair run ${id} not found`);
    }
    return toRepairRunDetailResponse(run);
  }

  private async schedulerStatusFromSettings(
    settings: ResearchContinuityWorkspaceSettingsResponse,
    workspaceId: string,
  ): Promise<ResearchContinuitySchedulerStatusResponse> {
    const lastRun = settings.last_scheduled_repair_run_id
      ? await this.audit.getRepairRun(
          settings.last_scheduled_repair_run_id,
          workspaceId,
        )
      : null;
    return {
      workspace_id: workspaceId,
      settings,
      due: isSchedulerDue(settings, new Date()),
      disabled: settings.scheduled_repair_mode === 'disabled',
      dry_run: settings.scheduled_repair_mode === 'dry_run',
      worker_enabled: isSchedulerWorkerEnabled(),
      next_scheduled_repair_due_at: settings.next_scheduled_repair_due_at,
      last_scheduled_repair_at: settings.last_scheduled_repair_at,
      last_scheduled_repair_run_id: settings.last_scheduled_repair_run_id,
      last_scheduled_repair_status: nullableString(lastRun?.status),
    };
  }

  private async ensureScheduledRepairRunCompleted(
    auditRunId: string,
    workspaceId: string,
  ): Promise<void> {
    const auditRun = await this.audit.getRepairRun(auditRunId, workspaceId);
    const status = stringValue(auditRun?.status);
    if (status === 'completed' || status === 'completed_with_failures') {
      return;
    }
    throw new ConflictException(
      `Scheduled repair run ${auditRunId} is ${status || 'unavailable'} and cannot advance scheduler due time`,
    );
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
    const generatedAt = new Date().toISOString();
    const report = this.reportRenderer.render({
      entryType,
      snapshot: snapshotForProjection,
      previousState: previous.state,
      events,
      repairContext: repair,
      generatedAt,
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
        generated_at: generatedAt,
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: quality,
        source_run_ids: [runId, previous.runId].filter(
          (id): id is string => Boolean(id),
        ),
        writer_metadata: report.writerMetadata,
        payload: payloadWithThinReport({
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
          deterministic: true,
          repair,
        }, report.thinReport),
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
    const generatedAt = new Date().toISOString();
    const report = this.reportRenderer.render({
      entryType: 'skipped',
      snapshot: null,
      previousState: previous.state,
      events,
      skippedReason: input.reason,
      repairContext: repair,
      generatedAt,
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
        generated_at: generatedAt,
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: input.quality,
        source_run_ids: [input.candidate.run_id],
        writer_metadata: report.writerMetadata,
        payload: payloadWithThinReport({
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
          skip_reason: input.reason,
          repair,
        }, report.thinReport),
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
    const payload = continuityEntryPayload(entry);
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
    userId?: string,
  ): Promise<GenerateResearchContinuityResponse> {
    const canViewDebug = await this.canViewDebug(userId, workspaceId);
    if (!force) {
      const existing = await this.journal.getLatestResearchContinuityEntryForRun(
        runId,
        workspaceId,
      );
      if (existing) {
        return {
          created: false,
          entry: toEntryDetailResponse(existing, canViewDebug),
        };
      }
    }

    const run = await this.getRunOrThrow(runId, workspaceId);
    const symbol = normalizeContinuitySymbol(stringValue(run.symbol));
    const persistedState = await this.journal.getResearchContinuityState(
      symbol,
      workspaceId,
    );
    const historicalPrevious = persistedState
      ? null
      : await this.loadHistoricalPreviousContext(
          symbol,
          runTimestamp(run),
          workspaceId,
        );
    const previousState = persistedState ?? historicalPrevious?.state ?? null;
    const previousEntryId =
      nullableString(persistedState?.latest_entry_id) ??
      historicalPrevious?.entryId ??
      null;
    const previousRunId =
      nullableString(persistedState?.latest_run_id) ??
      historicalPrevious?.runId ??
      null;
    if (!isContinuityEligibleStatus(stringValue(run.status))) {
      const entry = await this.createSkippedEntry({
        run,
        symbol,
        workspaceId,
        previousEntryId,
        reason: 'run_not_completed',
      });
      return { created: true, entry: toEntryDetailResponse(entry, canViewDebug) };
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
      return { created: true, entry: toEntryDetailResponse(entry, canViewDebug) };
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
    const generatedAt = new Date().toISOString();
    const report = this.reportRenderer.render({
      entryType,
      snapshot,
      previousState,
      events,
      generatedAt,
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
        generated_at: generatedAt,
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: quality,
        source_run_ids: [runId, previousRunId].filter(
          (id): id is string => Boolean(id),
        ),
        writer_metadata: report.writerMetadata,
        payload: payloadWithThinReport({
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
          deterministic: true,
        }, report.thinReport),
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
    return { created: true, entry: toEntryDetailResponse(entry, canViewDebug) };
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
    const generatedAt = new Date().toISOString();
    const report = this.reportRenderer.render({
      entryType: 'skipped',
      snapshot: null,
      previousState: null,
      events,
      skippedReason: input.reason,
      generatedAt,
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
        generated_at: generatedAt,
        summary: report.summary,
        sections: report.sections,
        events,
        snapshot_quality: quality,
        source_run_ids: [runId],
        writer_metadata: report.writerMetadata,
        payload: payloadWithThinReport({
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
          skip_reason: input.reason,
        }, report.thinReport),
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

  private async tryRecordDebugAccessAudit(input: {
    entryId: string;
    workspaceId: string | null;
    requestedByUserId: string | null;
    decision: ResearchContinuityDebugAuditDecision;
    reason: ResearchContinuityDebugAuditReason;
  }): Promise<void> {
    try {
      await this.audit.recordDebugAccessAudit({
        workspace_id: input.workspaceId,
        entry_id: input.entryId,
        requested_by_user_id: input.requestedByUserId,
        decision: input.decision,
        reason: input.reason,
        requested_at: new Date().toISOString(),
        metadata: {
          source: 'research_continuity_debug',
        },
      });
    } catch {
      // Denied debug paths are best-effort audited; preserve the original denial.
    }
  }

  private async debugPermissionDeniedReason(
    error: unknown,
    userId: string,
    workspaceId: string,
  ): Promise<ResearchContinuityDebugAuditReason> {
    if (!(error instanceof ForbiddenException)) {
      throw error;
    }
    try {
      await this.workspaces.assertAccess(userId, workspaceId, 'viewer');
      return 'permission_required';
    } catch {
      return 'workspace_denied';
    }
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
    requiredRole: 'viewer' | 'editor' | 'admin',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }

  private async canViewDebug(
    userId: string | undefined,
    workspaceId: string,
  ): Promise<boolean> {
    if (!isResearchContinuityDebugEnabled()) {
      return false;
    }
    try {
      await this.workspaces.assertAccess(
        this.auth.resolveUser(userId),
        workspaceId,
        'editor',
      );
      return true;
    } catch {
      return false;
    }
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

function repairFiltersJson(filters: NormalizedRepairFilters): JsonRecord {
  return {
    symbol: filters.symbol ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    case_types: filters.caseTypes,
    limit: filters.limit,
  };
}

function normalizeDebugAuditFilters(
  filters: Partial<ResearchContinuityDebugAccessAuditFilters>,
): ResearchContinuityDebugAccessAuditFilters {
  return {
    limit: normalizeLimit(filters.limit),
    entry_id: trimOptional(filters.entry_id) ?? undefined,
    decision: debugAuditDecisionValue(filters.decision),
    reason: debugAuditReasonValue(filters.reason),
    requested_by_user_id:
      trimOptional(filters.requested_by_user_id) ?? undefined,
  };
}

function normalizeRepairRunFilters(
  filters: Partial<ResearchContinuityRepairRunFilters>,
): ResearchContinuityRepairRunFilters {
  return {
    limit: normalizeLimit(filters.limit),
    status: repairRunStatusValue(filters.status),
    dry_run:
      typeof filters.dry_run === 'boolean' ? filters.dry_run : undefined,
  };
}

function defaultWorkspaceSettings(
  workspaceId: string,
): ResearchContinuityWorkspaceSettingsResponse {
  return {
    workspace_id: workspaceId,
    scheduled_repair_mode: 'disabled',
    scheduled_repair_case_types: [...DEFAULT_SCHEDULED_REPAIR_CASE_TYPES],
    scheduled_repair_interval_hours: 24,
    scheduled_repair_lookback_days: 30,
    scheduled_repair_limit: 25,
    next_scheduled_repair_due_at: null,
    last_scheduled_repair_at: null,
    last_scheduled_repair_run_id: null,
    scheduler_lease_owner: null,
    scheduler_lease_expires_at: null,
    last_scheduler_attempt_at: null,
    last_scheduler_success_at: null,
    last_scheduler_error: null,
    consecutive_scheduler_failures: 0,
    next_scheduler_retry_at: null,
    updated_by_user_id: null,
    updated_at: null,
  };
}

function toWorkspaceSettingsResponse(
  row: JsonRecord | null,
  workspaceId: string,
): ResearchContinuityWorkspaceSettingsResponse {
  if (!row) {
    return defaultWorkspaceSettings(workspaceId);
  }
  const fallback = defaultWorkspaceSettings(workspaceId);
  return {
    workspace_id: stringValue(row.workspace_id, workspaceId),
    scheduled_repair_mode: scheduledRepairModeValue(
      row.scheduled_repair_mode,
    ),
    scheduled_repair_case_types: scheduledRepairCaseTypesFromValue(
      row.scheduled_repair_case_types ?? row.scheduled_repair_case_types_json,
    ),
    scheduled_repair_interval_hours: numberValue(
      row.scheduled_repair_interval_hours,
      fallback.scheduled_repair_interval_hours,
    ),
    scheduled_repair_lookback_days: numberValue(
      row.scheduled_repair_lookback_days,
      fallback.scheduled_repair_lookback_days,
    ),
    scheduled_repair_limit: numberValue(
      row.scheduled_repair_limit,
      fallback.scheduled_repair_limit,
    ),
    next_scheduled_repair_due_at: nullableString(
      row.next_scheduled_repair_due_at,
    ),
    last_scheduled_repair_at: nullableString(row.last_scheduled_repair_at),
    last_scheduled_repair_run_id: nullableString(
      row.last_scheduled_repair_run_id,
    ),
    scheduler_lease_owner: nullableString(row.scheduler_lease_owner),
    scheduler_lease_expires_at: nullableString(row.scheduler_lease_expires_at),
    last_scheduler_attempt_at: nullableString(row.last_scheduler_attempt_at),
    last_scheduler_success_at: nullableString(row.last_scheduler_success_at),
    last_scheduler_error: nullableString(row.last_scheduler_error),
    consecutive_scheduler_failures: numberValue(
      row.consecutive_scheduler_failures,
      fallback.consecutive_scheduler_failures,
    ),
    next_scheduler_retry_at: nullableString(row.next_scheduler_retry_at),
    updated_by_user_id: nullableString(row.updated_by_user_id),
    updated_at: nullableString(row.updated_at),
  };
}

function scheduledRepairModeValue(
  value: unknown,
): ResearchContinuityScheduledRepairMode {
  const normalized = stringValue(value, 'disabled');
  return RESEARCH_CONTINUITY_SCHEDULED_REPAIR_MODES.includes(
    normalized as ResearchContinuityScheduledRepairMode,
  )
    ? (normalized as ResearchContinuityScheduledRepairMode)
    : 'disabled';
}

function scheduledRepairCaseTypesFromValue(
  value: unknown,
): ResearchContinuityRepairCaseType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set(RESEARCH_CONTINUITY_REPAIR_CASE_TYPES);
  const caseTypes: ResearchContinuityRepairCaseType[] = [];
  for (const item of value) {
    const normalized = stringValue(item);
    if (
      allowed.has(normalized as ResearchContinuityRepairCaseType) &&
      !caseTypes.includes(normalized as ResearchContinuityRepairCaseType)
    ) {
      caseTypes.push(normalized as ResearchContinuityRepairCaseType);
    }
  }
  return caseTypes;
}

function normalizeScheduledRepairCaseTypes(
  value: unknown,
  mode: ResearchContinuityScheduledRepairMode,
): ResearchContinuityRepairCaseType[] {
  const caseTypes = scheduledRepairCaseTypesFromValue(value);
  if (caseTypes.length === 0) {
    throw new BadRequestException(
      'scheduled_repair_case_types must include at least one case type',
    );
  }
  if (mode === 'enabled' && caseTypes.includes('skipped_or_degraded')) {
    throw new BadRequestException(
      'enabled scheduled repair cannot include skipped_or_degraded',
    );
  }
  return caseTypes;
}

function runnableScheduledRepairCaseTypes(
  settings: ResearchContinuityWorkspaceSettingsResponse,
): ResearchContinuityRepairCaseType[] {
  if (settings.scheduled_repair_mode === 'enabled') {
    return settings.scheduled_repair_case_types.filter(
      (caseType) => caseType !== 'skipped_or_degraded',
    );
  }
  return settings.scheduled_repair_case_types;
}

function normalizeIntegerRange(
  value: unknown,
  min: number,
  max: number,
  field: string,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new BadRequestException(`${field} must be a number`);
  }
  const integer = Math.trunc(numeric);
  if (integer < min || integer > max) {
    throw new BadRequestException(`${field} must be between ${min} and ${max}`);
  }
  return integer;
}

function isSchedulerDue(
  settings: ResearchContinuityWorkspaceSettingsResponse,
  now: Date,
): boolean {
  if (settings.scheduled_repair_mode === 'disabled') {
    return false;
  }
  const nextDue = nullableString(settings.next_scheduled_repair_due_at);
  if (!nextDue) {
    return true;
  }
  const parsed = Date.parse(nextDue);
  return Number.isFinite(parsed) && parsed <= now.getTime();
}

function hasActiveSchedulerLease(
  settings: ResearchContinuityWorkspaceSettingsResponse,
  now: Date,
): boolean {
  if (!settings.scheduler_lease_owner || !settings.scheduler_lease_expires_at) {
    return false;
  }
  const parsed = Date.parse(settings.scheduler_lease_expires_at);
  return Number.isFinite(parsed) && parsed > now.getTime();
}

function schedulerSkippedResponse(
  workspaceId: string,
  settings: ResearchContinuityWorkspaceSettingsResponse,
  skippedReason: NonNullable<
    ResearchContinuitySchedulerRunDueResponse['skipped_reason']
  >,
  now = new Date(),
): ResearchContinuitySchedulerRunDueResponse {
  return {
    workspace_id: workspaceId,
    due:
      skippedReason === 'worker_lease_active'
        ? false
        : skippedReason === 'no_case_types'
        ? true
        : isSchedulerDue(settings, now),
    skipped_reason: skippedReason,
    dry_run: settings.scheduled_repair_mode === 'dry_run',
    audit_run_id: null,
    repair_run: null,
    next_scheduled_repair_due_at: settings.next_scheduled_repair_due_at,
  };
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function isRepositoryUnavailable(error: unknown): boolean {
  if (error instanceof ServiceUnavailableException) {
    return true;
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 503) {
    return true;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return ['42P01', '42703'].includes(String(code));
}

function summarizeRepairResults(
  results: ResearchContinuityRepairRunResultResponse[],
): Pick<
  ResearchContinuityRepairRunResponse,
  'requested_count' | 'repaired_count' | 'skipped_count' | 'failed_count'
> {
  return {
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
  };
}

function createdEntryIds(
  results: ResearchContinuityRepairRunResultResponse[],
): string[] {
  return results
    .filter((result) => result.action === 'created_repair_entry')
    .map((result) => result.new_entry_id)
    .filter((id): id is string => Boolean(id));
}

function sanitizedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/)[0]?.slice(0, 500) || 'Repair run failed.';
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

function toDebugAccessAuditResponse(
  row: JsonRecord,
): ResearchContinuityDebugAccessAuditResponse {
  return {
    id: nullableString(row.id),
    workspace_id: nullableString(row.workspace_id),
    entry_id: stringValue(row.entry_id),
    research_run_id: nullableString(row.research_run_id),
    symbol: nullableString(row.symbol),
    requested_by_user_id: nullableString(row.requested_by_user_id),
    decision: debugAuditDecisionValue(row.decision) ?? 'denied',
    reason: debugAuditReasonValue(row.reason) ?? 'audit_unavailable',
    requested_at: nullableString(row.requested_at),
    metadata: recordValue(row.metadata ?? row.metadata_json),
  };
}

function toRepairRunResponse(
  row: JsonRecord,
): ResearchContinuityRepairRunResponse {
  const detail = toRepairRunDetailResponse(row);
  return {
    audit_run_id: detail.id,
    dry_run: detail.dry_run,
    status: detail.status,
    requested_count: detail.requested_count,
    repaired_count: detail.repaired_count,
    skipped_count: detail.skipped_count,
    failed_count: detail.failed_count,
    results: detail.results,
  };
}

function toRepairRunSummaryResponse(
  row: JsonRecord,
): ResearchContinuityRepairRunSummaryResponse {
  return {
    id: stringValue(row.id),
    workspace_id: stringValue(row.workspace_id),
    requested_by_user_id: stringValue(row.requested_by_user_id),
    requested_at: nullableString(row.requested_at),
    completed_at: nullableString(row.completed_at),
    dry_run: booleanValue(row.dry_run, true),
    status: repairRunStatusValue(row.status) ?? 'failed',
    idempotency_key: nullableString(row.idempotency_key),
    filters: recordValue(row.filters ?? row.filters_json),
    requested_count: numberValue(row.requested_count, 0),
    repaired_count: numberValue(row.repaired_count, 0),
    skipped_count: numberValue(row.skipped_count, 0),
    failed_count: numberValue(row.failed_count, 0),
    created_entry_ids: stringList(row.created_entry_ids ?? row.created_entry_ids_json),
    error_message: nullableString(row.error_message),
  };
}

function toRepairRunDetailResponse(
  row: JsonRecord,
): ResearchContinuityRepairRunDetailResponse {
  return {
    ...toRepairRunSummaryResponse(row),
    results: repairRunResults(row.results ?? row.results_json),
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
    payload: continuityEntryPayload(entry),
  };
}

function isRepairEntry(entry: JsonRecord): boolean {
  return Boolean(repairMetadataFromEntry(entry).is_repair);
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

function toLegacyEntryResponse(entry: JsonRecord): ResearchContinuityEntryResponse {
  const sections = arrayRecords(entry.sections);
  const snapshotQuality = recordValue(entry.snapshot_quality);
  const payload = continuityEntryPayload(entry);
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
    sections: sections.map((section) => ({
      title: stringValue(section.title),
      items: stringList(section.items),
      empty_state: stringValue(section.empty_state),
    })),
    events: arrayRecords(entry.events),
    snapshot_quality: snapshotQuality,
    source_run_ids: stringList(entry.source_run_ids),
    writer_metadata: recordValue(entry.writer_metadata),
    payload,
    thin_report:
      thinReportFromPayload(payload) ??
      buildLegacyThinReport({
        generatedAt: nullableString(entry.generated_at),
        sections,
        snapshotQuality,
      }),
  };
}

function toEntrySummaryResponse(
  entry: JsonRecord,
  canViewDebug: boolean,
): ResearchContinuityEntrySummaryResponse {
  const sections = arrayRecords(entry.sections);
  const snapshotQuality = recordValue(entry.snapshot_quality);
  const payload = continuityEntryPayload(entry);
  const id = nullableString(entry.id);
  return {
    id,
    workspace_id: stringValue(entry.workspace_id, 'local'),
    symbol: stringValue(entry.symbol),
    research_run_id: stringValue(entry.research_run_id),
    entry_type: entryTypeValue(entry.entry_type),
    status: entryStatusValue(entry.status),
    generated_at: nullableString(entry.generated_at),
    summary: stringValue(entry.summary),
    thin_report:
      thinReportFromPayload(payload) ??
      buildLegacyThinReport({
        generatedAt: nullableString(entry.generated_at),
        sections,
        snapshotQuality,
      }),
    diff_summary: buildDiffSummary(entry),
    debug: buildDebugAccess(id, canViewDebug),
  };
}

function throwDebugDisabled(): never {
  throw new ForbiddenException({
    statusCode: 403,
    code: 'debug_access_disabled',
    message: 'Research continuity debug access is disabled by policy.',
  });
}

function throwDebugPermissionRequired(error: unknown): never {
  if (!(error instanceof ForbiddenException)) {
    throw error;
  }
  throw new ForbiddenException({
    statusCode: 403,
    code: 'debug_permission_required',
    message: 'Research continuity debug access requires view_debug_trace.',
  });
}

function toEntryDetailResponse(
  entry: JsonRecord,
  canViewDebug: boolean,
): ResearchContinuityEntryDetailResponse {
  return {
    ...toEntrySummaryResponse(entry, canViewDebug),
    diff_report: buildDiffReport(entry),
    quality_explanation: buildQualityExplanation(entry),
    evidence_digest: buildEvidenceDigest(entry),
    material_events_digest: buildMaterialEventsDigest(entry),
    state_transition: buildStateTransitionDigest(entry),
  };
}

function toEntryDebugResponse(
  entry: JsonRecord,
  requestedByUserId: string,
): ResearchContinuityEntryDebugResponse {
  const legacy = toLegacyEntryResponse(entry);
  const redacted = redactForDebug({
    sections: legacy.sections,
    events: legacy.events,
    snapshot_quality: legacy.snapshot_quality,
    source_run_ids: legacy.source_run_ids,
    writer_metadata: legacy.writer_metadata,
    payload: legacy.payload,
  }) as ResearchContinuityEntryDebugResponse['entry'];
  return {
    id: legacy.id,
    workspace_id: legacy.workspace_id,
    symbol: legacy.symbol,
    research_run_id: legacy.research_run_id,
    generated_at: legacy.generated_at,
    debug_view: 'redacted',
    redacted: true,
    requested_by_user_id: requestedByUserId,
    returned_at: new Date().toISOString(),
    entry: redacted,
  };
}

function buildDebugAccess(
  entryId: string | null,
  canViewDebug: boolean,
): ResearchContinuityEntrySummaryResponse['debug'] {
  if (!entryId) {
    return {
      available: false,
      reason: 'not_available',
      requires_permission: RESEARCH_CONTINUITY_DEBUG_PERMISSION,
      url: null,
      redacted: true,
    };
  }
  if (!isResearchContinuityDebugEnabled()) {
    return {
      available: false,
      reason: 'disabled_by_policy',
      requires_permission: RESEARCH_CONTINUITY_DEBUG_PERMISSION,
      url: null,
      redacted: true,
    };
  }
  if (!canViewDebug) {
    return {
      available: false,
      reason: 'permission_required',
      requires_permission: RESEARCH_CONTINUITY_DEBUG_PERMISSION,
      url: null,
      redacted: true,
    };
  }
  return {
    available: true,
    reason: 'available',
    requires_permission: RESEARCH_CONTINUITY_DEBUG_PERMISSION,
    url: `/research-continuity/entries/${encodeURIComponent(entryId)}/debug`,
    redacted: true,
  };
}

function buildQualityExplanation(
  entry: JsonRecord,
): ResearchContinuityQualityExplanationResponse {
  const payload = continuityEntryPayload(entry);
  const thinQuality = recordValue(thinReportFromPayload(payload)?.quality);
  const snapshotQuality = recordValue(entry.snapshot_quality);
  const quality =
    Object.keys(snapshotQuality).length > 0 ? snapshotQuality : thinQuality;
  return {
    status: stringValue(quality.status, 'unknown'),
    score: numberOrNull(quality.score),
    observed_evidence_coverage: numberOrNull(
      quality.observed_evidence_coverage,
    ),
    evidence_coverage: numberOrNull(quality.evidence_coverage),
    provenance_status: nullableString(quality.provenance_status),
    warnings: stringList(quality.warnings),
    reasons: stringList(quality.reasons),
  };
}

function buildEvidenceDigest(
  entry: JsonRecord,
): ResearchContinuityEvidenceDigestResponse {
  const quality = buildQualityExplanation(entry);
  const snapshotQuality = recordValue(entry.snapshot_quality);
  const observedCount = numberOrNull(snapshotQuality.observed_evidence_count);
  const reasoningCount = numberOrNull(
    snapshotQuality.reasoning_only_item_count ??
      snapshotQuality.reasoning_evidence_count,
  );
  const missingCount = numberOrNull(
    snapshotQuality.missing_evidence_item_count ??
      snapshotQuality.missing_evidence_count,
  );
  const noEvidenceCount = numberOrNull(snapshotQuality.no_evidence_item_count);
  const staleCount = numberOrNull(
    snapshotQuality.stale_evidence_item_count ?? snapshotQuality.stale_count,
  );
  const observedCoverage = quality.observed_evidence_coverage;
  const missingCategories = stringList(
    snapshotQuality.missing_evidence_categories ??
      snapshotQuality.missing_categories,
  );
  const staleCategories = stringList(
    snapshotQuality.stale_evidence_categories ?? snapshotQuality.stale_categories,
  );
  return {
    observed_count: observedCount,
    reasoning_count: reasoningCount,
    missing_count: missingCount,
    no_evidence_count: noEvidenceCount,
    stale_count: staleCount,
    observed_coverage: observedCoverage,
    missing_categories: missingCategories,
    stale_categories: staleCategories,
    health_line: evidenceHealthLine({
      observedCoverage,
      missingCount,
      noEvidenceCount,
      staleCount,
      status: quality.status,
    }),
  };
}

function buildMaterialEventsDigest(
  entry: JsonRecord,
): ResearchContinuityMaterialEventDigestResponse[] {
  return arrayRecords(entry.events).slice(0, 10).map((event) => {
    const type = stringValue(event.event_type ?? event.type, 'event');
    return {
      type,
      label: type.replaceAll('_', ' '),
      severity: eventSeverityValue(event.severity),
      summary: materialEventSummary(event, type),
      evidence_status: nullableString(
        event.evidence_status ??
          recordValue(event.source).evidence_quality ??
          event.evidence_quality,
      ),
    };
  });
}

function buildStateTransitionDigest(
  entry: JsonRecord,
): ResearchContinuityStateTransitionDigestResponse {
  const transition = entryTypeValue(entry.entry_type);
  const previousEntryId = nullableString(entry.previous_entry_id);
  return {
    previous_entry_id: previousEntryId,
    current_snapshot_id: nullableString(entry.current_snapshot_id),
    source_run_ids: stringList(entry.source_run_ids),
    transition,
    reason: stateTransitionReason(transition, entryStatusValue(entry.status), previousEntryId),
  };
}

function evidenceHealthLine(input: {
  observedCoverage: number | null;
  missingCount: number | null;
  noEvidenceCount: number | null;
  staleCount: number | null;
  status: string;
}): string {
  const parts = [`Quality ${input.status || 'unknown'}.`];
  if (input.observedCoverage !== null) {
    parts.push(
      `Observed evidence covers ${Math.round(input.observedCoverage * 100)}%.`,
    );
  }
  const gaps =
    (input.missingCount ?? 0) +
    (input.noEvidenceCount ?? 0) +
    (input.staleCount ?? 0);
  if (gaps > 0) {
    parts.push(`${gaps} evidence gap${gaps === 1 ? '' : 's'} need review.`);
  } else {
    parts.push('No missing, stale, or absent evidence was reported.');
  }
  return parts.join(' ');
}

function materialEventSummary(event: JsonRecord, type: string): string {
  return stringValue(
    event.summary ??
      event.reason ??
      event.current_text ??
      event.to ??
      event.item_key,
    `${type.replaceAll('_', ' ')} recorded.`,
  );
}

function eventSeverityValue(
  value: unknown,
): ResearchContinuityMaterialEventDigestResponse['severity'] {
  const severity = stringValue(value).toLowerCase();
  if (['critical', 'high'].includes(severity)) {
    return 'critical';
  }
  if (['warning', 'medium'].includes(severity)) {
    return 'warning';
  }
  return 'info';
}

function stateTransitionReason(
  transition: ResearchContinuityStateTransitionDigestResponse['transition'],
  status: ResearchContinuityEntrySummaryResponse['status'],
  previousEntryId: string | null,
): string {
  if (transition === 'baseline') {
    return 'Baseline continuity entry created for this symbol.';
  }
  if (transition === 'skipped') {
    return 'Continuity was skipped because required structured data was unavailable.';
  }
  if (transition === 'degraded' || status === 'degraded') {
    return 'Continuity was generated with degraded source or evidence quality.';
  }
  return previousEntryId
    ? `Delta continuity entry compares against ${previousEntryId}.`
    : 'Delta continuity entry created without a previous entry reference.';
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

function normalizeEngineMarketType(value: unknown): 'spot' | 'perp' {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['perp', 'perpetual', 'future', 'futures'].includes(normalized)
    ? 'perp'
    : 'spot';
}

function engineRunMatchesContext(
  run: JsonRecord | null,
  symbol: string,
  marketType: 'spot' | 'perp',
): boolean {
  if (!run) {
    return false;
  }
  const runSymbol = normalizeContinuitySymbol(String(run.symbol ?? ''));
  const runMarketType = normalizeEngineMarketType(run.market_type);
  return runSymbol === symbol && runMarketType === marketType;
}

function buildLatestContinuityContext(input: {
  state: JsonRecord;
  latestEntry: JsonRecord;
  latestRun: JsonRecord | null;
  marketType: 'spot' | 'perp';
  workspaceId: string;
  symbol: string;
}): JsonRecord {
  const payload = recordValue(input.state.payload);
  const quality = stateRecordValue(input.state.data_quality, payload.data_quality);
  const currentView = stateRecordValue(
    input.state.current_view,
    payload.current_view,
  );
  const activeItems = stateArrayValue(input.state.active_items, payload.active_items);
  const recentResolvedItems = stateArrayValue(
    input.state.recent_resolved_items,
    payload.recent_resolved_items,
  );
  const recentInvalidatedItems = stateArrayValue(
    input.state.recent_invalidated_items,
    payload.recent_invalidated_items,
  );
  const generatedAt = nullableString(input.latestEntry.generated_at);
  return {
    schema_version: 'latest_continuity_context.v1',
    workspace_id: input.workspaceId,
    symbol: input.symbol,
    market_type: input.marketType,
    latest_entry_id: nullableString(input.latestEntry.id),
    latest_run_id: nullableString(input.latestRun?.id),
    generated_at: generatedAt,
    staleness: continuityStaleness(generatedAt),
    quality: {
      status: stringValue(
        quality.status,
        stringValue(input.latestEntry.status, 'unknown'),
      ),
      score: numberOrNull(quality.score),
      observed_evidence_coverage: numberOrNull(
        quality.observed_evidence_coverage,
      ),
      warnings: compactStringArray(quality.warnings, 5),
    },
    prior_view: {
      directional_bias: nullableString(currentView.directional_bias),
      risk_posture: nullableString(currentView.risk_posture),
      conviction: nullableString(currentView.conviction),
      time_context: nullableString(currentView.time_context),
    },
    active_thesis_items: compactContinuityItems(activeItems, ['claim'], 8),
    active_risks: compactContinuityItems(activeItems, ['risk'], 3),
    active_watchpoints: compactContinuityItems(activeItems, ['watchpoint'], 3),
    active_invalidations: compactContinuityItems(
      activeItems,
      ['invalidation'],
      3,
    ),
    recent_resolved_items: compactContinuityItems(recentResolvedItems, [], 2),
    recent_invalidated_items: compactContinuityItems(recentInvalidatedItems, [], 2),
    summary: truncateText(stringValue(input.latestEntry.summary, ''), 800),
  };
}

function continuityStaleness(generatedAt: string | null): JsonRecord {
  if (!generatedAt) {
    return { age_hours: null, is_stale: true, reason: 'missing_generated_at' };
  }
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) {
    return { age_hours: null, is_stale: true, reason: 'invalid_generated_at' };
  }
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  return {
    age_hours: Math.round(ageHours * 10) / 10,
    is_stale: ageHours > 72,
    reason: ageHours > 72 ? 'older_than_72h' : null,
  };
}

function compactContinuityItems(
  values: unknown[],
  allowedTypes: string[],
  limit: number,
): string[] {
  const items: string[] = [];
  for (const value of values) {
    const record = recordValue(value);
    const itemType = String(record.item_type ?? record.type ?? '')
      .trim()
      .toLowerCase();
    if (allowedTypes.length > 0 && !allowedTypes.includes(itemType)) {
      continue;
    }
    const text = truncateText(
      stringValue(record.text, stringValue(record.title, '')),
      240,
    );
    if (text && !items.includes(text)) {
      items.push(text);
    }
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

function compactStringArray(value: unknown, limit: number): string[] {
  return arrayValue(value)
    .map((item) => truncateText(String(item ?? '').trim(), 240))
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stateRecordValue(primary: unknown, fallback: unknown): JsonRecord {
  return Object.keys(recordValue(primary)).length > 0
    ? recordValue(primary)
    : recordValue(fallback);
}

function stateArrayValue(primary: unknown, fallback: unknown): unknown[] {
  return Array.isArray(primary) ? primary : arrayValue(fallback);
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
    : normalized;
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 20;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function normalizeTimelineLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

function normalizeTimelineItemType(
  value: unknown,
): ResearchContinuityLifecycleItemType | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const normalized = String(value);
  if (
    [
      'claim',
      'risk',
      'watchpoint',
      'level',
      'invalidation',
      'view',
      'quality',
      'unknown',
    ].includes(normalized)
  ) {
    return normalized as ResearchContinuityLifecycleItemType;
  }
  throw new BadRequestException('item_type must be a valid lifecycle item type');
}

function normalizeTimelineStatus(
  value: unknown,
): ResearchContinuityLifecycleStatus | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const normalized = String(value);
  if (
    [
      'active',
      'updated',
      'resolved',
      'weakened',
      'invalidated',
      'context',
      'quality',
    ].includes(normalized)
  ) {
    return normalized as ResearchContinuityLifecycleStatus;
  }
  throw new BadRequestException('status must be a valid lifecycle status');
}

function debugAuditDecisionValue(
  value: unknown,
): ResearchContinuityDebugAuditDecision | undefined {
  const normalized = stringValue(value);
  return ['allowed', 'denied'].includes(normalized)
    ? (normalized as ResearchContinuityDebugAuditDecision)
    : undefined;
}

function debugAuditReasonValue(
  value: unknown,
): ResearchContinuityDebugAuditReason | undefined {
  const normalized = stringValue(value);
  return [
    'allowed',
    'disabled_by_policy',
    'missing_user',
    'missing_workspace',
    'workspace_denied',
    'permission_required',
    'entry_not_found',
    'audit_unavailable',
  ].includes(normalized)
    ? (normalized as ResearchContinuityDebugAuditReason)
    : undefined;
}

function repairRunStatusValue(
  value: unknown,
): ResearchContinuityRepairRunStatus | undefined {
  const normalized = stringValue(value);
  return [
    'started',
    'completed',
    'completed_with_failures',
    'failed',
  ].includes(normalized)
    ? (normalized as ResearchContinuityRepairRunStatus)
    : undefined;
}

function repairRunResults(
  value: unknown,
): ResearchContinuityRepairRunResultResponse[] {
  return arrayRecords(value).map((result) => ({
    candidate_id: stringValue(result.candidate_id),
    run_id: stringValue(result.run_id),
    symbol: stringValue(result.symbol),
    case_type: repairCaseTypeValue(result.case_type),
    action: repairRunActionValue(result.action),
    previous_entry_id: nullableString(result.previous_entry_id),
    new_entry_id: nullableString(result.new_entry_id),
    state_updated: booleanValue(result.state_updated, false),
    reason: stringValue(result.reason),
    error: nullableString(result.error),
  }));
}

function repairCaseTypeValue(value: unknown): ResearchContinuityRepairCaseType {
  const normalized = stringValue(value);
  return RESEARCH_CONTINUITY_REPAIR_CASE_TYPES.includes(
    normalized as ResearchContinuityRepairCaseType,
  )
    ? (normalized as ResearchContinuityRepairCaseType)
    : 'missing_continuity';
}

function repairRunActionValue(
  value: unknown,
): ResearchContinuityRepairRunResultResponse['action'] {
  const normalized = stringValue(value);
  return [
    'created_repair_entry',
    'already_repaired',
    'already_has_continuity',
    'dry_run',
    'not_eligible',
    'not_improved',
    'failed',
  ].includes(normalized)
    ? (normalized as ResearchContinuityRepairRunResultResponse['action'])
    : 'failed';
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function continuityEntryPayload(entry: JsonRecord): JsonRecord {
  const payload = recordValue(entry.payload ?? entry.payload_json);
  const nestedPayload = recordValue(payload.payload);
  return hasContinuityEntryMetadata(nestedPayload) ? nestedPayload : payload;
}

function payloadWithThinReport(
  payload: JsonRecord,
  thinReport: ResearchContinuityThinReport,
): JsonRecord {
  return {
    ...payload,
    report_views: {
      ...recordValue(payload.report_views),
      thin: thinReport,
    },
  };
}

function thinReportFromPayload(
  payload: JsonRecord,
): ResearchContinuityThinReport | null {
  const thin = recordValue(recordValue(payload.report_views).thin);
  if (stringValue(thin.version) !== RESEARCH_CONTINUITY_THIN_REPORT_VERSION) {
    return null;
  }
  const quality = recordValue(thin.quality);
  return {
    version: RESEARCH_CONTINUITY_THIN_REPORT_VERSION,
    generated_at: nullableString(thin.generated_at),
    debug_available: Boolean(thin.debug_available),
    debug_requires_role: 'editor',
    quality: {
      status: stringValue(quality.status, 'unknown'),
      score: numberOrNull(quality.score),
      observed_evidence_coverage: numberOrNull(
        quality.observed_evidence_coverage,
      ),
      evidence_coverage: numberOrNull(quality.evidence_coverage),
      provenance_status: nullableString(quality.provenance_status),
      warnings: stringList(quality.warnings),
    },
    sections: arrayRecords(thin.sections)
      .map((section) => ({
        id: thinSectionIdValue(section.id),
        title: stringValue(section.title),
        items: stringList(section.items),
      }))
      .filter(
        (
          section,
        ): section is ResearchContinuityThinReport['sections'][number] =>
          section.id !== null,
      ),
  };
}

function thinSectionIdValue(
  value: unknown,
): ResearchContinuityThinSectionId | null {
  const normalized = stringValue(value);
  return [
    'quality',
    'current_view',
    'material_changes',
    'active_risks',
    'watchpoints',
    'resolved_or_weakened',
    'evidence_health',
  ].includes(normalized)
    ? (normalized as ResearchContinuityThinSectionId)
    : null;
}

function repairMetadataFromEntry(entry: JsonRecord): JsonRecord {
  return recordValue(continuityEntryPayload(entry).repair);
}

function hasContinuityEntryMetadata(payload: JsonRecord): boolean {
  return (
    payload.schema_version !== undefined ||
    payload.evidence_contract_version !== undefined ||
    payload.repair !== undefined ||
    payload.skip_reason !== undefined ||
    payload.report_views !== undefined
  );
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

function numberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberValue(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function isSchedulerWorkerEnabled(): boolean {
  return process.env.RESEARCH_CONTINUITY_SCHEDULER_ENABLED === 'true';
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function trimOptional(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_');
}
