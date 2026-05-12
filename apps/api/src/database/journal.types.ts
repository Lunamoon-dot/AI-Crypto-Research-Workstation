export type JsonRecord = Record<string, unknown>;

export interface EngineRunRequest {
  run_id: string;
  workspace_id: string;
  symbol: string;
  asset_class: string;
  analysis_date: string;
  analysts: string[];
  config_profile: string;
}

export interface JournalRepository {
  getResearchRun(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]>;
  listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  getThesis(id: string, workspaceId: string): Promise<JsonRecord | null>;
  recordThesisDecision(
    thesisId: string,
    action: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord>;
  recordThesisReview(
    thesisId: string,
    result: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listSignals(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
  listWatchlists(limit: number, workspaceId: string): Promise<JsonRecord[]>;
  addWatchlistItem(
    watchlistId: string,
    item: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord>;
  listDailyBriefs(
    date: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]>;
}

export const JOURNAL_REPOSITORY = Symbol('JOURNAL_REPOSITORY');
