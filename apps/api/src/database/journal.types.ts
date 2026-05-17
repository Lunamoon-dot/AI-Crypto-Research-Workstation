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
  getThesisMonitorPlan?(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord | null>;
  listThesisPulses?(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]>;
  listThesisPulseMemos?(
    thesisId: string,
    workspaceId: string,
    limit: number,
  ): Promise<JsonRecord[]>;
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
