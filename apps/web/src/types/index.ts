export type JsonRecord = Record<string, unknown>;

export interface WorkspacePermissionDto {
  user_id: string;
  workspace_id: string;
  role: string;
}

export type WorkspaceScopeType = 'fixed_symbol' | 'legacy_mixed';

export type WorkspaceMarketType = 'mixed' | 'spot' | 'perp';

export interface WorkspaceSummary {
  id: string;
  name: string;
  scope_type: WorkspaceScopeType;
  symbol: string | null;
  market_type: WorkspaceMarketType;
  default_timeframe: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  symbol: string;
  market_type?: WorkspaceMarketType;
  default_timeframe?: string | null;
}

export type WorkspaceNewsSourceType = 'rss' | 'atom' | 'html';

export type WorkspaceNewsSourceTargetAnalyst = 'news' | 'social';

export type WorkspaceNewsSourceTrustTier =
  | 'high'
  | 'user_trusted'
  | 'medium'
  | 'low'
  | 'aggregator';

export interface WorkspaceNewsSource {
  id: string;
  name: string;
  type: WorkspaceNewsSourceType;
  url: string;
  category: string;
  trust_tier: WorkspaceNewsSourceTrustTier;
  target_analysts: WorkspaceNewsSourceTargetAnalyst[];
  scope: string[];
  official: boolean;
  enabled: boolean;
  parser_mode?: 'html_list';
  selectors?: Record<string, string>;
}

export interface WorkspaceNewsSourcesResponse {
  workspace_id: string;
  sources: WorkspaceNewsSource[];
}

export interface UpdateWorkspaceNewsSourcesRequest {
  sources: WorkspaceNewsSource[];
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

export interface ResearchRunStageTimingResponse {
  stage_key: string;
  label: string;
  event_state: 'pending' | 'running' | 'completed' | 'failed' | 'missing';
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  source_event_ids: string[];
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

export type MarketChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type MarketChartType = 'candles' | 'line' | 'area';

export interface MarketOhlcvCandleResponse {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface MarketOhlcvResponse {
  symbol: string;
  market_type: 'spot' | 'perp';
  interval: MarketChartInterval;
  from: string;
  to: string;
  source: string;
  provider: string;
  generated_at: string;
  candles: MarketOhlcvCandleResponse[];
  warning: string | null;
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
  data_quality: number | null;
  data_quality_label: string;
  reason_codes: string[];
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
  confirmation_condition: string;
  entry_zone: string;
  upside_catalyst: string;
  invalidation: string;
  target_zones: string[];
  key_reasons: string[];
  risks: string[];
  spot_notes: string;
  perp_notes: string;
  missing_data: string[];
  missing_data_reason_codes: string[];
  data_quality: number | null;
  data_quality_label: string;
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
  confirmation_condition: string;
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
  entry: string;
  stop_loss: string;
  take_profit: string;
  position_intent: string;
  decided_at: string | null;
}

export interface ThesisReviewResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  result: string;
  lessons: string;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  reviewed_at: string | null;
  invalidated: boolean;
}

export interface PerformanceOutcomeReviewResponse extends ThesisReviewResponse {
  symbol: string;
  direction: string;
  setup_type: string;
  confidence: number | null;
  thesis_created_at: string | null;
}

export type CalibrationResult =
  | 'hit_target'
  | 'invalidated'
  | 'mixed'
  | 'expired'
  | 'unknown';

export type CalibrationRecordReviewBlocker =
  | 'incomplete_window'
  | 'unknown_result'
  | 'review_already_recorded';

export type MaturedEvaluationPreviewStatus =
  | 'candidate'
  | 'existing'
  | 'not_mature'
  | 'invalid_thesis';

export type MaturedEvaluationApplyStatus =
  | 'created'
  | 'existing'
  | 'failed'
  | 'skipped';

export type MaturedEvaluationReason =
  | 'evaluation_already_exists'
  | 'window_not_closed'
  | 'missing_created_at'
  | 'invalid_created_at'
  | 'missing_symbol'
  | 'engine_error'
  | 'provider_error'
  | 'unknown_error'
  | 'max_batch_excluded';

export interface CalibrationEvaluationResponse {
  id: string | null;
  base_evaluation_id: string | null;
  workspace_id: string;
  thesis_id: string;
  outcome_review_id: string | null;
  symbol: string;
  window_days: number;
  evaluation_start: string | null;
  evaluation_end: string | null;
  evaluated_at: string | null;
  result: CalibrationResult;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  invalidated: boolean;
  warnings: string[];
  evidence: JsonRecord;
  calendar_mature: boolean;
  can_record_review: boolean;
  record_review_blockers: CalibrationRecordReviewBlocker[];
  active_source: CalibrationEvaluationActiveSource;
  active_rerun_id: string | null;
  active_promotion_id: string | null;
  payload: JsonRecord;
}

export interface EvaluateThesisResponse {
  created: boolean;
  evaluation: CalibrationEvaluationResponse;
  warnings: string[];
}

export type CalibrationEvaluationRerunReason =
  | 'manual_check'
  | 'engine_rule_change'
  | 'market_data_fix'
  | 'bug_fix_verification'
  | 'suspected_drift'
  | 'other';

export type CalibrationEvaluationRerunStatus = 'completed' | 'failed';

export type CalibrationEvaluationActiveSource =
  | 'base_canonical'
  | 'promoted_rerun';

export type CalibrationEvaluationPromotionAction =
  | 'promote_rerun'
  | 'reset_to_base';

export interface CalibrationEvaluationRerunDiffResponse extends JsonRecord {
  result_changed?: boolean;
  canonical_result?: CalibrationResult | null;
  rerun_result?: CalibrationResult | null;
  mfe_delta?: number | null;
  mae_delta?: number | null;
  invalidated_changed?: boolean;
  warnings_added?: string[];
  warnings_removed?: string[];
  start_price_delta?: number | null;
  end_price_delta?: number | null;
}

export interface CalibrationEvaluationRerunResponse {
  id: string | null;
  workspace_id: string;
  canonical_evaluation_id: string;
  thesis_id: string;
  symbol: string;
  window_days: number;
  evaluation_start: string | null;
  evaluation_end: string | null;
  requested_by_user_id: string | null;
  requested_at: string | null;
  evaluated_at: string | null;
  source: string;
  reason: CalibrationEvaluationRerunReason;
  notes: string | null;
  idempotency_key: string | null;
  status: CalibrationEvaluationRerunStatus;
  result: CalibrationResult | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  invalidated: boolean | null;
  warnings: string[];
  evidence: JsonRecord;
  diff: CalibrationEvaluationRerunDiffResponse;
  error_type: string | null;
  error_message: string | null;
  payload: JsonRecord;
}

export interface CreateCalibrationEvaluationRerunResponse {
  created: boolean;
  rerun: CalibrationEvaluationRerunResponse;
  warnings: string[];
}

export interface CalibrationEvaluationPromotionResponse {
  id: string | null;
  workspace_id: string;
  canonical_evaluation_id: string;
  promoted_rerun_id: string | null;
  action: CalibrationEvaluationPromotionAction;
  promoted_by_user_id: string | null;
  promoted_at: string | null;
  reason: CalibrationEvaluationRerunReason;
  notes: string | null;
  idempotency_key: string | null;
  payload: JsonRecord;
}

export interface CalibrationEvaluationVersionPolicyResponse {
  canonical_evaluation_id: string;
  active_source: CalibrationEvaluationActiveSource;
  active_rerun_id: string | null;
  active_promotion_id: string | null;
  base_evaluation: CalibrationEvaluationResponse;
  active_evaluation: CalibrationEvaluationResponse;
  events: CalibrationEvaluationPromotionResponse[];
  warnings: string[];
}

export interface PromoteCalibrationEvaluationResponse {
  created: boolean;
  event: CalibrationEvaluationPromotionResponse | null;
  policy: CalibrationEvaluationVersionPolicyResponse;
  warnings: string[];
}

export interface RecordCalibrationOutcomeReviewResponse {
  created: boolean;
  outcome_review: ThesisReviewResponse | null;
  evaluation: CalibrationEvaluationResponse;
  warnings: string[];
}

export interface MaturedEvaluationPreviewSummaryResponse {
  candidate: number;
  existing: number;
  not_mature: number;
  invalid_thesis: number;
}

export interface MaturedEvaluationApplySummaryResponse {
  created: number;
  existing: number;
  skipped: number;
  failed: number;
}

export interface MaturedEvaluationPreviewRowResponse {
  thesis_id: string;
  symbol: string;
  created_at: string | null;
  window_days: number;
  evaluation_start: string | null;
  evaluation_end: string | null;
  status: MaturedEvaluationPreviewStatus;
  reason: MaturedEvaluationReason | null;
  evaluation_id: string | null;
}

export interface MaturedEvaluationApplyRowResponse {
  thesis_id: string;
  symbol: string;
  created_at: string | null;
  window_days: number;
  evaluation_start: string | null;
  evaluation_end: string | null;
  status: MaturedEvaluationApplyStatus;
  reason: MaturedEvaluationReason | null;
  evaluation_id: string | null;
  result: CalibrationResult | null;
  warnings: string[];
  message: string | null;
}

export interface PreviewMaturedEvaluationsResponse {
  window_days: number;
  scan_limit: number;
  symbol: string | null;
  summary: MaturedEvaluationPreviewSummaryResponse;
  rows: MaturedEvaluationPreviewRowResponse[];
}

export interface ApplyMaturedEvaluationsResponse {
  window_days: number;
  max_batch: number;
  symbol: string | null;
  summary: MaturedEvaluationApplySummaryResponse;
  rows: MaturedEvaluationApplyRowResponse[];
}

export type SymbolCalibrationStance =
  | 'bullish'
  | 'bearish'
  | 'defensive'
  | 'neutral'
  | 'mixed'
  | 'unknown';

export type SymbolCalibrationVerdict =
  | 'correct'
  | 'incorrect'
  | 'inconclusive';

export type SymbolCalibrationCoverageStatus =
  | 'complete'
  | 'partial'
  | 'sparse'
  | 'empty';

export type SymbolCalibrationConsistencyStatus =
  | 'coherent'
  | 'mixed'
  | 'unclear';

export type SymbolCalibrationOutcomeStatus =
  | 'favorable'
  | 'unfavorable'
  | 'mixed'
  | 'inconclusive';

export type SymbolCalibrationRowStatus =
  | 'evaluated'
  | 'missing_evaluation'
  | 'invalid_thesis';

export interface SymbolCalibrationCoverageResponse {
  matured_thesis_count: number;
  evaluated_count: number;
  missing_evaluation_count: number;
  coverage_pct: number | null;
}

export interface SymbolCalibrationStanceResponse {
  stance_counts: {
    bullish: number;
    bearish: number;
    defensive: number;
    neutral: number;
    unknown: number;
  };
  consensus_stance: SymbolCalibrationStance;
  conflict_rate: number | null;
}

export interface SymbolCalibrationOutcomeResponse {
  result_counts: {
    hit_target: number;
    invalidated: number;
    mixed: number;
    expired: number;
    unknown: number;
  };
  hit_rate: number | null;
  invalidation_rate: number | null;
  mixed_rate: number | null;
  expired_rate: number | null;
  unknown_rate: number | null;
  avg_mfe: number | null;
  avg_mae: number | null;
  best_mfe: number | null;
  worst_mae: number | null;
  representative_return: number | null;
  /** @deprecated Use top-level outcome_status for user-facing thesis cluster semantics. */
  verdict: SymbolCalibrationVerdict;
}

export interface SymbolCalibrationRowResponse {
  thesis_id: string;
  created_at: string | null;
  symbol: string;
  stance: Exclude<SymbolCalibrationStance, 'mixed'>;
  direction: string;
  confidence: number | null;
  status: SymbolCalibrationRowStatus;
  evaluation_id: string | null;
  base_evaluation_id: string | null;
  active_source: CalibrationEvaluationActiveSource | null;
  active_rerun_id: string | null;
  active_promotion_id: string | null;
  result: CalibrationResult | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
}

export interface SymbolCalibrationReportResponse {
  symbol: string;
  window_days: number;
  lookback_days: number;
  period_start: string;
  period_end: string;
  coverage_status: SymbolCalibrationCoverageStatus;
  consistency_status: SymbolCalibrationConsistencyStatus;
  outcome_status: SymbolCalibrationOutcomeStatus;
  coverage: SymbolCalibrationCoverageResponse;
  stance: SymbolCalibrationStanceResponse;
  outcome: SymbolCalibrationOutcomeResponse;
  rows: SymbolCalibrationRowResponse[];
}

export type AgentCalibrationStance =
  | 'bullish'
  | 'bearish'
  | 'defensive'
  | 'neutral'
  | 'unknown';

export type AgentCalibrationRelation =
  | 'supports_final'
  | 'opposes_final'
  | 'unclear';

export type AgentCalibrationOutcomeBucket =
  | 'supported_success'
  | 'supported_failure'
  | 'contrarian_success'
  | 'contrarian_failure'
  | 'inconclusive';

export type AgentCalibrationVerdict =
  | 'strong_aligned'
  | 'promising'
  | 'contrarian_signal'
  | 'mixed'
  | 'insufficient_data';

export interface AgentCalibrationCoverageResponse {
  opinion_count: number;
  eligible_opinion_count: number;
  scored_opinion_count: number;
  missing_evaluation_count: number;
  unlinked_opinion_count: number;
  unknown_stance_count: number;
  unclear_relation_count: number;
  coverage_pct: number | null;
}

export interface AgentCalibrationAgentResponse {
  agent_role: string;
  display_name: string;
  agent_names: string[];
  opinion_count: number;
  eligible_opinion_count: number;
  classified_opinion_count: number;
  coverage_pct: number | null;
  supports_final_count: number;
  opposes_final_count: number;
  unclear_relation_count: number;
  supported_success_count: number;
  supported_failure_count: number;
  contrarian_success_count: number;
  contrarian_failure_count: number;
  inconclusive_count: number;
  alignment_success_rate: number | null;
  contrarian_success_rate: number | null;
  avg_confidence: number | null;
  verdict: AgentCalibrationVerdict;
}

export interface AgentCalibrationRowResponse {
  agent_role: string;
  agent_name: string;
  research_run_id: string | null;
  debate_id: string | null;
  thesis_id: string | null;
  symbol: string | null;
  thesis_direction: AgentCalibrationStance;
  agent_stance: AgentCalibrationStance;
  relation_to_final: AgentCalibrationRelation;
  evaluation_id: string | null;
  base_evaluation_id: string | null;
  active_source: CalibrationEvaluationActiveSource | null;
  active_rerun_id: string | null;
  active_promotion_id: string | null;
  evaluation_result: CalibrationResult | null;
  outcome_bucket: AgentCalibrationOutcomeBucket;
  confidence: number | null;
  created_at: string | null;
}

export interface AgentCalibrationReportResponse {
  window_days: number;
  lookback_days: number;
  symbol: string | null;
  period_start: string;
  period_end: string;
  coverage: AgentCalibrationCoverageResponse;
  agents: AgentCalibrationAgentResponse[];
  rows: AgentCalibrationRowResponse[];
}

export interface RetrospectiveInsightResponse {
  insight_type: string;
  message: string;
  thesis_ids: string[];
  evidence_count: number;
}

export interface PerformanceAnalyticsResponse {
  sample_size: number;
  symbol: string | null;
  result_counts: Record<string, number>;
  hit_rate: number | null;
  invalidation_rate: number | null;
  mixed_rate: number | null;
  average_mfe: number | null;
  average_mae: number | null;
  reviewed_thesis_ids: string[];
  recent_lessons: string[];
  insights: RetrospectiveInsightResponse[];
}

export interface PerformanceTrendPointResponse {
  week_start: string;
  sample_size: number;
  hit_rate: number | null;
  average_mfe: number | null;
  average_mae: number | null;
  calibration_quality: string;
}

export interface PerformanceHealthResponse {
  overall_status: string;
  recent_sample_size: number;
  baseline_sample_size: number;
  recent_hit_rate: number | null;
  baseline_hit_rate: number | null;
  alerts: string[];
  recommendation: string;
}

export interface ScenarioMonitorItemResponse {
  status: string;
  status_reason: string;
  trigger_summary: string;
  risk_count: number;
  scenario: ScenarioResponse;
  thesis: ThesisResponse;
  latest_market_snapshot: MarketSnapshotResponse | null;
  latest_alert: AlertResponse | null;
}

export interface ScenarioMonitorResponse {
  workspace_id: string;
  generated_at: string;
  total_scenarios: number;
  status_counts: Record<string, number>;
  items: ScenarioMonitorItemResponse[];
}

export interface WatchlistPollResponse {
  checked_watchlists: number;
  alerts_created: number;
  skipped_items: string[];
}

export interface AlertSchedulerStatusResponse {
  enabled: boolean;
  configured_by_env: boolean;
  interval_ms: number;
  poll_on_start: boolean;
  limit: number;
  running: boolean;
  last_run_at: string | null;
  last_error: string | null;
  last_result: WatchlistPollResponse | null;
  workspace_enabled_watchlists: number;
}

export interface ProviderHealthResponse {
  id: string | null;
  provider: string;
  component: string | null;
  status: string;
  checked_at: string | null;
  latency_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  payload: JsonRecord;
}

export interface LlmCallResponse {
  id: string | null;
  workspace_id: string | null;
  research_run_id: string | null;
  thesis_id: string | null;
  provider: string;
  model: string;
  stage: string | null;
  agent: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  status: string;
  error_type: string | null;
  error_message: string | null;
  created_at: string | null;
  payload: JsonRecord;
}

export interface DataFreshnessResponse {
  id: string | null;
  workspace_id: string | null;
  research_run_id: string | null;
  symbol: string | null;
  source: string;
  source_timestamp: string | null;
  observed_timestamp: string | null;
  age_seconds: number | null;
  threshold_seconds: number | null;
  status: string;
  payload: JsonRecord;
}

export interface LlmHealthSummaryResponse {
  total_calls: number;
  success_rate: number | null;
  total_tokens: number;
  average_latency_ms: number | null;
  recent_errors: number;
  by_provider: Record<string, { calls: number; errors: number; tokens: number }>;
}

export interface OperationsContinuityHealthResponse {
  workspace_id: string;
  lookback_days: number;
  audit_available: boolean;
  missing_entries_recent: number;
  degraded_entries_recent: number;
  stale_symbols: number;
  last_repair_run_at: string | null;
  last_repair_status: string | null;
  repair_failures_24h: number;
  debug_access_24h: number;
  debug_denied_24h: number;
  scheduled_repair_mode: 'disabled' | 'dry_run' | 'enabled';
  scheduled_repair_due: boolean;
  next_scheduled_repair_due_at: string | null;
  last_scheduled_repair_run_id: string | null;
  scheduled_repair_worker_enabled: boolean;
  scheduled_repair_lease_owner: string | null;
  scheduled_repair_lease_expires_at: string | null;
  scheduled_repair_last_attempt_at: string | null;
  scheduled_repair_last_success_at: string | null;
  scheduled_repair_last_error: string | null;
  scheduled_repair_consecutive_failures: number;
  scheduled_repair_next_retry_at: string | null;
}

export interface OperationsHealthResponse {
  generated_at: string;
  providers: ProviderHealthResponse[];
  llm: LlmHealthSummaryResponse;
  freshness: {
    total_checks: number;
    stale_checks: number;
    status_counts: Record<string, number>;
    rows: DataFreshnessResponse[];
  };
  queue: {
    backend: string;
    redis_configured: boolean;
  };
  continuity: OperationsContinuityHealthResponse;
}

export interface SignalResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  signal_snapshot_id: string | null;
  symbol: string;
  signal_type: string;
  direction: string;
  confidence: number | null;
  observed_at: string | null;
  source: string;
  source_timestamp: string | null;
  summary: string;
}

export interface SignalDetailResponse extends SignalResponse {
  expires_at: string | null;
  evidence_lane: string;
  evidence_category: string;
  strength: number | null;
  heuristic_confidence: number | null;
  empirical_confidence: number | null;
  empirical_confidence_sample_size: number | null;
  empirical_confidence_oos_sample_size: number | null;
  confidence_version: string;
  freshness_status: string;
  is_stale: boolean;
  age_seconds: number | null;
  staleness_reason: string;
  provenance: JsonRecord;
  evidence: JsonRecord;
  watch_conditions: JsonRecord;
  payload: JsonRecord;
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

export interface RemoveWatchlistResponse {
  id: string;
  workspace_id: string;
  name: string;
  removed: boolean;
  removed_item_count: number;
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

export type AttentionPriority = 'critical' | 'review' | 'info';

export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AttentionSourceType =
  | 'alert'
  | 'thesis'
  | 'scenario'
  | 'run'
  | 'provider'
  | 'brief'
  | 'watchlist';

export interface AttentionBadgeResponse {
  label: string;
  value: string;
  tone: string;
}

export interface AttentionActionResponse {
  label: string;
  href: string;
  entity_type: string;
  entity_id: string | null;
}

export interface AttentionItemResponse {
  id: string;
  workspace_id: string;
  priority: AttentionPriority;
  severity: AttentionSeverity;
  score: number;
  source_type: AttentionSourceType;
  source: string;
  source_id: string | null;
  symbol: string | null;
  title: string;
  summary: string;
  status: string;
  created_at: string | null;
  age_minutes: number | null;
  badges: AttentionBadgeResponse[];
  action: AttentionActionResponse;
  payload: JsonRecord;
}

export interface AttentionQueueResponse {
  priority: AttentionPriority;
  label: string;
  items: AttentionItemResponse[];
}

export interface NotificationResponse {
  id: string;
  type: AttentionSourceType;
  status: string;
  priority: AttentionPriority;
  source: string;
  source_id: string | null;
  symbol: string | null;
  title: string;
  message: string;
  created_at: string | null;
  read_at: string | null;
  action: AttentionActionResponse;
  badges: AttentionBadgeResponse[];
}

export interface WorkbenchAttentionResponse {
  workspace_id: string;
  generated_at: string;
  item_count: number;
  unresolved_count: number;
  latest_brief: BriefResponse | null;
  brief_actions: AttentionItemResponse[];
  queues: AttentionQueueResponse[];
  items: AttentionItemResponse[];
  notifications: NotificationResponse[];
}

export interface JournalRunWorkspaceResponse {
  run: ResearchRunResponse;
  events: ResearchRunEventResponse[];
  stage_timings: ResearchRunStageTimingResponse[];
  snapshots: ResearchRunSnapshotsResponse;
  debate: ResearchRunDebateResponse;
  thesis: ThesisResponse | null;
  scenarios: ScenarioResponse[];
  artifacts: ResearchRunArtifactsResponse;
}

export interface ContinuitySectionResponse {
  title: string;
  items: string[];
  empty_state: string;
}

export interface ResearchContinuityThinReport {
  version: 'research_continuity_thin.v1';
  generated_at: string | null;
  debug_available: boolean;
  debug_requires_role: 'editor';
  quality: {
    status: string;
    score: number | null;
    observed_evidence_coverage: number | null;
    evidence_coverage: number | null;
    provenance_status: string | null;
    warnings: string[];
  };
  sections: Array<{
    id: string;
    title: string;
    items: string[];
  }>;
}

export interface ResearchContinuityDebugAccessResponse {
  available: boolean;
  reason:
    | 'available'
    | 'disabled_by_policy'
    | 'permission_required'
    | 'not_available';
  requires_permission: 'view_debug_trace';
  url: string | null;
  redacted: true;
}

export type ResearchContinuityDiffGroup =
  | 'added'
  | 'updated'
  | 'removed_resolved'
  | 'weakened'
  | 'context'
  | 'quality';

export type ResearchContinuityDiffQuality =
  | 'complete'
  | 'partial'
  | 'unavailable';

export type ResearchContinuityDiffSeverity =
  | 'info'
  | 'warning'
  | 'critical';

export type ResearchContinuityDiffItemType =
  | 'claim'
  | 'risk'
  | 'watchpoint'
  | 'level'
  | 'invalidation'
  | 'view'
  | 'quality'
  | 'unknown';

export interface ResearchContinuityDiffSummaryResponse {
  added_count: number;
  updated_count: number;
  removed_resolved_count: number;
  weakened_count: number;
  quality_count: number;
  has_material_changes: boolean;
  has_comparison: boolean;
  diff_quality: ResearchContinuityDiffQuality;
  is_repair: boolean;
  badges: string[];
  warnings: string[];
}

export interface ResearchContinuityChangedItemEvidenceResponse {
  status: string | null;
  source_artifact: string | null;
  source_id: string | null;
  source_field: string | null;
}

export interface ResearchContinuityChangedItemResponse {
  id: string;
  group: ResearchContinuityDiffGroup;
  event_type: string;
  item_type: ResearchContinuityDiffItemType;
  title: string;
  before: string | null;
  after: string | null;
  severity: ResearchContinuityDiffSeverity;
  evidence: ResearchContinuityChangedItemEvidenceResponse;
}

export interface ResearchContinuityChangeGroupResponse {
  group: ResearchContinuityDiffGroup;
  title: string;
  count: number;
  items: ResearchContinuityChangedItemResponse[];
}

export interface ResearchContinuityDiffReportResponse {
  version: 'research_continuity_diff.v1';
  summary: ResearchContinuityDiffSummaryResponse;
  change_groups: ResearchContinuityChangeGroupResponse[];
  changed_items: ResearchContinuityChangedItemResponse[];
}

export interface ResearchContinuityEntrySummaryResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  entry_type: 'baseline' | 'delta' | 'degraded' | 'skipped';
  status: 'completed' | 'degraded' | 'skipped' | 'failed';
  generated_at: string | null;
  summary: string;
  thin_report: ResearchContinuityThinReport | null;
  diff_summary: ResearchContinuityDiffSummaryResponse;
  debug: ResearchContinuityDebugAccessResponse;
}

export interface ResearchContinuityQualityExplanationResponse {
  status: string;
  score: number | null;
  observed_evidence_coverage: number | null;
  evidence_coverage: number | null;
  provenance_status: string | null;
  warnings: string[];
  reasons: string[];
}

export interface ResearchContinuityEvidenceDigestResponse {
  observed_count: number | null;
  reasoning_count: number | null;
  missing_count: number | null;
  no_evidence_count: number | null;
  stale_count: number | null;
  observed_coverage: number | null;
  missing_categories: string[];
  stale_categories: string[];
  health_line: string;
}

export interface ResearchContinuityMaterialEventDigestResponse {
  type: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  evidence_status: string | null;
}

export interface ResearchContinuityStateTransitionDigestResponse {
  previous_entry_id: string | null;
  current_snapshot_id: string | null;
  source_run_ids: string[];
  transition: 'baseline' | 'delta' | 'degraded' | 'skipped';
  reason: string;
}

export interface ResearchContinuityEntryDetailResponse
  extends ResearchContinuityEntrySummaryResponse {
  diff_report: ResearchContinuityDiffReportResponse;
  quality_explanation: ResearchContinuityQualityExplanationResponse;
  evidence_digest: ResearchContinuityEvidenceDigestResponse;
  material_events_digest: ResearchContinuityMaterialEventDigestResponse[];
  state_transition: ResearchContinuityStateTransitionDigestResponse;
}

export interface ResearchContinuityEntryDebugResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  generated_at: string | null;
  debug_view: 'redacted';
  redacted: true;
  requested_by_user_id: string;
  returned_at: string;
  entry: {
    sections: ContinuitySectionResponse[];
    events: JsonRecord[];
    snapshot_quality: JsonRecord;
    source_run_ids: string[];
    writer_metadata: JsonRecord;
    payload: JsonRecord;
  };
}

export interface ResearchContinuityEntryResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  current_snapshot_id: string | null;
  previous_entry_id: string | null;
  entry_type: 'baseline' | 'delta' | 'degraded' | 'skipped';
  status: 'completed' | 'degraded' | 'skipped' | 'failed';
  generated_at: string | null;
  summary: string;
  sections: ContinuitySectionResponse[];
  events: JsonRecord[];
  snapshot_quality: JsonRecord;
  source_run_ids: string[];
  writer_metadata: JsonRecord;
  payload: JsonRecord;
  thin_report?: ResearchContinuityThinReport | null;
}

export interface ResearchContinuityStateResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  current_snapshot_id: string | null;
  latest_entry_id: string | null;
  latest_run_id: string | null;
  current_view: JsonRecord;
  active_items: JsonRecord[];
  recent_resolved_items: JsonRecord[];
  recent_invalidated_items: JsonRecord[];
  data_quality: JsonRecord;
  updated_at: string | null;
}

export interface GenerateResearchContinuityResponse {
  created: boolean;
  entry: ResearchContinuityEntryDetailResponse;
}

export interface ResearchContinuityStateEnvelopeResponse {
  symbol: string;
  state: ResearchContinuityStateResponse | null;
  latest_entry: ResearchContinuityEntrySummaryResponse | null;
}

export interface ResearchContinuityEntriesResponse {
  symbol: string;
  entries: ResearchContinuityEntrySummaryResponse[];
}

export type ResearchContinuityLifecycleItemType =
  | 'claim'
  | 'risk'
  | 'watchpoint'
  | 'level'
  | 'invalidation'
  | 'view'
  | 'quality'
  | 'unknown';

export type ResearchContinuityLifecycleStatus =
  | 'active'
  | 'updated'
  | 'resolved'
  | 'weakened'
  | 'invalidated'
  | 'context'
  | 'quality';

export interface ResearchContinuityTimelineWindowResponse {
  entry_limit: number;
  truncated: boolean;
  coverage: 'complete' | 'windowed';
}

export interface ResearchContinuityTimelineEventResponse {
  id: string;
  entry_id: string;
  research_run_id: string | null;
  observed_at: string | null;
  recorded_at: string | null;
  event_type: string;
  stable_item_key: string | null;
  item_type: ResearchContinuityLifecycleItemType;
  status: ResearchContinuityLifecycleStatus;
  title: string;
  before: string | null;
  after: string | null;
  severity: 'info' | 'warning' | 'critical';
  diff_quality: 'complete' | 'partial' | 'unavailable';
  entry_type: string;
  entry_status: string;
  is_repair: boolean;
  repair_case_type: string | null;
  source_entry_id: string | null;
  source_run_id: string | null;
  evidence_status: string | null;
  source_artifact: string | null;
  source_id: string | null;
  source_field: string | null;
}

export interface ResearchContinuityLifecycleItemResponse {
  stable_item_key: string;
  item_type: ResearchContinuityLifecycleItemType;
  status: ResearchContinuityLifecycleStatus;
  title: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  first_seen_run_id: string | null;
  last_seen_run_id: string | null;
  occurrence_count: number;
  entry_count: number;
  latest_entry_id: string | null;
  latest_event_type: string | null;
  source_artifacts: string[];
  timeline_event_ids: string[];
}

export interface ResearchContinuityTimelineResponse {
  symbol: string;
  workspace_id: string;
  generated_at: string;
  window: ResearchContinuityTimelineWindowResponse;
  entry_count: number;
  event_count: number;
  lifecycle_items: ResearchContinuityLifecycleItemResponse[];
  timeline_events: ResearchContinuityTimelineEventResponse[];
  warnings: string[];
}

export type ResearchContinuityRepairCaseType =
  | 'missing_continuity'
  | 'skipped_or_degraded'
  | 'legacy_evidence';

export type ResearchContinuityScheduledRepairMode =
  | 'disabled'
  | 'dry_run'
  | 'enabled';

export type UpdateResearchContinuitySettingsRequest = {
  scheduled_repair_mode?: ResearchContinuityScheduledRepairMode;
  scheduled_repair_case_types?: ResearchContinuityRepairCaseType[];
  scheduled_repair_interval_hours?: number;
  scheduled_repair_lookback_days?: number;
  scheduled_repair_limit?: number;
};

export interface ResearchContinuityWorkspaceSettingsResponse {
  workspace_id: string;
  scheduled_repair_mode: ResearchContinuityScheduledRepairMode;
  scheduled_repair_case_types: ResearchContinuityRepairCaseType[];
  scheduled_repair_interval_hours: number;
  scheduled_repair_lookback_days: number;
  scheduled_repair_limit: number;
  next_scheduled_repair_due_at: string | null;
  last_scheduled_repair_at: string | null;
  last_scheduled_repair_run_id: string | null;
  scheduler_lease_owner: string | null;
  scheduler_lease_expires_at: string | null;
  last_scheduler_attempt_at: string | null;
  last_scheduler_success_at: string | null;
  last_scheduler_error: string | null;
  consecutive_scheduler_failures: number;
  next_scheduler_retry_at: string | null;
  updated_by_user_id: string | null;
  updated_at: string | null;
}

export interface ResearchContinuitySchedulerStatusResponse {
  workspace_id: string;
  settings: ResearchContinuityWorkspaceSettingsResponse;
  due: boolean;
  disabled: boolean;
  dry_run: boolean;
  worker_enabled: boolean;
  next_scheduled_repair_due_at: string | null;
  last_scheduled_repair_at: string | null;
  last_scheduled_repair_run_id: string | null;
  last_scheduled_repair_status: string | null;
}

export interface ResearchContinuitySchedulerRunDueResponse {
  workspace_id: string;
  due: boolean;
  skipped_reason:
    | null
    | 'scheduler_disabled'
    | 'not_due'
    | 'no_case_types'
    | 'worker_lease_active'
    | 'settings_unavailable';
  dry_run: boolean;
  audit_run_id: string | null;
  repair_run: ResearchContinuityRepairRunResponse | null;
  next_scheduled_repair_due_at: string | null;
}

export type ResearchContinuityRepairPredictedAction =
  | 'create_repair_entry'
  | 'already_repaired'
  | 'already_has_continuity'
  | 'not_eligible'
  | 'not_improved';

export type ResearchContinuityRepairRunAction =
  | 'created_repair_entry'
  | 'already_repaired'
  | 'already_has_continuity'
  | 'dry_run'
  | 'not_eligible'
  | 'not_improved'
  | 'failed';

export interface ResearchContinuityRepairCandidateResponse {
  candidate_id: string;
  run_id: string;
  symbol: string;
  run_completed_at: string | null;
  case_type: ResearchContinuityRepairCaseType;
  current_entry_id: string | null;
  current_entry_status: string | null;
  current_entry_type: string | null;
  eligible: boolean;
  reason: string;
  blocked_reason?: string | null;
  predicted_action: ResearchContinuityRepairPredictedAction;
  repair_version: 'research-continuity-v1.3';
}

export interface ResearchContinuityRepairPreviewResponse {
  dry_run: true;
  candidate_count: number;
  candidates: ResearchContinuityRepairCandidateResponse[];
}

export interface ResearchContinuityRepairRunResultResponse {
  candidate_id: string;
  run_id: string;
  symbol: string;
  case_type: ResearchContinuityRepairCaseType;
  action: ResearchContinuityRepairRunAction;
  previous_entry_id: string | null;
  new_entry_id: string | null;
  state_updated: boolean;
  reason: string;
  error?: string | null;
}

export interface ResearchContinuityRepairRunResponse {
  audit_run_id: string;
  dry_run: boolean;
  status: ResearchContinuityRepairRunStatus;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  results: ResearchContinuityRepairRunResultResponse[];
}

export type ResearchContinuityRepairRunStatus =
  | 'started'
  | 'completed'
  | 'completed_with_failures'
  | 'failed';

export interface ResearchContinuityRepairRunSummaryResponse {
  id: string;
  workspace_id: string;
  requested_by_user_id: string;
  requested_at: string | null;
  completed_at: string | null;
  dry_run: boolean;
  status: ResearchContinuityRepairRunStatus;
  idempotency_key: string | null;
  filters: JsonRecord;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  created_entry_ids: string[];
  error_message: string | null;
}

export interface ResearchContinuityRepairRunDetailResponse
  extends ResearchContinuityRepairRunSummaryResponse {
  results: ResearchContinuityRepairRunResultResponse[];
}

export interface ResearchContinuityRepairRunsResponse {
  runs: ResearchContinuityRepairRunSummaryResponse[];
}

export type GenerateResearchContinuityRequest = {
  force?: boolean;
};

export type ResearchContinuityRepairPreviewRequest = {
  symbol?: string;
  from?: string;
  to?: string;
  case_types?: ResearchContinuityRepairCaseType[];
  limit?: number;
};

export type RunResearchContinuityRepairRequest = {
  symbol?: string;
  from?: string;
  to?: string;
  case_types: ResearchContinuityRepairCaseType[];
  limit: number;
  dry_run?: boolean;
  idempotency_key?: string;
};

export interface EvidenceBundleResponse {
  schema_version: 'evidence_bundle.v1';
  exported_at: string;
  workspace_id: string;
  research_run_id: string;
  symbol: string;
  source: 'api';
  run: ResearchRunResponse;
  events: ResearchRunEventResponse[];
  snapshots: ResearchRunSnapshotsResponse;
  debate: ResearchRunDebateResponse;
  thesis: ThesisResponse | null;
  scenarios: ScenarioResponse[];
  signal_details: SignalDetailResponse[];
  artifacts: ResearchRunArtifactsResponse;
}

export type CreateResearchRunRequest = {
  run_id?: string;
  workspace_id: string;
  symbol?: string;
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
  entry?: string;
  stop_loss?: string;
  take_profit?: string;
  position_intent?: string;
};

export type RecordThesisReviewRequest = {
  result: string;
  notes?: string;
  max_favorable_excursion?: number;
  max_adverse_excursion?: number;
};

export type EvaluateThesisRequest = {
  thesis_id: string;
  window_days?: 7 | 14 | 30;
};

export type PreviewMaturedEvaluationsRequest = {
  window_days?: 7 | 14 | 30;
  scan_limit?: number;
  symbol?: string;
};

export type ApplyMaturedEvaluationsRequest = {
  window_days?: 7 | 14 | 30;
  max_batch?: number;
  symbol?: string;
};

export type SymbolCalibrationRequest = {
  symbol: string;
  window_days?: 7 | 14 | 30;
  lookback_days?: 30 | 60 | 90;
};

export type AgentCalibrationRequest = {
  symbol?: string;
  window_days?: 7 | 14 | 30;
  lookback_days?: 30 | 60 | 90;
};

export type RecordCalibrationOutcomeReviewRequest = {
  notes?: string;
};

export type CreateCalibrationEvaluationRerunRequest = {
  reason: CalibrationEvaluationRerunReason;
  notes?: string;
  idempotency_key?: string;
};

export type EvaluationVersionPolicyActionRequest = {
  reason: CalibrationEvaluationRerunReason;
  notes?: string;
  idempotency_key?: string;
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
