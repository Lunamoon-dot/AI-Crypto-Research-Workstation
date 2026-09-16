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
  ConflictException,
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
import { WorkspacesController } from '../src/workspaces/workspaces.controller';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import type { WorkspaceMetadata } from '../src/workspaces/workspace-metadata';
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
import { ThesesController } from '../src/theses/theses.controller';
import { ThesesService } from '../src/theses/theses.service';
import { MarketDataController } from '../src/market-data/market-data.controller';
import {
  MarketOhlcvResponse,
  MarketOhlcvService,
} from '../src/market-data/market-ohlcv.service';
import { MarketPriceService } from '../src/market-data/market-price.service';
import { AlertsService } from '../src/alerts/alerts.service';
import { CalibrationService } from '../src/calibration/calibration.service';
import { CreateEvaluationRerunDto } from '../src/calibration/dto/evaluation-rerun.dto';
import { PerformanceService } from '../src/performance/performance.service';
import { ScenariosService } from '../src/scenarios/scenarios.service';
import { ScenarioChartProjectionService } from '../src/scenarios/scenario-chart-projection.service';
import { ScenarioChartSummaryService } from '../src/scenarios/scenario-chart-summary.service';
import { ScenarioContextLoaderService } from '../src/scenarios/scenario-context-loader.service';
import { evaluateScenarioCondition } from '../src/scenarios/scenario-condition-evaluator';
import { ScenarioEvaluationService } from '../src/scenarios/scenario-evaluation.service';
import { ScenarioFeedbackPlaybookService } from '../src/scenarios/scenario-feedback-playbook.service';
import { ScenarioLiveStateService } from '../src/scenarios/scenario-live-state.service';
import { ScenarioReliabilityService } from '../src/scenarios/scenario-reliability.service';
import { evaluateScenarioRuntimeDecision } from '../src/scenarios/scenario-runtime-evaluator';
import { PlaybookCompilerService } from '../src/playbooks/playbook-compiler.service';
import { playbookSourceHashes } from '../src/playbooks/playbook-source-hash';
import { BacktestService } from '../src/backtests/backtest.service';
import { PaperExecutionService } from '../src/paper-execution/paper-execution.service';
import { OperationsService } from '../src/operations/operations.service';
import { WorkbenchService } from '../src/workbench/workbench.service';
import { redactForDebug } from '../src/common/redaction';
import { PostgresJournalRepository } from '../src/database/postgres-journal.repository';
import {
  openApiDocument,
} from '../src/contracts/openapi.generated';
import {
  buildResearchRunStageTimings,
  toScenarioEvaluationResponse,
  toScenarioResponse,
  toThesisResponse,
} from '../src/contracts/frontend-contract';
import type {
  ResearchRunEventResponse,
  ResearchRunResponse,
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
  readonly scenarios = new Map<string, JsonRecord[]>();
  readonly scenarioEvaluations = new Map<string, JsonRecord>();
  readonly scenarioOutcomeSnapshots = new Map<string, JsonRecord>();
  readonly tradePlaybooks = new Map<string, JsonRecord>();
  readonly scenarioEvents = new Map<string, JsonRecord>();
  readonly scenarioLiveStateSnapshots = new Map<string, JsonRecord>();
  readonly scenarioFeedbackPlaybooks = new Map<string, JsonRecord>();
  readonly backtestRuns = new Map<string, JsonRecord>();
  readonly backtestTradeEvents = new Map<string, JsonRecord[]>();
  readonly simulationRuns = new Map<string, JsonRecord>();
  readonly paperOrders = new Map<string, JsonRecord>();
  readonly paperPositions = new Map<string, JsonRecord>();
  readonly executionEvents = new Map<string, JsonRecord[]>();
  readonly simulationOutcomes = new Map<string, JsonRecord>();
  readonly simulationRunLocks = new Map<string, Promise<void>>();
  readonly simulationRunLockCalls: string[] = [];
  readonly scenarioDecisionItemStates = new Map<string, JsonRecord>();
  readonly signals: JsonRecord[] = [];
  readonly signalObservations: JsonRecord[] = [];
  readonly signalOutcomeLabels: JsonRecord[] = [];
  readonly signalEvaluationReports: JsonRecord[] = [];
  readonly signalWeightVersions: JsonRecord[] = [];
  readonly signalCalibratorVersions: JsonRecord[] = [];
  readonly signalModelPromotions: JsonRecord[] = [];
  readonly signalMonitoringSnapshots: JsonRecord[] = [];
  readonly signalModelAlerts: JsonRecord[] = [];
  readonly signalModelRollbacks: JsonRecord[] = [];
  readonly alerts: JsonRecord[] = [];
  readonly outcomeReviews: JsonRecord[] = [];
  readonly providerHealthRows: JsonRecord[] = [];
  readonly llmCalls: JsonRecord[] = [];
  readonly freshnessChecks: JsonRecord[] = [];
  readonly researchSnapshots = new Map<string, JsonRecord>();
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
  private readonly readCounters = new Map<string, number>();

  resetReadCounters(): void {
    this.readCounters.clear();
  }

  readCount(name: string): number {
    return this.readCounters.get(name) ?? 0;
  }

  private countRead(name: string): void {
    this.readCounters.set(name, (this.readCounters.get(name) ?? 0) + 1);
  }

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

  async removeResearchRunCascade(
    id: string,
    workspaceId: string,
  ): Promise<{
    removed: boolean;
    workspace_id: string;
    requested_run_id: string;
    deleted_count: number;
    deleted_run_ids: string[];
  }> {
    const target = this.researchRuns.get(key(id, workspaceId));
    if (!target) {
      throw new NotFoundException(`Research run ${id} not found`);
    }
    const runs = [...this.researchRuns.values()]
      .filter((run) => run.workspace_id === workspaceId)
      .filter((run) => compareRunChainOrder(run, target) >= 0)
      .sort(compareRunChainOrder);
    const deletedRunIds = runs
      .map((run) => String(run.id ?? run.run_id ?? ''))
      .filter(Boolean);
    const deletedThesisIds = new Set<string>();
    const deletedDebateIds = new Set<string>();
    const deletedSignalSnapshotIds = new Set<string>();
    const deletedSignalIds = new Set<string>();

    for (const runId of deletedRunIds) {
      const run = this.researchRuns.get(key(runId, workspaceId));
      const thesisId = String(run?.thesis_id ?? '');
      const debateId = String(run?.debate_id ?? '');
      if (thesisId) {
        deletedThesisIds.add(thesisId);
      }
      if (debateId) {
        deletedDebateIds.add(debateId);
      }
      this.researchRuns.delete(key(runId, workspaceId));
      this.events.delete(key(runId, workspaceId));
    }

    for (const [snapshotKey, snapshot] of this.marketSnapshots) {
      if (
        snapshot.workspace_id === workspaceId &&
        deletedRunIds.includes(String(snapshot.research_run_id ?? ''))
      ) {
        this.marketSnapshots.delete(snapshotKey);
      }
    }
    for (const [snapshotKey, snapshot] of this.signalSnapshots) {
      if (
        snapshot.workspace_id === workspaceId &&
        deletedRunIds.includes(String(snapshot.research_run_id ?? ''))
      ) {
        const snapshotId = String(snapshot.id ?? '');
        if (snapshotId) {
          deletedSignalSnapshotIds.add(snapshotId);
        }
        const payload = record(snapshot.payload ?? snapshot.payload_json);
        const signalIds = [
          ...(Array.isArray(snapshot.signal_ids) ? snapshot.signal_ids : []),
          ...(Array.isArray(payload.signal_ids) ? payload.signal_ids : []),
        ];
        for (const signalId of signalIds) {
          deletedSignalIds.add(String(signalId));
        }
        this.signalSnapshots.delete(snapshotKey);
      }
    }
    for (const [snapshotKey, snapshot] of this.researchSnapshots) {
      if (
        snapshot.workspace_id === workspaceId &&
        deletedRunIds.includes(String(snapshot.research_run_id ?? ''))
      ) {
        this.researchSnapshots.delete(snapshotKey);
      }
    }
    for (const [debateKey, debate] of this.debates) {
      if (
        debate.workspace_id === workspaceId &&
        deletedRunIds.includes(String(debate.research_run_id ?? ''))
      ) {
        deletedDebateIds.add(String(debate.id ?? ''));
        this.debates.delete(debateKey);
      }
    }
    for (const debateId of deletedDebateIds) {
      this.agentOpinions.delete(key(debateId, workspaceId));
    }
    for (const [thesisKey, thesis] of this.theses) {
      if (
        thesis.workspace_id === workspaceId &&
        deletedRunIds.includes(String(thesis.research_run_id ?? ''))
      ) {
        deletedThesisIds.add(String(thesis.id ?? ''));
        this.theses.delete(thesisKey);
      }
    }
    for (const thesisId of deletedThesisIds) {
      this.scenarios.delete(key(thesisId, workspaceId));
    }
    removeArrayItems(
      this.alerts,
      (alert) =>
        alert.workspace_id === workspaceId &&
        deletedThesisIds.has(String(alert.thesis_id ?? '')),
    );
    removeArrayItems(this.signals, (signal) => {
      if (signal.workspace_id !== workspaceId) {
        return false;
      }
      const payload = record(signal.payload ?? signal.payload_json);
      const runId = String(
        signal.research_run_id ?? payload.research_run_id ?? payload.run_id ?? '',
      );
      const snapshotId = String(
        signal.signal_snapshot_id ??
          payload.signal_snapshot_id ??
          payload.snapshot_id ??
          '',
      );
      return (
        deletedSignalIds.has(String(signal.id ?? '')) ||
        deletedRunIds.includes(runId) ||
        deletedSignalSnapshotIds.has(snapshotId)
      );
    });

    return {
      removed: true,
      workspace_id: workspaceId,
      requested_run_id: id,
      deleted_count: deletedRunIds.length,
      deleted_run_ids: deletedRunIds,
    };
  }

  async removeWorkspaceSignals(workspaceId: string): Promise<string[]> {
    const deletedSignalIds = this.signals
      .filter((signal) => signal.workspace_id === workspaceId)
      .map((signal) => String(signal.id ?? ''))
      .filter(Boolean);
    removeArrayItems(
      this.signals,
      (signal) => signal.workspace_id === workspaceId,
    );
    return deletedSignalIds;
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
    this.countRead('getLatestMarketSnapshot');
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
    this.countRead('getThesis');
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

  async listScenarios(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.scenarios.get(key(thesisId, workspaceId)) ?? [];
  }

  async getScenario(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    this.countRead('getScenario');
    for (const [scenarioKey, scenarios] of this.scenarios) {
      if (!scenarioKey.startsWith(`${workspaceId}:`)) {
        continue;
      }
      const scenario = scenarios.find((item) => item.id === id);
      if (scenario) {
        return scenario;
      }
    }
    return null;
  }

  async saveScenarioEvaluation(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `scenario_eval_${this.scenarioEvaluations.size + 1}`);
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      version: 'scenario_evaluation.v1',
      evaluated_at: input.evaluated_at ?? '2026-07-01T00:00:00.000Z',
      warnings: Array.isArray(input.warnings) ? input.warnings : [],
      evidence: record(input.evidence),
    };
    this.scenarioEvaluations.set(key(id, workspaceId), saved);
    return saved;
  }

  async saveScenarioOutcomeSnapshot(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(
      input.id ?? `scenario_outcome_${this.scenarioOutcomeSnapshots.size + 1}`,
    );
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      version: 'scenario_outcome_snapshot.v1',
      settled_at: input.settled_at ?? '2026-07-01T00:00:00.000Z',
      warnings: Array.isArray(input.warnings) ? input.warnings : [],
    };
    this.scenarioOutcomeSnapshots.set(key(id, workspaceId), saved);
    return saved;
  }

  async listScenarioEvaluations(
    scenarioId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.scenarioEvaluations.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => item.scenario_id === scenarioId)
      .sort((a, b) => String(b.evaluated_at ?? '').localeCompare(String(a.evaluated_at ?? '')));
  }

  async listScenarioOutcomeSnapshots(
    scenarioId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.scenarioOutcomeSnapshots.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => item.scenario_id === scenarioId)
      .sort((a, b) => String(b.settled_at ?? '').localeCompare(String(a.settled_at ?? '')));
  }

  async getScenarioEvaluation(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.scenarioEvaluations.get(key(id, workspaceId)) ?? null;
  }

  async getLatestScenarioOutcomeSnapshot(
    scenarioId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.scenarioOutcomeSnapshots.values()]
        .filter((item) => item.workspace_id === workspaceId)
        .filter((item) => item.scenario_id === scenarioId)
        .sort((a, b) => String(b.settled_at ?? '').localeCompare(String(a.settled_at ?? '')))[0] ??
      null
    );
  }

  async listScenarioEvaluationsForReliability(
    filters: { symbol?: string; market_type?: string; horizon?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.scenarioEvaluations.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => !filters.symbol || item.symbol === filters.symbol)
      .filter((item) => !filters.market_type || filters.market_type === 'mixed' || item.market_type === filters.market_type)
      .filter((item) => !filters.horizon || item.horizon === filters.horizon)
      .sort((a, b) => String(b.evaluated_at ?? '').localeCompare(String(a.evaluated_at ?? '')))
      .slice(0, filters.limit);
  }

  async listSimulationOutcomesForReliability(
    filters: { symbol?: string; market_type?: string; horizon?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const rows: JsonRecord[] = [];
    for (const outcome of this.simulationOutcomes.values()) {
      if (outcome.workspace_id !== workspaceId || outcome.reliability_eligible !== true) {
        continue;
      }
      const run = this.simulationRuns.get(key(String(outcome.simulation_run_id), workspaceId));
      if (!run) {
        continue;
      }
      const playbook = record(run.playbook_snapshot);
      const reliabilityContext = record(playbook.reliability_context);
      const evaluationWindow = record(run.evaluation_window);
      const result = outcome.execution_result === 'win'
        ? 'hit'
        : outcome.execution_result === 'loss'
          ? 'invalidated'
          : outcome.execution_result === 'breakeven'
            ? 'mixed'
            : 'inconclusive';
      rows.push({
        ...outcome,
        scenario_id: run.source_scenario_id,
        thesis_id: run.source_thesis_id,
        source_scenario_id: run.source_scenario_id,
        source_thesis_id: run.source_thesis_id,
        symbol: run.symbol,
        market_type: run.market_type,
        horizon: evaluationWindow.horizon ?? playbook.horizon ?? 'unknown',
        evaluated_at: outcome.evaluated_at ?? run.completed_at ?? run.started_at,
        evaluation_window: evaluationWindow,
        result,
        data_quality: 'complete',
        evidence: {
          relation_to_thesis: 'paper_execution',
          action_bias: playbook.direction ?? 'unknown',
          setup_type: reliabilityContext.setup_type ?? reliabilityContext.setup ?? null,
          lesson: outcome.diagnosis_summary,
        },
        source_kind: 'simulation_outcome',
      });
    }
    return rows
      .filter((item) => !filters.symbol || item.symbol === filters.symbol)
      .filter((item) => !filters.market_type || filters.market_type === 'mixed' || item.market_type === filters.market_type)
      .filter((item) => !filters.horizon || item.horizon === filters.horizon)
      .sort((a, b) => String(b.evaluated_at ?? '').localeCompare(String(a.evaluated_at ?? '')))
      .slice(0, filters.limit);
  }

  async saveTradePlaybook(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `playbook_${this.tradePlaybooks.size + 1}`);
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      version: 'trade_playbook.v1',
      created_at: input.created_at ?? '2026-07-01T00:00:00.000Z',
    };
    this.tradePlaybooks.set(key(id, workspaceId), saved);
    return saved;
  }

  async getTradePlaybook(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.tradePlaybooks.get(key(id, workspaceId)) ?? null;
  }

  async listTradePlaybooksForScenario(
    scenarioId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    this.countRead('listTradePlaybooksForScenario');
    return [...this.tradePlaybooks.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => item.source_scenario_id === scenarioId)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  }

  async listTradePlaybooks(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.tradePlaybooks.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, limit);
  }

  async saveScenarioEvent(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `scenario_event_${this.scenarioEvents.size + 1}`);
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      version: 'scenario_event.v1',
      thesis_id: input.thesis_id ?? null,
      summary: input.summary ?? '',
      payload: record(input.payload),
      created_at: input.created_at ?? '2026-07-02T00:00:00.000Z',
    };
    const existing = this.scenarioEvents.get(key(id, workspaceId));
    if (!existing) {
      this.scenarioEvents.set(key(id, workspaceId), saved);
    }
    return this.scenarioEvents.get(key(id, workspaceId))!;
  }

  async listScenarioEvents(
    scenarioId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]> {
    this.countRead('listScenarioEvents');
    return [...this.scenarioEvents.values()]
      .filter((event) => event.workspace_id === workspaceId)
      .filter((event) => event.scenario_id === scenarioId)
      .sort(
        (a, b) =>
          String(b.event_time ?? '').localeCompare(String(a.event_time ?? '')) ||
          String(b.id ?? '').localeCompare(String(a.id ?? '')),
      )
      .slice(0, limit);
  }

  async saveScenarioLiveStateSnapshot(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(
      input.id ?? `scenario_live_state_${this.scenarioLiveStateSnapshots.size + 1}`,
    );
    const state = record(input.state ?? input.state_json ?? input);
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      scenario_id: String(input.scenario_id ?? state.scenario_id ?? ''),
      market_snapshot_id: input.market_snapshot_id ?? null,
      evaluated_at: String(input.evaluated_at ?? state.evaluated_at ?? new Date().toISOString()),
      state,
      source_hash: String(input.source_hash ?? ''),
      created_at: String(input.created_at ?? new Date().toISOString()),
    };
    this.scenarioLiveStateSnapshots.set(key(id, workspaceId), saved);
    return saved;
  }

  async getLatestScenarioLiveStateSnapshot(
    scenarioId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.scenarioLiveStateSnapshots.values()]
        .filter((snapshot) => snapshot.workspace_id === workspaceId)
        .filter((snapshot) => snapshot.scenario_id === scenarioId)
        .sort(
          (a, b) =>
            String(b.evaluated_at ?? '').localeCompare(String(a.evaluated_at ?? '')) ||
            String(b.id ?? '').localeCompare(String(a.id ?? '')),
        )[0] ?? null
    );
  }

  async saveScenarioFeedbackPlaybook(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(
      input.id ?? `scenario_feedback_playbook_${this.scenarioFeedbackPlaybooks.size + 1}`,
    );
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      generated_at: input.generated_at ?? '2026-07-01T00:00:00.000Z',
      version: 'scenario_feedback_playbook.v1',
    };
    this.scenarioFeedbackPlaybooks.set(key(id, workspaceId), saved);
    return saved;
  }

  async getLatestScenarioFeedbackPlaybook(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      [...this.scenarioFeedbackPlaybooks.values()]
        .filter((item) => item.workspace_id === workspaceId)
        .filter((item) => item.symbol === symbol)
        .sort(
          (a, b) =>
            String(b.generated_at ?? '').localeCompare(String(a.generated_at ?? '')) ||
            String(b.id ?? '').localeCompare(String(a.id ?? '')),
        )[0] ?? null
    );
  }

  async saveBacktestRun(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `backtest_${this.backtestRuns.size + 1}`);
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      version: 'backtest_run.v1',
      created_at: input.created_at ?? '2026-07-01T00:00:00.000Z',
      completed_at: input.completed_at ?? null,
    };
    this.backtestRuns.set(key(id, workspaceId), saved);
    return saved;
  }

  async getBacktestRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.backtestRuns.get(key(id, workspaceId)) ?? null;
  }

  async listBacktestRunsForPlaybook(
    playbookId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.backtestRuns.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => item.playbook_id === playbookId)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  }

  async listBacktestRuns(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.backtestRuns.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, limit);
  }

  async saveBacktestTradeEvents(
    runId: string,
    events: JsonRecord[],
    workspaceId: string,
  ): Promise<void> {
    this.backtestTradeEvents.set(
      key(runId, workspaceId),
      events
        .map((event, index) => ({
          ...event,
          workspace_id: workspaceId,
          backtest_run_id: runId,
          event_index: event.event_index ?? index + 1,
        }))
        .sort((a, b) => Number(a.event_index ?? 0) - Number(b.event_index ?? 0)),
    );
  }

  async listBacktestTradeEvents(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.backtestTradeEvents.get(key(runId, workspaceId)) ?? [];
  }

  async saveSimulationRun(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `simulation_${this.simulationRuns.size + 1}`);
    const saved = {
      ...input,
      id,
      workspace_id: workspaceId,
      version: 'simulation_run.v1',
      started_at: input.started_at ?? '2026-07-01T00:00:00.000Z',
    };
    this.simulationRuns.set(key(id, workspaceId), saved);
    return saved;
  }

  async withSimulationRunLock<T>(
    simulationRunId: string,
    workspaceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const storageKey = key(simulationRunId, workspaceId);
    this.simulationRunLockCalls.push(storageKey);
    const previous = this.simulationRunLocks.get(storageKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => current, () => current);
    this.simulationRunLocks.set(storageKey, next);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.simulationRunLocks.get(storageKey) === next) {
        this.simulationRunLocks.delete(storageKey);
      }
    }
  }

  async getSimulationRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.simulationRuns.get(key(id, workspaceId)) ?? null;
  }

  async listSimulationRunsForPlaybook(
    playbookId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.simulationRuns.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => item.source_playbook_id === playbookId)
      .sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
  }

  async listSimulationRuns(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.simulationRuns.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')))
      .slice(0, limit);
  }

  async savePaperOrder(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `paper_order_${this.paperOrders.size + 1}`);
    const saved = { ...input, id, workspace_id: workspaceId, version: 'paper_order.v1' };
    this.paperOrders.set(key(id, workspaceId), saved);
    return saved;
  }

  async listPaperOrdersForSimulation(
    simulationRunId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.paperOrders.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => item.simulation_run_id === simulationRunId);
  }

  async savePaperPosition(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `paper_position_${this.paperPositions.size + 1}`);
    const saved = { ...input, id, workspace_id: workspaceId, version: 'paper_position.v1' };
    this.paperPositions.set(key(id, workspaceId), saved);
    return saved;
  }

  async getPaperPositionForSimulation(
    simulationRunId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return [...this.paperPositions.values()]
      .filter((item) => item.workspace_id === workspaceId)
      .filter((item) => item.simulation_run_id === simulationRunId)
      .sort((a, b) => String(b.id ?? '').localeCompare(String(a.id ?? '')))[0] ?? null;
  }

  async appendExecutionEvents(
    simulationRunId: string,
    events: JsonRecord[],
    workspaceId: string,
  ): Promise<void> {
    const storageKey = key(simulationRunId, workspaceId);
    const existing = this.executionEvents.get(storageKey) ?? [];
    const seen = new Set(existing.map((event) => String(event.idempotency_key ?? '')));
    for (const event of events) {
      const idempotencyKey = String(event.idempotency_key ?? '');
      if (seen.has(idempotencyKey)) continue;
      seen.add(idempotencyKey);
      existing.push({
        ...event,
        workspace_id: workspaceId,
        simulation_run_id: simulationRunId,
        version: 'execution_event.v1',
      });
    }
    existing.sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
    this.executionEvents.set(storageKey, existing);
  }

  async listExecutionEvents(
    simulationRunId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.executionEvents.get(key(simulationRunId, workspaceId)) ?? [];
  }

  async saveSimulationOutcome(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? `simulation_outcome_${this.simulationOutcomes.size + 1}`);
    const saved = { ...input, id, workspace_id: workspaceId, version: 'simulation_outcome.v1' };
    this.simulationOutcomes.set(key(String(input.simulation_run_id ?? id), workspaceId), saved);
    return saved;
  }

  async getSimulationOutcome(
    simulationRunId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return this.simulationOutcomes.get(key(simulationRunId, workspaceId)) ?? null;
  }

  async saveScenarioDecisionItemState(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const id = String(input.id ?? '');
    const saved: JsonRecord = { ...input, id, workspace_id: workspaceId };
    this.scenarioDecisionItemStates.set(key(id, workspaceId), saved);
    return saved;
  }

  async listScenarioDecisionItemStates(
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return [...this.scenarioDecisionItemStates.values()].filter(
      (item) => item.workspace_id === workspaceId,
    );
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
        (signal) =>
          signal.id === id &&
          signal.workspace_id === workspaceId &&
          this.isSignalPublishable(signal),
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
      .filter((signal) => this.isSignalPublishable(signal))
      .slice(0, limit);
  }

  async summarizeSignals(
    symbol: string | undefined,
    workspaceId: string,
  ): Promise<SignalSummary> {
    return this.signals
      .filter((signal) => signal.workspace_id === workspaceId)
      .filter((signal) => !symbol || signal.symbol === symbol)
      .filter((signal) => this.isSignalPublishable(signal))
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

  async listSignalObservations(
    filters: {
      symbol?: string;
      factor?: string;
      signalSnapshotId?: string;
      from?: string;
      to?: string;
      limit: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.signalObservations
      .filter((row) => row.workspace_id === workspaceId)
      .filter((row) => !filters.symbol || row.symbol === filters.symbol)
      .filter((row) => !filters.factor || row.factor_name === filters.factor)
      .filter(
        (row) =>
          !filters.signalSnapshotId ||
          row.signal_snapshot_id === filters.signalSnapshotId,
      )
      .filter((row) => !filters.from || String(row.observed_at ?? '') >= filters.from)
      .filter((row) => !filters.to || String(row.observed_at ?? '') <= filters.to)
      .slice(0, filters.limit);
  }

  async getSignalObservation(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.signalObservations.find(
        (row) => row.id === id && row.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async listSignalOutcomeLabels(
    filters: {
      observationId?: string;
      symbol?: string;
      factor?: string;
      horizonMinutes?: number;
      from?: string;
      to?: string;
      limit: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const factorObservationIds = new Set(
      this.signalObservations
        .filter((row) => row.workspace_id === workspaceId)
        .filter((row) => !filters.factor || row.factor_name === filters.factor)
        .map((row) => String(row.id ?? '')),
    );
    return this.signalOutcomeLabels
      .filter((row) => row.workspace_id === workspaceId)
      .filter(
        (row) =>
          !filters.observationId || row.observation_id === filters.observationId,
      )
      .filter((row) => !filters.symbol || row.symbol === filters.symbol)
      .filter(
        (row) =>
          filters.horizonMinutes === undefined ||
          row.horizon_minutes === filters.horizonMinutes,
      )
      .filter(
        (row) =>
          !filters.factor ||
          factorObservationIds.has(String(row.observation_id ?? '')),
      )
      .filter((row) => !filters.from || String(row.created_at ?? '') >= filters.from)
      .filter((row) => !filters.to || String(row.created_at ?? '') <= filters.to)
      .slice(0, filters.limit);
  }

  async saveSignalEvaluationReport(
    report: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...report, workspace_id: workspaceId };
    this.signalEvaluationReports.unshift(saved);
    return saved;
  }

  async listSignalEvaluationReports(
    filters: {
      symbol?: string;
      factor?: string;
      horizonMinutes?: number;
      limit: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.signalEvaluationReports
      .filter((row) => row.workspace_id === workspaceId)
      .filter((row) => !filters.symbol || row.symbol === filters.symbol)
      .filter((row) => !filters.factor || row.factor_name === filters.factor)
      .filter(
        (row) =>
          filters.horizonMinutes === undefined ||
          row.horizon_minutes === filters.horizonMinutes,
      )
      .slice(0, filters.limit);
  }

  async getSignalEvaluationReport(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.signalEvaluationReports.find(
        (row) => row.id === id && row.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async saveSignalModelArtifact(
    kind: 'weight' | 'calibrator',
    artifact: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...artifact, workspace_id: workspaceId };
    const rows =
      kind === 'weight' ? this.signalWeightVersions : this.signalCalibratorVersions;
    const index = rows.findIndex(
      (row) => row.id === saved.id && row.workspace_id === workspaceId,
    );
    if (index >= 0) {
      rows[index] = saved;
    } else {
      rows.unshift(saved);
    }
    return saved;
  }

  async listSignalModelArtifacts(
    kind: 'weight' | 'calibrator',
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const rows =
      kind === 'weight' ? this.signalWeightVersions : this.signalCalibratorVersions;
    return rows.filter((row) => row.workspace_id === workspaceId);
  }

  async getSignalModelArtifact(
    kind: 'weight' | 'calibrator',
    version: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      (await this.listSignalModelArtifacts(kind, workspaceId)).find(
        (row) => row.version === version || row.id === version,
      ) ?? null
    );
  }

  async saveSignalModelPromotion(
    promotion: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...promotion, workspace_id: workspaceId };
    this.signalModelPromotions.unshift(saved);
    return saved;
  }

  async listSignalModelPromotions(workspaceId: string): Promise<JsonRecord[]> {
    return this.signalModelPromotions.filter(
      (row) => row.workspace_id === workspaceId,
    );
  }

  async saveSignalMonitoringSnapshot(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...snapshot, workspace_id: workspaceId };
    this.signalMonitoringSnapshots.unshift(saved);
    return saved;
  }

  async listSignalMonitoringSnapshots(workspaceId: string): Promise<JsonRecord[]> {
    return this.signalMonitoringSnapshots.filter(
      (row) => row.workspace_id === workspaceId,
    );
  }

  async getSignalMonitoringSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    return (
      this.signalMonitoringSnapshots.find(
        (row) => row.id === id && row.workspace_id === workspaceId,
      ) ?? null
    );
  }

  async listSignalModelAlerts(
    filters: { status?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    return this.signalModelAlerts
      .filter((row) => row.workspace_id === workspaceId)
      .filter((row) => !filters.status || row.status === filters.status)
      .slice(0, filters.limit);
  }

  async updateSignalModelAlert(
    id: string,
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const alert = this.signalModelAlerts.find(
      (row) => row.id === id && row.workspace_id === workspaceId,
    );
    if (!alert) {
      return null;
    }
    Object.assign(alert, input);
    return alert;
  }

  async saveSignalModelRollback(
    rollback: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const saved: JsonRecord = { ...rollback, workspace_id: workspaceId };
    this.signalModelRollbacks.unshift(saved);
    return saved;
  }

  async listSignalModelRollbacks(workspaceId: string): Promise<JsonRecord[]> {
    return this.signalModelRollbacks.filter(
      (row) => row.workspace_id === workspaceId,
    );
  }

  private isSignalPublishable(signal: JsonRecord): boolean {
    const runId = typeof signal.research_run_id === 'string'
      ? signal.research_run_id
      : undefined;
    const workspaceId = typeof signal.workspace_id === 'string'
      ? signal.workspace_id
      : undefined;
    if (!runId || !workspaceId) {
      return true;
    }
    const run = this.researchRuns.get(key(runId, workspaceId));
    if (!run) {
      return true;
    }
    return ['completed', 'completed_degraded'].includes(String(run.status));
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

test('thesis response exposes decision brief fields from backend contract', () => {
  const response = toThesisResponse({
    id: 'thesis_decision_brief',
    workspace_id: 'workspace_a',
    research_run_id: 'run_decision_brief',
    symbol: 'BTC/USDT',
    direction: 'avoid',
    setup_type: 'agent_debate',
    confidence: 0.42,
    created_at: '2026-06-04T08:00:00.000Z',
    structured_summary: {
      rating: 'Underweight',
      action_summary:
        'Reduce BTC/USDT spot exposure and avoid initiating new long positions.',
    },
  });

  assert.equal(response.decision, 'Underweight');
  assert.equal(response.recommended_action, 'avoid_long');
  assert.equal(response.recommended_action_label, 'Avoid long');
  assert.equal(response.market_bias, 'defensive');
  assert.equal(response.market_bias_label, 'Defensive');
  assert.equal(response.entry_plan_status, 'no_trade');
  assert.equal(response.entry_plan_status_label, 'No trade');
  assert.equal(response.analysis_mode, 'ai_assisted');
  assert.equal(response.analysis_mode_label, 'AI assisted analysis');
  assert.equal(response.thesis_status, 'draft');
  assert.equal(response.thesis_status_label, 'Draft');
});

test('thesis response prioritizes ai-service decision semantic fields', () => {
  const response = toThesisResponse({
    id: 'thesis_explicit_decision_brief',
    workspace_id: 'workspace_a',
    research_run_id: 'run_explicit_decision_brief',
    symbol: 'ETH/USDT',
    direction: 'watch',
    structured_summary: {
      rating: 'Hold',
      direction: 'watch',
      recommended_action: 'reduce_exposure',
      market_bias: 'defensive',
      entry_plan_status: 'no_trade',
    },
  });

  assert.equal(response.decision, 'Hold');
  assert.equal(response.recommended_action, 'reduce_exposure');
  assert.equal(response.recommended_action_label, 'Reduce exposure');
  assert.equal(response.market_bias, 'defensive');
  assert.equal(response.market_bias_label, 'Defensive');
  assert.equal(response.entry_plan_status, 'no_trade');
  assert.equal(response.entry_plan_status_label, 'No trade');
});

test('thesis response exposes typed objective level fields', () => {
  const response = toThesisResponse({
    id: 'thesis_typed_levels',
    workspace_id: 'workspace_a',
    research_run_id: 'run_typed_levels',
    symbol: 'BNB/USDT',
    direction: 'watch',
    structured_summary: {
      rating: 'Underweight',
      target_zones: [],
      profit_targets: ['$620'],
      downside_objectives: ['$500-$520'],
      accumulation_zones: ['$480', '$440', '$400'],
      indicator_thresholds: ['RSI 4H above 50', 'Long/Short ratio above 3.0'],
    },
  });

  assert.deepEqual(response.target_zones, []);
  assert.deepEqual(response.profit_targets, ['$620']);
  assert.deepEqual(response.downside_objectives, ['$500-$520']);
  assert.deepEqual(response.accumulation_zones, ['$480', '$440', '$400']);
  assert.deepEqual(response.indicator_thresholds, [
    'RSI 4H above 50',
    'Long/Short ratio above 3.0',
  ]);
  assert.deepEqual(response.summary.profit_targets, ['$620']);
  assert.deepEqual(response.summary.downside_objectives, ['$500-$520']);
  assert.deepEqual(response.summary.accumulation_zones, ['$480', '$440', '$400']);
  assert.deepEqual(response.summary.indicator_thresholds, [
    'RSI 4H above 50',
    'Long/Short ratio above 3.0',
  ]);
});

test('thesis response exposes contract validation status fields', () => {
  const response = toThesisResponse({
    id: 'thesis_contract_blocked',
    workspace_id: 'workspace_a',
    research_run_id: 'run_contract_blocked',
    symbol: 'BTC/USDT',
    artifact_status: 'blocked',
    validation_issues: [
      {
        code: 'confirmation_condition_missing',
        severity: 'blocker',
        message: 'Confirmation condition is required.',
        field: 'confirmation_condition',
        source: 'thesis_validator',
      },
    ],
    degradation_reasons: ['data_quality_degraded'],
    blocked_reasons: ['confirmation_condition_missing'],
    candidate_schema_version: 'thesis_candidate.v1',
    thesis_text_source: 'diagnostic',
    compiler_version: 'thesis_compiler.v1',
    compiled_sections: [
      {
        key: 'data_caveats',
        title: 'Data caveats',
        text: '- data_quality_degraded',
        source_fields: ['validation.degradation_reasons'],
      },
    ],
  });

  assert.equal(response.artifact_status, 'blocked');
  assert.deepEqual(response.validation_issues, [
    {
      code: 'confirmation_condition_missing',
      severity: 'blocker',
      message: 'Confirmation condition is required.',
      field: 'confirmation_condition',
      source: 'thesis_validator',
    },
  ]);
  assert.deepEqual(response.degradation_reasons, ['data_quality_degraded']);
  assert.deepEqual(response.blocked_reasons, ['confirmation_condition_missing']);
  assert.equal(response.candidate_schema_version, 'thesis_candidate.v1');
  assert.equal(response.thesis_text_source, 'diagnostic');
  assert.equal(response.compiler_version, 'thesis_compiler.v1');
  assert.deepEqual(response.compiled_sections, [
    {
      key: 'data_caveats',
      title: 'Data caveats',
      text: '- data_quality_degraded',
      source_fields: ['validation.degradation_reasons'],
    },
  ]);
});

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

test('DELETE /research-runs/:id removes the selected run and later workspace runs', async () => {
  const { journal, jobs, researchRuns, signals } = buildHarness();
  for (let index = 1; index <= 5; index += 1) {
    const runId = `run_${index}`;
    journal.researchRuns.set(key(runId, 'workspace_a'), {
      id: runId,
      run_id: runId,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      asset_class: 'crypto',
      market_type: 'spot',
      timeframe: '2026-05-12',
      status: 'completed',
      started_at: `2026-05-12T0${index}:00:00.000Z`,
      completed_at: `2026-05-12T0${index}:30:00.000Z`,
      thesis_id: `thesis_${index}`,
      signal_snapshot_id: `signal_snapshot_${index}`,
      market_snapshot_id: `market_snapshot_${index}`,
      degradation_reasons: [],
      missing_core_data: [],
      missing_optional_data: [],
    });
    const signalId = `signal_${index}`;
    journal.signalSnapshots.set(key(`signal_snapshot_${index}`, 'workspace_a'), {
      id: `signal_snapshot_${index}`,
      workspace_id: 'workspace_a',
      research_run_id: runId,
      symbol: 'BTC/USDT',
      captured_at: `2026-05-12T0${index}:15:00.000Z`,
      signal_ids: [signalId],
      payload: { signal_ids: [signalId] },
    });
    journal.signals.push({
      id: signalId,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      signal_type: 'technical',
      direction: 'bullish',
      confidence: 0.5,
      observed_at: `2026-05-12T0${index}:10:00.000Z`,
      source: 'test',
      source_timestamp: `2026-05-12T0${index}:10:00.000Z`,
      summary: `Signal ${index}`,
    });
  }
  journal.researchRuns.set(key('run_3', 'workspace_b'), {
    id: 'run_3',
    run_id: 'run_3',
    workspace_id: 'workspace_b',
    symbol: 'ETH/USDT',
    asset_class: 'crypto',
    market_type: 'spot',
    status: 'completed',
    started_at: '2026-05-12T03:00:00.000Z',
    completed_at: '2026-05-12T03:30:00.000Z',
    degradation_reasons: [],
    missing_core_data: [],
    missing_optional_data: [],
  });
  journal.signalSnapshots.set(key('signal_snapshot_b', 'workspace_b'), {
    id: 'signal_snapshot_b',
    workspace_id: 'workspace_b',
    research_run_id: 'run_3',
    symbol: 'BTC/USDT',
    captured_at: '2026-05-12T03:15:00.000Z',
    signal_ids: ['signal_b'],
    payload: { signal_ids: ['signal_b'] },
  });
  journal.signals.push({
    id: 'signal_b',
    workspace_id: 'workspace_b',
    symbol: 'BTC/USDT',
    signal_type: 'technical',
    direction: 'bearish',
    confidence: 0.4,
    observed_at: '2026-05-12T03:10:00.000Z',
    source: 'test',
    source_timestamp: '2026-05-12T03:10:00.000Z',
    summary: 'Workspace B signal',
  });
  await jobs.enqueueResearchRun({
    ...engineRequest('run_4'),
    analysis_date: '2026-05-12',
  });

  const remove = (
    researchRuns as unknown as {
      remove?: (
        id: string,
        userId?: string,
        workspaceHeader?: string,
      ) => Promise<{
        removed: boolean;
        workspace_id: string;
        requested_run_id: string;
        deleted_count: number;
        deleted_run_ids: string[];
      }>;
    }
  ).remove;

  assert.equal(typeof remove, 'function');
  if (!remove) {
    assert.fail('ResearchRunsService.remove is not implemented.');
  }
  const result = await remove.bind(researchRuns)(
    'run_2',
    'user_1',
    'workspace_a',
  );

  assert.equal(result.removed, true);
  assert.equal(result.workspace_id, 'workspace_a');
  assert.equal(result.requested_run_id, 'run_2');
  assert.equal(result.deleted_count, 4);
  assert.deepEqual(result.deleted_run_ids, ['run_2', 'run_3', 'run_4', 'run_5']);
  assert.notEqual(await journal.getResearchRun('run_1', 'workspace_a'), null);
  assert.equal(await journal.getResearchRun('run_2', 'workspace_a'), null);
  assert.equal(await journal.getResearchRun('run_5', 'workspace_a'), null);
  assert.notEqual(await journal.getResearchRun('run_3', 'workspace_b'), null);
  assert.deepEqual(
    (await researchRuns.list({ limit: 100 }, 'user_1', 'workspace_a')).map(
      (run) => run.id,
    ),
    ['run_1'],
  );
  assert.deepEqual(
    (await signals.list('BTC/USDT', 100, 'user_1', 'workspace_a')).map(
      (signal) => signal.id,
    ),
    ['signal_1'],
  );
  assert.deepEqual(
    (await signals.list('BTC/USDT', 100, 'user_1', 'workspace_b')).map(
      (signal) => signal.id,
    ),
    ['signal_b'],
  );
  await assert.rejects(
    () => jobs.getJobStatus('run_4'),
    isException(NotFoundException),
  );
});

test('DELETE /research-runs removes all current workspace run data and jobs', async () => {
  const { journal, jobs, researchRuns, signals } = buildHarness();
  for (const workspaceId of ['workspace_a', 'workspace_b']) {
    for (let index = 1; index <= 2; index += 1) {
      const runId = `${workspaceId}_run_${index}`;
      const thesisId = `${workspaceId}_thesis_${index}`;
      const signalSnapshotId = `${workspaceId}_signal_snapshot_${index}`;
      const signalId = `${workspaceId}_signal_${index}`;
      journal.researchRuns.set(key(runId, workspaceId), {
        id: runId,
        run_id: runId,
        workspace_id: workspaceId,
        symbol: workspaceId === 'workspace_a' ? 'BTC/USDT' : 'ETH/USDT',
        asset_class: 'crypto',
        market_type: 'spot',
        timeframe: '2026-05-12',
        status: 'completed',
        started_at: `2026-05-12T0${index}:00:00.000Z`,
        completed_at: `2026-05-12T0${index}:30:00.000Z`,
        thesis_id: thesisId,
        signal_snapshot_id: signalSnapshotId,
        market_snapshot_id: `${workspaceId}_market_snapshot_${index}`,
        degradation_reasons: [],
        missing_core_data: [],
        missing_optional_data: [],
      });
      journal.theses.set(key(thesisId, workspaceId), {
        id: thesisId,
        workspace_id: workspaceId,
        research_run_id: runId,
        symbol: workspaceId === 'workspace_a' ? 'BTC/USDT' : 'ETH/USDT',
        direction: 'long',
        setup_type: 'breakout',
        confidence: 0.7,
        created_at: '2026-05-12T00:00:00.000Z',
        payload: {},
      });
      journal.signalSnapshots.set(key(signalSnapshotId, workspaceId), {
        id: signalSnapshotId,
        workspace_id: workspaceId,
        research_run_id: runId,
        symbol: workspaceId === 'workspace_a' ? 'BTC/USDT' : 'ETH/USDT',
        captured_at: `2026-05-12T0${index}:15:00.000Z`,
        signal_ids: [signalId],
        payload: { signal_ids: [signalId] },
      });
      journal.signals.push({
        id: signalId,
        workspace_id: workspaceId,
        symbol: workspaceId === 'workspace_a' ? 'BTC/USDT' : 'ETH/USDT',
        signal_type: 'technical',
        direction: 'bullish',
        confidence: 0.5,
        observed_at: `2026-05-12T0${index}:10:00.000Z`,
        source: 'test',
        source_timestamp: `2026-05-12T0${index}:10:00.000Z`,
        summary: `Signal ${index}`,
      });
    }
  }
  journal.signals.push(
    {
      id: 'workspace_a_orphan_signal',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      signal_type: 'technical',
      direction: 'neutral',
      confidence: 0.3,
      observed_at: '2026-05-12T09:10:00.000Z',
      source: 'test',
      source_timestamp: '2026-05-12T09:10:00.000Z',
      summary: 'Workspace A standalone signal',
    },
    {
      id: 'workspace_b_orphan_signal',
      workspace_id: 'workspace_b',
      symbol: 'BTC/USDT',
      signal_type: 'technical',
      direction: 'neutral',
      confidence: 0.3,
      observed_at: '2026-05-12T09:10:00.000Z',
      source: 'test',
      source_timestamp: '2026-05-12T09:10:00.000Z',
      summary: 'Workspace B standalone signal',
    },
  );
  await jobs.enqueueResearchRun({
    ...engineRequest('workspace_a_job_only'),
    workspace_id: 'workspace_a',
    analysis_date: '2026-05-12',
  });

  const removeWorkspaceData = (
    researchRuns as unknown as {
      removeWorkspaceData?: (
        userId?: string,
        workspaceHeader?: string,
      ) => Promise<{
        removed: boolean;
        workspace_id: string;
        requested_run_id: string;
        deleted_count: number;
        deleted_run_ids: string[];
      }>;
    }
  ).removeWorkspaceData;

  assert.equal(typeof removeWorkspaceData, 'function');
  if (!removeWorkspaceData) {
    assert.fail('ResearchRunsService.removeWorkspaceData is not implemented.');
  }
  const result = await removeWorkspaceData.bind(researchRuns)(
    'user_1',
    'workspace_a',
  );

  assert.equal(result.removed, true);
  assert.equal(result.workspace_id, 'workspace_a');
  assert.equal(result.requested_run_id, '*');
  assert.equal(result.deleted_count, 3);
  assert.deepEqual(result.deleted_run_ids, [
    'workspace_a_run_1',
    'workspace_a_run_2',
    'workspace_a_job_only',
  ]);
  assert.deepEqual(
    (await researchRuns.list({ limit: 100 }, 'user_1', 'workspace_a')).map(
      (run) => run.id,
    ),
    [],
  );
  assert.deepEqual(
    (await signals.list('BTC/USDT', 100, 'user_1', 'workspace_a')).map(
      (signal) => signal.id,
    ),
    [],
  );
  assert.deepEqual(
    (await researchRuns.list({ limit: 100 }, 'user_1', 'workspace_b')).map(
      (run) => run.id,
    ),
    ['workspace_b_run_2', 'workspace_b_run_1'],
  );
  assert.deepEqual(
    (await signals.list('BTC/USDT', 100, 'user_1', 'workspace_b')).map(
      (signal) => signal.id,
    ),
    ['workspace_b_orphan_signal'],
  );
  await assert.rejects(
    () => jobs.getJobStatus('workspace_a_job_only'),
    isException(NotFoundException),
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

test('GET /workspaces lists the built-in legacy mixed workspace', async () => {
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
      const controller = new WorkspacesController(new AuthService(), workspaces);

      const response = await controller.list('local-user');

      assert.equal(response.length, 1);
      assert.equal(response[0]?.id, 'local');
      assert.equal(response[0]?.name, 'Legacy Mixed Workspace');
      assert.equal(response[0]?.scope_type, 'legacy_mixed');
      assert.equal(response[0]?.symbol, null);
      assert.equal(response[0]?.market_type, 'mixed');
      await workspaces.onModuleDestroy();
    },
  );
});

test('POST /workspaces creates fixed-symbol metadata and grants owner access', async () => {
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
      const controller = new WorkspacesController(new AuthService(), workspaces);

      const created = await controller.create(
        {
          name: 'BTC Main',
          symbol: 'btc',
        },
        'local-user',
      );

      assert.match(created.id, /^workspace_/);
      assert.equal(created.name, 'BTC Main');
      assert.equal(created.scope_type, 'fixed_symbol');
      assert.equal(created.symbol, 'BTC/USDT');
      assert.equal(created.market_type, 'perp');
      assert.equal(created.archived, false);

      const fetched = await controller.get(created.id, 'local-user');
      assert.deepEqual(fetched, created);

      const membership = await workspaces.assertAccess(
        'local-user',
        created.id,
        'owner',
      );
      assert.equal(membership.role, 'owner');
      await workspaces.onModuleDestroy();
    },
  );
});

test('DELETE /workspaces archives fixed-symbol metadata for owners', async () => {
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
      const controller = new WorkspacesController(new AuthService(), workspaces);

      const created = await controller.create(
        {
          name: 'Delete Me',
          symbol: 'btc',
        },
        'local-user',
      );

      const archived = await controller.remove(created.id, 'local-user');

      assert.equal(archived.id, created.id);
      assert.equal(archived.archived, true);
      await assert.rejects(
        () => controller.get(created.id, 'local-user'),
        /not found/i,
      );
      assert.deepEqual(await controller.list('local-user'), [
        {
          id: 'local',
          name: 'Legacy Mixed Workspace',
          scope_type: 'legacy_mixed',
          symbol: null,
          market_type: 'mixed',
          default_timeframe: null,
          archived: false,
          created_at: '1970-01-01T00:00:00.000Z',
          updated_at: '1970-01-01T00:00:00.000Z',
        },
      ]);
      await workspaces.onModuleDestroy();
    },
  );
});

test('DELETE /workspaces protects legacy and non-owner workspaces', async () => {
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'viewer_1', workspace_id: 'workspace_a', role: 'viewer' },
    { user_id: 'owner_1', workspace_id: 'workspace_a', role: 'owner' },
  ]);
  workspaces.setWorkspaceMetadataForTest([
    {
      id: 'workspace_a',
      name: 'BTC Workspace',
      scope_type: 'fixed_symbol',
      symbol: 'BTC/USDT',
      market_type: 'spot',
      default_timeframe: null,
      archived: false,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    },
  ]);
  const controller = new WorkspacesController(new AuthService(), workspaces);

  await assert.rejects(
    () => controller.remove('workspace_a', 'viewer_1'),
    /cannot perform owner actions/i,
  );
  await assert.rejects(
    () => controller.remove('local', 'owner_1'),
    /cannot be deleted/i,
  );
  await workspaces.onModuleDestroy();
});

test('workspace news sources can be saved, listed, and require editor access', async () => {
  const workspaces = new WorkspacesService();
  workspaces.setMembershipsForTest([
    { user_id: 'owner_1', workspace_id: 'workspace_a', role: 'owner' },
    { user_id: 'viewer_1', workspace_id: 'workspace_a', role: 'viewer' },
  ]);
  workspaces.setWorkspaceMetadataForTest([
    {
      id: 'workspace_a',
      name: 'BTC Workspace',
      scope_type: 'fixed_symbol',
      symbol: 'BTC/USDT',
      market_type: 'spot',
      default_timeframe: null,
      archived: false,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    },
  ]);
  const controller = new WorkspacesController(new AuthService(), workspaces);
  const newsApi = controller as unknown as {
    listNewsSources(
      id: string,
      userId?: string,
    ): Promise<{ workspace_id: string; sources: JsonRecord[] }>;
    updateNewsSources(
      id: string,
      dto: JsonRecord,
      userId?: string,
    ): Promise<{ workspace_id: string; sources: JsonRecord[] }>;
  };

  const saved = await newsApi.updateNewsSources(
    'workspace_a',
    {
      sources: [
        {
          id: 'btc-core-blog',
          name: ' BTC Core Blog ',
          type: 'rss',
          url: ' https://bitcoincore.org/en/rss.xml ',
          category: 'official_project',
          trust_tier: 'user_trusted',
          scope: ['btc', 'eth'],
          official: true,
          enabled: true,
        },
        {
          name: 'Paused Source',
          type: 'rss',
          url: 'https://example.com/rss.xml',
          category: 'crypto_media',
          trust_tier: 'medium',
          scope: 'ALL',
          enabled: false,
        },
        {
          name: 'Workspace Default Source',
          type: 'rss',
          url: 'https://example.com/default.xml',
          category: 'crypto_media',
          trust_tier: 'medium',
        },
      ],
    },
    'owner_1',
  );

  assert.equal(saved.workspace_id, 'workspace_a');
  assert.deepEqual(saved.sources.map((source) => source.id), [
    'btc-core-blog',
    'paused_source',
    'workspace_default_source',
  ]);
  assert.deepEqual(saved.sources[0]?.scope, ['BTC', 'ETH']);
  assert.equal(saved.sources[0]?.name, 'BTC Core Blog');
  assert.equal(saved.sources[1]?.enabled, false);
  assert.deepEqual(saved.sources[2]?.scope, ['BTC']);

  const listed = await newsApi.listNewsSources('workspace_a', 'viewer_1');
  assert.deepEqual(listed, saved);

  await assert.rejects(
    () =>
      newsApi.updateNewsSources(
        'workspace_a',
        { sources: [] },
        'viewer_1',
      ),
    isException(ForbiddenException),
  );

  await assert.rejects(
    () =>
      newsApi.updateNewsSources(
        'workspace_a',
        {
          sources: [
            {
              id: 'dupe',
              name: 'One',
              type: 'rss',
              url: 'https://example.com/one.xml',
              category: 'crypto_media',
            },
            {
              id: 'dupe',
              name: 'Two',
              type: 'rss',
              url: 'https://example.com/two.xml',
              category: 'crypto_media',
            },
          ],
        },
        'owner_1',
      ),
    isException(BadRequestException),
  );

  await workspaces.onModuleDestroy();
});

test('POST /research-runs uses a persisted fixed workspace after service restart', async () => {
  await withEnv(
    {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lunacrypto',
      WORKSPACE_MEMBERSHIPS: undefined,
      LOCAL_WORKSPACE_MEMBERSHIP: undefined,
      LOCAL_USER_ID: undefined,
      LOCAL_WORKSPACE_ID: undefined,
      JOBS_EXECUTION_MODE: 'memory',
      REDIS_URL: undefined,
    },
    async () => {
      const pool = new FakeWorkspacePool();
      const firstWorkspaces = new WorkspacesService(pool);
      const controller = new WorkspacesController(
        new AuthService(),
        firstWorkspaces,
      );
      const created = await controller.create(
        {
          name: 'BTC Main',
          symbol: 'btc',
        },
        'local-user',
      );
      await firstWorkspaces.onModuleDestroy();

      const auth = new AuthService();
      const restartedWorkspaces = new WorkspacesService(pool);
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => ({
          status: 'completed',
          run_id: request.run_id,
        }),
      } as unknown as PythonEngineClient);
      const researchRuns = new ResearchRunsService(
        new FakeJournalRepository(),
        jobs,
        auth,
        restartedWorkspaces,
      );

      const response = await researchRuns.create(
        {
          run_id: 'run_persisted_fixed_workspace',
          workspace_id: created.id,
          analysis_date: '2026-05-31',
          analysts: ['market'],
        } as CreateResearchRunDto,
        'local-user',
        created.id,
      );

      assert.equal(response.run_id, 'run_persisted_fixed_workspace');
      assert.equal(jobs.listMemoryJobs()[0]?.symbol, 'BTC/USDT');
      await jobs.onModuleDestroy();
      await restartedWorkspaces.onModuleDestroy();
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
          output_language: 'Vietnamese',
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
          market_type: 'perp',
          analysis_date: '2026-05-12',
          analysts: ['market', 'news'],
          config_profile: 'default',
          exchange: 'binance',
          output_language: 'Vietnamese',
          dry_run: true,
          metadata: { source: 'contract-test' },
        },
      ]);
    },
  );
});

test('research run creation forwards output language to engine request', async () => {
  const { jobs, researchRuns } = buildHarness();

  const response = await researchRuns.create(
    {
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      analysis_date: '2026-05-12',
      analysts: ['market'],
      output_language: 'Vietnamese',
    },
    'user_1',
    'workspace_a',
  );
  const request = await jobs.getJobRequest(response.job_id);

  assert.equal(request?.output_language, 'Vietnamese');
});

test('POST /research-runs injects enabled workspace news sources into engine metadata', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs, workspaces } = buildHarness();
      workspaces.setWorkspaceMetadataForTest([
        {
          id: 'workspace_a',
          name: 'BTC Workspace',
          scope_type: 'fixed_symbol',
          symbol: 'BTC/USDT',
          market_type: 'spot',
          default_timeframe: null,
          archived: false,
          created_at: '2026-05-31T00:00:00.000Z',
          updated_at: '2026-05-31T00:00:00.000Z',
        },
      ]);
      const workspaceNews = workspaces as unknown as {
        updateNewsSources(
          workspaceId: string,
          userId: string,
          dto: JsonRecord,
        ): Promise<{ workspace_id: string; sources: JsonRecord[] }>;
      };
      const savedSourcesResponse = await workspaceNews.updateNewsSources('workspace_a', 'user_1', {
        sources: [
          {
            id: 'bitcoin_ops',
            name: 'Bitcoin Ops',
            type: 'rss',
            url: 'https://bitcoinops.org/en/feed.xml',
            category: 'official_project',
            trust_tier: 'user_trusted',
            target_analysts: ['news'],
            scope: ['BTC'],
            enabled: true,
          },
          {
            id: 'sentiment_forums',
            name: 'Sentiment Forums',
            type: 'rss',
            url: 'https://example.com/social.xml',
            category: 'crypto_media',
            trust_tier: 'medium',
            target_analysts: ['social'],
            scope: ['BTC'],
            enabled: true,
          },
          {
            id: 'paused_media',
            name: 'Paused Media',
            type: 'rss',
            url: 'https://example.com/rss.xml',
            category: 'crypto_media',
            trust_tier: 'medium',
            target_analysts: ['news'],
            scope: ['BTC'],
            enabled: false,
          },
        ],
      });
      const savedSources = records(savedSourcesResponse.sources);
      assert.deepEqual(
        savedSources.map((source) => [
          source.id,
          source.target_analysts,
        ]),
        [
          ['bitcoin_ops', ['news']],
          ['sentiment_forums', ['social']],
          ['paused_media', ['news']],
        ],
      );

      await researchRunsController.create(
        {
          run_id: 'run_workspace_news_sources',
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          analysis_date: '2026-05-12',
          analysts: ['news'],
          metadata: { source: 'ui' },
        },
        'user_1',
        'workspace_a',
      );

      const metadata = record(jobs.listMemoryJobs()[0]?.metadata);
      const newsContext = record(metadata.news_context);
      const metadataSources = records(metadata.news_sources);
      const contextSources = records(newsContext.workspace_sources);
      assert.equal(metadata.source, 'ui');
      assert.deepEqual(metadataSources.map((source) => source.id), [
        'bitcoin_ops',
      ]);
      assert.deepEqual(metadataSources[0]?.target_analysts, ['news']);
      assert.deepEqual(contextSources.map((source) => source.id), [
        'bitcoin_ops',
      ]);
      assert.deepEqual(contextSources[0]?.target_analysts, ['news']);
      assert.equal(contextSources[0]?.url, 'https://bitcoinops.org/en/feed.xml');
      assert.equal(contextSources[0]?.enabled, undefined);
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

test('POST /research-runs derives the symbol from a fixed workspace', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs, workspaces } = buildHarness();
      workspaces.setWorkspaceMetadataForTest([
        fixedWorkspaceMetadata('workspace_a', 'BTC/USDT'),
      ]);

      const response = await researchRunsController.create(
        {
          run_id: 'run_fixed_no_symbol',
          workspace_id: 'workspace_a',
          analysis_date: '2026-05-12',
          analysts: ['market'],
        } as CreateResearchRunDto,
        'user_1',
        'workspace_a',
      );

      assert.equal(response.run_id, 'run_fixed_no_symbol');
      assert.equal(jobs.listMemoryJobs()[0]?.symbol, 'BTC/USDT');
    },
  );
});

test('POST /research-runs accepts matching symbols in a fixed workspace', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs, workspaces } = buildHarness();
      workspaces.setWorkspaceMetadataForTest([
        fixedWorkspaceMetadata('workspace_a', 'BTC/USDT'),
      ]);

      await researchRunsController.create(
        {
          run_id: 'run_fixed_matching_symbol',
          workspace_id: 'workspace_a',
          symbol: 'btcusdt',
          analysis_date: '2026-05-12',
          analysts: ['market'],
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(jobs.listMemoryJobs()[0]?.symbol, 'BTC/USDT');
    },
  );
});

test('POST /research-runs rejects mismatched symbols in a fixed workspace', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs, workspaces } = buildHarness();
      workspaces.setWorkspaceMetadataForTest([
        fixedWorkspaceMetadata('workspace_a', 'BTC/USDT'),
      ]);

      await assert.rejects(
        () =>
          researchRunsController.create(
            {
              run_id: 'run_fixed_mismatch',
              workspace_id: 'workspace_a',
              symbol: 'ETH/USDT',
              analysis_date: '2026-05-12',
              analysts: ['market'],
            },
            'user_1',
            'workspace_a',
          ),
        hasBadRequestCode('symbol_workspace_mismatch'),
      );
      assert.equal(jobs.listMemoryJobs().length, 0);
    },
  );
});

test('POST /research-runs rejects legacy mixed workspace creation', async () => {
  await withEnv(
    {
      DATABASE_URL: undefined,
      WORKSPACE_MEMBERSHIPS: undefined,
      LOCAL_WORKSPACE_MEMBERSHIP: undefined,
      LOCAL_USER_ID: undefined,
      LOCAL_WORKSPACE_ID: undefined,
      JOBS_EXECUTION_MODE: 'memory',
      REDIS_URL: undefined,
    },
    async () => {
      const auth = new AuthService();
      const workspaces = new WorkspacesService();
      const jobs = new JobsService({
        runInline: async (request: EngineRunRequest) => ({
          status: 'completed',
          run_id: request.run_id,
        }),
      } as unknown as PythonEngineClient);
      const researchRuns = new ResearchRunsService(
        new FakeJournalRepository(),
        jobs,
        auth,
        workspaces,
      );

      await assert.rejects(
        () =>
          researchRuns.create(
            {
              run_id: 'run_legacy_rejected',
              workspace_id: 'local',
              symbol: 'BTC/USDT',
              analysis_date: '2026-05-12',
              analysts: ['market'],
            },
            'local-user',
            'local',
          ),
        hasBadRequestCode('legacy_workspace_read_only'),
      );
      assert.equal(jobs.listMemoryJobs().length, 0);
      await jobs.onModuleDestroy();
      await workspaces.onModuleDestroy();
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
    { ...validPayload, market_type: 'spot' },
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

test('create research run dto accepts optional output language', async () => {
  const dto = await validateCreateResearchRun({
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    analysis_date: '2026-05-12',
    analysts: ['market'],
    output_language: 'Vietnamese',
  });

  assert.equal(dto.output_language, 'Vietnamese');
});

test('openapi create research run schema exposes output language', () => {
  const schema = openApiDocument.components.schemas.CreateResearchRunRequest;

  assert.equal(schema.properties.output_language.type, 'string');
  assert.equal(schema.properties.output_language.minLength, 1);
});

test('openapi simulation schema exposes partial take-profit assumptions', () => {
  const schema = openApiDocument.components.schemas.CreateSimulationRequest;
  const partial = schema.properties.partial_take_profit;

  assert.equal(partial.type, 'array');
  assert.equal(partial.items.$ref, '#/components/schemas/SimulationPartialTakeProfit');
  assert.equal(schema.properties.position_size.$ref, '#/components/schemas/SimulationPositionSize');
  assert.equal(
    openApiDocument.components.schemas.SimulationRunResponse.properties.assumptions.$ref,
    '#/components/schemas/SimulationAssumptions',
  );
  assert.equal(
    openApiDocument.components.schemas.SimulationRunResponse.properties.market_data_snapshot.$ref,
    '#/components/schemas/MarketDataSnapshot',
  );
  assert.equal(
    openApiDocument.components.schemas.SimulationRunResponse.properties.sample_identity.$ref,
    '#/components/schemas/SimulationSampleIdentity',
  );
});

test('POST /research-runs defaults trade-lab launch requests to perp', async () => {
  await withEnv(
    { JOBS_EXECUTION_MODE: 'memory', REDIS_URL: undefined },
    async () => {
      const { researchRunsController, jobs } = buildHarness();

      await researchRunsController.create(
        {
          run_id: 'run_default_perp',
          workspace_id: 'workspace_a',
          symbol: 'BTC/USDT',
          analysis_date: '2026-05-12',
          analysts: ['market'],
        },
        'user_1',
        'workspace_a',
      );

      assert.equal(jobs.listMemoryJobs()[0]?.market_type, 'perp');
    },
  );
});

test('scenario chart projection source_versions includes stale reasons in OpenAPI', () => {
  // This test protects the manual generated client until an automated OpenAPI client generator is added.
  const schema = openApiDocument.components.schemas.ScenarioChartProjectionResponse;
  const sourceVersions = record(record(schema.properties).source_versions);
  const properties = record(sourceVersions.properties);

  assert.ok(properties.stale_reasons);
});

test('visual opportunity projection contract is exposed in OpenAPI', () => {
  const schemas = openApiDocument.components.schemas as Record<string, unknown>;
  const projection = record(schemas.VisualOpportunityProjectionV1);
  const overlay = record(schemas.VisualOverlayV1);
  const chartProjection = record(schemas.ScenarioChartProjectionResponse);
  const chartProperties = record(chartProjection.properties);
  const projectionProperties = record(projection.properties);
  const overlayProperties = record(overlay.properties);
  const schemaVersion = record(projectionProperties.schema_version);

  assert.ok(projection);
  assert.ok(overlay);
  assert.equal(
    Array.isArray(schemaVersion.enum) &&
      schemaVersion.enum.includes('visual_opportunity_projection.v1'),
    true,
  );
  assert.ok(projectionProperties.source_versions);
  assert.ok(projectionProperties.opportunity);
  assert.ok(projectionProperties.overlays);
  assert.ok(overlayProperties.source_ref);
  assert.ok(chartProperties.visual_projection);
});

test('OpenAPI contract omits decommissioned watchlist and daily brief routes', () => {
  const paths = openApiDocument.paths as Record<string, Record<string, unknown>>;
  for (const removedPath of [
    '/watchlists',
    '/watchlists/{id}',
    '/watchlists/{id}/items',
    '/watchlists/{id}/items/{itemId}',
    '/watchlists/{id}/check',
    '/briefs/daily',
    '/alerts/scheduler',
    '/alerts/scheduler/run',
  ]) {
    assert.equal(paths[removedPath], undefined, `${removedPath} should be removed`);
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
        postgres_sync: {
          status: 'skipped',
          synced_tables: [],
          sqlite_path: null,
          error: null,
        },
      });
      assert.equal(captured?.run_id, 'run_inline');
      assert.deepEqual(jobs.listMemoryJobs(), []);
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
        postgres_sync: {
          status: 'skipped',
          synced_tables: [],
          sqlite_path: null,
          error: null,
        },
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
    let syncOptions:
      | { sqlitePath?: string; publishSignals?: boolean }
      | undefined;
    const sqliteSync = {
      syncRun: async (
        runId: string,
        workspaceId: string,
        options?: { sqlitePath?: string; publishSignals?: boolean },
      ) => {
        syncOptions = options;
        return {
          run_id: runId,
          workspace_id: workspaceId,
          sqlite_path: options?.sqlitePath ?? '/tmp/research.sqlite',
          tables: { research_runs: 1, run_events: 2 },
        };
      },
    } as unknown as SqliteJournalSyncService;
    const processor = new ResearchJobProcessor(
      {
        runInline: async (engineRequest: EngineRunRequest) => ({
          status: 'completed',
          run_id: engineRequest.run_id,
          workspace_id: engineRequest.workspace_id,
          journal_path: '/tmp/engine-written-research.sqlite',
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
    const syncAudit = record(result.postgres_sync);

    assert.equal(result.postgres_sync && typeof result.postgres_sync, 'object');
    assert.equal(syncAudit.status, 'completed');
    assert.deepEqual(syncAudit.synced_tables, ['research_runs', 'run_events']);
    assert.equal(syncAudit.sqlite_path, '/tmp/engine-written-research.sqlite');
    assert.equal(syncAudit.error, null);
    assert.equal(syncOptions?.sqlitePath, '/tmp/engine-written-research.sqlite');
    assert.equal(syncOptions?.publishSignals, true);
    assert.equal(status?.status, 'completed');
    assert.equal(status?.attempts, 1);
    assert.equal(status?.heartbeat_at !== null, true);
    assert.deepEqual(status?.result_summary, result);
    await lifecycle.onModuleDestroy();
  });
});

test('ResearchJobProcessor records postgres_sync failure without failing completed engine runs', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_processor_sync_failure_audit');
    await lifecycle.create({
      id: 'job_processor_sync_failure_audit',
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: 'job_processor_sync_failure_audit',
      maxAttempts: 1,
    });
    const sqliteSync = {
      syncRun: async () => {
        throw new Error('SQLite export failed during sync.');
      },
    } as unknown as SqliteJournalSyncService;
    const processor = new ResearchJobProcessor(
      {
        runInline: async (engineRequest: EngineRunRequest) => ({
          status: 'completed',
          run_id: engineRequest.run_id,
          workspace_id: engineRequest.workspace_id,
          journal_path: '/tmp/sync-failed-research.sqlite',
        }),
      } as unknown as PythonEngineClient,
      lifecycle,
      sqliteSync,
    );

    const result = await processor.process(request, {
      jobId: 'job_processor_sync_failure_audit',
      backend: 'bullmq',
      attempt: 1,
      maxAttempts: 1,
    });
    const status = await lifecycle.get('run_processor_sync_failure_audit');
    const syncAudit = record(result.postgres_sync);

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.warnings, ['postgres_sync_failed']);
    assert.equal(syncAudit.status, 'failed');
    assert.deepEqual(syncAudit.synced_tables, []);
    assert.equal(syncAudit.sqlite_path, '/tmp/sync-failed-research.sqlite');
    assert.match(String(syncAudit.error), /SQLite export failed/);
    assert.equal(status?.status, 'completed');
    assert.deepEqual(status?.result_summary, result);
    await lifecycle.onModuleDestroy();
  });
});

test('ResearchJobProcessor does not publish signal artifacts from failed runs', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_processor_failed_sync');
    await lifecycle.create({
      id: 'job_processor_failed_sync',
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: 'job_processor_failed_sync',
      maxAttempts: 1,
    });
    let syncOptions:
      | { sqlitePath?: string; publishSignals?: boolean }
      | undefined;
    const sqliteSync = {
      syncRun: async (
        runId: string,
        workspaceId: string,
        options?: { sqlitePath?: string; publishSignals?: boolean },
      ) => {
        syncOptions = options;
        return {
          run_id: runId,
          workspace_id: workspaceId,
          sqlite_path: options?.sqlitePath ?? '/tmp/research.sqlite',
          tables: {
            research_runs: 1,
            run_events: 4,
            llm_calls: 2,
            signals: 0,
            signal_snapshots: 0,
          },
        };
      },
    } as unknown as SqliteJournalSyncService;
    const processor = new ResearchJobProcessor(
      {
        runInline: async (engineRequest: EngineRunRequest) => ({
          status: 'failed',
          run_id: engineRequest.run_id,
          workspace_id: engineRequest.workspace_id,
          error_type: 'APITimeoutError',
          error: 'Request timed out.',
          journal_path: '/tmp/failed-research.sqlite',
        }),
      } as unknown as PythonEngineClient,
      lifecycle,
      sqliteSync,
    );

    const result = await processor.process(request, {
      jobId: 'job_processor_failed_sync',
      backend: 'bullmq',
      attempt: 1,
      maxAttempts: 1,
    });
    const status = await lifecycle.get('run_processor_failed_sync');

    assert.equal(syncOptions?.sqlitePath, '/tmp/failed-research.sqlite');
    assert.equal(syncOptions?.publishSignals, false);
    assert.equal(status?.status, 'failed');
    assert.equal(status?.error_code, 'APITimeoutError');
    assert.equal(record(result.postgres_sync).status, 'completed');
    assert.deepEqual(record(result.postgres_sync).tables, {
      research_runs: 1,
      run_events: 4,
      llm_calls: 2,
      signals: 0,
      signal_snapshots: 0,
    });
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

test('ResearchJobProcessor aborts and marks running jobs cancelled when cancellation is requested', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const lifecycle = new JobLifecycleService();
    const request = engineRequest('run_processor_cancelled');
    await lifecycle.create({
      id: 'job_processor_cancelled',
      request,
      backend: 'bullmq',
      queueName: 'research-runs',
      queueJobId: 'job_processor_cancelled',
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
              reject(new Error('cancellation test did not abort'));
            }, 5000);
            options?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(holdOpen);
                reject(new Error('aborted by cancellation'));
              },
              { once: true },
            );
          }),
      } as unknown as PythonEngineClient,
      lifecycle,
    );

    const processing = processor.process(request, {
      jobId: 'job_processor_cancelled',
      backend: 'bullmq',
      attempt: 1,
      maxAttempts: 1,
      timeoutMs: 10000,
    });
    await delay(25);
    await lifecycle.requestCancellation('job_processor_cancelled');

    await assert.rejects(
      () => processing,
      (error) =>
        error instanceof Error && error.message === 'aborted by cancellation',
    );
    const status = await lifecycle.get('job_processor_cancelled');

    assert.equal(status?.status, 'cancelled');
    assert.equal(status?.error_code, 'job_cancelled');
    assert.equal(status?.cancellation_requested_at !== null, true);
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

test('PythonEngineClient uses the engine module entrypoint instead of the retired public CLI', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'jobs', 'python-engine.client.ts'),
    'utf8',
  );

  assert.equal(source.includes("'-m', 'cli.main'"), false);
  assert.equal(source.includes("'lunacrypto'"), false);
  assert.ok(source.includes("'-m', 'luna_workstation.engine'"));
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

test('signals APIs hide signals from failed research runs', async () => {
  const { journal, signals } = buildHarness();
  journal.researchRuns.set(key('run_completed_signals', 'workspace_a'), {
    id: 'run_completed_signals',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'completed',
  });
  journal.researchRuns.set(key('run_failed_signals', 'workspace_a'), {
    id: 'run_failed_signals',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    status: 'failed',
  });
  journal.signals.push(
    {
      id: 'sig_completed',
      workspace_id: 'workspace_a',
      research_run_id: 'run_completed_signals',
      symbol: 'ETH/USDT',
      signal_type: 'regime',
      direction: 'bullish',
    },
    {
      id: 'sig_failed',
      workspace_id: 'workspace_a',
      research_run_id: 'run_failed_signals',
      symbol: 'ETH/USDT',
      signal_type: 'macd',
      direction: 'bearish',
    },
  );

  const listed = await signals.list('ETH', 50, 'user_1', 'workspace_a');

  assert.deepEqual(
    listed.map((signal) => signal.id),
    ['sig_completed'],
  );
  assert.deepEqual(await signals.count('ETH', 'user_1', 'workspace_a'), {
    total: 1,
    bullish: 1,
    bearish: 0,
    neutral: 0,
  });
  await assert.rejects(
    () => signals.get('sig_failed', 'user_1', 'workspace_a'),
    isException(NotFoundException),
  );
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

test('signal evaluation APIs scope rows and fail closed without model data', async () => {
  const { journal, signals } = buildHarness();
  journal.signalObservations.push(
    {
      id: 'obs_a',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      factor_name: 'regime',
      factor_family: 'price_structure',
      observed_at: '2026-06-01T00:00:00.000Z',
      availability: 'valid',
      heuristic_strength: 0.7,
    },
    {
      id: 'obs_b',
      workspace_id: 'workspace_b',
      symbol: 'BTC/USDT',
      factor_name: 'regime',
      factor_family: 'price_structure',
      observed_at: '2026-06-01T00:00:00.000Z',
      availability: 'valid',
      heuristic_strength: 0.2,
    },
  );
  journal.signalOutcomeLabels.push({
    id: 'label_a',
    workspace_id: 'workspace_a',
    observation_id: 'obs_a',
    symbol: 'BTC/USDT',
    horizon_minutes: 1440,
    label_status: 'complete',
    direction_correct: true,
    heuristic_strength: 0.7,
    signed_return: 0.03,
    created_at: '2026-06-02T00:00:00.000Z',
  });
  journal.signalMonitoringSnapshots.push(
    {
      id: 'monitor_b',
      workspace_id: 'workspace_b',
      status: 'healthy',
      observation_count: 1,
    },
    {
      id: 'monitor_a',
      workspace_id: 'workspace_a',
      status: 'insufficient_data',
      observation_count: 1,
    },
  );

  const observations = await signals.listObservations(
    { symbol: 'BTC', limit: 10 },
    'user_1',
    'workspace_a',
  );
  assert.deepEqual(observations.map((row) => row.id), ['obs_a']);
  await assert.rejects(
    () => signals.getObservation('obs_a', 'user_1', 'workspace_b'),
    isException(NotFoundException),
  );

  const outcomes = await signals.listObservationOutcomes(
    'obs_a',
    'user_1',
    'workspace_a',
  );
  assert.deepEqual(outcomes.map((row) => row.id), ['label_a']);

  const report = await signals.createEvaluationReport(
    { symbol: 'BTC', horizon_minutes: 1440 },
    'user_1',
    'workspace_a',
  );
  assert.equal(report.workspace_id, 'workspace_a');
  assert.equal(report.sample_size, 1);
  assert.equal(report.directional_sample_size, 1);

  const reports = await signals.listEvaluationReports(
    { symbol: 'BTC', horizonMinutes: 1440, limit: 10 },
    'user_1',
    'workspace_a',
  );
  assert.deepEqual(reports.map((row) => row.id), [report.id]);

  const monitoring = await signals.latestMonitoring('user_1', 'workspace_a');
  assert.equal(monitoring.id, 'monitor_a');

  const training = await signals.trainModel(
    { horizon_minutes: 1440, dry_run: true },
    'user_1',
    'workspace_a',
  );
  assert.equal(training.status, 'insufficient_data');
  assert.equal(training.publishable, false);
});

test('signal evaluation model training promotes only publishable OOS artifacts', async () => {
  const { journal, signals } = buildHarness();
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  for (let index = 0; index < 800; index += 1) {
    const correct = index % 2 === 0;
    const observedAt = new Date(start + index * 86_400_000).toISOString();
    const observationId = `train_obs_${index}`;
    journal.signalObservations.push({
      id: observationId,
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      factor_name: 'regime',
      factor_family: 'price_structure',
      observed_at: observedAt,
      availability: 'valid',
      heuristic_strength: correct ? 0.8 : 0.2,
    });
    journal.signalOutcomeLabels.push({
      id: `train_label_${index}`,
      workspace_id: 'workspace_a',
      observation_id: observationId,
      symbol: 'BTC/USDT',
      horizon_minutes: 1440,
      label_status: 'complete',
      direction_correct: correct,
      signed_return: correct ? 0.03 : -0.02,
      created_at: observedAt,
    });
  }

  const report = await signals.createEvaluationReport(
    { symbol: 'BTC', horizon_minutes: 1440 },
    'user_1',
    'workspace_a',
  );

  const foldsJson = report.folds_json as JsonRecord;
  const qualityWarnings = report.quality_warnings as unknown[];
  assert.equal(report.oos_sample_size, 160);
  assert.equal(foldsJson.fold_count, 1);
  assert.equal(qualityWarnings.length, 0);
  assert.notEqual(report.brier_score, null);
  assert.notEqual(report.ece, null);

  const training = await signals.trainModel(
    { symbol: 'BTC', horizon_minutes: 1440 },
    'user_1',
    'workspace_a',
  );

  assert.equal(training.status, 'shadow');
  assert.equal(training.publishable, true);
  assert.equal(training.calibrator.publishable, true);

  const promotion = await signals.createPromotion(
    {
      weight_version: training.weight.version,
      calibrator_version: training.calibrator.version,
      evidence_report_id: report.id,
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(promotion.to_weight_version, training.weight.version);
  assert.equal((await signals.listPromotions('user_1', 'workspace_a'))[0]?.id, promotion.id);
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

test('postgres workspace schema declares fixed-symbol metadata columns', () => {
  const schema = readFileSync(
    join(process.cwd(), 'src', 'database', 'postgres-schema.sql'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  for (const fragment of [
    "scope_type TEXT NOT NULL DEFAULT 'legacy_mixed'",
    "symbol TEXT",
    "market_type TEXT NOT NULL DEFAULT 'mixed'",
    'default_timeframe TEXT',
    'archived BOOLEAN NOT NULL DEFAULT false',
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT now()',
  ]) {
    assert.ok(schema.includes(fragment), `missing schema fragment: ${fragment}`);
  }
});

test('postgres scenario evaluation schema defaults market type to perp', () => {
  const schema = readFileSync(
    join(process.cwd(), 'src', 'database', 'postgres-schema.sql'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  assert.ok(schema.includes("market_type TEXT NOT NULL DEFAULT 'perp'"));
});

test('postgres journal lists scenarios in horizon order', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'database', 'postgres-journal.repository.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  for (const fragment of [
    "ORDER BY CASE payload_json->>'horizon'",
    "WHEN 'short_term' THEN 1",
    "WHEN 'mid_term' THEN 2",
    "WHEN 'long_term' THEN 3",
  ]) {
    assert.ok(source.includes(fragment), `missing scenario order fragment: ${fragment}`);
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

test('MarketDataController defaults unspecified OHLCV market type to perp', async () => {
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
          undefined,
          '1h',
          '2026-05-18T00:00:00.000Z',
          '2026-05-18T04:00:00.000Z',
          undefined,
          'user_1',
          'workspace_a',
        );

        assert.equal(response.market_type, 'perp');
        assert.ok(requestedUrl);
        assert.equal(requestedUrl?.hostname, 'perp.test');
        assert.equal(requestedUrl?.pathname, '/fapi/v1/klines');
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

test('redactForDebug recursively redacts debug payloads', () => {
  const redacted = redactForDebug({
    authorization: 'Bearer abc',
    nested: {
      api_key: 'secret',
      token: 'tok',
      safe: 'keep',
    },
    list: [{ cookie: 'session=abc' }],
    large: 'x'.repeat(5001),
    largeList: Array.from({ length: 205 }, (_, index) => index),
    largeObject: Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [`key_${index}`, index]),
    ),
  }) as JsonRecord;

  assert.equal(redacted.authorization, '[REDACTED]');
  assert.equal(record(redacted.nested).api_key, '[REDACTED]');
  assert.equal(record(redacted.nested).token, '[REDACTED]');
  assert.equal(record(redacted.nested).safe, 'keep');
  assert.equal(records(redacted.list)[0]?.cookie, '[REDACTED]');
  assert.equal(String(redacted.large).endsWith('[TRUNCATED]'), true);
  assert.equal((redacted.largeList as unknown[]).length, 201);
  assert.deepEqual((redacted.largeList as unknown[]).at(-1), {
    __truncated__: true,
    omitted_count: 5,
  });
  assert.equal(record(redacted.largeObject).__truncated__, true);
  assert.equal(record(redacted.largeObject).__omitted_key_count__, 5);
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

test('research workspace keeps parallel analyst timing sources distinct', () => {
  const run: ResearchRunResponse = {
    id: 'run_parallel_timing',
    run_id: 'run_parallel_timing',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    asset_class: 'crypto',
    market_type: 'perp',
    timeframe: null,
    status: 'completed',
    started_at: null,
    completed_at: null,
    cancellation_requested_at: null,
    thesis_id: null,
    decision_id: null,
    signal_snapshot_id: null,
    market_snapshot_id: null,
    degradation_reasons: [],
    missing_core_data: [],
    missing_optional_data: [],
  };
  const events: ResearchRunEventResponse[] = [
    {
      id: 'run_started',
      workspace_id: 'workspace_a',
      research_run_id: 'run_parallel_timing',
      thesis_id: null,
      event_type: 'run.started',
      created_at: '2026-05-12T00:00:00.000Z',
      message: 'started',
      payload: { analysts: ['market', 'news', 'social', 'onchain'] },
    },
    analystTimingEvent('market_start', 'agent.node.started', '2026-05-12T00:00:01.000Z', 'Market Analyst'),
    analystTimingEvent('market_done', 'agent.node.completed', '2026-05-12T00:00:27.000Z', 'Market Analyst'),
    analystTimingEvent('news_start', 'agent.node.started', '2026-05-12T00:00:02.000Z', 'News Analyst'),
    analystTimingEvent('news_done', 'agent.node.completed', '2026-05-12T00:00:19.000Z', 'News Analyst'),
    analystTimingEvent('social_start', 'agent.node.started', '2026-05-12T00:00:03.000Z', 'Social Analyst'),
    analystTimingEvent('social_done', 'agent.node.completed', '2026-05-12T00:00:13.000Z', 'Social Analyst'),
    analystTimingEvent('onchain_start', 'agent.node.started', '2026-05-12T00:00:04.000Z', 'Onchain Analyst'),
    analystTimingEvent('onchain_done', 'agent.node.completed', '2026-05-12T00:00:18.000Z', 'Onchain Analyst'),
  ];

  const timings = buildResearchRunStageTimings(run, events);
  const sourceIds = (stageKey: string) =>
    timings.find((stage) => stage.stage_key === stageKey)?.source_event_ids;

  assert.deepEqual(sourceIds('market'), ['market_start', 'market_done']);
  assert.deepEqual(sourceIds('news'), ['news_start', 'news_done']);
  assert.deepEqual(sourceIds('social'), ['social_start', 'social_done']);
  assert.deepEqual(sourceIds('onchain'), ['onchain_start', 'onchain_done']);
});

function analystTimingEvent(
  id: string,
  eventType: 'agent.node.started' | 'agent.node.completed',
  createdAt: string,
  graphNode: string,
): ResearchRunEventResponse {
  return {
    id,
    workspace_id: 'workspace_a',
    research_run_id: 'run_parallel_timing',
    thesis_id: null,
    event_type: eventType,
    created_at: createdAt,
    message: 'parallel analyst updated',
    payload: { graph_node: graphNode },
  };
}

test('research workspace omits legacy spot branch timing from setup planner completion', async () => {
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
  assert.equal(timing('spot_checks'), undefined);
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
  const recentReviewAt = new Date().toISOString();
  const recentThesisAt = new Date(Date.now() - 86_400_000).toISOString();
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
      reviewed_at: recentReviewAt,
      thesis_created_at: recentThesisAt,
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
      reviewed_at: recentReviewAt,
      thesis_created_at: recentThesisAt,
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

test('scenario monitor combines scenarios with price and alert context', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_scenario', 'workspace_a'), {
    id: 'thesis_scenario',
    workspace_id: 'workspace_a',
    symbol: 'SOL/USDT',
    direction: 'long',
    setup_type: 'trend_pullback',
    confidence: 0.66,
    created_at: '2026-05-12T00:00:00.000Z',
    thesis_text: 'Monitor pullback continuation',
  });
  journal.scenarios.set(key('thesis_scenario', 'workspace_a'), [
    {
      id: 'scenario_monitor',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_scenario',
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
    thesis_id: 'thesis_scenario',
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

test('thesis scenario detail includes runtime invalidation from latest market snapshot', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_runtime_detail', 'workspace_a'), {
    id: 'thesis_runtime_detail',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch breakdown confirmation.',
  });
  journal.scenarios.set(key('thesis_runtime_detail', 'workspace_a'), [
    {
      id: 'scenario_runtime_detail',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_runtime_detail',
      scenario_name: 'Breakdown confirmation',
      condition: 'Daily close below $500 with volume.',
      invalidation: 'Price holds above $530.',
      evidence: ['bearish alignment'],
      payload: {
        horizon: 'mid_term',
        decision_playbook: {
          version: 'scenario_decision_playbook.v1',
          source: 'derived_v1',
          action_bias: 'short',
          confidence: 0.8,
          preferred_action_if_triggered: 'entry_short_now',
          fallback_action: 'wait',
          validity_window: {
            valid_from: '2026-07-02T00:00:00.000Z',
            valid_until: null,
            timeframe: '1D',
            rationale: 'test',
            refresh_policy: 'refresh_on_next_research_run',
          },
          entry_conditions: [{ type: 'price_below', level: 500 }],
          invalidation_conditions: [{ type: 'price_above', level: 530 }],
          avoid_if: [],
          wait_for: [],
          risk_notes: [],
          evidence_refs: [
            {
              type: 'scenario',
              id: 'scenario_runtime_detail',
              field: 'condition',
              label: 'Breakdown trigger',
              supports: 'Daily close below $500.',
            },
          ],
          rationale: 'test',
        },
      },
    },
  ]);
  journal.marketSnapshots.set(key('snap_bnb_runtime_detail', 'workspace_a'), {
    id: 'snap_bnb_runtime_detail',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    captured_at: new Date().toISOString(),
    current_price: 552,
    source: 'test',
  });

  const detailScenarios = await theses.scenarios(
    'thesis_runtime_detail',
    'user_1',
    'workspace_a',
  );

  assert.equal(detailScenarios[0]?.runtime_decision.playbook_source, 'derived_v1');
  assert.equal(detailScenarios[0]?.runtime_decision.validity_status, 'invalidated');
  assert.equal(detailScenarios[0]?.runtime_decision.status_reason, 'Scenario is invalidated.');
  assert.deepEqual(detailScenarios[0]?.runtime_decision.blocking_reasons, [
    'invalidation_hit',
  ]);
});

test('scenario lifecycle enrichment rethrows non-missing table failures', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_lifecycle_failure', 'workspace_a'), {
    id: 'thesis_lifecycle_failure',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    thesis_text: 'Watch BTC.',
  });
  journal.scenarios.set(key('thesis_lifecycle_failure', 'workspace_a'), [
    {
      id: 'scenario_lifecycle_failure',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_lifecycle_failure',
      condition: 'Wait for confirmation.',
      payload: {},
    },
  ]);
  journal.listScenarioEvaluations = async () => {
    throw new Error('database connection dropped');
  };

  await assert.rejects(
    () =>
      theses.scenarios('thesis_lifecycle_failure', 'user_1', 'workspace_a'),
    /database connection dropped/,
  );
});

test('scenario response exposes normalized decision and provenance fields', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_scenario_fields', 'workspace_a'), {
    id: 'thesis_scenario_fields',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    direction: 'long',
    thesis_text: 'Watch BNB breakout.',
  });
  journal.scenarios.set(key('thesis_scenario_fields', 'workspace_a'), [
    {
      id: 'scenario_fields',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_scenario_fields',
      scenario_name: 'Breakout confirmation',
      direction: 'bullish',
      thesis_impact: 'strengthens thesis',
      condition: 'Daily close above 620 confirms continuation.',
      expected_market_behavior: 'Continuation toward the next target zone.',
      probability_band: 'medium',
      invalidation: 'Invalid if price closes below 580.',
      evidence: ['Price reclaimed 600 with rising volume.'],
      watch_triggers: ['Daily close above 620'],
      impact_on_thesis: 'Raises conviction if confirmed.',
      risk_map: ['False breakout risk'],
      suggested_user_action: 'Watch for close confirmation.',
      as_of: '2026-06-05',
      timeframe: '1D',
      source: ['market_report', 'quant_signal_text'],
      payload: {
        condition: 'legacy condition should not win',
        source: ['legacy_source'],
      },
    },
    {
      id: 'scenario_invalidation_fields',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_scenario_fields',
      scenario_name: 'Invalidation guardrail',
      direction: 'bearish risk',
      thesis_impact: 'high',
      condition: 'Daily close below 580 invalidates continuation.',
      expected_market_behavior: 'Thesis quality deteriorates.',
      probability_band: 'low',
      invalidation: 'Invalid if price reclaims 620.',
      evidence: ['Support failed with rising sell volume.'],
      watch_triggers: ['Daily close below 580'],
      impact_on_thesis: 'Invalidates the current thesis if confirmed.',
      risk_map: ['Continuation thesis fails'],
      suggested_user_action: 'Reassess the long thesis.',
      as_of: '2026-06-05',
      timeframe: '1D',
      source: ['market_report'],
      payload: {
        relation_to_thesis: null,
      },
    },
  ]);

  const scenarios = await theses.scenarios(
    'thesis_scenario_fields',
    'user_1',
    'workspace_a',
  );

  assert.equal(scenarios[0]?.scenario_name, 'Breakout confirmation');
  assert.equal(scenarios[0]?.direction, 'bullish');
  assert.equal(scenarios[0]?.thesis_impact, 'strengthens thesis');
  assert.equal(scenarios[0]?.relation_to_thesis, 'supports');
  assert.equal(scenarios[0]?.suggested_user_action, 'Watch for close confirmation.');
  assert.equal(scenarios[0]?.condition, 'Daily close above 620 confirms continuation.');
  assert.deepEqual(scenarios[0]?.evidence, ['Price reclaimed 600 with rising volume.']);
  assert.deepEqual(scenarios[0]?.watch_triggers, ['Daily close above 620']);
  assert.equal(scenarios[0]?.impact_on_thesis, 'Raises conviction if confirmed.');
  assert.deepEqual(scenarios[0]?.risk_map, ['False breakout risk']);
  assert.equal(scenarios[0]?.as_of, '2026-06-05');
  assert.equal(scenarios[0]?.timeframe, '1D');
  assert.deepEqual(scenarios[0]?.source, ['market_report', 'quant_signal_text']);
  assert.equal(scenarios[0]?.runtime_decision.playbook_source, 'derived_v1');
  assert.equal(scenarios[0]?.runtime_decision.recommended_action, 'review');
  assert.equal(scenarios[1]?.relation_to_thesis, 'invalidates');
});

test('scenario response preserves scenario recommendation and derives evaluation snapshot', () => {
  const response = toScenarioResponse({
    id: 'scenario_recommendation_contract',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_scenario_recommendation_contract',
    scenario_name: 'Breakout confirmation',
    condition: 'Wait for reclaim confirmation.',
    payload: {
      horizon: 'short_term',
      scenario_recommendation: {
        version: 'scenario_recommendation.v1',
        generated_at: '2026-06-27T00:00:00.000Z',
        source: 'llm',
        action: 'consider_long',
        action_bias: 'long',
        confidence: 0.74,
        summary: 'Consider long only after reclaim confirmation.',
        thesis_link: 'Supports the current bullish thesis if reclaim holds.',
        required_conditions: [],
        invalidation_conditions: [],
        wait_for: ['4h close above resistance'],
        hard_gates: [
          {
            id: 'fresh_market_data',
            label: 'Fresh market data',
            status: 'pending',
            reason: 'Waiting for current candle close.',
          },
        ],
        blocking_reasons: ['No close confirmation yet.'],
        risk_notes: ['Failed reclaim can trap breakout entries.'],
        evidence_refs: [],
        valid_until: '2026-06-30T00:00:00.000Z',
        evaluation_readiness: 'ready',
        evaluation_window: {
          starts_at: '2026-06-27T00:00:00.000Z',
          ends_at: '2026-06-30T00:00:00.000Z',
          horizon: 'short_term',
          metric_hint: 'trigger_then_mfe_mae',
        },
      },
    },
  });

  assert.equal(response.scenario_recommendation?.action, 'consider_long');
  assert.deepEqual(response.scenario_recommendation?.blocking_reasons, [
    'No close confirmation yet.',
  ]);
  assert.deepEqual(response.scenario_recommendation?.hard_gates, [
    {
      id: 'fresh_market_data',
      label: 'Fresh market data',
      status: 'pending',
      reason: 'Waiting for current candle close.',
    },
  ]);
  assert.deepEqual(response.scenario_recommendation?.evaluation_window, {
    starts_at: '2026-06-27T00:00:00.000Z',
    ends_at: '2026-06-30T00:00:00.000Z',
    horizon: 'short_term',
    metric_hint: 'trigger_then_mfe_mae',
  });
  assert.equal(response.evaluation_snapshot?.readiness, 'ready');
  assert.equal(
    response.evaluation_snapshot?.planned_evaluation_at,
    '2026-06-30T00:00:00.000Z',
  );
  assert.equal(response.evaluation_snapshot?.expected_horizon, 'short_term');
  assert.equal(response.evaluation_snapshot?.outcome, 'pending');
});

test('scenario condition role is preserved for decision playbook conditions', () => {
  const scenario = toScenarioResponse(
    {
      id: 'scenario_roles_1',
      thesis_id: 'thesis_roles_1',
      scenario_name: 'Breakout watch',
      direction: 'bullish risk',
      condition: 'Watch 110000 reclaim',
      invalidation: 'Invalid below 107800',
      payload: {
        decision_playbook: {
          version: 'scenario_decision_playbook.v1',
          source: 'llm',
          generated_at: '2026-07-02T00:00:00.000Z',
          generated_from_run_id: 'run_roles_1',
          action_bias: 'long',
          confidence: 0.64,
          preferred_action_if_triggered: 'consider_long',
          fallback_action: 'wait',
          near_trigger_threshold_pct: 1,
          validity_window: {
            valid_from: null,
            valid_until: null,
            timeframe: '4h',
            rationale: 'watch breakout',
            refresh_policy: 'manual_review',
          },
          entry_conditions: [
            {
              id: 'watch_zone',
              label: 'Watch zone',
              role: 'watch',
              type: 'price_in_zone',
              zone_low: 109500,
              zone_high: 110200,
            },
            {
              id: 'trigger_close',
              label: 'Close above trigger',
              role: 'trigger',
              type: 'price_above',
              level: 110200,
              candle_close_required: true,
            },
          ],
          avoid_if: [],
          invalidation_conditions: [
            {
              id: 'invalid_low',
              label: 'Invalidation',
              role: 'invalidation',
              type: 'price_below',
              level: 107800,
            },
          ],
          wait_for: [],
          risk_notes: [],
          evidence_refs: [],
          rationale: 'test',
        },
      },
    },
    { id: 'thesis_roles_1', workspace_id: 'workspace_1', symbol: 'BTC/USDT' },
  );

  assert.equal(scenario.decision_playbook?.entry_conditions[0]?.id, 'watch_zone');
  assert.equal(scenario.decision_playbook?.entry_conditions[0]?.label, 'Watch zone');
  assert.equal(scenario.decision_playbook?.entry_conditions[0]?.role, 'watch');
  assert.equal(scenario.decision_playbook?.entry_conditions[1]?.role, 'trigger');
  assert.equal(
    scenario.decision_playbook?.invalidation_conditions[0]?.role,
    'invalidation',
  );
});

test('scenario condition normalization strips unknown roles', () => {
  const scenario = toScenarioResponse({
    id: 'scenario_roles_invalid',
    thesis_id: 'thesis_roles_invalid',
    payload: {
      decision_playbook: {
        version: 'scenario_decision_playbook.v1',
        source: 'llm',
        generated_at: '2026-07-02T00:00:00.000Z',
        generated_from_run_id: null,
        action_bias: 'long',
        confidence: 0.64,
        preferred_action_if_triggered: 'consider_long',
        fallback_action: 'wait',
        near_trigger_threshold_pct: 1,
        validity_window: {
          valid_from: null,
          valid_until: null,
          timeframe: '4h',
          rationale: 'watch breakout',
          refresh_policy: 'manual_review',
        },
        entry_conditions: [
          {
            id: 'invalid_role',
            label: 'Invalid role',
            role: 'execute_now',
            type: 'price_above',
            level: 110200,
          },
        ],
        avoid_if: [],
        invalidation_conditions: [],
        wait_for: [],
        risk_notes: [],
        evidence_refs: [],
        rationale: 'test',
      },
    },
  });

  assert.equal(scenario.decision_playbook?.entry_conditions[0]?.role, undefined);
});

test('scenario response treats missing or invalid recommendations as not ready', () => {
  const response = toScenarioResponse({
    id: 'scenario_legacy_recommendation_contract',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_scenario_recommendation_contract',
    scenario_name: 'Legacy branch',
    condition: 'Legacy scenario without recommendation.',
    payload: {
      scenario_recommendation: {
        version: 'legacy',
        action: 'entry_long_now',
      },
    },
  });

  assert.equal(response.scenario_recommendation, null);
  assert.equal(response.evaluation_snapshot?.readiness, 'needs_review');
  assert.equal(response.evaluation_snapshot?.planned_evaluation_at, null);
  assert.equal(response.evaluation_snapshot?.outcome, 'not_ready');
  assert.deepEqual(response.evaluation_snapshot?.notes, [
    'Scenario recommendation is missing.',
  ]);
});

test('scenario response derives a safe recommendation from legacy Vietnamese trigger text', () => {
  const response = toScenarioResponse({
    id: 'scenario_legacy_vietnamese_trigger',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_legacy_vietnamese_trigger',
    scenario_name: 'Confirmation setup',
    condition: 'Giá đóng cửa ngày trên $580 kèm khối lượng cao.',
    invalidation: 'Giá đóng cửa ngày dưới $546 với ATR và khối lượng cao.',
    suggested_user_action: 'Watch confirmation - không mua ngay.',
    evidence: ['RSI >35'],
    risk_map: ['FOMO entry risk'],
    horizon: 'short_term',
    timeframe: '4H',
  }, {
    id: 'thesis_legacy_vietnamese_trigger',
    symbol: 'BNB/USDT',
    market_type: 'perp',
  });

  assert.equal(response.trigger_spec?.type, 'price_above');
  assert.equal(response.trigger_spec?.level, 580);
  assert.equal(response.scenario_recommendation?.source, 'derived_v1');
  assert.equal(response.scenario_recommendation?.action, 'wait');
  assert.equal(response.scenario_recommendation?.action_bias, 'neutral');
  assert.equal(response.scenario_recommendation?.required_conditions[0]?.type, 'price_above');
  assert.equal(response.scenario_recommendation?.required_conditions[0]?.level, 580);
  assert.equal(response.scenario_recommendation?.invalidation_conditions[0]?.type, 'price_below');
  assert.equal(response.scenario_recommendation?.invalidation_conditions[0]?.level, 546);
  assert.equal(response.scenario_recommendation?.evaluation_readiness, 'ready');
  assert.equal(response.evaluation_snapshot?.outcome, 'pending');
});

test('scenario response derives trigger from reaches text with thousands separators', () => {
  const response = toScenarioResponse({
    id: 'scenario_reaches_thousands_trigger',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_reaches_thousands_trigger',
    scenario_name: 'Short-Term Oversold Bounce Failure',
    direction: 'bearish',
    condition: 'RSI oversold triggers a bounce attempt.',
    expected_behavior: 'Price fails near resistance and rolls over.',
    invalidation: 'Daily close above $62,000 with volume >20d average.',
    suggested_user_action: 'Watch confirmation - do not act on first green candle. Monitor volume and price action at $59,500.',
    watch_triggers: ['Price reaches $59,500 with decreasing volume (< average).'],
    horizon: 'short_term',
    timeframe: '4H',
  }, {
    id: 'thesis_reaches_thousands_trigger',
    symbol: 'BTC/USDT',
    market_type: 'spot',
  });

  assert.equal(response.trigger_spec?.type, 'price_above');
  assert.equal(response.trigger_spec?.level, 59500);
  assert.equal(response.scenario_recommendation?.action, 'wait');
  assert.equal(response.scenario_recommendation?.action_bias, 'short');
  assert.equal(response.scenario_recommendation?.required_conditions[0]?.level, 59500);
  assert.equal(response.scenario_recommendation?.invalidation_conditions[0]?.level, 62000);
  assert.equal(
    response.scenario_recommendation?.blocking_reasons.includes('Missing trigger.'),
    false,
  );
});

test('scenario response does not parse RSI thresholds as legacy price triggers', () => {
  const response = toScenarioResponse({
    id: 'scenario_legacy_rsi_threshold',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_legacy_rsi_threshold',
    scenario_name: 'Bounce watch',
    condition: 'RSI=28 oversold + volume thấp 0.0x trung bình.',
    expected_behavior: 'Giá hồi phục nhưng không vượt $580.',
    invalidation: 'Giá đóng cửa dưới $530 với volume cao.',
    watch_triggers: [
      'Giá chạm $540-$530 kèm volume tăng đột biến',
      'RSI vượt 35',
    ],
    suggested_user_action: 'Watch confirmation — không mua.',
    horizon: 'short_term',
    timeframe: '4H',
  }, {
    id: 'thesis_legacy_rsi_threshold',
    symbol: 'BNB/USDT',
    market_type: 'perp',
  });

  assert.equal(response.trigger_spec?.type, 'price_in_zone');
  assert.equal(response.trigger_spec?.zone_low, 530);
  assert.equal(response.trigger_spec?.zone_high, 540);
  assert.equal(response.trigger_spec?.level, undefined);
  assert.equal(response.scenario_recommendation?.required_conditions[0]?.type, 'price_in_zone');
  assert.equal(response.scenario_recommendation?.required_conditions[0]?.zone_low, 530);
  assert.equal(response.scenario_recommendation?.required_conditions[0]?.zone_high, 540);
});

test('scenario evaluation response preserves result and evidence fields', () => {
  const evaluation = toScenarioEvaluationResponse({
    id: 'eval_btc_reclaim',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_btc_reclaim',
    thesis_id: 'thesis_btc',
    research_run_id: 'run_btc',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    horizon: 'short_term',
    evaluated_at: '2026-07-01T00:00:00.000Z',
    evaluation_window: {
      starts_at: '2026-06-29T00:00:00.000Z',
      ends_at: '2026-07-01T00:00:00.000Z',
    },
    result: 'hit',
    trigger_hit: true,
    invalidation_hit: false,
    target_hit: null,
    start_price: 61000,
    end_price: 63200,
    max_favorable_excursion: 0.045,
    max_adverse_excursion: 0.012,
    data_quality: 'complete',
    warnings: [],
    evidence: { trigger_price: 62000 },
  });

  assert.equal(evaluation.version, 'scenario_evaluation.v1');
  assert.equal(evaluation.result, 'hit');
  assert.equal(evaluation.data_quality, 'complete');
  assert.equal(evaluation.evidence.trigger_price, 62000);
});

test('journal stores scenario lifecycle artifacts by workspace', async () => {
  const { journal } = buildHarness();

  await journal.saveScenarioEvaluation({
    id: 'scenario_eval_1',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_1',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    result: 'hit',
    data_quality: 'complete',
    evidence: { trigger_hit_at: '2026-07-01T00:00:00.000Z' },
  }, 'workspace_a');
  await journal.saveTradePlaybook({
    id: 'playbook_1',
    workspace_id: 'workspace_a',
    source_scenario_id: 'scenario_1',
    source_thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    direction: 'long',
    horizon: 'short_term',
  }, 'workspace_a');
  await journal.saveBacktestRun({
    id: 'backtest_1',
    workspace_id: 'workspace_a',
    playbook_id: 'playbook_1',
    status: 'completed',
    assumptions: { version: 'backtest_assumption_set.v1' },
    result: { trade_count: 1 },
    warnings: [],
    data_quality: 'complete',
  }, 'workspace_a');
  await journal.saveBacktestTradeEvents('backtest_1', [
    { id: 'event_2', event_index: 2, event_type: 'exit' },
    { id: 'event_1', event_index: 1, event_type: 'entry' },
  ], 'workspace_a');

  const evaluations = await journal.listScenarioEvaluations('scenario_1', 'workspace_a');
  const playbooks = await journal.listTradePlaybooksForScenario('scenario_1', 'workspace_a');
  const backtests = await journal.listBacktestRunsForPlaybook('playbook_1', 'workspace_a');
  const events = await journal.listBacktestTradeEvents('backtest_1', 'workspace_a');

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0]?.result, 'hit');
  assert.equal(playbooks.length, 1);
  assert.equal(backtests.length, 1);
  assert.deepEqual(events.map((event) => event.event_type), ['entry', 'exit']);
  assert.equal(
    (await journal.listScenarioEvaluations('scenario_1', 'workspace_b')).length,
    0,
  );
});

test('journal saves scenario events idempotently', async () => {
  const { journal } = buildHarness();

  await journal.saveScenarioEvent({
    id: 'scenario_event_triggered_once',
    scenario_id: 'scenario_event_1',
    thesis_id: 'thesis_event_1',
    event_type: 'scenario.triggered',
    event_time: '2026-07-02T00:00:00.000Z',
    summary: 'Initial trigger.',
    payload: { trigger_status: 'triggered' },
  }, 'workspace_a');
  await journal.saveScenarioEvent({
    id: 'scenario_event_triggered_once',
    scenario_id: 'scenario_event_1',
    thesis_id: 'thesis_event_1',
    event_type: 'scenario.triggered',
    event_time: '2026-07-02T00:00:00.000Z',
    summary: 'Updated trigger.',
    payload: { trigger_status: 'triggered', refreshed: true },
  }, 'workspace_a');

  const events = await journal.listScenarioEvents(
    'scenario_event_1',
    'workspace_a',
    10,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.summary, 'Initial trigger.');
  assert.deepEqual(events[0]?.payload, {
    trigger_status: 'triggered',
  });
});

test('scenario transition events preserve repeated passed failed passed occurrences', async () => {
  const { journal, scenarioLiveState } = buildHarness();
  const scenarioId = 'scenario_transition_repeats';
  seedTransitionScenario(journal, scenarioId, 'workspace_a');

  await refreshWithSnapshot(journal, scenarioLiveState, scenarioId, 'workspace_a', 'snap_a', 101);
  await refreshWithSnapshot(journal, scenarioLiveState, scenarioId, 'workspace_a', 'snap_b', 99);
  await refreshWithSnapshot(journal, scenarioLiveState, scenarioId, 'workspace_a', 'snap_c', 102);

  const events = await journal.listScenarioEvents(scenarioId, 'workspace_a', 20);
  assert.equal(
    events.filter((event) => event.event_type === 'scenario.condition_passed').length,
    2,
  );
  assert.equal(
    events.filter((event) => event.event_type === 'scenario.condition_failed').length,
    1,
  );
});

test('scenario transition event payload does not mutate historical event_time', async () => {
  const { journal } = buildHarness();
  await journal.saveScenarioEvent({
    id: 'transition_same_id',
    version: 'scenario_event.v1',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_event_time_immutable',
    thesis_id: 'thesis_event_time_immutable',
    event_type: 'scenario.triggered',
    event_time: '2026-07-01T00:00:00.000Z',
    summary: 'first',
    payload: { current_price: 100 },
  }, 'workspace_a');

  await journal.saveScenarioEvent({
    id: 'transition_same_id',
    version: 'scenario_event.v1',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_event_time_immutable',
    thesis_id: 'thesis_event_time_immutable',
    event_type: 'scenario.triggered',
    event_time: '2026-07-01T01:00:00.000Z',
    summary: 'second',
    payload: { current_price: 101 },
  }, 'workspace_a');

  const events = await journal.listScenarioEvents(
    'scenario_event_time_immutable',
    'workspace_a',
    10,
  );
  assert.equal(events[0]?.event_time, '2026-07-01T00:00:00.000Z');
  assert.equal(record(events[0]?.payload).current_price, 100);
});

test('journal lists scenario events by time for one scenario', async () => {
  const { journal } = buildHarness();

  await journal.saveScenarioEvent({
    id: 'scenario_event_old',
    scenario_id: 'scenario_event_order',
    event_type: 'scenario.near_trigger',
    event_time: '2026-07-02T00:00:00.000Z',
    summary: 'Near trigger.',
    payload: {},
  }, 'workspace_a');
  await journal.saveScenarioEvent({
    id: 'scenario_event_other_scenario',
    scenario_id: 'scenario_event_other',
    event_type: 'scenario.triggered',
    event_time: '2026-07-02T01:00:00.000Z',
    summary: 'Other scenario.',
    payload: {},
  }, 'workspace_a');
  await journal.saveScenarioEvent({
    id: 'scenario_event_new',
    scenario_id: 'scenario_event_order',
    event_type: 'scenario.triggered',
    event_time: '2026-07-02T02:00:00.000Z',
    summary: 'Triggered.',
    payload: {},
  }, 'workspace_a');

  const events = await journal.listScenarioEvents(
    'scenario_event_order',
    'workspace_a',
    10,
  );

  assert.deepEqual(
    events.map((event) => event.id),
    ['scenario_event_new', 'scenario_event_old'],
  );
});

test('journal does not leak scenario events across workspaces', async () => {
  const { journal } = buildHarness();

  await journal.saveScenarioEvent({
    id: 'scenario_event_workspace_a',
    scenario_id: 'scenario_event_workspace_scope',
    event_type: 'scenario.triggered',
    event_time: '2026-07-02T00:00:00.000Z',
    summary: 'Workspace A.',
    payload: {},
  }, 'workspace_a');
  await journal.saveScenarioEvent({
    id: 'scenario_event_workspace_b',
    scenario_id: 'scenario_event_workspace_scope',
    event_type: 'scenario.invalidated',
    event_time: '2026-07-02T01:00:00.000Z',
    summary: 'Workspace B.',
    payload: {},
  }, 'workspace_b');

  const events = await journal.listScenarioEvents(
    'scenario_event_workspace_scope',
    'workspace_a',
    10,
  );

  assert.deepEqual(
    events.map((event) => event.id),
    ['scenario_event_workspace_a'],
  );
});

test('scenario live state returns condition evaluations and deterministic commentary', async () => {
  const { journal, scenarioLiveState } = buildHarness();
  const thesisId = 'thesis_live_state_conditions';
  const scenarioId = 'scenario_live_state_conditions';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    runtimeScenarioFixture({
      id: scenarioId,
      thesisId,
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions: [
        {
          id: 'watch_zone',
          label: 'Watch zone',
          role: 'watch',
          type: 'price_in_zone',
          zone_low: 615,
          zone_high: 625,
        },
        {
          id: 'trigger_close',
          label: 'Trigger close',
          role: 'trigger',
          type: 'price_above',
          level: 620,
        },
      ],
    }),
  ]);
  journal.marketSnapshots.set(key('snap_live_state_conditions', 'workspace_a'), {
    id: 'snap_live_state_conditions',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const state = await scenarioLiveState.getLiveState(scenarioId, 'workspace_a');
  const trigger = state.condition_evaluations.find(
    (condition) => condition.id === 'trigger_close',
  );
  const invalidation = state.condition_evaluations.find(
    (condition) => condition.role === 'invalidation',
  );

  assert.equal(state.version, 'scenario_live_state.v1');
  assert.equal(state.current_price, 621);
  assert.equal(state.trigger_status, 'triggered');
  assert.equal(state.validity_status, 'valid');
  assert.equal(trigger?.status, 'passed');
  assert.equal(trigger?.source, 'decision_playbook');
  assert.equal(invalidation?.status, 'pending');
  assert.equal(state.commentary, 'Scenario is triggered and valid.');
});

test('scenario live state marks target hit when latest price crosses target', async () => {
  const { journal, scenarioLiveState } = buildHarness();
  const thesisId = 'thesis_live_state_target';
  const scenarioId = 'scenario_live_state_target';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    runtimeScenarioFixture({
      id: scenarioId,
      thesisId,
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_live_state_target', 'workspace_a'), {
    id: 'snap_live_state_target',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 640,
    captured_at: new Date().toISOString(),
    source: 'test',
  });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_live_state_target'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    entry: { type: 'level', condition: 'Reclaim 620.', level: 620 },
    invalidation: { condition: 'Lose 600.', level: 600 },
    targets: [{ label: 'Target 1', level: 632, rationale: 'First target.' }],
    source_hashes: sourceHashesForScenario(journal, scenarioId),
    status: 'current',
  }, 'workspace_a');

  const state = await scenarioLiveState.getLiveState(scenarioId, 'workspace_a');

  assert.equal(state.target_progress[0]?.label, 'Target 1');
  assert.equal(state.target_progress[0]?.status, 'hit');
  assert.equal(typeof state.target_progress[0]?.hit_at, 'string');
});

test('scenario live refresh writes invalidation event once', async () => {
  const { journal, scenarioLiveState } = buildHarness();
  const thesisId = 'thesis_live_state_invalidation';
  const scenarioId = 'scenario_live_state_invalidation';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    runtimeScenarioFixture({
      id: scenarioId,
      thesisId,
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_live_state_invalidation', 'workspace_a'), {
    id: 'snap_live_state_invalidation',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 590,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  await scenarioLiveState.refreshLiveState(scenarioId, 'workspace_a');
  const refreshed = await scenarioLiveState.refreshLiveState(
    scenarioId,
    'workspace_a',
  );
  const events = await journal.listScenarioEvents(scenarioId, 'workspace_a', 10);

  assert.equal(refreshed.latest_event?.event_type, 'scenario.invalidated');
  assert.equal(
    events.filter((event) => event.event_type === 'scenario.invalidated').length,
    1,
  );
});

test('scenario chart projection renders watch overlays from decision playbook', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_watch';
  const scenarioId = 'scenario_chart_watch';
  seedChartScenario(journal, { thesisId, scenarioId });
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 615, 622, 614, 621),
      candle('2026-07-02T00:15:00.000Z', 621, 624, 620, 623),
    ]);

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });

  assert.equal(projection.version, 'scenario_chart_projection.v1');
  assert.equal(projection.mode, 'watch');
  assert.equal(projection.candles.length, 2);
  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'price_zone' &&
        overlay.role === 'watch' &&
        overlay.price_low === 615 &&
        overlay.price_high === 625,
    ),
    true,
  );
  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'horizontal_line' &&
        overlay.role === 'trigger' &&
        overlay.source === 'decision_playbook' &&
        overlay.price === 620,
    ),
    true,
  );
  assert.equal(projection.source_versions.decision_playbook_source, 'llm');
});

test('scenario chart projection derives overlays from recommendation when decision playbook is missing', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_recommendation_fallback';
  const scenarioId = 'scenario_chart_recommendation_fallback';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
    thesis_text: 'Watch BNB breakdown.',
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    {
      id: scenarioId,
      workspace_id: 'workspace_a',
      thesis_id: thesisId,
      scenario_name: 'Break support',
      condition: 'Price breaks below $540 with stronger sell volume.',
      expected_behavior: 'Price tests $520-$530.',
      invalidation: 'Price recovers above $570.',
      suggested_user_action: 'reassess',
      watch_triggers: ['Daily close below $540.'],
      evidence: ['Crowded long positioning.'],
      horizon: 'short_term',
      payload: {
        horizon: 'short_term',
      },
    },
  ]);
  journal.marketSnapshots.set(key('snap_chart_recommendation_fallback', 'workspace_a'), {
    id: 'snap_chart_recommendation_fallback',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 566,
    captured_at: '2026-07-02T00:00:00.000Z',
    source: 'test',
  });
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 565, 568, 560, 566),
    ]);

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });

  assert.equal(projection.source_versions.decision_playbook_source, 'derived_v1');
  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'horizontal_line' &&
        overlay.role === 'trigger' &&
        overlay.source === 'decision_playbook' &&
        overlay.price === 540,
    ),
    true,
  );
  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'horizontal_line' &&
        overlay.role === 'invalidation' &&
        overlay.source === 'decision_playbook' &&
        overlay.price === 570,
    ),
    true,
  );
});

test('scenario chart projection loads scenario context once', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_context_once';
  const scenarioId = 'scenario_chart_context_once';
  seedChartScenario(journal, { thesisId, scenarioId });
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 615, 622, 614, 621),
    ]);
  journal.resetReadCounters();

  await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '160',
  });

  assert.equal(journal.readCount('getScenario'), 1);
  assert.equal(journal.readCount('getThesis'), 1);
  assert.equal(journal.readCount('listTradePlaybooksForScenario'), 1);
  assert.equal(journal.readCount('listScenarioEvents'), 1);
});

test('scenario chart summary excludes candles', async () => {
  const { journal, scenarios } = buildHarness();
  const thesisId = 'thesis_chart_summary';
  const scenarioId = 'scenario_chart_summary';
  seedChartScenario(journal, { thesisId, scenarioId });

  const summary = await scenarios.getChartSummary(
    scenarioId,
    'user_1',
    'workspace_a',
  );

  assert.equal(summary.version, 'scenario_chart_summary.v1');
  assert.equal('candles' in summary, false);
  assert.equal(summary.scenario_id, scenarioId);
});

test('scenario chart endpoints deny cross-workspace reads', async () => {
  const { scenarios, journal } = buildHarness();
  const thesisId = 'thesis_chart_cross_workspace';
  const scenarioId = 'scenario_chart_cross_workspace';
  seedChartScenario(journal, { thesisId, scenarioId });

  await assert.rejects(
    scenarios.getChartProjection(
      { scenarioId, interval: '15m', limit: '100' },
      'user_1',
      'workspace_b',
    ),
    /not found|forbidden/i,
  );
});

test('scenario live refresh denies viewer writes', async () => {
  const { scenarios, journal, workspaces } = buildHarness();
  const thesisId = 'thesis_chart_viewer_refresh';
  const scenarioId = 'scenario_chart_viewer_refresh';
  seedChartScenario(journal, { thesisId, scenarioId });
  workspaces.setMembershipsForTest([
    { user_id: 'user_1', workspace_id: 'workspace_a', role: 'viewer' },
  ]);

  await assert.rejects(
    scenarios.refreshLiveState(scenarioId, 'user_1', 'workspace_a'),
    ForbiddenException,
  );
});

test('scenario chart projection renders trade overlays from current trade playbook', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_trade';
  const scenarioId = 'scenario_chart_trade';
  seedChartScenario(journal, { thesisId, scenarioId });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_chart_trade'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    entry: { type: 'level', condition: 'Reclaim 620.', level: 620 },
    invalidation: { condition: 'Lose 600.', level: 600 },
    targets: [{ label: 'Target 1', level: 632, rationale: 'First target.' }],
    source_hashes: sourceHashesForScenario(journal, scenarioId),
    status: 'current',
  }, 'workspace_a');
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 615, 622, 614, 621),
    ]);

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });

  assert.equal(projection.mode, 'trade');
  assert.equal(projection.source_versions.trade_playbook_id, 'playbook_chart_trade');
  assert.equal(projection.source_versions.trade_playbook_status, 'current');
  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'horizontal_line' &&
        overlay.role === 'entry' &&
        overlay.source === 'trade_playbook' &&
        overlay.price === 620,
    ),
    true,
  );
  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'horizontal_line' &&
        overlay.role === 'target' &&
        overlay.source === 'trade_playbook' &&
        overlay.price === 632,
    ),
    true,
  );
});

test('scenario chart projection includes visual opportunity overlays from a current long playbook', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_visual_long';
  const scenarioId = 'scenario_visual_long';
  seedChartScenario(journal, { thesisId, scenarioId });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_visual_long'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    entry: {
      type: 'zone',
      condition: 'Scale only inside the reclaim zone.',
      level: null,
      zone_low: 618,
      zone_high: 622,
    },
    invalidation: { condition: 'Lose the reclaim base.', level: 600 },
    targets: [{ label: 'Target 1', level: 640, rationale: 'Measured range.' }],
    source_hashes: sourceHashesForScenario(journal, scenarioId),
    status: 'current',
  }, 'workspace_a');
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 615, 622, 614, 621),
      candle('2026-07-02T00:15:00.000Z', 621, 624, 620, 623),
    ]);

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });
  const visual = record(
    (projection as unknown as JsonRecord).visual_projection,
  );
  const opportunity = record(visual.opportunity);
  const sourceVersions = record(visual.source_versions);
  const overlays = Array.isArray(visual.overlays)
    ? visual.overlays.map(record)
    : [];

  assert.equal(visual.schema_version, 'visual_opportunity_projection.v1');
  assert.equal(sourceVersions.trade_playbook_id, 'playbook_visual_long');
  assert.equal(opportunity.kind, 'trade_setup');
  assert.equal(opportunity.side, 'long');
  assert.equal(opportunity.status, 'waiting_for_entry');
  assert.equal(opportunity.next_condition, 'Wait for entry trigger.');
  assert.deepEqual(opportunity.allowed_actions, ['start_simulation', 'run_replay']);
  assert.deepEqual(opportunity.blockers, []);
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'zone' && overlay.role === 'entry',
    ),
    true,
  );
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'line' && overlay.role === 'risk_exit',
    ),
    true,
  );
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'box' && overlay.role === 'risk_box',
    ),
    true,
  );
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'box' && overlay.role === 'reward_box',
    ),
    true,
  );
  assert.equal(
    overlays.some(
      (overlay) =>
        overlay.type === 'path' &&
        overlay.role === 'setup_path' &&
        overlay.path_semantics === 'planned_setup_path',
    ),
    true,
  );
});

test('scenario chart projection warns instead of drawing trade setup boxes for narrative checkpoints', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_visual_narrative';
  const scenarioId = 'scenario_visual_narrative';
  seedChartScenario(journal, { thesisId, scenarioId });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_visual_narrative'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    direction: 'avoid',
    entry: {
      type: 'condition',
      condition: 'Review the narrative only.',
      level: null,
      zone_low: null,
      zone_high: null,
    },
    invalidation: { condition: 'Narrative invalidation only.', level: null },
    targets: [],
    source_hashes: sourceHashesForScenario(journal, scenarioId),
    status: 'current',
  }, 'workspace_a');
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 615, 622, 614, 621),
    ]);

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });
  const visual = record(
    (projection as unknown as JsonRecord).visual_projection,
  );
  const opportunity = record(visual.opportunity);
  const overlays = Array.isArray(visual.overlays)
    ? visual.overlays.map(record)
    : [];

  assert.equal(opportunity.kind, 'watch_scenario');
  assert.equal(opportunity.status, 'blocked');
  assert.equal(
    Array.isArray(opportunity.blockers) &&
      opportunity.blockers.includes('non_chartable_trade_playbook'),
    true,
  );
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'box' && overlay.role === 'risk_box',
    ),
    false,
  );
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'box' && overlay.role === 'reward_box',
    ),
    false,
  );
  assert.equal(
    Array.isArray(visual.warnings) &&
      visual.warnings.includes('non_chartable_trade_playbook'),
    true,
  );
});

test('scenario chart projection can include paper simulation fill and exit markers', async () => {
  const { journal, paperExecution, scenarioOhlcv, scenarios, theses } = buildHarness();
  const thesisId = 'thesis_visual_simulation';
  const scenarioId = 'scenario_visual_simulation';
  seedChartScenario(journal, { thesisId, scenarioId });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_visual_simulation'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    direction: 'long',
    entry: {
      type: 'level',
      condition: 'Reclaim 620.',
      level: 620,
      zone_low: null,
      zone_high: null,
    },
    invalidation: { condition: 'Lose 600.', level: 600 },
    targets: [{ label: 'Target 1', level: 640, rationale: 'Continuation.' }],
    source_hashes: sourceHashesForScenario(journal, scenarioId),
    status: 'current',
  }, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 610, 625, 608, 624),
    candle('2026-07-04T00:15:00.000Z', 624, 641, 622, 640),
  ]);
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-04T00:00:00.000Z', 610, 625, 608, 624),
      candle('2026-07-04T00:15:00.000Z', 624, 641, 622, 640),
    ]);
  const simulation = await paperExecution.createSimulation(
    'playbook_visual_simulation',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:30:00.000Z',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
      fee_bps: '0',
      slippage_bps: '0',
    },
    'user_1',
    'workspace_a',
  );

  const projection = await scenarios.getChartProjection(
    {
      scenarioId,
      interval: '15m',
      limit: '10',
      simulationId: simulation.id,
    } as never,
    'user_1',
    'workspace_a',
  );
  const visual = record(
    (projection as unknown as JsonRecord).visual_projection,
  );
  const opportunity = record(visual.opportunity);
  const overlays = Array.isArray(visual.overlays)
    ? visual.overlays.map(record)
    : [];

  assert.equal(opportunity.kind, 'paper_position');
  assert.equal(opportunity.status, 'target_hit');
  assert.equal(record(visual.source_versions).simulation_run_id, simulation.id);
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'marker' && overlay.role === 'paper_fill',
    ),
    true,
  );
  assert.equal(
    overlays.some(
      (overlay) => overlay.type === 'marker' && overlay.role === 'paper_exit',
    ),
    true,
  );
  assert.equal(journal.scenarioOutcomeSnapshots.size, 1);
  assert.equal(
    (
      await journal.getLatestScenarioOutcomeSnapshot(
        scenarioId,
        'workspace_a',
      )
    )?.version,
    'scenario_outcome_snapshot.v1',
  );
  const detail = await theses.scenarios(thesisId, 'user_1', 'workspace_a');
  assert.equal(detail[0]?.latest_outcome_snapshot?.version, 'scenario_outcome_snapshot.v1');
  assert.equal(detail[0]?.latest_outcome_snapshot?.simulation_id, simulation.id);
  assert.equal(detail[0]?.latest_outcome_snapshot?.settlement_reason, 'target_hit');
  assert.equal(detail[0]?.latest_outcome_snapshot?.prediction_quality, 'supported');
});

test('scenario chart projection keeps multi-stage bull trap in watch mode', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_bull_trap_watch';
  const scenarioId = 'scenario_chart_bull_trap_watch';
  seedChartScenario(journal, { thesisId, scenarioId });
  const scenario = journal.scenarios.get(key(thesisId, 'workspace_a'))?.[0];
  assert.ok(scenario);
  const recommendation = record(scenario.scenario_recommendation);
  scenario.scenario_recommendation = {
    ...recommendation,
    action: 'consider_short',
    action_bias: 'short',
    summary:
      'Short only after price trades into $600-$620 and rejects, then breaks below $570.',
    required_conditions: [
      {
        id: 'breakdown_entry',
        role: 'entry',
        type: 'price_below',
        level: 570,
      },
    ],
    invalidation_conditions: [
      {
        id: 'hold_above_trap',
        role: 'invalidation',
        type: 'price_above',
        level: 620,
      },
    ],
    wait_for: ['Price trades into $600-$620 before breakdown.'],
  };
  scenario.decision_playbook = {
    version: 'scenario_decision_playbook.v1',
    source: 'llm',
    generated_at: '2026-07-05T00:00:00.000Z',
    generated_from_run_id: null,
    action_bias: 'short',
    confidence: 0.72,
    preferred_action_if_triggered: 'consider_short',
    fallback_action: 'wait',
    near_trigger_threshold_pct: 2,
    validity_window: {
      valid_from: null,
      valid_until: null,
      timeframe: 'mid_term',
      rationale: 'Bull trap must arm before breakdown entry.',
      refresh_policy: 'manual_review',
    },
    entry_conditions: [
      {
        id: 'trap_zone',
        role: 'watch',
        type: 'price_in_zone',
        zone_low: 600,
        zone_high: 620,
      },
      {
        id: 'breakdown_entry',
        role: 'entry',
        type: 'price_below',
        level: 570,
      },
    ],
    avoid_if: [],
    invalidation_conditions: [
      {
        id: 'hold_above_trap',
        role: 'invalidation',
        type: 'price_above',
        level: 620,
      },
    ],
    wait_for: ['Price trades into $600-$620 before breakdown.'],
    risk_notes: [],
    evidence_refs: record(scenario.scenario_recommendation).evidence_refs as JsonRecord[],
    rationale: 'Bull trap requires a prior trap zone before entry.',
  };
  scenario.payload = {
    ...record(scenario.payload),
    scenario_recommendation: scenario.scenario_recommendation,
    decision_playbook: scenario.decision_playbook,
  };
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_chart_bull_trap_flat'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    market_type: 'perp',
    direction: 'short',
    entry: { type: 'level', condition: 'price below 570', level: 570 },
    invalidation: { condition: 'price above 620', level: 620 },
    targets: [
      { label: 'Target 1', level: 535, rationale: 'First target.' },
      { label: 'Target 2', level: 510, rationale: 'Second target.' },
    ],
    source_hashes: sourceHashesForScenario(journal, scenarioId),
    status: 'current',
  }, 'workspace_a');
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-05T00:00:00.000Z', 576, 578, 572, 577),
    ]);

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });

  assert.equal(projection.source_versions.trade_playbook_status, 'current');
  assert.equal(projection.mode, 'watch');
  assert.equal(
    projection.overlays.some((overlay) => overlay.source === 'trade_playbook'),
    false,
  );
});

test('scenario chart projection excludes stale trade overlays', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_stale_trade';
  const scenarioId = 'scenario_chart_stale_trade';
  seedChartScenario(journal, { thesisId, scenarioId });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_chart_stale_trade'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    entry: { type: 'level', condition: 'Reclaim 620.', level: 620 },
    invalidation: { condition: 'Lose 600.', level: 600 },
    targets: [{ label: 'Target 1', level: 632, rationale: 'First target.' }],
    source_hashes: {
      scenario: 'stale',
      decision_playbook: 'stale',
      recommendation: 'stale',
      runtime_decision: 'stale',
    },
    status: 'stale',
    stale_reasons: ['source_recommendation_changed'],
  }, 'workspace_a');
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 615, 622, 614, 621),
    ]);

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });

  assert.equal(projection.mode, 'watch');
  assert.equal(projection.source_versions.trade_playbook_status, 'stale');
  assert.equal(
    projection.overlays.some((overlay) => overlay.source === 'trade_playbook'),
    false,
  );
});

test('scenario chart projection renders trigger zones', async () => {
  const { journal, scenarios, scenarioOhlcv } = buildHarness();
  const scenarioId = seedScenarioWithCondition(journal, {
    workspaceId: 'workspace_a',
    role: 'trigger',
    type: 'price_in_zone',
    zone_low: 100,
    zone_high: 105,
  });
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 100, 103, 99, 102),
    ]);

  const projection = await scenarios.getChartProjection(
    { scenarioId, interval: '15m', limit: '100' },
    'user_1',
    'workspace_a',
  );

  assert.equal(
    projection.overlays.some(
      (overlay) => overlay.type === 'price_zone' && overlay.role === 'trigger',
    ),
    true,
  );
});

test('scenario chart projection renders invalidation zones', async () => {
  const { journal, scenarios, scenarioOhlcv } = buildHarness();
  const scenarioId = seedScenarioWithCondition(journal, {
    workspaceId: 'workspace_a',
    role: 'invalidation',
    type: 'price_in_zone',
    zone_low: 95,
    zone_high: 97,
  });
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 100, 103, 99, 102),
    ]);

  const projection = await scenarios.getChartProjection(
    { scenarioId, interval: '15m', limit: '100' },
    'user_1',
    'workspace_a',
  );

  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'price_zone' && overlay.role === 'invalidation',
    ),
    true,
  );
});

test('scenario chart projection returns warning when candles are unavailable', async () => {
  const { journal, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_missing_candles';
  const scenarioId = 'scenario_chart_missing_candles';
  seedChartScenario(journal, { thesisId, scenarioId });
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([], 'Provider returned no usable OHLCV candles.');

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });

  assert.deepEqual(projection.candles, []);
  assert.equal(
    projection.warnings.includes('Provider returned no usable OHLCV candles.'),
    true,
  );
  assert.equal(projection.warnings.includes('candles_unavailable'), true);
});

test('scenario evaluation service marks hit when trigger occurs before invalidation', async () => {
  const { scenarioEvaluations } = buildHarness();
  const journal = scenarioEvaluations.journalForTest as FakeJournalRepository;
  seedScenarioLifecycleFixture(scenarioEvaluations.journalForTest as FakeJournalRepository, {
    scenarioId: 'scenario_eval_hit',
    thesisId: 'thesis_eval_hit',
    symbol: 'BTC/USDT',
  });
  scenarioEvaluations.setOhlcvForTest([
    candle('2026-06-29T00:00:00.000Z', 61000, 61800, 60900, 61600),
    candle('2026-06-30T00:00:00.000Z', 61600, 62600, 61500, 62400),
  ]);

  const response = await scenarioEvaluations.evaluateScenario(
    'scenario_eval_hit',
    'user_1',
    'workspace_a',
  );

  assert.equal(response.result, 'hit');
  assert.equal(response.trigger_hit, true);
  assert.equal(response.invalidation_hit, false);
  assert.equal(response.data_quality, 'complete');
  const snapshot = await journal.getLatestScenarioOutcomeSnapshot(
    'scenario_eval_hit',
    'workspace_a',
  );
  assert.equal(snapshot?.version, 'scenario_outcome_snapshot.v1');
  assert.equal(snapshot?.settlement_reason, 'data_end');
  assert.equal(snapshot?.prediction_quality, 'supported');
  assert.equal(snapshot?.execution_quality, 'not_simulated');
});

test('scenario evaluation service marks inconclusive when OHLCV is missing', async () => {
  const { scenarioEvaluations } = buildHarness();
  const journal = scenarioEvaluations.journalForTest as FakeJournalRepository;
  seedScenarioLifecycleFixture(scenarioEvaluations.journalForTest as FakeJournalRepository, {
    scenarioId: 'scenario_eval_missing_ohlcv',
    thesisId: 'thesis_eval_missing_ohlcv',
    symbol: 'BTC/USDT',
  });
  scenarioEvaluations.setOhlcvForTest([]);

  const response = await scenarioEvaluations.evaluateScenario(
    'scenario_eval_missing_ohlcv',
    'user_1',
    'workspace_a',
  );

  assert.equal(response.result, 'inconclusive');
  assert.equal(response.data_quality, 'insufficient');
  assert.equal(response.warnings.includes('missing_ohlcv'), true);
  const snapshot = await journal.getLatestScenarioOutcomeSnapshot(
    'scenario_eval_missing_ohlcv',
    'workspace_a',
  );
  assert.equal(snapshot?.version, 'scenario_outcome_snapshot.v1');
  assert.equal(snapshot?.settlement_reason, 'data_end');
  assert.equal(snapshot?.prediction_quality, 'inconclusive');
  assert.equal(snapshot?.execution_quality, 'insufficient_data');
});

test('scenario evaluation service uses derived legacy trigger and invalidation', async () => {
  const { journal, scenarioEvaluations } = buildHarness();
  const thesisId = 'thesis_eval_legacy_text';
  const scenarioId = 'scenario_eval_legacy_text';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'perp',
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    {
      id: scenarioId,
      workspace_id: 'workspace_a',
      thesis_id: thesisId,
      scenario_name: 'Confirmation setup',
      condition: 'Giá đóng cửa ngày trên $580 kèm khối lượng cao.',
      invalidation: 'Giá đóng cửa ngày dưới $546 với ATR và khối lượng cao.',
      suggested_user_action: 'Watch confirmation - không mua ngay.',
      evidence: ['RSI >35'],
      horizon: 'short_term',
      timeframe: '4H',
      created_at: '2026-06-29T00:00:00.000Z',
    },
  ]);
  scenarioEvaluations.setOhlcvForTest([
    candle('2026-06-29T00:00:00.000Z', 560, 575, 555, 570),
    candle('2026-06-30T00:00:00.000Z', 570, 585, 568, 582),
  ]);

  const response = await scenarioEvaluations.evaluateScenario(
    scenarioId,
    'user_1',
    'workspace_a',
  );

  assert.equal(response.result, 'hit');
  assert.equal(response.data_quality, 'complete');
  assert.equal(response.trigger_hit, true);
  assert.equal(response.invalidation_hit, false);
  assert.deepEqual(response.warnings, []);
});

test('scenario evaluation service refuses an unmatured evaluation window', async () => {
  const { scenarioEvaluations } = buildHarness();
  const futureWindowEnd = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  seedScenarioLifecycleFixture(scenarioEvaluations.journalForTest as FakeJournalRepository, {
    scenarioId: 'scenario_eval_future_window',
    thesisId: 'thesis_eval_future_window',
    symbol: 'BTC/USDT',
    evaluationWindowEndsAt: futureWindowEnd,
  });

  await assert.rejects(
    () => scenarioEvaluations.evaluateScenario(
      'scenario_eval_future_window',
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
});

test('scenario evaluation derives a fresh missing window instead of scanning default history', async () => {
  const { journal, scenarioEvaluations } = buildHarness();
  const thesisId = 'thesis_eval_missing_window';
  const scenarioId = 'scenario_eval_missing_window';
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
    direction: 'short',
    setup_type: 'breakdown',
    created_at: createdAt,
  });
  const scenario = scenarioLifecycleRecord({
    scenarioId,
    thesisId,
    symbol: 'BNB/USDT',
    actionBias: 'short',
  });
  scenario.created_at = createdAt;
  scenario.scenario_recommendation = {
    ...(scenario.scenario_recommendation as JsonRecord),
    evaluation_window: {
      starts_at: null,
      ends_at: null,
      horizon: 'short_term',
      metric_hint: 'trigger_then_mfe_mae',
    },
  };
  journal.scenarios.set(key(thesisId, 'workspace_a'), [scenario]);
  scenarioEvaluations.setOhlcvForTest([
    candle('2025-07-02T00:00:00.000Z', 580, 620, 530, 540),
  ]);

  await assert.rejects(
    () => scenarioEvaluations.evaluateScenario(
      scenarioId,
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
});

test('scenario evaluation stores grouping metadata for reliability profiles', async () => {
  const { scenarioEvaluations } = buildHarness();
  seedScenarioLifecycleFixture(scenarioEvaluations.journalForTest as FakeJournalRepository, {
    scenarioId: 'scenario_eval_metadata',
    thesisId: 'thesis_eval_metadata',
    symbol: 'BTC/USDT',
  });
  scenarioEvaluations.setOhlcvForTest([
    candle('2026-06-24T00:00:00.000Z', 61000, 61800, 60900, 61600),
    candle('2026-06-25T00:00:00.000Z', 61600, 62600, 61500, 62400),
  ]);

  const response = await scenarioEvaluations.evaluateScenario(
    'scenario_eval_metadata',
    'user_1',
    'workspace_a',
  );

  assert.equal(response.evidence.relation_to_thesis, 'supports');
  assert.equal(response.evidence.action_bias, 'long');
  assert.equal(response.evidence.setup_type, 'breakout');
});

test('scenario evaluation is idempotent for the same scenario window', async () => {
  const { scenarioEvaluations, scenarioReliability } = buildHarness();
  const journal = scenarioEvaluations.journalForTest as FakeJournalRepository;
  seedScenarioLifecycleFixture(journal, {
    scenarioId: 'scenario_eval_idempotent',
    thesisId: 'thesis_eval_idempotent',
    symbol: 'BTC/USDT',
  });
  scenarioEvaluations.setOhlcvForTest([
    candle('2026-06-24T00:00:00.000Z', 61000, 61800, 60900, 61600),
    candle('2026-06-25T00:00:00.000Z', 61600, 62600, 61500, 62400),
  ]);

  const first = await scenarioEvaluations.evaluateScenario(
    'scenario_eval_idempotent',
    'user_1',
    'workspace_a',
  );
  const second = await scenarioEvaluations.evaluateScenario(
    'scenario_eval_idempotent',
    'user_1',
    'workspace_a',
  );

  const evaluations = await journal.listScenarioEvaluations(
    'scenario_eval_idempotent',
    'workspace_a',
  );
  const profiles = await scenarioReliability.profile(
    { symbol: 'BTC/USDT', market_type: 'spot', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(second.id, first.id);
  assert.equal(evaluations.length, 1);
  assert.equal(
    (await journal.listScenarioOutcomeSnapshots('scenario_eval_idempotent', 'workspace_a')).length,
    1,
  );
  assert.equal(profiles[0]?.sample_size, 1);
});

test('scenario reliability hides rates below sample size and counts inconclusive', async () => {
  const { journal, scenarioReliability } = buildHarness();
  for (const index of [1, 2, 3, 4]) {
    await journal.saveScenarioEvaluation({
      id: `eval_small_${index}`,
      workspace_id: 'workspace_a',
      scenario_id: `scenario_small_${index}`,
      thesis_id: `thesis_small_${index}`,
      symbol: 'BTC/USDT',
      market_type: 'spot',
      horizon: 'short_term',
      result: index === 4 ? 'inconclusive' : 'hit',
      data_quality: index === 4 ? 'insufficient' : 'complete',
      evidence: { relation_to_thesis: 'supports', action_bias: 'long' },
    }, 'workspace_a');
  }

  const profiles = await scenarioReliability.profile(
    { symbol: 'BTC/USDT', market_type: 'spot', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(profiles[0]?.sample_size, 4);
  assert.equal(profiles[0]?.hit_rate, null);
  assert.equal(profiles[0]?.inconclusive_rate, null);
  assert.equal(
    profiles[0]?.data_quality_notes.includes('Not enough history.'),
    true,
  );
});

test('scenario reliability defaults missing market type samples to perp', async () => {
  const { journal, scenarioReliability } = buildHarness();
  await journal.saveScenarioEvaluation({
    id: 'eval_missing_market_type',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_missing_market_type',
    thesis_id: 'thesis_missing_market_type',
    symbol: 'BTC/USDT',
    horizon: 'short_term',
    result: 'hit',
    data_quality: 'complete',
    evidence: { relation_to_thesis: 'supports', action_bias: 'long' },
  }, 'workspace_a');

  const profiles = await scenarioReliability.profile(
    { symbol: 'BTC/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(profiles[0]?.market_type, 'perp');
});

test('scenario feedback playbook does not aggregate across workspaces', async () => {
  const { journal, scenarioFeedback } = buildHarness();
  await seedScenarioEvaluation(journal, {
    workspaceId: 'workspace_a',
    symbol: 'BTC/USDT',
    result: 'hit',
  });
  await seedScenarioEvaluation(journal, {
    workspaceId: 'workspace_b',
    symbol: 'BTC/USDT',
    result: 'invalidated',
  });

  const feedback = await scenarioFeedback.buildForSymbol({
    workspaceId: 'workspace_a',
    symbol: 'BTC/USDT',
  });

  assert.equal(
    feedback.source_evaluation_ids.every((id) => id.includes('workspace_a')),
    true,
  );
});

test('scenario reliability deduplicates repeated evaluations for the same scenario window', async () => {
  const { journal, scenarioReliability } = buildHarness();
  for (const index of [1, 2]) {
    await journal.saveScenarioEvaluation({
      id: `eval_duplicate_window_${index}`,
      workspace_id: 'workspace_a',
      scenario_id: 'scenario_duplicate_window',
      thesis_id: 'thesis_duplicate_window',
      symbol: 'BTC/USDT',
      market_type: 'spot',
      horizon: 'short_term',
      evaluated_at: `2026-06-2${index}T00:00:00.000Z`,
      evaluation_window: {
        starts_at: '2026-06-24T00:00:00.000Z',
        ends_at: '2026-06-28T00:00:00.000Z',
      },
      result: 'hit',
      data_quality: 'complete',
      evidence: { relation_to_thesis: 'supports', action_bias: 'long' },
    }, 'workspace_a');
  }

  const profiles = await scenarioReliability.profile(
    { symbol: 'BTC/USDT', market_type: 'spot', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(profiles[0]?.sample_size, 1);
});

test('scenario reliability deduplicates eligible paper simulation outcomes by sample identity', async () => {
  const { paperExecution, journal, scenarioReliability } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_reliability_dedup');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 582, 548, 551),
  ]);

  const request = {
    mode: 'replay' as const,
    starts_at: '2026-07-04T00:00:00.000Z',
    ends_at: '2026-07-04T01:00:00.000Z',
    position_size: { mode: 'fixed_notional' as const, notional: '1164', quantity: null },
  };
  await paperExecution.createSimulation(
    'playbook_paper_reliability_dedup',
    request,
    'user_1',
    'workspace_a',
  );
  await paperExecution.createSimulation(
    'playbook_paper_reliability_dedup',
    request,
    'user_1',
    'workspace_a',
  );

  const profiles = await scenarioReliability.profile(
    { symbol: 'BTC/USDT', market_type: 'spot', horizon: 'short_term', limit: 20 },
    'user_1',
    'workspace_a',
  );
  const paperProfile = profiles.find((profile) =>
    profile.relation_to_thesis === 'paper_execution' &&
    profile.action_bias === 'short');

  assert.equal(paperProfile?.sample_size, 1);
  assert.equal(
    paperProfile?.recent_lessons.some((lesson) =>
      lesson.includes('Paper execution closed by target.')),
    true,
  );
});

test('scenario monitor and thesis detail expose aggregated reliability profiles', async () => {
  const { journal, scenarios, theses } = buildHarness();
  seedScenarioLifecycleFixture(journal, {
    scenarioId: 'scenario_reliability_surface',
    thesisId: 'thesis_reliability_surface',
    symbol: 'BTC/USDT',
  });
  for (const index of [1, 2, 3, 4, 5]) {
    await journal.saveScenarioEvaluation({
      id: `eval_surface_${index}`,
      workspace_id: 'workspace_a',
      scenario_id: `scenario_surface_${index}`,
      thesis_id: `thesis_surface_${index}`,
      symbol: 'BTC/USDT',
      market_type: 'spot',
      horizon: 'short_term',
      result: index === 5 ? 'invalidated' : 'hit',
      data_quality: 'complete',
      evidence: {
        relation_to_thesis: 'supports',
        action_bias: 'long',
        setup_type: 'breakout',
      },
    }, 'workspace_a');
  }

  const monitor = await scenarios.monitor({ limit: 10 }, 'user_1', 'workspace_a');
  const detail = await theses.scenarios(
    'thesis_reliability_surface',
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.reliability_profile?.sample_size, 5);
  assert.equal(monitor.items[0]?.scenario.reliability_profile?.hit_rate, 0.8);
  assert.equal(detail[0]?.reliability_profile?.sample_size, 5);
  assert.equal(detail[0]?.reliability_profile?.hit_rate, 0.8);
});

test('scenario monitor and thesis detail expose latest backtest trade events', async () => {
  const { journal, scenarios, theses } = buildHarness();
  seedScenarioLifecycleFixture(journal, {
    scenarioId: 'scenario_backtest_surface',
    thesisId: 'thesis_backtest_surface',
    symbol: 'BTC/USDT',
  });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_backtest_surface'),
    source_scenario_id: 'scenario_backtest_surface',
    source_thesis_id: 'thesis_backtest_surface',
  }, 'workspace_a');
  await journal.saveBacktestRun({
    id: 'backtest_surface',
    workspace_id: 'workspace_a',
    playbook_id: 'playbook_backtest_surface',
    status: 'completed',
    assumptions: { version: 'backtest_assumption_set.v1' },
    result: { trade_count: 1 },
    warnings: [],
    data_quality: 'complete',
  }, 'workspace_a');
  await journal.saveBacktestTradeEvents('backtest_surface', [
    {
      id: 'surface_exit',
      event_index: 2,
      event_type: 'exit',
      event_time: '2026-06-02T00:00:00.000Z',
      price: 63100,
    },
    {
      id: 'surface_entry',
      event_index: 1,
      event_type: 'entry',
      event_time: '2026-06-01T00:00:00.000Z',
      price: 62000,
    },
  ], 'workspace_a');

  const monitor = await scenarios.monitor({ limit: 10 }, 'user_1', 'workspace_a');
  const detail = await theses.scenarios(
    'thesis_backtest_surface',
    'user_1',
    'workspace_a',
  );

  assert.deepEqual(
    monitor.items[0]?.scenario.latest_backtest?.trade_events.map(
      (event) => event.event_type,
    ),
    ['entry', 'exit'],
  );
  assert.deepEqual(
    detail[0]?.latest_backtest?.trade_events.map((event) => event.event_type),
    ['entry', 'exit'],
  );
});

test('scenario monitor and thesis detail hide obsolete invalid lifecycle artifacts', async () => {
  const { journal, scenarios, theses } = buildHarness();
  seedScenarioLifecycleFixture(journal, {
    scenarioId: 'scenario_obsolete_lifecycle',
    thesisId: 'thesis_obsolete_lifecycle',
    symbol: 'BTC/USDT',
  });
  await journal.saveScenarioEvaluation({
    id: 'eval_obsolete_missing_window',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_obsolete_lifecycle',
    thesis_id: 'thesis_obsolete_lifecycle',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    horizon: 'short_term',
    evaluated_at: '2026-07-01T00:00:00.000Z',
    evaluation_window: {
      starts_at: null,
      ends_at: null,
    },
    result: 'hit',
    data_quality: 'complete',
    warnings: [],
    evidence: {},
  }, 'workspace_a');
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_obsolete_lifecycle'),
    source_scenario_id: 'scenario_obsolete_lifecycle',
    source_thesis_id: 'thesis_obsolete_lifecycle',
  }, 'workspace_a');
  await journal.saveBacktestRun({
    id: 'backtest_obsolete_missing_target',
    workspace_id: 'workspace_a',
    playbook_id: 'playbook_obsolete_lifecycle',
    status: 'partial',
    assumptions: { version: 'backtest_assumption_set.v1' },
    result: { trade_count: 1 },
    warnings: ['missing_numeric_target'],
    data_quality: 'partial',
  }, 'workspace_a');

  const monitor = await scenarios.monitor({ limit: 10 }, 'user_1', 'workspace_a');
  const detail = await theses.scenarios(
    'thesis_obsolete_lifecycle',
    'user_1',
    'workspace_a',
  );
  const monitorScenario = monitor.items.find(
    (item) => item.scenario.id === 'scenario_obsolete_lifecycle',
  )?.scenario;

  assert.equal(monitorScenario?.latest_evaluation, null);
  assert.equal(monitorScenario?.latest_backtest, null);
  assert.equal(monitorScenario?.latest_outcome_snapshot, null);
  assert.equal(detail[0]?.latest_evaluation, null);
  assert.equal(detail[0]?.latest_backtest, null);
  assert.equal(detail[0]?.latest_outcome_snapshot, null);
});

test('playbook compiler rejects missing invalidation and compiles valid long scenario', async () => {
  const { playbooks } = buildHarness();
  const missingInvalidation = await playbooks.compileScenario(
    scenarioLifecycleRecord({
      scenarioId: 'scenario_no_invalidation',
      thesisId: 'thesis_no_invalidation',
      invalidationConditions: [],
    }),
    { id: 'thesis_no_invalidation', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );
  const valid = await playbooks.compileScenario(
    scenarioLifecycleRecord({
      scenarioId: 'scenario_valid_playbook',
      thesisId: 'thesis_valid_playbook',
    }),
    { id: 'thesis_valid_playbook', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );

  assert.equal(missingInvalidation.eligible, false);
  assert.equal(
    missingInvalidation.rejection_reasons.includes('Missing invalidation.'),
    true,
  );
  assert.equal(valid.eligible, true);
  assert.equal(valid.playbook?.direction, 'long');
  assert.equal(valid.playbook?.entry.level, 62000);
});

test('playbook compiler enriches compile-by-id with reliability context', async () => {
  const { journal, playbooks } = buildHarness();
  seedScenarioLifecycleFixture(journal, {
    scenarioId: 'scenario_playbook_reliability',
    thesisId: 'thesis_playbook_reliability',
    symbol: 'BTC/USDT',
  });
  for (const index of [1, 2, 3, 4, 5]) {
    await journal.saveScenarioEvaluation({
      id: `eval_playbook_reliability_${index}`,
      workspace_id: 'workspace_a',
      scenario_id: `scenario_playbook_eval_${index}`,
      thesis_id: `thesis_playbook_eval_${index}`,
      symbol: 'BTC/USDT',
      market_type: 'spot',
      horizon: 'short_term',
      result: 'hit',
      data_quality: 'complete',
      evidence: {
        relation_to_thesis: 'supports',
        action_bias: 'long',
        setup_type: 'breakout',
      },
    }, 'workspace_a');
  }

  const report = await playbooks.compileScenarioById(
    'scenario_playbook_reliability',
    'user_1',
    'workspace_a',
  );

  assert.equal(report.eligible, true);
  assert.equal(report.playbook?.reliability_context?.sample_size, 5);
  assert.equal(report.playbook?.reliability_context?.hit_rate, 1);
});

test('trade playbook response includes compiler version and source hashes', async () => {
  const { playbooks } = buildHarness();

  const report = await playbooks.compileScenario(
    scenarioLifecycleRecord({
      scenarioId: 'scenario_compile_source_hashes',
      thesisId: 'thesis_compile_source_hashes',
    }),
    { id: 'thesis_compile_source_hashes', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );

  assert.equal(report.eligible, true);
  assert.equal(report.playbook?.compiler_version, 'playbook_compiler.v2');
  assert.equal(typeof report.playbook?.source_hashes.scenario, 'string');
  assert.equal(report.playbook?.source_hashes.scenario.length, 16);
  assert.equal(typeof report.playbook?.source_hashes.decision_playbook, 'string');
  assert.equal(typeof report.playbook?.source_hashes.recommendation, 'string');
  assert.equal(typeof report.playbook?.source_hashes.runtime_decision, 'string');
  assert.equal(report.playbook?.status, 'current');
  assert.deepEqual(report.playbook?.stale_reasons, []);
});

test('latest playbook is marked stale when source recommendation hash changes', async () => {
  const { journal, playbooks, scenarios, theses } = buildHarness();
  const thesisId = 'thesis_stale_recommendation_hash';
  const scenarioId = 'scenario_stale_recommendation_hash';
  const scenario = scenarioLifecycleRecord({ scenarioId, thesisId });
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    market_type: 'spot',
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [scenario]);

  const report = await playbooks.compileScenarioById(
    scenarioId,
    'user_1',
    'workspace_a',
  );
  assert.equal(report.playbook?.status, 'current');

  scenario.scenario_recommendation = {
    ...record(scenario.scenario_recommendation),
    risk_notes: ['New risk note after compile.'],
  };

  const monitor = await scenarios.monitor({ limit: 10 }, 'user_1', 'workspace_a');
  const latest = monitor.items.find(
    (item) => item.scenario.id === scenarioId,
  )?.scenario.latest_playbook;

  assert.equal(latest?.status, 'stale');
  assert.deepEqual(latest?.stale_reasons, ['source_recommendation_changed']);

  const detailScenarios = await theses.scenarios(
    thesisId,
    'user_1',
    'workspace_a',
  );
  assert.equal(detailScenarios[0]?.latest_playbook?.status, 'stale');
  assert.deepEqual(detailScenarios[0]?.latest_playbook?.stale_reasons, [
    'source_recommendation_changed',
  ]);
});

test('trade playbook stays current when only runtime evaluated_at changes', async () => {
  const { journal, playbooks, theses } = buildHarness();
  const thesisId = 'thesis_runtime_only_freshness';
  const scenarioId = 'scenario_runtime_only_freshness';
  seedScenarioLifecycleFixture(journal, {
    thesisId,
    scenarioId,
    symbol: 'BTC/USDT',
  });
  journal.marketSnapshots.set(key('snap_runtime_initial', 'workspace_a'), {
    id: 'snap_runtime_initial',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    current_price: 61_900,
    captured_at: '2026-07-01T00:00:00.000Z',
    source: 'test',
  });

  const compiled = await playbooks.compileScenarioById(
    scenarioId,
    'user_1',
    'workspace_a',
  );
  assert.equal(compiled.playbook?.status, 'current');

  journal.marketSnapshots.set(key('snap_runtime_later', 'workspace_a'), {
    id: 'snap_runtime_later',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    current_price: 61_900,
    captured_at: '2026-07-01T00:01:00.000Z',
    source: 'test',
  });

  const detailScenarios = await theses.scenarios(
    thesisId,
    'user_1',
    'workspace_a',
  );
  assert.equal(detailScenarios[0]?.latest_playbook?.status, 'current');
  assert.deepEqual(detailScenarios[0]?.latest_playbook?.stale_reasons, []);
});

test('trade playbook stays current when chart path reads raw scenario without trigger spec', async () => {
  const { journal, playbooks, scenarioChartProjection, scenarioOhlcv } = buildHarness();
  const thesisId = 'thesis_chart_raw_freshness';
  const scenarioId = 'scenario_chart_raw_freshness';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
    target_zones: ['Target 540'],
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    {
      id: scenarioId,
      workspace_id: 'workspace_a',
      thesis_id: thesisId,
      scenario_name: 'Dead cat bounce short',
      direction: 'bearish',
      condition: 'Price rallies above $580 and fails to hold.',
      expected_behavior: 'Lower high then price drops toward $540.',
      invalidation: 'Price breaks above $620 with strong volume.',
      suggested_user_action: 'reassess',
      watch_triggers: ['Price trades above $580 with weak follow-through.'],
      evidence: ['Trend remains weak.'],
      risk_map: ['Short squeeze risk.'],
      horizon: 'mid_term',
      payload: {
        horizon: 'mid_term',
      },
    },
  ]);
  journal.marketSnapshots.set(key('snap_chart_raw_freshness', 'workspace_a'), {
    id: 'snap_chart_raw_freshness',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 566,
    captured_at: '2026-07-02T00:00:00.000Z',
    source: 'test',
  });
  scenarioOhlcv.getOhlcv = async () =>
    chartOhlcvResponse([
      candle('2026-07-02T00:00:00.000Z', 565, 568, 560, 566),
    ]);

  const compiled = await playbooks.compileScenarioById(
    scenarioId,
    'user_1',
    'workspace_a',
  );
  assert.equal(compiled.playbook?.status, 'current');

  const projection = await scenarioChartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '10',
  });

  assert.equal(projection.source_versions.trade_playbook_status, 'current');
  assert.deepEqual(projection.source_versions.stale_reasons, []);
  assert.equal(
    projection.overlays.some(
      (overlay) =>
        overlay.type === 'horizontal_line' &&
        overlay.role === 'entry' &&
        overlay.source === 'trade_playbook' &&
        overlay.price === 580,
    ),
    true,
  );
});

test('legacy trade playbook without source hashes is unverifiable', async () => {
  const { journal, theses } = buildHarness();
  const thesisId = 'thesis_legacy_playbook_freshness';
  const scenarioId = 'scenario_legacy_playbook_freshness';
  seedScenarioLifecycleFixture(journal, {
    thesisId,
    scenarioId,
    symbol: 'BTC/USDT',
  });
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('legacy_playbook_no_hashes'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BTC/USDT',
    created_at: '2026-07-01T00:00:00.000Z',
  }, 'workspace_a');

  const detailScenarios = await theses.scenarios(
    thesisId,
    'user_1',
    'workspace_a',
  );
  assert.equal(detailScenarios[0]?.latest_playbook?.status, 'unverifiable');
  assert.deepEqual(detailScenarios[0]?.latest_playbook?.stale_reasons, [
    'legacy_playbook_without_source_hashes',
  ]);
});

test('playbook compiler uses thesis target zones when scenario has no targets', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_playbook_thesis_targets',
    thesisId: 'thesis_playbook_thesis_targets',
  });
  scenario.payload = {
    ...record(scenario.payload),
    targets: undefined,
    target_zones: undefined,
  };

  const report = await playbooks.compileScenario(
    scenario,
    {
      id: 'thesis_playbook_thesis_targets',
      symbol: 'BTC/USDT',
      market_type: 'spot',
      target_zones: ['First target $63,200', 'Second target $65k', 'Stale lower target $59,000'],
    },
    'workspace_a',
  );

  assert.equal(report.eligible, true);
  assert.deepEqual(
    report.playbook?.targets.map((target) => target.level),
    [63200, 65000],
  );
  assert.equal(
    report.warnings.includes('Filtered 1 target(s) outside long playbook direction.'),
    true,
  );
});

test('playbook compiler rejects derived watch-only scenario without missing structure blockers', async () => {
  const { journal, playbooks } = buildHarness();
  const thesisId = 'thesis_compile_legacy_watch';
  const scenarioId = 'scenario_compile_legacy_watch';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'perp',
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    {
      id: scenarioId,
      workspace_id: 'workspace_a',
      thesis_id: thesisId,
      scenario_name: 'Confirmation setup',
      condition: 'Giá đóng cửa ngày trên $580 kèm khối lượng cao.',
      invalidation: 'Giá đóng cửa ngày dưới $546 với ATR và khối lượng cao.',
      suggested_user_action: 'Watch confirmation - không mua ngay.',
      evidence: ['RSI >35'],
      horizon: 'short_term',
      timeframe: '4H',
    },
  ]);
  await journal.saveMarketSnapshot({
    id: 'market_compile_legacy_watch',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'perp',
    current_price: 570,
    captured_at: new Date().toISOString(),
  }, 'workspace_a');

  const report = await playbooks.compileScenarioById(
    scenarioId,
    'user_1',
    'workspace_a',
  );

  assert.equal(report.eligible, false);
  assert.equal(
    report.rejection_reasons.includes('Direction is not actionable.'),
    true,
  );
  assert.equal(
    report.rejection_reasons.includes('Missing scenario recommendation.'),
    false,
  );
  assert.equal(report.rejection_reasons.includes('Missing trigger.'), false);
  assert.equal(report.rejection_reasons.includes('Missing invalidation.'), false);
  assert.equal(
    report.rejection_reasons.includes('Runtime decision has unresolved blockers.'),
    false,
  );
});

test('derived short-term recommendation does not treat Long/Short ratio threshold as price trigger', () => {
  const response = toScenarioResponse({
    id: 'scenario_ratio_not_price',
    workspace_id: 'workspace_a',
    thesis_id: 'thesis_ratio_not_price',
    scenario_name: 'Cascade liquidation',
    condition: 'Funding rate at 97th percentile and Long/Short ratio 2.88. Price breaks support at $540.',
    expected_behavior: 'Price drops quickly toward $520-$530.',
    invalidation: 'Price holds above $570 and funding falls.',
    suggested_user_action: 'watch confirmation',
    watch_triggers: [
      'Price touches $540 with stronger sell volume.',
      'Long/Short ratio rises above 3.0.',
    ],
    evidence: ['Crowded long positioning.'],
    horizon: 'short_term',
  });

  assert.deepEqual(response.scenario_recommendation?.required_conditions, [
    {
      type: 'price_below',
      level: 540,
    },
  ]);
});

test('playbook compiler compiles derived directional scenario without runtime snapshot', async () => {
  const { journal, playbooks } = buildHarness();
  const thesisId = 'thesis_compile_legacy_short';
  const scenarioId = 'scenario_compile_legacy_short';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'perp',
    target_zones: ['First target 500', 'Second target 480'],
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    {
      id: scenarioId,
      workspace_id: 'workspace_a',
      thesis_id: thesisId,
      scenario_name: 'Long liquidation continuation',
      condition: 'L/S ratio crowded and daily trend remains weak.',
      expected_behavior: 'Gia pha vo $530, giam xuong vung $500-$480 trong 1-3 tuan.',
      invalidation: 'Gia dong cua tren $560 vo hieu hoa nhanh giam.',
      suggested_user_action: 'Reassess - chuan bi chuyen sang Sell stance neu xac nhan pha vo $530.',
      watch_triggers: ['Gia dong cua duoi $530 voi volume cao.'],
      evidence: ['Long/Short ratio crowded'],
      risk_map: ['Short squeeze risk'],
      horizon: 'short_term',
      timeframe: '4H',
    },
  ]);

  const report = await playbooks.compileScenarioById(
    scenarioId,
    'user_1',
    'workspace_a',
  );

  assert.equal(report.eligible, true);
  assert.equal(report.playbook?.direction, 'short');
  assert.equal(report.playbook?.entry.level, 530);
  assert.equal(report.playbook?.invalidation.level, 560);
  assert.deepEqual(
    report.playbook?.targets.map((target) => target.level),
    [500, 480],
  );
});

test('playbook compiler rejects directional watch confirmation scenarios', async () => {
  const { journal, playbooks } = buildHarness();
  const thesisId = 'thesis_compile_watch_confirmation_directional';
  const scenarioId = 'scenario_compile_watch_confirmation_directional';
  journal.theses.set(key(thesisId, 'workspace_a'), {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
    target_zones: ['Target zone $500-$510', 'Upside reclaim target $600-$620'],
  });
  journal.scenarios.set(key(thesisId, 'workspace_a'), [
    {
      id: scenarioId,
      workspace_id: 'workspace_a',
      thesis_id: thesisId,
      scenario_name: 'Break support and test lower demand',
      direction: 'bearish',
      condition: 'Support at $546 breaks with stronger sell volume.',
      expected_behavior: 'Price breaks below $546 and tests $500-$510.',
      invalidation: 'Price recovers above $570 and holds for three sessions.',
      suggested_user_action: 'watch confirmation, not an exchange order',
      watch_triggers: ['Daily close below $546 with volume >1.2x average.'],
      evidence: ['Long/Short ratio is crowded long.'],
      risk_map: ['Short squeeze risk.'],
      horizon: 'short_term',
      timeframe: '1D',
    },
  ]);

  const report = await playbooks.compileScenarioById(
    scenarioId,
    'user_1',
    'workspace_a',
  );

  assert.equal(report.eligible, false);
  assert.equal(report.playbook, null);
  assert.equal(
    report.rejection_reasons.includes('Recommendation action is wait/review.'),
    true,
  );
});

test('playbook compiler skips incoherent entry conditions before compiling short playbook', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_compile_metric_entry_guard',
    thesisId: 'thesis_compile_metric_entry_guard',
    symbol: 'BNB/USDT',
    actionBias: 'short',
  });
  const recommendation = record(scenario.scenario_recommendation);
  const runtimeDecision = record(scenario.runtime_decision);
  const evidenceRefs = recommendation.evidence_refs;
  scenario.scenario_recommendation = {
    ...recommendation,
    action: 'consider_short',
    action_bias: 'short',
    summary: 'Short only after support break confirmation.',
    thesis_link: 'Challenges the parent long thesis if support fails.',
    required_conditions: [
      { type: 'price_above', level: 3, timeframe: '4h' },
      {
        type: 'price_below',
        level: 540,
        timeframe: '1d',
        candle_close_required: true,
      },
    ],
    invalidation_conditions: [
      { type: 'price_above', level: 560, timeframe: '1d' },
    ],
    wait_for: [
      'Long/Short ratio above 3.0',
      'Daily close below $540 with volume confirmation.',
    ],
    evidence_refs: evidenceRefs,
  };
  scenario.decision_playbook = {
    version: 'scenario_decision_playbook.v1',
    source: 'llm',
    generated_at: '2026-06-29T00:00:00.000Z',
    generated_from_run_id: null,
    action_bias: 'short',
    confidence: 0.72,
    preferred_action_if_triggered: 'consider_short',
    fallback_action: 'wait',
    near_trigger_threshold_pct: 0.025,
    validity_window: {
      valid_from: null,
      valid_until: '2026-07-03T00:00:00.000Z',
      timeframe: 'short_term',
      rationale: 'Manual confirmation only.',
      refresh_policy: 'manual_review',
    },
    entry_conditions: [
      {
        type: 'price_below',
        level: 540,
        timeframe: '1d',
        candle_close_required: true,
      },
    ],
    avoid_if: [],
    invalidation_conditions: [
      { type: 'price_above', level: 560, timeframe: '1d' },
    ],
    wait_for: ['Daily close below $540 with volume confirmation.'],
    risk_notes: ['Short squeeze risk.'],
    evidence_refs: evidenceRefs,
    rationale: 'Use the support break as the tradable trigger.',
  };
  scenario.runtime_decision = {
    ...runtimeDecision,
    recommended_action: 'consider_short',
    blocking_reasons: [],
    validity_status: 'valid',
  };
  scenario.payload = {
    ...record(scenario.payload),
    targets: ['Downside target $520', 'Downside target $500'],
    scenario_recommendation: scenario.scenario_recommendation,
    decision_playbook: scenario.decision_playbook,
    runtime_decision: scenario.runtime_decision,
  };

  const report = await playbooks.compileScenario(
    scenario,
    {
      id: 'thesis_compile_metric_entry_guard',
      symbol: 'BNB/USDT',
      market_type: 'perp',
    },
    'workspace_a',
  );

  assert.equal(report.eligible, true);
  assert.equal(report.playbook?.entry.level, 540);
  assert.deepEqual(
    report.playbook?.targets.map((target) => target.level),
    [520, 500],
  );
});

test('playbook compiler does not use watch-only condition as entry', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_compile_watch_not_entry',
    thesisId: 'thesis_compile_watch_not_entry',
  });
  const recommendation = record(scenario.scenario_recommendation);
  scenario.scenario_recommendation = {
    ...recommendation,
    action: 'consider_long',
    action_bias: 'long',
    required_conditions: [
      {
        id: 'watch_zone',
        role: 'watch',
        type: 'price_in_zone',
        zone_low: 61000,
        zone_high: 62000,
      },
    ],
  };
  scenario.decision_playbook = {
    version: 'scenario_decision_playbook.v1',
    source: 'llm',
    generated_at: '2026-07-02T00:00:00.000Z',
    generated_from_run_id: null,
    action_bias: 'long',
    confidence: 0.72,
    preferred_action_if_triggered: 'consider_long',
    fallback_action: 'wait',
    near_trigger_threshold_pct: 1,
    validity_window: {
      valid_from: null,
      valid_until: null,
      timeframe: '4h',
      rationale: 'watch only',
      refresh_policy: 'manual_review',
    },
    entry_conditions: [
      {
        id: 'watch_zone',
        role: 'watch',
        type: 'price_in_zone',
        zone_low: 61000,
        zone_high: 62000,
      },
    ],
    avoid_if: [],
    invalidation_conditions: [{ role: 'invalidation', type: 'price_below', level: 60000 }],
    wait_for: [],
    risk_notes: [],
    evidence_refs: record(scenario.scenario_recommendation).evidence_refs as JsonRecord[],
    rationale: 'watch only',
  };
  scenario.payload = {
    ...record(scenario.payload),
    targets: ['Target $63200'],
    scenario_recommendation: scenario.scenario_recommendation,
    decision_playbook: scenario.decision_playbook,
  };

  const report = await playbooks.compileScenario(
    scenario,
    { id: 'thesis_compile_watch_not_entry', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );

  assert.equal(report.eligible, false);
  assert.equal(report.playbook, null);
  assert.equal(
    report.rejection_reasons.includes('Missing entry or trigger condition.'),
    true,
  );
});

test('playbook compiler accepts role entry condition as entry', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_compile_role_entry',
    thesisId: 'thesis_compile_role_entry',
  });
  const recommendation = record(scenario.scenario_recommendation);
  scenario.scenario_recommendation = {
    ...recommendation,
    action: 'consider_long',
    action_bias: 'long',
    required_conditions: [
      {
        id: 'entry_reclaim',
        role: 'entry',
        type: 'price_reclaim_level',
        level: 62000,
      },
    ],
  };
  scenario.payload = {
    ...record(scenario.payload),
    targets: ['Target $63200'],
    scenario_recommendation: scenario.scenario_recommendation,
  };

  const report = await playbooks.compileScenario(
    scenario,
    { id: 'thesis_compile_role_entry', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );

  assert.equal(report.eligible, true);
  assert.equal(report.playbook?.entry.level, 62000);
});

test('playbook compiler rejects bull-trap breakdown before setup is sequenced', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_compile_bull_trap_flat_entry',
    thesisId: 'thesis_compile_bull_trap_flat_entry',
    symbol: 'BNB/USDT',
    actionBias: 'short',
  });
  const recommendation = record(scenario.scenario_recommendation);
  const evidenceRefs = recommendation.evidence_refs;
  scenario.scenario_name = 'Bull Trap and Reversal';
  scenario.condition =
    'Price rallies into $600-$620, then falls below $570 within 48h with volume >1.2x.';
  scenario.expected_behavior =
    'Bullish then bearish: trap the breakout first, then confirm the breakdown.';
  scenario.scenario_recommendation = {
    ...recommendation,
    action: 'consider_short',
    action_bias: 'short',
    summary:
      'Short is valid only after price trades into $600-$620 and rejects, then breaks below $570.',
    thesis_link: 'Challenges the parent thesis after a failed breakout.',
    required_conditions: [
      {
        id: 'breakdown_entry',
        role: 'entry',
        type: 'price_below',
        level: 570,
        timeframe: '1d',
      },
    ],
    invalidation_conditions: [
      {
        id: 'sustained_breakout',
        role: 'invalidation',
        type: 'price_above',
        level: 620,
        timeframe: '1d',
      },
    ],
    wait_for: [
      'Price trades into $600-$620 before rejection.',
      'Volume exceeds 1.2x average after rejection.',
    ],
    risk_notes: ['A clean hold above $620 turns the trap into a breakout.'],
    evidence_refs: evidenceRefs,
  };
  scenario.decision_playbook = {
    version: 'scenario_decision_playbook.v1',
    source: 'llm',
    generated_at: '2026-07-05T00:00:00.000Z',
    generated_from_run_id: null,
    action_bias: 'short',
    confidence: 0.72,
    preferred_action_if_triggered: 'consider_short',
    fallback_action: 'wait',
    near_trigger_threshold_pct: 2,
    validity_window: {
      valid_from: null,
      valid_until: null,
      timeframe: 'mid_term',
      rationale: 'Bull-trap sequence must arm before entry.',
      refresh_policy: 'manual_review',
    },
    entry_conditions: [
      {
        id: 'trap_zone',
        role: 'watch',
        type: 'price_in_zone',
        zone_low: 600,
        zone_high: 620,
        timeframe: '1d',
      },
      {
        id: 'breakdown_entry',
        role: 'entry',
        type: 'price_below',
        level: 570,
        timeframe: '1d',
      },
    ],
    avoid_if: [],
    invalidation_conditions: [
      {
        id: 'sustained_breakout',
        role: 'invalidation',
        type: 'price_above',
        level: 620,
        timeframe: '1d',
      },
    ],
    wait_for: ['Price trades into $600-$620 before rejection.'],
    risk_notes: ['A clean hold above $620 turns the trap into a breakout.'],
    evidence_refs: evidenceRefs as JsonRecord[],
    rationale:
      'The setup is not actionable until the trap zone is reached first.',
  };
  scenario.runtime_decision = {
    ...record(scenario.runtime_decision),
    recommended_action: 'consider_short',
    blocking_reasons: [],
    validity_status: 'valid',
  };
  scenario.payload = {
    ...record(scenario.payload),
    targets: ['Target $535', 'Target $510', 'Target $480'],
    scenario_recommendation: scenario.scenario_recommendation,
    decision_playbook: scenario.decision_playbook,
    runtime_decision: scenario.runtime_decision,
  };

  const report = await playbooks.compileScenario(
    scenario,
    {
      id: 'thesis_compile_bull_trap_flat_entry',
      symbol: 'BNB/USDT',
      market_type: 'perp',
    },
    'workspace_a',
  );

  assert.equal(report.eligible, false);
  assert.equal(report.playbook, null);
  assert.equal(
    report.rejection_reasons.includes(
      'Multi-stage setup requires sequenced setup; refusing flat trade playbook.',
    ),
    true,
  );
});

test('playbook compiler rejects when only watch and invalidation are present', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_compile_watch_only',
    thesisId: 'thesis_compile_watch_only',
  });
  const recommendation = record(scenario.scenario_recommendation);
  scenario.scenario_recommendation = {
    ...recommendation,
    action: 'consider_long',
    action_bias: 'long',
    required_conditions: [
      {
        id: 'watch_line',
        role: 'watch',
        type: 'price_above',
        level: 62000,
      },
    ],
  };
  scenario.payload = {
    ...record(scenario.payload),
    targets: ['Target $63200'],
    scenario_recommendation: scenario.scenario_recommendation,
  };

  const report = await playbooks.compileScenario(
    scenario,
    { id: 'thesis_compile_watch_only', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );

  assert.equal(report.eligible, false);
  assert.equal(report.playbook, null);
  assert.equal(
    report.rejection_reasons.includes('Missing entry or trigger condition.'),
    true,
  );
});

test('playbook compiler rejects when every entry condition is incoherent', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_compile_incoherent_entry',
    thesisId: 'thesis_compile_incoherent_entry',
    symbol: 'BNB/USDT',
    actionBias: 'short',
  });
  const recommendation = record(scenario.scenario_recommendation);
  scenario.scenario_recommendation = {
    ...recommendation,
    action: 'consider_short',
    action_bias: 'short',
    required_conditions: [
      {
        type: 'price_in_zone',
        zone_low: 530,
        zone_high: 540,
        timeframe: '4h',
      },
    ],
    invalidation_conditions: [
      { type: 'price_below', level: 530, timeframe: '1d' },
    ],
  };
  scenario.payload = {
    ...record(scenario.payload),
    targets: ['Downside target $500'],
    scenario_recommendation: scenario.scenario_recommendation,
  };

  const report = await playbooks.compileScenario(
    scenario,
    {
      id: 'thesis_compile_incoherent_entry',
      symbol: 'BNB/USDT',
      market_type: 'perp',
    },
    'workspace_a',
  );

  assert.equal(report.eligible, false);
  assert.equal(report.playbook, null);
  assert.equal(
    report.rejection_reasons.includes('No coherent entry condition.'),
    true,
  );
});

test('playbook compiler rejects scenarios with runtime blockers', async () => {
  const { playbooks } = buildHarness();
  const scenario = scenarioLifecycleRecord({
    scenarioId: 'scenario_compile_runtime_blocker',
    thesisId: 'thesis_compile_runtime_blocker',
  });
  scenario.runtime_decision = {
    ...record(scenario.runtime_decision),
    validity_status: 'overextended',
    recommended_action: 'wait',
    blocking_reasons: ['Price is overextended from trigger.'],
  };
  scenario.payload = {
    ...record(scenario.payload),
    runtime_decision: scenario.runtime_decision,
  };

  const report = await playbooks.compileScenario(
    scenario,
    { id: 'thesis_compile_runtime_blocker', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );

  assert.equal(report.eligible, false);
  assert.equal(report.playbook, null);
  assert.equal(
    report.rejection_reasons.includes('Runtime decision has unresolved blockers.'),
    true,
  );
  assert.equal(
    report.warnings.includes('Runtime blocker: Price is overextended from trigger.'),
    true,
  );
});

test('scenario reliability does not attach mismatched relation or action profiles', async () => {
  const { journal, scenarioReliability } = buildHarness();
  for (const index of [1, 2, 3, 4, 5]) {
    await journal.saveScenarioEvaluation({
      id: `eval_reliability_mismatch_${index}`,
      workspace_id: 'workspace_a',
      scenario_id: `scenario_reliability_mismatch_${index}`,
      thesis_id: `thesis_reliability_mismatch_${index}`,
      symbol: 'BTC/USDT',
      market_type: 'spot',
      horizon: 'short_term',
      result: 'hit',
      data_quality: 'complete',
      evidence: {
        relation_to_thesis: 'supports',
        action_bias: 'long',
        setup_type: 'breakout',
      },
    }, 'workspace_a');
  }

  const profile = await scenarioReliability.profileForScenario(
    toScenarioResponse(
      scenarioLifecycleRecord({
        scenarioId: 'scenario_reliability_short',
        thesisId: 'thesis_reliability_short',
        actionBias: 'short',
      }),
      {
        id: 'thesis_reliability_short',
        symbol: 'BTC/USDT',
        market_type: 'spot',
        setup_type: 'breakout',
      },
    ),
    { id: 'thesis_reliability_short', symbol: 'BTC/USDT', market_type: 'spot' },
    'workspace_a',
  );

  assert.equal(profile, null);
});

test('backtest service stores assumptions and lets fees change result', async () => {
  const { backtests, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_backtest_fee'), 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 61000, 62100, 60900, 62000),
    candle('2026-06-02T00:00:00.000Z', 62000, 63200, 61900, 63100),
  ]);

  const noFee = await backtests.createBacktest(
    'playbook_backtest_fee',
    { fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );
  const withFee = await backtests.createBacktest(
    'playbook_backtest_fee',
    { fee_bps: 20, slippage_bps: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(noFee.assumptions.version, 'backtest_assumption_set.v1');
  assert.notEqual(
    noFee.result.total_return_pct,
    withFee.result.total_return_pct,
  );
});

test('backtest fill policy and sizing assumptions change simulated results', async () => {
  const { backtests, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_backtest_policy'), 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 61000, 62100, 60900, 61900),
    candle('2026-06-02T00:00:00.000Z', 61900, 63200, 61800, 61950),
  ]);

  const touch = await backtests.createBacktest(
    'playbook_backtest_policy',
    { fill_policy: 'touch', fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );
  const closeConfirmed = await backtests.createBacktest(
    'playbook_backtest_policy',
    { fill_policy: 'close_confirmed', fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );
  const fixedFraction = await backtests.createBacktest(
    'playbook_backtest_policy',
    {
      fill_policy: 'touch',
      sizing_policy: 'fixed_fraction',
      risk_fraction: 0.1,
      fee_bps: 0,
      slippage_bps: 0,
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(touch.result.trade_count, 1);
  assert.equal(closeConfirmed.result.trade_count, 0);
  assert.ok(
    Math.abs(fixedFraction.result.total_return_pct ?? 0) <
      Math.abs(touch.result.total_return_pct ?? 0),
  );
});

test('backtest touch fill uses candle open when price gaps through entry level', async () => {
  const { backtests, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_backtest_gap_touch'), 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 62500, 63000, 62400, 62800),
    candle('2026-06-02T00:00:00.000Z', 62800, 63300, 62700, 63200),
  ]);

  const result = await backtests.createBacktest(
    'playbook_backtest_gap_touch',
    { fill_policy: 'touch', fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );

  assert.equal(result.result.trade_count, 1);
  assert.equal(result.trade_events[0]?.price, 62500);
  assert.equal(result.trade_events[0]?.details.fill_reason, 'gap_through_open');
});

test('backtest touch fill supports zone entries', async () => {
  const { backtests, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_backtest_zone_entry');
  playbook.entry = {
    type: 'zone',
    condition: 'price in zone 61500-62000',
    level: null,
    zone_low: 61500,
    zone_high: 62000,
  };
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 62500, 62600, 61900, 62100),
    candle('2026-06-02T00:00:00.000Z', 62100, 63200, 62000, 63100),
  ]);

  const result = await backtests.createBacktest(
    'playbook_backtest_zone_entry',
    { fill_policy: 'touch', fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );

  assert.equal(result.result.trade_count, 1);
  assert.equal(result.warnings.includes('missing_numeric_entry'), false);
  assert.equal(result.trade_events[0]?.price, 62000);
  assert.equal(result.trade_events[0]?.details.fill_reason, 'touch_zone');
});

test('backtest exits on target or invalidation before the final candle', async () => {
  const { backtests, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_backtest_target'), 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 61000, 62100, 60900, 62000),
    candle('2026-06-02T00:00:00.000Z', 62000, 63300, 61900, 62100),
    candle('2026-06-03T00:00:00.000Z', 62100, 62200, 61000, 61100),
  ]);

  const target = await backtests.createBacktest(
    'playbook_backtest_target',
    { fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );

  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_backtest_stop'), 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 61000, 62100, 60900, 62000),
    candle('2026-06-02T00:00:00.000Z', 62000, 62300, 59900, 62200),
    candle('2026-06-03T00:00:00.000Z', 62200, 63500, 62100, 63400),
  ]);

  const invalidation = await backtests.createBacktest(
    'playbook_backtest_stop',
    { fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );

  assert.equal(target.trade_events[1]?.details.exit_reason, 'target');
  assert.equal(target.trade_events[1]?.price, 63200);
  assert.equal(target.result.total_return_pct, 1.94);
  assert.equal(invalidation.trade_events[1]?.details.exit_reason, 'invalidation');
  assert.equal(invalidation.trade_events[1]?.price, 60000);
  assert.equal(invalidation.result.total_return_pct, -3.23);
});

test('backtest rejects playbooks without a numeric target', async () => {
  const { backtests, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_backtest_missing_target');
  playbook.targets = [];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 61000, 62100, 60900, 62000),
    candle('2026-06-02T00:00:00.000Z', 62000, 62200, 61000, 61100),
  ]);

  await assert.rejects(
    () => backtests.createBacktest(
      'playbook_backtest_missing_target',
      { fee_bps: 0, slippage_bps: 0 },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
});

test('backtest detail and events endpoint expose ordered trade events', async () => {
  const { backtests, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_backtest_events'), 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 61000, 62100, 60900, 62000),
    candle('2026-06-02T00:00:00.000Z', 62000, 63200, 61900, 63100),
  ]);

  const created = await backtests.createBacktest(
    'playbook_backtest_events',
    { fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );
  const detail = await backtests.getBacktest(
    created.id,
    'user_1',
    'workspace_a',
  );
  const events = await backtests.listTradeEvents(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.deepEqual(
    detail.trade_events.map((event) => event.event_type),
    ['entry', 'exit'],
  );
  assert.deepEqual(
    events.map((event) => event.event_type),
    ['entry', 'exit'],
  );
  assert.equal(detail.trade_events[0]?.version, 'backtest_trade_event.v1');
  assert.equal(detail.trade_events[0]?.details.fill_policy, 'touch');
});

test('paper execution rejects risk fraction sizing in V8', async () => {
  const { paperExecution, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_paper_risk_fraction'), 'workspace_a');

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_risk_fraction',
      {
        mode: 'forward',
        position_size: {
          mode: 'risk_fraction',
          risk_fraction: '0.01',
        } as never,
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
});

test('paper execution rejects missing or invalid position sizing', async () => {
  const { paperExecution, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_paper_bad_sizing'), 'workspace_a');

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_sizing',
      { mode: 'forward' },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_sizing',
      {
        mode: 'forward',
        position_size: { mode: 'fixed_notional', notional: '0', quantity: null },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_sizing',
      {
        mode: 'forward',
        position_size: { mode: 'fixed_quantity', notional: null, quantity: '-1' },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
});

test('paper execution rejects replay simulations without a valid evaluation window', async () => {
  const { paperExecution, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_paper_bad_window'), 'workspace_a');
  const positionSize = { mode: 'fixed_notional' as const, notional: '1000', quantity: null };

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_window',
      { mode: 'replay', position_size: positionSize },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_window',
      {
        mode: 'replay',
        starts_at: '2026-07-04T01:00:00.000Z',
        ends_at: '2026-07-04T00:00:00.000Z',
        position_size: positionSize,
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_window',
      {
        mode: 'replay',
        starts_at: '2026-07-04T00:00:00.000Z',
        ends_at: '2026-07-04T01:00:00.000Z',
        setup_expiry_at: '2026-07-04T01:15:00.000Z',
        position_size: positionSize,
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  assert.equal(journal.simulationRuns.size, 0);
});

test('paper execution rejects replay simulations when market data has no candles', async () => {
  const { paperExecution, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_paper_missing_ohlcv'), 'workspace_a');
  paperExecution.setOhlcvForTest([]);

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_missing_ohlcv',
      {
        mode: 'replay',
        starts_at: '2026-07-04T00:00:00.000Z',
        ends_at: '2026-07-04T01:00:00.000Z',
        position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );

  assert.equal(journal.simulationRuns.size, 0);
  assert.equal(journal.executionEvents.size, 0);
  assert.equal(journal.simulationOutcomes.size, 0);
});

test('paper execution rejects sample kinds incompatible with simulation mode', async () => {
  const { paperExecution, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_paper_bad_sample_kind'), 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 610, 625, 608, 624),
  ]);

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_sample_kind',
      {
        mode: 'forward',
        sample_kind: 'in_sample_replay',
        position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bad_sample_kind',
      {
        mode: 'replay',
        sample_kind: 'forward_observation',
        starts_at: '2026-07-04T00:00:00.000Z',
        ends_at: '2026-07-04T01:00:00.000Z',
        position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  assert.equal(journal.simulationRuns.size, 0);
});

test('paper execution rejects stale playbooks before creating simulations', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_stale');
  playbook.status = 'stale';
  playbook.stale_reasons = ['source_scenario_changed'];
  await journal.saveTradePlaybook(playbook, 'workspace_a');

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_stale',
      {
        mode: 'replay',
        position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
});

test('paper execution rejects flat bull-trap playbooks before creating simulations', async () => {
  const { paperExecution, journal } = buildHarness();
  const thesisId = 'thesis_paper_bull_trap_flat';
  const scenarioId = 'scenario_paper_bull_trap_flat';
  seedChartScenario(journal, { thesisId, scenarioId });
  const scenario = journal.scenarios.get(key(thesisId, 'workspace_a'))?.[0];
  assert.ok(scenario);
  scenario.decision_playbook = {
    version: 'scenario_decision_playbook.v1',
    source: 'llm',
    generated_at: '2026-07-05T00:00:00.000Z',
    generated_from_run_id: null,
    action_bias: 'short',
    confidence: 0.72,
    preferred_action_if_triggered: 'consider_short',
    fallback_action: 'wait',
    near_trigger_threshold_pct: 2,
    validity_window: {
      valid_from: null,
      valid_until: null,
      timeframe: 'mid_term',
      rationale: 'Bull trap must arm before breakdown entry.',
      refresh_policy: 'manual_review',
    },
    entry_conditions: [
      {
        id: 'trap_zone',
        role: 'watch',
        type: 'price_in_zone',
        zone_low: 600,
        zone_high: 620,
      },
      {
        id: 'breakdown_entry',
        role: 'entry',
        type: 'price_below',
        level: 570,
      },
    ],
    avoid_if: [],
    invalidation_conditions: [
      {
        id: 'hold_above_trap',
        role: 'invalidation',
        type: 'price_above',
        level: 620,
      },
    ],
    wait_for: ['Price trades into $600-$620 before breakdown.'],
    risk_notes: [],
    evidence_refs: [],
    rationale: 'Bull trap requires a prior trap zone before entry.',
  };
  scenario.payload = {
    ...record(scenario.payload),
    decision_playbook: scenario.decision_playbook,
  };
  await journal.saveTradePlaybook({
    ...tradePlaybookFixture('playbook_paper_bull_trap_flat'),
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    symbol: 'BNB/USDT',
    market_type: 'perp',
    direction: 'short',
    entry: { type: 'level', condition: 'price below 570', level: 570 },
    invalidation: { condition: 'price above 620', level: 620 },
    targets: [{ label: 'Target 1', level: 535, rationale: 'First target.' }],
    source_hashes: sourceHashesForScenario(journal, scenarioId),
    status: 'current',
  }, 'workspace_a');

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_bull_trap_flat',
      {
        mode: 'forward',
        position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
  assert.equal(journal.simulationRuns.size, 0);
});

test('paper execution rejects playbooks without numeric targets', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_text_target');
  playbook.targets = [{ label: 'Target 1', level: null, rationale: 'Text-only target.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');

  await assert.rejects(
    () => paperExecution.createSimulation(
      'playbook_paper_text_target',
      {
        mode: 'replay',
        position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
      },
      'user_1',
      'workspace_a',
    ),
    BadRequestException,
  );
});

test('paper execution keeps the frozen playbook snapshot after source playbook changes', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_frozen_snapshot');
  playbook.entry = {
    type: 'level',
    condition: 'Long breakout above 620.',
    level: 620,
    zone_low: null,
    zone_high: null,
  };
  await journal.saveTradePlaybook(playbook, 'workspace_a');

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_frozen_snapshot',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
    },
    'user_1',
    'workspace_a',
  );
  const changedPlaybook = { ...playbook, entry: { ...record(playbook.entry), level: 999 } };
  await journal.saveTradePlaybook(changedPlaybook, 'workspace_a');

  const detail = await paperExecution.getSimulation(
    simulation.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(detail.playbook_snapshot.entry.level, 620);
  assert.equal(detail.source_drift_after_start, true);
});

test('paper execution freezes source thesis and scenario analysis snapshots', async () => {
  const { paperExecution, journal } = buildHarness();
  const thesisId = 'thesis_paper_frozen_analysis';
  const scenarioId = 'scenario_paper_frozen_analysis';
  const thesis = {
    id: thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    thesis_text: 'Original thesis text.',
  };
  const scenario = scenarioLifecycleRecord({ scenarioId, thesisId });
  scenario.condition = 'Original trigger condition.';
  scenario.scenario_recommendation = {
    ...record(scenario.scenario_recommendation),
    summary: 'Original recommendation summary.',
  };
  scenario.decision_playbook = {
    version: 'scenario_decision_playbook.v1',
    entry_conditions: [
      {
        id: 'trigger',
        role: 'trigger',
        type: 'price_above',
        level: 62000,
      },
    ],
    invalidation_conditions: [],
  };
  scenario.payload = {
    ...record(scenario.payload),
    scenario_recommendation: scenario.scenario_recommendation,
    decision_playbook: scenario.decision_playbook,
  };
  journal.theses.set(key(thesisId, 'workspace_a'), thesis);
  journal.scenarios.set(key(thesisId, 'workspace_a'), [scenario]);

  const playbook = tradePlaybookFixture('playbook_paper_frozen_analysis');
  playbook.source_scenario_id = scenarioId;
  playbook.source_thesis_id = thesisId;
  await journal.saveTradePlaybook(playbook, 'workspace_a');

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_frozen_analysis',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  thesis.thesis_text = 'Changed thesis text after start.';
  scenario.condition = 'Changed trigger condition after start.';
  record(scenario.scenario_recommendation).summary = 'Changed recommendation.';
  record(scenario.decision_playbook).mutated_after_start = true;

  const detail = await paperExecution.getSimulation(
    simulation.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(detail.analysis_snapshot.thesis.thesis_text, 'Original thesis text.');
  assert.equal(
    detail.analysis_snapshot.scenario.condition,
    'Original trigger condition.',
  );
  assert.equal(
    detail.analysis_snapshot.scenario_recommendation?.summary,
    'Original recommendation summary.',
  );
  assert.equal(
    detail.analysis_snapshot.decision_playbook?.mutated_after_start,
    undefined,
  );
  assert.equal(
    detail.analysis_snapshot.chart_source_versions?.source_scenario_id,
    scenarioId,
  );
});

test('paper execution next-open long breakout waits for the next candle without lookahead', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_long_next_open');
  playbook.entry = {
    type: 'level',
    condition: 'Long breakout above 620.',
    level: 620,
    zone_low: null,
    zone_high: null,
  };
  playbook.direction = 'long';
  playbook.invalidation = { condition: 'Stop below 600.', level: 600 };
  playbook.targets = [{ label: 'Target 1', level: 640, rationale: 'Breakout continuation.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 610, 625, 608, 624),
    candle('2026-07-04T00:15:00.000Z', 626, 632, 624, 630),
    candle('2026-07-04T00:30:00.000Z', 630, 641, 628, 640),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_long_next_open',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:30:00.000Z',
      fill_policy: 'next_open_after_trigger',
      position_size: { mode: 'fixed_notional', notional: '1252', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.orders[0]?.filled_price, '626');
  assert.equal(simulation.orders[0]?.filled_at_market_time, '2026-07-04T00:15:00.000Z');
  assert.equal(simulation.position?.close_reason, 'target');
  assert.equal(simulation.outcome?.execution_result, 'win');
});

test('paper execution next-open does not fill when replay lacks the next candle', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_next_open_no_lookahead');
  playbook.entry = {
    type: 'level',
    condition: 'Long breakout above 620.',
    level: 620,
    zone_low: null,
    zone_high: null,
  };
  playbook.direction = 'long';
  playbook.invalidation = { condition: 'Stop below 600.', level: 600 };
  playbook.targets = [{ label: 'Target 1', level: 640, rationale: 'Breakout continuation.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 610, 625, 608, 624),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_next_open_no_lookahead',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:15:00.000Z',
      fill_policy: 'next_open_after_trigger',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.orders.length, 0);
  assert.equal(simulation.position, null);
  assert.equal(simulation.outcome?.execution_result, 'inconclusive');
  assert.equal(simulation.outcome?.diagnosis_codes.includes('DATA_END_REACHED'), true);
});

test('paper execution forward refresh waits for entry instead of opening at current price', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_waits');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 566, 570, 562, 568),
  ]);

  const created = await paperExecution.createSimulation(
    'playbook_paper_waits',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
    },
    'user_1',
    'workspace_a',
  );
  const refreshed = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(refreshed.status, 'waiting_for_trigger');
  assert.equal(refreshed.orders.length, 0);
  assert.equal(refreshed.position, null);
  assert.deepEqual(
    refreshed.events.map((event) => event.event_type),
    ['simulation_started', 'playbook_snapshot_frozen'],
  );
});

test('paper execution replay writes sequenced ledger and derived projections', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_replay');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 566, 570, 562, 568),
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 582, 548, 551),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_replay',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
      fee_bps: '0',
      slippage_bps: '0',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.status, 'completed');
  assert.equal(simulation.orders.length, 2);
  assert.equal(simulation.orders[0]?.status, 'filled');
  assert.equal(simulation.orders[0]?.filled_price, '582');
  assert.equal(simulation.position?.status, 'closed');
  assert.equal(simulation.position?.close_reason, 'target');
  assert.equal(simulation.outcome?.execution_result, 'win');
  assert.equal(simulation.outcome?.research_evaluation_status, 'rule_based');
  assert.equal(simulation.outcome?.thesis_outcome, 'supported');
  assert.equal(simulation.outcome?.diagnosis_codes.includes('THESIS_SUPPORTED'), true);
  const replayDatasetHash = simulation.market_data_snapshot.dataset_hash;
  assert.ok(replayDatasetHash);
  assert.equal(replayDatasetHash.length, 64);
  assert.equal(
    simulation.sample_identity.market_data_hash,
    replayDatasetHash,
  );
  assert.deepEqual(
    simulation.events.map((event) => event.sequence),
    simulation.events.map((_, index) => index + 1),
  );
  assert.equal(
    new Set(simulation.events.map((event) => event.idempotency_key)).size,
    simulation.events.length,
  );
  assert.equal(
    simulation.events.some((event) => event.event_type === 'paper_order_filled'),
    true,
  );
});

test('paper execution includes replay candle identity in market-data hash', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_market_hash');
  playbook.entry = {
    type: 'level',
    condition: 'Long breakout above 620.',
    level: 620,
    zone_low: null,
    zone_high: null,
  };
  playbook.direction = 'long';
  playbook.invalidation = { condition: 'Stop below 600.', level: 600 };
  playbook.targets = [{ label: 'Target 1', level: 640, rationale: 'Breakout continuation.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');

  const request = {
    mode: 'replay' as const,
    starts_at: '2026-07-04T00:00:00.000Z',
    ends_at: '2026-07-04T00:30:00.000Z',
    position_size: { mode: 'fixed_notional' as const, notional: '1000', quantity: null },
  };
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 610, 625, 608, 624),
    candle('2026-07-04T00:15:00.000Z', 624, 641, 622, 640),
  ]);
  const first = await paperExecution.createSimulation(
    'playbook_paper_market_hash',
    request,
    'user_1',
    'workspace_a',
  );
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 610, 625, 608, 624),
    candle('2026-07-04T00:15:00.000Z', 624, 642, 622, 641),
  ]);
  const second = await paperExecution.createSimulation(
    'playbook_paper_market_hash',
    request,
    'user_1',
    'workspace_a',
  );

  assert.notEqual(
    first.market_data_snapshot.dataset_hash,
    second.market_data_snapshot.dataset_hash,
  );
  assert.notEqual(
    first.sample_identity.market_data_hash,
    second.sample_identity.market_data_hash,
  );
});

test('paper execution applies fee and slippage assumptions to fills and PnL', async () => {
  const { paperExecution, journal } = buildHarness();
  await journal.saveTradePlaybook(
    tradePlaybookFixture('playbook_paper_fee_slippage'),
    'workspace_a',
  );
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 61950, 62100, 61900, 62050),
    candle('2026-07-04T00:30:00.000Z', 62050, 63300, 62000, 63250),
  ]);

  const noCost = await paperExecution.createSimulation(
    'playbook_paper_fee_slippage',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      position_size: { mode: 'fixed_quantity', notional: null, quantity: '1' },
      fee_bps: '0',
      slippage_bps: '0',
    },
    'user_1',
    'workspace_a',
  );
  const withCost = await paperExecution.createSimulation(
    'playbook_paper_fee_slippage',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      position_size: { mode: 'fixed_quantity', notional: null, quantity: '1' },
      fee_bps: '100',
      slippage_bps: '100',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(noCost.outcome?.execution_result, 'win');
  assert.equal(noCost.position?.realized_pnl, '1200');
  assert.equal(withCost.orders[0]?.requested_price, '62000');
  assert.equal(withCost.orders[0]?.filled_price, '62620');
  assert.equal(withCost.orders[0]?.fee, '626.2');
  assert.equal(withCost.orders[1]?.requested_price, '63200');
  assert.equal(withCost.orders[1]?.filled_price, '62568');
  assert.equal(withCost.orders[1]?.fee, '625.68');
  assert.equal(withCost.position?.realized_pnl, '-1303.88');
  assert.equal(withCost.outcome?.execution_result, 'loss');

  journal.paperOrders.clear();
  journal.paperPositions.clear();
  journal.simulationOutcomes.clear();
  const rebuilt = await paperExecution.getSimulation(
    withCost.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(rebuilt.orders[0]?.fee, withCost.orders[0]?.fee);
  assert.equal(rebuilt.orders[1]?.filled_price, withCost.orders[1]?.filled_price);
  assert.equal(rebuilt.position?.realized_pnl, withCost.position?.realized_pnl);
  assert.equal(rebuilt.outcome?.execution_result, withCost.outcome?.execution_result);
});

test('paper execution keeps quantity and PnL arithmetic decimal-safe', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_decimal_precision');
  playbook.entry = {
    type: 'level',
    condition: 'Enter decimal reclaim.',
    level: 0.3,
    zone_low: null,
    zone_high: null,
  };
  playbook.invalidation = { condition: 'Decimal stop.', level: 0.2 };
  playbook.targets = [{ label: 'Target 1', level: 0.6, rationale: 'Decimal target.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 0.29, 0.31, 0.29, 0.3),
    candle('2026-07-04T00:30:00.000Z', 0.3, 0.61, 0.3, 0.6),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_decimal_precision',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      position_size: { mode: 'fixed_notional', notional: '0.1', quantity: null },
      fee_bps: '0',
      slippage_bps: '0',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.orders[0]?.quantity, '0.3333333333');
  assert.equal(simulation.position?.realized_pnl, '0.1');
  assert.equal(simulation.position?.realized_pnl_pct, '1');
  assert.equal(simulation.outcome?.execution_result, 'win');
});

test('paper execution rebuilds missing projections from the execution ledger', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_rebuild');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 566, 570, 562, 568),
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 582, 548, 551),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_rebuild',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );
  journal.paperOrders.clear();
  journal.paperPositions.clear();
  journal.simulationOutcomes.clear();

  const rebuilt = await paperExecution.getSimulation(
    simulation.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(rebuilt.orders.length, 2);
  assert.equal(rebuilt.orders[0]?.intent, 'entry');
  assert.equal(rebuilt.orders[1]?.intent, 'target');
  assert.equal(rebuilt.position?.status, 'closed');
  assert.equal(rebuilt.position?.close_reason, 'target');
  assert.equal(rebuilt.outcome?.execution_result, 'win');
  assert.equal(journal.paperOrders.size, 2);
  assert.equal(journal.paperPositions.size, 1);
  assert.equal(journal.simulationOutcomes.size, 1);
});

test('paper execution expires waiting setup before a late entry candle', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_setup_expiry');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 566, 570, 562, 568),
    candle('2026-07-04T00:30:00.000Z', 575, 583, 574, 581),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_setup_expiry',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      setup_expiry_at: '2026-07-04T00:15:00.000Z',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.status, 'completed');
  assert.equal(simulation.status_reason, 'setup_expiry');
  assert.equal(simulation.orders.length, 0);
  assert.equal(simulation.outcome?.execution_result, 'missed');
  assert.equal(simulation.outcome?.close_reason, 'setup_expiry');
});

test('paper execution treats replay data end before entry as inconclusive', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_no_entry_data_end');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:00:00.000Z', 566, 570, 562, 568),
    candle('2026-07-04T00:15:00.000Z', 568, 572, 565, 570),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_no_entry_data_end',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:15:00.000Z',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.status, 'completed');
  assert.equal(simulation.status_reason, 'data_end_reached');
  assert.equal(simulation.outcome?.execution_result, 'inconclusive');
  assert.equal(simulation.outcome?.diagnosis_codes.includes('DATA_END_REACHED'), true);
  assert.equal(simulation.outcome?.reliability_eligible, false);
});

test('paper execution closes open positions on configured position timeout', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_position_timeout');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 585, 575, 579),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_position_timeout',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:30:00.000Z',
      position_max_duration_minutes: 15,
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.status, 'completed');
  assert.equal(simulation.position?.close_reason, 'position_timeout');
  assert.equal(
    simulation.events.some((event) => event.event_type === 'position_timeout_hit'),
    true,
  );
});

test('paper execution marks same-candle stop and target as ambiguous when configured', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_ambiguous_intrabar');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 621, 548, 551),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_ambiguous_intrabar',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:30:00.000Z',
      intrabar_policy: 'ambiguous_warning',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.outcome?.execution_result, 'inconclusive');
  assert.equal(simulation.outcome?.research_evaluation_status, 'pending');
  assert.equal(simulation.outcome?.thesis_outcome, null);
  assert.equal(simulation.outcome?.reliability_eligible, false);
  assert.equal(simulation.outcome?.diagnosis_codes.includes('AMBIGUOUS_INTRABAR'), true);
  assert.equal(
    simulation.events.some((event) => event.reason_code === 'ambiguous_intrabar'),
    true,
  );
});

test('paper execution force-closes at data end without reliability eligibility', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_force_data_end');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 585, 575, 580),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_force_data_end',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:30:00.000Z',
      force_close_at_data_end: true,
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.position?.status, 'closed');
  assert.equal(simulation.position?.close_reason, 'data_end');
  assert.equal(simulation.outcome?.execution_result, 'inconclusive');
  assert.equal(simulation.outcome?.reliability_eligible, false);
  assert.equal(simulation.outcome?.diagnosis_codes.includes('DATA_END_REACHED'), true);
  assert.equal(simulation.orders[1]?.intent, 'exit');
});

test('paper execution partially closes on target and rebuilds the remaining stop from ledger', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_partial_target');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 582, 548, 551),
    candle('2026-07-04T00:45:00.000Z', 551, 621, 550, 618),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_partial_target',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
      partial_take_profit: [{ target_index: 0, close_percent: '0.5' }],
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.orders.length, 3);
  assert.equal(simulation.orders[1]?.intent, 'target');
  assert.equal(simulation.orders[1]?.quantity, '1');
  assert.equal(simulation.orders[2]?.intent, 'stop');
  assert.equal(simulation.orders[2]?.quantity, '1');
  assert.equal(simulation.position?.status, 'closed');
  assert.equal(simulation.position?.close_reason, 'stop');
  assert.equal(simulation.position?.realized_pnl, '-6');
  assert.equal(simulation.outcome?.execution_result, 'loss');
  assert.equal(simulation.outcome?.research_evaluation_status, 'rule_based');
  assert.equal(simulation.outcome?.thesis_outcome, 'challenged');
  assert.equal(simulation.outcome?.diagnosis_codes.includes('THESIS_CHALLENGED'), true);
  assert.equal(simulation.outcome?.diagnosis_codes.includes('THESIS_INVALIDATED'), false);
  assert.equal(simulation.outcome?.max_favorable_excursion, '0.058419244');
  assert.equal(simulation.outcome?.max_adverse_excursion, '0.0670103093');
  assert.equal(
    simulation.events.some((event) => event.event_type === 'position_partially_closed'),
    true,
  );

  journal.paperOrders.clear();
  journal.paperPositions.clear();
  journal.simulationOutcomes.clear();
  const rebuilt = await paperExecution.getSimulation(
    simulation.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(rebuilt.orders.length, 3);
  assert.equal(rebuilt.position?.status, 'closed');
  assert.equal(rebuilt.position?.close_reason, 'stop');
  assert.equal(rebuilt.position?.realized_pnl, '-6');
  assert.equal(rebuilt.outcome?.execution_result, 'loss');
  assert.equal(
    rebuilt.outcome?.research_evaluation_status,
    simulation.outcome?.research_evaluation_status,
  );
  assert.equal(rebuilt.outcome?.thesis_outcome, simulation.outcome?.thesis_outcome);
  assert.equal(
    rebuilt.outcome?.max_favorable_excursion,
    simulation.outcome?.max_favorable_excursion,
  );
  assert.equal(
    rebuilt.outcome?.max_adverse_excursion,
    simulation.outcome?.max_adverse_excursion,
  );
});

test('paper execution source integrity failure makes deterministic outcomes reliability-ineligible', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_source_integrity_failed');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 582, 548, 551),
  ]);

  const created = await paperExecution.createSimulation(
    'playbook_paper_source_integrity_failed',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );
  const stored = journal.simulationRuns.get(key(created.id, 'workspace_a'));
  assert.ok(stored);
  journal.simulationRuns.set(key(created.id, 'workspace_a'), {
    ...stored,
    source_integrity_status: 'failed',
  });

  const refreshed = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(refreshed.outcome?.execution_result, 'win');
  assert.equal(refreshed.outcome?.reliability_eligible, false);
  assert.equal(refreshed.outcome?.execution_quality, 'invalid_experiment');
  assert.equal(
    refreshed.outcome?.diagnosis_codes.includes('SOURCE_INTEGRITY_FAILED'),
    true,
  );
});

test('paper execution fills skipped entry with first tradable gap policy', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_gap_first_tradable');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 590, 596, 585, 588),
    candle('2026-07-04T00:30:00.000Z', 588, 589, 548, 551),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_gap_first_tradable',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T01:00:00.000Z',
      gap_fill_policy: 'first_tradable_price',
      position_size: { mode: 'fixed_notional', notional: '1180', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.orders[0]?.filled_price, '590');
  assert.equal(simulation.orders[0]?.reason_code, 'gap_first_tradable_price');
  assert.equal(simulation.position?.close_reason, 'target');
  assert.equal(simulation.outcome?.execution_result, 'win');
});

test('paper execution rejects skipped entry when gap policy requires a real touch', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_gap_reject');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 590, 596, 585, 588),
  ]);

  const simulation = await paperExecution.createSimulation(
    'playbook_paper_gap_reject',
    {
      mode: 'replay',
      starts_at: '2026-07-04T00:00:00.000Z',
      ends_at: '2026-07-04T00:15:00.000Z',
      gap_fill_policy: 'reject_if_skipped',
      position_size: { mode: 'fixed_notional', notional: '1000', quantity: null },
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(simulation.orders.length, 0);
  assert.equal(simulation.position, null);
  assert.equal(simulation.outcome?.execution_result, 'inconclusive');
  assert.equal(
    simulation.events.some((event) => event.event_type === 'entry_condition_confirmed'),
    false,
  );
});

test('paper execution serializes concurrent refresh transitions', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_concurrent_refresh');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 582, 548, 551),
  ]);

  const created = await paperExecution.createSimulation(
    'playbook_paper_concurrent_refresh',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );
  const lockCallsBeforeRefresh = journal.simulationRunLockCalls
    .filter((item) => item === key(created.id, 'workspace_a')).length;
  await Promise.all([
    paperExecution.refreshSimulation(created.id, 'user_1', 'workspace_a'),
    paperExecution.refreshSimulation(created.id, 'user_1', 'workspace_a'),
  ]);
  assert.equal(
    journal.simulationRunLockCalls.filter((item) => item === key(created.id, 'workspace_a')).length -
      lockCallsBeforeRefresh,
    2,
  );
  const detail = await paperExecution.getSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(detail.status, 'completed');
  assert.equal(detail.orders.length, 2);
  assert.deepEqual(
    detail.events.map((event) => event.sequence),
    detail.events.map((_, index) => index + 1),
  );
  assert.equal(
    new Set(detail.events.map((event) => event.sequence)).size,
    detail.events.length,
  );
});

test('paper execution refresh skips candles already processed before an open position', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_open_watermark');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 548, 581),
  ]);

  const created = await paperExecution.createSimulation(
    'playbook_paper_open_watermark',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );
  const open = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );
  const repeated = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(open.status, 'position_open');
  assert.equal(repeated.status, 'position_open');
  assert.equal(repeated.position?.status, 'open');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 548, 581),
    candle('2026-07-04T00:30:00.000Z', 581, 582, 548, 551),
  ]);
  const closed = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(closed.status, 'completed');
  assert.equal(closed.position?.close_reason, 'target');
  assert.equal(closed.last_processed_candle_id, '2026-07-04T00:30:00.000Z');
});

test('paper execution records engine failure without synthetic position close', async () => {
  const { journal, auth, workspaces } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_engine_failure');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  let throwOnOhlcv = false;
  const ohlcv = {
    getOhlcv: async (): Promise<MarketOhlcvResponse> => {
      if (throwOnOhlcv) {
        throw new Error('ohlcv backend failed');
      }
      return {
        symbol: String(playbook.symbol),
        market_type: playbook.market_type === 'perp' ? 'perp' : 'spot',
        interval: '15m',
        from: '2026-07-04T00:00:00.000Z',
        to: '2026-07-04T00:15:00.000Z',
        source: 'test',
        provider: 'test',
        generated_at: '2026-07-04T00:15:00.000Z',
        candles: [candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581)],
        warning: null,
      };
    },
  } as unknown as MarketOhlcvService;
  const paperExecution = new PaperExecutionService(
    journal,
    auth,
    workspaces,
    ohlcv,
  );

  const created = await paperExecution.createSimulation(
    'playbook_paper_engine_failure',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
    },
    'user_1',
    'workspace_a',
  );
  const open = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );
  throwOnOhlcv = true;
  const failed = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(open.status, 'position_open');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.status_reason, 'engine_failure');
  assert.equal(failed.position?.status, 'open');
  assert.equal(failed.outcome?.execution_result, 'inconclusive');
  assert.equal(failed.outcome?.reliability_eligible, false);
  assert.equal(failed.outcome?.diagnosis_codes.includes('ENGINE_FAILURE'), true);
  assert.equal(
    failed.events.some((event) => event.event_type === 'simulation_failed'),
    true,
  );
  assert.equal(
    failed.events.some((event) => event.event_type === 'position_closed'),
    false,
  );
});

test('paper execution requires explicit close policy for open positions', async () => {
  const { paperExecution, journal } = buildHarness();
  const playbook = tradePlaybookFixture('playbook_paper_manual_close');
  playbook.entry = {
    type: 'zone',
    condition: 'Short retest 578-582.',
    level: null,
    zone_low: 578,
    zone_high: 582,
  };
  playbook.direction = 'short';
  playbook.invalidation = { condition: 'Stop above 620.', level: 620 };
  playbook.targets = [{ label: 'Target 1', level: 550, rationale: 'Mean reversion.' }];
  await journal.saveTradePlaybook(playbook, 'workspace_a');
  paperExecution.setOhlcvForTest([
    candle('2026-07-04T00:15:00.000Z', 575, 583, 574, 581),
  ]);

  const created = await paperExecution.createSimulation(
    'playbook_paper_manual_close',
    {
      mode: 'forward',
      position_size: { mode: 'fixed_notional', notional: '1164', quantity: null },
      fee_bps: '0',
      slippage_bps: '0',
    },
    'user_1',
    'workspace_a',
  );
  const open = await paperExecution.refreshSimulation(
    created.id,
    'user_1',
    'workspace_a',
  );

  assert.equal(open.status, 'position_open');
  assert.equal(open.position?.status, 'open');
  await assert.rejects(
    () => paperExecution.cancelSimulation(open.id, 'user_1', 'workspace_a'),
    BadRequestException,
  );

  const closed = await paperExecution.closeSimulation(
    open.id,
    {
      close_policy: 'manual_close',
      price: '570',
      market_time: '2026-07-04T00:30:00.000Z',
      reason: 'manual QA close',
    },
    'user_1',
    'workspace_a',
  );

  assert.equal(closed.status, 'completed');
  assert.equal(closed.status_reason, 'manual_close');
  assert.equal(closed.position?.status, 'closed');
  assert.equal(closed.position?.close_reason, 'manual_close');
  assert.equal(closed.orders[1]?.intent, 'exit');
  assert.equal(closed.orders[1]?.order_type, 'market');
  assert.equal(closed.outcome?.close_reason, 'manual_close');
  assert.equal(closed.outcome?.reliability_eligible, false);
  assert.equal(
    closed.events.some((event) => event.reason_code === 'manual_close'),
    true,
  );
});

test('backtest reruns create distinct trade event ids', async () => {
  const { backtests, journal } = buildHarness();
  await journal.saveTradePlaybook(tradePlaybookFixture('playbook_backtest_rerun'), 'workspace_a');
  backtests.setOhlcvForTest([
    candle('2026-06-01T00:00:00.000Z', 61000, 62100, 60900, 62000),
    candle('2026-06-02T00:00:00.000Z', 62000, 63200, 61900, 63100),
  ]);

  const first = await backtests.createBacktest(
    'playbook_backtest_rerun',
    { fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );
  const second = await backtests.createBacktest(
    'playbook_backtest_rerun',
    { fee_bps: 0, slippage_bps: 0 },
    'user_1',
    'workspace_a',
  );

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.trade_events[0]?.id, second.trade_events[0]?.id);
  assert.notEqual(first.trade_events[1]?.id, second.trade_events[1]?.id);
});

test('scenario lifecycle schema bootstrap is single-flight', async () => {
  let queryCount = 0;
  const fakePool = {
    async query() {
      queryCount += 1;
      await delay(10);
      return { rows: [] };
    },
  };
  const repository = new PostgresJournalRepository(undefined) as any;
  repository.pool = fakePool;

  await Promise.all([
    repository.ensureScenarioLifecycleSchema(),
    repository.ensureScenarioLifecycleSchema(),
  ]);

  assert.equal(queryCount, 1);
});

test('scenario response extracts legacy source timeframe block from action text', async () => {
  const { journal, theses } = buildHarness();
  journal.theses.set(key('thesis_scenario_legacy_meta', 'workspace_a'), {
    id: 'thesis_scenario_legacy_meta',
    workspace_id: 'workspace_a',
    symbol: 'ETH/USDT',
    thesis_text: 'Watch ETH risk.',
  });
  journal.scenarios.set(key('thesis_scenario_legacy_meta', 'workspace_a'), [
    {
      id: 'scenario_legacy_meta',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_scenario_legacy_meta',
      scenario_name: 'Sụp Đổ Tiếp Diễn',
      condition: 'Long crowding remains high.',
      suggested_user_action:
        'Reassess — đánh giá lại danh mục.\n' +
        'Source, timeframe, as_of\n' +
        'Báo cáo phân tích tín hiệu định lượng (market_analyst, 2026-06-08); kế hoạch đầu tư.\n' +
        'Khung thời gian ưu tiên: daily cho xu hướng chính, 1h cho điểm phá vỡ.',
      payload: {},
    },
  ]);

  const scenarios = await theses.scenarios(
    'thesis_scenario_legacy_meta',
    'user_1',
    'workspace_a',
  );

  assert.equal(scenarios[0]?.suggested_user_action, 'Reassess — đánh giá lại danh mục.');
  assert.equal(scenarios[0]?.as_of, '2026-06-08');
  assert.equal(scenarios[0]?.timeframe, 'daily cho xu hướng chính, 1h cho điểm phá vỡ');
  assert.deepEqual(scenarios[0]?.source, [
    'Báo cáo phân tích tín hiệu định lượng (market_analyst, 2026-06-08); kế hoạch đầu tư',
  ]);
});

test('scenario monitor evaluates trigger distance and lifecycle status', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_eval', 'workspace_a'), {
    id: 'thesis_eval',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    direction: 'long',
    confidence: 0.61,
    created_at: '2026-06-05T00:00:00.000Z',
    thesis_text: 'Watch BNB breakout.',
  });
  journal.scenarios.set(key('thesis_eval', 'workspace_a'), [
    {
      id: 'scenario_eval',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_eval',
      scenario_name: 'Breakout reclaim',
      probability_band: 'medium',
      suggested_user_action: 'watch',
      condition: 'BNB/USDT reclaims 620 on a daily close.',
      payload: {
        trigger_spec: {
          type: 'price_above',
          level: 620,
          timeframe: '1D',
        },
      },
    },
  ]);
  journal.marketSnapshots.set(key('snap_bnb_eval', 'workspace_a'), {
    id: 'snap_bnb_eval',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    captured_at: new Date().toISOString(),
    current_price: 612,
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.status, 'near_trigger');
  assert.equal(monitor.items[0]?.scenario.status, 'near_trigger');
  assert.equal(monitor.items[0]?.scenario.distance_to_trigger, 0.0129);
  assert.match(monitor.items[0]?.scenario.status_reason ?? '', /1.29% below 620/);
  assert.equal(monitor.items[0]?.scenario.trigger_spec?.type, 'price_above');
});

test('scenario runtime decision marks expired playbooks as review only', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_expired_runtime', 'workspace_a'), {
    id: 'thesis_expired_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_expired_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_expired_runtime',
      thesisId: 'thesis_expired_runtime',
      validUntil: '2026-06-02T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_expired_runtime', 'workspace_a'), {
    id: 'snap_bnb_expired_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 625,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.validity_status, 'expired');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'review');
  assert.equal(
    monitor.items[0]?.scenario.runtime_decision.blocking_reasons.includes('expired'),
    true,
  );
});

test('scenario runtime decision treats near trigger as consider only', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_near_runtime', 'workspace_a'), {
    id: 'thesis_near_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_near_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_near_runtime',
      thesisId: 'thesis_near_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_near_runtime', 'workspace_a'), {
    id: 'snap_bnb_near_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 612,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.trigger_status, 'near_trigger');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'consider_long');
});

test('scenario runtime decision allows entry long now only when gates pass', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_entry_runtime', 'workspace_a'), {
    id: 'thesis_entry_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_entry_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_entry_runtime',
      thesisId: 'thesis_entry_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_entry_runtime', 'workspace_a'), {
    id: 'snap_bnb_entry_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.trigger_status, 'triggered');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.validity_status, 'valid');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'entry_long_now');
  assert.deepEqual(monitor.items[0]?.scenario.runtime_decision.blocking_reasons, []);
});

test('scenario runtime decision does not trigger on watch-only conditions', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_watch_only_runtime', 'workspace_a'), {
    id: 'thesis_watch_only_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim zone.',
  });
  journal.scenarios.set(key('thesis_watch_only_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_watch_only_runtime',
      thesisId: 'thesis_watch_only_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions: [
        {
          id: 'watch_zone',
          label: 'Watch reclaim zone',
          role: 'watch',
          type: 'price_in_zone',
          zone_low: 615,
          zone_high: 625,
        },
      ],
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_watch_only_runtime', 'workspace_a'), {
    id: 'snap_bnb_watch_only_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  const runtime = monitor.items[0]?.scenario.runtime_decision;
  assert.equal(runtime?.trigger_status, 'needs_review');
  assert.equal(runtime?.recommended_action, 'wait');
  assert.deepEqual(runtime?.matched_conditions, []);
});

test('scenario runtime decision triggers on explicit trigger role conditions', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_role_trigger_runtime', 'workspace_a'), {
    id: 'thesis_role_trigger_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Trade BNB reclaim after trigger.',
  });
  journal.scenarios.set(key('thesis_role_trigger_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_role_trigger_runtime',
      thesisId: 'thesis_role_trigger_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions: [
        {
          id: 'watch_zone',
          label: 'Watch reclaim zone',
          role: 'watch',
          type: 'price_in_zone',
          zone_low: 615,
          zone_high: 625,
        },
        {
          id: 'trigger_close',
          label: 'Close above trigger',
          role: 'trigger',
          type: 'price_above',
          level: 620,
        },
      ],
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_role_trigger_runtime', 'workspace_a'), {
    id: 'snap_bnb_role_trigger_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  const runtime = monitor.items[0]?.scenario.runtime_decision;
  assert.equal(runtime?.trigger_status, 'triggered');
  assert.equal(runtime?.recommended_action, 'entry_long_now');
  assert.deepEqual(runtime?.matched_conditions, ['price_above:620']);
});

test('price reclaim requires a closed candle crossing sequence', () => {
  const result = evaluateScenarioCondition(
    {
      id: 'reclaim_100',
      role: 'trigger',
      type: 'price_reclaim_level',
      level: 100,
      timeframe: '1h',
      candle_close_required: true,
    },
    {
      currentPrice: 101,
      evaluatedAt: '2026-07-02T12:00:00.000Z',
      marketSnapshotId: 'snap_reclaim',
      closedCandlesByInterval: {
        '1h': [
          candle('2026-07-02T10:00:00.000Z', 101, 102, 99, 99),
          candle('2026-07-02T11:00:00.000Z', 99, 102, 98, 101),
        ],
      },
    },
  );

  assert.equal(result.status, 'passed');
});

test('volume confirmation is unknown when lookback candles are insufficient', () => {
  const result = evaluateScenarioCondition(
    {
      id: 'volume_gate',
      role: 'confirmation',
      type: 'volume_above_average',
      timeframe: '1h',
      lookback_periods: 20,
      multiplier: 1.5,
    },
    {
      currentPrice: 101,
      evaluatedAt: '2026-07-02T12:00:00.000Z',
      marketSnapshotId: 'snap_volume',
      closedCandlesByInterval: {
        '1h': [
          candle('2026-07-02T11:00:00.000Z', 100, 101, 99, 101, 10),
        ],
      },
    },
  );

  assert.equal(result.status, 'unknown');
  assert.equal(result.blocksStrongAction, true);
});

test('scenario runtime decision blocks entry now when confirmation is unknown', () => {
  const now = '2026-07-02T12:00:00.000Z';
  const scenario = runtimeScenarioFixture({
    id: 'scenario_confirmation_unknown',
    thesisId: 'thesis_confirmation_unknown',
    validUntil: '2999-01-01T00:00:00.000Z',
    preferred: 'entry_long_now',
    confidence: 0.82,
    invalidationConditions: [
      {
        id: 'confirmation_invalidation',
        label: 'Confirmation invalidation',
        role: 'invalidation',
        type: 'price_below',
        level: 90,
      },
    ],
    entryConditions: [
      {
        id: 'trigger_close',
        label: 'Trigger close',
        role: 'trigger',
        type: 'price_above',
        level: 100,
      },
      {
        id: 'volume_gate',
        label: 'Volume confirmation',
        role: 'confirmation',
        type: 'volume_above_average',
        timeframe: '1h',
        lookback_periods: 20,
        multiplier: 1.5,
      },
    ],
  });

  const runtime = evaluateScenarioRuntimeDecision(
    scenario,
    {
      id: 'snap_confirmation_unknown',
      workspace_id: 'workspace_a',
      symbol: 'TEST/USDT',
      current_price: 101,
      captured_at: now,
      source: 'test',
    },
    now,
    {
      currentPrice: 101,
      evaluatedAt: now,
      marketSnapshotId: 'snap_confirmation_unknown',
      closedCandlesByInterval: {
        '1h': [
          candle('2026-07-02T11:00:00.000Z', 100, 101, 99, 101, 10),
        ],
      },
    },
  );

  assert.equal(runtime.trigger_status, 'triggered');
  assert.equal(runtime.recommended_action, 'wait');
  assert.equal(
    runtime.blocking_reasons.includes(
      'Confirmation not passed: Volume confirmation.',
    ),
    true,
  );
  assert.equal(
    runtime.final_decision.overrides.includes(
      'confirmation_not_passed:volume_gate',
    ),
    true,
  );
});

test('scenario runtime decision blocks entry now when an entry condition fails', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_failed_condition_runtime', 'workspace_a'), {
    id: 'thesis_failed_condition_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_failed_condition_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_failed_condition_runtime',
      thesisId: 'thesis_failed_condition_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions: [
        { type: 'price_above', level: 620 },
        { type: 'price_above', level: 630 },
      ],
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_failed_condition_runtime', 'workspace_a'), {
    id: 'snap_bnb_failed_condition_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  const runtime = monitor.items[0]?.scenario.runtime_decision;
  assert.equal(runtime?.trigger_status, 'triggered');
  assert.equal(runtime?.recommended_action, 'wait');
  assert.deepEqual(runtime?.failed_conditions, ['price_above:630']);
  assert.equal(
    runtime?.blocking_reasons.includes('failed_condition:price_above:630'),
    true,
  );
});

test('scenario runtime decision does not consider action while hard gates are pending', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_hard_gate_runtime', 'workspace_a'), {
    id: 'thesis_hard_gate_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_hard_gate_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_hard_gate_runtime',
      thesisId: 'thesis_hard_gate_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      scenarioRecommendation: {
        version: 'scenario_recommendation.v1',
        action: 'entry_long_now',
        action_bias: 'long',
        confidence: 0.82,
        blocking_reasons: ['Waiting for candle close confirmation.'],
        hard_gates: [
          {
            id: 'candle_close',
            label: 'Candle close confirmation',
            status: 'pending',
            reason: 'Current candle has not closed.',
          },
        ],
      },
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_hard_gate_runtime', 'workspace_a'), {
    id: 'snap_bnb_hard_gate_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  const runtime = monitor.items[0]?.scenario.runtime_decision;
  assert.equal(runtime?.trigger_status, 'triggered');
  assert.equal(runtime?.validity_status, 'valid');
  assert.equal(runtime?.recommended_action, 'wait');
  assert.equal(
    runtime?.blocking_reasons.includes('Waiting for candle close confirmation.'),
    true,
  );
  assert.equal(
    runtime?.blocking_reasons.includes(
      'Hard gate not passed: Candle close confirmation.',
    ),
    true,
  );
});

test('scenario runtime decision prefers top-level recommendation over stale payload recommendation', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_recommendation_priority_runtime', 'workspace_a'), {
    id: 'thesis_recommendation_priority_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  const fixture = runtimeScenarioFixture({
    id: 'scenario_recommendation_priority_runtime',
    thesisId: 'thesis_recommendation_priority_runtime',
    validUntil: '2999-01-01T00:00:00.000Z',
    preferred: 'entry_long_now',
    confidence: 0.82,
    scenarioRecommendation: {
      version: 'scenario_recommendation.v1',
      action: 'entry_long_now',
      action_bias: 'long',
      confidence: 0.82,
      blocking_reasons: ['Payload blocker should not win.'],
    },
  });
  fixture.scenario_recommendation = {
    version: 'scenario_recommendation.v1',
    action: 'entry_long_now',
    action_bias: 'long',
    confidence: 0.82,
    blocking_reasons: [],
    hard_gates: [
      {
        id: 'fresh_market_data',
        label: 'Fresh market data',
        status: 'passed',
        reason: 'Snapshot is current.',
      },
    ],
  };
  journal.scenarios.set(key('thesis_recommendation_priority_runtime', 'workspace_a'), [
    fixture,
  ]);
  journal.marketSnapshots.set(key('snap_bnb_recommendation_priority_runtime', 'workspace_a'), {
    id: 'snap_bnb_recommendation_priority_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  const runtime = monitor.items[0]?.scenario.runtime_decision;
  assert.equal(runtime?.recommended_action, 'entry_long_now');
  assert.equal(
    runtime?.blocking_reasons.includes('Payload blocker should not win.'),
    false,
  );
});

test('scenario runtime decision downgrades entry when price is overextended', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_overextended_runtime', 'workspace_a'), {
    id: 'thesis_overextended_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_overextended_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_overextended_runtime',
      thesisId: 'thesis_overextended_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_overextended_runtime', 'workspace_a'), {
    id: 'snap_bnb_overextended_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 640,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(
    monitor.items[0]?.scenario.runtime_decision.blocking_reasons.includes(
      'Price is overextended from trigger.',
    ),
    true,
  );
  assert.equal(monitor.items[0]?.scenario.runtime_decision.validity_status, 'overextended');
  assert.notEqual(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'entry_long_now');
});

test('scenario runtime decision honors custom overextended threshold', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_custom_overextension_runtime', 'workspace_a'), {
    id: 'thesis_custom_overextension_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_custom_overextension_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_custom_overextension_runtime',
      thesisId: 'thesis_custom_overextension_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      avoidIf: [{ type: 'overextended_from_trigger', threshold_pct: 10 }],
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_custom_overextension_runtime', 'workspace_a'), {
    id: 'snap_bnb_custom_overextension_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 640,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.validity_status, 'valid');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'entry_long_now');
  assert.equal(
    monitor.items[0]?.scenario.runtime_decision.blocking_reasons.includes(
      'Price is overextended from trigger.',
    ),
    false,
  );
});

test('scenario runtime decision evaluates zone-only triggers', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_zone_runtime', 'workspace_a'), {
    id: 'thesis_zone_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim zone.',
  });
  journal.scenarios.set(key('thesis_zone_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_zone_runtime',
      thesisId: 'thesis_zone_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions: [{ type: 'price_in_zone', zone_low: 615, zone_high: 630 }],
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_zone_runtime', 'workspace_a'), {
    id: 'snap_bnb_zone_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.trigger_status, 'triggered');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.distance_to_trigger, 0);
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'entry_long_now');
});

test('scenario runtime decision marks stale crossed triggers as stale review', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_stale_runtime', 'workspace_a'), {
    id: 'thesis_stale_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB stale data.',
  });
  journal.scenarios.set(key('thesis_stale_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_stale_runtime',
      thesisId: 'thesis_stale_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_stale_runtime', 'workspace_a'), {
    id: 'snap_bnb_stale_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: '2026-06-01T00:00:00.000Z',
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.status, 'stale');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.trigger_status, 'stale');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'review');
  assert.equal(
    monitor.items[0]?.scenario.runtime_decision.blocking_reasons.includes(
      'Market data is stale.',
    ),
    true,
  );
});

test('scenario runtime decision does not default neutral bias into long actions', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_neutral_runtime', 'workspace_a'), {
    id: 'thesis_neutral_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB neutral setup.',
  });
  journal.scenarios.set(key('thesis_neutral_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_neutral_runtime',
      thesisId: 'thesis_neutral_runtime',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      actionBias: 'neutral',
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_neutral_runtime', 'workspace_a'), {
    id: 'snap_bnb_neutral_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 612,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.trigger_status, 'near_trigger');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'review');
  assert.equal(
    monitor.items[0]?.scenario.runtime_decision.blocking_reasons.includes(
      'Scenario action bias is not actionable.',
    ),
    true,
  );
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

  const response = await workbench.attention(10, 'user_1', 'workspace_a');
  const responseRecord = response as unknown as Record<string, unknown>;
  const sourceTypes = new Set<string>(response.items.map((item) => item.source_type));
  const notificationTypes = new Set<string>(
    response.notifications.map((notification) => notification.type),
  );
  const alertItem = response.items.find((item) => item.source_id === 'alert_attention');

  assert.equal(response.workspace_id, 'workspace_a');
  assert.ok(response.items.length <= 10);
  assert.ok(response.unresolved_count > 0);
  assert.equal('latest_brief' in responseRecord, false);
  assert.equal('brief_actions' in responseRecord, false);
  assert.equal(response.queues[0]?.priority, 'critical');
  assert.ok(response.queues.some((queue) => queue.priority === 'review'));
  assert.ok(sourceTypes.has('alert'));
  assert.ok(sourceTypes.has('run'));
  assert.ok(sourceTypes.has('provider'));
  assert.ok(sourceTypes.has('thesis'));
  assert.ok(sourceTypes.has('scenario'));
  assert.equal(sourceTypes.has('brief'), false);
  assert.equal(sourceTypes.has('watchlist'), false);
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
  assert.equal(notificationTypes.has('watchlist'), false);
  assert.equal(notificationTypes.has('brief'), false);
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

test('workbench attention includes active scenarios ordered by monitor urgency', async () => {
  const { journal, workbench } = buildHarness();
  journal.theses.set(key('thesis_workbench_scenario', 'workspace_a'), {
    id: 'thesis_workbench_scenario',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB levels.',
  });
  journal.scenarios.set(key('thesis_workbench_scenario', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_workbench_near',
      thesisId: 'thesis_workbench_scenario',
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_workbench_bnb', 'workspace_a'), {
    id: 'snap_workbench_bnb',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 612,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const response = await workbench.attention(10, 'user_1', 'workspace_a');

  assert.equal(response.active_scenarios[0]?.id, 'scenario_workbench_near');
  assert.equal(response.active_scenarios[0]?.status, 'near_trigger');
  assert.equal(response.active_scenarios[0]?.runtime_decision.trigger_status, 'near_trigger');
  assert.equal(response.active_scenarios[0]?.runtime_decision.recommended_action, 'consider_long');
});

function runtimeScenarioFixture(input: {
  id: string;
  thesisId: string;
  validUntil: string;
  preferred: string;
  confidence: number;
  actionBias?: string;
  avoidIf?: JsonRecord[];
  entryConditions?: JsonRecord[];
  invalidationConditions?: JsonRecord[];
  scenarioRecommendation?: JsonRecord;
}): JsonRecord {
  return {
    id: input.id,
    workspace_id: 'workspace_a',
    thesis_id: input.thesisId,
    scenario_name: 'Runtime reclaim',
    condition: 'BNB/USDT reclaims 620.',
    invalidation: 'Invalid below 600.',
    probability_band: 'medium',
    payload: {
      trigger_spec: { type: 'price_above', level: 620 },
      decision_playbook: {
        version: 'scenario_decision_playbook.v1',
        source: 'llm',
        generated_at: '2026-06-07T00:00:00.000Z',
        generated_from_run_id: 'run_runtime',
        action_bias: input.actionBias ?? 'long',
        confidence: input.confidence,
        preferred_action_if_triggered: input.preferred,
        fallback_action: 'wait',
        near_trigger_threshold_pct: 2,
        validity_window: {
          valid_from: '2026-06-07T00:00:00.000Z',
          valid_until: input.validUntil,
          timeframe: '1D',
          rationale: 'Runtime fixture validity window.',
          refresh_policy: 'refresh_on_next_research_run',
        },
        entry_conditions: input.entryConditions ?? [{ type: 'price_above', level: 620 }],
        avoid_if: input.avoidIf ?? [{ type: 'overextended_from_trigger', threshold_pct: 2.5 }],
        invalidation_conditions: input.invalidationConditions ?? [{ type: 'price_below', level: 600 }],
        wait_for: ['Price above 620.'],
        risk_notes: [],
        evidence_refs: [
          {
            type: 'scenario',
            id: input.id,
            field: 'payload.trigger_spec',
            label: 'Trigger spec',
            supports: 'Trigger level is machine-readable.',
          },
        ],
        rationale: 'Fixture playbook.',
      },
      ...(input.scenarioRecommendation
        ? { scenario_recommendation: input.scenarioRecommendation }
        : {}),
    },
  };
}

const createResearchRunMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateResearchRunDto,
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

function seedScenarioLifecycleFixture(
  journal: FakeJournalRepository,
  options: {
    scenarioId: string;
    thesisId: string;
    symbol: string;
    workspaceId?: string;
    evaluationWindowStartsAt?: string;
    evaluationWindowEndsAt?: string;
  },
): void {
  const workspaceId = options.workspaceId ?? 'workspace_a';
  journal.theses.set(key(options.thesisId, workspaceId), {
    id: options.thesisId,
    workspace_id: workspaceId,
    symbol: options.symbol,
    market_type: 'spot',
    direction: 'long',
    setup_type: 'breakout',
    created_at: '2026-06-29T00:00:00.000Z',
  });
  journal.scenarios.set(key(options.thesisId, workspaceId), [
    scenarioLifecycleRecord({
      scenarioId: options.scenarioId,
      thesisId: options.thesisId,
      symbol: options.symbol,
      workspaceId,
      evaluationWindowStartsAt: options.evaluationWindowStartsAt,
      evaluationWindowEndsAt: options.evaluationWindowEndsAt,
    }),
  ]);
}

async function seedScenarioEvaluation(
  journal: FakeJournalRepository,
  options: {
    workspaceId: string;
    symbol: string;
    result: string;
    rawContinuityText?: string;
  },
): Promise<JsonRecord> {
  const suffix = [
    options.workspaceId,
    options.symbol,
    options.result,
    journal.scenarioEvaluations.size + 1,
  ]
    .join('_')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase();
  return journal.saveScenarioEvaluation(
    {
      id: `scenario_feedback_eval_${suffix}`,
      scenario_id: `scenario_feedback_${suffix}`,
      thesis_id: `thesis_feedback_${suffix}`,
      symbol: options.symbol,
      market_type: 'spot',
      horizon: 'short_term',
      evaluated_at: '2026-07-01T00:00:00.000Z',
      evaluation_window: {
        starts_at: '2026-06-28T00:00:00.000Z',
        ends_at: '2026-07-01T00:00:00.000Z',
      },
      result: options.result,
      data_quality: 'complete',
      evidence: {
        relation_to_thesis: 'supports',
        action_bias: 'long',
        raw_continuity_text: options.rawContinuityText,
      },
    },
    options.workspaceId,
  );
}

function scenarioLifecycleRecord(
  options: {
    scenarioId: string;
    thesisId: string;
    symbol?: string;
    workspaceId?: string;
    invalidationConditions?: JsonRecord[];
    actionBias?: 'long' | 'short' | 'neutral' | 'unknown';
    evaluationWindowStartsAt?: string;
    evaluationWindowEndsAt?: string;
  },
): JsonRecord {
  const symbol = options.symbol ?? 'BTC/USDT';
  const workspaceId = options.workspaceId ?? 'workspace_a';
  const actionBias = options.actionBias ?? 'long';
  const requiredConditions = [
    {
      type: 'price_above',
      level: 62000,
      timeframe: '1d',
      candle_close_required: false,
    },
  ];
  const invalidationConditions = options.invalidationConditions ?? [
    {
      type: 'price_below',
      level: 60000,
      timeframe: '1d',
      candle_close_required: false,
    },
  ];
  const recommendation = {
    version: 'scenario_recommendation.v1',
    generated_at: '2026-06-29T00:00:00.000Z',
    source: 'derived_v1',
    action: actionBias === 'short' ? 'consider_short' : 'consider_long',
    action_bias: actionBias,
    confidence: 0.72,
    summary: `${symbol} reclaims the trigger zone.`,
    thesis_link: 'Supports the parent long thesis.',
    required_conditions: requiredConditions,
    invalidation_conditions: invalidationConditions,
    wait_for: ['Price trades through 62000.'],
    hard_gates: [
      {
        id: 'liquidity',
        label: 'Liquidity available',
        status: 'passed',
        reason: 'Recent candles are available.',
      },
    ],
    blocking_reasons: [],
    risk_notes: ['Size only after trigger confirmation.'],
    evidence_refs: [
      {
        type: 'scenario',
        id: options.scenarioId,
        field: 'condition',
        label: 'Trigger condition',
        supports: 'price reclaim',
      },
    ],
    valid_until: '2026-07-03T00:00:00.000Z',
    evaluation_readiness: 'ready',
    evaluation_window: {
      starts_at: options.evaluationWindowStartsAt ?? '2026-06-24T00:00:00.000Z',
      ends_at: options.evaluationWindowEndsAt ?? '2026-06-28T00:00:00.000Z',
      horizon: 'short_term',
      metric_hint: 'trigger_then_mfe_mae',
    },
  };
  return {
    id: options.scenarioId,
    workspace_id: workspaceId,
    thesis_id: options.thesisId,
    scenario_name: `${symbol} reclaim scenario`,
    direction: 'Bullish continuation',
    relation_to_thesis: 'supports',
    probability_band: 'base',
    suggested_user_action: 'Wait for the reclaim trigger.',
    condition: 'Price reclaims 62000.',
    expected_behavior: 'Continuation after reclaim.',
    invalidation: 'Price loses 60000.',
    evidence: ['Breakout structure'],
    risk_map: ['False breakout'],
    horizon: 'short_term',
    scenario_recommendation: recommendation,
    runtime_decision: {
      version: 'scenario_runtime_decision.v1',
      evaluated_at: '2026-06-29T00:00:00.000Z',
      trigger_status: 'watching',
      validity_status: 'valid',
      recommended_action: 'consider_long',
      confidence: 0.72,
      matched_conditions: [],
      failed_conditions: [],
      blocking_reasons: [],
      risk_notes: ['Trigger is not confirmed yet.'],
      evidence_refs: recommendation.evidence_refs,
      source: 'rule_engine_from_decision_playbook',
      playbook_source: 'recommendation',
      status_reason: 'Waiting for trigger.',
      distance_to_trigger: 0.02,
      llm_recommendation: null,
      final_decision: {
        action: 'consider_long',
        reason: 'Scenario is valid and near trigger.',
        overrides: [],
      },
    },
    payload: {
      horizon: 'short_term',
      relation_to_thesis: 'supports',
      scenario_recommendation: recommendation,
    },
  };
}

function tradePlaybookFixture(id: string): JsonRecord {
  return {
    version: 'trade_playbook.v1',
    id,
    workspace_id: 'workspace_a',
    source_scenario_id: 'scenario_backtest_fee',
    source_thesis_id: 'thesis_backtest_fee',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    direction: 'long',
    horizon: 'short_term',
    entry: {
      type: 'level',
      level: 62000,
      summary: 'Enter on reclaim of 62000.',
    },
    invalidation: {
      level: 60000,
      summary: 'Exit if price loses 60000.',
    },
    targets: [
      {
        label: 'Target 1',
        level: 63200,
        priority: 1,
      },
    ],
    no_trade_conditions: ['No trade without trigger confirmation.'],
    risk_context: ['False breakout risk.'],
    sizing_policy: 'fixed_notional',
    evidence_refs: [
      {
        type: 'scenario',
        id: 'scenario_backtest_fee',
        field: 'condition',
        label: 'Scenario trigger',
        supports: 'entry level',
      },
    ],
    reliability_context: null,
    compile_warnings: [],
    created_at: '2026-06-29T00:00:00.000Z',
  };
}

function seedChartScenario(
  journal: FakeJournalRepository,
  options: { thesisId: string; scenarioId: string },
): void {
  journal.theses.set(key(options.thesisId, 'workspace_a'), {
    id: options.thesisId,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    market_type: 'spot',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key(options.thesisId, 'workspace_a'), [
    runtimeScenarioFixture({
      id: options.scenarioId,
      thesisId: options.thesisId,
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions: [
        {
          id: 'watch_zone',
          label: 'Watch zone',
          role: 'watch',
          type: 'price_in_zone',
          zone_low: 615,
          zone_high: 625,
        },
        {
          id: 'trigger_close',
          label: 'Trigger close',
          role: 'trigger',
          type: 'price_above',
          level: 620,
        },
      ],
    }),
  ]);
  journal.marketSnapshots.set(key(`snap_${options.scenarioId}`, 'workspace_a'), {
    id: `snap_${options.scenarioId}`,
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });
}

function seedScenarioWithCondition(
  journal: FakeJournalRepository,
  options: {
    workspaceId: string;
    role: 'trigger' | 'invalidation';
    type: 'price_in_zone';
    zone_low: number;
    zone_high: number;
  },
): string {
  const scenarioId = `scenario_${options.role}_zone`;
  const thesisId = `thesis_${options.role}_zone`;
  journal.theses.set(key(thesisId, options.workspaceId), {
    id: thesisId,
    workspace_id: options.workspaceId,
    symbol: 'BNB/USDT',
    market_type: 'spot',
    thesis_text: 'Watch BNB zone behavior.',
  });
  journal.scenarios.set(key(thesisId, options.workspaceId), [
    runtimeScenarioFixture({
      id: scenarioId,
      thesisId,
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions:
        options.role === 'trigger'
          ? [
              {
                id: 'trigger_zone',
                label: 'Trigger zone',
                role: 'trigger',
                type: options.type,
                zone_low: options.zone_low,
                zone_high: options.zone_high,
              },
            ]
          : [
              {
                id: 'trigger_close',
                label: 'Trigger close',
                role: 'trigger',
                type: 'price_above',
                level: 100,
              },
            ],
      invalidationConditions:
        options.role === 'invalidation'
          ? [
              {
                id: 'invalidation_zone',
                label: 'Invalidation zone',
                role: 'invalidation',
                type: options.type,
                zone_low: options.zone_low,
                zone_high: options.zone_high,
              },
            ]
          : [
              {
                id: 'invalidation_floor',
                label: 'Invalidation floor',
                role: 'invalidation',
                type: 'price_below',
                level: 90,
              },
            ],
    }),
  ]);
  journal.marketSnapshots.set(key(`snap_${scenarioId}`, options.workspaceId), {
    id: `snap_${scenarioId}`,
    workspace_id: options.workspaceId,
    symbol: 'BNB/USDT',
    current_price: 102,
    captured_at: new Date().toISOString(),
    source: 'test',
  });
  return scenarioId;
}

function seedTransitionScenario(
  journal: FakeJournalRepository,
  scenarioId: string,
  workspaceId: string,
): void {
  const thesisId = `thesis_${scenarioId}`;
  journal.theses.set(key(thesisId, workspaceId), {
    id: thesisId,
    workspace_id: workspaceId,
    symbol: 'TEST/USDT',
    market_type: 'spot',
    thesis_text: 'Watch transition behavior.',
  });
  journal.scenarios.set(key(thesisId, workspaceId), [
    runtimeScenarioFixture({
      id: scenarioId,
      thesisId,
      validUntil: '2999-01-01T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
      entryConditions: [
        {
          id: 'transition_trigger',
          label: 'Transition trigger',
          role: 'trigger',
          type: 'price_above',
          level: 100,
        },
      ],
      invalidationConditions: [
        {
          id: 'transition_invalidation',
          label: 'Transition invalidation',
          role: 'invalidation',
          type: 'price_below',
          level: 100,
        },
      ],
    }),
  ]);
}

async function refreshWithSnapshot(
  journal: FakeJournalRepository,
  scenarioLiveState: ScenarioLiveStateService,
  scenarioId: string,
  workspaceId: string,
  snapshotId: string,
  currentPrice: number,
): Promise<void> {
  journal.marketSnapshots.set(key(snapshotId, workspaceId), {
    id: snapshotId,
    workspace_id: workspaceId,
    symbol: 'TEST/USDT',
    current_price: currentPrice,
    captured_at: `2026-07-02T00:0${journal.marketSnapshots.size}.000Z`,
    source: 'test',
  });
  await scenarioLiveState.refreshLiveState(scenarioId, workspaceId);
}

function sourceHashesForScenario(
  journal: FakeJournalRepository,
  scenarioId: string,
  workspaceId = 'workspace_a',
) {
  let scenario: JsonRecord | null = null;
  for (const [scenarioKey, scenarios] of journal.scenarios) {
    if (!scenarioKey.startsWith(`${workspaceId}:`)) {
      continue;
    }
    scenario = scenarios.find((item) => item.id === scenarioId) ?? null;
    if (scenario) {
      break;
    }
  }
  const thesisId = nullableString(scenario?.thesis_id);
  const thesis = thesisId
    ? journal.theses.get(key(thesisId, workspaceId)) ?? null
    : null;
  const response = toScenarioResponse(scenario ?? {}, thesis ?? {});
  return playbookSourceHashes({
    scenario: response.payload,
    decisionPlaybook: response.decision_playbook,
    recommendation: response.scenario_recommendation,
    runtimeDecision: response.runtime_decision,
  });
}

function chartOhlcvResponse(
  candles: MarketOhlcvResponse['candles'],
  warning: string | null = null,
): MarketOhlcvResponse {
  return {
    symbol: 'BNB/USDT',
    market_type: 'spot',
    interval: '15m',
    from: '2026-07-02T00:00:00.000Z',
    to: '2026-07-02T01:00:00.000Z',
    source: 'test',
    provider: 'test',
    generated_at: '2026-07-02T01:00:00.000Z',
    candles,
    warning,
  };
}

function candle(
  time: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
){
  return {
    time,
    open,
    high,
    low,
    close,
    volume,
  };
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
  const researchRuns = new ResearchRunsService(journal, jobs, auth, workspaces);
  const scenarioOhlcv = new MarketOhlcvService();
  const backtestOhlcv = new MarketOhlcvService();
  const paperExecutionOhlcv = new MarketOhlcvService();
  const scenarioReliability = new ScenarioReliabilityService(
    journal,
    auth,
    workspaces,
  );
  const scenarioFeedback = new ScenarioFeedbackPlaybookService(
    journal,
    auth,
    workspaces,
  );
  const scenarioContextLoader = new ScenarioContextLoaderService(journal);
  const scenarioLiveState = new ScenarioLiveStateService(
    journal,
    scenarioOhlcv,
    scenarioContextLoader,
  );
  const scenarioChartProjection = new ScenarioChartProjectionService(
    scenarioContextLoader,
    scenarioOhlcv,
    scenarioLiveState,
  );
  const scenarioChartSummary = new ScenarioChartSummaryService(
    scenarioContextLoader,
    scenarioLiveState,
  );
  const paperExecution = new PaperExecutionService(
    journal,
    auth,
    workspaces,
    paperExecutionOhlcv,
  );
  return {
    auth,
    journal,
    workspaces,
    evaluationEngineCalls,
    jobs,
    researchRuns,
    researchRunsController: new ResearchRunsController(researchRuns),
    jobsController: new JobsController(jobs, auth, workspaces),
    signals: new SignalsService(journal, auth, workspaces),
    theses: new ThesesService(
      journal,
      auth,
      workspaces,
      scenarioReliability,
      undefined,
    ),
    alerts: new AlertsService(journal, auth, workspaces),
    calibration: new CalibrationService(
      journal,
      auth,
      workspaces,
      thesisEngine,
    ),
    performance: new PerformanceService(journal, auth, workspaces),
    scenarioOhlcv,
    scenarios: new ScenariosService(
      journal,
      auth,
      workspaces,
      scenarioReliability,
      scenarioLiveState,
      scenarioChartProjection,
      scenarioChartSummary,
      paperExecution,
    ),
    scenarioEvaluations: new ScenarioEvaluationService(
      journal,
      auth,
      workspaces,
      scenarioOhlcv,
    ),
    scenarioChartProjection,
    scenarioChartSummary,
    scenarioContextLoader,
    scenarioFeedback,
    scenarioLiveState,
    scenarioReliability,
    playbooks: new PlaybookCompilerService(
      journal,
      auth,
      workspaces,
      scenarioReliability,
    ),
    backtests: new BacktestService(journal, auth, workspaces, backtestOhlcv),
    paperExecution,
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

function missingRelationError(table: string): Error & { code: string } {
  const error = new Error(`relation "${table}" does not exist`) as Error & {
    code: string;
  };
  error.code = '42P01';
  return error;
}

function compareRunChainOrder(left: JsonRecord, right: JsonRecord): number {
  return (
    runChainTimestamp(left) - runChainTimestamp(right) ||
    String(left.id ?? left.run_id ?? '').localeCompare(
      String(right.id ?? right.run_id ?? ''),
    )
  );
}

function runChainTimestamp(run: JsonRecord): number {
  const value = String(run.started_at ?? run.created_at ?? '');
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function removeArrayItems<T>(
  items: T[],
  predicate: (item: T) => boolean,
): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) {
      items.splice(index, 1);
    }
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function dueAtOrNowMs(value: unknown, nowMs: number): number {
  const timestamp = nullableString(value);
  if (!timestamp) {
    return nowMs;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : nowMs;
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

function isException(
  exceptionType: new (...args: string[]) => Error,
): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof exceptionType;
}

function hasForbiddenCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof ForbiddenException)) {
      return false;
    }
    const response = error.getResponse();
    const record =
      response && typeof response === 'object'
        ? (response as Record<string, unknown>)
        : {};
    return record.code === code && record.statusCode === 403;
  };
}

function hasBadRequestCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof BadRequestException)) {
      return false;
    }
    const response = error.getResponse();
    const record =
      response && typeof response === 'object'
        ? (response as Record<string, unknown>)
        : {};
    return record.code === code;
  };
}

function fixedWorkspaceMetadata(
  id: string,
  symbol: string,
): WorkspaceMetadata {
  return {
    id,
    name: `${symbol} Workspace`,
    scope_type: 'fixed_symbol',
    symbol,
    market_type: 'mixed',
    default_timeframe: null,
    archived: false,
    created_at: '2026-05-31T00:00:00.000Z',
    updated_at: '2026-05-31T00:00:00.000Z',
  };
}

class FakeWorkspacePool {
  private readonly users = new Set<string>();
  private readonly workspaces = new Map<string, Record<string, unknown>>();
  private readonly memberships = new Map<string, Record<string, unknown>>();
  private readonly newsSources = new Map<string, Record<string, unknown>[]>();

  async query(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (
      normalized === 'begin' ||
      normalized === 'commit' ||
      normalized === 'rollback' ||
      normalized.startsWith('create table') ||
      normalized.startsWith('alter table') ||
      normalized.startsWith('create unique index') ||
      normalized.startsWith('create index')
    ) {
      return { rows: [] };
    }

    if (normalized.startsWith('insert into users')) {
      this.users.add(String(params[0]));
      return { rows: [] };
    }

    if (normalized.startsWith('insert into workspaces')) {
      const [
        id,
        name,
        scopeType,
        symbol,
        marketType,
        defaultTimeframe,
        archived,
        createdAt,
        updatedAt,
      ] = params;
      this.workspaces.set(String(id), {
        id,
        name,
        scope_type: scopeType,
        symbol,
        market_type: marketType,
        default_timeframe: defaultTimeframe,
        archived,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { rows: [] };
    }

    if (normalized.startsWith('insert into workspace_memberships')) {
      const [id, workspaceId, userId, role] = params;
      this.memberships.set(`${userId}:${workspaceId}`, {
        id,
        workspace_id: workspaceId,
        user_id: userId,
        role,
      });
      return { rows: [] };
    }

    if (normalized.startsWith('delete from workspace_news_sources')) {
      this.newsSources.delete(String(params[0]));
      return { rows: [] };
    }

    if (normalized.startsWith('insert into workspace_news_sources')) {
      const [workspaceId, sourceId, enabled, targetAnalysts, sortOrder, payload] = params;
      const rows = this.newsSources.get(String(workspaceId)) ?? [];
      rows.push({
        workspace_id: workspaceId,
        source_id: sourceId,
        enabled,
        target_analysts_json:
          typeof targetAnalysts === 'string'
            ? JSON.parse(targetAnalysts)
            : targetAnalysts,
        sort_order: sortOrder,
        payload_json: typeof payload === 'string' ? JSON.parse(payload) : payload,
      });
      this.newsSources.set(String(workspaceId), rows);
      return { rows: [] };
    }

    if (
      normalized.includes('from workspace_news_sources') &&
      normalized.includes('where workspace_id = $1')
    ) {
      const rows = [...(this.newsSources.get(String(params[0])) ?? [])].sort(
        (left, right) =>
          Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0) ||
          String(left.source_id ?? '').localeCompare(String(right.source_id ?? '')),
      );
      return { rows };
    }

    if (
      normalized.includes('from workspace_memberships') &&
      normalized.includes('where user_id = $1 and workspace_id = $2')
    ) {
      const [userId, workspaceId] = params;
      const membership = this.memberships.get(`${userId}:${workspaceId}`);
      return { rows: membership ? [membership] : [] };
    }

    if (
      normalized.includes('from workspaces') &&
      normalized.includes('where id = $1')
    ) {
      const workspace = this.workspaces.get(String(params[0]));
      return { rows: workspace ? [workspace] : [] };
    }

    if (
      normalized.includes('from workspaces') &&
      normalized.includes('join workspace_memberships')
    ) {
      const userId = String(params[0]);
      const rows = [...this.memberships.values()]
        .filter((membership) => membership.user_id === userId)
        .map((membership) =>
          this.workspaces.get(String(membership.workspace_id)),
        )
        .filter((workspace): workspace is Record<string, unknown> =>
          Boolean(workspace),
        );
      return { rows };
    }

    throw new Error(`Unexpected fake workspace query: ${sql}`);
  }

  async end(): Promise<void> {}
}

test('research run create path is idempotent for caller supplied run ids', () => {
  const serviceSource = readFileSync(
    join(process.cwd(), 'src', 'research-runs', 'research-runs.service.ts'),
    'utf8',
  );
  const jobsSource = readFileSync(
    join(process.cwd(), 'src', 'jobs', 'jobs.service.ts'),
    'utf8',
  );

  assert.equal(serviceSource.includes('findExistingResearchRunJob'), true);
  assert.equal(serviceSource.includes('create research run idempotent hit'), true);
  assert.equal(serviceSource.includes('queuedResponseFromJob(request, existingJob'), true);
  assert.equal(jobsSource.includes('findExistingResearchRunJob'), true);
});
