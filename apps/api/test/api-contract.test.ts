import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import {
  EngineRunRequest,
  JournalRepository,
  JsonRecord,
  SignalSummary,
  ThesisEvaluationInput,
  ThesisEvaluationPromotionInput,
  ThesisEvaluationRunInput,
  ThesisDecisionIntent,
  ThesisReviewMetrics,
} from '../src/database/journal.types';
import { AuthService } from '../src/auth/auth.service';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { JobLifecycleService } from '../src/jobs/job-lifecycle.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobsController } from '../src/jobs/jobs.controller';
import { PythonEngineClient } from '../src/jobs/python-engine.client';
import { ResearchJobProcessor } from '../src/jobs/research-job.processor';
import { SqliteJournalSyncService } from '../src/jobs/sqlite-journal-sync.service';
import { ResearchRunsController } from '../src/research-runs/research-runs.controller';
import { CreateResearchRunDto } from '../src/research-runs/dto/create-research-run.dto';
import { MarketDataGuardService } from '../src/research-runs/market-data-guard.service';
import { ResearchRunsService } from '../src/research-runs/research-runs.service';
import { SignalsController } from '../src/signals/signals.controller';
import { SignalsService } from '../src/signals/signals.service';
import {
  PatchThesisMonitorPlanDto,
  RunThesisPulseMemoDto,
  RunThesisPulseDto,
  RunThesisSchedulerDto,
} from '../src/theses/dto/thesis-monitoring.dto';
import { ThesesController } from '../src/theses/theses.controller';
import { MonitoringJobsService } from '../src/theses/monitoring-jobs.service';
import { ThesesService } from '../src/theses/theses.service';
import { MarketDataController } from '../src/market-data/market-data.controller';
import { MarketOhlcvService } from '../src/market-data/market-ohlcv.service';
import { MarketPriceService } from '../src/market-data/market-price.service';
import { WatchlistsService } from '../src/watchlists/watchlists.service';
import { BriefsService } from '../src/briefs/briefs.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { CalibrationService } from '../src/calibration/calibration.service';
import { CreateEvaluationRerunDto } from '../src/calibration/dto/evaluation-rerun.dto';
import { PerformanceService } from '../src/performance/performance.service';
import { ComparisonsService } from '../src/comparisons/comparisons.service';
import { ScenariosService } from '../src/scenarios/scenarios.service';
import { OperationsService } from '../src/operations/operations.service';
import { WorkbenchService } from '../src/workbench/workbench.service';
import { ResearchContinuityController } from '../src/research-continuity/research-continuity.controller';
import { ResearchContinuityService } from '../src/research-continuity/research-continuity.service';
import {
  openApiDocument,
} from '../src/contracts/openapi.generated';
import {
  toThesisMonitorPlanResponse,
  toThesisPulseMemoResponse,
  toThesisPulseResponse,
  toThesisResponse,
} from '../src/contracts/frontend-contract';
import {
  normalizeEvidenceItems,
  normalizeResearchItems,
  researchItemTextList,
} from '../src/contracts/research-evidence';

class FakeJournalRepository implements JournalRepository {
  readonly researchRuns = new Map<string, JsonRecord>();
  readonly events = new Map<string, JsonRecord[]>();
  readonly marketSnapshots = new Map<string, JsonRecord>();
  readonly signalSnapshots = new Map<string, JsonRecord>();
  readonly debates = new Map<string, JsonRecord>();
  readonly agentOpinions = new Map<string, JsonRecord[]>();
  readonly theses = new Map<string, JsonRecord>();
  readonly thesisEvaluations = new Map<string, JsonRecord>();
  readonly thesisEvaluationRuns = new Map<string, JsonRecord>();
  readonly thesisEvaluationPromotions = new Map<string, JsonRecord>();
  readonly monitorPlans = new Map<string, JsonRecord>();
  readonly thesisPulses = new Map<string, JsonRecord[]>();
  readonly thesisPulseMemos = new Map<string, JsonRecord[]>();
  readonly monitoringJobs: JsonRecord[] = [];
  readonly monitoringRetentionRuns: JsonRecord[] = [];
  monitoringHealth: JsonRecord | null = null;
  readonly scenarios = new Map<string, JsonRecord[]>();
  readonly signals: JsonRecord[] = [];
  readonly watchlists: JsonRecord[] = [];
  readonly watchlistItems: JsonRecord[] = [];
  readonly briefs: JsonRecord[] = [];
  readonly alerts: JsonRecord[] = [];
  readonly outcomeReviews: JsonRecord[] = [];
  readonly providerHealthRows: JsonRecord[] = [];
  readonly llmCalls: JsonRecord[] = [];
  readonly freshnessChecks: JsonRecord[] = [];
  readonly researchSnapshots = new Map<string, JsonRecord>();
  readonly continuityEntries = new Map<string, JsonRecord>();
  readonly continuityStates = new Map<string, JsonRecord>();
  readonly decisionCalls: Array<{
    thesisId: string;
    action: string;
    notes: string;
    workspaceId: string;
    intent?: ThesisDecisionIntent;
  }> = [];
  readonly reviewCalls: Array<{
    thesisId: string;
    result: string;
    notes: string;
    workspaceId: string;
    metrics?: ThesisReviewMetrics;
  }> = [];

  async listResearchRuns(
    filters: { symbol?: string; status?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.researchRuns.values()]
      .filter((run) => run.workspace_id === workspaceId)
      .filter((run) => !filters.symbol || run.symbol === filters.symbol)
      .filter((run) => !filters.status || run.status === filters.status)
      .slice(0, filters.limit);
  }

  async getResearchRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.researchRuns.get(key(id, workspaceId)) ?? null;
  }

  async markResearchRunFailed(
    id: string,
    workspaceId: string,
    failure: { reason: string; message: string; completedAt?: string },
  ): Promise<JsonRecord | null> {
    const run = this.researchRuns.get(key(id, workspaceId));
    if (!run) {
      return null;
    }
    if (['created', 'queued', 'running'].includes(String(run.status))) {
      const completedAt =
        failure.completedAt ?? new Date('2026-05-12T00:00:00.000Z').toISOString();
      run.status = 'failed';
      run.completed_at = completedAt;
      run.degradation_reasons = appendUniqueString(
        run.degradation_reasons,
        failure.reason,
      );
      run.missing_core_data = appendUniqueString(
        run.missing_core_data,
        failure.reason,
      );
      const events = this.events.get(key(id, workspaceId)) ?? [];
      events.push({
        id: `event_${events.length + 1}`,
        workspace_id: workspaceId,
        research_run_id: id,
        event_type: 'run.failed',
        created_at: completedAt,
        message: failure.message,
        payload: {
          event: 'research_run_failed',
          failure_reason: failure.reason,
        },
      });
      this.events.set(key(id, workspaceId), events);
    }
    return run;
  }

  async listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]> {
    return this.events.get(key(runId, workspaceId)) ?? [];
  }

  async getMarketSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.marketSnapshots.get(key(id, workspaceId)) ?? null;
  }

  async getLatestMarketSnapshot(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.marketSnapshots.values()]
        .filter(
          (snapshot) =>
            snapshot.workspace_id === workspaceId && snapshot.symbol === symbol,
        )
        .sort((a, b) =>
          String(b.captured_at ?? '').localeCompare(String(a.captured_at ?? '')),
        )[0] ?? null
    );
  }

  async saveMarketSnapshot(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = {
      ...snapshot,
      workspace_id: workspaceId,
    };
    this.marketSnapshots.set(key(String(saved.id), workspaceId), saved);
    return saved;
  }

  async listEnabledWatchlists(limit: number): Promise<JsonRecord[]> {
    return this.watchlists
      .filter(
        (watchlist) => watchlist.enabled !== false && watchlist.enabled !== 0,
      )
      .sort((a, b) =>
        String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
      )
      .slice(0, limit);
  }

  async getSignalSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.signalSnapshots.get(key(id, workspaceId)) ?? null;
  }

  async getResearchSnapshotByRun(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.researchSnapshots.values()].find(
        (snapshot) =>
          snapshot.workspace_id === workspaceId &&
          snapshot.research_run_id === runId,
      ) ?? null
    );
  }

  async saveResearchSnapshot(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...snapshot, workspace_id: workspaceId };
    this.researchSnapshots.set(key(String(saved.id), workspaceId), saved);
    return saved;
  }

  async getResearchContinuityEntry(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.continuityEntries.get(key(id, workspaceId)) ?? null;
  }

  async listResearchRunsForContinuityRepair(
    filters: { symbol?: string; from?: string; to?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.researchRuns.values()]
      .filter((run) => run.workspace_id === workspaceId)
      .filter((run) =>
        ['completed', 'completed_degraded'].includes(String(run.status)),
      )
      .filter((run) => !filters.symbol || run.symbol === filters.symbol)
      .filter((run) => {
        const timestamp = String(run.completed_at ?? run.started_at ?? '');
        return (
          (!filters.from || timestamp >= filters.from) &&
          (!filters.to || timestamp <= filters.to)
        );
      })
      .sort(
        (left, right) =>
          String(left.completed_at ?? left.started_at ?? '').localeCompare(
            String(right.completed_at ?? right.started_at ?? ''),
          ) || String(left.id ?? '').localeCompare(String(right.id ?? '')),
      )
      .slice(0, filters.limit);
  }

  async getLatestResearchContinuityEntryForRun(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.continuityEntries.values()]
        .filter(
          (entry) =>
            entry.workspace_id === workspaceId &&
            entry.research_run_id === runId,
        )
        .sort((a, b) =>
          String(b.generated_at ?? '').localeCompare(String(a.generated_at ?? '')) ||
          String(b.id ?? '').localeCompare(String(a.id ?? '')),
        )[0] ?? null
    );
  }

  async getLatestResearchContinuityEntryBeforeRun(
    symbol: string,
    before: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.continuityEntries.values()]
        .filter(
          (entry) =>
            entry.workspace_id === workspaceId &&
            entry.symbol === symbol &&
            entry.current_snapshot_id &&
            ['completed', 'degraded'].includes(String(entry.status)),
        )
        .filter((entry) => {
          const run = this.researchRuns.get(
            key(String(entry.research_run_id ?? ''), workspaceId),
          );
          const timestamp = String(run?.completed_at ?? run?.started_at ?? '');
          return Boolean(timestamp) && timestamp < before;
        })
        .sort((a, b) => {
          const runA = this.researchRuns.get(
            key(String(a.research_run_id ?? ''), workspaceId),
          );
          const runB = this.researchRuns.get(
            key(String(b.research_run_id ?? ''), workspaceId),
          );
          return (
            String(runB?.completed_at ?? runB?.started_at ?? '').localeCompare(
              String(runA?.completed_at ?? runA?.started_at ?? ''),
            ) ||
            String(b.generated_at ?? '').localeCompare(String(a.generated_at ?? '')) ||
            String(b.id ?? '').localeCompare(String(a.id ?? ''))
          );
        })[0] ?? null
    );
  }

  async getLatestCompletedResearchRunForContinuity(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.researchRuns.values()]
        .filter(
          (run) =>
            run.workspace_id === workspaceId &&
            run.symbol === symbol &&
            ['completed', 'completed_degraded'].includes(String(run.status)),
        )
        .sort(
          (left, right) =>
            String(right.completed_at ?? right.started_at ?? '').localeCompare(
              String(left.completed_at ?? left.started_at ?? ''),
            ) || String(right.id ?? '').localeCompare(String(left.id ?? '')),
        )[0] ?? null
    );
  }

  async findResearchContinuityRepairEntry(
    identity: {
      runId: string;
      caseType: string;
      repairVersion: string;
      sourceEntryId?: string | null;
    },
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.continuityEntries.values()]
        .filter(
          (entry) =>
            entry.workspace_id === workspaceId &&
            entry.research_run_id === identity.runId,
        )
        .find((entry) => {
          const repair = continuityEntryRepairMetadata(entry);
          return (
            repair.repair_version === identity.repairVersion &&
            repair.case_type === identity.caseType &&
            String(repair.source_entry_id ?? '') ===
              String(identity.sourceEntryId ?? '')
          );
        }) ?? null
    );
  }

  async listResearchContinuityEntriesBySymbol(
    symbol: string,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.continuityEntries.values()]
      .filter(
        (entry) => entry.workspace_id === workspaceId && entry.symbol === symbol,
      )
      .sort((a, b) =>
        String(b.generated_at ?? '').localeCompare(String(a.generated_at ?? '')) ||
        String(b.id ?? '').localeCompare(String(a.id ?? '')),
      )
      .slice(0, limit);
  }

  async saveResearchContinuityEntry(
    entry: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...entry, workspace_id: workspaceId };
    this.continuityEntries.set(key(String(saved.id), workspaceId), saved);
    return saved;
  }

  async getResearchContinuityState(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.continuityStates.get(key(symbol, workspaceId)) ?? null;
  }

  async saveResearchContinuityState(
    state: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...state, workspace_id: workspaceId };
    this.continuityStates.set(key(String(saved.symbol), workspaceId), saved);
    return saved;
  }

  async getDebate(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return this.debates.get(key(id, workspaceId)) ?? null;
  }

  async listAgentOpinions(
    debateId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.agentOpinions.get(key(debateId, workspaceId)) ?? [];
  }

  async listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return [...this.theses.values()]
      .filter((thesis) => thesis.workspace_id === workspaceId)
      .slice(0, limit);
  }

  async listThesesForMaturedEvaluation(
    filters: { symbol?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const symbol = filters.symbol
      ? normalizeCryptoSymbolForTest(filters.symbol)
      : undefined;
    return [...this.theses.values()]
      .filter((thesis) => thesis.workspace_id === workspaceId)
      .filter(
        (thesis) =>
          !symbol ||
          normalizeOptionalCryptoSymbolForTest(thesis.symbol) === symbol,
      )
      .sort(
        (left, right) =>
          String(left.created_at ?? '').localeCompare(
            String(right.created_at ?? ''),
          ) || String(left.id ?? '').localeCompare(String(right.id ?? '')),
      )
      .slice(0, filters.limit);
  }

  async listThesesForSymbolCalibration(
    filters: { symbol: string; periodStart: string; periodEnd: string },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const symbol = normalizeCryptoSymbolForTest(filters.symbol);
    return [...this.theses.values()]
      .filter((thesis) => thesis.workspace_id === workspaceId)
      .filter(
        (thesis) =>
          normalizeOptionalCryptoSymbolForTest(thesis.symbol) === symbol,
      )
      .filter((thesis) => {
        const createdAt = String(thesis.created_at ?? '');
        if (!createdAt) {
          return false;
        }
        const date = new Date(createdAt);
        if (!Number.isFinite(date.getTime())) {
          return false;
        }
        const createdDate = date.toISOString().slice(0, 10);
        return (
          createdDate >= filters.periodStart &&
          createdDate <= filters.periodEnd
        );
      })
      .sort(
        (left, right) =>
          String(right.created_at ?? '').localeCompare(
            String(left.created_at ?? ''),
          ) || String(left.id ?? '').localeCompare(String(right.id ?? '')),
      );
  }

  async listAgentCalibrationSourceRows(
    filters: {
      symbol?: string;
      periodStart: string;
      periodEnd: string;
      windowDays: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const symbol = filters.symbol
      ? normalizeCryptoSymbolForTest(filters.symbol)
      : undefined;
    return [...this.agentOpinions.values()]
      .flat()
      .filter((opinion) => opinion.workspace_id === workspaceId)
      .map((opinion) =>
        this.toAgentCalibrationSourceRow(opinion, filters.windowDays, workspaceId),
      )
      .filter((row) => {
        const scopeDate = row.thesis_created_at ?? row.created_at;
        const parsed = new Date(String(scopeDate ?? ''));
        if (!Number.isFinite(parsed.getTime())) {
          return false;
        }
        const date = parsed.toISOString().slice(0, 10);
        return date >= filters.periodStart && date <= filters.periodEnd;
      })
      .filter(
        (row) =>
          !symbol ||
          normalizeOptionalCryptoSymbolForTest(row.symbol) === symbol,
      )
      .sort(
        (left, right) =>
          String(right.created_at ?? '').localeCompare(
            String(left.created_at ?? ''),
          ) ||
          String(left.research_run_id ?? '').localeCompare(
            String(right.research_run_id ?? ''),
          ) ||
          String(left.agent_role ?? '').localeCompare(String(right.agent_role ?? '')),
      );
  }

  async getThesis(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return this.theses.get(key(id, workspaceId)) ?? null;
  }

  private toAgentCalibrationSourceRow(
    opinion: JsonRecord,
    windowDays: number,
    workspaceId: string,
  ): JsonRecord {
    const run = this.researchRuns.get(
      key(String(opinion.research_run_id ?? ''), workspaceId),
    );
    const debate = this.debates.get(
      key(String(opinion.debate_id ?? ''), workspaceId),
    );
    const runThesisId =
      typeof run?.thesis_id === 'string' && run.thesis_id
        ? run.thesis_id
        : null;
    const runThesis = runThesisId
      ? this.theses.get(key(runThesisId, workspaceId)) ?? null
      : null;
    const fallbackThesis =
      runThesis ??
      [...this.theses.values()]
        .filter((thesis) => thesis.workspace_id === workspaceId)
        .filter((thesis) => thesis.research_run_id === opinion.research_run_id)
        .sort(
          (left, right) =>
            String(right.created_at ?? '').localeCompare(
              String(left.created_at ?? ''),
            ) || String(left.id ?? '').localeCompare(String(right.id ?? '')),
        )[0] ??
      null;
    const thesisId =
      typeof fallbackThesis?.id === 'string' ? fallbackThesis.id : null;
    const thesisCreatedAt =
      typeof fallbackThesis?.created_at === 'string'
        ? fallbackThesis.created_at
        : null;
    const evaluationStart = thesisCreatedAt
      ? new Date(thesisCreatedAt).toISOString().slice(0, 10)
      : null;
    const evaluationEnd = evaluationStart
      ? addDaysIsoDate(evaluationStart, windowDays)
      : null;
    const evaluation =
      thesisId && evaluationStart && evaluationEnd
        ? [...this.thesisEvaluations.values()].find(
            (candidate) =>
              candidate.workspace_id === workspaceId &&
              candidate.thesis_id === thesisId &&
              candidate.window_days === windowDays &&
              candidate.evaluation_start === evaluationStart &&
              candidate.evaluation_end === evaluationEnd,
          ) ?? null
        : null;

    return {
      opinion_id: opinion.id,
      workspace_id: workspaceId,
      agent_name: opinion.agent_name,
      agent_role: opinion.agent_role,
      agent_stance: opinion.stance,
      confidence: opinion.confidence,
      created_at: opinion.created_at,
      debate_id: opinion.debate_id,
      research_run_id: opinion.research_run_id,
      thesis_id: thesisId,
      symbol:
        fallbackThesis?.symbol ?? run?.symbol ?? debate?.symbol ?? null,
      thesis_direction: fallbackThesis?.direction ?? null,
      thesis_created_at: thesisCreatedAt,
      evaluation_id: evaluation?.id ?? null,
      evaluation_result: evaluation?.result ?? null,
    };
  }

  async getThesisEvaluationByNaturalKey(
    naturalKey: {
      thesisId: string;
      windowDays: number;
      evaluationStart: string;
      evaluationEnd: string;
    },
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.thesisEvaluations.values()].find(
        (evaluation) =>
          evaluation.workspace_id === workspaceId &&
          evaluation.thesis_id === naturalKey.thesisId &&
          evaluation.window_days === naturalKey.windowDays &&
          evaluation.evaluation_start === naturalKey.evaluationStart &&
          evaluation.evaluation_end === naturalKey.evaluationEnd,
      ) ?? null
    );
  }

  async upsertThesisEvaluation(
    input: ThesisEvaluationInput,
    workspaceId: string,
  ): Promise<{ created: boolean; evaluation: JsonRecord }> {
    const existing = await this.getThesisEvaluationByNaturalKey(
      {
        thesisId: input.thesis_id,
        windowDays: input.window_days,
        evaluationStart: input.evaluation_start,
        evaluationEnd: input.evaluation_end,
      },
      workspaceId,
    );
    if (existing) {
      return { created: false, evaluation: existing };
    }
    const saved: JsonRecord = {
      ...input,
      id: input.id ?? `evaluation_${this.thesisEvaluations.size + 1}`,
      workspace_id: workspaceId,
      outcome_review_id: input.outcome_review_id ?? null,
      evaluated_at: input.evaluated_at ?? '2026-05-12T00:00:00.000Z',
      max_favorable_excursion: input.max_favorable_excursion ?? null,
      max_adverse_excursion: input.max_adverse_excursion ?? null,
      invalidated: input.invalidated ?? false,
      warnings: input.warnings ?? [],
      evidence: input.evidence ?? {},
      payload: input.payload ?? input,
    };
    this.thesisEvaluations.set(key(String(saved.id), workspaceId), saved);
    return { created: true, evaluation: saved };
  }

  async listThesisEvaluations(
    filters: { thesisId?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.thesisEvaluations.values()]
      .filter((evaluation) => evaluation.workspace_id === workspaceId)
      .filter(
        (evaluation) =>
          !filters.thesisId || evaluation.thesis_id === filters.thesisId,
      )
      .sort((a, b) =>
        String(b.evaluated_at ?? '').localeCompare(String(a.evaluated_at ?? '')),
      )
      .slice(0, filters.limit);
  }

  async getThesisEvaluation(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.thesisEvaluations.get(key(id, workspaceId)) ?? null;
  }

  async linkThesisEvaluationOutcomeReview(
    id: string,
    outcomeReviewId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const evaluation = this.thesisEvaluations.get(key(id, workspaceId));
    if (!evaluation) {
      return null;
    }
    evaluation.outcome_review_id = outcomeReviewId;
    return evaluation;
  }

  async listThesisEvaluationRuns(
    filters: { canonicalEvaluationId: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.thesisEvaluationRuns.values()]
      .filter((run) => run.workspace_id === workspaceId)
      .filter(
        (run) => run.canonical_evaluation_id === filters.canonicalEvaluationId,
      )
      .sort((a, b) => {
        const requestedCompare = String(b.requested_at ?? '').localeCompare(
          String(a.requested_at ?? ''),
        );
        if (requestedCompare !== 0) {
          return requestedCompare;
        }
        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
      })
      .slice(0, filters.limit);
  }

  async getThesisEvaluationRunByIdempotencyKey(
    input: { canonicalEvaluationId: string; idempotencyKey: string },
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.thesisEvaluationRuns.values()].find(
        (run) =>
          run.workspace_id === workspaceId &&
          run.canonical_evaluation_id === input.canonicalEvaluationId &&
          run.idempotency_key === input.idempotencyKey,
      ) ?? null
    );
  }

  async getThesisEvaluationRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.thesisEvaluationRuns.get(key(id, workspaceId)) ?? null;
  }

  async createThesisEvaluationRun(
    input: ThesisEvaluationRunInput,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(
      input.id ?? `evaluation_rerun_${this.thesisEvaluationRuns.size + 1}`,
    );
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      requested_at:
        input.requested_at ?? '2026-05-22T08:00:00.000Z',
      evaluated_at: input.evaluated_at ?? null,
      notes: input.notes ?? null,
      idempotency_key: input.idempotency_key ?? null,
      result: input.result ?? null,
      max_favorable_excursion: input.max_favorable_excursion ?? null,
      max_adverse_excursion: input.max_adverse_excursion ?? null,
      invalidated: input.invalidated ?? null,
      warnings: input.warnings ?? [],
      evidence: input.evidence ?? {},
      diff: input.diff ?? {},
      error_type: input.error_type ?? null,
      error_message: input.error_message ?? null,
      payload: input.payload ?? {},
    };
    this.thesisEvaluationRuns.set(key(id, workspaceId), saved);
    return saved;
  }

  async listThesisEvaluationPromotions(
    filters: { canonicalEvaluationId: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.thesisEvaluationPromotions.values()]
      .filter((event) => event.workspace_id === workspaceId)
      .filter(
        (event) =>
          event.canonical_evaluation_id === filters.canonicalEvaluationId,
      )
      .sort((a, b) => {
        const promotedCompare = String(b.promoted_at ?? '').localeCompare(
          String(a.promoted_at ?? ''),
        );
        if (promotedCompare !== 0) {
          return promotedCompare;
        }
        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
      })
      .slice(0, filters.limit);
  }

  async getLatestThesisEvaluationPromotion(
    canonicalEvaluationId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      (await this.listThesisEvaluationPromotions(
        { canonicalEvaluationId, limit: 1 },
        workspaceId,
      ))[0] ?? null
    );
  }

  async getThesisEvaluationPromotionByIdempotencyKey(
    input: { canonicalEvaluationId: string; idempotencyKey: string },
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.thesisEvaluationPromotions.values()].find(
        (event) =>
          event.workspace_id === workspaceId &&
          event.canonical_evaluation_id === input.canonicalEvaluationId &&
          event.idempotency_key === input.idempotencyKey,
      ) ?? null
    );
  }

  async createThesisEvaluationPromotion(
    input: ThesisEvaluationPromotionInput,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(
      input.id ?? `promotion_${this.thesisEvaluationPromotions.size + 1}`,
    );
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      promoted_rerun_id: input.promoted_rerun_id ?? null,
      promoted_by_user_id: input.promoted_by_user_id ?? null,
      promoted_at: input.promoted_at ?? '2026-05-23T08:00:00.000Z',
      notes: input.notes ?? null,
      idempotency_key: input.idempotency_key ?? null,
      payload: input.payload ?? {},
    };
    this.thesisEvaluationPromotions.set(key(id, workspaceId), saved);
    return saved;
  }

  async getThesisMonitorPlan(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.monitorPlans.get(key(thesisId, workspaceId)) ?? null;
  }

  async listThesisPulses(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]> {
    return (this.thesisPulses.get(key(thesisId, workspaceId)) ?? []).slice(
      0,
      limit,
    );
  }

  async listThesisPulseMemos(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]> {
    return (this.thesisPulseMemos.get(key(thesisId, workspaceId)) ?? []).slice(
      0,
      limit,
    );
  }

  async saveThesisMonitorPlan(
    plan: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...plan, workspace_id: workspaceId };
    this.monitorPlans.set(key(String(saved.thesis_id), workspaceId), saved);
    return saved;
  }

  async saveThesisPulse(
    pulse: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...pulse, workspace_id: workspaceId };
    const thesisId = String(saved.thesis_id);
    const current = this.thesisPulses.get(key(thesisId, workspaceId)) ?? [];
    const bucketStart = String(saved.bucket_start ?? '');
    const pulseType = String(saved.pulse_type ?? 'manual');
    const filtered = current.filter(
      (row) =>
        String(row.bucket_start ?? '') !== bucketStart ||
        String(row.pulse_type ?? 'manual') !== pulseType,
    );
    this.thesisPulses.set(key(thesisId, workspaceId), [saved, ...filtered]);
    const plan = this.monitorPlans.get(key(thesisId, workspaceId));
    if (plan) {
      plan.latest_pulse_id = saved.id;
      plan.latest_status = saved.status;
      plan.latest_price = saved.current_price;
      plan.latest_trigger_reasons = saved.trigger_reasons ?? [];
      plan.last_pulse_at = saved.observed_at;
    }
    return saved;
  }

  async saveThesisPulseMemo(
    memo: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...memo, workspace_id: workspaceId };
    const thesisId = String(saved.thesis_id);
    const current = this.thesisPulseMemos.get(key(thesisId, workspaceId)) ?? [];
    const filtered = current.filter(
      (row) =>
        String(row.window_start ?? '') !== String(saved.window_start ?? '') ||
        String(row.window_end ?? '') !== String(saved.window_end ?? '') ||
        String(row.memo_type ?? 'manual') !== String(saved.memo_type ?? 'manual'),
    );
    this.thesisPulseMemos.set(key(thesisId, workspaceId), [saved, ...filtered]);
    const plan = this.monitorPlans.get(key(thesisId, workspaceId));
    if (plan) {
      plan.latest_memo_id = saved.id;
      plan.last_memo_at = saved.created_at;
    }
    return saved;
  }

  async enqueueMonitoringJob(input: {
    workspaceId: string;
    thesisId?: string | null;
    jobType: string;
    runAfter?: string | null;
    priority?: number;
    maxAttempts?: number;
    idempotencyKey: string;
    request: JsonRecord;
  }): Promise<JsonRecord> {
    const existing = this.monitoringJobs.find(
      (job) =>
        job.workspace_id === input.workspaceId &&
        job.idempotency_key === input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }
    const now = '2026-05-12T00:00:00.000Z';
    const job: JsonRecord = {
      id: `monitor_job_${this.monitoringJobs.length + 1}`,
      workspace_id: input.workspaceId,
      thesis_id: input.thesisId ?? null,
      job_type: input.jobType,
      status: 'queued',
      priority: input.priority ?? 0,
      run_after: input.runAfter ?? now,
      attempt_count: 0,
      max_attempts: input.maxAttempts ?? 3,
      locked_at: null,
      locked_by: null,
      started_at: null,
      completed_at: null,
      error_type: null,
      error_message: null,
      idempotency_key: input.idempotencyKey,
      request: input.request,
      request_json: input.request,
      result: null,
      result_json: null,
      created_at: now,
      updated_at: now,
    };
    this.monitoringJobs.push(job);
    return job;
  }

  async claimMonitoringJobs(
    workspaceId: string,
    input: { limit: number; workerId: string; now?: string },
  ): Promise<JsonRecord[]> {
    const now = input.now ?? '2026-05-12T00:01:00.000Z';
    const claimed = this.monitoringJobs
      .filter(
        (job) =>
          job.workspace_id === workspaceId &&
          job.status === 'queued' &&
          String(job.run_after ?? '') <= now,
      )
      .slice(0, input.limit);
    for (const job of claimed) {
      job.status = 'running';
      job.locked_at = now;
      job.locked_by = input.workerId;
      job.started_at ??= now;
      job.attempt_count = Number(job.attempt_count ?? 0) + 1;
      job.updated_at = now;
    }
    return claimed;
  }

  async completeMonitoringJob(
    id: string,
    workspaceId: string,
    result: JsonRecord,
  ): Promise<JsonRecord | null> {
    const job = this.monitoringJobs.find(
      (row) => row.id === id && row.workspace_id === workspaceId,
    );
    if (!job) {
      return null;
    }
    job.status = 'succeeded';
    job.completed_at = '2026-05-12T00:02:00.000Z';
    job.result = result;
    job.result_json = result;
    job.locked_at = null;
    job.locked_by = null;
    return job;
  }

  async failMonitoringJob(
    id: string,
    workspaceId: string,
    failure: {
      errorType: string;
      errorMessage: string;
      retryable: boolean;
      runAfter?: string | null;
      result?: JsonRecord | null;
    },
  ): Promise<JsonRecord | null> {
    const job = this.monitoringJobs.find(
      (row) => row.id === id && row.workspace_id === workspaceId,
    );
    if (!job) {
      return null;
    }
    const attempts = Number(job.attempt_count ?? 0);
    const maxAttempts = Number(job.max_attempts ?? 1);
    job.status =
      failure.retryable && attempts < maxAttempts
        ? 'queued'
        : attempts >= maxAttempts
          ? 'dead_letter'
          : 'failed';
    job.run_after = failure.runAfter ?? job.run_after;
    job.error_type = failure.errorType;
    job.error_message = failure.errorMessage;
    job.result = failure.result ?? null;
    job.locked_at = null;
    job.locked_by = null;
    return job;
  }

  async runMonitoringRetention(
    workspaceId: string,
    policy: { dryRun: boolean; pulseKeepDays: number; memoKeepDays: number },
  ): Promise<JsonRecord> {
    const run = {
      id: `monitor_retention_${this.monitoringRetentionRuns.length + 1}`,
      workspace_id: workspaceId,
      started_at: '2026-05-12T00:00:00.000Z',
      completed_at: '2026-05-12T00:00:01.000Z',
      dry_run: policy.dryRun,
      deleted_pulses: 0,
      deleted_memos: 0,
      deleted_jobs: 0,
      protected_tables: ['trade_theses', 'research_runs', 'user_decisions'],
      policy,
    };
    this.monitoringRetentionRuns.push(run);
    return run;
  }

  async getMonitoringOperationsHealth(
    workspaceId = 'workspace_a',
  ): Promise<JsonRecord> {
    const workspaceJobs = this.monitoringJobs.filter(
      (job) => job.workspace_id === workspaceId,
    );
    const workspacePlans = [...this.monitorPlans.values()].filter(
      (plan) => plan.workspace_id === workspaceId,
    );

    return (
      this.monitoringHealth ?? {
        monitoring_queue: {
          queued: workspaceJobs.filter((job) => job.status === 'queued').length,
          running: workspaceJobs.filter((job) => job.status === 'running')
            .length,
          failed: workspaceJobs.filter((job) => job.status === 'failed').length,
          dead_letter: workspaceJobs.filter(
            (job) => job.status === 'dead_letter',
          ).length,
          oldest_queued_at: null,
        },
        monitoring_scheduler: {
          enabled_plans: workspacePlans.filter(
            (plan) => plan.status === 'active' && plan.scheduler_enabled === true,
          ).length,
          due_plans: 0,
          last_enqueue_at: null,
          last_enqueue_error: null,
        },
        monitoring_workers: {
          active_workers: 0,
          last_success_at: null,
          last_error_at: null,
          recent_error_types: [],
        },
        monitoring_retention: {
          last_run_at: null,
          last_deleted_counts: {
            deleted_pulses: 0,
            deleted_memos: 0,
            deleted_jobs: 0,
            dry_run: true,
          },
          last_error: null,
        },
        llm_memo_health: {
          recent_calls: 0,
          failure_rate: null,
          average_latency_ms: null,
        },
      }
    );
  }

  async listScenarios(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.scenarios.get(key(thesisId, workspaceId)) ?? [];
  }

  async recordThesisDecision(
    thesisId: string,
    action: string,
    notes: string,
    workspaceId: string,
    intent: ThesisDecisionIntent = {},
  ): Promise<JsonRecord> {
    this.decisionCalls.push({ thesisId, action, notes, workspaceId, intent });
    return {
      id: 'decision_1',
      workspace_id: workspaceId,
      thesis_id: thesisId,
      action,
      user_notes: notes,
      entry: intent.entry ?? '',
      stop_loss: intent.stop_loss ?? '',
      take_profit: intent.take_profit ?? '',
      position_intent: intent.position_intent ?? '',
      decided_at: '2026-05-12T00:00:00.000Z',
    };
  }

  async recordThesisReview(
    thesisId: string,
    result: string,
    notes: string,
    workspaceId: string,
    metrics: ThesisReviewMetrics = {},
  ): Promise<JsonRecord> {
    this.reviewCalls.push({ thesisId, result, notes, workspaceId, metrics });
    const review = {
      id: `outcome_${this.outcomeReviews.length + 1}`,
      workspace_id: workspaceId,
      thesis_id: thesisId,
      result,
      lessons: notes,
      max_favorable_excursion: metrics.max_favorable_excursion ?? null,
      max_adverse_excursion: metrics.max_adverse_excursion ?? null,
      reviewed_at: '2026-05-12T00:00:00.000Z',
      invalidated: result === 'invalidated',
      metadata: metrics.metadata ?? {},
    };
    this.outcomeReviews.push(review);
    return review;
  }

  async listOutcomeReviews(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.outcomeReviews
      .filter((review) => review.workspace_id === workspaceId)
      .filter((review) => !symbol || review.symbol === symbol)
      .slice(0, limit);
  }

  async getOutcomeReview(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.outcomeReviews.find(
        (review) => review.id === id && review.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async getSignal(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.signals.find(
        (signal) => signal.id === id && signal.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async listSignals(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.signals
      .filter((signal) => signal.workspace_id === workspaceId)
      .filter((signal) => !symbol || signal.symbol === symbol)
      .slice(0, limit);
  }

  async summarizeSignals(
    symbol: string | undefined,
    workspaceId: string,
  ): Promise<SignalSummary> {
    return this.signals
      .filter((signal) => signal.workspace_id === workspaceId)
      .filter((signal) => !symbol || signal.symbol === symbol)
      .reduce<SignalSummary>(
        (summary, signal) => {
          const direction = String(signal.direction ?? '').toLowerCase();
          summary.total += 1;
          if (direction.includes('bull') || direction.includes('long')) {
            summary.bullish += 1;
          } else if (direction.includes('bear') || direction.includes('short')) {
            summary.bearish += 1;
          } else {
            summary.neutral += 1;
          }
          return summary;
        },
        { total: 0, bullish: 0, bearish: 0, neutral: 0 },
      );
  }

  async listWatchlists(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    return this.watchlists
      .filter((watchlist) => watchlist.workspace_id === workspaceId)
      .slice(0, limit);
  }

  async createWatchlist(
    input: { name: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord> {
    const watchlist = {
      id: `watch_${this.watchlists.length + 1}`,
      workspace_id: workspaceId,
      name: input.name,
      enabled: input.enabled ?? true,
      created_at: '2026-05-12T00:00:00.000Z',
    };
    this.watchlists.unshift(watchlist);
    return watchlist;
  }

  async getWatchlist(id: string, workspaceId: string): Promise<JsonRecord | null> {
    return (
      this.watchlists.find(
        (watchlist) =>
          watchlist.id === id && watchlist.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async getWatchlistByName(
    name: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.watchlists.find(
        (watchlist) =>
          watchlist.name === name && watchlist.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async listWatchlistItems(
    watchlistId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.watchlistItems.filter(
      (item) =>
        item.watchlist_id === watchlistId && item.workspace_id === workspaceId,
    );
  }

  async addWatchlistItem(
    watchlistId: string,
    item: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const exists = this.watchlists.some(
      (watchlist) =>
        watchlist.id === watchlistId && watchlist.workspace_id === workspaceId,
    );
    if (!exists) {
      throw new NotFoundException(`Watchlist ${watchlistId} not found`);
    }
    const created = {
      id: `watch_item_${this.watchlistItems.length + 1}`,
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      item_type: item.item_type ?? 'symbol',
      symbol: item.symbol ?? null,
      thesis_id: item.thesis_id ?? null,
      setup_type: item.setup_type ?? null,
      enabled: true,
      created_at: '2026-05-12T00:00:00.000Z',
    };
    this.watchlistItems.unshift(created);
    return created;
  }

  async updateWatchlist(
    id: string,
    input: { name?: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord> {
    const watchlist = await this.getWatchlist(id, workspaceId);
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    if (input.name !== undefined) {
      watchlist.name = input.name;
    }
    if (input.enabled !== undefined) {
      watchlist.enabled = input.enabled;
    }
    return watchlist;
  }

  async removeWatchlistItem(
    watchlistId: string,
    itemId: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const index = this.watchlistItems.findIndex(
      (item) =>
        item.id === itemId &&
        item.watchlist_id === watchlistId &&
        item.workspace_id === workspaceId,
    );
    if (index === -1) {
      throw new NotFoundException(`Watchlist item ${itemId} not found`);
    }
    this.watchlistItems.splice(index, 1);
    return {
      id: itemId,
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      removed: true,
    };
  }

  async removeWatchlist(id: string, workspaceId: string): Promise<JsonRecord> {
    const index = this.watchlists.findIndex(
      (watchlist) =>
        watchlist.id === id && watchlist.workspace_id === workspaceId,
    );
    if (index === -1) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    const [watchlist] = this.watchlists.splice(index, 1);
    const itemIds = this.watchlistItems
      .filter(
        (item) =>
          item.watchlist_id === id && item.workspace_id === workspaceId,
      )
      .map((item) => String(item.id));
    for (let itemIndex = this.watchlistItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = this.watchlistItems[itemIndex];
      if (item.watchlist_id === id && item.workspace_id === workspaceId) {
        this.watchlistItems.splice(itemIndex, 1);
      }
    }
    for (const alert of this.alerts) {
      if (itemIds.includes(String(alert.watchlist_item_id ?? ''))) {
        alert.watchlist_item_id = null;
      }
    }
    return {
      id,
      workspace_id: workspaceId,
      name: String(watchlist.name ?? ''),
      removed: true,
      removed_item_count: itemIds.length,
    };
  }

  async listDailyBriefs(
    date: string | undefined,
    limit: number,
    workspaceId: string,
    watchlistName?: string,
    throughDate?: string,
  ): Promise<JsonRecord[]> {
    return this.briefs
      .filter((brief) => brief.workspace_id === workspaceId)
      .filter((brief) => !date || brief.brief_date === date)
      .filter((brief) => !throughDate || String(brief.brief_date) <= throughDate)
      .filter((brief) => !watchlistName || brief.watchlist_name === watchlistName)
      .slice(0, limit);
  }

  async getLatestMarketBrief(
    watchlistName: string | undefined,
    beforeDate: string | undefined,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.briefs
        .filter((brief) => brief.workspace_id === workspaceId)
        .filter((brief) => !watchlistName || brief.watchlist_name === watchlistName)
        .filter((brief) => !beforeDate || String(brief.brief_date) < beforeDate)
        .sort((a, b) =>
          String(b.brief_date ?? '').localeCompare(String(a.brief_date ?? '')),
        )[0] ?? null
    );
  }

  async saveMarketBrief(
    brief: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = {
      ...brief,
      workspace_id: workspaceId,
    };
    const index = this.briefs.findIndex(
      (candidate) =>
        candidate.id === saved.id && candidate.workspace_id === workspaceId,
    );
    if (index === -1) {
      this.briefs.unshift(saved);
    } else {
      this.briefs[index] = saved;
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
    return this.alerts
      .filter((alert) => alert.workspace_id === workspaceId)
      .filter((alert) => !symbol || alert.symbol === symbol)
      .filter((alert) => !thesisId || alert.thesis_id === thesisId)
      .filter((alert) => !unreadOnly || !alert.read_at)
      .slice(0, limit);
  }

  async findAlert(
    alertType: string,
    thesisId: string | undefined,
    watchlistItemId: string | undefined,
    triggerKey: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.alerts.find(
        (alert) =>
          alert.workspace_id === workspaceId &&
          alert.alert_type === alertType &&
          alert.trigger_key === triggerKey &&
          (alert.thesis_id ?? null) === (thesisId ?? null) &&
          (alert.watchlist_item_id ?? null) === (watchlistItemId ?? null),
      ) ?? null
    );
  }

  async createAlert(alert: JsonRecord, workspaceId: string): Promise<JsonRecord> {
    const saved = { ...alert, workspace_id: workspaceId };
    this.alerts.unshift(saved);
    return saved;
  }

  async markAlertRead(id: string, workspaceId: string): Promise<JsonRecord> {
    const alert = this.alerts.find(
      (candidate) =>
        candidate.id === id && candidate.workspace_id === workspaceId,
    );
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    alert.read_at = alert.read_at ?? '2026-05-12T00:00:00.000Z';
    return alert;
  }

  async listProviderHealth(limit: number): Promise<JsonRecord[]> {
    return this.providerHealthRows.slice(0, limit);
  }

  async listLlmCalls(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.llmCalls
      .filter(
        (call) => !call.workspace_id || call.workspace_id === workspaceId,
      )
      .slice(0, limit);
  }

  async listDataFreshnessChecks(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.freshnessChecks
      .filter(
        (check) => !check.workspace_id || check.workspace_id === workspaceId,
      )
      .slice(0, limit);
  }
}

test('POST /research-runs rejects x-workspace-id mismatches', async () => {
  const { researchRuns } = buildHarness();

  await assert.rejects(
    () =>
      researchRuns.create(
        {
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market'],
        },
        'user_1',
        'workspace_b',
      ),
    isException(BadRequestException),
  );
});

test('AuthService requires an explicit authenticated user', () => {
  const auth = new AuthService();

  assert.throws(
    () => auth.resolveUser(undefined),
    isException(UnauthorizedException),
  );
  assert.throws(() => auth.resolveUser('   '), isException(UnauthorizedException));
});

test('WorkspacesService enforces membership roles', async () => {
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'viewer_1', workspace_id: 'workspace_a', role: 'viewer' },
    { user_id: 'editor_1', workspace_id: 'workspace_a', role: 'editor' },
  ]);

  const viewer = await workspaces.assertAccess(
    'viewer_1',
    'workspace_a',
    'viewer',
  );
  assert.equal(viewer.role, 'viewer');
  await assert.rejects(
    () => workspaces.assertAccess('viewer_1', 'workspace_a', 'editor'),
    isException(ForbiddenException),
  );
  await assert.rejects(
    () => workspaces.assertAccess('viewer_1', 'workspace_b', 'viewer'),
    isException(ForbiddenException),
  );
  const editor = await workspaces.assertAccess(
    'editor_1',
    'workspace_a',
    'editor',
  );
  assert.equal(editor.role, 'editor');
});

test('WorkspacesService grants default local membership without DATABASE_URL', async () => {
  await withEnv(
    {
      DATABASE_URL: undefined,
      WORKSPACE_MEMBERSHIPS: undefined,
      LOCAL_WORKSPACE_MEMBERSHIP: undefined,
      LOCAL_USER_ID: undefined,
      LOCAL_WORKSPACE_ID: undefined,
    },
    async () => {
      const workspaces = new WorkspacesService();

      const membership = await workspaces.assertAccess(
        'local-user',
        'local',
        'editor',
      );

      assert.equal(membership.role, 'owner');
      await workspaces.onModuleDestroy();
    },
  );
});

test('WorkspacesService grants default local membership when local DATABASE_URL is unavailable', async () => {
  await withEnv(
    {
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/unavailable',
      WORKSPACE_MEMBERSHIPS: undefined,
      LOCAL_WORKSPACE_MEMBERSHIP: undefined,
      LOCAL_USER_ID: undefined,
      LOCAL_WORKSPACE_ID: undefined,
    },
    async () => {
      const workspaces = new WorkspacesService();

      const membership = await workspaces.assertAccess(
        'local-user',
        'local',
        'editor',
      );

      assert.equal(membership.role, 'owner');
      await workspaces.onModuleDestroy();
    },
  );
});

test('POST /research-runs enqueues the exact engine request contract', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      const response = await researchRunsController.create(
        {
          run_id: 'run_contract',
          workspace_id: 'workspace_a',
          symbol: 'ETH/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market', 'news'],
          exchange: 'binance',
          dry_run: true,
          metadata: { source: 'contract-test' },
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(response.run_id, 'run_contract');
      assert.equal(response.workspace_id, 'workspace_a');
      assert.equal(response.status, 'queued');
      assert.equal(response.queue_backend, 'memory');
      assert.deepEqual(jobs.listMemoryJobs(), [
        {
          run_id: 'run_contract',
          workspace_id: 'workspace_a',
          symbol: 'ETH/USDT',
          asset_class: 'crypto',
          market_type: 'spot',
          analysis_date: '2026-05-12',
          analysts: ['market', 'news'],
          config_profile: 'default',
          exchange: 'binance',
          dry_run: true,
          metadata: { source: 'contract-test' },
        },
      ]);
    },
  );
});

test('POST /research-runs normalizes common crypto symbol inputs', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      await researchRunsController.create(
        {
          run_id: 'run_symbol_normalized',
          workspace_id: 'workspace_a',
          symbol: ' ethdt ',
          analysis_date: '2026-05-12',
          analysts: ['market'],
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(jobs.listMemoryJobs()[0]?.symbol, 'ETH/USDT');
    },
  );
});

test('POST /research-runs sends only graph analyst lanes to the engine', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      await researchRunsController.create(
        {
          run_id: 'run_analyst_lanes',
          workspace_id: 'workspace_a',
          symbol: 'ETH/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market', 'quant', 'risk', 'social'],
        },
        'user_1',
        'workspace_a',
      );

      assert.deepEqual(jobs.listMemoryJobs()[0]?.analysts, ['market', 'social']);
    },
  );
});

test('GET /research-runs lists only the active workspace and filters runs', async () => {
  const { journal, researchRuns } = buildHarness();
  journal.researchRuns.set(key('run_btc', 'workspace_a'), {
    id: 'run_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    status: 'completed',
  });
  journal.researchRuns.set(key('run_eth', 'workspace_a'), {
    id: 'run_eth',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'failed',
  });
  journal.researchRuns.set(key('run_other', 'workspace_b'), {
    id: 'run_other',
    workspace_id: 'workspace_b',
    symbol: 'BTC/USDT',
    status: 'completed',
  });

  const runs = await researchRuns.list(
    { symbol: 'BTC/USDT', status: 'completed', limit: 50 },
    'user_1',
    'workspace_a',
  );

  assert.deepEqual(
    runs.map((run) => run.id),
    ['run_btc'],
  );
});

test('GET /research-runs includes active jobs before run artifacts persist', async () => {
  await withEnv(
    { DATABASE_URL: undefined, JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const journal = new FakeJournalRepository();
      const auth = new AuthService();
      const workspaces = new WorkspacesService();
      workspaces.setMembershipsForTest([
        { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
      ]);
      let releaseEngine!: () => void;
      let resolveStarted!: () => void;
      const engineStarted = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      const engineBlocker = new Promise<void>((resolve) => {
        releaseEngine = resolve;
      });
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          resolveStarted();
          await engineBlocker;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as unknown as PythonEngineClient);
      const researchRuns = new ResearchRunsService(
        journal,
        jobs,
        auth,
        workspaces,
      );

      try {
        await jobs.enqueueResearchRun(engineRequest('run_active_history'));
        await engineStarted;
        const listed = await researchRuns.list(
          { limit: 10 },
          'user_1',
          'workspace_a',
        );
        const active = listed.find(
          (run) => run.run_id === 'run_active_history',
        );
        assert.equal(active?.status, 'running');
        assert.equal(active?.symbol, 'BTC/USDT');
      } finally {
        releaseEngine();
        await waitForJobStatus(jobs, 'run_active_history', 'completed');
        await jobs.onModuleDestroy();
      }
    },
  );
});

test('POST /research-runs passes explicit market_type to engine request', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      await researchRunsController.create(
        {
          run_id: 'run_perp_contract',
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market'],
          market_type: 'perp',
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(jobs.listMemoryJobs()[0]?.market_type, 'perp');
    },
  );
});

test('POST /research-runs rejects unavailable market data before enqueue', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { journal, jobs } = buildHarness();
      const auth = new AuthService();
      const workspaces = new WorkspacesService();
      workspaces.setMembershipsForTest([
        { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
      ]);
      const guard = {
        assertAvailable: async () => {
          throw new BadRequestException(
            'Market data unavailable for ONDO/USDT on binance. Research was not queued.',
          );
        },
      } as unknown as MarketDataGuardService;
      const researchRuns = new ResearchRunsService(
        journal,
        jobs,
        auth,
        workspaces,
        undefined,
        guard,
      );

      await assert.rejects(
        () =>
          researchRuns.create(
            {
              run_id: 'run_ondo_unavailable',
              workspace_id: 'workspace_a',
              symbol: 'ONDO/USDT',
              analysis_date: '2026-05-12',
              analysts: ['market'],
            },
            'user_1',
            'workspace_a',
          ),
        isException(BadRequestException),
      );
      assert.equal(jobs.listMemoryJobs().length, 0);
      await jobs.onModuleDestroy();
    },
  );
});

test('CreateResearchRunDto rejects invalid boundary payloads', async () => {
  const validPayload = {
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    analysis_date: '2026-05-12',
    analysts: ['market'],
  };
  const invalidPayloads: JsonRecord[] = [
    { ...validPayload, unexpected: true },
    { ...validPayload, market_type: 'futures' },
    { ...validPayload, symbol: '   ' },
    { ...validPayload, workspace_id: '   ' },
    { ...validPayload, analysts: [] },
    { ...validPayload, analysts: ['market', '   '] },
    { ...validPayload, analysis_date: 'not-a-date' },
    { ...validPayload, dry_run: 'true' },
    { ...validPayload, metadata: [] },
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      () => validateCreateResearchRun(payload),
      isException(BadRequestException),
    );
  }

  const dto = await validateCreateResearchRun({
    ...validPayload,
    market_type: 'perp',
    exchange: 'coinbase',
    dry_run: true,
    metadata: { source: 'api-contract-test' },
  });
  assert.equal(dto.workspace_id, 'workspace_a');
  assert.equal(dto.market_type, 'perp');
  assert.equal(dto.exchange, 'coinbase');
  assert.equal(dto.dry_run, true);
  assert.deepEqual(dto.metadata, { source: 'api-contract-test' });
});

test('thesis monitoring DTOs accept whitelisted pulse and plan fields', async () => {
  const pulseDto = await validateRunThesisPulse({
    force: true,
    observed_at: '2026-05-18T01:00:00.000Z',
  });
  const memoDto = await validateRunThesisPulseMemo({
    force: true,
    window_minutes: 240,
    observed_at: '2026-05-18T01:00:00.000Z',
  });
  const schedulerDto = await validateRunThesisScheduler({
    observed_at: '2026-05-18T01:00:00.000Z',
  });
  assert.equal(pulseDto.force, true);
  assert.equal(pulseDto.observed_at, '2026-05-18T01:00:00.000Z');
  assert.equal(memoDto.force, true);
  assert.equal(memoDto.window_minutes, 240);
  assert.equal(schedulerDto.observed_at, '2026-05-18T01:00:00.000Z');

  const planDto = await validatePatchThesisMonitorPlan({
    status: 'active',
    baseline_price: 2186,
    baseline_price_source: 'manual',
    baseline_observed_at: '2026-05-18T01:00:00.000Z',
    entry_low: 2100,
    entry_high: 2200,
    invalidation_level: 1400,
    invalidation_direction: 'below',
    targets: [{ label: 'target_1', price: 2600 }],
    scenario_triggers: ['funding spike'],
    price_interval_minutes: 5,
    signal_interval_minutes: 15,
    memo_interval_minutes: 240,
    run_memo_on_review: true,
    run_memo_on_rerun_full: false,
    skip_memo_if_no_new_pulses: true,
    watch_distance_pct: 5,
    review_distance_pct: 2,
    consecutive_review_to_rerun: 3,
    consecutive_invalidation_to_rerun: 2,
    enabled_signal_factors: ['regime'],
    scheduler_enabled: false,
  });
  assert.equal(planDto.status, 'active');
  assert.equal(planDto.invalidation_direction, 'below');
  assert.deepEqual(planDto.scenario_triggers, ['funding spike']);
  assert.equal(planDto.run_memo_on_review, true);
  assert.equal(planDto.run_memo_on_rerun_full, false);
  assert.equal(planDto.skip_memo_if_no_new_pulses, true);

  await assert.rejects(
    () => validateRunThesisPulse({ force: true, unexpected: true }),
    isException(BadRequestException),
  );
  await assert.rejects(
    () => validateRunThesisPulseMemo({ window_minutes: 240, unexpected: true }),
    isException(BadRequestException),
  );
  await assert.rejects(
    () => validatePatchThesisMonitorPlan({ price_interval_minutes: 0 }),
    isException(BadRequestException),
  );
  await assert.rejects(
    () => validateRunThesisScheduler({ observed_at: 'not-a-date' }),
    isException(BadRequestException),
  );
});

test('OpenAPI contract exposes the worker engine request fields', () => {
  const engineProperties =
    openApiDocument.components.schemas.EngineRunRequest.properties;
  const createProperties =
    openApiDocument.components.schemas.CreateResearchRunRequest.properties;

  for (const field of ['exchange', 'dry_run', 'metadata'] as const) {
    assert.ok(field in engineProperties);
    assert.ok(field in createProperties);
  }
  assert.deepEqual(engineProperties.market_type.enum, ['spot', 'perp']);
  assert.deepEqual(createProperties.market_type.enum, ['spot', 'perp']);
  const workspaceRequired =
    openApiDocument.components.schemas.JournalRunWorkspaceResponse.required;
  assert.ok(workspaceRequired.includes('stage_timings'));
  const timingProperties =
    openApiDocument.components.schemas.ResearchRunStageTimingResponse.properties;
  assert.deepEqual(timingProperties.event_state.enum, [
    'pending',
    'running',
    'completed',
    'failed',
    'missing',
  ]);
});

test('OpenAPI contract covers the frontend-facing controller routes', () => {
  const paths = openApiDocument.paths as Record<string, Record<string, unknown>>;
  const expectedRoutes: Array<[string, string[]]> = [
    ['/market-data/ohlcv', ['get']],
    ['/research-runs', ['get', 'post']],
    ['/research-runs/{id}', ['get']],
    ['/research-runs/{id}/events', ['get']],
    ['/research-runs/{id}/snapshots', ['get']],
    ['/research-runs/{id}/debate', ['get']],
    ['/research-runs/{id}/workspace', ['get']],
    ['/research-runs/{id}/evidence-bundle', ['get']],
    ['/research-runs/{id}/continuity', ['get', 'post']],
    ['/research-continuity/symbols/{symbol}/state', ['get']],
    ['/research-continuity/symbols/{symbol}/entries', ['get']],
    ['/research-continuity/entries/{id}', ['get']],
    ['/research-continuity/repair/preview', ['get']],
    ['/research-continuity/repair/run', ['post']],
    ['/journal/runs/{id}/workspace', ['get']],
    ['/journal/runs/{id}/evidence-bundle', ['get']],
    ['/signals', ['get']],
    ['/signals/{id}', ['get']],
    ['/signals/count', ['get']],
    ['/theses', ['get']],
    ['/theses/{id}', ['get']],
    ['/theses/{id}/scenarios', ['get']],
    ['/theses/{id}/monitor-plan', ['get', 'patch']],
    ['/theses/{id}/pulses/run', ['post']],
    ['/theses/{id}/pulses', ['get']],
    ['/theses/{id}/pulse-memos/run', ['post']],
    ['/theses/{id}/pulse-memos', ['get']],
    ['/theses/{id}/scheduler', ['get']],
    ['/theses/{id}/scheduler/resume', ['post']],
    ['/theses/{id}/scheduler/pause', ['post']],
    ['/theses/{id}/scheduler/run-due', ['post']],
    ['/theses/{id}/decision', ['post']],
    ['/theses/{id}/review', ['post']],
    ['/watchlists', ['get', 'post']],
    ['/watchlists/{id}', ['get', 'patch', 'delete']],
    ['/watchlists/{id}/items', ['get', 'post']],
    ['/watchlists/{id}/items/{itemId}', ['delete']],
    ['/watchlists/{id}/check', ['post']],
    ['/briefs/daily', ['get', 'post']],
    ['/alerts', ['get']],
    ['/alerts/{id}/read', ['post']],
    ['/alerts/scheduler', ['get']],
    ['/alerts/scheduler/run', ['post']],
    ['/workbench/attention', ['get']],
    ['/calibration/evaluations/thesis', ['post']],
    ['/calibration/evaluations/matured/preview', ['post']],
    ['/calibration/evaluations/matured/apply', ['post']],
    ['/calibration/symbol', ['get']],
    ['/calibration/agents', ['get']],
    ['/calibration/evaluations', ['get']],
    ['/calibration/evaluations/{id}', ['get']],
    ['/calibration/evaluations/{id}/reruns', ['get', 'post']],
    ['/calibration/evaluations/{id}/reruns/{rerun_id}/promote', ['post']],
    ['/calibration/evaluations/{id}/version-policy', ['get']],
    ['/calibration/evaluations/{id}/version-policy/reset', ['post']],
    ['/calibration/evaluations/{id}/outcome-review', ['post']],
    ['/performance/outcomes', ['get']],
    ['/performance/analytics', ['get']],
    ['/performance/trend', ['get']],
    ['/performance/health', ['get']],
    ['/comparisons/theses', ['get']],
    ['/comparisons/runs', ['get']],
    ['/scenarios/monitor', ['get']],
    ['/operations/health', ['get']],
    ['/operations/provider-health', ['get']],
    ['/operations/llm-calls', ['get']],
    ['/operations/data-freshness', ['get']],
    ['/operations/monitoring/retention/dry-run', ['post']],
    ['/jobs/{id}', ['get']],
    ['/jobs/{id}/cancel', ['post']],
  ];

  for (const [path, methods] of expectedRoutes) {
    assert.ok(paths[path], `OpenAPI missing ${path}`);
    for (const method of methods) {
      assert.ok(paths[path]?.[method], `OpenAPI missing ${method.toUpperCase()} ${path}`);
    }
  }
});

test('JobsService inline mode returns engine result without memory queue', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'inline', REDIS_URL: undefined },
    async () => {
      let captured: EngineRunRequest | undefined;
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          captured = request;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as unknown as PythonEngineClient);

      const result = await jobs.enqueueResearchRun(engineRequest('run_inline'));

      assert.equal(result.backend, 'inline');
      assert.match(result.id, /^inline_/);
      assert.deepEqual(result.result, {
        status: 'completed',
        run_id: 'run_inline',
        workspace_id: 'workspace_a',
      });
      assert.equal(captured?.run_id, 'run_inline');
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
    },
  );
});

test('JobsService inline completion triggers research continuity generation', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'inline', REDIS_URL: undefined },
    async () => {
      const continuityCalls: Array<{ runId: string; workspaceId: string }> = [];
      const jobs = new JobsService(
        {
          runInline: async (request: EngineRunRequest) => ({
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          }),
        } as unknown as PythonEngineClient,
        undefined,
        undefined,
        {
          generateForCompletedRun: async (runId: string, workspaceId: string) => {
            continuityCalls.push({ runId, workspaceId });
            return null;
          },
        } as unknown as ResearchContinuityService,
      );

      await jobs.enqueueResearchRun(engineRequest('run_inline_continuity'));

      assert.deepEqual(continuityCalls, [
        { runId: 'run_inline_continuity', workspaceId: 'workspace_a' },
      ]);
      await jobs.onModuleDestroy();
    },
  );
});

test('JobsService defaults to memory mode when no execution mode is configured', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: undefined, REDIS_URL: undefined },
    async () => {
      let captured: EngineRunRequest | undefined;
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          captured = request;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as unknown as PythonEngineClient);

      const result = await jobs.enqueueResearchRun(
        engineRequest('run_default_memory'),
      );
      const status = await waitForJobStatus(
        jobs,
        'run_default_memory',
        'completed',
      );

      assert.deepEqual(result, {
        id: 'run_default_memory',
        backend: 'memory',
      });
      assert.equal(captured?.run_id, 'run_default_memory');
      assert.equal(status.id, result.id);
      assert.equal(status.status, 'completed');
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
    },
  );
});

test('JobsService memory mode queues requests when explicitly configured', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const jobs = new JobsService({
        runInline: async () => {
          throw new Error('inline engine should not run');
        },
      } as unknown as PythonEngineClient);
      const request = engineRequest('run_memory');

      const result = await jobs.enqueueResearchRun(request);
      const listed = jobs.listMemoryJobs();

      assert.deepEqual(result, { id: 'run_memory', backend: 'memory' });
      assert.deepEqual(listed, [request]);
      listed.length = 0;
      assert.equal(jobs.listMemoryJobs().length, 1);
      const status = await jobs.getJobStatus('run_memory');
      assert.equal(status.status, 'queued');
      assert.equal(status.workspace_id, 'workspace_a');
      await jobs.onModuleDestroy();
    },
  );
});

test('JobsService memory mode processes queued requests in the API process', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      let captured: EngineRunRequest | undefined;
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => {
          captured = request;
          return {
            status: 'completed',
            run_id: request.run_id,
            workspace_id: request.workspace_id,
          };
        },
      } as unknown as PythonEngineClient);

      const result = await jobs.enqueueResearchRun(
        engineRequest('run_memory_background'),
      );
      assert.deepEqual(result, {
        id: 'run_memory_background',
        backend: 'memory',
      });
      const queuedCaptured = captured;
      assert.equal(queuedCaptured, undefined);

      const completed = await waitForJobStatus(
        jobs,
        'run_memory_background',
        'completed',
      );

      const processedCaptured = captured;
      assert.equal(processedCaptured?.run_id, 'run_memory_background');
      assert.equal(completed.backend, 'memory');
      assert.equal(completed.started_at !== null, true);
      assert.equal(completed.completed_at !== null, true);
      assert.deepEqual(completed.result, {
        status: 'completed',
        run_id: 'run_memory_background',
        workspace_id: 'workspace_a',
      });
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
    },
  );
});

test('GET /jobs/:id exposes workspace-scoped job status', async () => {
  const { jobs, jobsController } = buildHarness();
  const enqueued = await jobs.enqueueResearchRun(engineRequest('run_status'));
  await waitForJobStatus(jobs, 'run_status', 'completed');

  const status = await jobsController.get('run_status', 'user_1', 'workspace_a');

  assert.equal(status.id, enqueued.id);
  assert.equal(status.run_id, 'run_status');
  assert.equal(status.status, 'completed');
  await assert.rejects(
    () => jobsController.get('run_status', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );
});

test('JobsService reads lifecycle state after replacing the service instance', async () => {
  await withEnv(
    { DATABASE_URL: undefined, JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const lifecycle = new JobLifecycleService();
      const first = new JobsService(
        {
          runInline: async () => {
            throw new Error('memory worker should be stopped before running');
          },
        } as unknown as PythonEngineClient,
        undefined,
        lifecycle,
      );
      const request = engineRequest('run_durable_lifecycle');

      const enqueued = await first.enqueueResearchRun(request);
      await first.onModuleDestroy();
      const second = new JobsService(
        {
          runInline: async () => ({
            status: 'completed',
            run_id: request.run_id,
          }),
        } as unknown as PythonEngineClient,
        undefined,
        lifecycle,
      );

      const status = await second.getJobStatus(enqueued.id);

      assert.equal(status.status, 'queued');
      assert.equal(status.run_id, 'run_durable_lifecycle');
      assert.equal(status.attempts, 0);
      assert.equal(status.progress.phase, 'queued');
      await second.onModuleDestroy();
      await lifecycle.onModuleDestroy();
    },
  );
});

test('JobLifecycleService keeps lifecycle in memory when local DATABASE_URL is unavailable', async () => {
  await withEnv(
    {
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/unavailable',
    },
    async () => {
      const lifecycle = new JobLifecycleService();
      const request = engineRequest('run_lifecycle_local_db_down');

      const created = await lifecycle.create({
        id: request.run_id,
        request,
        backend: 'memory',
      });
      const running = await lifecycle.markRunning(request.run_id, {
        attempts: 1,
      });
      const listed = await lifecycle.list(request.workspace_id);

      assert.equal(created.status, 'queued');
      assert.equal(running?.status, 'running');
      assert.equal(listed[0]?.run_id, request.run_id);
      await lifecycle.onModuleDestroy();
    },
  );
});

test('ResearchJobProcessor persists completion and syncs SQLite artifacts from worker path', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_processor_sync');
    await lifecycle.create({
      id: 'job_processor_sync',
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: 'job_processor_sync',
      maxAttempts: 2,
    });
    const sqliteSync = {
      syncRun: async (runId: string, workspaceId: string) => ({
        run_id: runId,
        workspace_id: workspaceId,
        sqlite_path: '/tmp/research.sqlite',
        tables: { research_runs: 1, run_events: 2 },
      }),
    } as unknown as SqliteJournalSyncService;
    const processor = new ResearchJobProcessor(
      {
        runInline: async (engineRequest: EngineRunRequest) => ({
          status: 'completed',
          run_id: engineRequest.run_id,
          workspace_id: engineRequest.workspace_id,
        }),
      } as unknown as PythonEngineClient,
      lifecycle,
      sqliteSync,
    );

    const result = await processor.process(request, {
      jobId: 'job_processor_sync',
      backend: 'bullmq',
      attempt: 1,
      maxAttempts: 2,
    });
    const status = await lifecycle.get('run_processor_sync');

    assert.equal(result.postgres_sync && typeof result.postgres_sync, 'object');
    assert.equal(status?.status, 'completed');
    assert.equal(status?.attempts, 1);
    assert.equal(status?.heartbeat_at !== null, true);
    assert.deepEqual(status?.result_summary, result);
    await lifecycle.onModuleDestroy();
  });
});

test('ResearchJobProcessor marks timed out jobs and aborts the engine process', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_processor_timeout');
    await lifecycle.create({
      id: 'job_processor_timeout',
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: 'job_processor_timeout',
      maxAttempts: 1,
    });
    const processor = new ResearchJobProcessor(
      {
        runInline: async (
          _request: EngineRunRequest,
          options?: { signal?: AbortSignal },
        ) =>
          new Promise<JsonRecord>((_resolve, reject) => {
            const holdOpen = setTimeout(() => {
              reject(new Error('timeout test did not abort'));
            }, 1000);
            options?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(holdOpen);
                reject(new Error('aborted by test'));
              },
              { once: true },
            );
          }),
      } as unknown as PythonEngineClient,
      lifecycle,
    );

    await assert.rejects(
      () =>
        processor.process(request, {
          jobId: 'job_processor_timeout',
          backend: 'bullmq',
          attempt: 1,
          maxAttempts: 1,
          timeoutMs: 5,
        }),
      (error) =>
        error instanceof Error && error.message === 'aborted by test',
    );
    const status = await lifecycle.get('job_processor_timeout');

    assert.equal(status?.status, 'timed_out');
    assert.equal(status?.error_code, 'job_timed_out');
    assert.equal(status?.timeout_at !== null, true);
    await lifecycle.onModuleDestroy();
  });
});

test('POST /jobs/:id/cancel records durable cancellation for queued jobs', async () => {
  await withEnv(
    { DATABASE_URL: undefined, JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const lifecycle = new JobLifecycleService();
      const jobs = new JobsService(
        {
          runInline: async () => {
            throw new Error('cancelled job should not run');
          },
        } as unknown as PythonEngineClient,
        undefined,
        lifecycle,
      );
      const auth = new AuthService();
      const workspaces = new WorkspacesService();
      workspaces.setMembershipsForTest([
        { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
      ]);
      const jobsController = new JobsController(jobs, auth, workspaces);

      await jobs.enqueueResearchRun(engineRequest('run_cancelled'));
      const cancelled = await jobsController.cancel(
        'run_cancelled',
        'user_1',
        'workspace_a',
      );

      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.cancellation_requested_at !== null, true);
      assert.deepEqual(jobs.listMemoryJobs(), []);
      await jobs.onModuleDestroy();
      await lifecycle.onModuleDestroy();
    },
  );
});

test('PythonEngineClient resolves JSON output from the configured command', async () => {
  const scriptPath = await writeEngineScript(`
    const fs = require('node:fs');
    const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify({
      status: 'completed',
      run_id: request.run_id,
      workspace_id: request.workspace_id
    }));
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      const result = await new PythonEngineClient().runInline(
        engineRequest('run_python_success'),
      );

      assert.deepEqual(result, {
        status: 'completed',
        run_id: 'run_python_success',
        workspace_id: 'workspace_a',
      });
    },
  );
});

test('PythonEngineClient preserves failed engine JSON from non-zero exits', async () => {
  const scriptPath = await writeEngineScript(`
    const fs = require('node:fs');
    const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify({
      status: 'failed',
      run_id: request.run_id,
      workspace_id: request.workspace_id,
      error_type: 'quality_gate_failed',
      error: 'missing market snapshot'
    }));
    process.exit(1);
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      const result = await new PythonEngineClient().runInline(
        engineRequest('run_python_failed_json'),
      );

      assert.deepEqual(result, {
        status: 'failed',
        run_id: 'run_python_failed_json',
        workspace_id: 'workspace_a',
        error_type: 'quality_gate_failed',
        error: 'missing market snapshot',
      });
    },
  );
});

test('PythonEngineClient rejects non-zero engine exits with stderr', async () => {
  const scriptPath = await writeEngineScript(`
    process.stderr.write('engine failed');
    process.exit(7);
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      await assert.rejects(
        () => new PythonEngineClient().runInline(engineRequest('run_python_fail')),
        (error: unknown) =>
          error instanceof Error && /engine failed/.test(error.message),
      );
    },
  );
});

test('PythonEngineClient rejects successful exits with invalid JSON stdout', async () => {
  const scriptPath = await writeEngineScript(`
    process.stdout.write('not json');
  `);

  await withEnv(
    {
      PYTHON_ENGINE_COMMAND: process.execPath,
      PYTHON_ENGINE_ARGS: scriptPath,
    },
    async () => {
      await assert.rejects(
        () =>
          new PythonEngineClient().runInline(engineRequest('run_python_bad_json')),
        (error: unknown) => error instanceof SyntaxError,
      );
    },
  );
});

test('SqliteJournalSyncService uses configured export script outside repo cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'api-sqlite-sync-'));
  const scriptPath = join(dir, 'export.js');
  const sqlitePath = join(dir, 'research_journal.sqlite');
  await writeFile(sqlitePath, 'placeholder', 'utf8');
  await writeFile(
    scriptPath,
    `
      const runId = process.argv[3];
      process.stdout.write(JSON.stringify({
        research_runs: [{
          id: runId,
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          status: 'completed'
        }]
      }));
    `,
    'utf8',
  );

  await withEnv(
    {
      DATABASE_URL: undefined,
      PYTHON_SYNC_COMMAND: process.execPath,
      SQLITE_JOURNAL_EXPORT_SCRIPT: scriptPath,
      TRADINGAGENTS_JOURNAL_DB: sqlitePath,
    },
    async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpdir());
      try {
        const exported = await new SqliteJournalSyncService().exportRun(
          'run_exported',
        );

        assert.equal(exported?.research_runs[0]?.id, 'run_exported');
      } finally {
        process.chdir(previousCwd);
      }
    },
  );
});

test('ResearchRunsService workspace falls back to SQLite export artifacts', async () => {
  const journal = new FakeJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  } as unknown as PythonEngineClient);
  const sqliteSync = {
    exportRun: async (runId: string) =>
      runId === 'run_sqlite'
        ? {
            research_runs: [
              {
                id: 'run_sqlite',
                workspace_id: 'workspace_a',
                symbol: 'BTC/USDT',
                asset_class: 'crypto',
                market_type: 'spot',
                status: 'completed',
                market_snapshot_id: 'market_1',
                signal_snapshot_id: 'signal_snapshot_1',
                debate_id: 'debate_1',
                thesis_id: 'thesis_1',
                degradation_reasons_json: '[]',
                missing_core_data_json: '[]',
                missing_optional_data_json: '[]',
              },
            ],
            market_snapshots: [
              {
                id: 'market_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                current_price: 42000,
                source: 'fixture',
                payload_json: '{"source":"fixture"}',
              },
            ],
            signal_snapshots: [
              {
                id: 'signal_snapshot_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                signal_count: 2,
                bullish_count: 1,
                bearish_count: 0,
                neutral_count: 1,
                payload_json: '{}',
              },
            ],
            debates: [
              {
                id: 'debate_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                consensus_stance: 'bullish',
                conflict_level: 'low',
                payload_json: '{}',
              },
            ],
            agent_opinions: [
              {
                id: 'opinion_1',
                workspace_id: 'workspace_a',
                debate_id: 'debate_1',
                research_run_id: 'run_sqlite',
                agent_name: 'Market Analyst',
                agent_role: 'market',
                stance: 'bullish',
                confidence: 0.7,
                payload_json: '{}',
              },
            ],
            trade_theses: [
              {
                id: 'thesis_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                symbol: 'BTC/USDT',
                direction: 'long',
                setup_type: 'breakout',
                confidence: 0.8,
                payload_json:
                  '{"thesis_text":"Long setup","structured_summary":{"action_summary":"Watch breakout"}}',
              },
            ],
            scenarios: [
              {
                id: 'scenario_1',
                workspace_id: 'workspace_a',
                thesis_id: 'thesis_1',
                probability_band: 'base',
                suggested_user_action: 'watch',
                payload_json:
                  '{"condition":"breakout holds","expected_behavior":"uptrend continuation"}',
              },
            ],
            run_events: [
              {
                id: 'event_1',
                workspace_id: 'workspace_a',
                research_run_id: 'run_sqlite',
                event_type: 'completed',
                message: 'done',
                payload_json: '{}',
              },
            ],
          }
        : null,
  } as unknown as SqliteJournalSyncService;
  const researchRuns = new ResearchRunsService(
    journal,
    jobs,
    auth,
    workspaces,
    sqliteSync,
  );

  const workspace = await researchRuns.workspace(
    'run_sqlite',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.run_id, 'run_sqlite');
  assert.equal(workspace.snapshots.market_snapshot?.current_price, 42000);
  assert.equal(workspace.debate.agent_opinions.length, 1);
  assert.equal(workspace.thesis?.thesis_text, 'Long setup');
  assert.equal(workspace.scenarios[0]?.condition, 'breakout holds');
  await jobs.onModuleDestroy();
});

test('ResearchRunsService workspace exposes full report artifact metadata', async () => {
  const resultsDir = await mkdtemp(join(tmpdir(), 'lunacrypto-artifacts-'));
  const reportDir = join(resultsDir, 'BTC-USDT', '2026-05-12');
  const stateDir = join(resultsDir, 'BTC_USDT', 'ResearchWorkspace_logs');
  await mkdir(reportDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(reportDir, 'complete_report.md'), '# Report\n', 'utf8');
  await writeFile(
    join(stateDir, 'full_states_log_2026-05-12.json'),
    '{}\n',
    'utf8',
  );

  await withEnv({ TRADINGAGENTS_RESULTS_DIR: resultsDir }, async () => {
    const { journal, researchRuns, jobs } = buildHarness();
    journal.researchRuns.set(key('run_artifacts', 'workspace_a'), {
      id: 'run_artifacts',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      asset_class: 'crypto',
      market_type: 'spot',
      timeframe: '2026-05-12',
      status: 'completed',
      started_at: '2026-05-12T00:00:00.000Z',
      degradation_reasons: [],
      missing_core_data: [],
      missing_optional_data: [],
    });

    const workspace = await researchRuns.workspace(
      'run_artifacts',
      'user_1',
      'workspace_a',
    );

    assert.equal(workspace.artifacts.full_report.exists, true);
    assert.equal(workspace.artifacts.full_state.exists, true);
    assert.match(
      workspace.artifacts.full_report.path ?? '',
      /BTC-USDT[\\/]+2026-05-12[\\/]complete_report\.md$/,
    );
    assert.match(
      workspace.artifacts.full_state.path ?? '',
      /BTC_USDT[\\/]ResearchWorkspace_logs[\\/]full_states_log_2026-05-12\.json$/,
    );
    await jobs.onModuleDestroy();
  });
});

test('ResearchRunsService keeps active runs when durable job lifecycle exists', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const journal = new FakeJournalRepository();
    const auth = new AuthService();
    const workspaces = new WorkspacesService();
    workspaces.setMembershipsForTest([
      { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
    ]);
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_durable_active');
    await lifecycle.create({
      id: request.run_id,
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: request.run_id,
      maxAttempts: 3,
    });
    const jobs = new JobsService(
      {
        runInline: async () => ({
          status: 'completed',
          run_id: request.run_id,
        }),
      } as unknown as PythonEngineClient,
      undefined,
      lifecycle,
    );
    journal.researchRuns.set(key('run_durable_active', 'workspace_a'), {
      id: 'run_durable_active',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      asset_class: 'crypto',
      market_type: 'spot',
      status: 'running',
    });
    const researchRuns = new ResearchRunsService(
      journal,
      jobs,
      auth,
      workspaces,
    );

    const workspace = await researchRuns.workspace(
      'run_durable_active',
      'user_1',
      'workspace_a',
    );

    assert.equal(workspace.run.status, 'running');
    assert.deepEqual(workspace.events, []);
    await jobs.onModuleDestroy();
    await lifecycle.onModuleDestroy();
  });
});

test('ResearchRunsService marks active runs with missing job state as failed', async () => {
  const { journal, researchRuns } = buildHarness();
  journal.researchRuns.set(key('run_orphaned', 'workspace_a'), {
    id: 'run_orphaned',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    status: 'running',
    started_at: '2026-05-12T00:00:00.000Z',
    degradation_reasons: [],
    missing_core_data: [],
    missing_optional_data: [],
  });

  const workspace = await researchRuns.workspace(
    'run_orphaned',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.status, 'failed');
  assert.equal(workspace.run.completed_at !== null, true);
  assert.deepEqual(workspace.run.degradation_reasons, ['orphaned_job_state']);
  assert.deepEqual(workspace.run.missing_core_data, ['orphaned_job_state']);
  assert.equal(workspace.events.at(-1)?.event_type, 'run.failed');
});

test('ResearchRunsService marks orphaned SQLite fallback runs as failed in workspace response', async () => {
  const journal = new FakeJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  } as unknown as PythonEngineClient);
  const sqliteSync = {
    exportRun: async (runId: string) =>
      runId === 'run_sqlite_orphaned'
        ? {
            research_runs: [
              {
                id: 'run_sqlite_orphaned',
                workspace_id: 'workspace_a',
                symbol: 'BTC/USDT',
                asset_class: 'crypto',
                market_type: 'spot',
                status: 'running',
                degradation_reasons_json: '[]',
                missing_core_data_json: '[]',
                missing_optional_data_json: '[]',
              },
            ],
            run_events: [],
          }
        : null,
  } as unknown as SqliteJournalSyncService;
  const researchRuns = new ResearchRunsService(
    journal,
    jobs,
    auth,
    workspaces,
    sqliteSync,
  );

  const workspace = await researchRuns.workspace(
    'run_sqlite_orphaned',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.status, 'failed');
  assert.deepEqual(workspace.run.degradation_reasons, ['orphaned_job_state']);
  assert.equal(workspace.events.at(-1)?.event_type, 'run.failed');
  await jobs.onModuleDestroy();
});

test('ResearchRunsService keeps SQLite fallback usable when Postgres failure marking is unavailable', async () => {
  class UnavailableJournalRepository extends FakeJournalRepository {
    override async markResearchRunFailed(): Promise<JsonRecord | null> {
      throw new ServiceUnavailableException('database unavailable');
    }
  }

  const journal = new UnavailableJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  } as unknown as PythonEngineClient);
  const sqliteSync = {
    exportRun: async (runId: string) =>
      runId === 'run_sqlite_unavailable_mark'
        ? {
            research_runs: [
              {
                id: 'run_sqlite_unavailable_mark',
                workspace_id: 'workspace_a',
                symbol: 'BTC/USDT',
                asset_class: 'crypto',
                market_type: 'spot',
                status: 'running',
                degradation_reasons_json: '[]',
                missing_core_data_json: '[]',
                missing_optional_data_json: '[]',
              },
            ],
            run_events: [],
          }
        : null,
  } as unknown as SqliteJournalSyncService;
  const researchRuns = new ResearchRunsService(
    journal,
    jobs,
    auth,
    workspaces,
    sqliteSync,
  );

  const workspace = await researchRuns.workspace(
    'run_sqlite_unavailable_mark',
    'user_1',
    'workspace_a',
  );

  assert.equal(workspace.run.status, 'failed');
  assert.deepEqual(workspace.run.missing_core_data, ['orphaned_job_state']);
  assert.equal(workspace.events.at(-1)?.event_type, 'run.failed');
  await jobs.onModuleDestroy();
});

test('read APIs scope research runs and signals to the request workspace', async () => {
  const { journal, researchRuns, signals } = buildHarness();
  journal.researchRuns.set(key('run_1', 'workspace_a'), {
    id: 'run_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    status: 'completed',
  });
  journal.signals.push(
    {
      id: 'sig_a',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      signal_type: 'regime',
      direction: 'bullish',
    },
    {
      id: 'sig_b',
      workspace_id: 'workspace_b',
      symbol: 'BTC/USDT',
      signal_type: 'funding',
      direction: 'bearish',
    },
  );

  const run = await researchRuns.get('run_1', 'user_1', 'workspace_a');
  assert.equal(run.workspace_id, 'workspace_a');
  await assert.rejects(
    () => researchRuns.get('run_1', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );

  const workspaceSignals = await signals.list(
    'BTC',
    50,
    'user_1',
    'workspace_b',
  );
  assert.deepEqual(
    workspaceSignals.map((signal) => signal.id),
    ['sig_b'],
  );
  assert.deepEqual(await signals.count('BTC/USDT', 'user_1', 'workspace_b'), {
    total: 1,
    bullish: 0,
    bearish: 1,
    neutral: 0,
  });
  assert.deepEqual(await signals.count('BTC', 'user_1', 'workspace_b'), {
    total: 1,
    bullish: 0,
    bearish: 1,
    neutral: 0,
  });
});

test('GET /signals/:id returns provenance and raw evidence detail', async () => {
  const { journal, signals } = buildHarness();
  journal.signals.push(
    {
      id: 'sig_detail',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      signal_type: 'funding_rate',
      direction: 'bearish',
      confidence: 0.72,
      observed_at: '2026-05-12T01:00:00.000Z',
      summary: 'Funding overheated.',
      payload: {
        evidence_lane: 'perp',
        evidence_category: 'funding',
        strength: 0.8,
        heuristic_confidence: 0.72,
        confidence_version: 'heuristic:v1',
        provenance: {
          source: 'binance_futures',
          source_timestamp: '2026-05-12T00:59:00.000Z',
          freshness_status: 'fresh',
          age_seconds: 60,
        },
        evidence: { funding_rate: 0.0008 },
        watch_conditions: { review_trigger: 'funding cools' },
        research_run_id: 'run_1',
        signal_snapshot_id: 'snapshot_1',
      },
    },
    {
      id: 'sig_other_workspace',
      workspace_id: 'workspace_b',
      symbol: 'BTC/USDT',
      signal_type: 'funding_rate',
      direction: 'bullish',
    },
  );

  const detail = await signals.get('sig_detail', 'user_1', 'workspace_a');

  assert.equal(detail.id, 'sig_detail');
  assert.equal(detail.source, 'binance_futures');
  assert.equal(detail.freshness_status, 'fresh');
  assert.equal(detail.age_seconds, 60);
  assert.equal(detail.evidence_lane, 'perp');
  assert.deepEqual(detail.evidence, { funding_rate: 0.0008 });
  assert.deepEqual(detail.watch_conditions, { review_trigger: 'funding cools' });
  assert.equal(detail.research_run_id, 'run_1');
  await assert.rejects(
    () => signals.get('sig_detail', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );
});

test('signals and theses limits reject invalid values before repository reads', async () => {
  const { journal, signals, theses } = buildHarness();
  const signalsController = new SignalsController(signals);
  const thesesController = new ThesesController(theses);

  for (let index = 0; index < 150; index += 1) {
    journal.signals.push({
      id: `sig_${index}`,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      signal_type: 'regime',
      direction: 'neutral',
    });
    journal.theses.set(key(`thesis_${index}`, 'workspace_a'), {
      id: `thesis_${index}`,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      direction: 'watch',
    });
  }

  await assert.rejects(
    async () =>
      signalsController.list(undefined, 'not-a-number', 'user_1', 'workspace_a'),
    isException(BadRequestException),
  );
  await assert.rejects(
    async () => thesesController.list('not-a-number', 'user_1', 'workspace_a'),
    isException(BadRequestException),
  );

  const limitedSignals = await signalsController.list(
    undefined,
    '1000',
    'user_1',
    'workspace_a',
  );
  const limitedTheses = await thesesController.list(
    '1000',
    'user_1',
    'workspace_a',
  );

  assert.equal(limitedSignals.length, 100);
  assert.equal(limitedTheses.length, 100);
});

test('thesis decision and review verify workspace before writing', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Structured thesis.',
    structured_summary: {
      rating: 'Buy',
      direction: 'long',
      entry_zone: '100000',
      invalidation: '95000',
      target_zones: ['110000'],
    },
  });

  await assert.rejects(
    () => theses.decide('thesis_1', 'accepted', 'ok', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );
  await assert.rejects(
    () => theses.review('thesis_1', 'invalidated', 'bad', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );
  assert.equal(journal.decisionCalls.length, 0);
  assert.equal(journal.reviewCalls.length, 0);

  const decision = await theses.decide(
    'thesis_1',
    'accepted',
    'ok',
    'user_1',
    'workspace_a',
    {
      entry: '100000-101500',
      stop_loss: '95000',
      take_profit: '110000',
      position_intent: 'half_size_spot',
    },
  );
  const review = await theses.review(
    'thesis_1',
    'invalidated',
    'bad',
    'user_1',
    'workspace_a',
    {
      max_favorable_excursion: 0.04,
      max_adverse_excursion: -0.07,
    },
  );

  assert.equal(decision.workspace_id, 'workspace_a');
  assert.equal(decision.entry, '100000-101500');
  assert.equal(decision.stop_loss, '95000');
  assert.equal(decision.take_profit, '110000');
  assert.equal(decision.position_intent, 'half_size_spot');
  assert.equal(review.workspace_id, 'workspace_a');
  assert.equal(review.max_favorable_excursion, 0.04);
  assert.equal(review.max_adverse_excursion, -0.07);
  assert.equal(journal.decisionCalls[0]?.workspaceId, 'workspace_a');
  assert.deepEqual(journal.decisionCalls[0]?.intent, {
    entry: '100000-101500',
    stop_loss: '95000',
    take_profit: '110000',
    position_intent: 'half_size_spot',
  });
  assert.equal(journal.reviewCalls[0]?.workspaceId, 'workspace_a');
  assert.deepEqual(journal.reviewCalls[0]?.metrics, {
    max_favorable_excursion: 0.04,
    max_adverse_excursion: -0.07,
  });
});

test('calibration evaluates a thesis idempotently and records one outcome review', async () => {
  const { calibration, journal } = buildHarness();
  journal.theses.set(key('thesis_calibration', 'workspace_a'), {
    id: 'thesis_calibration',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.74,
    created_at: '2020-01-01T00:00:00.000Z',
    thesis_text: 'Evaluate this thesis.',
  });

  const first = await calibration.evaluateThesis(
    { thesis_id: 'thesis_calibration', window_days: 14 },
    'user_1',
    'workspace_a',
  );
  const second = await calibration.evaluateThesis(
    { thesis_id: 'thesis_calibration', window_days: 14 },
    'user_1',
    'workspace_a',
  );
  const review = await calibration.recordOutcomeReview(
    first.evaluation.id ?? '',
    { notes: 'Reviewed after inspection.' },
    'user_1',
    'workspace_a',
  );
  const duplicateReview = await calibration.recordOutcomeReview(
    first.evaluation.id ?? '',
    { notes: 'Should not duplicate.' },
    'user_1',
    'workspace_a',
  );

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.evaluation.id, first.evaluation.id);
  assert.equal(first.evaluation.result, 'hit_target');
  assert.equal(first.evaluation.can_record_review, true);
  assert.equal(review.created, true);
  assert.equal(review.outcome_review?.result, 'hit_target');
  assert.equal(review.evaluation.outcome_review_id, review.outcome_review?.id);
  assert.equal(duplicateReview.created, false);
  assert.equal(journal.reviewCalls.length, 1);
  assert.deepEqual(journal.reviewCalls[0]?.metrics?.metadata, {
    source: 'calibration_lab',
    evaluation_id: first.evaluation.id,
    window_days: 14,
  });
});

test('calibration returns blockers instead of recording unusable reviews', async () => {
  const { calibration, journal } = buildHarness();
  journal.thesisEvaluations.set(key('evaluation_future', 'workspace_a'), {
    id: 'evaluation_future',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_future',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: '2999-01-01',
    evaluation_end: '2999-01-15',
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.1,
    max_adverse_excursion: -0.03,
    invalidated: false,
    warnings: ['incomplete_window'],
    evidence: {},
  });
  journal.thesisEvaluations.set(key('evaluation_unknown', 'workspace_a'), {
    id: 'evaluation_unknown',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_unknown',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: '2020-01-01',
    evaluation_end: '2020-01-15',
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'unknown',
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    invalidated: false,
    warnings: [],
    evidence: {},
  });

  const future = await calibration.recordOutcomeReview(
    'evaluation_future',
    {},
    'user_1',
    'workspace_a',
  );
  const unknown = await calibration.recordOutcomeReview(
    'evaluation_unknown',
    {},
    'user_1',
    'workspace_a',
  );

  assert.equal(future.created, false);
  assert.deepEqual(future.warnings, ['incomplete_window']);
  assert.equal(unknown.created, false);
  assert.deepEqual(unknown.warnings, ['unknown_result']);
  assert.equal(journal.reviewCalls.length, 0);
});

test('calibration rerun audit lists requested evaluation history only', async () => {
  const { calibration, journal } = buildHarness();
  journal.thesisEvaluations.set(key('evaluation_list', 'workspace_a'), {
    id: 'evaluation_list',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_list',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-15',
    evaluated_at: '2026-05-16T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.1,
    max_adverse_excursion: -0.02,
    invalidated: false,
    warnings: [],
    evidence: {},
  });
  for (const run of [
    {
      id: 'rerun_b',
      workspace_id: 'workspace_a',
      canonical_evaluation_id: 'evaluation_list',
      thesis_id: 'thesis_list',
      requested_at: '2026-05-22T08:00:00.000Z',
      status: 'completed',
      reason: 'manual_check',
    },
    {
      id: 'rerun_a',
      workspace_id: 'workspace_a',
      canonical_evaluation_id: 'evaluation_list',
      thesis_id: 'thesis_list',
      requested_at: '2026-05-22T08:00:00.000Z',
      status: 'completed',
      reason: 'manual_check',
    },
    {
      id: 'rerun_old',
      workspace_id: 'workspace_a',
      canonical_evaluation_id: 'evaluation_list',
      thesis_id: 'thesis_list',
      requested_at: '2026-05-21T08:00:00.000Z',
      status: 'completed',
      reason: 'bug_fix_verification',
    },
    {
      id: 'rerun_other_eval',
      workspace_id: 'workspace_a',
      canonical_evaluation_id: 'evaluation_other',
      thesis_id: 'thesis_list',
      requested_at: '2026-05-23T08:00:00.000Z',
      status: 'completed',
      reason: 'manual_check',
    },
    {
      id: 'rerun_other_workspace',
      workspace_id: 'workspace_b',
      canonical_evaluation_id: 'evaluation_list',
      thesis_id: 'thesis_list',
      requested_at: '2026-05-23T08:00:00.000Z',
      status: 'completed',
      reason: 'manual_check',
    },
  ]) {
    journal.thesisEvaluationRuns.set(key(String(run.id), String(run.workspace_id)), run);
  }

  const rows = await calibration.listEvaluationReruns(
    'evaluation_list',
    { limit: 2 },
    'viewer_1',
    'workspace_a',
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ['rerun_a', 'rerun_b'],
  );
});

test('calibration rerun audit creates completed records without mutating canonical evaluations', async () => {
  const { calibration, evaluationEngineCalls, journal } = buildHarness();
  journal.theses.set(key('thesis_rerun', 'workspace_a'), {
    id: 'thesis_rerun',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.7,
    created_at: '2026-05-01T00:00:00.000Z',
  });
  const canonical = {
    id: 'evaluation_rerun_source',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_rerun',
    outcome_review_id: null,
    symbol: 'ETH/USDT',
    window_days: 14,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-15',
    evaluated_at: '2026-05-16T00:00:00.000Z',
    result: 'mixed',
    max_favorable_excursion: 0.1,
    max_adverse_excursion: -0.05,
    invalidated: true,
    warnings: ['canonical_warning', 'shared_warning'],
    evidence: { start_price: 90, end_price: 110 },
    payload: { canonical: true },
  };
  journal.thesisEvaluations.set(key(canonical.id, 'workspace_a'), { ...canonical });

  const response = await calibration.createEvaluationRerun(
    canonical.id,
    {
      reason: 'manual_check',
      notes: 'Verify after rule changes.',
      idempotency_key: 'rerun-key-1',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.created, true);
  assert.equal(response.rerun.status, 'completed');
  assert.equal(response.rerun.canonical_evaluation_id, canonical.id);
  assert.equal(response.rerun.thesis_id, 'thesis_rerun');
  assert.equal(response.rerun.symbol, 'ETH/USDT');
  assert.equal(response.rerun.reason, 'manual_check');
  assert.equal(response.rerun.notes, 'Verify after rule changes.');
  assert.equal(response.rerun.result, 'hit_target');
  assert.deepEqual(response.rerun.diff, {
    result_changed: true,
    canonical_result: 'mixed',
    rerun_result: 'hit_target',
    mfe_delta: 0.02,
    mae_delta: 0.01,
    invalidated_changed: true,
    warnings_added: ['incomplete_window'],
    warnings_removed: ['canonical_warning', 'shared_warning'],
    start_price_delta: 10,
    end_price_delta: 2,
  });
  assert.deepEqual(
    journal.thesisEvaluations.get(key(canonical.id, 'workspace_a')),
    canonical,
  );
  assert.equal(journal.thesisEvaluationRuns.size, 1);
  assert.equal(evaluationEngineCalls.length, 1);
  assert.deepEqual(evaluationEngineCalls[0], {
    thesis_id: 'thesis_rerun',
    workspace_id: 'workspace_a',
    window_days: 14,
    metadata: {
      source: 'calibration_lab_v1_3_rerun',
      canonical_evaluation_id: canonical.id,
      rerun_reason: 'manual_check',
    },
  });
});

test('calibration rerun audit is idempotent for duplicate keys', async () => {
  const { calibration, evaluationEngineCalls, journal } = buildHarness();
  journal.theses.set(key('thesis_rerun_idempotent', 'workspace_a'), {
    id: 'thesis_rerun_idempotent',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    created_at: '2026-05-01T00:00:00.000Z',
  });
  journal.thesisEvaluations.set(key('evaluation_idempotent', 'workspace_a'), {
    id: 'evaluation_idempotent',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_rerun_idempotent',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-08',
    evaluated_at: '2026-05-09T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.12,
    max_adverse_excursion: -0.04,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 100, end_price: 112 },
  });

  const first = await calibration.createEvaluationRerun(
    'evaluation_idempotent',
    { reason: 'manual_check', idempotency_key: 'same-key' },
    'user_1',
    'workspace_a',
  );
  const second = await calibration.createEvaluationRerun(
    'evaluation_idempotent',
    { reason: 'bug_fix_verification', idempotency_key: 'same-key' },
    'user_1',
    'workspace_a',
  );

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.rerun.id, first.rerun.id);
  assert.deepEqual(second.warnings, ['rerun_already_exists']);
  assert.equal(evaluationEngineCalls.length, 1);
  assert.equal(journal.thesisEvaluationRuns.size, 1);
});

test('calibration rerun audit persists failed engine attempts', async () => {
  const { calibration, journal } = buildHarness();
  journal.theses.set(key('thesis_provider_fail_rerun', 'workspace_a'), {
    id: 'thesis_provider_fail_rerun',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    created_at: '2026-05-01T00:00:00.000Z',
  });
  journal.thesisEvaluations.set(key('evaluation_failed_rerun', 'workspace_a'), {
    id: 'evaluation_failed_rerun',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_provider_fail_rerun',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-15',
    evaluated_at: '2026-05-16T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.12,
    max_adverse_excursion: -0.04,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 100, end_price: 112 },
  });

  await assert.rejects(
    () =>
      calibration.createEvaluationRerun(
        'evaluation_failed_rerun',
        { reason: 'suspected_drift', notes: 'Provider smoke.' },
        'user_1',
        'workspace_a',
      ),
    isException(ServiceUnavailableException),
  );

  const rows = await calibration.listEvaluationReruns(
    'evaluation_failed_rerun',
    { limit: 20 },
    'viewer_1',
    'workspace_a',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'failed');
  assert.equal(rows[0]?.error_type, 'ProviderError');
  assert.equal(rows[0]?.error_message, 'Provider returned no candles');
});

test('calibration rerun audit requires an existing evaluation and editor access', async () => {
  const { calibration, journal } = buildHarness();
  journal.thesisEvaluations.set(key('evaluation_permission', 'workspace_a'), {
    id: 'evaluation_permission',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_permission',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-15',
    evaluated_at: '2026-05-16T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.12,
    max_adverse_excursion: -0.04,
    invalidated: false,
    warnings: [],
    evidence: {},
  });

  await assert.rejects(
    () =>
      calibration.createEvaluationRerun(
        'missing_evaluation',
        { reason: 'manual_check' },
        'user_1',
        'workspace_a',
      ),
    isException(NotFoundException),
  );
  await assert.rejects(
    () =>
      calibration.createEvaluationRerun(
        'evaluation_permission',
        { reason: 'manual_check' },
        'viewer_1',
        'workspace_a',
      ),
    isException(ForbiddenException),
  );
});

test('CreateEvaluationRerunDto requires a valid reason', async () => {
  await assert.rejects(
    () => validateCreateEvaluationRerun({ notes: 'missing reason' }),
    isException(BadRequestException),
  );
  await assert.rejects(
    () => validateCreateEvaluationRerun({ reason: 'invalid_reason' }),
    isException(BadRequestException),
  );

  const dto = await validateCreateEvaluationRerun({
    reason: 'manual_check',
    notes: 'Valid notes.',
    idempotency_key: 'client-key-1',
  });
  assert.equal(dto.reason, 'manual_check');
  assert.equal(dto.notes, 'Valid notes.');
  assert.equal(dto.idempotency_key, 'client-key-1');
});

test('calibration version policy promotes completed reruns and resets to base', async () => {
  const { calibration, journal } = buildHarness();
  journal.theses.set(key('thesis_policy', 'workspace_a'), {
    id: 'thesis_policy',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    created_at: '2026-05-01T00:00:00.000Z',
  });
  const canonical = {
    id: 'evaluation_policy',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_policy',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-08',
    evaluated_at: '2026-05-09T00:00:00.000Z',
    result: 'mixed',
    max_favorable_excursion: 0.041,
    max_adverse_excursion: -0.026,
    invalidated: false,
    warnings: ['base_warning'],
    evidence: { start_price: 100, end_price: 103 },
    payload: { source: 'base' },
  };
  const rerun = completedRerunFixture({
    id: 'rerun_policy',
    canonicalEvaluationId: canonical.id,
    thesisId: 'thesis_policy',
    result: 'hit_target',
    maxFavorableExcursion: 0.052,
    maxAdverseExcursion: -0.013,
    evidence: { start_price: 100, end_price: 112 },
  });
  journal.thesisEvaluations.set(key(canonical.id, 'workspace_a'), canonical);
  journal.thesisEvaluationRuns.set(key(rerun.id, 'workspace_a'), rerun);

  const basePolicy = await calibration.getEvaluationVersionPolicy(
    canonical.id,
    'viewer_1',
    'workspace_a',
  );

  assert.equal(basePolicy.active_source, 'base_canonical');
  assert.equal(basePolicy.active_rerun_id, null);
  assert.equal(basePolicy.active_evaluation.result, 'mixed');
  assert.deepEqual(basePolicy.events, []);

  const promoted = await calibration.promoteEvaluationRerun(
    canonical.id,
    rerun.id,
    {
      reason: 'bug_fix_verification',
      notes: 'Promote rerun after provider data fix.',
      idempotency_key: 'promote-key-1',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(promoted.created, true);
  assert.equal(promoted.event?.action, 'promote_rerun');
  assert.equal(promoted.event?.promoted_rerun_id, rerun.id);
  assert.equal(promoted.policy.active_source, 'promoted_rerun');
  assert.equal(promoted.policy.active_evaluation.id, canonical.id);
  assert.equal(promoted.policy.active_evaluation.result, 'hit_target');
  assert.equal(journal.thesisEvaluationPromotions.size, 1);

  const activeDetail = await calibration.getEvaluation(
    canonical.id,
    'viewer_1',
    'workspace_a',
  );
  assert.equal(activeDetail.id, canonical.id);
  assert.equal(activeDetail.base_evaluation_id, canonical.id);
  assert.equal(activeDetail.active_source, 'promoted_rerun');
  assert.equal(activeDetail.active_rerun_id, rerun.id);
  assert.equal(activeDetail.result, 'hit_target');
  assert.equal(activeDetail.max_adverse_excursion, -0.013);
  assert.deepEqual(activeDetail.evidence, rerun.evidence);

  const duplicate = await calibration.promoteEvaluationRerun(
    canonical.id,
    rerun.id,
    {
      reason: 'manual_check',
      idempotency_key: 'promote-key-1',
    },
    'user_1',
    'workspace_a',
  );
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.event?.id, promoted.event?.id);
  assert.deepEqual(duplicate.warnings, ['promotion_already_exists']);
  assert.equal(journal.thesisEvaluationPromotions.size, 1);

  const sameState = await calibration.promoteEvaluationRerun(
    canonical.id,
    rerun.id,
    { reason: 'manual_check' },
    'user_1',
    'workspace_a',
  );
  assert.equal(sameState.created, false);
  assert.equal(sameState.event, null);
  assert.deepEqual(sameState.warnings, ['promotion_already_active']);
  assert.equal(journal.thesisEvaluationPromotions.size, 1);

  const reset = await calibration.resetEvaluationVersionPolicy(
    canonical.id,
    {
      reason: 'manual_check',
      notes: 'Return to base canonical evaluation.',
      idempotency_key: 'reset-key-1',
    },
    'user_1',
    'workspace_a',
  );
  assert.equal(reset.created, true);
  assert.equal(reset.event?.action, 'reset_to_base');
  assert.equal(reset.event?.promoted_rerun_id, null);
  assert.equal(reset.policy.active_source, 'base_canonical');
  assert.equal(reset.policy.active_evaluation.result, 'mixed');

  const resetDetail = await calibration.getEvaluation(
    canonical.id,
    'viewer_1',
    'workspace_a',
  );
  assert.equal(resetDetail.result, 'mixed');
  assert.equal(resetDetail.active_source, 'base_canonical');
  assert.equal(resetDetail.active_promotion_id, reset.event?.id);

  const sameReset = await calibration.resetEvaluationVersionPolicy(
    canonical.id,
    { reason: 'manual_check' },
    'user_1',
    'workspace_a',
  );
  assert.equal(sameReset.created, false);
  assert.equal(sameReset.event, null);
  assert.deepEqual(sameReset.warnings, ['base_already_active']);
  assert.equal(journal.thesisEvaluationPromotions.size, 2);

  const rawList = await calibration.listEvaluations(
    { thesisId: 'thesis_policy', limit: 10 },
    'viewer_1',
    'workspace_a',
  );
  assert.equal(rawList[0]?.result, 'mixed');

  const rawRuns = await calibration.listEvaluationReruns(
    canonical.id,
    { limit: 20 },
    'viewer_1',
    'workspace_a',
  );
  assert.equal(rawRuns[0]?.id, rerun.id);
  assert.equal(rawRuns[0]?.result, 'hit_target');
});

test('calibration version policy blocks unsafe promotion and reset paths', async () => {
  const { calibration, journal } = buildHarness();
  journal.thesisEvaluations.set(key('evaluation_policy_safe', 'workspace_a'), {
    id: 'evaluation_policy_safe',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_policy_safe',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-08',
    evaluated_at: '2026-05-09T00:00:00.000Z',
    result: 'mixed',
    max_favorable_excursion: 0.041,
    max_adverse_excursion: -0.026,
    invalidated: false,
    warnings: [],
    evidence: {},
  });
  journal.thesisEvaluations.set(key('evaluation_policy_reviewed', 'workspace_a'), {
    id: 'evaluation_policy_reviewed',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_policy_reviewed',
    outcome_review_id: 'review_1',
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-08',
    evaluated_at: '2026-05-09T00:00:00.000Z',
    result: 'mixed',
    max_favorable_excursion: 0.041,
    max_adverse_excursion: -0.026,
    invalidated: false,
    warnings: [],
    evidence: {},
  });
  const failedRun = completedRerunFixture({
    id: 'rerun_policy_failed',
    canonicalEvaluationId: 'evaluation_policy_safe',
    thesisId: 'thesis_policy_safe',
    status: 'failed',
    result: null,
  });
  const mismatchedRun = completedRerunFixture({
    id: 'rerun_policy_mismatch',
    canonicalEvaluationId: 'evaluation_other',
    thesisId: 'thesis_policy_safe',
  });
  const completedRun = completedRerunFixture({
    id: 'rerun_policy_safe',
    canonicalEvaluationId: 'evaluation_policy_safe',
    thesisId: 'thesis_policy_safe',
  });
  for (const run of [failedRun, mismatchedRun, completedRun]) {
    journal.thesisEvaluationRuns.set(key(run.id, 'workspace_a'), run);
  }

  const missing = await calibration.promoteEvaluationRerun(
    'evaluation_policy_safe',
    'missing_rerun',
    { reason: 'manual_check' },
    'user_1',
    'workspace_a',
  );
  assert.equal(missing.created, false);
  assert.deepEqual(missing.warnings, ['rerun_not_found']);

  const failed = await calibration.promoteEvaluationRerun(
    'evaluation_policy_safe',
    failedRun.id,
    { reason: 'manual_check' },
    'user_1',
    'workspace_a',
  );
  assert.equal(failed.created, false);
  assert.deepEqual(failed.warnings, ['rerun_not_completed']);

  const mismatch = await calibration.promoteEvaluationRerun(
    'evaluation_policy_safe',
    mismatchedRun.id,
    { reason: 'manual_check' },
    'user_1',
    'workspace_a',
  );
  assert.equal(mismatch.created, false);
  assert.deepEqual(mismatch.warnings, ['rerun_mismatch']);

  const reviewedPromote = await calibration.promoteEvaluationRerun(
    'evaluation_policy_reviewed',
    completedRun.id,
    { reason: 'manual_check' },
    'user_1',
    'workspace_a',
  );
  assert.equal(reviewedPromote.created, false);
  assert.deepEqual(reviewedPromote.warnings, ['review_already_recorded']);

  const reviewedReset = await calibration.resetEvaluationVersionPolicy(
    'evaluation_policy_reviewed',
    { reason: 'manual_check' },
    'user_1',
    'workspace_a',
  );
  assert.equal(reviewedReset.created, false);
  assert.deepEqual(reviewedReset.warnings, ['review_already_recorded']);

  await assert.rejects(
    () =>
      calibration.promoteEvaluationRerun(
        'evaluation_policy_safe',
        completedRun.id,
        { reason: 'manual_check' },
        'viewer_1',
        'workspace_a',
      ),
    isException(ForbiddenException),
  );

  const viewerPolicy = await calibration.getEvaluationVersionPolicy(
    'evaluation_policy_safe',
    'viewer_1',
    'workspace_a',
  );
  assert.equal(viewerPolicy.active_source, 'base_canonical');
  assert.equal(journal.thesisEvaluationPromotions.size, 0);
});

test('calibration matured preview marks candidate existing not mature and invalid rows', async () => {
  const { calibration, journal } = buildHarness();
  journal.theses.set(key('thesis_batch_candidate', 'workspace_a'), {
    id: 'thesis_batch_candidate',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    created_at: '2020-01-01T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_batch_existing', 'workspace_a'), {
    id: 'thesis_batch_existing',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    created_at: '2020-01-02T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_batch_future', 'workspace_a'), {
    id: 'thesis_batch_future',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    created_at: '2999-01-01T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_batch_missing_created', 'workspace_a'), {
    id: 'thesis_batch_missing_created',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
  });
  journal.theses.set(key('thesis_batch_missing_symbol', 'workspace_a'), {
    id: 'thesis_batch_missing_symbol',
    workspace_id: 'workspace_a',
    created_at: '2020-01-03T00:00:00.000Z',
  });
  journal.thesisEvaluations.set(key('evaluation_existing_batch', 'workspace_a'), {
    id: 'evaluation_existing_batch',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_batch_existing',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: '2020-01-02',
    evaluation_end: '2020-01-16',
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.1,
    max_adverse_excursion: -0.03,
    invalidated: false,
    warnings: [],
    evidence: {},
  });

  const response = await calibration.previewMaturedEvaluations(
    { window_days: 14, scan_limit: 10 },
    'user_1',
    'workspace_a',
  );
  const statuses = new Map(
    response.rows.map((row) => [row.thesis_id, [row.status, row.reason]]),
  );

  assert.deepEqual(response.summary, {
    candidate: 1,
    existing: 1,
    not_mature: 1,
    invalid_thesis: 2,
  });
  assert.deepEqual(statuses.get('thesis_batch_candidate'), ['candidate', null]);
  assert.deepEqual(statuses.get('thesis_batch_existing'), [
    'existing',
    'evaluation_already_exists',
  ]);
  assert.deepEqual(statuses.get('thesis_batch_future'), [
    'not_mature',
    'window_not_closed',
  ]);
  assert.deepEqual(statuses.get('thesis_batch_missing_created'), [
    'invalid_thesis',
    'missing_created_at',
  ]);
  assert.deepEqual(statuses.get('thesis_batch_missing_symbol'), [
    'invalid_thesis',
    'missing_symbol',
  ]);
});

test('calibration matured apply caps candidates and keeps row failures local', async () => {
  const { calibration, journal } = buildHarness();
  for (const [id, createdAt] of [
    ['thesis_batch_create', '2020-01-01T00:00:00.000Z'],
    ['thesis_batch_provider_fail', '2020-01-02T00:00:00.000Z'],
    ['thesis_batch_after_cap', '2020-01-03T00:00:00.000Z'],
    ['thesis_batch_existing_apply', '2020-01-04T00:00:00.000Z'],
  ]) {
    journal.theses.set(key(id, 'workspace_a'), {
      id,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      created_at: createdAt,
    });
  }
  journal.thesisEvaluations.set(key('evaluation_existing_apply', 'workspace_a'), {
    id: 'evaluation_existing_apply',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_batch_existing_apply',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: '2020-01-04',
    evaluation_end: '2020-01-18',
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.1,
    max_adverse_excursion: -0.03,
    invalidated: false,
    warnings: [],
    evidence: {},
  });

  const response = await calibration.applyMaturedEvaluations(
    { window_days: 14, max_batch: 2 },
    'user_1',
    'workspace_a',
  );
  const rows = new Map(response.rows.map((row) => [row.thesis_id, row]));

  assert.deepEqual(response.summary, {
    created: 1,
    existing: 1,
    skipped: 1,
    failed: 1,
  });
  assert.equal(rows.get('thesis_batch_create')?.status, 'created');
  assert.equal(rows.get('thesis_batch_provider_fail')?.status, 'failed');
  assert.equal(rows.get('thesis_batch_provider_fail')?.reason, 'provider_error');
  assert.equal(rows.get('thesis_batch_after_cap')?.status, 'skipped');
  assert.equal(rows.get('thesis_batch_after_cap')?.reason, 'max_batch_excluded');
  assert.equal(rows.get('thesis_batch_existing_apply')?.status, 'existing');
  assert.equal(journal.outcomeReviews.length, 0);
});

test('calibration matured apply is idempotent on repeat', async () => {
  const { calibration, journal } = buildHarness();
  journal.theses.set(key('thesis_batch_idempotent', 'workspace_a'), {
    id: 'thesis_batch_idempotent',
    workspace_id: 'workspace_a',
    symbol: 'SOL/USDT',
    created_at: '2020-02-01T00:00:00.000Z',
  });

  const first = await calibration.applyMaturedEvaluations(
    { window_days: 14, max_batch: 10 },
    'user_1',
    'workspace_a',
  );
  const second = await calibration.applyMaturedEvaluations(
    { window_days: 14, max_batch: 10 },
    'user_1',
    'workspace_a',
  );
  const saved = [...journal.thesisEvaluations.values()].filter(
    (evaluation) => evaluation.thesis_id === 'thesis_batch_idempotent',
  );

  assert.equal(first.rows[0]?.status, 'created');
  assert.equal(second.rows[0]?.status, 'existing');
  assert.equal(saved.length, 1);
});

test('calibration matured symbol filter is exact and workspace scoped', async () => {
  const { calibration, journal } = buildHarness();
  journal.theses.set(key('thesis_batch_btc', 'workspace_a'), {
    id: 'thesis_batch_btc',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    created_at: '2020-03-01T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_batch_eth', 'workspace_a'), {
    id: 'thesis_batch_eth',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    created_at: '2020-03-02T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_batch_other_workspace', 'workspace_b'), {
    id: 'thesis_batch_other_workspace',
    workspace_id: 'workspace_b',
    symbol: 'BTC/USDT',
    created_at: '2020-03-03T00:00:00.000Z',
  });

  const response = await calibration.previewMaturedEvaluations(
    { window_days: 14, scan_limit: 10, symbol: 'btcusdt' },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.symbol, 'BTC/USDT');
  assert.deepEqual(
    response.rows.map((row) => row.thesis_id),
    ['thesis_batch_btc'],
  );
});

test('symbol thesis cluster aggregates coverage stance outcome summary and compact rows', async () => {
  const { calibration, journal } = buildHarness();
  const { periodStart, periodEnd } = symbolCalibrationPeriod(7, 30);
  const createdDates = [
    addDaysIsoDate(periodEnd, -4),
    addDaysIsoDate(periodEnd, -3),
    addDaysIsoDate(periodEnd, -2),
    addDaysIsoDate(periodEnd, -1),
  ];
  const theses = [
    {
      id: 'thesis_symbol_unknown_missing',
      direction: 'sideways',
      confidence: 0.51,
      created_at: `${createdDates[0]}T00:00:00.000Z`,
    },
    {
      id: 'thesis_symbol_def_missing',
      direction: 'avoid',
      confidence: 0.62,
      created_at: `${createdDates[1]}T00:00:00.000Z`,
    },
    {
      id: 'thesis_symbol_bull_mixed',
      direction: '',
      confidence: 0.71,
      created_at: `${createdDates[2]}T00:00:00.000Z`,
      payload: { structured_summary: { stance: 'overweight' } },
    },
    {
      id: 'thesis_symbol_bull_hit',
      direction: 'long',
      confidence: 0.82,
      created_at: `${createdDates[3]}T00:00:00.000Z`,
    },
  ];
  for (const thesis of theses) {
    journal.theses.set(key(thesis.id, 'workspace_a'), {
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      ...thesis,
    });
  }
  journal.theses.set(key('thesis_symbol_eth', 'workspace_a'), {
    id: 'thesis_symbol_eth',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    direction: 'long',
    created_at: `${createdDates[3]}T00:00:00.000Z`,
  });
  journal.theses.set(key('thesis_symbol_workspace_b', 'workspace_b'), {
    id: 'thesis_symbol_workspace_b',
    workspace_id: 'workspace_b',
    symbol: 'BTC/USDT',
    direction: 'long',
    created_at: `${createdDates[3]}T00:00:00.000Z`,
  });
  journal.theses.set(key('thesis_symbol_old', 'workspace_a'), {
    id: 'thesis_symbol_old',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    created_at: `${addDaysIsoDate(periodStart, -1)}T00:00:00.000Z`,
  });
  journal.thesisEvaluations.set(key('evaluation_symbol_hit', 'workspace_a'), {
    id: 'evaluation_symbol_hit',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_symbol_bull_hit',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: createdDates[3],
    evaluation_end: addDaysIsoDate(createdDates[3], 7),
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.08,
    max_adverse_excursion: -0.02,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 100, end_price: 105 },
  });
  journal.thesisEvaluations.set(key('evaluation_symbol_mixed', 'workspace_a'), {
    id: 'evaluation_symbol_mixed',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_symbol_bull_mixed',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: createdDates[2],
    evaluation_end: addDaysIsoDate(createdDates[2], 7),
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'mixed',
    max_favorable_excursion: 0.02,
    max_adverse_excursion: -0.05,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 200, end_price: 206 },
  });
  journal.thesisEvaluations.set(key('evaluation_symbol_wrong_window', 'workspace_a'), {
    id: 'evaluation_symbol_wrong_window',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_symbol_def_missing',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: createdDates[1],
    evaluation_end: addDaysIsoDate(createdDates[1], 14),
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.9,
    max_adverse_excursion: -0.01,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 100, end_price: 150 },
  });

  const response = await calibration.getSymbolCalibrationReport(
    { symbol: 'btcusdt', window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.symbol, 'BTC/USDT');
  assert.equal(response.period_start, periodStart);
  assert.equal(response.period_end, periodEnd);
  assert.deepEqual(response.coverage, {
    matured_thesis_count: 4,
    evaluated_count: 2,
    missing_evaluation_count: 2,
    coverage_pct: 0.5,
  });
  assert.deepEqual(response.stance.stance_counts, {
    bullish: 2,
    bearish: 0,
    defensive: 1,
    neutral: 0,
    unknown: 1,
  });
  assert.equal(response.stance.consensus_stance, 'bullish');
  assert.equal(response.stance.conflict_rate, 0.3333);
  assert.deepEqual(response.outcome.result_counts, {
    hit_target: 1,
    invalidated: 0,
    mixed: 1,
    expired: 0,
    unknown: 0,
  });
  assert.equal(response.outcome.hit_rate, 0.5);
  assert.equal(response.outcome.mixed_rate, 0.5);
  assert.equal(response.outcome.avg_mfe, 0.05);
  assert.equal(response.outcome.avg_mae, -0.035);
  assert.equal(response.outcome.best_mfe, 0.08);
  assert.equal(response.outcome.worst_mae, -0.05);
  assert.equal(response.outcome.representative_return, 0.04);
  assert.equal(response.coverage_status, 'sparse');
  assert.equal(response.consistency_status, 'mixed');
  assert.equal(response.outcome_status, 'inconclusive');
  assert.deepEqual(
    response.rows.map((row) => [row.thesis_id, row.status, row.stance]),
    [
      ['thesis_symbol_bull_hit', 'evaluated', 'bullish'],
      ['thesis_symbol_bull_mixed', 'evaluated', 'bullish'],
      ['thesis_symbol_def_missing', 'missing_evaluation', 'defensive'],
      ['thesis_symbol_unknown_missing', 'missing_evaluation', 'unknown'],
    ],
  );
});

test('symbol thesis cluster status fields describe coverage consistency and evaluated thesis outcomes', async () => {
  const { calibration, journal } = buildHarness();
  const { periodEnd } = symbolCalibrationPeriod(7, 30);
  const createdDates = [4, 3, 2, 1].map((offset) =>
    addDaysIsoDate(periodEnd, -offset),
  );

  for (const [index, createdDate] of createdDates.entries()) {
    journal.theses.set(key(`thesis_cluster_status_${index}`, 'workspace_a'), {
      id: `thesis_cluster_status_${index}`,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      direction: 'long',
      confidence: 0.7,
      created_at: `${createdDate}T00:00:00.000Z`,
    });
  }

  for (const [index, result] of ['hit_target', 'hit_target', 'invalidated'].entries()) {
    const createdDate = createdDates[index];
    journal.thesisEvaluations.set(
      key(`evaluation_cluster_status_${index}`, 'workspace_a'),
      {
        id: `evaluation_cluster_status_${index}`,
        workspace_id: 'workspace_a',
        thesis_id: `thesis_cluster_status_${index}`,
        outcome_review_id: null,
        symbol: 'BTC/USDT',
        window_days: 7,
        evaluation_start: createdDate,
        evaluation_end: addDaysIsoDate(createdDate, 7),
        evaluated_at: '2026-05-12T00:00:00.000Z',
        result,
        max_favorable_excursion: 0.08,
        max_adverse_excursion: -0.02,
        invalidated: result === 'invalidated',
        warnings: [],
        evidence: { start_price: 100, end_price: 105 },
      },
    );
  }

  const response = await calibration.getSymbolCalibrationReport(
    { symbol: 'BTC/USDT', window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.coverage.evaluated_count, 3);
  assert.equal(response.coverage.missing_evaluation_count, 1);
  assert.equal(response.coverage_status, 'partial');
  assert.equal(response.consistency_status, 'coherent');
  assert.equal(response.outcome_status, 'favorable');
});

test('symbol thesis cluster uses promoted rerun values and exposes active source metadata', async () => {
  const { calibration, journal } = buildHarness();
  const { periodEnd } = symbolCalibrationPeriod(7, 30);
  const createdDate = addDaysIsoDate(periodEnd, -1);
  journal.theses.set(key('thesis_symbol_promoted', 'workspace_a'), {
    id: 'thesis_symbol_promoted',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    confidence: 0.82,
    created_at: `${createdDate}T00:00:00.000Z`,
  });
  journal.thesisEvaluations.set(key('evaluation_symbol_promoted', 'workspace_a'), {
    id: 'evaluation_symbol_promoted',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_symbol_promoted',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: createdDate,
    evaluation_end: addDaysIsoDate(createdDate, 7),
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'mixed',
    max_favorable_excursion: 0.02,
    max_adverse_excursion: -0.05,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 100, end_price: 101 },
  });
  const rerun = completedRerunFixture({
    id: 'rerun_symbol_promoted',
    canonicalEvaluationId: 'evaluation_symbol_promoted',
    thesisId: 'thesis_symbol_promoted',
    result: 'hit_target',
    maxFavorableExcursion: 0.12,
    maxAdverseExcursion: -0.01,
    evidence: { start_price: 100, end_price: 112 },
  });
  journal.thesisEvaluationRuns.set(key(rerun.id, 'workspace_a'), rerun);

  const promoted = await calibration.promoteEvaluationRerun(
    'evaluation_symbol_promoted',
    rerun.id,
    { reason: 'bug_fix_verification' },
    'user_1',
    'workspace_a',
  );

  const response = await calibration.getSymbolCalibrationReport(
    { symbol: 'BTC/USDT', window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.coverage.evaluated_count, 1);
  assert.equal(response.outcome.result_counts.hit_target, 1);
  assert.equal(response.outcome.avg_mfe, 0.12);
  assert.equal(response.outcome.avg_mae, -0.01);
  assert.equal(response.outcome.representative_return, 0.12);
  assert.equal(response.rows[0]?.evaluation_id, 'evaluation_symbol_promoted');
  assert.equal(response.rows[0]?.base_evaluation_id, 'evaluation_symbol_promoted');
  assert.equal(response.rows[0]?.active_source, 'promoted_rerun');
  assert.equal(response.rows[0]?.active_rerun_id, rerun.id);
  assert.equal(response.rows[0]?.active_promotion_id, promoted.event?.id);
  assert.equal(response.rows[0]?.result, 'hit_target');
});

test('symbol thesis cluster caps supporting rows at 20', async () => {
  const { calibration, journal } = buildHarness();
  const { periodEnd } = symbolCalibrationPeriod(7, 30);
  for (let index = 0; index < 25; index += 1) {
    const createdDate = addDaysIsoDate(periodEnd, -(index + 1));
    journal.theses.set(key(`thesis_symbol_cap_${index}`, 'workspace_a'), {
      id: `thesis_symbol_cap_${index}`,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      direction: 'long',
      confidence: 0.5,
      created_at: `${createdDate}T00:00:00.000Z`,
    });
  }

  const response = await calibration.getSymbolCalibrationReport(
    { symbol: 'BTC/USDT', window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.coverage.matured_thesis_count, 25);
  assert.equal(response.rows.length, 20);
  assert.equal(response.rows[0]?.thesis_id, 'thesis_symbol_cap_0');
});

test('symbol thesis cluster returns empty coverage and unclear unclassified reports', async () => {
  const { calibration, journal } = buildHarness();
  const { periodEnd } = symbolCalibrationPeriod(7, 30);
  const empty = await calibration.getSymbolCalibrationReport(
    { symbol: 'BTC/USDT', window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  journal.theses.set(key('thesis_symbol_unknown_eval', 'workspace_a'), {
    id: 'thesis_symbol_unknown_eval',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'sideways',
    confidence: 0.5,
    created_at: `${addDaysIsoDate(periodEnd, -1)}T00:00:00.000Z`,
  });
  journal.thesisEvaluations.set(key('evaluation_symbol_unknown_eval', 'workspace_a'), {
    id: 'evaluation_symbol_unknown_eval',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_symbol_unknown_eval',
    outcome_review_id: null,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: addDaysIsoDate(periodEnd, -1),
    evaluation_end: addDaysIsoDate(periodEnd, 6),
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.04,
    max_adverse_excursion: -0.01,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 100, end_price: 103 },
  });

  const unclassified = await calibration.getSymbolCalibrationReport(
    { symbol: 'BTC/USDT', window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  assert.equal(empty.coverage.matured_thesis_count, 0);
  assert.equal(empty.coverage.coverage_pct, null);
  assert.equal(empty.coverage_status, 'empty');
  assert.equal(empty.consistency_status, 'unclear');
  assert.equal(empty.outcome_status, 'inconclusive');
  assert.equal(unclassified.stance.consensus_stance, 'unknown');
  assert.equal(unclassified.stance.conflict_rate, null);
  assert.equal(unclassified.coverage_status, 'complete');
  assert.equal(unclassified.consistency_status, 'unclear');
  assert.equal(unclassified.outcome_status, 'inconclusive');
});

test('symbol thesis cluster validates required symbol window and lookback', async () => {
  const { calibration } = buildHarness();

  await assert.rejects(
    () =>
      calibration.getSymbolCalibrationReport(
        { window_days: 7, lookback_days: 30 } as never,
        'user_1',
        'workspace_a',
      ),
    isException(BadRequestException),
  );
  await assert.rejects(
    () =>
      calibration.getSymbolCalibrationReport(
        { symbol: 'BTC/USDT', window_days: 21, lookback_days: 30 },
        'user_1',
        'workspace_a',
      ),
    isException(BadRequestException),
  );
  await assert.rejects(
    () =>
      calibration.getSymbolCalibrationReport(
        { symbol: 'BTC/USDT', window_days: 7, lookback_days: 180 },
        'user_1',
        'workspace_a',
      ),
    isException(BadRequestException),
  );
});

test('agent calibration aggregates coverage joins relations outcomes and rows', async () => {
  const { calibration, journal, evaluationEngineCalls } = buildHarness();
  const { periodStart, periodEnd } = symbolCalibrationPeriod(7, 30);
  const dates = [
    addDaysIsoDate(periodEnd, -8),
    addDaysIsoDate(periodEnd, -7),
    addDaysIsoDate(periodEnd, -6),
    addDaysIsoDate(periodEnd, -5),
    addDaysIsoDate(periodEnd, -4),
    addDaysIsoDate(periodEnd, -3),
    addDaysIsoDate(periodEnd, -2),
    addDaysIsoDate(periodEnd, -1),
    periodEnd,
  ];

  seedAgentCalibrationOpinion(journal, {
    id: 'op_market_support_hit',
    agentRole: 'market',
    agentName: 'Market Analyst',
    stance: 'bullish',
    confidence: 0.72,
    thesisId: 'thesis_agent_market_hit',
    direction: 'long',
    createdDate: dates[0],
    evaluationResult: 'hit_target',
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_market_support_fail',
    agentRole: 'market',
    agentName: 'market analyst',
    stance: 'buy',
    confidence: 0.68,
    thesisId: 'thesis_agent_market_fail',
    direction: 'bullish',
    createdDate: dates[1],
    evaluationResult: 'invalidated',
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_quant_fallback_contra_success',
    agentRole: 'quant',
    agentName: 'Quant Lens',
    stance: 'sell',
    confidence: 0.61,
    thesisId: 'thesis_agent_quant_fallback',
    direction: 'long',
    createdDate: dates[2],
    evaluationResult: 'invalidated',
    linkViaResearchRunThesis: false,
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_macro_missing_eval',
    agentRole: 'macro',
    agentName: 'Macro Desk',
    stance: 'bearish',
    confidence: 0.54,
    thesisId: 'thesis_agent_macro_missing',
    direction: 'short',
    createdDate: dates[3],
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_market_unlinked',
    agentRole: 'market',
    agentName: 'Market Analyst',
    stance: 'bullish',
    confidence: 0.5,
    thesisId: null,
    createdDate: dates[4],
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_risk_unknown_stance',
    agentRole: 'risk',
    agentName: 'Risk Analyst',
    stance: 'conditional above resistance',
    confidence: 0.47,
    thesisId: 'thesis_agent_risk_unknown',
    direction: 'long',
    createdDate: dates[5],
    evaluationResult: 'hit_target',
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_market_neutral_unclear',
    agentRole: 'market',
    agentName: 'Market Analyst',
    stance: 'hold',
    confidence: 0.58,
    thesisId: 'thesis_agent_market_neutral',
    direction: 'long',
    createdDate: dates[6],
    evaluationResult: 'hit_target',
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_quant_inconclusive',
    agentRole: 'quant',
    agentName: 'Quant Lens',
    stance: 'short',
    confidence: 0.59,
    thesisId: 'thesis_agent_quant_mixed',
    direction: 'bearish',
    createdDate: dates[7],
    evaluationResult: 'mixed',
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_market_wrong_window',
    agentRole: 'market',
    agentName: 'Market Analyst',
    stance: 'long',
    confidence: 0.57,
    thesisId: 'thesis_agent_market_wrong_window',
    direction: 'long',
    createdDate: dates[8],
  });
  journal.thesisEvaluations.set(key('evaluation_agent_wrong_window', 'workspace_a'), {
    id: 'evaluation_agent_wrong_window',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_agent_market_wrong_window',
    outcome_review_id: 'review_must_not_matter',
    symbol: 'BTC/USDT',
    window_days: 14,
    evaluation_start: dates[8],
    evaluation_end: addDaysIsoDate(dates[8], 14),
    evaluated_at: '2026-05-12T00:00:00.000Z',
    result: 'hit_target',
    max_favorable_excursion: 0.9,
    max_adverse_excursion: -0.01,
    invalidated: false,
    warnings: [],
    evidence: { start_price: 100, end_price: 150 },
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_eth_excluded',
    agentRole: 'market',
    stance: 'bullish',
    thesisId: 'thesis_agent_eth',
    symbol: 'ETH/USDT',
    direction: 'long',
    createdDate: dates[0],
    evaluationResult: 'hit_target',
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_workspace_excluded',
    workspaceId: 'workspace_b',
    agentRole: 'market',
    stance: 'bullish',
    thesisId: 'thesis_agent_workspace_b',
    direction: 'long',
    createdDate: dates[0],
    evaluationResult: 'hit_target',
  });
  seedAgentCalibrationOpinion(journal, {
    id: 'op_old_excluded',
    agentRole: 'market',
    stance: 'bullish',
    thesisId: 'thesis_agent_old',
    direction: 'long',
    createdDate: addDaysIsoDate(periodStart, -1),
    evaluationResult: 'hit_target',
  });

  const response = await (
    calibration as unknown as {
      getAgentCalibrationReport: (
        dto: JsonRecord,
        userId?: string,
        workspaceHeader?: string,
      ) => Promise<JsonRecord>;
    }
  ).getAgentCalibrationReport(
    { symbol: 'btcusdt', window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  assert.equal(evaluationEngineCalls.length, 0);
  assert.equal(response.symbol, 'BTC/USDT');
  assert.equal(response.period_start, periodStart);
  assert.equal(response.period_end, periodEnd);
  assert.deepEqual(response.coverage, {
    opinion_count: 9,
    eligible_opinion_count: 8,
    scored_opinion_count: 3,
    missing_evaluation_count: 2,
    unlinked_opinion_count: 1,
    unknown_stance_count: 1,
    unclear_relation_count: 2,
    coverage_pct: 0.8889,
  });
  assert.deepEqual(
    (response.agents as JsonRecord[]).map((agent) => [
      agent.agent_role,
      agent.opinion_count,
      agent.eligible_opinion_count,
      agent.classified_opinion_count,
      agent.supports_final_count,
      agent.opposes_final_count,
      agent.supported_success_count,
      agent.supported_failure_count,
      agent.contrarian_success_count,
      agent.contrarian_failure_count,
      agent.inconclusive_count,
      agent.alignment_success_rate,
      agent.contrarian_success_rate,
      agent.avg_confidence,
      agent.verdict,
    ]),
    [
      ['market', 5, 4, 3, 3, 0, 1, 1, 0, 0, 1, 0.5, null, 0.6375, 'insufficient_data'],
      ['quant', 2, 2, 2, 1, 1, 0, 0, 1, 0, 1, null, 1, 0.6, 'insufficient_data'],
      ['macro', 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, null, null, 0.54, 'insufficient_data'],
      ['risk', 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, null, null, 0.47, 'insufficient_data'],
    ],
  );
  const fallbackRow = (response.rows as JsonRecord[]).find(
    (row) => row.agent_role === 'quant' && row.thesis_id === 'thesis_agent_quant_fallback',
  );
  assert.equal(fallbackRow?.relation_to_final, 'opposes_final');
  assert.equal(fallbackRow?.outcome_bucket, 'contrarian_success');
  assert.equal(fallbackRow?.evaluation_result, 'invalidated');
  assert.ok(!('payload' in (fallbackRow ?? {})));
  assert.equal((response.rows as JsonRecord[])[0]?.thesis_id, 'thesis_agent_market_wrong_window');
});

test('agent calibration uses promoted rerun values and exposes active source metadata', async () => {
  const { calibration, journal } = buildHarness();
  const { periodEnd } = symbolCalibrationPeriod(7, 30);
  const createdDate = addDaysIsoDate(periodEnd, -1);
  seedAgentCalibrationOpinion(journal, {
    id: 'op_agent_promoted',
    agentRole: 'market',
    agentName: 'Market Analyst',
    stance: 'bullish',
    confidence: 0.7,
    thesisId: 'thesis_agent_promoted',
    direction: 'long',
    createdDate,
    evaluationResult: 'invalidated',
  });
  const rerun = completedRerunFixture({
    id: 'rerun_agent_promoted',
    canonicalEvaluationId: 'evaluation_op_agent_promoted',
    thesisId: 'thesis_agent_promoted',
    result: 'hit_target',
    maxFavorableExcursion: 0.09,
    maxAdverseExcursion: -0.02,
    evidence: { start_price: 100, end_price: 109 },
  });
  journal.thesisEvaluationRuns.set(key(rerun.id, 'workspace_a'), rerun);

  const promoted = await calibration.promoteEvaluationRerun(
    'evaluation_op_agent_promoted',
    rerun.id,
    { reason: 'bug_fix_verification' },
    'user_1',
    'workspace_a',
  );

  const response = await calibration.getAgentCalibrationReport(
    { window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  assert.equal(response.coverage.scored_opinion_count, 1);
  assert.equal(response.agents[0]?.supported_success_count, 1);
  assert.equal(response.agents[0]?.supported_failure_count, 0);
  assert.equal(response.rows[0]?.evaluation_id, 'evaluation_op_agent_promoted');
  assert.equal(response.rows[0]?.base_evaluation_id, 'evaluation_op_agent_promoted');
  assert.equal(response.rows[0]?.active_source, 'promoted_rerun');
  assert.equal(response.rows[0]?.active_rerun_id, rerun.id);
  assert.equal(response.rows[0]?.active_promotion_id, promoted.event?.id);
  assert.equal(response.rows[0]?.evaluation_result, 'hit_target');
  assert.equal(response.rows[0]?.outcome_bucket, 'supported_success');
});

test('agent calibration returns cautious verdict thresholds sorting caps and validation', async () => {
  const { calibration, journal } = buildHarness();
  const { periodEnd } = symbolCalibrationPeriod(7, 30);
  const createdDate = addDaysIsoDate(periodEnd, -1);

  seedAgentCalibrationRoleOutcomes(journal, {
    role: 'strong_role',
    createdDate,
    outcomes: ['hit_target', 'hit_target', 'hit_target', 'hit_target', 'invalidated'],
  });
  seedAgentCalibrationRoleOutcomes(journal, {
    role: 'promising_role',
    createdDate,
    outcomes: ['hit_target', 'hit_target', 'hit_target', 'invalidated', 'invalidated'],
  });
  seedAgentCalibrationRoleOutcomes(journal, {
    role: 'contrarian_role',
    createdDate,
    stance: 'bearish',
    direction: 'long',
    outcomes: ['invalidated', 'invalidated', 'invalidated', 'hit_target', 'hit_target'],
  });
  seedAgentCalibrationRoleOutcomes(journal, {
    role: 'mixed_role',
    createdDate,
    outcomes: ['hit_target', 'hit_target', 'invalidated', 'invalidated', 'invalidated'],
  });
  seedAgentCalibrationRoleOutcomes(journal, {
    role: 'small_role',
    createdDate,
    outcomes: ['hit_target', 'hit_target', 'hit_target', 'hit_target'],
  });
  for (let index = 0; index < 35; index += 1) {
    seedAgentCalibrationOpinion(journal, {
      id: `op_cap_${index}`,
      agentRole: 'cap_role',
      stance: 'bullish',
      thesisId: `thesis_agent_cap_${index}`,
      direction: 'long',
      createdDate: addDaysIsoDate(periodEnd, -index),
      evaluationResult: 'hit_target',
    });
  }

  const response = await (
    calibration as unknown as {
      getAgentCalibrationReport: (
        dto: JsonRecord,
        userId?: string,
        workspaceHeader?: string,
      ) => Promise<JsonRecord>;
    }
  ).getAgentCalibrationReport(
    { window_days: 7, lookback_days: 30 },
    'user_1',
    'workspace_a',
  );

  const verdicts = new Map(
    (response.agents as JsonRecord[]).map((agent) => [
      agent.agent_role,
      agent.verdict,
    ]),
  );
  assert.equal(verdicts.get('strong_role'), 'strong_aligned');
  assert.equal(verdicts.get('promising_role'), 'promising');
  assert.equal(verdicts.get('contrarian_role'), 'contrarian_signal');
  assert.equal(verdicts.get('mixed_role'), 'mixed');
  assert.equal(verdicts.get('small_role'), 'insufficient_data');
  assert.equal((response.rows as JsonRecord[]).length, 30);
  assert.equal((response.rows as JsonRecord[])[0]?.research_run_id, 'run_op_cap_0');

  await assert.rejects(
    () =>
      (
        calibration as unknown as {
          getAgentCalibrationReport: (
            dto: JsonRecord,
            userId?: string,
            workspaceHeader?: string,
          ) => Promise<JsonRecord>;
        }
      ).getAgentCalibrationReport(
        { window_days: 21, lookback_days: 30 },
        'user_1',
        'workspace_a',
      ),
    isException(BadRequestException),
  );
  await assert.rejects(
    () =>
      (
        calibration as unknown as {
          getAgentCalibrationReport: (
            dto: JsonRecord,
            userId?: string,
            workspaceHeader?: string,
          ) => Promise<JsonRecord>;
        }
      ).getAgentCalibrationReport(
        { window_days: 7, lookback_days: 180 },
        'user_1',
        'workspace_a',
      ),
    isException(BadRequestException),
  );
});

test('thesis monitor plan endpoint creates stable DTO through engine fallback', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_monitor_plan', 'workspace_a'), {
    id: 'thesis_monitor_plan',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Monitor this thesis.',
  });

  const plan = await theses.monitorPlan(
    'thesis_monitor_plan',
    'user_1',
    'workspace_a',
  );

  assert.equal(plan.thesis_id, 'thesis_monitor_plan');
  assert.equal(plan.status, 'active');
  assert.equal(plan.baseline_price, 100000);
  assert.equal(plan.invalidation_direction, 'below');
  assert.equal(plan.targets[0]?.price, 110000);
});

test('run pulse endpoint returns DTO and pulse list is chart-friendly', async () => {
  const { journal, marketPriceCalls, theses } = buildHarness();
  journal.theses.set(key('thesis_pulse', 'workspace_a'), {
    id: 'thesis_pulse',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Monitor pulse.',
  });

  await theses.monitorPlan('thesis_pulse', 'user_1', 'workspace_a');
  const run = await theses.runPulse(
    'thesis_pulse',
    { force: false },
    'user_1',
    'workspace_a',
  );
  const pulses = await theses.pulses('thesis_pulse', 20, 'user_1', 'workspace_a');

  assert.equal(run.created, true);
  assert.deepEqual(marketPriceCalls[0], {
    overrides: {},
    symbol: 'BTC/USDT',
    workspaceId: 'workspace_a',
  });
  assert.equal(run.pulse?.id, 'pulse_1');
  assert.equal(run.pulse?.status, 'watch');
  assert.equal(pulses.length, 1);
  assert.equal(pulses[0]?.current_price, 103000);
  assert.deepEqual(pulses[0]?.trigger_reasons, ['price_near_target_watch_band']);
});

test('thesis monitoring reads fall back when Postgres monitoring tables are missing in local mode', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_missing_monitor_tables', 'workspace_a'), {
    id: 'thesis_missing_monitor_tables',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Local fallback should still work.',
  });
  const missingTableError = (table: string) => {
    const error = new Error(`relation "${table}" does not exist`) as Error & {
      code?: string;
    };
    error.code = '42P01';
    return error;
  };
  journal.getThesisMonitorPlan = async () => {
    throw missingTableError('thesis_monitor_plans');
  };
  journal.listThesisPulses = async () => {
    throw missingTableError('thesis_pulses');
  };
  journal.listThesisPulseMemos = async () => {
    throw missingTableError('thesis_pulse_memos');
  };

  const plan = await theses.monitorPlan(
    'thesis_missing_monitor_tables',
    'user_1',
    'workspace_a',
  );
  const pulses = await theses.pulses(
    'thesis_missing_monitor_tables',
    20,
    'user_1',
    'workspace_a',
  );
  const memos = await theses.pulseMemos(
    'thesis_missing_monitor_tables',
    20,
    'user_1',
    'workspace_a',
  );

  assert.equal(plan.thesis_id, 'thesis_missing_monitor_tables');
  assert.equal(plan.status, 'active');
  assert.deepEqual(pulses, []);
  assert.deepEqual(memos, []);
});

test('run pulse memo endpoint returns DTO and memo history', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_pulse_memo', 'workspace_a'), {
    id: 'thesis_pulse_memo',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Monitor pulse memo.',
  });

  await theses.runPulse('thesis_pulse_memo', { force: false }, 'user_1', 'workspace_a');
  const run = await theses.runPulseMemo(
    'thesis_pulse_memo',
    { force: false, window_minutes: 240 },
    'user_1',
    'workspace_a',
  );
  const memos = await theses.pulseMemos(
    'thesis_pulse_memo',
    20,
    'user_1',
    'workspace_a',
  );

  assert.equal(run.created, true);
  assert.equal(run.skipped, false);
  assert.equal(run.memo?.id, 'memo_1');
  assert.equal(run.memo?.status, 'watch');
  assert.deepEqual(run.memo?.referenced_pulse_ids, ['pulse_1']);
  assert.equal(memos.length, 1);
  assert.equal(memos[0]?.recommended_action, 'inspect_chart');
});

test('run pulse memo endpoint returns skipped no-op when no pulses exist', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_memo_empty', 'workspace_a'), {
    id: 'thesis_memo_empty',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'No pulses yet.',
  });

  const run = await theses.runPulseMemo(
    'thesis_memo_empty',
    { force: false, window_minutes: 240 },
    'user_1',
    'workspace_a',
  );

  assert.equal(run.created, false);
  assert.equal(run.skipped, true);
  assert.equal(run.skip_reason, 'no_pulses');
  assert.equal(run.memo, null);
});

test('thesis monitor endpoints reject missing thesis', async () => {
  const { theses } = buildHarness();

  await assert.rejects(
    () => theses.monitorPlan('missing_thesis', 'user_1', 'workspace_a'),
    isException(NotFoundException),
  );
  await assert.rejects(
    () => theses.runPulse('missing_thesis', {}, 'user_1', 'workspace_a'),
    isException(NotFoundException),
  );
  await assert.rejects(
    () => theses.runPulseMemo('missing_thesis', {}, 'user_1', 'workspace_a'),
    isException(NotFoundException),
  );
  await assert.rejects(
    () => theses.pulseMemos('missing_thesis', 20, 'user_1', 'workspace_a'),
    isException(NotFoundException),
  );
});

test('thesis scheduler controls run only active enabled thesis plans', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_scheduler', 'workspace_a'), {
    id: 'thesis_scheduler',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Schedule this thesis only.',
  });
  journal.theses.set(key('thesis_scheduler_other', 'workspace_b'), {
    id: 'thesis_scheduler_other',
    workspace_id: 'workspace_b',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Different workspace.',
  });

  const resumed = await theses.resumeScheduler(
    'thesis_scheduler',
    'user_1',
    'workspace_a',
  );
  const run = await theses.runSchedulerDue(
    'thesis_scheduler',
    { observed_at: '2026-05-12T00:10:00.000Z' },
    'user_1',
    'workspace_a',
  );
  const paused = await theses.pauseScheduler(
    'thesis_scheduler',
    'user_1',
    'workspace_a',
  );
  const manual = await theses.runPulse(
    'thesis_scheduler',
    { force: false },
    'user_1',
    'workspace_a',
  );

  assert.equal(resumed.enabled, true);
  assert.equal(resumed.price_interval_minutes, 5);
  assert.equal(resumed.signal_interval_minutes, 15);
  assert.equal(resumed.memo_interval_minutes, 240);
  assert.equal(run.skipped_reason, null);
  assert.equal(run.ran_pulse, true);
  assert.equal(run.plan?.scheduler_enabled, true);
  assert.equal(paused.enabled, false);
  assert.equal(paused.scheduler_enabled, false);
  assert.equal(manual.created, true);
  assert.equal(
    journal.thesisPulses.get(key('thesis_scheduler_other', 'workspace_b')),
    undefined,
  );
});

test('thesis scheduler skips disabled or non-active plans without engine work', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_scheduler_skip', 'workspace_a'), {
    id: 'thesis_scheduler_skip',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    thesis_text: 'Do not schedule yet.',
  });
  journal.monitorPlans.set(key('thesis_scheduler_skip', 'workspace_a'), {
    id: 'plan_skip',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_scheduler_skip',
    status: 'paused',
    scheduler_enabled: true,
    price_interval_minutes: 5,
    signal_interval_minutes: 15,
    memo_interval_minutes: 240,
  });

  const paused = await theses.runSchedulerDue(
    'thesis_scheduler_skip',
    { observed_at: '2026-05-12T00:10:00.000Z' },
    'user_1',
    'workspace_a',
  );
  await theses.updateMonitorPlan(
    'thesis_scheduler_skip',
    { status: 'active', scheduler_enabled: false },
    'user_1',
    'workspace_a',
  );
  const disabled = await theses.runSchedulerDue(
    'thesis_scheduler_skip',
    { observed_at: '2026-05-12T00:10:00.000Z' },
    'user_1',
    'workspace_a',
  );

  assert.equal(paused.skipped_reason, 'plan_paused');
  assert.equal(disabled.skipped_reason, 'scheduler_disabled');
  assert.equal(
    journal.thesisPulses.get(key('thesis_scheduler_skip', 'workspace_a')),
    undefined,
  );
});

test('product monitoring mode enqueues durable scheduler jobs without memory timer work', async () => {
  await withEnv(
    { MONITORING_PERSISTENCE: 'postgres', MONITORING_SQLITE_FALLBACK: undefined },
    async () => {
      const { journal, theses } = buildHarness();
      journal.theses.set(key('thesis_product_scheduler', 'workspace_a'), {
        id: 'thesis_product_scheduler',
        workspace_id: 'workspace_a',
        symbol: 'BTC/USDT',
        direction: 'long',
        thesis_text: 'Product scheduler should enqueue durable jobs.',
      });
      journal.monitorPlans.set(key('thesis_product_scheduler', 'workspace_a'), {
        id: 'plan_product',
        workspace_id: 'workspace_a',
        thesis_id: 'thesis_product_scheduler',
        baseline_run_id: 'run_1',
        symbol: 'BTC/USDT',
        market_type: 'spot',
        status: 'active',
        scheduler_enabled: true,
        latest_pulse_id: 'pulse_latest',
        latest_status: 'review',
        price_interval_minutes: 5,
        signal_interval_minutes: 15,
        memo_interval_minutes: 240,
        run_memo_on_review: true,
        run_memo_on_rerun_full: true,
        last_pulse_at: '2026-05-12T00:00:00.000Z',
        last_memo_at: '2026-05-11T20:00:00.000Z',
        next_pulse_due_at: '2026-05-12T00:05:00.000Z',
        next_memo_due_at: '2026-05-12T00:00:00.000Z',
      });

      const status = await theses.schedulerStatus(
        'thesis_product_scheduler',
        'user_1',
        'workspace_a',
      );
      const run = await theses.runSchedulerDue(
        'thesis_product_scheduler',
        { observed_at: '2026-05-12T00:10:00.000Z' },
        'user_1',
        'workspace_a',
      );

      assert.equal(status.product_mode, true);
      assert.equal(status.scheduled, false);
      assert.equal(run.queued, true);
      assert.equal(run.queue_backend, 'postgres');
      assert.equal(run.ran_pulse, false);
      assert.equal(run.ran_memo, false);
      assert.equal(journal.monitoringJobs.length, 2);
      assert.ok(
        journal.monitoringJobs.every(
          (job) => job.workspace_id === 'workspace_a',
        ),
      );
      assert.deepEqual(
        journal.monitoringJobs.map((job) => job.job_type).sort(),
        ['thesis_pulse_memo_run', 'thesis_pulse_run'],
      );
    },
  );
});

test('monitoring worker claims, persists, and completes durable pulse jobs', async () => {
  await withEnv({ MONITORING_PERSISTENCE: 'postgres' }, async () => {
    const { journal, monitoringJobs } = buildHarness();
    journal.theses.set(key('thesis_worker', 'workspace_a'), {
      id: 'thesis_worker',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      direction: 'long',
      thesis_text: 'Worker thesis.',
    });
    journal.monitorPlans.set(key('thesis_worker', 'workspace_a'), {
      id: 'plan_1',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_worker',
      symbol: 'BTC/USDT',
      market_type: 'spot',
      status: 'active',
      scheduler_enabled: true,
      price_interval_minutes: 5,
      signal_interval_minutes: 15,
      memo_interval_minutes: 240,
    });
    await journal.enqueueMonitoringJob({
      workspaceId: 'workspace_a',
      thesisId: 'thesis_worker',
      jobType: 'thesis_pulse_run',
      idempotencyKey: 'pulse:worker',
      request: {
        thesis_id: 'thesis_worker',
        workspace_id: 'workspace_a',
        force: false,
      },
    });

    const result = await monitoringJobs.runClaimedJobs('workspace_a', {
      workerId: 'worker_test',
      now: '2026-05-12T00:01:00.000Z',
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.succeeded, 1);
    assert.equal(journal.monitoringJobs[0]?.status, 'succeeded');
    assert.equal(
      journal.thesisPulses.get(key('thesis_worker', 'workspace_a'))?.[0]?.id,
      'pulse_1',
    );
  });
});

test('monitoring queue records exhausted jobs as dead-letter visible state', async () => {
  const { journal } = buildHarness();
  const job = await journal.enqueueMonitoringJob({
    workspaceId: 'workspace_a',
    thesisId: 'thesis_dead_letter',
    jobType: 'thesis_pulse_run',
    maxAttempts: 1,
    idempotencyKey: 'pulse:dead-letter',
    request: {
      thesis_id: 'thesis_dead_letter',
      workspace_id: 'workspace_a',
    },
  });
  await journal.claimMonitoringJobs('workspace_a', {
    limit: 1,
    workerId: 'worker_dead_letter',
    now: '2026-05-12T00:01:00.000Z',
  });

  const failed = await journal.failMonitoringJob(
    String(job.id),
    'workspace_a',
    {
      errorType: 'TimeoutError',
      errorMessage: 'provider timeout',
      retryable: true,
    },
  );
  const health = await journal.getMonitoringOperationsHealth('workspace_a');

  assert.equal(failed?.status, 'dead_letter');
  assert.equal(
    (health.monitoring_queue as JsonRecord).dead_letter,
    1,
  );
});

test('monitoring retention dry-run preserves protected baseline tables', async () => {
  const { journal, monitoringJobs, operations } = buildHarness();
  journal.theses.set(key('protected_thesis', 'workspace_a'), {
    id: 'protected_thesis',
    workspace_id: 'workspace_a',
  });
  const retention = await monitoringJobs.runRetention('workspace_a', {
    dryRun: true,
    now: '2026-05-12T00:00:00.000Z',
  });

  assert.equal(retention.dry_run, true);
  assert.equal(journal.theses.has(key('protected_thesis', 'workspace_a')), true);
  assert.ok(
    Array.isArray(retention.protected_tables) &&
      retention.protected_tables.includes('trade_theses'),
  );

  const apiDryRun = await operations.monitoringRetentionDryRun(
    'user_1',
    'workspace_a',
  );
  assert.equal(apiDryRun.dry_run, true);
});

test('operations health exposes monitoring queue, worker, retention, and memo health', async () => {
  const { journal, operations } = buildHarness();
  journal.monitoringHealth = {
    monitoring_queue: {
      queued: 3,
      running: 1,
      failed: 2,
      dead_letter: 1,
      oldest_queued_at: '2026-05-12T00:00:00.000Z',
    },
    monitoring_scheduler: {
      enabled_plans: 4,
      due_plans: 2,
      last_enqueue_at: '2026-05-12T00:02:00.000Z',
      last_enqueue_error: null,
    },
    monitoring_workers: {
      active_workers: 1,
      last_success_at: '2026-05-12T00:03:00.000Z',
      last_error_at: '2026-05-12T00:04:00.000Z',
      recent_error_types: ['timeout'],
    },
    monitoring_retention: {
      last_run_at: '2026-05-12T00:05:00.000Z',
      last_deleted_counts: {
        deleted_pulses: 10,
        deleted_memos: 2,
        deleted_jobs: 5,
        dry_run: false,
      },
      last_error: null,
    },
    llm_memo_health: {
      recent_calls: 8,
      failure_rate: 0.25,
      average_latency_ms: 900,
    },
  };

  const health = await operations.health(20, 'user_1', 'workspace_a');

  assert.equal(health.monitoring_queue.dead_letter, 1);
  assert.equal(health.monitoring_scheduler.due_plans, 2);
  assert.equal(health.monitoring_workers.recent_error_types[0], 'timeout');
  assert.equal(health.monitoring_retention.last_deleted_counts.deleted_jobs, 5);
  assert.equal(health.llm_memo_health.failure_rate, 0.25);
});

test('monitoring DTO parity keeps SQLite export and Postgres rows equivalent', () => {
  const sqlitePlan = {
    id: 'plan_parity',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_parity',
    baseline_run_id: 'run_1',
    symbol: 'WRONG',
    market_type: 'spot',
    status: 'active',
    targets_json: JSON.stringify([{ label: 't1', price: 110 }]),
    scenario_triggers_json: JSON.stringify(['trigger']),
    missing_fields_json: JSON.stringify([]),
    enabled_signal_factors_json: JSON.stringify(['regime']),
    latest_trigger_reasons_json: JSON.stringify(['near_target']),
    scheduler_enabled: 1,
    price_interval_minutes: '5',
    signal_interval_minutes: '15',
    memo_interval_minutes: '240',
    payload_json: JSON.stringify({
      symbol: 'SHOULD_NOT_OVERRIDE',
      targets: [],
    }),
  };
  const postgresPlan = {
    ...sqlitePlan,
    symbol: 'BTC/USDT',
    scheduler_enabled: true,
    targets: [{ label: 't1', price: 110 }],
    scenario_triggers: ['trigger'],
    missing_fields: [],
    enabled_signal_factors: ['regime'],
    latest_trigger_reasons: ['near_target'],
    payload: { symbol: 'SHOULD_NOT_OVERRIDE', targets: [] },
  };
  const normalizedSqlitePlan = normalizeSqliteFixture(sqlitePlan);
  normalizedSqlitePlan.symbol = 'BTC/USDT';

  assert.deepEqual(
    toThesisMonitorPlanResponse(normalizedSqlitePlan),
    toThesisMonitorPlanResponse(postgresPlan),
  );

  const sqlitePulse = normalizeSqliteFixture({
    id: 'pulse_parity',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_parity',
    monitor_plan_id: 'plan_parity',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    pulse_type: 'manual',
    bucket_start: '2026-05-12T00:00:00.000Z',
    observed_at: '2026-05-12T00:01:00.000Z',
    score: '42',
    status: 'watch',
    suggested_action: 'inspect_chart',
    trigger_reasons_json: JSON.stringify(['near_target']),
    hard_triggers_json: JSON.stringify([]),
    missing_data_json: JSON.stringify([]),
    payload_json: JSON.stringify({ status: 'SHOULD_NOT_OVERRIDE' }),
  });
  const postgresPulse = {
    ...sqlitePulse,
    trigger_reasons: ['near_target'],
    hard_triggers: [],
    missing_data: [],
    payload: { status: 'SHOULD_NOT_OVERRIDE' },
  };
  assert.deepEqual(
    toThesisPulseResponse(sqlitePulse),
    toThesisPulseResponse(postgresPulse),
  );

  const sqliteMemo = normalizeSqliteFixture({
    id: 'memo_parity',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_parity',
    monitor_plan_id: 'plan_parity',
    memo_type: 'manual',
    window_start: '2026-05-12T00:00:00.000Z',
    window_end: '2026-05-12T04:00:00.000Z',
    created_at: '2026-05-12T04:00:00.000Z',
    status: 'watch',
    summary: 'Summary',
    recommended_action: 'inspect_chart',
    rerun_full_recommended: 0,
    confidence: '0.7',
    what_changed_json: JSON.stringify(['price']),
    why_it_matters_json: JSON.stringify(['risk']),
    what_to_watch_next_json: JSON.stringify(['level']),
    referenced_pulse_ids_json: JSON.stringify(['pulse_parity']),
    prompt_version: 'pulse_memo.v1',
    provider: 'fake',
    model: 'fake-v1',
    payload_json: JSON.stringify({ summary: 'SHOULD_NOT_OVERRIDE' }),
  });
  const postgresMemo = {
    ...sqliteMemo,
    what_changed: ['price'],
    why_it_matters: ['risk'],
    what_to_watch_next: ['level'],
    referenced_pulse_ids: ['pulse_parity'],
    payload: { summary: 'SHOULD_NOT_OVERRIDE' },
  };
  assert.deepEqual(
    toThesisPulseMemoResponse(sqliteMemo),
    toThesisPulseMemoResponse(postgresMemo),
  );
});

test('postgres monitoring schema declares normalized tables and idempotency indexes', () => {
  const schema = readFileSync(
    join(process.cwd(), 'src', 'database', 'postgres-schema.sql'),
    'utf8',
  );
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS thesis_monitor_plans',
    'CREATE TABLE IF NOT EXISTS thesis_pulses',
    'CREATE TABLE IF NOT EXISTS thesis_pulse_memos',
    'CREATE TABLE IF NOT EXISTS monitoring_jobs',
    'CREATE TABLE IF NOT EXISTS monitoring_retention_runs',
    'idx_thesis_pulses_bucket',
    'idx_thesis_pulse_memos_window',
    'idx_monitoring_jobs_idempotency',
    'idx_monitoring_jobs_due',
    'idx_monitoring_retention_runs_workspace_started',
  ]) {
    assert.ok(schema.includes(fragment), `missing schema fragment: ${fragment}`);
  }
});

test('postgres calibration rerun schema declares append-only audit table', () => {
  const schema = readFileSync(
    join(process.cwd(), 'src', 'database', 'postgres-schema.sql'),
    'utf8',
  );
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS thesis_evaluation_runs',
    'canonical_evaluation_id TEXT NOT NULL REFERENCES thesis_evaluations(id)',
    'idx_thesis_evaluation_runs_evaluation',
    'idx_thesis_evaluation_runs_thesis',
    'idx_thesis_evaluation_runs_idempotency',
  ]) {
    assert.ok(schema.includes(fragment), `missing schema fragment: ${fragment}`);
  }
});

test('postgres calibration promotion schema declares append-only version policy ledger', () => {
  const schema = readFileSync(
    join(process.cwd(), 'src', 'database', 'postgres-schema.sql'),
    'utf8',
  );
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS thesis_evaluation_promotions',
    'canonical_evaluation_id TEXT NOT NULL REFERENCES thesis_evaluations(id)',
    'promoted_rerun_id TEXT REFERENCES thesis_evaluation_runs(id)',
    'idx_thesis_evaluation_promotions_evaluation',
    'idx_thesis_evaluation_promotions_idempotency',
  ]) {
    assert.ok(schema.includes(fragment), `missing schema fragment: ${fragment}`);
  }
});

test('frontend contract responses are normalized for thesis, watchlist, and brief', async () => {
  const { journal, theses, watchlists, briefs } = buildHarness();
  journal.theses.set(key('thesis_2', 'workspace_a'), {
    id: 'thesis_2',
    workspace_id: 'workspace_a',
    symbol: 'SOL/USDT',
    direction: 'short',
    confidence: '0.7',
    thesis_text: 'Fade failed reclaim.',
    structured_summary: {
      rating: 'Sell',
      direction: 'short',
      action_summary: 'Fade failed reclaim',
      entry_zone: '180',
      invalidation: '190',
      target_zones: ['160'],
      is_degraded: false,
    },
  });
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: 1,
  });
  journal.briefs.push({
    id: 'brief_1',
    workspace_id: 'workspace_a',
    brief_date: '2026-05-12',
    title: 'Daily Brief',
    summary: 'Risk-on tone.',
    key_points: ['Liquidity improving'],
    thesis_ids: ['thesis_2', 'thesis_2'],
    thesis_updates: [
      {
        thesis_id: 'thesis_2',
        symbol: 'SOL/USDT',
        direction: 'short',
        setup_type: 'agent_debate',
        confidence: '0.7',
        status: 'review',
        update: 'Fade failed reclaim.',
        recent_alerts: ['Review failed reclaim', 'Review failed reclaim'],
      },
      {
        thesis_id: 'thesis_2',
        symbol: 'SOL/USDT',
        direction: 'short',
        setup_type: 'agent_debate',
        confidence: '0.7',
        status: 'review',
        update: 'Fade failed reclaim.',
        recent_alerts: ['Review failed reclaim'],
      },
    ],
  });

  const thesis = await theses.get('thesis_2', 'user_1', 'workspace_a');
  const listedWatchlists = await watchlists.list(50, 'user_1', 'workspace_a');
  const item = await watchlists.addItem(
    'watch_1',
    { symbol: 'SOL/USDT', item_type: 'symbol' },
    'user_1',
    'workspace_a',
  );
  const createdWatchlist = await watchlists.create(
    { name: 'Momentum' },
    'user_1',
    'workspace_a',
  );
  const watchItems = await watchlists.items('watch_1', 'user_1', 'workspace_a');
  const updatedWatchlist = await watchlists.update(
    'watch_1',
    { name: 'Core renamed', enabled: false },
    'user_1',
    'workspace_a',
  );
  const removedItem = await watchlists.removeItem(
    'watch_1',
    item.id ?? '',
    'user_1',
    'workspace_a',
  );
  const removedWatchlist = await watchlists.remove(
    'watch_1',
    'user_1',
    'workspace_a',
  );
  const dailyBriefs = await briefs.daily(
    '2026-05-12',
    20,
    'user_1',
    'workspace_a',
  );

  assert.equal(thesis.summary.entry_zone, '180');
  assert.deepEqual(thesis.summary.target_zones, ['160']);
  assert.equal(listedWatchlists[0]?.enabled, true);
  assert.equal(createdWatchlist.name, 'Momentum');
  assert.equal(item.workspace_id, 'workspace_a');
  assert.equal(watchItems[0]?.id, item.id);
  assert.equal(updatedWatchlist.name, 'Core renamed');
  assert.equal(updatedWatchlist.enabled, false);
  assert.equal(removedItem.removed, true);
  assert.equal(removedWatchlist.removed, true);
  assert.equal(removedWatchlist.removed_item_count, 0);
  assert.equal(dailyBriefs[0]?.summary, 'Risk-on tone.');
  assert.deepEqual(dailyBriefs[0]?.thesis_ids, ['thesis_2']);
  assert.equal(dailyBriefs[0]?.thesis_updates.length, 1);
  assert.deepEqual(dailyBriefs[0]?.thesis_updates[0]?.recent_alerts, [
    'Review failed reclaim',
  ]);
});

test('watchlist thesis tracking rejects pasted run IDs with a useful correction', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
  });
  journal.researchRuns.set(key('run_b97', 'workspace_a'), {
    id: 'run_b97',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'completed',
    thesis_id: 'thesis_b39b6f77',
  });
  journal.theses.set(key('thesis_b39b6f77', 'workspace_a'), {
    id: 'thesis_b39b6f77',
    workspace_id: 'workspace_a',
    research_run_id: 'run_b97',
    symbol: 'ETH/USDT',
    direction: 'long',
    confidence: 0.35,
  });

  await assert.rejects(
    () =>
      watchlists.addItem(
        'watch_1',
        { item_type: 'thesis', thesis_id: 'run_b97' },
        'user_1',
        'workspace_a',
      ),
    (error) =>
      error instanceof BadRequestException &&
      error.message ===
        'No thesis found for this ID. You pasted a run ID. Use thesis thesis_b39b6f77 instead.',
  );

  const item = await watchlists.addItem(
    'watch_1',
    { item_type: 'thesis', thesis_id: 'thesis_b39b6f77' },
    'user_1',
    'workspace_a',
  );

  assert.equal(item.symbol, 'ETH/USDT');
  assert.equal(item.thesis_id, 'thesis_b39b6f77');
});

test('watchlist symbol tracking normalizes common crypto input', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
  });

  const item = await watchlists.addItem(
    'watch_1',
    { item_type: 'symbol', symbol: 'btc' },
    'user_1',
    'workspace_a',
  );

  assert.equal(item.symbol, 'BTC/USDT');
  assert.equal(item.item_type, 'symbol');
});

test('watchlist tracking reuses existing logical tracks', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
  });
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
  });

  const firstSymbol = await watchlists.addItem(
    'watch_1',
    { item_type: 'symbol', symbol: 'btc' },
    'user_1',
    'workspace_a',
  );
  const secondSymbol = await watchlists.addItem(
    'watch_1',
    { item_type: 'symbol', symbol: 'BTC/USDT' },
    'user_1',
    'workspace_a',
  );
  const firstThesis = await watchlists.addItem(
    'watch_1',
    { item_type: 'thesis', thesis_id: 'thesis_1' },
    'user_1',
    'workspace_a',
  );
  const secondThesis = await watchlists.addItem(
    'watch_1',
    { item_type: 'thesis', thesis_id: 'thesis_1' },
    'user_1',
    'workspace_a',
  );

  assert.equal(secondSymbol.id, firstSymbol.id);
  assert.equal(secondThesis.id, firstThesis.id);
  assert.equal(journal.watchlistItems.length, 2);
  assert.equal(
    (await watchlists.items('watch_1', 'user_1', 'workspace_a')).length,
    2,
  );
});

test('watchlist removal deletes tracks and keeps alert history', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
  });
  journal.watchlistItems.push({
    id: 'watch_item_1',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'symbol',
    symbol: 'BTC/USDT',
    enabled: true,
  });
  journal.alerts.push({
    id: 'alert_1',
    workspace_id: 'workspace_a',
    alert_type: 'target_zone_reached',
    symbol: 'BTC/USDT',
    watchlist_item_id: 'watch_item_1',
    message: 'Target reached',
    created_at: '2026-05-12T00:00:00.000Z',
  });

  const removed = await watchlists.remove('watch_1', 'user_1', 'workspace_a');

  assert.equal(removed.removed, true);
  assert.equal(removed.removed_item_count, 1);
  assert.equal(await journal.getWatchlist('watch_1', 'workspace_a'), null);
  assert.deepEqual(await journal.listWatchlistItems('watch_1', 'workspace_a'), []);
  assert.equal(journal.alerts[0]?.watchlist_item_id, null);
});

test('watchlist check creates deduped alerts from latest snapshots', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_1',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_duplicate',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:01:00.000Z',
  });
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.82,
    thesis_text: 'Breakout continuation.',
    target_zones: ['110000'],
    invalidation_level: '95000',
  });
  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T01:00:00.000Z',
    current_price: 111000,
    source: 'fixture',
    source_timestamp: '2026-05-12T01:00:00.000Z',
  });

  const first = await watchlists.check(
    'watch_1',
    {},
    'user_1',
    'workspace_a',
  );
  const second = await watchlists.check(
    'watch_1',
    {},
    'user_1',
    'workspace_a',
  );

  assert.equal(first.checked_items, 1);
  assert.equal(first.alerts_created.length, 1);
  assert.equal(first.alerts_created[0]?.alert_type, 'target_zone_reached');
  assert.equal(second.alerts_created.length, 0);
});

test('watchlist check honors invalidation crossing cues for non-directional theses', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_1',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_avoid',
    symbol: 'BNB/USDT',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.theses.set(key('thesis_avoid', 'workspace_a'), {
    id: 'thesis_avoid',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    direction: 'avoid',
    setup_type: 'agent_debate',
    confidence: 0.35,
    thesis_text: 'Avoid until confirmation clears resistance.',
    target_zones: [],
    invalidation_level:
      'Break above $638 with increasing volume and RSI sustained above 50.',
  });

  const beforeBreak = await watchlists.check(
    'watch_1',
    { prices: { 'BNB/USDT': 637 } },
    'user_1',
    'workspace_a',
  );
  const afterBreak = await watchlists.check(
    'watch_1',
    { prices: { 'BNB/USDT': 650 } },
    'user_1',
    'workspace_a',
  );

  assert.equal(beforeBreak.alerts_created.length, 0);
  assert.equal(afterBreak.alerts_created.length, 1);
  assert.equal(afterBreak.alerts_created[0]?.alert_type, 'thesis_invalidated');
  assert.equal(
    afterBreak.alerts_created[0]?.trigger_key,
    'thesis_invalidated:thesis_avoid:638',
  );
});

test('watchlist alert poll checks enabled watchlists across workspaces', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push(
    {
      id: 'watch_1',
      workspace_id: 'workspace_a',
      name: 'Core',
      enabled: true,
      created_at: '2026-05-12T00:00:00.000Z',
    },
    {
      id: 'watch_disabled',
      workspace_id: 'workspace_a',
      name: 'Disabled',
      enabled: false,
      created_at: '2026-05-12T01:00:00.000Z',
    },
  );
  journal.watchlistItems.push({
    id: 'watch_item_1',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_duplicate',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:01:00.000Z',
  });
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    confidence: 0.82,
    thesis_text: 'Breakout continuation.',
    target_zones: ['110000'],
    invalidation_level: '95000',
  });
  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T01:00:00.000Z',
    current_price: 111000,
    source: 'fixture',
    source_timestamp: '2026-05-12T01:00:00.000Z',
  });

  const result = await watchlists.pollAlerts();

  assert.equal(result.checked_watchlists, 1);
  assert.equal(result.alerts_created, 1);
  assert.equal(journal.alerts.length, 1);
  assert.equal(journal.alerts[0]?.watchlist_item_id, 'watch_item_1');
});

test('MarketPriceService refreshes exchange prices and persists snapshots', async () => {
  const journal = new FakeJournalRepository();
  const marketPrices = new MarketPriceService(journal);
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({ symbol: 'BTCUSDT', price: '112345.67' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await withEnv(
      {
        PRICE_FEED_BASE_URL: 'https://prices.test',
        PRICE_REFRESH_ON_CHECK: 'true',
      },
      async () => {
        const resolution = await marketPrices.resolveFreshPrice(
          'btc',
          'workspace_a',
          {},
        );
        const saved = await journal.getLatestMarketSnapshot(
          'BTC/USDT',
          'workspace_a',
        );

        assert.equal(resolution.source, 'live');
        assert.equal(resolution.symbol, 'BTC/USDT');
        assert.equal(resolution.price, 112345.67);
        assert.equal(saved?.symbol, 'BTC/USDT');
        assert.equal(saved?.current_price, 112345.67);
        assert.equal(saved?.source, 'binance:BTCUSDT');
        assert.match(
          requestedUrl,
          /^https:\/\/prices\.test\/api\/v3\/ticker\/price\?symbol=BTCUSDT$/,
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MarketPriceService falls back to snapshots when live refresh fails', async () => {
  const journal = new FakeJournalRepository();
  const marketPrices = new MarketPriceService(journal);
  const originalFetch = globalThis.fetch;

  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T01:00:00.000Z',
    current_price: 109500,
    source: 'fixture',
    source_timestamp: '2026-05-12T01:00:00.000Z',
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: -1 }), { status: 500 })) as typeof fetch;

  try {
    await withEnv({ PRICE_REFRESH_ON_CHECK: 'true' }, async () => {
      const resolution = await marketPrices.resolveFreshPrice(
        'BTC/USDT',
        'workspace_a',
        {},
      );

      assert.equal(resolution.source, 'snapshot');
      assert.equal(resolution.price, 109500);
      assert.match(
        resolution.warning ?? '',
        /^live price refresh failed for BTC\/USDT:/,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MarketDataController returns normalized OHLCV candles from spot klines', async () => {
  const { marketData } = buildMarketDataHarness();
  const originalFetch = globalThis.fetch;
  let requestedUrl: URL | null = null;
  const firstTime = Date.parse('2026-05-18T00:00:00.000Z');
  const secondTime = Date.parse('2026-05-18T00:05:00.000Z');

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrl = new URL(String(input));
    return new Response(
      JSON.stringify([
        [secondTime, '102', '108', '101', '107', '12.5'],
        [firstTime, 'bad', '106', '99', '105', '8'],
        [firstTime, '100', '106', '99', '105', '8'],
        [firstTime, '101', '107', '100', '106', '9'],
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await withEnv(
      {
        OHLCV_SPOT_BASE_URL: 'https://spot.test',
        OHLCV_CACHE_TTL_MS: '0',
        OHLCV_MAX_LIMIT: '1000',
      },
      async () => {
        const response = await marketData.getOhlcv(
          'eth',
          'spot',
          '5m',
          '2026-05-18T00:00:00.000Z',
          '2026-05-18T00:15:00.000Z',
          '5000',
          'user_1',
          'workspace_a',
        );

        assert.equal(response.symbol, 'ETH/USDT');
        assert.equal(response.market_type, 'spot');
        assert.equal(response.interval, '5m');
        assert.equal(response.provider, 'binance');
        assert.equal(response.source, 'binance:spot:klines');
        assert.equal(response.warning, null);
        assert.deepEqual(
          response.candles.map((candle) => candle.time),
          [
            '2026-05-18T00:00:00.000Z',
            '2026-05-18T00:05:00.000Z',
          ],
        );
        assert.equal(response.candles[0]?.open, 101);
        assert.equal(response.candles[0]?.volume, 9);
        assert.ok(requestedUrl);
        assert.equal(requestedUrl.hostname, 'spot.test');
        assert.equal(requestedUrl.pathname, '/api/v3/klines');
        assert.equal(requestedUrl.searchParams.get('symbol'), 'ETHUSDT');
        assert.equal(requestedUrl.searchParams.get('interval'), '5m');
        assert.equal(requestedUrl.searchParams.get('limit'), '1000');
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MarketDataController maps perp OHLCV requests to futures klines', async () => {
  const { marketData } = buildMarketDataHarness();
  const originalFetch = globalThis.fetch;
  let requestedUrl: URL | null = null;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrl = new URL(String(input));
    return new Response(
      JSON.stringify([
        [
          Date.parse('2026-05-18T00:00:00.000Z'),
          '100',
          '110',
          '95',
          '108',
          '42',
        ],
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await withEnv(
      {
        OHLCV_PERP_BASE_URL: 'https://perp.test',
        OHLCV_CACHE_TTL_MS: '0',
      },
      async () => {
        const response = await marketData.getOhlcv(
          'eth-usdt',
          'perp',
          '1h',
          '2026-05-18T00:00:00.000Z',
          '2026-05-18T02:00:00.000Z',
          '50',
          'user_1',
          'workspace_a',
        );

        assert.equal(response.symbol, 'ETH/USDT');
        assert.equal(response.market_type, 'perp');
        assert.equal(response.candles.length, 1);
        assert.ok(requestedUrl);
        assert.equal(requestedUrl.hostname, 'perp.test');
        assert.equal(requestedUrl.pathname, '/fapi/v1/klines');
        assert.equal(requestedUrl.searchParams.get('symbol'), 'ETHUSDT');
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MarketDataController routes Bitget OHLCV requests to spot and perp candles', async () => {
  const { marketData } = buildMarketDataHarness();
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  const firstTime = Date.parse('2026-05-18T00:00:00.000Z');

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrls.push(new URL(String(input)));
    return new Response(
      JSON.stringify({
        code: '00000',
        msg: 'success',
        data: [[firstTime, '100', '106', '99', '105', '8']],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await withEnv(
      {
        OHLCV_BITGET_BASE_URL: 'https://bitget.test',
        OHLCV_CACHE_TTL_MS: '0',
      },
      async () => {
        const spot = await marketData.getOhlcv(
          'eth',
          'spot',
          '15m',
          '2026-05-18T00:00:00.000Z',
          '2026-05-18T00:15:00.000Z',
          '5000',
          'user_1',
          'workspace_a',
          'bitget',
        );
        const perp = await marketData.getOhlcv(
          'eth-usdt',
          'perp',
          '1h',
          '2026-05-18T00:00:00.000Z',
          '2026-05-18T01:00:00.000Z',
          '5000',
          'user_1',
          'workspace_a',
          'bitget',
        );

        assert.equal(spot.provider, 'bitget');
        assert.equal(spot.source, 'bitget:spot:candles');
        assert.equal(perp.provider, 'bitget');
        assert.equal(perp.source, 'bitget:perp:candles');
        assert.equal(spot.candles[0]?.close, 105);
        assert.equal(requestedUrls[0]?.hostname, 'bitget.test');
        assert.equal(requestedUrls[0]?.pathname, '/api/v2/spot/market/candles');
        assert.equal(requestedUrls[0]?.searchParams.get('symbol'), 'ETHUSDT');
        assert.equal(requestedUrls[0]?.searchParams.get('granularity'), '15min');
        assert.equal(requestedUrls[0]?.searchParams.get('limit'), '1000');
        assert.equal(requestedUrls[1]?.pathname, '/api/v2/mix/market/candles');
        assert.equal(requestedUrls[1]?.searchParams.get('granularity'), '1H');
        assert.equal(requestedUrls[1]?.searchParams.get('productType'), 'usdt-futures');
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MarketDataController paginates OHLCV windows when range exceeds page limit', async () => {
  const { marketData } = buildMarketDataHarness();
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrls.push(new URL(String(input)));
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await withEnv({ OHLCV_CACHE_TTL_MS: '0' }, async () => {
      const response = await marketData.getOhlcv(
        'ETH/USDT',
        'spot',
        '1h',
        '2026-05-18T00:00:00.000Z',
        '2026-05-18T10:00:00.000Z',
        '3',
        'user_1',
        'workspace_a',
      );

      assert.equal(response.from, '2026-05-18T00:00:00.000Z');
      assert.equal(requestedUrls.length, 4);
      assert.equal(
        requestedUrls[0]?.searchParams.get('startTime'),
        String(Date.parse('2026-05-18T00:00:00.000Z')),
      );
      assert.equal(
        requestedUrls[0]?.searchParams.get('endTime'),
        String(Date.parse('2026-05-18T03:00:00.000Z')),
      );
      assert.equal(
        requestedUrls.at(-1)?.searchParams.get('endTime'),
        String(Date.parse('2026-05-18T10:00:00.000Z')),
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MarketDataController rejects invalid OHLCV interval and ranges', async () => {
  const { marketData } = buildMarketDataHarness();

  await assert.rejects(
    () =>
      marketData.getOhlcv(
        'BTC/USDT',
        'spot',
        '2m',
        undefined,
        undefined,
        undefined,
        'user_1',
        'workspace_a',
      ),
    (error: unknown) =>
      error instanceof BadRequestException &&
      /Unsupported OHLCV interval/.test(error.message),
  );

  await assert.rejects(
    () =>
      marketData.getOhlcv(
        'BTC/USDT',
        'spot',
        '1m',
        '2026-05-18T02:00:00.000Z',
        '2026-05-18T01:00:00.000Z',
        undefined,
        'user_1',
        'workspace_a',
      ),
    (error: unknown) =>
      error instanceof BadRequestException &&
      /from must be before to/.test(error.message),
  );

  await assert.rejects(
    () =>
      marketData.getOhlcv(
        'BTC/USDT',
        'spot',
        '1m',
        '2026-04-18T00:00:00.000Z',
        '2026-05-18T00:00:00.000Z',
        undefined,
        'user_1',
        'workspace_a',
      ),
    (error: unknown) =>
      error instanceof BadRequestException && /Range is too large/.test(error.message),
  );
});

test('MarketDataController returns controlled OHLCV provider errors', async () => {
  const { marketData } = buildMarketDataHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: -1 }), { status: 502 })) as typeof fetch;

  try {
    await withEnv({ OHLCV_CACHE_TTL_MS: '0' }, async () => {
      await assert.rejects(
        () =>
          marketData.getOhlcv(
            'BTC/USDT',
            'spot',
            '15m',
            '2026-05-18T00:00:00.000Z',
            '2026-05-18T03:00:00.000Z',
            '100',
            'user_1',
            'workspace_a',
          ),
        (error: unknown) =>
          error instanceof ServiceUnavailableException &&
          /OHLCV provider returned HTTP 502/.test(error.message),
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('daily brief generation persists a usable watchlist brief', async () => {
  const { journal, briefs } = buildHarness();
  journal.watchlists.push({
    id: 'watch_1',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_1',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_brief_duplicate',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_1',
    item_type: 'thesis',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    enabled: true,
    created_at: '2026-05-12T00:01:00.000Z',
  });
  journal.theses.set(key('thesis_1', 'workspace_a'), {
    id: 'thesis_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.82,
    thesis_text: 'Breakout continuation.',
    target_zones: ['110000'],
    invalidation_level: '95000',
    supporting_signal_ids: ['sig_1'],
  });
  journal.alerts.push(
    {
      id: 'alert_1',
      workspace_id: 'workspace_a',
      alert_type: 'target_zone_reached',
      symbol: 'BTC/USDT',
      thesis_id: 'thesis_1',
      watchlist_item_id: 'watch_item_1',
      trigger_key: 'target_zone_reached:thesis_1:110000',
      created_at: '2026-05-12T02:00:00.000Z',
      message: 'Target reached',
    },
    {
      id: 'alert_duplicate',
      workspace_id: 'workspace_a',
      alert_type: 'target_zone_reached',
      symbol: 'BTC/USDT',
      thesis_id: 'thesis_1',
      watchlist_item_id: 'watch_item_brief_duplicate',
      trigger_key: 'target_zone_reached:thesis_1:110000',
      created_at: '2026-05-12T02:01:00.000Z',
      message: 'Target reached',
    },
  );
  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T01:00:00.000Z',
    current_price: 108000,
    market_regime: 'risk-on',
    source: 'fixture',
    source_timestamp: '2026-05-12T01:00:00.000Z',
  });

  const brief = await briefs.createDaily(
    { watchlist_id: 'watch_1', date: '2026-05-14' },
    'user_1',
    'workspace_a',
  );

  assert.equal(brief.watchlist_name, 'Core');
  assert.equal(brief.brief_date, '2026-05-14');
  assert.deepEqual(brief.thesis_ids, ['thesis_1']);
  assert.equal(brief.thesis_updates.length, 1);
  assert.deepEqual(brief.thesis_updates[0]?.recent_alerts, ['Target reached']);
  assert.deepEqual(brief.signal_ids, ['sig_1']);
  assert.deepEqual(
    brief.asset_summaries.map((asset) => asset.symbol),
    ['BTC/USDT'],
  );
  assert.deepEqual(brief.watchlist_changes, [
    "Watchlist 'Core' has 1 active item(s).",
    '1 thesis-backed watch(es), 0 symbol-only watch(es).',
  ]);
  assert.equal(journal.briefs.length, 1);
});

test('daily brief archive can be scoped to a selected watchlist and rejects future dates', async () => {
  const { journal, briefs } = buildHarness();
  journal.watchlists.push(
    {
      id: 'watch_1',
      workspace_id: 'workspace_a',
      name: 'Core',
      enabled: true,
    },
    {
      id: 'watch_2',
      workspace_id: 'workspace_a',
      name: 'Alt',
      enabled: true,
    },
  );
  journal.briefs.push(
    {
      id: 'brief_core',
      workspace_id: 'workspace_a',
      brief_date: '2026-05-14',
      watchlist_name: 'Core',
      title: 'Core brief',
    },
    {
      id: 'brief_alt',
      workspace_id: 'workspace_a',
      brief_date: '2026-05-14',
      watchlist_name: 'Alt',
      title: 'Alt brief',
    },
    {
      id: 'brief_future',
      workspace_id: 'workspace_a',
      brief_date: '2999-01-01',
      watchlist_name: 'Core',
      title: 'Future brief',
    },
  );

  const scoped = await briefs.daily(
    undefined,
    20,
    'user_1',
    'workspace_a',
    'watch_1',
  );

  assert.deepEqual(
    scoped.map((brief) => brief.id),
    ['brief_core'],
  );
  await assert.rejects(
    () => briefs.daily('2999-01-01', 20, 'user_1', 'workspace_a', 'watch_1'),
    isException(BadRequestException),
  );
  await assert.rejects(
    () =>
      briefs.createDaily(
        { watchlist_id: 'watch_1', date: '2999-01-01' },
        'user_1',
        'workspace_a',
      ),
    isException(BadRequestException),
  );
});

test('research workspace exposes snapshots, debate, scenarios, and events', async () => {
  const { journal, researchRuns, theses } = buildHarness();
  journal.researchRuns.set(key('run_workspace', 'workspace_a'), {
    id: 'run_workspace',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    status: 'completed',
    market_snapshot_id: 'market_1',
    signal_snapshot_id: 'snapshot_1',
    debate_id: 'debate_1',
    thesis_id: 'thesis_3',
  });
  journal.events.set(key('run_workspace', 'workspace_a'), [
    {
      id: 'event_1',
      workspace_id: 'workspace_a',
      research_run_id: 'run_workspace',
      event_type: 'run.completed',
      message: 'completed',
      payload: { status: 'completed' },
    },
  ]);
  journal.marketSnapshots.set(key('market_1', 'workspace_a'), {
    id: 'market_1',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    current_price: '100100',
    source: 'ccxt',
  });
  journal.signalSnapshots.set(key('snapshot_1', 'workspace_a'), {
    id: 'snapshot_1',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    signal_count: 3,
    bullish_count: 2,
    bearish_count: 1,
    neutral_count: 0,
    stale_count: 0,
    unknown_freshness_count: 0,
  });
  journal.debates.set(key('debate_1', 'workspace_a'), {
    id: 'debate_1',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    consensus_stance: 'bullish',
    conflict_level: 'medium',
  });
  journal.agentOpinions.set(key('debate_1', 'workspace_a'), [
    {
      id: 'opinion_1',
      workspace_id: 'workspace_a',
      debate_id: 'debate_1',
      research_run_id: 'run_workspace',
      agent_name: 'market_analyst',
      agent_role: 'analyst',
      stance: 'bullish',
      confidence: '0.64',
    },
  ]);
  journal.theses.set(key('thesis_3', 'workspace_a'), {
    id: 'thesis_3',
    workspace_id: 'workspace_a',
    research_run_id: 'run_workspace',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'trend_pullback',
    supporting_signal_ids: ['sig_support'],
  });
  journal.signals.push({
    id: 'sig_support',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    signal_type: 'trend',
    direction: 'bullish',
    payload: {
      provenance: {
        source: 'ccxt',
        source_timestamp: '2026-05-12T00:00:00.000Z',
      },
      evidence: { ema_stack: 'bullish' },
    },
  });
  journal.scenarios.set(key('thesis_3', 'workspace_a'), [
    {
      id: 'scenario_1',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_3',
      probability_band: 'high',
      suggested_user_action: 'watch',
      payload: {
        condition: 'Holds entry zone',
        expected_behavior: 'Rotation higher',
      },
    },
  ]);

  const snapshots = await researchRuns.snapshots(
    'run_workspace',
    'user_1',
    'workspace_a',
  );
  const debate = await researchRuns.debate(
    'run_workspace',
    'user_1',
    'workspace_a',
  );
  const workspace = await researchRuns.workspace(
    'run_workspace',
    'user_1',
    'workspace_a',
  );
  const bundle = await researchRuns.evidenceBundle(
    'run_workspace',
    'user_1',
    'workspace_a',
  );
  const scenarios = await theses.scenarios(
    'thesis_3',
    'user_1',
    'workspace_a',
  );

  assert.equal(snapshots.market_snapshot?.current_price, 100100);
  assert.equal(snapshots.signal_snapshot?.signal_count, 3);
  assert.equal(debate.debate?.consensus_stance, 'bullish');
  assert.equal(debate.agent_opinions[0]?.confidence, 0.64);
  assert.equal(workspace.events[0]?.event_type, 'run.completed');
  assert.equal(workspace.thesis?.id, 'thesis_3');
  assert.equal(bundle.schema_version, 'evidence_bundle.v1');
  assert.equal(bundle.research_run_id, 'run_workspace');
  assert.equal(bundle.signal_details[0]?.id, 'sig_support');
  assert.deepEqual(bundle.signal_details[0]?.evidence, { ema_stack: 'bullish' });
  assert.equal(scenarios[0]?.condition, 'Holds entry zone');
});

test('research continuity creates baseline then delta and exposes the nine-section report', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_btc_day_1',
    thesisId: 'thesis_btc_day_1',
    debateId: 'debate_btc_day_1',
    marketSnapshotId: 'market_btc_day_1',
    signalSnapshotId: 'signal_btc_day_1',
    stance: 'neutral',
    thesisDirection: 'neutral',
    risks: ['Funding is becoming crowded.'],
    monitorNext: ['Watch whether spot demand follows the breakout.'],
  });
  seedContinuityRun(journal, {
    runId: 'run_btc_day_2',
    thesisId: 'thesis_btc_day_2',
    debateId: 'debate_btc_day_2',
    marketSnapshotId: 'market_btc_day_2',
    signalSnapshotId: 'signal_btc_day_2',
    stance: 'cautious_bullish',
    thesisDirection: 'long',
    risks: ['Funding is becoming crowded.', 'ETF inflow momentum could fade.'],
    monitorNext: ['Watch whether spot demand follows the breakout.'],
    currentPrice: 103500,
  });

  const baseline = await researchContinuity.generateForRun(
    'run_btc_day_1',
    {},
    'user_1',
    'workspace_a',
  );
  const delta = await researchContinuity.generateForRun(
    'run_btc_day_2',
    {},
    'user_1',
    'workspace_a',
  );
  const runEntry = await researchContinuity.getRunContinuity(
    'run_btc_day_2',
    'viewer_1',
    'workspace_a',
  );
  const state = await researchContinuity.getSymbolState(
    'BTC/USDT',
    'viewer_1',
    'workspace_a',
  );
  const entries = await researchContinuity.listSymbolEntries(
    'BTC/USDT',
    { limit: 10 },
    'viewer_1',
    'workspace_a',
  );

  assert.equal(baseline.created, true);
  assert.equal(baseline.entry.entry_type, 'baseline');
  assert.equal(baseline.entry.snapshot_quality.evidence_coverage, 0);
  assert.equal(delta.entry.entry_type, 'delta');
  assert.equal(delta.entry.previous_entry_id, baseline.entry.id);
  assert.equal(runEntry?.id, delta.entry.id);
  assert.equal(state.state?.latest_entry_id, delta.entry.id);
  assert.equal(state.state?.current_view.directional_bias, 'cautious_bullish');
  assert.equal(entries.entries.length, 2);
  assert.deepEqual(
    delta.entry.sections.map((section: { title: string }) => section.title),
    [
      'Summary',
      'Current View',
      'Material Changes',
      'Reinforced And Updated Claims',
      'Risks And Invalidations',
      'Watchpoints And Levels',
      'Resolved Or Weakened Items',
      'Source And Evidence Trace',
      'Data Quality',
    ],
  );
  assert.ok(
    delta.entry.events.some(
      (event) => event.event_type === 'view_changed',
    ),
  );
  assert.ok(
    !JSON.stringify(delta.entry).toLowerCase().includes('correct'),
  );
});

test('research continuity V1.1 enriches snapshots with claims, provenance, evidence, and quality metrics', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_btc_v11_snapshot',
    thesisId: 'thesis_btc_v11_snapshot',
    debateId: 'debate_btc_v11_snapshot',
    marketSnapshotId: 'market_btc_v11_snapshot',
    signalSnapshotId: 'signal_btc_v11_snapshot',
    stance: 'cautious_bullish',
    thesisDirection: 'long',
    risks: ['Funding is crowded.'],
    monitorNext: ['Watch spot bid follow-through.'],
  });
  const thesis = journal.theses.get(key('thesis_btc_v11_snapshot', 'workspace_a'));
  assert.ok(thesis);
  thesis.summary = {
    ...record(thesis.summary),
    key_reasons: [
      'Market structure remains the main driver.',
      'Funding is crowded.',
    ],
    why_this_thesis: 'Spot demand keeps absorbing shallow pullbacks.',
    supporting_evidence: ['Spot bid stayed firm.', 'Funding reset after the squeeze.'],
  };
  thesis.payload = {
    structured_summary: {
      key_reasons: ['Open interest expansion confirms participation.'],
      supporting_evidence: ['OI rose with price instead of against it.'],
    },
  };

  await researchContinuity.generateForRun(
    'run_btc_v11_snapshot',
    {},
    'user_1',
    'workspace_a',
  );

  const snapshot = await journal.getResearchSnapshotByRun(
    'run_btc_v11_snapshot',
    'workspace_a',
  );
  assert.ok(snapshot);
  const trackedItems = records(snapshot.tracked_items);
  const claims = trackedItems.filter((item) => item.type === 'claim');
  const risks = trackedItems.filter((item) => item.type === 'risk');
  const marketStructureClaim = claims.find((item) =>
    String(item.text).includes('Market structure remains'),
  );
  const fundingRisk = risks.find((item) =>
    String(item.text).includes('Funding is crowded'),
  );

  assert.ok(marketStructureClaim);
  assert.ok(fundingRisk);
  assert.equal(
    claims.some((item) => item.text === 'Funding is crowded.'),
    false,
  );
  assert.equal(marketStructureClaim.source_artifact, 'thesis');
  assert.equal(marketStructureClaim.source_id, 'thesis_btc_v11_snapshot');
  assert.equal(marketStructureClaim.source_field, 'summary.key_reasons[0]');
  assert.equal(marketStructureClaim.item_key_version, 'v1.1');
  assert.match(String(marketStructureClaim.item_key), /^claim:market_structure:/);
  assert.match(String(marketStructureClaim.legacy_item_key), /^claim:/);
  assert.equal(
    marketStructureClaim.canonical_text,
    'market structure remains main driver',
  );
  assert.deepEqual(marketStructureClaim.identity_terms, ['market_structure']);
  assert.equal(marketStructureClaim.identity_confidence, 'high');
  assert.equal(marketStructureClaim.trace_quality, 'evidence_backed');
  assert.deepEqual(records(marketStructureClaim.evidence).map((item) => item.text), [
    'Spot bid stayed firm.',
    'Funding reset after the squeeze.',
    'OI rose with price instead of against it.',
  ]);

  const quality = record(snapshot.data_quality);
  assert.equal(quality.tracked_item_count, trackedItems.length);
  assert.equal(quality.claim_count, claims.length);
  assert.equal(quality.risk_count, risks.length);
  assert.equal(quality.unsourced_item_count, 0);
  assert.equal(quality.source_coverage, 1);
  assert.equal(quality.evidence_attached_count, trackedItems.length);
  assert.equal(quality.evidence_coverage, 1);
  assert.equal(record(quality.identity_quality).fallback_hash_ratio, 0);
  assert.equal(quality.provenance_status, 'clean');
});

test('research continuity does not promote rhetorical agent opinion risks into tracked risks', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_agent_risk_noise',
    thesisId: 'thesis_agent_risk_noise',
    debateId: 'debate_agent_risk_noise',
    marketSnapshotId: 'market_agent_risk_noise',
    signalSnapshotId: 'signal_agent_risk_noise',
    stance: 'neutral',
    thesisDirection: 'neutral',
  });
  const opinions = journal.agentOpinions.get(
    key('debate_agent_risk_noise', 'workspace_a'),
  );
  assert.ok(opinions?.[0]);
  opinions[0].payload = {
    risks: [
      'You call that weakness',
      'Funding is becoming crowded.',
    ],
    invalidation: 'Break back below the reclaimed range.',
  };

  await researchContinuity.generateForRun(
    'run_agent_risk_noise',
    {},
    'user_1',
    'workspace_a',
  );

  const snapshot = await journal.getResearchSnapshotByRun(
    'run_agent_risk_noise',
    'workspace_a',
  );
  assert.ok(snapshot);
  const risks = records(snapshot.tracked_items).filter(
    (item) => item.type === 'risk',
  );

  assert.equal(
    risks.some((item) => item.text === 'You call that weakness'),
    false,
  );
  assert.ok(
    risks.some((item) => item.text === 'Funding is becoming crowded.'),
  );
  assert.equal(record(snapshot.data_quality).risk_count, risks.length);
});

test('research evidence V1.2 normalizes legacy strings and malformed objects safely', () => {
  const evidence = normalizeEvidenceItems([
    'Legacy thesis evidence.',
    {
      message: 'Funding feed was unavailable during collection.',
      evidence_kind: 'missing',
      source_artifact: 'research_run',
    },
    {
      text: 'Invalid evidence metadata should degrade deterministically.',
      evidence_kind: 'unsupported_kind',
      source_artifact: 'funding_feed',
      strength: 'unsupported_strength',
    },
    {
      evidence_kind: 'observed',
      source_artifact: 'market_snapshot',
    },
  ]);

  assert.deepEqual(evidence, [
    {
      text: 'Legacy thesis evidence.',
      evidence_kind: 'reasoning',
      source_artifact: 'trade_thesis',
    },
    {
      message: 'Funding feed was unavailable during collection.',
      text: 'Funding feed was unavailable during collection.',
      evidence_kind: 'missing',
      source_artifact: 'research_run',
    },
    {
      text: 'Invalid evidence metadata should degrade deterministically.',
      evidence_kind: 'reasoning',
      source_artifact: 'unknown',
      strength: 'unknown',
    },
  ]);

  const researchItems = normalizeResearchItems([
    'Legacy key reason.',
    {
      reason: 'Object key reason with observed support.',
      confidence: 'medium',
      supporting_evidence: [
        {
          description: 'Market snapshot confirmed the reclaim.',
          evidence_kind: 'observed',
          source_artifact: 'market_snapshot',
          source_id: 'market_snapshot_1',
        },
      ],
    },
    {
      supporting_evidence: [
        {
          text: 'Evidence without an item text should not create an item.',
          evidence_kind: 'observed',
          source_artifact: 'market_snapshot',
        },
      ],
    },
  ]);

  assert.equal(researchItems.length, 2);
  assert.deepEqual(researchItemTextList(researchItems), [
    'Legacy key reason.',
    'Object key reason with observed support.',
  ]);
  assert.deepEqual(researchItems[1]?.supporting_evidence, [
    {
      description: 'Market snapshot confirmed the reclaim.',
      text: 'Market snapshot confirmed the reclaim.',
      evidence_kind: 'observed',
      source_artifact: 'market_snapshot',
      source_id: 'market_snapshot_1',
    },
  ]);
  assert.equal(researchItems[1]?.confidence, 'medium');
});

test('research continuity V1.2 attaches item evidence before global fallback and reports evidence quality', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_btc_v12_evidence',
    thesisId: 'thesis_btc_v12_evidence',
    debateId: 'debate_btc_v12_evidence',
    marketSnapshotId: 'market_btc_v12_evidence',
    signalSnapshotId: 'signal_btc_v12_evidence',
    stance: 'cautious_bullish',
    thesisDirection: 'long',
  });
  const thesis = journal.theses.get(key('thesis_btc_v12_evidence', 'workspace_a'));
  assert.ok(thesis);
  thesis.structured_summary = {
    rating: 'Overweight',
    direction: 'long',
    confidence: 0.66,
    action_summary: 'Constructive while reclaim holds.',
    entry_zone: 'Pullback near support',
    invalidation: 'Close back below support',
    target_zones: ['range high'],
    key_reasons: [
      {
        text: 'Market structure improved after reclaiming the prior range.',
        supporting_evidence: [
          {
            text: 'BTC reclaimed the prior range and held above it into close.',
            evidence_kind: 'observed',
            source_artifact: 'market_snapshot',
            source_field: 'payload.market_structure',
            strength: 'medium',
          },
        ],
      },
    ],
    risks: [
      {
        text: 'Funding data is unavailable for this run.',
        supporting_evidence: [
          {
            message: 'Funding feed was unavailable during collection.',
            evidence_kind: 'missing',
            source_artifact: 'research_run',
          },
        ],
      },
    ],
    monitor_next: [
      {
        text: 'Watch whether BTC accepts above resistance.',
      },
    ],
    supporting_evidence: [
      {
        text: 'Portfolio manager synthesis favors patience until confirmation.',
        evidence_kind: 'reasoning',
        source_artifact: 'trade_thesis',
      },
    ],
  };
  thesis.monitor_next = [
    {
      text: 'Watch whether BTC accepts above resistance.',
    },
  ];

  const publicThesis = toThesisResponse(thesis);
  assert.deepEqual(publicThesis.summary.key_reasons, [
    'Market structure improved after reclaiming the prior range.',
  ]);
  assert.deepEqual(publicThesis.summary.risks, [
    'Funding data is unavailable for this run.',
  ]);
  assert.deepEqual(publicThesis.monitor_next, [
    'Watch whether BTC accepts above resistance.',
  ]);

  const delta = await researchContinuity.generateForRun(
    'run_btc_v12_evidence',
    {},
    'user_1',
    'workspace_a',
  );
  const snapshot = await journal.getResearchSnapshotByRun(
    'run_btc_v12_evidence',
    'workspace_a',
  );
  assert.ok(snapshot);
  assert.equal(
    record(snapshot.payload).evidence_contract_version,
    'research_evidence.v1.2',
  );
  assert.equal(
    delta.entry.writer_metadata.evidence_contract_version,
    'research_evidence.v1.2',
  );
  assert.equal(
    delta.entry.payload.evidence_contract_version,
    'research_evidence.v1.2',
  );
  const trackedItems = records(snapshot.tracked_items);
  const claim = trackedItems.find((item) =>
    String(item.text).includes('Market structure improved'),
  );
  const risk = trackedItems.find((item) =>
    String(item.text).includes('Funding data is unavailable'),
  );
  const watchpoint = trackedItems.find((item) =>
    String(item.text).includes('Watch whether BTC accepts'),
  );

  assert.ok(claim);
  assert.ok(risk);
  assert.ok(watchpoint);
  assert.deepEqual(records(claim.evidence).map((item) => item.text), [
    'BTC reclaimed the prior range and held above it into close.',
  ]);
  assert.equal(records(claim.evidence)[0]?.evidence_kind, 'observed');
  assert.equal(claim.evidence_quality, 'observed_backed');
  assert.equal(claim.observed_evidence_count, 1);
  assert.equal(claim.reasoning_evidence_count, 0);
  assert.equal(claim.missing_evidence_count, 0);
  assert.deepEqual(records(risk.evidence).map((item) => item.text), [
    'Funding feed was unavailable during collection.',
  ]);
  assert.equal(risk.evidence_quality, 'missing_limited');
  assert.equal(risk.missing_evidence_count, 1);
  assert.deepEqual(records(watchpoint.evidence).map((item) => item.text), [
    'Portfolio manager synthesis favors patience until confirmation.',
  ]);
  assert.equal(watchpoint.evidence_quality, 'reasoning_only');

  const quality = record(snapshot.data_quality);
  assert.equal(quality.observed_evidence_count, 1);
  assert.equal(quality.missing_evidence_count, 1);
  assert.ok(Number(quality.observed_evidence_coverage) > 0);
  assert.ok(Number(quality.observed_evidence_coverage) < 1);
  assert.equal(quality.missing_evidence_item_count, 1);
  assert.ok(numberValue(quality.reasoning_only_item_count) >= 1);
  assert.equal(quality.no_evidence_item_count, 0);
  assert.ok(
    delta.entry.sections.some(
      (section) =>
        section.title === 'Source And Evidence Trace' &&
        section.items.some((item: string) => item.includes('Observed evidence coverage')),
    ),
  );
});

test('research continuity V1.1 matches legacy item keys without fake churn', async () => {
  const { journal, researchContinuity } = buildHarness();
  const riskText = 'Funding is crowded.';
  journal.continuityStates.set(key('BTC/USDT', 'workspace_a'), {
    id: 'continuity_state_BTC_USDT',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    latest_entry_id: 'continuity_legacy',
    latest_run_id: 'run_legacy',
    current_view: {
      directional_bias: 'neutral',
      risk_posture: 'balanced',
      conviction: 'medium',
      time_context: 'daily_context',
    },
    active_items: [
      {
        item_key: legacyItemKey('risk', riskText),
        type: 'risk',
        status: 'active',
        text: riskText,
        importance: 'medium',
      },
    ],
    recent_resolved_items: [],
    recent_invalidated_items: [],
    data_quality: { status: 'clean', score: 1 },
    updated_at: '2026-05-20T10:00:00.000Z',
  });
  journal.continuityEntries.set(key('continuity_legacy', 'workspace_a'), {
    id: 'continuity_legacy',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    research_run_id: 'run_legacy',
    generated_at: '2026-05-20T10:00:00.000Z',
    entry_type: 'delta',
    status: 'completed',
    summary: 'Legacy entry.',
    sections: [],
    events: [],
  });
  seedContinuityRun(journal, {
    runId: 'run_btc_v11_legacy_match',
    thesisId: 'thesis_btc_v11_legacy_match',
    debateId: 'debate_btc_v11_legacy_match',
    marketSnapshotId: 'market_btc_v11_legacy_match',
    signalSnapshotId: 'signal_btc_v11_legacy_match',
    stance: 'neutral',
    thesisDirection: 'neutral',
    risks: [riskText],
  });

  const delta = await researchContinuity.generateForRun(
    'run_btc_v11_legacy_match',
    {},
    'user_1',
    'workspace_a',
  );
  const snapshot = await journal.getResearchSnapshotByRun(
    'run_btc_v11_legacy_match',
    'workspace_a',
  );
  const currentRisk = records(snapshot?.tracked_items).find(
    (item) => item.type === 'risk' && item.text === riskText,
  );
  assert.ok(currentRisk);
  assert.notEqual(currentRisk.item_key, legacyItemKey('risk', riskText));
  assert.equal(currentRisk.legacy_item_key, legacyItemKey('risk', riskText));

  const eventTypes = delta.entry.events.map((event) => event.event_type);
  assert.equal(eventTypes.includes('risk_added'), false);
  assert.equal(eventTypes.includes('risk_resolved'), false);
  assert.ok(
    eventTypes.includes('risk_reinforced') ||
      eventTypes.includes('risk_updated'),
  );
});

test('research continuity V1.1 emits update events and preserves item lifecycle metadata', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_btc_v11_update_1',
    thesisId: 'thesis_btc_v11_update_1',
    debateId: 'debate_btc_v11_update_1',
    marketSnapshotId: 'market_btc_v11_update_1',
    signalSnapshotId: 'signal_btc_v11_update_1',
    stance: 'neutral',
    thesisDirection: 'neutral',
    risks: ['Funding is slightly elevated.'],
  });
  seedContinuityRun(journal, {
    runId: 'run_btc_v11_update_2',
    thesisId: 'thesis_btc_v11_update_2',
    debateId: 'debate_btc_v11_update_2',
    marketSnapshotId: 'market_btc_v11_update_2',
    signalSnapshotId: 'signal_btc_v11_update_2',
    stance: 'neutral',
    thesisDirection: 'neutral',
    risks: ['Funding is extremely overheated.'],
  });

  await researchContinuity.generateForRun(
    'run_btc_v11_update_1',
    {},
    'user_1',
    'workspace_a',
  );
  const delta = await researchContinuity.generateForRun(
    'run_btc_v11_update_2',
    {},
    'user_1',
    'workspace_a',
  );
  const state = await researchContinuity.getSymbolState(
    'BTC/USDT',
    'viewer_1',
    'workspace_a',
  );

  const riskUpdated = delta.entry.events.find(
    (event) => event.event_type === 'risk_updated',
  );
  assert.ok(riskUpdated);
  assert.deepEqual(riskUpdated.changed_fields, ['text', 'canonical_text']);
  assert.equal(riskUpdated.previous_text, 'Funding is slightly elevated.');
  assert.equal(riskUpdated.current_text, 'Funding is extremely overheated.');
  assert.equal(record(riskUpdated.source).source_artifact, 'thesis');
  assert.equal(record(riskUpdated.source).source_field, 'summary.risks[0]');
  assert.equal(
    delta.entry.events.some((event) => event.event_type === 'risk_added'),
    false,
  );
  assert.equal(
    delta.entry.events.some((event) => event.event_type === 'risk_resolved'),
    false,
  );

  const activeRisk = records(state.state?.active_items).find(
    (item) => item.type === 'risk',
  );
  assert.ok(activeRisk);
  assert.equal(activeRisk.first_seen_run_id, 'run_btc_v11_update_1');
  assert.equal(activeRisk.last_seen_run_id, 'run_btc_v11_update_2');
  assert.equal(activeRisk.occurrence_count, 2);
  assert.equal(activeRisk.previous_text, 'Funding is slightly elevated.');
  assert.equal(activeRisk.current_text, 'Funding is extremely overheated.');
});

test('research continuity skips insufficient runs and constrains degraded state updates', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_clean',
    thesisId: 'thesis_clean',
    debateId: 'debate_clean',
    marketSnapshotId: 'market_clean',
    signalSnapshotId: 'signal_clean',
    stance: 'bullish',
    thesisDirection: 'long',
  });
  journal.researchRuns.set(key('run_empty', 'workspace_a'), {
    id: 'run_empty',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    status: 'completed',
  });
  journal.researchRuns.set(key('run_degraded', 'workspace_a'), {
    id: 'run_degraded',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    status: 'completed_degraded',
    debate_id: 'debate_degraded',
    degradation_reasons: ['partial_artifacts'],
    missing_core_data: ['market_snapshot'],
  });
  journal.debates.set(key('debate_degraded', 'workspace_a'), {
    id: 'debate_degraded',
    workspace_id: 'workspace_a',
    research_run_id: 'run_degraded',
    symbol: 'BTC/USDT',
    consensus_stance: 'bearish',
    conflict_level: 'high',
  });

  const baseline = await researchContinuity.generateForRun(
    'run_clean',
    {},
    'user_1',
    'workspace_a',
  );
  const skipped = await researchContinuity.generateForRun(
    'run_empty',
    {},
    'user_1',
    'workspace_a',
  );
  const degraded = await researchContinuity.generateForRun(
    'run_degraded',
    {},
    'user_1',
    'workspace_a',
  );
  const state = await researchContinuity.getSymbolState(
    'BTC/USDT',
    'viewer_1',
    'workspace_a',
  );

  assert.equal(baseline.entry.entry_type, 'baseline');
  assert.equal(skipped.entry.entry_type, 'skipped');
  assert.equal(skipped.entry.status, 'skipped');
  assert.equal(skipped.entry.summary, 'Continuity skipped: insufficient_structured_data.');
  assert.equal(degraded.entry.entry_type, 'degraded');
  assert.equal(state.state?.latest_entry_id, degraded.entry.id);
  assert.equal(state.state?.current_view.directional_bias, 'bullish');
  assert.equal(state.state?.data_quality.status, 'degraded');
});

test('research continuity manual regenerate is idempotent by default and requires editor access', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_manual',
    thesisId: 'thesis_manual',
    debateId: 'debate_manual',
    marketSnapshotId: 'market_manual',
    signalSnapshotId: 'signal_manual',
    stance: 'neutral',
    thesisDirection: 'neutral',
  });

  await assert.rejects(
    () =>
      researchContinuity.generateForRun(
        'run_manual',
        {},
        'viewer_1',
        'workspace_a',
      ),
    isException(ForbiddenException),
  );
  const first = await researchContinuity.generateForRun(
    'run_manual',
    {},
    'user_1',
    'workspace_a',
  );
  const second = await researchContinuity.generateForRun(
    'run_manual',
    {},
    'user_1',
    'workspace_a',
  );
  const forced = await researchContinuity.generateForRun(
    'run_manual',
    { force: true },
    'user_1',
    'workspace_a',
  );

  assert.equal(second.created, false);
  assert.equal(second.entry.id, first.entry.id);
  assert.equal(forced.created, true);
  assert.notEqual(forced.entry.id, first.entry.id);
  assert.equal(
    [...journal.continuityEntries.values()].filter(
      (entry) => entry.research_run_id === 'run_manual',
    ).length,
    2,
  );
});

test('research continuity repair preview discovers V1.3 candidates and dry-run writes nothing', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_repair_missing',
    thesisId: 'thesis_repair_missing',
    debateId: 'debate_repair_missing',
    marketSnapshotId: 'market_repair_missing',
    signalSnapshotId: 'signal_repair_missing',
    stance: 'neutral',
    thesisDirection: 'neutral',
  });
  seedContinuityRun(journal, {
    runId: 'run_repair_skipped',
    thesisId: 'thesis_repair_skipped',
    debateId: 'debate_repair_skipped',
    marketSnapshotId: 'market_repair_skipped',
    signalSnapshotId: 'signal_repair_skipped',
    stance: 'bullish',
    thesisDirection: 'long',
  });
  seedContinuityRun(journal, {
    runId: 'run_repair_legacy',
    thesisId: 'thesis_repair_legacy',
    debateId: 'debate_repair_legacy',
    marketSnapshotId: 'market_repair_legacy',
    signalSnapshotId: 'signal_repair_legacy',
    stance: 'bearish',
    thesisDirection: 'short',
  });
  journal.continuityEntries.set(key('continuity_repair_skipped', 'workspace_a'), {
    id: 'continuity_repair_skipped',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    research_run_id: 'run_repair_skipped',
    current_snapshot_id: null,
    previous_entry_id: null,
    entry_type: 'skipped',
    status: 'skipped',
    generated_at: '2026-05-10T00:00:00.000Z',
    summary: 'Continuity skipped.',
    sections: [],
    events: [],
    snapshot_quality: { status: 'skipped', score: 0 },
    source_run_ids: ['run_repair_skipped'],
    writer_metadata: {},
    payload: { skip_reason: 'insufficient_structured_data' },
  });
  journal.continuityEntries.set(key('continuity_repair_legacy', 'workspace_a'), {
    id: 'continuity_repair_legacy',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    research_run_id: 'run_repair_legacy',
    current_snapshot_id: null,
    previous_entry_id: null,
    entry_type: 'delta',
    status: 'completed',
    generated_at: '2026-05-10T01:00:00.000Z',
    summary: 'Legacy continuity entry.',
    sections: [],
    events: [],
    snapshot_quality: { status: 'clean', score: 1 },
    source_run_ids: ['run_repair_legacy'],
    writer_metadata: {},
    payload: { schema_version: 'research_continuity_entry.v1.1' },
  });
  const entryCount = journal.continuityEntries.size;
  const snapshotCount = journal.researchSnapshots.size;
  const stateCount = journal.continuityStates.size;

  const preview = await researchContinuity.previewRepair(
    { case_types: 'missing_continuity,skipped_or_degraded,legacy_evidence', limit: 10 },
    'user_1',
    'workspace_a',
  );
  const eligible = preview.candidates.filter((candidate) => candidate.eligible);
  assert.equal(preview.dry_run, true);
  assert.equal(preview.candidate_count, preview.candidates.length);
  assert.ok(
    eligible.some(
      (candidate) =>
        candidate.run_id === 'run_repair_missing' &&
        candidate.case_type === 'missing_continuity' &&
        candidate.predicted_action === 'create_repair_entry',
    ),
  );
  assert.ok(
    eligible.some(
      (candidate) =>
        candidate.run_id === 'run_repair_skipped' &&
        candidate.case_type === 'skipped_or_degraded',
    ),
  );
  assert.ok(
    eligible.some(
      (candidate) =>
        candidate.run_id === 'run_repair_legacy' &&
        candidate.case_type === 'legacy_evidence',
    ),
  );
  assert.equal(journal.continuityEntries.size, entryCount);
  assert.equal(journal.researchSnapshots.size, snapshotCount);
  assert.equal(journal.continuityStates.size, stateCount);

  const dryRun = await researchContinuity.runRepair(
    {
      case_types: ['missing_continuity', 'skipped_or_degraded', 'legacy_evidence'],
      limit: 10,
    },
    'user_1',
    'workspace_a',
  );
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.repaired_count, 0);
  assert.ok(dryRun.results.some((result) => result.action === 'dry_run'));
  assert.equal(journal.continuityEntries.size, entryCount);
  assert.equal(journal.researchSnapshots.size, snapshotCount);
  assert.equal(journal.continuityStates.size, stateCount);
});

test('fake journal repair lookup supports Postgres-shaped nested repair metadata', async () => {
  const journal = new FakeJournalRepository();
  journal.continuityEntries.set(
    key('continuity_nested_repair_lookup', 'workspace_a'),
    postgresContinuityEntryShape({
      id: 'continuity_nested_repair_lookup',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      research_run_id: 'run_nested_repair_lookup',
      current_snapshot_id: null,
      previous_entry_id: 'continuity_nested_source',
      entry_type: 'delta',
      status: 'completed',
      generated_at: '2026-05-12T00:00:00.000Z',
      summary: 'Nested repair entry.',
      sections: [],
      events: [],
      snapshot_quality: { status: 'clean', score: 1 },
      source_run_ids: ['run_nested_repair_lookup'],
      writer_metadata: {},
      payload: {
        schema_version: 'research_continuity_entry.v1.1',
        evidence_contract_version: 'research_evidence.v1.2',
        repair: {
          is_repair: true,
          repair_version: 'research-continuity-v1.3',
          case_type: 'skipped_or_degraded',
          source_run_id: 'run_nested_repair_lookup',
          source_entry_id: 'continuity_nested_source',
        },
      },
    }),
  );

  const found = await journal.findResearchContinuityRepairEntry(
    {
      runId: 'run_nested_repair_lookup',
      caseType: 'skipped_or_degraded',
      repairVersion: 'research-continuity-v1.3',
      sourceEntryId: 'continuity_nested_source',
    },
    'workspace_a',
  );

  assert.equal(found?.id, 'continuity_nested_repair_lookup');
});

test('research continuity repair preview reads Postgres-shaped V1.2 payload before treating evidence as legacy', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_nested_v12_payload',
    thesisId: 'thesis_nested_v12_payload',
    debateId: 'debate_nested_v12_payload',
    marketSnapshotId: 'market_nested_v12_payload',
    signalSnapshotId: 'signal_nested_v12_payload',
    stance: 'neutral',
    thesisDirection: 'neutral',
  });
  journal.continuityEntries.set(
    key('continuity_nested_v12_payload', 'workspace_a'),
    postgresContinuityEntryShape({
      id: 'continuity_nested_v12_payload',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      research_run_id: 'run_nested_v12_payload',
      current_snapshot_id: null,
      previous_entry_id: null,
      entry_type: 'delta',
      status: 'completed',
      generated_at: '2026-05-12T00:00:00.000Z',
      summary: 'V1.2 continuity entry.',
      sections: [],
      events: [],
      snapshot_quality: {
        status: 'clean',
        score: 1,
        observed_evidence_coverage: 1,
        reasoning_only_item_count: 0,
        missing_evidence_item_count: 0,
        no_evidence_item_count: 0,
      },
      source_run_ids: ['run_nested_v12_payload'],
      writer_metadata: { evidence_contract_version: 'research_evidence.v1.2' },
      payload: {
        schema_version: 'research_continuity_entry.v1.1',
        evidence_contract_version: 'research_evidence.v1.2',
        deterministic: true,
      },
    }),
  );

  const preview = await researchContinuity.previewRepair(
    { case_types: 'legacy_evidence', limit: 5 },
    'user_1',
    'workspace_a',
  );
  const candidate = preview.candidates.find(
    (item) => item.run_id === 'run_nested_v12_payload',
  );

  assert.ok(candidate);
  assert.equal(candidate.eligible, false);
  assert.equal(candidate.blocked_reason, 'not_legacy_evidence');
});

test('research continuity missing repair race guard recognizes Postgres-shaped repair entries', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_nested_repair_race',
    thesisId: 'thesis_nested_repair_race',
    debateId: 'debate_nested_repair_race',
    marketSnapshotId: 'market_nested_repair_race',
    signalSnapshotId: 'signal_nested_repair_race',
    stance: 'neutral',
    thesisDirection: 'neutral',
  });

  const originalGetLatest =
    journal.getLatestResearchContinuityEntryForRun.bind(journal);
  let latestCalls = 0;
  journal.getLatestResearchContinuityEntryForRun = async (
    runId: string,
    workspaceId: string,
  ) => {
    latestCalls += 1;
    if (runId === 'run_nested_repair_race' && latestCalls > 1) {
      return postgresContinuityEntryShape({
        id: 'continuity_nested_repair_race_existing',
        workspace_id: workspaceId,
        symbol: 'BTC/USDT',
        research_run_id: runId,
        current_snapshot_id: null,
        previous_entry_id: null,
        entry_type: 'skipped',
        status: 'skipped',
        generated_at: '2026-05-12T00:01:00.000Z',
        summary: 'Concurrent repair entry.',
        sections: [],
        events: [],
        snapshot_quality: { status: 'skipped', score: 0 },
        source_run_ids: [runId],
        writer_metadata: {},
        payload: {
          schema_version: 'research_continuity_entry.v1.1',
          evidence_contract_version: 'research_evidence.v1.2',
          repair: {
            is_repair: true,
            repair_version: 'research-continuity-v1.3',
            case_type: 'legacy_evidence',
            source_run_id: runId,
            source_entry_id: 'continuity_other_source',
          },
        },
      });
    }
    return originalGetLatest(runId, workspaceId);
  };

  const result = await researchContinuity.runRepair(
    {
      case_types: ['missing_continuity'],
      limit: 5,
      dry_run: false,
    },
    'user_1',
    'workspace_a',
  );
  const repaired = result.results.find(
    (item) => item.run_id === 'run_nested_repair_race',
  );

  assert.equal(repaired?.action, 'created_repair_entry');
  assert.equal(result.repaired_count, 1);
});

test('research continuity repair requires admin access', async () => {
  const { researchContinuity } = buildHarness();

  for (const userId of ['viewer_1', 'editor_1']) {
    await assert.rejects(
      () =>
        researchContinuity.previewRepair(
          { case_types: 'missing_continuity', limit: 5 },
          userId,
          'workspace_a',
        ),
      isException(ForbiddenException),
    );
    await assert.rejects(
      () =>
        researchContinuity.runRepair(
          {
            case_types: ['missing_continuity'],
            limit: 5,
            dry_run: false,
          },
          userId,
          'workspace_a',
        ),
      isException(ForbiddenException),
    );
  }
});

test('research continuity repair execution is append-only and idempotent', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_repair_execute',
    thesisId: 'thesis_repair_execute',
    debateId: 'debate_repair_execute',
    marketSnapshotId: 'market_repair_execute',
    signalSnapshotId: 'signal_repair_execute',
    stance: 'cautious_bullish',
    thesisDirection: 'long',
  });

  const executed = await researchContinuity.runRepair(
    {
      case_types: ['missing_continuity'],
      limit: 5,
      dry_run: false,
    },
    'user_1',
    'workspace_a',
  );
  assert.equal(executed.dry_run, false);
  assert.equal(executed.repaired_count, 1);
  const created = executed.results.find(
    (result) => result.run_id === 'run_repair_execute',
  );
  assert.equal(created?.action, 'created_repair_entry');
  assert.ok(created?.new_entry_id);
  const repairEntry = await journal.getResearchContinuityEntry(
    String(created?.new_entry_id),
    'workspace_a',
  );
  assert.ok(repairEntry);
  assert.equal(record(record(repairEntry.payload).repair).case_type, 'missing_continuity');
  assert.equal(record(record(repairEntry.payload).repair).repair_version, 'research-continuity-v1.3');
  assert.equal(record(record(repairEntry.payload).repair).source_run_id, 'run_repair_execute');
  assert.equal(record(record(repairEntry.payload).repair).source_entry_id, null);
  assert.ok(
    records(repairEntry.sections).some((section) => section.title === 'Repair Context'),
  );

  const repeated = await researchContinuity.runRepair(
    {
      case_types: ['missing_continuity'],
      limit: 5,
      dry_run: false,
    },
    'user_1',
    'workspace_a',
  );
  assert.equal(repeated.repaired_count, 0);
  assert.ok(
    repeated.results.some(
      (result) =>
        result.run_id === 'run_repair_execute' &&
        result.action === 'already_repaired',
    ),
  );
  assert.equal(
    [...journal.continuityEntries.values()].filter(
      (entry) => entry.research_run_id === 'run_repair_execute',
    ).length,
    1,
  );
});

test('research continuity repair reports already_has_continuity when a normal entry appears before execution', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_repair_race',
    thesisId: 'thesis_repair_race',
    debateId: 'debate_repair_race',
    marketSnapshotId: 'market_repair_race',
    signalSnapshotId: 'signal_repair_race',
    stance: 'neutral',
    thesisDirection: 'neutral',
  });
  const preview = await researchContinuity.previewRepair(
    { case_types: 'missing_continuity', limit: 5 },
    'user_1',
    'workspace_a',
  );
  assert.ok(
    preview.candidates.some(
      (candidate) =>
        candidate.run_id === 'run_repair_race' &&
        candidate.predicted_action === 'create_repair_entry',
    ),
  );

  await researchContinuity.generateForRun(
    'run_repair_race',
    {},
    'user_1',
    'workspace_a',
  );
  const executed = await researchContinuity.runRepair(
    {
      case_types: ['missing_continuity'],
      limit: 5,
      dry_run: false,
    },
    'user_1',
    'workspace_a',
  );

  assert.ok(
    executed.results.some(
      (result) =>
        result.run_id === 'run_repair_race' &&
        result.action === 'already_has_continuity',
    ),
  );
  assert.equal(
    [...journal.continuityEntries.values()].filter(
      (entry) => entry.research_run_id === 'run_repair_race',
    ).length,
    1,
  );
});

test('research continuity repair does not move state backward for historical repairs', async () => {
  const { journal, researchContinuity } = buildHarness();
  seedContinuityRun(journal, {
    runId: 'run_repair_old',
    thesisId: 'thesis_repair_old',
    debateId: 'debate_repair_old',
    marketSnapshotId: 'market_repair_old',
    signalSnapshotId: 'signal_repair_old',
    stance: 'neutral',
    thesisDirection: 'neutral',
  });
  seedContinuityRun(journal, {
    runId: 'run_repair_latest2',
    thesisId: 'thesis_repair_latest2',
    debateId: 'debate_repair_latest2',
    marketSnapshotId: 'market_repair_latest2',
    signalSnapshotId: 'signal_repair_latest2',
    stance: 'bullish',
    thesisDirection: 'long',
  });
  const oldRun = journal.researchRuns.get(key('run_repair_old', 'workspace_a'));
  const latestRun = journal.researchRuns.get(key('run_repair_latest2', 'workspace_a'));
  assert.ok(oldRun);
  assert.ok(latestRun);
  oldRun.completed_at = '2026-05-10T00:00:00.000Z';
  oldRun.started_at = '2026-05-10T00:00:00.000Z';
  latestRun.completed_at = '2026-05-13T00:00:00.000Z';
  latestRun.started_at = '2026-05-13T00:00:00.000Z';

  const latest = await researchContinuity.generateForRun(
    'run_repair_latest2',
    {},
    'user_1',
    'workspace_a',
  );
  const repaired = await researchContinuity.runRepair(
    {
      symbol: 'BTC/USDT',
      from: '2026-05-10T00:00:00.000Z',
      to: '2026-05-10T23:59:59.999Z',
      case_types: ['missing_continuity'],
      limit: 5,
      dry_run: false,
    },
    'user_1',
    'workspace_a',
  );
  const oldRepair = repaired.results.find(
    (result) => result.run_id === 'run_repair_old',
  );
  const state = await researchContinuity.getSymbolState(
    'BTC/USDT',
    'viewer_1',
    'workspace_a',
  );
  assert.equal(oldRepair?.action, 'created_repair_entry');
  assert.equal(oldRepair?.state_updated, false);
  assert.equal(state.state?.latest_run_id, 'run_repair_latest2');
  assert.equal(state.state?.latest_entry_id, latest.entry.id);
});

test('research workspace derives stage timings from run events', async () => {
  const { journal, researchRuns } = buildHarness();
  journal.researchRuns.set(key('run_stage_timing', 'workspace_a'), {
    id: 'run_stage_timing',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    asset_class: 'crypto',
    market_type: 'perp',
    status: 'completed',
  });
  journal.events.set(key('run_stage_timing', 'workspace_a'), [
    {
      id: 'event_started',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'run.started',
      created_at: '2026-05-12T00:00:00.000Z',
      message: 'started',
      payload: { analysts: ['market', 'news'] },
    },
    {
      id: 'event_market_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:00:01.000Z',
      message: 'market started',
      payload: { analyst_name: 'market', graph_node: 'Market Analyst' },
    },
    {
      id: 'event_market_done',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.completed',
      created_at: '2026-05-12T00:00:03.000Z',
      message: 'market completed',
      payload: {
        analyst_name: 'market',
        graph_node: 'Market Analyst',
        duration_ms: 2450,
      },
    },
    {
      id: 'event_news_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:00:04.000Z',
      message: 'news started',
      payload: { analyst_name: 'news', graph_node: 'News Analyst' },
    },
    {
      id: 'event_bull_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:01:00.000Z',
      message: 'bull started',
      payload: { graph_node: 'Bull Researcher' },
    },
    {
      id: 'event_bear_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:02:00.000Z',
      message: 'bear started',
      payload: { graph_node: 'Contrarian Analyst' },
    },
    {
      id: 'event_bull_done',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.completed',
      created_at: '2026-05-12T00:04:00.000Z',
      message: 'bull completed',
      payload: { graph_node: 'Bull Researcher' },
    },
    {
      id: 'event_bear_done',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.completed',
      created_at: '2026-05-12T00:05:00.000Z',
      message: 'bear completed',
      payload: { graph_node: 'Contrarian Analyst' },
    },
    {
      id: 'event_debate_done',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'debate.recorded',
      created_at: '2026-05-12T00:06:00.000Z',
      message: 'debate recorded',
      payload: {},
    },
    {
      id: 'event_plan_done',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'plan.recorded',
      created_at: '2026-05-12T00:07:00.000Z',
      message: 'plan recorded',
      payload: {},
    },
    {
      id: 'event_risk_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:10:00.000Z',
      message: 'aggressive risk started',
      payload: { graph_node: 'Aggressive Analyst' },
    },
    {
      id: 'event_risk_failed',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.failed',
      created_at: '2026-05-12T00:11:00.000Z',
      message: 'aggressive risk failed',
      payload: { graph_node: 'Aggressive Analyst' },
    },
    {
      id: 'event_scenario_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:12:00.000Z',
      message: 'scenario started',
      payload: { graph_node: 'Scenario Planner' },
    },
    {
      id: 'event_scenario_failed',
      workspace_id: 'workspace_a',
      research_run_id: 'run_stage_timing',
      event_type: 'agent.node.failed',
      created_at: '2026-05-12T00:12:02.000Z',
      message: 'scenario failed',
      payload: { graph_node: 'Scenario Planner', duration_ms: 333 },
    },
  ]);

  const workspace = await researchRuns.workspace(
    'run_stage_timing',
    'user_1',
    'workspace_a',
  );
  const timing = (stageKey: string) =>
    workspace.stage_timings.find((stage) => stage.stage_key === stageKey);

  assert.equal(timing('market')?.event_state, 'completed');
  assert.equal(timing('market')?.duration_ms, 2450);
  assert.equal(timing('news')?.event_state, 'running');
  assert.equal(timing('debate')?.event_state, 'completed');
  assert.equal(timing('debate')?.started_at, '2026-05-12T00:01:00.000Z');
  assert.equal(timing('debate')?.completed_at, '2026-05-12T00:06:00.000Z');
  assert.equal(timing('debate')?.duration_ms, 300000);
  assert.equal(timing('perp_checks')?.event_state, 'completed');
  assert.equal(timing('perp_checks')?.completed_at, '2026-05-12T00:07:00.000Z');
  assert.equal(timing('spot_checks'), undefined);
  assert.equal(timing('social'), undefined);
  assert.equal(timing('risk_debate')?.event_state, 'failed');
  assert.equal(timing('risk_debate')?.duration_ms, 60000);
  assert.equal(timing('scenario_planner')?.event_state, 'failed');
  assert.equal(timing('scenario_planner')?.duration_ms, 333);
  assert.equal(timing('portfolio_manager')?.event_state, 'missing');
  assert.deepEqual(timing('market')?.source_event_ids, [
    'event_market_start',
    'event_market_done',
  ]);
});

test('research workspace derives spot branch timing from setup planner completion', async () => {
  const { journal, researchRuns } = buildHarness();
  journal.researchRuns.set(key('run_spot_branch_timing', 'workspace_a'), {
    id: 'run_spot_branch_timing',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    status: 'running',
  });
  journal.events.set(key('run_spot_branch_timing', 'workspace_a'), [
    {
      id: 'event_setup_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_spot_branch_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:07:00.000Z',
      message: 'setup started',
      payload: { graph_node: 'Setup Planner' },
    },
    {
      id: 'event_setup_done',
      workspace_id: 'workspace_a',
      research_run_id: 'run_spot_branch_timing',
      event_type: 'agent.node.completed',
      created_at: '2026-05-12T00:07:10.000Z',
      message: 'setup completed',
      payload: { graph_node: 'Setup Planner', duration_ms: 10000 },
    },
    {
      id: 'event_risk_start',
      workspace_id: 'workspace_a',
      research_run_id: 'run_spot_branch_timing',
      event_type: 'agent.node.started',
      created_at: '2026-05-12T00:07:11.000Z',
      message: 'risk started',
      payload: { graph_node: 'Aggressive Analyst' },
    },
  ]);

  const workspace = await researchRuns.workspace(
    'run_spot_branch_timing',
    'user_1',
    'workspace_a',
  );
  const timing = (stageKey: string) =>
    workspace.stage_timings.find((stage) => stage.stage_key === stageKey);

  assert.equal(timing('setup_planner')?.event_state, 'completed');
  assert.equal(timing('setup_planner')?.duration_ms, 10000);
  assert.equal(timing('spot_checks')?.event_state, 'completed');
  assert.equal(timing('spot_checks')?.started_at, null);
  assert.equal(timing('spot_checks')?.completed_at, '2026-05-12T00:07:10.000Z');
  assert.equal(timing('spot_checks')?.duration_ms, null);
  assert.deepEqual(timing('spot_checks')?.source_event_ids, ['event_setup_done']);
  assert.equal(timing('risk_debate')?.event_state, 'running');
});

test('research workspace does not complete thesis stage from persistence event only', async () => {
  const { journal, researchRuns } = buildHarness();
  journal.researchRuns.set(key('run_thesis_persist_only', 'workspace_a'), {
    id: 'run_thesis_persist_only',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    status: 'completed',
    thesis_id: 'thesis_persisted',
  });
  journal.theses.set(key('thesis_persisted', 'workspace_a'), {
    id: 'thesis_persisted',
    workspace_id: 'workspace_a',
    research_run_id: 'run_thesis_persist_only',
    symbol: 'BTC/USDT',
    thesis_text: 'Persisted thesis.',
  });
  journal.events.set(key('run_thesis_persist_only', 'workspace_a'), [
    {
      id: 'event_thesis_saved',
      workspace_id: 'workspace_a',
      research_run_id: 'run_thesis_persist_only',
      event_type: 'trade_thesis_saved',
      created_at: '2026-05-12T00:13:00.000Z',
      message: 'Trade thesis saved for BTC/USDT',
      payload: { thesis_id: 'thesis_persisted' },
    },
  ]);

  const workspace = await researchRuns.workspace(
    'run_thesis_persist_only',
    'user_1',
    'workspace_a',
  );
  const thesisTiming = workspace.stage_timings.find(
    (stage) => stage.stage_key === 'thesis',
  );

  assert.equal(thesisTiming?.event_state, 'missing');
  assert.equal(thesisTiming?.completed_at, null);
  assert.deepEqual(thesisTiming?.source_event_ids, []);
  assert.equal(workspace.thesis?.id, 'thesis_persisted');
});

test('alerts list and read APIs are workspace scoped', async () => {
  const { journal, alerts } = buildHarness();
  journal.alerts.push(
    {
      id: 'alert_1',
      workspace_id: 'workspace_a',
      alert_type: 'scenario_activated',
      symbol: 'SOL/USDT',
      thesis_id: 'thesis_a',
      created_at: '2026-05-12T00:00:00.000Z',
      message: 'Scenario activated',
    },
    {
      id: 'alert_2',
      workspace_id: 'workspace_b',
      alert_type: 'target_zone_reached',
      symbol: 'SOL/USDT',
      thesis_id: 'thesis_b',
      created_at: '2026-05-12T00:00:00.000Z',
      message: 'Target reached',
    },
  );

  const unread = await alerts.list(
    { symbol: 'SOL/USDT', unreadOnly: true },
    'user_1',
    'workspace_a',
  );
  const read = await alerts.markRead('alert_1', 'user_1', 'workspace_a');

  assert.deepEqual(
    unread.map((alert) => alert.id),
    ['alert_1'],
  );
  assert.equal(read.read_at, '2026-05-12T00:00:00.000Z');
  await assert.rejects(
    () => alerts.markRead('alert_2', 'user_1', 'workspace_a'),
    isException(NotFoundException),
  );
});

test('performance analytics, trend, and health use reviewed thesis outcomes', async () => {
  const { journal, performance } = buildHarness();
  journal.outcomeReviews.push(
    {
      id: 'outcome_recent_hit',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_recent_hit',
      symbol: 'BTC/USDT',
      direction: 'long',
      setup_type: 'breakout',
      confidence: 0.72,
      result: 'hit_target',
      lessons: 'Breakout confirmation worked.',
      max_favorable_excursion: 0.18,
      max_adverse_excursion: -0.03,
      reviewed_at: '2026-05-12T00:00:00.000Z',
      thesis_created_at: '2026-05-05T00:00:00.000Z',
      invalidated: false,
    },
    {
      id: 'outcome_recent_miss',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_recent_miss',
      symbol: 'BTC/USDT',
      direction: 'long',
      setup_type: 'breakout',
      confidence: 0.64,
      result: 'invalidated',
      lessons: 'Invalidation was too tight.',
      max_favorable_excursion: 0.02,
      max_adverse_excursion: -0.09,
      reviewed_at: '2026-05-13T00:00:00.000Z',
      thesis_created_at: '2026-05-06T00:00:00.000Z',
      invalidated: true,
    },
    {
      id: 'outcome_other_workspace',
      workspace_id: 'workspace_b',
      thesis_id: 'thesis_b',
      symbol: 'BTC/USDT',
      result: 'hit_target',
      reviewed_at: '2026-05-12T00:00:00.000Z',
      thesis_created_at: '2026-05-04T00:00:00.000Z',
      invalidated: false,
    },
  );

  const analytics = await performance.analytics(
    { symbol: 'BTC/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );
  const trend = await performance.trend(90, 'user_1', 'workspace_a');
  const health = await performance.health(
    { recentDays: 14, baselineDays: 60 },
    'user_1',
    'workspace_a',
  );

  assert.equal(analytics.sample_size, 2);
  assert.equal(analytics.hit_rate, 0.5);
  assert.equal(analytics.invalidation_rate, 0.5);
  assert.ok(analytics.recent_lessons.includes('Breakout confirmation worked.'));
  assert.equal(trend.at(-1)?.sample_size, 2);
  assert.equal(health.overall_status, 'insufficient_data');
});

test('run and thesis comparisons expose material diffs for web UX', async () => {
  const { journal, comparisons } = buildHarness();
  journal.theses.set(key('thesis_left', 'workspace_a'), {
    id: 'thesis_left',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.7,
    thesis_text: 'Long setup',
    invalidation_level: '65000',
    supporting_signal_ids: ['sig_a', 'sig_shared'],
    evidence: { trend: 'up' },
  });
  journal.theses.set(key('thesis_right', 'workspace_a'), {
    id: 'thesis_right',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'short',
    setup_type: 'breakdown',
    confidence: 0.44,
    thesis_text: 'Short setup',
    invalidation_level: '70000',
    supporting_signal_ids: ['sig_b', 'sig_shared'],
    evidence: { trend: 'down' },
  });
  journal.researchRuns.set(key('run_left', 'workspace_a'), {
    id: 'run_left',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    status: 'completed',
    started_at: '2026-05-12T00:00:00.000Z',
    thesis_id: 'thesis_left',
    signal_snapshot_id: 'snap_a',
    signal_ids: ['sig_a'],
  });
  journal.researchRuns.set(key('run_right', 'workspace_a'), {
    id: 'run_right',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    status: 'completed_degraded',
    started_at: '2026-05-13T00:00:00.000Z',
    thesis_id: 'thesis_right',
    signal_snapshot_id: 'snap_b',
    signal_ids: ['sig_b'],
  });

  const thesisDiff = await comparisons.theses(
    'thesis_left',
    'thesis_right',
    'user_1',
    'workspace_a',
  );
  const runDiff = await comparisons.runs(
    'run_left',
    'run_right',
    'user_1',
    'workspace_a',
  );

  assert.equal(thesisDiff.direction_flip, true);
  assert.equal(thesisDiff.change_severity, 'major');
  assert.ok(thesisDiff.changed_fields.includes('supporting_signal_ids'));
  assert.equal(runDiff.thesis_diff?.direction_flip, true);
  assert.ok(runDiff.changed_fields.includes('thesis'));
});

test('scenario monitor combines scenarios with price and alert context', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_monitor', 'workspace_a'), {
    id: 'thesis_monitor',
    workspace_id: 'workspace_a',
    symbol: 'SOL/USDT',
    direction: 'long',
    setup_type: 'trend_pullback',
    confidence: 0.66,
    created_at: '2026-05-12T00:00:00.000Z',
    thesis_text: 'Monitor pullback continuation',
  });
  journal.scenarios.set(key('thesis_monitor', 'workspace_a'), [
    {
      id: 'scenario_monitor',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_monitor',
      probability_band: 'high',
      suggested_user_action: 'watch',
      payload: {
        condition: 'Pullback holds 160',
        expected_behavior: 'Continuation toward 180',
        risk_map: ['funding reversal'],
      },
    },
  ]);
  journal.marketSnapshots.set(key('snap_sol', 'workspace_a'), {
    id: 'snap_sol',
    workspace_id: 'workspace_a',
    symbol: 'SOL/USDT',
    captured_at: '2026-05-14T00:00:00.000Z',
    current_price: 171,
    source: 'test',
  });
  journal.alerts.push({
    id: 'alert_monitor',
    workspace_id: 'workspace_a',
    alert_type: 'scenario_activated',
    symbol: 'SOL/USDT',
    thesis_id: 'thesis_monitor',
    created_at: '2026-05-14T01:00:00.000Z',
    message: 'Scenario activated',
    read_at: null,
  });

  const monitor = await scenarios.monitor(
    { symbol: 'SOL/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.total_scenarios, 1);
  assert.equal(monitor.items[0]?.status, 'alerting');
  assert.equal(monitor.items[0]?.risk_count, 1);
  assert.match(monitor.items[0]?.trigger_summary ?? '', /latest price 171/);
});

test('alert scheduler status and manual run are workspace scoped', async () => {
  const { journal, watchlists } = buildHarness();
  journal.watchlists.push({
    id: 'watch_scheduler',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
    created_at: '2026-05-12T00:00:00.000Z',
  });
  journal.watchlistItems.push({
    id: 'watch_item_scheduler',
    workspace_id: 'workspace_a',
    watchlist_id: 'watch_scheduler',
    item_type: 'thesis',
    thesis_id: 'thesis_scheduler',
    enabled: true,
  });
  journal.theses.set(key('thesis_scheduler', 'workspace_a'), {
    id: 'thesis_scheduler',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    invalidation_level: '65000',
    target_zones: ['70000'],
  });
  journal.marketSnapshots.set(key('snap_btc_scheduler', 'workspace_a'), {
    id: 'snap_btc_scheduler',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T00:00:00.000Z',
    current_price: 70500,
    source: 'test',
  });

  const status = await watchlists.schedulerStatus('user_1', 'workspace_a');
  const result = await watchlists.runWorkspaceAlertPoll('user_1', 'workspace_a');
  const after = await watchlists.schedulerStatus('user_1', 'workspace_a');

  assert.equal(status.workspace_enabled_watchlists, 1);
  assert.equal(result.checked_watchlists, 1);
  assert.equal(result.alerts_created, 1);
  assert.equal(after.last_result?.alerts_created, 1);
});

test('operations health summarizes provider, llm, and freshness telemetry', async () => {
  const { journal, operations } = buildHarness();
  journal.providerHealthRows.push({
    id: 'provider_1',
    provider: 'ccxt',
    component: 'market-data',
    status: 'healthy',
    checked_at: '2026-05-12T00:00:00.000Z',
    latency_ms: 42,
  });
  journal.llmCalls.push(
    {
      id: 'llm_1',
      workspace_id: 'workspace_a',
      provider: 'deepseek',
      model: 'deepseek-chat',
      input_tokens: 100,
      output_tokens: 50,
      latency_ms: 1200,
      status: 'success',
      created_at: '2026-05-12T00:00:00.000Z',
    },
    {
      id: 'llm_2',
      workspace_id: 'workspace_a',
      provider: 'deepseek',
      model: 'deepseek-chat',
      input_tokens: 10,
      output_tokens: 0,
      status: 'error',
      error_type: 'rate_limit',
      created_at: '2026-05-12T00:01:00.000Z',
    },
  );
  journal.freshnessChecks.push({
    id: 'fresh_1',
    workspace_id: 'workspace_a',
    source: 'ohlcv',
    symbol: 'BTC/USDT',
    observed_timestamp: '2026-05-12T00:00:00.000Z',
    age_seconds: 120,
    threshold_seconds: 60,
    status: 'stale',
  });

  const health = await operations.health(20, 'user_1', 'workspace_a');

  assert.equal(health.providers[0]?.status, 'healthy');
  assert.equal(health.llm.total_calls, 2);
  assert.equal(health.llm.success_rate, 0.5);
  assert.equal(health.freshness.stale_checks, 1);
});

test('workbench attention aggregates and prioritizes unresolved operating items', async () => {
  const { journal, workbench } = buildHarness();
  const today = localDateStringForTest(new Date());
  journal.theses.set(key('thesis_attention', 'workspace_a'), {
    id: 'thesis_attention',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    direction: 'long',
    setup_type: 'breakout',
    confidence: 0.82,
    created_at: '2026-05-10T00:00:00.000Z',
    invalidation_level: '65000',
    thesis_text: 'High conviction thesis.',
  });
  journal.scenarios.set(key('thesis_attention', 'workspace_a'), [
    {
      id: 'scenario_attention',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_attention',
      probability_band: 'high',
      suggested_user_action: 'review hedge plan',
      payload: {
        condition: 'Funding reverses while price loses VWAP',
        risk_map: ['crowded long unwind'],
      },
    },
  ]);
  journal.alerts.push({
    id: 'alert_attention',
    workspace_id: 'workspace_a',
    alert_type: 'thesis_invalidated',
    symbol: 'BTC/USDT',
    thesis_id: 'thesis_attention',
    trigger_key: 'invalidated:65000',
    created_at: new Date().toISOString(),
    read_at: null,
    message: 'BTC thesis invalidation level was reached.',
  });
  journal.researchRuns.set(key('run_failed_attention', 'workspace_a'), {
    id: 'run_failed_attention',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'failed',
    started_at: '2026-05-16T00:00:00.000Z',
    completed_at: '2026-05-16T00:02:00.000Z',
    degradation_reasons: ['engine_job_failed'],
  });
  journal.providerHealthRows.push({
    id: 'provider_attention',
    provider: 'ccxt',
    component: 'market-data',
    status: 'degraded',
    checked_at: '2026-05-16T00:00:00.000Z',
    error_message: 'OHLCV latency above threshold.',
  });
  journal.freshnessChecks.push({
    id: 'fresh_attention',
    workspace_id: 'workspace_a',
    source: 'ohlcv',
    symbol: 'BTC/USDT',
    observed_timestamp: '2026-05-16T00:00:00.000Z',
    age_seconds: 600,
    threshold_seconds: 60,
    status: 'stale',
  });
  journal.briefs.push({
    id: 'brief_attention',
    workspace_id: 'workspace_a',
    brief_date: today,
    watchlist_name: 'Core',
    title: 'Market Brief',
    created_at: `${today}T00:00:00.000Z`,
    summary: 'Brief summary.',
    thesis_updates: [
      {
        thesis_id: 'thesis_attention',
        symbol: 'BTC/USDT',
        direction: 'long',
        setup_type: 'breakout',
        confidence: 0.82,
        status: 'review alerts',
        update: 'Review invalidation.',
        invalidation_level: '65000',
        recent_alerts: ['Invalidation level reached.'],
      },
    ],
    top_risks: ['BTC invalidation needs review.'],
  });
  journal.watchlists.push({
    id: 'watch_attention',
    workspace_id: 'workspace_a',
    name: 'Core',
    enabled: true,
    created_at: '2026-05-10T00:00:00.000Z',
  });

  const response = await workbench.attention(10, 'user_1', 'workspace_a');
  const sourceTypes = new Set(response.items.map((item) => item.source_type));
  const alertItem = response.items.find((item) => item.source_id === 'alert_attention');

  assert.equal(response.workspace_id, 'workspace_a');
  assert.ok(response.items.length <= 10);
  assert.ok(response.unresolved_count > 0);
  assert.equal(response.latest_brief?.id, 'brief_attention');
  assert.ok(response.brief_actions.some((item) => item.action.href === '/theses/thesis_attention'));
  assert.equal(response.queues[0]?.priority, 'critical');
  assert.ok(response.queues.some((queue) => queue.priority === 'review'));
  assert.ok(sourceTypes.has('alert'));
  assert.ok(sourceTypes.has('run'));
  assert.ok(sourceTypes.has('provider'));
  assert.ok(sourceTypes.has('thesis'));
  assert.ok(sourceTypes.has('scenario'));
  assert.ok(sourceTypes.has('brief'));
  assert.equal(alertItem?.priority, 'critical');
  assert.equal(alertItem?.action.href, '/theses/thesis_attention');
  assert.deepEqual(
    alertItem?.badges.map((badge) => badge.label),
    ['Severity', 'Age', 'Source'],
  );
  assert.ok(
    response.notifications.some(
      (notification) =>
        notification.type === 'alert' &&
        notification.action.href === '/theses/thesis_attention',
    ),
  );
  assert.ok(
    response.notifications.some(
      (notification) =>
        notification.type === 'watchlist' &&
        notification.action.href === '/watchlists',
    ),
  );
});

test('workbench attention is workspace scoped and capped', async () => {
  const { journal, workbench } = buildHarness();
  for (let index = 0; index < 14; index += 1) {
    journal.alerts.push({
      id: `alert_scope_${index}`,
      workspace_id: 'workspace_a',
      alert_type: 'target_zone_reached',
      symbol: 'SOL/USDT',
      created_at: new Date(Date.now() - index * 60000).toISOString(),
      read_at: null,
      message: `Alert ${index}`,
    });
  }
  journal.alerts.push({
    id: 'alert_other_workspace',
    workspace_id: 'workspace_b',
    alert_type: 'thesis_invalidated',
    symbol: 'BTC/USDT',
    created_at: new Date().toISOString(),
    read_at: null,
    message: 'Other workspace alert',
  });

  const response = await workbench.attention(10, 'user_1', 'workspace_a');

  assert.equal(response.items.length, 10);
  assert.ok(
    response.items.every((item) => item.source_id !== 'alert_other_workspace'),
  );
});

const createResearchRunMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateResearchRunDto,
  data: '',
};

const runThesisPulseMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: RunThesisPulseDto,
  data: '',
};

const runThesisPulseMemoMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: RunThesisPulseMemoDto,
  data: '',
};

const runThesisSchedulerMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: RunThesisSchedulerDto,
  data: '',
};

const patchThesisMonitorPlanMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: PatchThesisMonitorPlanDto,
  data: '',
};

const createEvaluationRerunMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateEvaluationRerunDto,
  data: '',
};

const createResearchRunPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

async function validateCreateResearchRun(
  payload: JsonRecord,
): Promise<CreateResearchRunDto> {
  return (await createResearchRunPipe.transform(
    payload,
    createResearchRunMetadata,
  )) as CreateResearchRunDto;
}

async function validateRunThesisPulse(
  payload: JsonRecord,
): Promise<RunThesisPulseDto> {
  return (await createResearchRunPipe.transform(
    payload,
    runThesisPulseMetadata,
  )) as RunThesisPulseDto;
}

async function validateRunThesisPulseMemo(
  payload: JsonRecord,
): Promise<RunThesisPulseMemoDto> {
  return (await createResearchRunPipe.transform(
    payload,
    runThesisPulseMemoMetadata,
  )) as RunThesisPulseMemoDto;
}

async function validateRunThesisScheduler(
  payload: JsonRecord,
): Promise<RunThesisSchedulerDto> {
  return (await createResearchRunPipe.transform(
    payload,
    runThesisSchedulerMetadata,
  )) as RunThesisSchedulerDto;
}

async function validatePatchThesisMonitorPlan(
  payload: JsonRecord,
): Promise<PatchThesisMonitorPlanDto> {
  return (await createResearchRunPipe.transform(
    payload,
    patchThesisMonitorPlanMetadata,
  )) as PatchThesisMonitorPlanDto;
}

async function validateCreateEvaluationRerun(
  payload: JsonRecord,
): Promise<CreateEvaluationRerunDto> {
  return (await createResearchRunPipe.transform(
    payload,
    createEvaluationRerunMetadata,
  )) as CreateEvaluationRerunDto;
}

function engineRequest(runId: string): EngineRunRequest {
  return {
    run_id: runId,
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    analysis_date: '2026-05-12',
    analysts: ['market'],
    config_profile: 'default',
    exchange: null,
    dry_run: false,
    metadata: {},
  };
}

async function writeEngineScript(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'api-engine-client-'));
  const scriptPath = join(dir, 'engine.js');
  await writeFile(scriptPath, source, 'utf8');
  return scriptPath;
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function waitForJobStatus(
  jobs: JobsService,
  id: string,
  expectedStatus: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await jobs.getJobStatus(id);
    if (status.status === expectedStatus) {
      return status;
    }
    await delay(10);
  }
  const status = await jobs.getJobStatus(id);
  throw new Error(
    `Timed out waiting for job ${id} to reach ${expectedStatus}; current status is ${status.status}`,
  );
}

function buildHarness() {
  const journal = new FakeJournalRepository();
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
    { user_id: 'user_1', workspace_id: 'workspace_b', role: 'owner' },
    { user_id: 'viewer_1', workspace_id: 'workspace_a', role: 'viewer' },
    { user_id: 'editor_1', workspace_id: 'workspace_a', role: 'editor' },
  ]);
  const jobs = new JobsService({
    runInline: async (request: EngineRunRequest) => ({
      status: 'completed',
      run_id: request.run_id,
    }),
  } as unknown as PythonEngineClient);
  const evaluationEngineCalls: JsonRecord[] = [];
  const thesisEngine = {
    monitorPlan: async (request: JsonRecord) => {
      const thesisId = String(request.thesis_id);
      const workspaceId = String(request.workspace_id ?? 'local');
      const existing = journal.monitorPlans.get(key(thesisId, workspaceId));
      const plan = {
        id: 'plan_1',
        workspace_id: workspaceId,
        thesis_id: thesisId,
        baseline_run_id: 'run_1',
        symbol: 'BTC/USDT',
        market_type: 'spot',
        status: 'active',
        created_at: '2026-05-12T00:00:00.000Z',
        updated_at: '2026-05-12T00:00:00.000Z',
        baseline_price: 100000,
        baseline_price_source: 'test',
        baseline_observed_at: '2026-05-12T00:00:00.000Z',
        entry_low: 99000,
        entry_high: 101000,
        invalidation_level: 95000,
        invalidation_direction: 'below',
        targets: [{ label: 'target_1', price: 110000 }],
        scenario_triggers: [],
        missing_fields: [],
        price_interval_minutes: 5,
        signal_interval_minutes: 15,
        memo_interval_minutes: 240,
        watch_distance_pct: 5,
        review_distance_pct: 2,
        consecutive_review_to_rerun: 3,
        consecutive_invalidation_to_rerun: 2,
        enabled_signal_factors: ['regime'],
        scheduler_enabled: false,
        latest_pulse_id: null,
        latest_memo_id: null,
        latest_status: null,
        latest_price: null,
        latest_trigger_reasons: [],
        last_pulse_at: null,
        next_pulse_due_at: null,
        last_memo_at: null,
        next_memo_due_at: null,
        ...(existing ?? {}),
        ...(request.updates as JsonRecord | undefined),
      };
      journal.monitorPlans.set(key(thesisId, workspaceId), plan);
      return {
        thesis_id: thesisId,
        workspace_id: workspaceId,
        monitor_plan_id: plan.id,
        status: plan.status,
        monitor_plan: plan,
      };
    },
    runPulse: async (request: JsonRecord) => {
      const thesisId = String(request.thesis_id);
      const workspaceId = String(request.workspace_id ?? 'local');
      const observedAt = String(
        request.observed_at ?? '2026-05-12T00:01:00.000Z',
      );
      const pulse = {
        id: 'pulse_1',
        workspace_id: workspaceId,
        thesis_id: thesisId,
        monitor_plan_id: 'plan_1',
        baseline_run_id: 'run_1',
        symbol: 'BTC/USDT',
        market_type: 'spot',
        pulse_type: 'manual',
        bucket_start: '2026-05-12T00:00:00.000Z',
        observed_at: observedAt,
        current_price: 103000,
        baseline_price: 100000,
        price_change_pct: 3,
        distance_to_invalidation_pct: 7.8,
        nearest_target: 110000,
        distance_to_nearest_target_pct: 6.8,
        signal_bias: 'bullish',
        signal_confidence: 0.64,
        signal_delta: 0.02,
        scenario_status: 'none',
        score: 42,
        status: 'watch',
        suggested_action: 'inspect_chart',
        trigger_reasons: ['price_near_target_watch_band'],
        hard_triggers: [],
        missing_data: [],
        payload: {},
      };
      const current = journal.thesisPulses.get(key(thesisId, workspaceId)) ?? [];
      journal.thesisPulses.set(key(thesisId, workspaceId), [...current, pulse]);
      const plan = journal.monitorPlans.get(key(thesisId, workspaceId)) ?? {
        id: 'plan_1',
        workspace_id: workspaceId,
        thesis_id: thesisId,
      };
      plan.latest_pulse_id = pulse.id;
      plan.latest_status = pulse.status;
      plan.latest_price = pulse.current_price;
      plan.latest_trigger_reasons = pulse.trigger_reasons;
      plan.last_pulse_at = observedAt;
      plan.next_pulse_due_at = addMinutesIso(
        observedAt,
        Number(plan.price_interval_minutes ?? 5),
      );
      journal.monitorPlans.set(key(thesisId, workspaceId), plan);
      return { created: true, pulse, ...pulse };
    },
    runPulseMemo: async (request: JsonRecord) => {
      const thesisId = String(request.thesis_id);
      const workspaceId = String(request.workspace_id ?? 'local');
      const pulses = journal.thesisPulses.get(key(thesisId, workspaceId)) ?? [];
      if (pulses.length === 0) {
        return {
          thesis_id: thesisId,
          workspace_id: workspaceId,
          status: 'skipped',
          created: false,
          skipped: true,
          skip_reason: 'no_pulses',
        };
      }
      const memo = {
        id: 'memo_1',
        workspace_id: workspaceId,
        thesis_id: thesisId,
        monitor_plan_id: 'plan_1',
        baseline_run_id: 'run_1',
        memo_type: 'manual',
        window_start: '2026-05-12T00:00:00.000Z',
        window_end: '2026-05-12T04:00:00.000Z',
        created_at: '2026-05-12T00:03:00.000Z',
        status: 'watch',
        summary: 'Pulse memo summary.',
        what_changed: ['price_near_target_watch_band'],
        why_it_matters: ['Closer to target review band.'],
        what_to_watch_next: ['Watch invalidation distance.'],
        recommended_action: 'inspect_chart',
        rerun_full_recommended: false,
        confidence: 0.72,
        referenced_pulse_ids: pulses
          .map((pulse) => String(pulse.id ?? ''))
          .filter(Boolean),
        prompt_version: 'pulse_memo.v1',
        provider: 'fake_llm',
        model: 'fake-memo-v1',
        payload: {},
      };
      journal.thesisPulseMemos.set(key(thesisId, workspaceId), [memo]);
      const plan = journal.monitorPlans.get(key(thesisId, workspaceId)) ?? {
        id: 'plan_1',
        workspace_id: workspaceId,
        thesis_id: thesisId,
      };
      plan.latest_memo_id = memo.id;
      plan.last_memo_at = memo.created_at;
      plan.next_memo_due_at = addMinutesIso(
        memo.created_at,
        Number(plan.memo_interval_minutes ?? 240),
      );
      journal.monitorPlans.set(key(thesisId, workspaceId), plan);
      return { created: true, skipped: false, memo, ...memo };
    },
    evaluateThesis: async (request: JsonRecord) => {
      evaluationEngineCalls.push(request);
      const thesisId = String(request.thesis_id);
      const workspaceId = String(request.workspace_id ?? 'local');
      const windowDays = Number(request.window_days ?? 14);
      if (thesisId.includes('provider_fail')) {
        return {
          workspace_id: workspaceId,
          thesis_id: thesisId,
          evaluation_id: null,
          status: 'failed',
          evaluation: null,
          warnings: [],
          error_type: 'ProviderError',
          error: 'Provider returned no candles',
        };
      }
      const thesis = journal.theses.get(key(thesisId, workspaceId));
      const start = String(thesis?.created_at ?? '2026-05-01T00:00:00.000Z').slice(
        0,
        10,
      );
      const end = addDaysIsoDate(start, windowDays);
      const result = thesisId.includes('unknown') ? 'unknown' : 'hit_target';
      const evaluation = {
        id: `evaluation_${thesisId}_${windowDays}`,
        workspace_id: workspaceId,
        thesis_id: thesisId,
        symbol: String(thesis?.symbol ?? 'BTC/USDT'),
        window_days: windowDays,
        evaluation_start: start,
        evaluation_end: end,
        evaluated_at: '2026-05-12T00:00:00.000Z',
        result,
        max_favorable_excursion: 0.12,
        max_adverse_excursion: -0.04,
        invalidated: false,
        warnings: end > '2026-05-12' ? ['incomplete_window'] : [],
        evidence: {
          candle_count: 336,
          first_candle_at: `${start}T00:00:00.000Z`,
          last_candle_at: `${end}T00:00:00.000Z`,
          highest_high: 112,
          lowest_low: 96,
          start_price: 100,
          end_price: 112,
          target_hit: result === 'hit_target',
          invalidation_hit: false,
        },
      };
      return {
        workspace_id: workspaceId,
        thesis_id: thesisId,
        evaluation_id: evaluation.id,
        status: 'completed',
        evaluation,
        warnings: evaluation.warnings,
        error_type: null,
        error: null,
      };
    },
  } as unknown as PythonEngineClient;
  const marketPriceCalls: Array<{
    overrides: Record<string, number>;
    symbol: string;
    workspaceId: string;
  }> = [];
  const marketPrices = {
    resolveFreshPrice: async (
      symbol: string,
      workspaceId: string,
      overrides: Record<string, number>,
    ) => {
      marketPriceCalls.push({ overrides, symbol, workspaceId });
      const override =
        overrides[symbol] ?? overrides[symbol.replace('/', '')] ?? null;
      if (Number.isFinite(override)) {
        return { symbol, price: override, source: 'override' as const };
      }
      const snapshot = await journal.getLatestMarketSnapshot(symbol, workspaceId);
      const price = Number(snapshot?.current_price);
      return {
        symbol,
        price: Number.isFinite(price) ? price : null,
        source: Number.isFinite(price) ? ('snapshot' as const) : ('missing' as const),
        snapshot: snapshot ?? undefined,
      };
    },
  } as unknown as MarketPriceService;
  const researchRuns = new ResearchRunsService(journal, jobs, auth, workspaces);
  const researchContinuity = new ResearchContinuityService(
    journal,
    auth,
    workspaces,
  );
  const watchlists = new WatchlistsService(journal, auth, workspaces, marketPrices);
  const monitoringJobs = new MonitoringJobsService(journal, thesisEngine);
  return {
    journal,
    evaluationEngineCalls,
    jobs,
    marketPriceCalls,
    researchRuns,
    researchContinuity,
    researchContinuityController: new ResearchContinuityController(
      researchContinuity,
    ),
    researchRunsController: new ResearchRunsController(
      researchRuns,
      researchContinuity,
    ),
    jobsController: new JobsController(jobs, auth, workspaces),
    signals: new SignalsService(journal, auth, workspaces),
    theses: new ThesesService(
      journal,
      auth,
      workspaces,
      thesisEngine,
      undefined,
      monitoringJobs,
      marketPrices,
    ),
    monitoringJobs,
    watchlists,
    briefs: new BriefsService(journal, auth, workspaces),
    alerts: new AlertsService(journal, auth, workspaces),
    calibration: new CalibrationService(
      journal,
      auth,
      workspaces,
      thesisEngine,
    ),
    performance: new PerformanceService(journal, auth, workspaces),
    comparisons: new ComparisonsService(journal, auth, workspaces),
    scenarios: new ScenariosService(journal, auth, workspaces),
    operations: new OperationsService(journal, auth, workspaces),
    workbench: new WorkbenchService(journal, auth, workspaces),
  };
}

function buildMarketDataHarness() {
  const auth = new AuthService();
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  const ohlcv = new MarketOhlcvService();
  return {
    marketData: new MarketDataController(ohlcv, auth, workspaces),
    ohlcv,
  };
}

function key(id: string, workspaceId: string): string {
  return `${workspaceId}:${id}`;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function continuityEntryPayload(entry: JsonRecord): JsonRecord {
  const payload = record(entry.payload ?? entry.payload_json);
  const nestedPayload = record(payload.payload);
  return hasContinuityEntryMetadata(nestedPayload) ? nestedPayload : payload;
}

function continuityEntryRepairMetadata(entry: JsonRecord): JsonRecord {
  return record(continuityEntryPayload(entry).repair);
}

function hasContinuityEntryMetadata(payload: JsonRecord): boolean {
  return (
    payload.schema_version !== undefined ||
    payload.evidence_contract_version !== undefined ||
    payload.repair !== undefined ||
    payload.skip_reason !== undefined
  );
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function postgresContinuityEntryShape(entry: JsonRecord): JsonRecord {
  return {
    ...entry,
    sections_json: entry.sections ?? [],
    events_json: entry.events ?? [],
    snapshot_quality_json: entry.snapshot_quality ?? {},
    source_run_ids_json: entry.source_run_ids ?? [],
    writer_metadata_json: entry.writer_metadata ?? {},
    payload: { ...entry },
  };
}

function numberValue(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function legacyItemKey(type: string, text: string): string {
  return `${type}:${createHash('sha1')
    .update(text.trim().toLowerCase().replace(/\s+/g, ' '))
    .digest('hex')
    .slice(0, 12)}`;
}

function seedContinuityRun(
  journal: FakeJournalRepository,
  options: {
    runId: string;
    thesisId: string;
    debateId: string;
    marketSnapshotId: string;
    signalSnapshotId: string;
    stance: string;
    thesisDirection: string;
    risks?: string[];
    monitorNext?: string[];
    currentPrice?: number;
    workspaceId?: string;
  },
) {
  const workspaceId = options.workspaceId ?? 'workspace_a';
  const createdAt = options.runId.endsWith('2')
    ? '2026-05-13T00:00:00.000Z'
    : '2026-05-12T00:00:00.000Z';
  journal.researchRuns.set(key(options.runId, workspaceId), {
    id: options.runId,
    workspace_id: workspaceId,
    symbol: 'BTC/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    status: 'completed',
    started_at: createdAt,
    completed_at: createdAt,
    market_snapshot_id: options.marketSnapshotId,
    signal_snapshot_id: options.signalSnapshotId,
    debate_id: options.debateId,
    thesis_id: options.thesisId,
    degradation_reasons: [],
    missing_core_data: [],
    missing_optional_data: [],
  });
  journal.marketSnapshots.set(key(options.marketSnapshotId, workspaceId), {
    id: options.marketSnapshotId,
    workspace_id: workspaceId,
    research_run_id: options.runId,
    symbol: 'BTC/USDT',
    captured_at: createdAt,
    current_price: options.currentPrice ?? 100000,
    source: 'test',
  });
  journal.signalSnapshots.set(key(options.signalSnapshotId, workspaceId), {
    id: options.signalSnapshotId,
    workspace_id: workspaceId,
    research_run_id: options.runId,
    symbol: 'BTC/USDT',
    captured_at: createdAt,
    signal_count: 3,
    bullish_count: options.thesisDirection === 'long' ? 2 : 1,
    bearish_count: options.thesisDirection === 'short' ? 2 : 1,
    neutral_count: options.thesisDirection === 'neutral' ? 2 : 0,
    stale_count: 0,
    unknown_freshness_count: 0,
  });
  journal.debates.set(key(options.debateId, workspaceId), {
    id: options.debateId,
    workspace_id: workspaceId,
    research_run_id: options.runId,
    symbol: 'BTC/USDT',
    consensus_stance: options.stance,
    conflict_level: 'medium',
    created_at: createdAt,
  });
  journal.agentOpinions.set(key(options.debateId, workspaceId), [
    {
      id: `op_${options.runId}`,
      workspace_id: workspaceId,
      debate_id: options.debateId,
      research_run_id: options.runId,
      agent_name: 'market_analyst',
      agent_role: 'analyst',
      stance: options.stance,
      confidence: 0.68,
      payload: {
        risks: options.risks ?? [],
        invalidation: 'Break back below the reclaimed range.',
      },
    },
  ]);
  journal.theses.set(key(options.thesisId, workspaceId), {
    id: options.thesisId,
    workspace_id: workspaceId,
    research_run_id: options.runId,
    symbol: 'BTC/USDT',
    direction: options.thesisDirection,
    setup_type: 'daily_research',
    confidence: 0.66,
    created_at: createdAt,
    risks: options.risks ?? [],
    monitor_next: options.monitorNext ?? [],
    summary: {
      direction: options.thesisDirection,
      confidence: 0.66,
      risks: options.risks ?? [],
      key_reasons: ['Market structure remains the main driver.'],
      missing_data: [],
      data_quality_label: 'good',
      data_quality: 0.8,
    },
    payload: {
      structured_summary: {
        direction: options.thesisDirection,
        confidence: 0.66,
      },
    },
  });
}

function addMinutesIso(value: string, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function addDaysIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function symbolCalibrationPeriod(
  windowDays: number,
  lookbackDays: number,
): { today: string; periodStart: string; periodEnd: string } {
  const today = new Date().toISOString().slice(0, 10);
  const periodEnd = addDaysIsoDate(today, -(windowDays + 1));
  return {
    today,
    periodStart: addDaysIsoDate(periodEnd, -(lookbackDays - 1)),
    periodEnd,
  };
}

function completedRerunFixture(options: {
  id: string;
  canonicalEvaluationId: string;
  thesisId: string;
  status?: 'completed' | 'failed';
  result?: string | null;
  maxFavorableExcursion?: number | null;
  maxAdverseExcursion?: number | null;
  evidence?: JsonRecord;
  workspaceId?: string;
}): JsonRecord & {
  id: string;
  canonical_evaluation_id: string;
  evidence: JsonRecord;
  result: string | null;
} {
  const workspaceId = options.workspaceId ?? 'workspace_a';
  const result = options.result === undefined ? 'hit_target' : options.result;
  return {
    id: options.id,
    workspace_id: workspaceId,
    canonical_evaluation_id: options.canonicalEvaluationId,
    thesis_id: options.thesisId,
    symbol: 'BTC/USDT',
    window_days: 7,
    evaluation_start: '2026-05-01',
    evaluation_end: '2026-05-08',
    requested_by_user_id: 'user_1',
    requested_at: '2026-05-23T08:00:00.000Z',
    evaluated_at:
      options.status === 'failed' ? null : '2026-05-23T08:00:03.000Z',
    source: 'calibration_lab_v1_3_rerun',
    reason: 'manual_check',
    notes: null,
    idempotency_key: null,
    status: options.status ?? 'completed',
    result,
    max_favorable_excursion: options.maxFavorableExcursion ?? 0.052,
    max_adverse_excursion: options.maxAdverseExcursion ?? -0.013,
    invalidated: result === 'invalidated',
    warnings: [],
    evidence: options.evidence ?? { start_price: 100, end_price: 112 },
    diff: {},
    error_type: options.status === 'failed' ? 'ProviderError' : null,
    error_message:
      options.status === 'failed' ? 'Provider returned no candles' : null,
    payload: {},
  };
}

function seedAgentCalibrationOpinion(
  journal: FakeJournalRepository,
  options: {
    id: string;
    agentRole: string;
    agentName?: string;
    confidence?: number | null;
    createdDate: string;
    direction?: string;
    evaluationResult?: string;
    linkViaResearchRunThesis?: boolean;
    stance: string;
    symbol?: string;
    thesisId: string | null;
    workspaceId?: string;
  },
) {
  const workspaceId = options.workspaceId ?? 'workspace_a';
  const symbol = options.symbol ?? 'BTC/USDT';
  const runId = `run_${options.id}`;
  const debateId = `debate_${options.id}`;
  const createdAt = `${options.createdDate}T12:00:00.000Z`;
  const thesisId = options.thesisId;
  const linkViaResearchRunThesis = options.linkViaResearchRunThesis !== false;

  journal.researchRuns.set(key(runId, workspaceId), {
    id: runId,
    run_id: runId,
    workspace_id: workspaceId,
    symbol,
    status: 'completed',
    started_at: createdAt,
    completed_at: createdAt,
    thesis_id: linkViaResearchRunThesis ? thesisId : null,
  });
  journal.debates.set(key(debateId, workspaceId), {
    id: debateId,
    workspace_id: workspaceId,
    research_run_id: runId,
    symbol,
    created_at: createdAt,
  });

  if (thesisId) {
    journal.theses.set(key(thesisId, workspaceId), {
      id: thesisId,
      workspace_id: workspaceId,
      research_run_id: runId,
      symbol,
      direction: options.direction ?? 'long',
      confidence: 0.64,
      created_at: `${options.createdDate}T00:00:00.000Z`,
    });
    if (options.evaluationResult) {
      journal.thesisEvaluations.set(
        key(`evaluation_${options.id}`, workspaceId),
        {
          id: `evaluation_${options.id}`,
          workspace_id: workspaceId,
          thesis_id: thesisId,
          outcome_review_id: null,
          symbol,
          window_days: 7,
          evaluation_start: options.createdDate,
          evaluation_end: addDaysIsoDate(options.createdDate, 7),
          evaluated_at: '2026-05-12T00:00:00.000Z',
          result: options.evaluationResult,
          max_favorable_excursion: 0.05,
          max_adverse_excursion: -0.02,
          invalidated: options.evaluationResult === 'invalidated',
          warnings: [],
          evidence: { start_price: 100, end_price: 105 },
        },
      );
    }
  }

  const opinions = journal.agentOpinions.get(key(debateId, workspaceId)) ?? [];
  opinions.push({
    id: options.id,
    workspace_id: workspaceId,
    debate_id: debateId,
    research_run_id: runId,
    agent_name: options.agentName ?? options.agentRole,
    agent_role: options.agentRole,
    stance: options.stance,
    confidence: options.confidence ?? null,
    created_at: createdAt,
  });
  journal.agentOpinions.set(key(debateId, workspaceId), opinions);
}

function seedAgentCalibrationRoleOutcomes(
  journal: FakeJournalRepository,
  options: {
    role: string;
    createdDate: string;
    direction?: string;
    outcomes: string[];
    stance?: string;
  },
) {
  options.outcomes.forEach((result, index) => {
    seedAgentCalibrationOpinion(journal, {
      id: `op_${options.role}_${index}`,
      agentRole: options.role,
      agentName: `${options.role} analyst`,
      stance: options.stance ?? 'bullish',
      confidence: 0.7,
      thesisId: `thesis_${options.role}_${index}`,
      direction: options.direction ?? 'long',
      createdDate: addDaysIsoDate(options.createdDate, -index),
      evaluationResult: result,
    });
  });
}

function normalizeOptionalCryptoSymbolForTest(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? normalizeCryptoSymbolForTest(value)
    : undefined;
}

function normalizeCryptoSymbolForTest(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (upper.includes('/')) {
    return upper;
  }
  for (const delimiter of ['-', '_', ':']) {
    if (upper.includes(delimiter)) {
      const [base, quote] = upper.split(delimiter, 2);
      if (base && quote) {
        return `${base}/${quote === 'USD' ? 'USDT' : quote}`;
      }
    }
  }
  for (const quote of ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH']) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return `${upper.slice(0, -quote.length)}/${quote === 'USD' ? 'USDT' : quote}`;
    }
  }
  return `${upper}/USDT`;
}

function appendUniqueString(value: unknown, item: string): string[] {
  const current = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return current.includes(item) ? current : [...current, item];
}

function normalizeSqliteFixture(row: JsonRecord): JsonRecord {
  const normalized: JsonRecord = {};
  for (const [name, value] of Object.entries(row)) {
    normalized[name] = name.endsWith('_json') ? parseJsonFixture(value) : value;
  }
  const payload = parseJsonFixture(normalized.payload_json);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    Object.assign(normalized, payload, { ...normalized, payload });
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (name.endsWith('_json') && name !== 'payload_json') {
      normalized[name.slice(0, -5)] = value;
    }
  }
  return normalized;
}

function parseJsonFixture(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function localDateStringForTest(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isException(
  exceptionType: new (...args: string[]) => Error,
): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof exceptionType;
}
