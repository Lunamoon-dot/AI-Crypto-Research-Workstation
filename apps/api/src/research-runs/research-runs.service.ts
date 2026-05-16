import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  EngineRunRequest,
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { JobsService } from '../jobs/jobs.service';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  buildResearchRunStageTimings,
  EvidenceBundleResponse,
  JournalRunWorkspaceResponse,
  ResearchRunArtifactsResponse,
  ResearchRunDebateResponse,
  ResearchRunQueuedResponse,
  ResearchRunSnapshotsResponse,
  SignalDetailResponse,
  toAgentOpinionResponse,
  toDebateResponse,
  toEvidenceBundleResponse,
  toMarketSnapshotResponse,
  toResearchRunEventResponse,
  toResearchRunResponse,
  toScenarioResponse,
  toSignalDetailResponse,
  toSignalSnapshotResponse,
  toThesisResponse,
} from '../contracts/frontend-contract';
import { CreateResearchRunDto } from './dto/create-research-run.dto';
import {
  ExportedJournal,
  SqliteJournalSyncService,
} from '../jobs/sqlite-journal-sync.service';
import { MarketDataGuardService } from './market-data-guard.service';
import { normalizeCryptoSymbol } from '../common/market-symbols';

const ORPHANED_JOB_REASON = 'orphaned_job_state';
const ANALYST_KEYS = ['market', 'news', 'social', 'onchain'] as const;
const ANALYST_KEY_SET = new Set<string>(ANALYST_KEYS);
type JobStatus = Awaited<ReturnType<JobsService['getJobStatus']>>;

@Injectable()
export class ResearchRunsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly jobs: JobsService,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    @Optional()
    private readonly sqliteSync?: SqliteJournalSyncService,
    @Optional()
    private readonly marketDataGuard?: MarketDataGuardService,
  ) {}

  async list(
    filters: { symbol?: string; status?: string; limit?: number },
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspaceAccess(userId, workspaceHeader);
    const limit = normalizeLimit(filters.limit);
    const runs = await this.journal.listResearchRuns(
      {
        symbol: normalizeOptional(filters.symbol),
        status: undefined,
        limit,
      },
      workspaceId,
    );
    const reconciled = await Promise.all(
      runs.map((run) => this.reconcileRunLifecycle(run, workspaceId)),
    );
    const existingRunIds = new Set(
      reconciled
        .map((run) => stringField(run.id ?? run.run_id))
        .filter((runId): runId is string => Boolean(runId)),
    );
    const jobRuns = await this.jobRunsForHistory(
      workspaceId,
      existingRunIds,
      limit,
    );
    return [...reconciled, ...jobRuns]
      .filter((run) => runMatchesListFilters(run, filters))
      .sort((left, right) => compareRunRecency(left, right))
      .slice(0, limit)
      .map(toResearchRunResponse);
  }

  async create(
    dto: CreateResearchRunDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchRunQueuedResponse> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.assertRequestWorkspace(
      dto.workspace_id,
      workspaceHeader,
    );
    const permission = await this.workspaces.assertAccess(
      user,
      workspaceId,
      'editor',
    );
    const assetClass = dto.asset_class ?? 'crypto';
    const symbol = normalizeResearchSymbol(dto.symbol, assetClass);
    const request: EngineRunRequest = {
      run_id: dto.run_id ?? `run_${randomUUID().replaceAll('-', '')}`,
      workspace_id: workspaceId,
      symbol,
      asset_class: assetClass,
      market_type: dto.market_type ?? 'spot',
      analysis_date: dto.analysis_date,
      analysts: normalizeSelectedAnalysts(dto.analysts),
      config_profile: dto.config_profile ?? 'default',
      exchange: normalizeOptional(dto.exchange) ?? null,
      dry_run: dto.dry_run ?? false,
      metadata: dto.metadata ?? {},
    };
    await this.marketDataGuard?.assertAvailable({
      symbol: request.symbol,
      assetClass: request.asset_class,
      marketType: request.market_type,
      analysisDate: request.analysis_date,
      configProfile: request.config_profile,
      exchange: request.exchange ?? null,
    });
    const job = await this.jobs.enqueueResearchRun(request);
    return {
      run_id: request.run_id,
      workspace_id: request.workspace_id,
      status:
        job.backend === 'inline' && typeof job.result?.status === 'string'
          ? job.result.status
          : job.backend === 'inline'
            ? 'submitted'
            : 'queued',
      job_id: job.id,
      queue_backend: job.backend,
      permission,
      result: job.result,
    };
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspaceAccess(userId, workspaceHeader);
    const run = await this.getRawRunOrThrow(id, workspaceId);
    return toResearchRunResponse(run);
  }

  async events(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspaceAccess(userId, workspaceHeader);
    await this.getRawRunOrThrow(id, workspaceId);
    const events = await this.journal.listRunEvents(id, workspaceId);
    return events.map(toResearchRunEventResponse);
  }

  async snapshots(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchRunSnapshotsResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(userId, workspaceHeader);
    const run = await this.getRawRunOrThrow(id, workspaceId);
    const marketSnapshotId = stringField(run.market_snapshot_id);
    const signalSnapshotId = stringField(run.signal_snapshot_id);
    const [marketSnapshot, signalSnapshot] = await Promise.all([
      marketSnapshotId
        ? this.journal.getMarketSnapshot(marketSnapshotId, workspaceId)
        : Promise.resolve(null),
      signalSnapshotId
        ? this.journal.getSignalSnapshot(signalSnapshotId, workspaceId)
        : Promise.resolve(null),
    ]);
    return {
      market_snapshot: marketSnapshot
        ? toMarketSnapshotResponse(marketSnapshot)
        : null,
      signal_snapshot: signalSnapshot
        ? toSignalSnapshotResponse(signalSnapshot)
        : null,
    };
  }

  async debate(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchRunDebateResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(userId, workspaceHeader);
    const run = await this.getRawRunOrThrow(id, workspaceId);
    const debateId = stringField(run.debate_id);
    if (!debateId) {
      return { debate: null, agent_opinions: [] };
    }
    const debate = await this.journal.getDebate(debateId, workspaceId);
    if (!debate) {
      return { debate: null, agent_opinions: [] };
    }
    const opinions = await this.journal.listAgentOpinions(debateId, workspaceId);
    return {
      debate: toDebateResponse(debate),
      agent_opinions: opinions.map(toAgentOpinionResponse),
    };
  }

  async workspace(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<JournalRunWorkspaceResponse> {
    const workspaceId = await this.resolveWorkspaceAccess(userId, workspaceHeader);
    try {
      return await this.workspaceFromJournal(id, workspaceId, userId);
    } catch (error) {
      if (!canUseSqliteFallback(error)) {
        throw error;
      }
      const sqliteWorkspace = await this.workspaceFromSqlite(id, workspaceId);
      if (sqliteWorkspace) {
        return sqliteWorkspace;
      }
      const jobWorkspace = await this.workspaceFromJob(id, workspaceId);
      if (jobWorkspace) {
        return jobWorkspace;
      }
      throw error;
    }
  }

  async evidenceBundle(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<EvidenceBundleResponse> {
    const workspace = await this.workspace(id, userId, workspaceHeader);
    const signalDetails = await this.signalDetailsForBundle(workspace, id);
    return toEvidenceBundleResponse(workspace, signalDetails);
  }

  private async resolveWorkspaceAccess(
    userId?: string,
    workspaceHeader?: string,
    requiredRole: 'viewer' | 'editor' = 'viewer',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }

  private async getRawRunOrThrow(id: string, workspaceId: string) {
    const run = await this.journal.getResearchRun(id, workspaceId);
    if (!run) {
      throw new NotFoundException(`Research run ${id} not found`);
    }
    return this.reconcileRunLifecycle(run, workspaceId);
  }

  private async reconcileRunLifecycle(
    run: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const runId = stringField(run.id ?? run.run_id);
    if (!runId || !isActiveResearchRunStatus(stringField(run.status))) {
      return run;
    }

    try {
      const job = await this.jobs.getJobStatus(runId);
      if (['failed', 'cancelled', 'timed_out'].includes(job.status)) {
        return this.markRunFailed(run, workspaceId, {
          reason: jobFailureReason(job.status),
          message:
            job.error_message ??
            'Research run job ended before completion; no complete artifacts were persisted.',
          completedAt: job.completed_at ?? undefined,
        });
      }
      return run;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      return this.markRunFailed(run, workspaceId, {
        reason: ORPHANED_JOB_REASON,
        message:
          'Research run marked failed because no durable job lifecycle record was found before completion.',
      });
    }
  }

  private async markRunFailed(
    run: JsonRecord,
    workspaceId: string,
    failure: { reason: string; message: string; completedAt?: string },
  ): Promise<JsonRecord> {
    const runId = stringField(run.id ?? run.run_id);
    if (!runId) {
      return run;
    }
    try {
      const failedRun = await this.journal.markResearchRunFailed(
        runId,
        workspaceId,
        failure,
      );
      return (
        failedRun ?? withFailedRunFields(run, failure.reason, failure.completedAt)
      );
    } catch (error) {
      if (canUseSqliteFallback(error)) {
        return withFailedRunFields(run, failure.reason, failure.completedAt);
      }
      throw error;
    }
  }

  private async workspaceFromJournal(
    id: string,
    workspaceId: string,
    userId?: string,
  ): Promise<JournalRunWorkspaceResponse> {
    const run = await this.getRawRunOrThrow(id, workspaceId);
    const thesisId = stringField(run.thesis_id);
    const [events, snapshots, debate, thesis] = await Promise.all([
      this.journal.listRunEvents(id, workspaceId),
      this.snapshots(id, userId, workspaceId),
      this.debate(id, userId, workspaceId),
      thesisId
        ? this.journal.getThesis(thesisId, workspaceId)
        : Promise.resolve(null),
    ]);
    const scenarios =
      thesisId && thesis
        ? await this.journal.listScenarios(thesisId, workspaceId)
        : [];
    const runResponse = toResearchRunResponse(run);
    const eventResponses = events.map(toResearchRunEventResponse);
    return {
      run: runResponse,
      events: eventResponses,
      stage_timings: buildResearchRunStageTimings(runResponse, eventResponses),
      snapshots,
      debate,
      thesis: thesis ? toThesisResponse(thesis) : null,
      scenarios: scenarios.map(toScenarioResponse),
      artifacts: buildResearchRunArtifacts(run),
    };
  }

  private async workspaceFromJob(
    id: string,
    workspaceId: string,
    options: { activeOnly?: boolean } = {},
  ): Promise<JournalRunWorkspaceResponse | null> {
    let job;
    try {
      job = await this.jobs.getJobStatus(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }

    if (job.workspace_id !== workspaceId) {
      return null;
    }
    if (options.activeOnly && !isActiveResearchRunStatus(job.status)) {
      return null;
    }

    const request = await this.jobs.getJobRequest(id);
    if (!request) {
      return null;
    }

    const run = activeRunFromJob(request, job);
    const runResponse = toResearchRunResponse(run);
    const eventResponses = jobEvents(request, job).map(toResearchRunEventResponse);
    return {
      run: runResponse,
      events: eventResponses,
      stage_timings: buildResearchRunStageTimings(runResponse, eventResponses),
      snapshots: {
        market_snapshot: null,
        signal_snapshot: null,
      },
      debate: {
        debate: null,
        agent_opinions: [],
      },
      thesis: null,
      scenarios: [],
      artifacts: buildResearchRunArtifacts(run),
    };
  }

  private async jobRunsForHistory(
    workspaceId: string,
    existingRunIds: Set<string>,
    limit: number,
  ): Promise<JsonRecord[]> {
    const jobs = await this.jobs.listJobStatuses(workspaceId, limit);
    const runs = await Promise.all(
      jobs.map(async (job) => {
        if (existingRunIds.has(job.run_id)) {
          return null;
        }
        const request = await this.jobs.getJobRequest(job.id);
        if (!request) {
          return null;
        }
        return activeRunFromJob(request, job);
      }),
    );
    return runs.filter((run): run is JsonRecord => Boolean(run));
  }

  private async workspaceFromSqlite(
    id: string,
    workspaceId: string,
  ): Promise<JournalRunWorkspaceResponse | null> {
    const exported = await this.sqliteSync?.exportRun(id);
    if (!exported) {
      return null;
    }
    const exportedRun = firstRow(exported, 'research_runs');
    if (!exportedRun || stringField(exportedRun.workspace_id) !== workspaceId) {
      return null;
    }
    const run = await this.reconcileRunLifecycle(exportedRun, workspaceId);

    const marketSnapshot = findByIdOrFirst(
      rows(exported, 'market_snapshots'),
      stringField(run.market_snapshot_id),
    );
    const signalSnapshot = findByIdOrFirst(
      rows(exported, 'signal_snapshots'),
      stringField(run.signal_snapshot_id),
    );
    const debate = findByIdOrFirst(
      rows(exported, 'debates'),
      stringField(run.debate_id),
    );
    const thesis = findByIdOrFirst(
      rows(exported, 'trade_theses'),
      stringField(run.thesis_id),
    );
    const thesisId = thesis ? stringField(thesis.id) : null;
    const scenarios = thesisId
      ? rows(exported, 'scenarios').filter(
          (scenario) => stringField(scenario.thesis_id) === thesisId,
        )
      : [];
    const debateId = debate ? stringField(debate.id) : null;
    const agentOpinions = debateId
      ? rows(exported, 'agent_opinions').filter(
          (opinion) => stringField(opinion.debate_id) === debateId,
        )
      : rows(exported, 'agent_opinions');

    const events = rows(exported, 'run_events');
    const runResponse = toResearchRunResponse(run);
    const eventResponses = appendRecoveredFailureEvent(events, run).map(
      toResearchRunEventResponse,
    );
    return {
      run: runResponse,
      events: eventResponses,
      stage_timings: buildResearchRunStageTimings(runResponse, eventResponses),
      snapshots: {
        market_snapshot: marketSnapshot
          ? toMarketSnapshotResponse(marketSnapshot)
          : null,
        signal_snapshot: signalSnapshot
          ? toSignalSnapshotResponse(signalSnapshot)
          : null,
      },
      debate: {
        debate: debate ? toDebateResponse(debate) : null,
        agent_opinions: agentOpinions.map(toAgentOpinionResponse),
      },
      thesis: thesis ? toThesisResponse(thesis) : null,
      scenarios: scenarios.map(toScenarioResponse),
      artifacts: buildResearchRunArtifacts(run),
    };
  }

  private async signalDetailsForBundle(
    workspace: JournalRunWorkspaceResponse,
    runId: string,
  ): Promise<SignalDetailResponse[]> {
    const ids = uniqueStrings([
      ...(workspace.thesis?.supporting_signal_ids ?? []),
      ...(workspace.thesis?.contradicting_signal_ids ?? []),
    ]);
    if (ids.length === 0) {
      return [];
    }
    const signals = await Promise.all(
      ids.map(async (signalId) => {
        try {
          return await this.journal.getSignal(signalId, workspace.run.workspace_id);
        } catch (error) {
          if (canUseSqliteFallback(error)) {
            return null;
          }
          throw error;
        }
      }),
    );
    const details = signals
      .filter((signal): signal is JsonRecord => Boolean(signal))
      .map(toSignalDetailResponse);
    if (details.length === ids.length) {
      return details;
    }
    const existingIds = new Set(details.map((signal) => signal.id).filter(Boolean));
    const sqliteExport = await this.sqliteSync?.exportRun(runId);
    if (!sqliteExport) {
      return details;
    }
    const sqliteSignals = rows(sqliteExport, 'signals')
      .filter((signal) => {
        const id = stringField(signal.id);
        return id && ids.includes(id) && !existingIds.has(id);
      })
      .map(toSignalDetailResponse);
    return [...details, ...sqliteSignals];
  }
}

function buildResearchRunArtifacts(run: JsonRecord): ResearchRunArtifactsResponse {
  const symbol = stringField(run.symbol) ?? 'unknown';
  const analysisDate = researchDateComponent(run);
  const resultsDir = resolveResultsDir();
  const runStartedAt = timestampFromValue(run.started_at ?? run.created_at);
  const fullReportPath = join(
    resultsDir,
    reportTickerComponent(symbol),
    analysisDate,
    'complete_report.md',
  );
  const fullStatePath = join(
    resultsDir,
    stateTickerComponent(symbol),
    'ResearchWorkspace_logs',
    `full_states_log_${analysisDate}.json`,
  );

  return {
    full_report: artifactFromPath(
      'full_report',
      'Full report',
      fullReportPath,
      runStartedAt,
    ),
    full_state: artifactFromPath(
      'full_state',
      'Full state JSON',
      fullStatePath,
      runStartedAt,
    ),
  };
}

function activeRunFromJob(
  request: EngineRunRequest,
  job: JobStatus,
): JsonRecord {
  return {
    id: request.run_id,
    run_id: request.run_id,
    workspace_id: request.workspace_id,
    symbol: request.symbol,
    asset_class: request.asset_class,
    market_type: request.market_type,
    timeframe: request.analysis_date,
    analysis_date: request.analysis_date,
    status: runStatusFromJob(job),
    started_at: job.started_at,
    completed_at: job.completed_at,
    thesis_id: null,
    decision_id: null,
    signal_snapshot_id: null,
    market_snapshot_id: null,
    degradation_reasons: job.error_code ? [job.error_code] : [],
    missing_core_data: [],
    missing_optional_data: [],
  };
}

function runStatusFromJob(job: JobStatus): string {
  if (job.status === 'completed') {
    return stringField(job.result_summary?.status) ?? 'completed';
  }
  return job.status;
}

function runMatchesListFilters(
  run: JsonRecord,
  filters: { symbol?: string; status?: string; limit?: number },
): boolean {
  const symbol = normalizeOptional(filters.symbol);
  if (symbol && stringField(run.symbol) !== symbol) {
    return false;
  }
  const status = normalizeOptional(filters.status);
  if (!status) {
    return true;
  }
  const runStatus = stringField(run.status);
  return status === 'completed'
    ? runStatus === 'completed' || runStatus === 'completed_degraded'
    : runStatus === status;
}

function compareRunRecency(left: JsonRecord, right: JsonRecord): number {
  return (
    runRecencyTimestamp(right) - runRecencyTimestamp(left) ||
    (stringField(right.id ?? right.run_id) ?? '').localeCompare(
      stringField(left.id ?? left.run_id) ?? '',
    )
  );
}

function runRecencyTimestamp(run: JsonRecord): number {
  const raw =
    stringField(run.started_at) ??
    stringField(run.created_at) ??
    stringField(run.completed_at);
  const timestamp = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function jobEvents(request: EngineRunRequest, job: JobStatus): JsonRecord[] {
  const basePayload = {
    run_id: request.run_id,
    symbol: request.symbol,
    market_type: request.market_type,
    analysts: request.analysts,
    backend: job.backend,
    progress: job.progress,
  };
  const events: JsonRecord[] = [
    {
      id: null,
      workspace_id: request.workspace_id,
      research_run_id: request.run_id,
      thesis_id: null,
      event_type: 'run.queued',
      created_at: job.created_at,
      message: 'Research job accepted by the API queue.',
      payload: basePayload,
    },
  ];

  if (job.started_at) {
    events.push({
      id: null,
      workspace_id: request.workspace_id,
      research_run_id: request.run_id,
      thesis_id: null,
      event_type: 'run.started',
      created_at: job.started_at,
      message: 'Research engine is running.',
      payload: basePayload,
    });
  }

  if (job.completed_at) {
    events.push({
      id: null,
      workspace_id: request.workspace_id,
      research_run_id: request.run_id,
      thesis_id: null,
      event_type: `run.${job.status}`,
      created_at: job.completed_at,
      message: job.error_message ?? `Research job ${job.status}.`,
      payload: {
        ...basePayload,
        result: job.result_summary ?? null,
        error_code: job.error_code,
      },
    });
  }

  return events;
}

function artifactFromPath(
  kind: 'full_report' | 'full_state',
  label: string,
  path: string,
  runStartedAt: Date | null,
) {
  const stats = fileStats(path);
  const freshStats =
    stats && artifactBelongsToRun(stats.mtime, runStartedAt) ? stats : null;
  return {
    kind,
    label,
    path,
    exists: Boolean(freshStats),
    size_bytes: freshStats?.size ?? null,
    modified_at: freshStats?.mtime.toISOString() ?? null,
  };
}

function artifactBelongsToRun(modifiedAt: Date, runStartedAt: Date | null): boolean {
  if (!runStartedAt) {
    return true;
  }
  return modifiedAt.getTime() >= runStartedAt.getTime() - 5000;
}

function timestampFromValue(value: unknown): Date | null {
  const raw = stringField(value);
  if (!raw) {
    return null;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function fileStats(path: string) {
  try {
    if (!existsSync(path)) {
      return null;
    }
    const stats = statSync(path);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function resolveResultsDir(): string {
  const configured = process.env.TRADINGAGENTS_RESULTS_DIR?.trim();
  return configured
    ? resolve(configured)
    : join(homedir(), '.tradingagents', 'logs');
}

function researchDateComponent(run: JsonRecord): string {
  const raw =
    stringField(run.timeframe) ??
    stringField(run.analysis_date) ??
    stringField(run.trade_date) ??
    datePart(stringField(run.started_at));
  const date = datePart(raw) ?? 'unknown';
  return date.replace(/[^0-9-]/g, '_') || 'unknown';
}

function datePart(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function reportTickerComponent(symbol: string): string {
  return safeArtifactComponent(symbol, '-');
}

function stateTickerComponent(symbol: string): string {
  return safeArtifactComponent(symbol, '_');
}

function safeArtifactComponent(symbol: string, separatorReplacement: string): string {
  const trimmed = symbol.trim();
  if (!trimmed || trimmed.includes('..')) {
    return 'unknown';
  }
  const sanitized = trimmed
    .replace(/[\\/:]/g, separatorReplacement)
    .replace(/[^A-Za-z0-9._\-\^]/g, '_')
    .slice(0, 64);
  if (!sanitized || /^[.]+$/.test(sanitized)) {
    return 'unknown';
  }
  return sanitized;
}

function stringField(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSelectedAnalysts(values: string[]): string[] {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => ANALYST_KEY_SET.has(value));
  const unique = [...new Set(normalized)];
  if (unique.length === 0) {
    return [...ANALYST_KEYS];
  }
  return unique;
}

function normalizeResearchSymbol(symbol: string, assetClass: string): string {
  const trimmed = symbol.trim();
  if (assetClass.trim().toLowerCase() !== 'crypto') {
    return trimmed;
  }
  return normalizeCryptoSymbol(trimmed);
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function isActiveResearchRunStatus(status: string | null): boolean {
  return status === 'created' || status === 'queued' || status === 'running';
}

function jobFailureReason(status: string): string {
  if (status === 'timed_out') {
    return 'engine_job_timed_out';
  }
  if (status === 'cancelled') {
    return 'engine_job_cancelled';
  }
  return 'engine_job_failed';
}

function withFailedRunFields(
  run: JsonRecord,
  reason: string,
  completedAt?: string,
): JsonRecord {
  return {
    ...run,
    status: 'failed',
    completed_at: completedAt ?? new Date().toISOString(),
    degradation_reasons: appendString(run.degradation_reasons, reason),
    missing_core_data: appendString(run.missing_core_data, reason),
  };
}

function appendString(value: unknown, item: string): string[] {
  const current = Array.isArray(value)
    ? value.map((entry) => stringField(entry)).filter((entry): entry is string => !!entry)
    : [];
  return current.includes(item) ? current : [...current, item];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function appendRecoveredFailureEvent(
  events: JsonRecord[],
  run: JsonRecord,
): JsonRecord[] {
  if (
    run.status !== 'failed' ||
    !Array.isArray(run.degradation_reasons) ||
    !run.degradation_reasons.includes(ORPHANED_JOB_REASON) ||
    events.some((event) => event.event_type === 'run.failed')
  ) {
    return events;
  }
  const runId = stringField(run.id ?? run.run_id);
  return [
    ...events,
    {
      id: null,
      workspace_id: stringField(run.workspace_id) ?? 'local',
      research_run_id: runId,
      thesis_id: null,
      event_type: 'run.failed',
      created_at: stringField(run.completed_at),
      message:
        'Research run marked failed because no durable job lifecycle record was found before completion.',
      payload: {
        event: 'research_run_failed',
        failure_reason: ORPHANED_JOB_REASON,
        run_id: runId,
        source: 'api_recovery',
      },
    },
  ];
}

function canUseSqliteFallback(error: unknown): boolean {
  if (
    error instanceof NotFoundException ||
    error instanceof ServiceUnavailableException
  ) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === 'string' &&
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'].includes(code)
  );
}

function firstRow(exported: ExportedJournal, table: string): JsonRecord | null {
  return rows(exported, table)[0] ?? null;
}

function rows(exported: ExportedJournal, table: string): JsonRecord[] {
  return (exported[table] ?? []).map(normalizeSqliteRow);
}

function findByIdOrFirst(
  candidates: JsonRecord[],
  id: string | null,
): JsonRecord | null {
  if (id) {
    const match = candidates.find((candidate) => stringField(candidate.id) === id);
    if (match) {
      return match;
    }
  }
  return candidates[0] ?? null;
}

function normalizeSqliteRow(row: JsonRecord): JsonRecord {
  const normalized: JsonRecord = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = key.endsWith('_json') ? parseJsonValue(value) : value;
  }
  const payload = recordFromValue(normalized.payload_json);
  if (payload) {
    const columns = { ...normalized };
    Object.assign(normalized, payload, columns, {
      payload,
      payload_json: payload,
    });
  }
  aliasJsonColumn(normalized, 'degradation_reasons_json', 'degradation_reasons');
  aliasJsonColumn(normalized, 'missing_core_data_json', 'missing_core_data');
  aliasJsonColumn(
    normalized,
    'missing_optional_data_json',
    'missing_optional_data',
  );
  return normalized;
}

function aliasJsonColumn(
  row: JsonRecord,
  source: string,
  target: string,
): void {
  if (row[target] === undefined && row[source] !== undefined) {
    row[target] = row[source];
  }
}

function recordFromValue(value: unknown): JsonRecord | null {
  const parsed = parseJsonValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as JsonRecord;
  }
  return null;
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
