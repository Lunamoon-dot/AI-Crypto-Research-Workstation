export type JsonRecord = Record<string, unknown>;

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

export interface ThesisEvaluationRunInput {
  id?: string | null;
  workspace_id?: string | null;
  canonical_evaluation_id: string;
  thesis_id: string;
  symbol: string;
  window_days: number;
  evaluation_start: string;
  evaluation_end: string;
  requested_by_user_id?: string | null;
  requested_at?: string | null;
  evaluated_at?: string | null;
  source: string;
  reason: string;
  notes?: string | null;
  idempotency_key?: string | null;
  status: string;
  result?: string | null;
  max_favorable_excursion?: number | null;
  max_adverse_excursion?: number | null;
  invalidated?: boolean | null;
  warnings?: string[];
  evidence?: JsonRecord;
  diff?: JsonRecord;
  error_type?: string | null;
  error_message?: string | null;
  payload?: JsonRecord;
}

export interface ThesisEvaluationRunListFilters {
  canonicalEvaluationId: string;
  limit: number;
}

export interface ThesisEvaluationRunIdempotencyKey {
  canonicalEvaluationId: string;
  idempotencyKey: string;
}

export interface ThesisEvaluationPromotionInput {
  id?: string | null;
  workspace_id?: string | null;
  canonical_evaluation_id: string;
  promoted_rerun_id?: string | null;
  action: string;
  promoted_by_user_id?: string | null;
  promoted_at?: string | null;
  reason: string;
  notes?: string | null;
  idempotency_key?: string | null;
  payload?: JsonRecord;
}

export interface ThesisEvaluationPromotionListFilters {
  canonicalEvaluationId: string;
  limit: number;
}

export interface ThesisEvaluationPromotionIdempotencyKey {
  canonicalEvaluationId: string;
  idempotencyKey: string;
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

export interface AgentCalibrationSourceFilters {
  symbol?: string;
  periodStart: string;
  periodEnd: string;
  windowDays: number;
}

export interface ScenarioReliabilityEvaluationFilters {
  symbol?: string;
  market_type?: string;
  horizon?: string;
  limit: number;
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
  output_language?: string | null;
  dry_run: boolean;
  metadata: JsonRecord;
}

export interface ResearchRunFailure {
  reason: string;
  message: string;
  completedAt?: string;
}

export interface ResearchRunCascadeDeletion {
  removed: boolean;
  workspace_id: string;
  requested_run_id: string;
  deleted_count: number;
  deleted_run_ids: string[];
}

export interface ContinuityRepairRunFilters {
  symbol?: string;
  from?: string;
  to?: string;
  limit: number;
}

export interface ContinuityRepairIdentity {
  runId: string;
  caseType: string;
  repairVersion: string;
  sourceEntryId?: string | null;
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
  removeResearchRunCascade(
    id: string,
    workspaceId: string,
  ): Promise<ResearchRunCascadeDeletion>;
  removeWorkspaceSignals(workspaceId: string): Promise<string[]>;
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
  getResearchSnapshotByRun(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveResearchSnapshot(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  getResearchContinuityEntry(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  listResearchRunsForContinuityRepair(
    filters: ContinuityRepairRunFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getLatestResearchContinuityEntryForRun(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  getLatestResearchContinuityEntryBeforeRun(
    symbol: string,
    before: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  getLatestCompletedResearchRunForContinuity(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  findResearchContinuityRepairEntry(
    identity: ContinuityRepairIdentity,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  listResearchContinuityEntriesBySymbol(
    symbol: string,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  saveResearchContinuityEntry(
    entry: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  getResearchContinuityState(
    symbol: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveResearchContinuityState(
    state: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
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
  listAgentCalibrationSourceRows?(
    filters: AgentCalibrationSourceFilters,
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
  listThesisEvaluationRuns?(
    filters: ThesisEvaluationRunListFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getThesisEvaluationRunByIdempotencyKey?(
    key: ThesisEvaluationRunIdempotencyKey,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  getThesisEvaluationRun?(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  createThesisEvaluationRun?(
    input: ThesisEvaluationRunInput,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listThesisEvaluationPromotions?(
    filters: ThesisEvaluationPromotionListFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getLatestThesisEvaluationPromotion?(
    canonicalEvaluationId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  getThesisEvaluationPromotionByIdempotencyKey?(
    key: ThesisEvaluationPromotionIdempotencyKey,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  createThesisEvaluationPromotion?(
    input: ThesisEvaluationPromotionInput,
    workspaceId: string,
  ): Promise<JsonRecord>;
  getScenario(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listScenarios(thesisId: string, workspaceId: string): Promise<JsonRecord[]>;
  saveScenarioEvaluation(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listScenarioEvaluations(
    scenarioId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getScenarioEvaluation(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  listScenarioEvaluationsForReliability(
    filters: ScenarioReliabilityEvaluationFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  saveTradePlaybook(input: JsonRecord, workspaceId: string): Promise<JsonRecord>;
  getTradePlaybook(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listTradePlaybooksForScenario(
    scenarioId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  listTradePlaybooks(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  saveScenarioEvent(input: JsonRecord, workspaceId: string): Promise<JsonRecord>;
  listScenarioEvents(
    scenarioId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]>;
  saveBacktestRun(input: JsonRecord, workspaceId: string): Promise<JsonRecord>;
  getBacktestRun(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listBacktestRunsForPlaybook(
    playbookId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  listBacktestRuns(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  saveBacktestTradeEvents(
    runId: string,
    events: JsonRecord[],
    workspaceId: string,
  ): Promise<void>;
  listBacktestTradeEvents(
    runId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  saveScenarioDecisionItemState(
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listScenarioDecisionItemStates(workspaceId: string): Promise<JsonRecord[]>;
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
  listSignalObservations?(
    filters: {
      symbol?: string;
      factor?: string;
      signalSnapshotId?: string;
      from?: string;
      to?: string;
      limit: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getSignalObservation?(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  listSignalOutcomeLabels?(
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
  ): Promise<JsonRecord[]>;
  saveSignalEvaluationReport?(
    report: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listSignalEvaluationReports?(
    filters: {
      symbol?: string;
      factor?: string;
      horizonMinutes?: number;
      limit: number;
    },
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getSignalEvaluationReport?(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveSignalModelArtifact?(
    kind: 'weight' | 'calibrator',
    artifact: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listSignalModelArtifacts?(
    kind: 'weight' | 'calibrator',
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  getSignalModelArtifact?(
    kind: 'weight' | 'calibrator',
    version: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveSignalModelPromotion?(
    promotion: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listSignalModelPromotions?(workspaceId: string): Promise<JsonRecord[]>;
  saveSignalMonitoringSnapshot?(
    snapshot: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listSignalMonitoringSnapshots?(workspaceId: string): Promise<JsonRecord[]>;
  getSignalMonitoringSnapshot?(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveSignalModelAlert?(
    alert: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listSignalModelAlerts?(
    filters: { status?: string; limit: number },
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  updateSignalModelAlert?(
    id: string,
    input: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  saveSignalModelRollback?(
    rollback: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listSignalModelRollbacks?(workspaceId: string): Promise<JsonRecord[]>;
  listAlerts(
    symbol: string | undefined,
    thesisId: string | undefined,
    unreadOnly: boolean,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  markAlertRead(id: string, workspaceId: string): Promise<JsonRecord>;
  listProviderHealth(limit: number): Promise<JsonRecord[]>;
  listLlmCalls(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  listDataFreshnessChecks(
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
}

export const JOURNAL_REPOSITORY = Symbol('JOURNAL_REPOSITORY');
