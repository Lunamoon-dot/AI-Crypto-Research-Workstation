export type JsonRecord = Record<string, unknown>;

export type MonitoringJobType =
  | 'monitor_plan_build'
  | 'thesis_pulse_run'
  | 'thesis_pulse_memo_run'
  | 'monitoring_retention_run';

export type MonitoringJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

export interface MonitoringJobInput {
  workspaceId: string;
  thesisId?: string | null;
  jobType: MonitoringJobType;
  runAfter?: string | null;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey: string;
  request: JsonRecord;
}

export interface MonitoringJobClaimInput {
  limit: number;
  workerId: string;
  now?: string;
}

export interface MonitoringJobFailure {
  errorType: string;
  errorMessage: string;
  retryable: boolean;
  runAfter?: string | null;
  result?: JsonRecord | null;
}

export interface MonitoringRetentionPolicy {
  dryRun: boolean;
  pulseKeepDays: number;
  pulseKeepLatestPerThesis: number;
  memoKeepDays: number;
  succeededJobKeepDays: number;
  failedJobKeepDays: number;
  now?: string;
}

export interface SignalSummary {
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
}

export interface ThesisDecisionIntent {
  entry?: string;
  stop_loss?: string;
  take_profit?: string;
  position_intent?: string;
}

export interface ThesisReviewMetrics {
  max_favorable_excursion?: number | null;
  max_adverse_excursion?: number | null;
  metadata?: JsonRecord;
}

export interface ThesisEvaluationInput {
  id?: string | null;
  workspace_id?: string | null;
  thesis_id: string;
  outcome_review_id?: string | null;
  symbol: string;
  window_days: number;
  evaluation_start: string;
  evaluation_end: string;
  evaluated_at?: string | null;
  result: string;
  max_favorable_excursion?: number | null;
  max_adverse_excursion?: number | null;
  invalidated?: boolean | null;
  warnings?: string[];
  evidence?: JsonRecord;
  payload?: JsonRecord;
}

export interface ThesisEvaluationNaturalKey {
  thesisId: string;
  windowDays: number;
  evaluationStart: string;
  evaluationEnd: string;
}

export interface ThesisEvaluationListFilters {
  thesisId?: string;
  limit: number;
}

export interface MaturedEvaluationThesisFilters {
  symbol?: string;
  limit: number;
}

export interface SymbolCalibrationThesisFilters {
  symbol: string;
  periodStart: string;
  periodEnd: string;
}

export interface ThesisEvaluationUpsertResult {
  created: boolean;
  evaluation: JsonRecord;
}

export interface EngineRunRequest {
  run_id: string;
  workspace_id: string;
  symbol: string;
  asset_class: string;
  market_type: 'spot' | 'perp';
  analysis_date: string;
  analysts: string[];
  config_profile: string;
  exchange?: string | null;
  dry_run: boolean;
  metadata: JsonRecord;
}

export interface ResearchRunFailure {
  reason: string;
  message: string;
  completedAt?: string;
}

export interface JournalRepository {
  listResearchRuns(
    filters: {
      symbol?: string;
      status?: string;
      limit: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getResearchRun(id: string, workspaceId: string): Promise<JsonRecord | null>;
  markResearchRunFailed(
    id: string,
    workspaceId: string,
    failure: ResearchRunFailure,
  ): Promise<JsonRecord | null>;
  listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]>;
  getMarketSnapshot(id: string, workspaceId: string): Promise<JsonRecord | null>;
  getLatestMarketSnapshot(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveMarketSnapshot(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  getSignalSnapshot(id: string, workspaceId: string): Promise<JsonRecord | null>;
  getDebate(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listAgentOpinions(
    debateId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  getThesis(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listThesesForMaturedEvaluation?(
    filters: MaturedEvaluationThesisFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  listThesesForSymbolCalibration?(
    filters: SymbolCalibrationThesisFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getThesisEvaluationByNaturalKey?(
    key: ThesisEvaluationNaturalKey,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  upsertThesisEvaluation?(
    input: ThesisEvaluationInput,
    workspaceId: string,
  ): Promise<ThesisEvaluationUpsertResult>;
  listThesisEvaluations?(
    filters: ThesisEvaluationListFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getThesisEvaluation?(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  linkThesisEvaluationOutcomeReview?(
    id: string,
    outcomeReviewId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  getThesisMonitorPlan?(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveThesisMonitorPlan?(
    plan: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listThesisPulses?(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]>;
  saveThesisPulse?(pulse: JsonRecord, workspaceId: string): Promise<JsonRecord>;
  listThesisPulseMemos?(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]>;
  saveThesisPulseMemo?(
    memo: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  enqueueMonitoringJob?(input: MonitoringJobInput): Promise<JsonRecord>;
  claimMonitoringJobs?(
    workspaceId: string,
    input: MonitoringJobClaimInput,
  ): Promise<JsonRecord[]>;
  completeMonitoringJob?(
    id: string,
    workspaceId: string,
    result: JsonRecord,
  ): Promise<JsonRecord | null>;
  failMonitoringJob?(
    id: string,
    workspaceId: string,
    failure: MonitoringJobFailure,
  ): Promise<JsonRecord | null>;
  runMonitoringRetention?(
    workspaceId: string,
    policy: MonitoringRetentionPolicy,
  ): Promise<JsonRecord>;
  getMonitoringOperationsHealth?(workspaceId: string): Promise<JsonRecord>;
  listScenarios(thesisId: string, workspaceId: string): Promise<JsonRecord[]>;
  recordThesisDecision(
    thesisId: string,
    action: string,
    notes: string,
    workspaceId: string,
    intent?: ThesisDecisionIntent,
  ): Promise<JsonRecord>;
  recordThesisReview(
    thesisId: string,
    result: string,
    notes: string,
    workspaceId: string,
    metrics?: ThesisReviewMetrics,
  ): Promise<JsonRecord>;
  listOutcomeReviews(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getOutcomeReview?(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  getSignal(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listSignals(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  summarizeSignals(
    symbol: string | undefined,
    workspaceId: string,
  ): Promise<SignalSummary>;
  listWatchlists(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  listEnabledWatchlists(limit: number): Promise<JsonRecord[]>;
  createWatchlist(
    input: { name: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord>;
  getWatchlist(id: string, workspaceId: string): Promise<JsonRecord | null>;
  getWatchlistByName(
    name: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  listWatchlistItems(
    watchlistId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  addWatchlistItem(
    watchlistId: string,
    item: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  updateWatchlist(
    id: string,
    input: { name?: string; enabled?: boolean },
    workspaceId: string,
  ): Promise<JsonRecord>;
  removeWatchlist(id: string, workspaceId: string): Promise<JsonRecord>;
  removeWatchlistItem(
    watchlistId: string,
    itemId: string,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listDailyBriefs(
    date: string | undefined,
    limit: number,
    workspaceId: string,
    watchlistName?: string,
    throughDate?: string,
  ): Promise<JsonRecord[]>;
  getLatestMarketBrief(
    watchlistName: string | undefined,
    beforeDate: string | undefined,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveMarketBrief(brief: JsonRecord, workspaceId: string): Promise<JsonRecord>;
  listAlerts(
    symbol: string | undefined,
    thesisId: string | undefined,
    unreadOnly: boolean,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  findAlert(
    alertType: string,
    thesisId: string | undefined,
    watchlistItemId: string | undefined,
    triggerKey: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  createAlert(alert: JsonRecord, workspaceId: string): Promise<JsonRecord>;
  markAlertRead(id: string, workspaceId: string): Promise<JsonRecord>;
  listProviderHealth(limit: number): Promise<JsonRecord[]>;
  listLlmCalls(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  listDataFreshnessChecks(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
}

export const JOURNAL_REPOSITORY = Symbol('JOURNAL_REPOSITORY');
