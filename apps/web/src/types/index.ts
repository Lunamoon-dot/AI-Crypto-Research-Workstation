export type JsonRecord = Record<string, unknown>;

export interface WorkspacePermissionDto {
  user_id: string;
  workspace_id: string;
  role: string;
}

export interface ResearchRunQueuedResponse {
  run_id: string;
  workspace_id: string;
  status: string;
  job_id: string;
  queue_backend: 'bullmq' | 'memory' | 'inline';
  permission: WorkspacePermissionDto;
  result?: JsonRecord;
}

export interface JobStatusResponse {
  id: string;
  run_id: string;
  workspace_id: string;
  backend: 'bullmq' | 'memory' | 'inline';
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  result?: JsonRecord;
}

export interface ResearchRunResponse {
  id: string | null;
  run_id: string | null;
  workspace_id: string;
  symbol: string;
  asset_class: string;
  market_type: string;
  timeframe: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  thesis_id: string | null;
  decision_id: string | null;
  signal_snapshot_id: string | null;
  market_snapshot_id: string | null;
  degradation_reasons: string[];
  missing_core_data: string[];
  missing_optional_data: string[];
}

export interface ResearchRunEventResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  thesis_id: string | null;
  event_type: string;
  created_at: string | null;
  message: string;
  payload: JsonRecord;
}

export interface MarketSnapshotResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  symbol: string;
  captured_at: string | null;
  current_price: number | null;
  source: string;
  source_timestamp: string | null;
  payload: JsonRecord;
}

export interface SignalSnapshotResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  symbol: string;
  captured_at: string | null;
  composite_signal_id: string | null;
  signal_count: number | null;
  bullish_count: number | null;
  bearish_count: number | null;
  neutral_count: number | null;
  stale_count: number | null;
  unknown_freshness_count: number | null;
  payload: JsonRecord;
}

export interface ResearchRunSnapshotsResponse {
  market_snapshot: MarketSnapshotResponse | null;
  signal_snapshot: SignalSnapshotResponse | null;
}

export interface ResearchRunArtifactResponse {
  kind: 'full_report' | 'full_state';
  label: string;
  path: string | null;
  exists: boolean;
  size_bytes: number | null;
  modified_at: string | null;
}

export interface ResearchRunArtifactsResponse {
  full_report: ResearchRunArtifactResponse;
  full_state: ResearchRunArtifactResponse;
}

export interface DebateResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  symbol: string;
  consensus_stance: string;
  conflict_level: string;
  created_at: string | null;
  payload: JsonRecord;
}

export interface AgentOpinionResponse {
  id: string | null;
  workspace_id: string;
  debate_id: string | null;
  research_run_id: string | null;
  agent_name: string;
  agent_role: string;
  stance: string;
  confidence: number | null;
  created_at: string | null;
  payload: JsonRecord;
}

export interface ResearchRunDebateResponse {
  debate: DebateResponse | null;
  agent_opinions: AgentOpinionResponse[];
}

export interface ThesisSummaryResponse {
  rating: string;
  direction: string;
  confidence: number | null;
  market_type: string;
  action_summary: string;
  entry_zone: string;
  upside_catalyst: string;
  invalidation: string;
  target_zones: string[];
  key_reasons: string[];
  risks: string[];
  spot_notes: string;
  perp_notes: string;
  missing_data: string[];
  is_degraded: boolean;
  degradation_reasons: string[];
}

export interface ThesisResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  symbol: string;
  direction: string;
  setup_type: string;
  confidence: number | null;
  confidence_source: string;
  confidence_rationale: string;
  quant_confidence: number | null;
  quant_bias: string;
  stability_guard?: JsonRecord;
  created_at: string | null;
  entry_zone: string;
  invalidation_level: string;
  target_zones: string[];
  thesis_text: string;
  summary: ThesisSummaryResponse;
  supporting_signal_ids: string[];
  contradicting_signal_ids: string[];
  stale_or_missing_data: string[];
  monitor_next: string[];
}

export interface ScenarioResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  probability_band: string;
  suggested_user_action: string;
  condition: string;
  expected_behavior: string;
  payload: JsonRecord;
}

export interface ThesisDecisionResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  action: string;
  user_notes: string;
  decided_at: string | null;
}

export interface ThesisReviewResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  result: string;
  lessons: string;
  reviewed_at: string | null;
  invalidated: boolean;
}

export interface SignalResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  signal_type: string;
  direction: string;
  confidence: number | null;
  observed_at: string | null;
  source: string;
  source_timestamp: string | null;
  summary: string;
}

export interface SignalCountResponse {
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
}

export interface WatchlistResponse {
  id: string | null;
  workspace_id: string;
  name: string;
  enabled: boolean;
  created_at: string | null;
}

export interface WatchlistItemResponse {
  id: string | null;
  workspace_id: string;
  watchlist_id: string;
  item_type: string;
  symbol: string | null;
  thesis_id: string | null;
  setup_type: string | null;
  enabled: boolean;
  created_at: string | null;
}

export interface WatchlistCheckResponse {
  workspace_id: string;
  watchlist_id: string;
  checked_items: number;
  alerts_created: AlertResponse[];
  skipped_items: string[];
}

export interface BriefAssetSummaryResponse {
  symbol: string;
  current_price: number | null;
  market_regime: string;
  trend_direction: string;
  volatility_regime: string;
  source: string | null;
  source_timestamp: string | null;
  summary: string;
  change_from_previous: string | null;
}

export interface BriefThesisUpdateResponse {
  thesis_id: string;
  symbol: string;
  direction: string;
  setup_type: string;
  confidence: number | null;
  status: string;
  update: string;
  invalidation_level: string | null;
  recent_alerts: string[];
}

export interface BriefResponse {
  id: string | null;
  workspace_id: string;
  brief_date: string | null;
  watchlist_name: string | null;
  title: string;
  created_at: string | null;
  previous_brief_id: string | null;
  summary: string;
  key_points: string[];
  thesis_ids: string[];
  signal_ids: string[];
  asset_summaries: BriefAssetSummaryResponse[];
  thesis_updates: BriefThesisUpdateResponse[];
  watchlist_changes: string[];
  top_setups: string[];
  top_risks: string[];
  memory_notes: string[];
}

export interface AlertResponse {
  id: string | null;
  workspace_id: string;
  alert_type: string;
  symbol: string;
  thesis_id: string | null;
  watchlist_item_id: string | null;
  trigger_key: string | null;
  created_at: string | null;
  read_at: string | null;
  message: string;
  payload: JsonRecord;
}

export interface JournalRunWorkspaceResponse {
  run: ResearchRunResponse;
  events: ResearchRunEventResponse[];
  snapshots: ResearchRunSnapshotsResponse;
  debate: ResearchRunDebateResponse;
  thesis: ThesisResponse | null;
  scenarios: ScenarioResponse[];
  artifacts: ResearchRunArtifactsResponse;
}

export type CreateResearchRunRequest = {
  run_id?: string;
  workspace_id: string;
  symbol: string;
  asset_class?: string;
  market_type?: 'spot' | 'perp';
  analysis_date: string;
  analysts: string[];
  config_profile?: string;
  exchange?: string | null;
  dry_run?: boolean;
  metadata?: JsonRecord;
};

export type RecordThesisDecisionRequest = {
  action: string;
  notes?: string;
};

export type RecordThesisReviewRequest = {
  result: string;
  notes?: string;
};

export type AddWatchlistItemRequest = {
  item_type?: string;
  symbol?: string;
  thesis_id?: string;
  setup_type?: string;
};

export type CheckWatchlistRequest = {
  prices?: Record<string, number>;
};

export type CreateDailyBriefRequest = {
  watchlist_id?: string;
  watchlist_name?: string;
  date?: string;
  alerts_limit?: number;
  evaluate_snapshots?: boolean;
  save?: boolean;
};

export type CreateWatchlistRequest = {
  name: string;
  enabled?: boolean;
};

export type UpdateWatchlistRequest = {
  name?: string;
  enabled?: boolean;
};

export interface RemoveWatchlistItemResponse {
  id: string;
  workspace_id: string;
  watchlist_id: string;
  removed: boolean;
}
