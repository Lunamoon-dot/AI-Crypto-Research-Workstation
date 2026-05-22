import { JsonRecord } from '../database/journal.types';

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
  stability_guard: JsonRecord;
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

export interface ThesisTargetLevelResponse {
  label: string;
  price: number;
}

export interface ThesisMonitorPlanResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  baseline_run_id: string | null;
  symbol: string;
  market_type: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  baseline_price: number | null;
  baseline_price_source: string;
  baseline_observed_at: string | null;
  entry_low: number | null;
  entry_high: number | null;
  invalidation_level: number | null;
  invalidation_direction: string | null;
  targets: ThesisTargetLevelResponse[];
  scenario_triggers: string[];
  missing_fields: string[];
  price_interval_minutes: number;
  signal_interval_minutes: number;
  memo_interval_minutes: number;
  run_memo_on_review: boolean;
  run_memo_on_rerun_full: boolean;
  skip_memo_if_no_new_pulses: boolean;
  watch_distance_pct: number;
  review_distance_pct: number;
  consecutive_review_to_rerun: number;
  consecutive_invalidation_to_rerun: number;
  enabled_signal_factors: string[];
  scheduler_enabled: boolean;
  latest_pulse_id: string | null;
  latest_memo_id: string | null;
  latest_status: string | null;
  latest_price: number | null;
  latest_trigger_reasons: string[];
  last_pulse_at: string | null;
  next_pulse_due_at: string | null;
  last_memo_at: string | null;
  next_memo_due_at: string | null;
  payload: JsonRecord;
}

export interface ThesisPulseResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  monitor_plan_id: string;
  baseline_run_id: string | null;
  symbol: string;
  market_type: string;
  pulse_type: string;
  bucket_start: string | null;
  observed_at: string | null;
  current_price: number | null;
  baseline_price: number | null;
  price_change_pct: number | null;
  distance_to_entry_pct: number | null;
  distance_to_invalidation_pct: number | null;
  nearest_target: number | null;
  distance_to_nearest_target_pct: number | null;
  signal_bias: string;
  signal_confidence: number | null;
  signal_delta: number | null;
  scenario_status: string;
  score: number;
  status: string;
  suggested_action: string;
  trigger_reasons: string[];
  hard_triggers: string[];
  missing_data: string[];
  payload: JsonRecord;
}

export interface RunThesisPulseResponse {
  created: boolean;
  queued?: boolean;
  job_id?: string | null;
  queue_backend?: string | null;
  pulse: ThesisPulseResponse | null;
}

export interface ThesisPulseMemoResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  monitor_plan_id: string;
  baseline_run_id: string | null;
  memo_type: string;
  window_start: string | null;
  window_end: string | null;
  created_at: string | null;
  status: string;
  summary: string;
  what_changed: string[];
  why_it_matters: string[];
  what_to_watch_next: string[];
  recommended_action: string;
  rerun_full_recommended: boolean;
  confidence: number | null;
  referenced_pulse_ids: string[];
  prompt_version: string;
  provider: string;
  model: string;
  payload: JsonRecord;
}

export interface RunThesisPulseMemoResponse {
  created: boolean;
  skipped: boolean;
  skip_reason: string | null;
  queued?: boolean;
  job_id?: string | null;
  queue_backend?: string | null;
  memo: ThesisPulseMemoResponse | null;
}

export interface ThesisSchedulerRunResponse {
  workspace_id: string;
  thesis_id: string;
  checked_at: string;
  skipped_reason: string | null;
  queued: boolean;
  queued_job_ids: string[];
  queue_backend: string | null;
  ran_pulse: boolean;
  ran_memo: boolean;
  pulse: RunThesisPulseResponse | null;
  memo: RunThesisPulseMemoResponse | null;
  plan: ThesisMonitorPlanResponse | null;
}

export interface ThesisSchedulerStatusResponse {
  workspace_id: string;
  thesis_id: string;
  enabled: boolean;
  scheduled: boolean;
  running: boolean;
  product_mode: boolean;
  queue_backend: string | null;
  plan_status: string;
  scheduler_enabled: boolean;
  price_interval_minutes: number;
  signal_interval_minutes: number;
  memo_interval_minutes: number;
  next_pulse_due_at: string | null;
  next_signal_due_at: string | null;
  next_memo_due_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  last_result: ThesisSchedulerRunResponse | null;
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
  payload: JsonRecord;
}

export interface EvaluateThesisResponse {
  created: boolean;
  evaluation: CalibrationEvaluationResponse;
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
  coverage: SymbolCalibrationCoverageResponse;
  stance: SymbolCalibrationStanceResponse;
  outcome: SymbolCalibrationOutcomeResponse;
  rows: SymbolCalibrationRowResponse[];
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

export interface DiffFieldResponse {
  a?: unknown;
  b?: unknown;
  common?: string[];
  only_a?: string[];
  only_b?: string[];
  changed: boolean;
  [key: string]: unknown;
}

export interface ComparisonResponse {
  kind: 'thesis_diff' | 'run_diff';
  id_a: string;
  id_b: string;
  cross_symbol?: boolean;
  direction_flip: boolean;
  changed_fields: string[];
  changed_count: number;
  change_severity: string;
  severity_reasons: string[];
  fields: Record<string, DiffFieldResponse>;
  thesis_diff?: ComparisonResponse | null;
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

export interface MonitoringQueueHealthResponse {
  queued: number;
  running: number;
  failed: number;
  dead_letter: number;
  oldest_queued_at: string | null;
}

export interface MonitoringSchedulerHealthResponse {
  enabled_plans: number;
  due_plans: number;
  last_enqueue_at: string | null;
  last_enqueue_error: string | null;
}

export interface MonitoringWorkersHealthResponse {
  active_workers: number;
  last_success_at: string | null;
  last_error_at: string | null;
  recent_error_types: string[];
}

export interface MonitoringRetentionHealthResponse {
  last_run_at: string | null;
  last_deleted_counts: {
    deleted_pulses: number;
    deleted_memos: number;
    deleted_jobs: number;
    dry_run: boolean;
  };
  last_error: string | null;
}

export interface LlmMemoHealthResponse {
  recent_calls: number;
  failure_rate: number | null;
  average_latency_ms: number | null;
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
  monitoring_queue: MonitoringQueueHealthResponse;
  monitoring_scheduler: MonitoringSchedulerHealthResponse;
  monitoring_workers: MonitoringWorkersHealthResponse;
  monitoring_retention: MonitoringRetentionHealthResponse;
  llm_memo_health: LlmMemoHealthResponse;
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
  research_run_id: string | null;
  signal_snapshot_id: string | null;
  provenance: JsonRecord;
  evidence: JsonRecord;
  watch_conditions: JsonRecord;
  payload: JsonRecord;
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

export function toResearchRunResponse(run: JsonRecord): ResearchRunResponse {
  return {
    id: nullableString(run.id),
    run_id: nullableString(run.run_id ?? run.id),
    workspace_id: stringValue(run.workspace_id, 'local'),
    symbol: stringValue(run.symbol),
    asset_class: stringValue(run.asset_class, 'crypto'),
    market_type: stringValue(run.market_type, 'spot'),
    timeframe: nullableString(run.timeframe),
    status: stringValue(run.status, 'unknown'),
    started_at: nullableString(run.started_at),
    completed_at: nullableString(run.completed_at),
    thesis_id: nullableString(run.thesis_id),
    decision_id: nullableString(run.decision_id),
    signal_snapshot_id: nullableString(run.signal_snapshot_id),
    market_snapshot_id: nullableString(run.market_snapshot_id),
    degradation_reasons: stringList(run.degradation_reasons),
    missing_core_data: stringList(run.missing_core_data),
    missing_optional_data: stringList(run.missing_optional_data),
  };
}

export function toResearchRunEventResponse(
  event: JsonRecord,
): ResearchRunEventResponse {
  return {
    id: nullableString(event.id),
    workspace_id: stringValue(event.workspace_id, 'local'),
    research_run_id: nullableString(event.research_run_id),
    thesis_id: nullableString(event.thesis_id),
    event_type: stringValue(event.event_type),
    created_at: nullableString(event.created_at),
    message: stringValue(event.message),
    payload: recordValue(event.payload ?? event.payload_json),
  };
}

type StageTimingDefinition = {
  key: string;
  label: string;
  aliases: readonly string[];
  marketTypes?: readonly string[];
  completedEventTypes?: readonly string[];
  grouped?: boolean;
};

const STAGE_TIMING_DEFINITIONS: readonly StageTimingDefinition[] = [
  {
    key: 'quant',
    label: 'Quant',
    aliases: ['quant', 'quant analyst', 'signal'],
    completedEventTypes: ['signal.generated', 'snapshot.health'],
  },
  {
    key: 'market',
    label: 'Market',
    aliases: ['market', 'market analyst'],
  },
  {
    key: 'news',
    label: 'News',
    aliases: ['news', 'news analyst'],
  },
  {
    key: 'social',
    label: 'Social',
    aliases: ['social', 'sentiment', 'sentiment analyst', 'social analyst'],
  },
  {
    key: 'onchain',
    label: 'Onchain',
    aliases: ['onchain', 'fundamental', 'onchain analyst'],
  },
  {
    key: 'debate',
    label: 'Bull/Contrarian Debate',
    aliases: ['bull researcher', 'bear researcher', 'contrarian analyst'],
    completedEventTypes: ['debate.recorded'],
    grouped: true,
  },
  {
    key: 'research_manager',
    label: 'Research Manager',
    aliases: ['research manager', 'research_manager'],
  },
  {
    key: 'setup_planner',
    label: 'Setup Planner',
    aliases: ['setup planner', 'setup_planner', 'trader'],
    completedEventTypes: ['plan.recorded'],
  },
  {
    key: 'spot_checks',
    label: 'Spot Checks',
    aliases: ['setup planner', 'setup_planner', 'trader'],
    marketTypes: ['spot'],
    completedEventTypes: ['plan.recorded'],
  },
  {
    key: 'perp_checks',
    label: 'Perp Checks',
    aliases: ['setup planner', 'setup_planner', 'trader'],
    marketTypes: ['perp'],
    completedEventTypes: ['plan.recorded'],
  },
  {
    key: 'risk_debate',
    label: 'Risk Debate',
    aliases: [
      'risk',
      'risk analyst',
      'aggressive analyst',
      'conservative analyst',
      'neutral analyst',
    ],
    completedEventTypes: ['risk.debate.recorded', 'risk.checked'],
    grouped: true,
  },
  {
    key: 'portfolio_manager',
    label: 'Portfolio Manager',
    aliases: ['portfolio manager', 'portfolio_manager'],
  },
  {
    key: 'scenario_planner',
    label: 'Scenario Planner',
    aliases: ['scenario planner', 'scenarioplanner', 'scenario.plan', 'scenarios_saved'],
    completedEventTypes: ['scenario.plan.recorded', 'scenarios_saved'],
  },
  {
    key: 'thesis',
    label: 'Trade Thesis',
    aliases: ['thesis', 'trade thesis', 'trade_thesis', 'thesis.generated'],
    completedEventTypes: ['thesis.generated'],
  },
];

const SELECTABLE_STAGE_KEYS = new Set(['market', 'news', 'social', 'onchain']);

export function buildResearchRunStageTimings(
  run: ResearchRunResponse,
  events: ResearchRunEventResponse[],
): ResearchRunStageTimingResponse[] {
  const marketType = normalizeStageMarketType(run.market_type);
  const selectedAnalysts = selectedAnalystsFromStageEvents(events);
  const runTerminal = isTerminalRunStatus(run.status);

  return STAGE_TIMING_DEFINITIONS.filter(
    (stage) =>
      (!stage.marketTypes || stage.marketTypes.includes(marketType)) &&
      (!SELECTABLE_STAGE_KEYS.has(stage.key) ||
        selectedAnalysts === null ||
        selectedAnalysts.has(stage.key)),
  ).map((stage) => buildStageTiming(stage, events, runTerminal));
}

function buildStageTiming(
  stage: StageTimingDefinition,
  events: ResearchRunEventResponse[],
  runTerminal: boolean,
): ResearchRunStageTimingResponse {
  const marketBranch = isMarketBranchStage(stage.key);
  const startedEvents = marketBranch
    ? []
    : events.filter(
        (event) =>
          event.event_type === 'agent.node.started' &&
          eventMatchesStageAliases(event, stage.aliases),
      );
  const completedAgentEvents = events.filter(
    (event) =>
      event.event_type === 'agent.node.completed' &&
      eventMatchesStageAliases(event, stage.aliases),
  );
  const completedMilestoneEvents = events.filter((event) =>
    stage.completedEventTypes?.includes(event.event_type),
  );
  const failedEvents = events.filter(
    (event) =>
      event.event_type === 'agent.node.failed' &&
      eventMatchesStageAliases(event, stage.aliases),
  );
  const marketBranchCompleted =
    latestEvent(completedMilestoneEvents) ?? latestEvent(completedAgentEvents);
  const completedEvents = marketBranch
    ? marketBranchCompleted
      ? [marketBranchCompleted]
      : []
    : [...completedAgentEvents, ...completedMilestoneEvents];
  const terminalEvents = [...completedEvents, ...failedEvents];
  const latestTerminal = latestEvent(terminalEvents);
  const latestFailed = latestEvent(failedEvents);
  const latestCompleted = latestEvent(completedEvents);
  const startedAt = earliestTimestamp(startedEvents);
  const completedAt = latestTerminal ? nullableString(latestTerminal.created_at) : null;
  const sourceEvents = uniqueEvents([
    ...startedEvents,
    ...completedAgentEvents,
    ...completedMilestoneEvents,
    ...failedEvents,
  ]);
  const durationMs = marketBranch
    ? null
    : stage.grouped
      ? wallClockDurationMs(startedAt, completedAt)
      : eventDurationMs(latestTerminal) ?? wallClockDurationMs(startedAt, completedAt);
  const eventState = resolveStageEventState({
    hasStarted: startedEvents.length > 0,
    latestCompleted,
    latestFailed,
    runTerminal,
  });

  return {
    stage_key: stage.key,
    label: stage.label,
    event_state: eventState,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    source_event_ids: sourceEvents
      .map((event) => event.id)
      .filter((id): id is string => Boolean(id)),
  };
}

function resolveStageEventState({
  hasStarted,
  latestCompleted,
  latestFailed,
  runTerminal,
}: {
  hasStarted: boolean;
  latestCompleted: ResearchRunEventResponse | null;
  latestFailed: ResearchRunEventResponse | null;
  runTerminal: boolean;
}): ResearchRunStageTimingResponse['event_state'] {
  if (latestFailed && eventIsSameOrAfter(latestFailed, latestCompleted)) {
    return 'failed';
  }
  if (latestCompleted) {
    return 'completed';
  }
  if (hasStarted) {
    return 'running';
  }
  return runTerminal ? 'missing' : 'pending';
}

function isMarketBranchStage(stageKey: string): boolean {
  return stageKey === 'spot_checks' || stageKey === 'perp_checks';
}

function selectedAnalystsFromStageEvents(
  events: ResearchRunEventResponse[],
): Set<string> | null {
  const startedEvent = events.find(
    (event) =>
      event.event_type === 'run.started' &&
      Array.isArray(event.payload.analysts),
  );
  if (!startedEvent) {
    return null;
  }
  return new Set(
    (startedEvent.payload.analysts as unknown[])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => SELECTABLE_STAGE_KEYS.has(value)),
  );
}

function eventMatchesStageAliases(
  event: ResearchRunEventResponse,
  aliases: readonly string[],
): boolean {
  const text = [
    event.payload.agent_name,
    event.payload.analyst_name,
    event.payload.graph_node,
    event.payload.stage,
    event.message,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return aliases.some((alias) => text.includes(alias));
}

function normalizeStageMarketType(value: string): 'spot' | 'perp' {
  const normalized = value.trim().toLowerCase();
  return ['perp', 'perpetual', 'future', 'futures'].includes(normalized)
    ? 'perp'
    : 'spot';
}

function isTerminalRunStatus(status: string | undefined): boolean {
  return Boolean(
    status &&
      !['created', 'queued', 'running', 'submitted', 'pending'].includes(status),
  );
}

function eventDurationMs(event: ResearchRunEventResponse | null): number | null {
  if (!event) {
    return null;
  }
  return nullableNumber(event.payload.duration_ms);
}

function wallClockDurationMs(
  startedAt: string | null,
  completedAt: string | null,
): number | null {
  if (!startedAt || !completedAt) {
    return null;
  }
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return null;
  }
  const duration = completed - started;
  return duration >= 0 ? duration : null;
}

function earliestTimestamp(events: ResearchRunEventResponse[]): string | null {
  const event = [...events].sort(compareEventsByTime).at(0);
  return event ? nullableString(event.created_at) : null;
}

function latestEvent(
  events: ResearchRunEventResponse[],
): ResearchRunEventResponse | null {
  return [...events].sort(compareEventsByTime).at(-1) ?? null;
}

function eventIsSameOrAfter(
  left: ResearchRunEventResponse,
  right: ResearchRunEventResponse | null,
): boolean {
  if (!right) {
    return true;
  }
  return eventTimestamp(left) >= eventTimestamp(right);
}

function compareEventsByTime(
  left: ResearchRunEventResponse,
  right: ResearchRunEventResponse,
): number {
  return eventTimestamp(left) - eventTimestamp(right);
}

function eventTimestamp(event: ResearchRunEventResponse): number {
  const timestamp = Date.parse(event.created_at ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function uniqueEvents(
  events: ResearchRunEventResponse[],
): ResearchRunEventResponse[] {
  const seen = new Set<string>();
  const result: ResearchRunEventResponse[] = [];
  for (const event of events.sort(compareEventsByTime)) {
    const key =
      event.id ??
      `${event.event_type}:${event.created_at ?? ''}:${event.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(event);
  }
  return result;
}

export function toMarketSnapshotResponse(
  snapshot: JsonRecord,
): MarketSnapshotResponse {
  return {
    id: nullableString(snapshot.id),
    workspace_id: stringValue(snapshot.workspace_id, 'local'),
    research_run_id: nullableString(snapshot.research_run_id),
    symbol: stringValue(snapshot.symbol),
    captured_at: nullableString(snapshot.captured_at),
    current_price: nullableNumber(snapshot.current_price),
    source: stringValue(snapshot.source),
    source_timestamp: nullableString(snapshot.source_timestamp),
    payload: recordValue(snapshot.payload ?? snapshot.payload_json),
  };
}

export function toSignalSnapshotResponse(
  snapshot: JsonRecord,
): SignalSnapshotResponse {
  return {
    id: nullableString(snapshot.id),
    workspace_id: stringValue(snapshot.workspace_id, 'local'),
    research_run_id: nullableString(snapshot.research_run_id),
    symbol: stringValue(snapshot.symbol),
    captured_at: nullableString(snapshot.captured_at),
    composite_signal_id: nullableString(snapshot.composite_signal_id),
    signal_count: nullableNumber(snapshot.signal_count),
    bullish_count: nullableNumber(snapshot.bullish_count),
    bearish_count: nullableNumber(snapshot.bearish_count),
    neutral_count: nullableNumber(snapshot.neutral_count),
    stale_count: nullableNumber(snapshot.stale_count),
    unknown_freshness_count: nullableNumber(snapshot.unknown_freshness_count),
    payload: recordValue(snapshot.payload ?? snapshot.payload_json),
  };
}

export function toDebateResponse(debate: JsonRecord): DebateResponse {
  return {
    id: nullableString(debate.id),
    workspace_id: stringValue(debate.workspace_id, 'local'),
    research_run_id: nullableString(debate.research_run_id),
    symbol: stringValue(debate.symbol),
    consensus_stance: stringValue(debate.consensus_stance),
    conflict_level: stringValue(debate.conflict_level),
    created_at: nullableString(debate.created_at),
    payload: recordValue(debate.payload ?? debate.payload_json),
  };
}

export function toAgentOpinionResponse(
  opinion: JsonRecord,
): AgentOpinionResponse {
  return {
    id: nullableString(opinion.id),
    workspace_id: stringValue(opinion.workspace_id, 'local'),
    debate_id: nullableString(opinion.debate_id),
    research_run_id: nullableString(opinion.research_run_id),
    agent_name: stringValue(opinion.agent_name),
    agent_role: stringValue(opinion.agent_role),
    stance: stringValue(opinion.stance),
    confidence: nullableNumber(opinion.confidence),
    data_quality: nullableNumber(opinion.data_quality),
    data_quality_label: stringValue(opinion.data_quality_label, 'unknown'),
    reason_codes: stringList(opinion.reason_codes),
    created_at: nullableString(opinion.created_at),
    payload: recordValue(opinion.payload ?? opinion.payload_json),
  };
}

export function toThesisResponse(thesis: JsonRecord): ThesisResponse {
  const summary = recordValue(thesis.structured_summary);
  const evidence = recordValue(thesis.evidence);
  const entryZone = firstString(thesis.entry_zone, summary.entry_zone);
  const invalidation = firstString(
    thesis.invalidation_level,
    thesis.invalidation,
    summary.invalidation,
  );
  const targets = firstStringList(thesis.target_zones, summary.target_zones);
  const summaryResponse = toThesisSummaryResponse(
    summary,
    entryZone,
    invalidation,
    targets,
  );
  const direction = directionForRating(
    summaryResponse.rating,
    stringValue(thesis.direction, 'watch'),
  );
  summaryResponse.direction = directionForRating(
    summaryResponse.rating,
    summaryResponse.direction,
  );
  return {
    id: nullableString(thesis.id),
    workspace_id: stringValue(thesis.workspace_id, 'local'),
    research_run_id: nullableString(thesis.research_run_id),
    symbol: stringValue(thesis.symbol),
    direction,
    setup_type: stringValue(thesis.setup_type, 'unspecified'),
    confidence: nullableNumber(thesis.confidence),
    confidence_source: stringValue(evidence.confidence_source),
    confidence_rationale: stringValue(thesis.confidence_rationale),
    quant_confidence: nullableNumber(evidence.quant_confidence),
    quant_bias: stringValue(evidence.quant_bias),
    stability_guard: recordValue(evidence.stability_guard),
    created_at: nullableString(thesis.created_at),
    entry_zone: entryZone,
    invalidation_level: invalidation,
    target_zones: targets,
    thesis_text: stringValue(thesis.thesis_text),
    summary: summaryResponse,
    supporting_signal_ids: stringList(thesis.supporting_signal_ids),
    contradicting_signal_ids: stringList(thesis.contradicting_signal_ids),
    stale_or_missing_data: stringList(thesis.stale_or_missing_data),
    monitor_next: stringList(thesis.monitor_next),
  };
}

export function toThesisMonitorPlanResponse(
  plan: JsonRecord,
): ThesisMonitorPlanResponse {
  const payload = recordValue(plan.payload ?? plan.payload_json);
  return {
    id: nullableString(plan.id),
    workspace_id: stringValue(plan.workspace_id, 'local'),
    thesis_id: stringValue(plan.thesis_id),
    baseline_run_id: nullableString(plan.baseline_run_id),
    symbol: stringValue(plan.symbol),
    market_type: stringValue(plan.market_type, 'spot'),
    status: stringValue(plan.status, 'unknown'),
    created_at: nullableString(plan.created_at),
    updated_at: nullableString(plan.updated_at),
    baseline_price: nullableNumber(plan.baseline_price),
    baseline_price_source: stringValue(plan.baseline_price_source),
    baseline_observed_at: nullableString(plan.baseline_observed_at),
    entry_low: nullableNumber(plan.entry_low),
    entry_high: nullableNumber(plan.entry_high),
    invalidation_level: nullableNumber(plan.invalidation_level),
    invalidation_direction: nullableString(plan.invalidation_direction),
    targets: targetLevels(plan.targets ?? plan.targets_json),
    scenario_triggers: stringList(
      plan.scenario_triggers ?? plan.scenario_triggers_json,
    ),
    missing_fields: stringList(plan.missing_fields ?? plan.missing_fields_json),
    price_interval_minutes: numberValue(plan.price_interval_minutes, 5),
    signal_interval_minutes: numberValue(plan.signal_interval_minutes, 15),
    memo_interval_minutes: numberValue(plan.memo_interval_minutes, 240),
    run_memo_on_review: booleanValue(plan.run_memo_on_review, true),
    run_memo_on_rerun_full: booleanValue(plan.run_memo_on_rerun_full, true),
    skip_memo_if_no_new_pulses: booleanValue(
      plan.skip_memo_if_no_new_pulses ?? plan.skip_memo_if_no_new_pulses_json,
      true,
    ),
    watch_distance_pct: numberValue(plan.watch_distance_pct, 5),
    review_distance_pct: numberValue(plan.review_distance_pct, 2),
    consecutive_review_to_rerun: numberValue(
      plan.consecutive_review_to_rerun,
      3,
    ),
    consecutive_invalidation_to_rerun: numberValue(
      plan.consecutive_invalidation_to_rerun,
      2,
    ),
    enabled_signal_factors: stringList(
      plan.enabled_signal_factors ?? plan.enabled_signal_factors_json,
    ),
    scheduler_enabled: booleanValue(plan.scheduler_enabled),
    latest_pulse_id: nullableString(plan.latest_pulse_id),
    latest_memo_id: nullableString(plan.latest_memo_id),
    latest_status: nullableString(plan.latest_status),
    latest_price: nullableNumber(plan.latest_price),
    latest_trigger_reasons: stringList(
      plan.latest_trigger_reasons ?? plan.latest_trigger_reasons_json,
    ),
    last_pulse_at: nullableString(plan.last_pulse_at),
    next_pulse_due_at: nullableString(plan.next_pulse_due_at),
    last_memo_at: nullableString(plan.last_memo_at),
    next_memo_due_at: nullableString(plan.next_memo_due_at),
    payload,
  };
}

export function toThesisPulseResponse(pulse: JsonRecord): ThesisPulseResponse {
  const payload = recordValue(pulse.payload ?? pulse.payload_json);
  return {
    id: nullableString(pulse.id),
    workspace_id: stringValue(pulse.workspace_id, 'local'),
    thesis_id: stringValue(pulse.thesis_id),
    monitor_plan_id: stringValue(pulse.monitor_plan_id),
    baseline_run_id: nullableString(pulse.baseline_run_id),
    symbol: stringValue(pulse.symbol),
    market_type: stringValue(pulse.market_type, 'spot'),
    pulse_type: stringValue(pulse.pulse_type, 'manual'),
    bucket_start: nullableString(pulse.bucket_start),
    observed_at: nullableString(pulse.observed_at),
    current_price: nullableNumber(pulse.current_price),
    baseline_price: nullableNumber(pulse.baseline_price),
    price_change_pct: nullableNumber(pulse.price_change_pct),
    distance_to_entry_pct: nullableNumber(pulse.distance_to_entry_pct),
    distance_to_invalidation_pct: nullableNumber(
      pulse.distance_to_invalidation_pct,
    ),
    nearest_target: nullableNumber(pulse.nearest_target),
    distance_to_nearest_target_pct: nullableNumber(
      pulse.distance_to_nearest_target_pct,
    ),
    signal_bias: stringValue(pulse.signal_bias, 'unknown'),
    signal_confidence: nullableNumber(pulse.signal_confidence),
    signal_delta: nullableNumber(pulse.signal_delta),
    scenario_status: stringValue(pulse.scenario_status, 'none'),
    score: numberValue(pulse.score),
    status: stringValue(pulse.status, 'unknown'),
    suggested_action: stringValue(pulse.suggested_action, 'none'),
    trigger_reasons: stringList(
      pulse.trigger_reasons ?? pulse.trigger_reasons_json,
    ),
    hard_triggers: stringList(pulse.hard_triggers ?? pulse.hard_triggers_json),
    missing_data: stringList(pulse.missing_data ?? pulse.missing_data_json),
    payload,
  };
}

export function toRunThesisPulseResponse(
  result: JsonRecord,
): RunThesisPulseResponse {
  const pulse = recordValue(result.pulse);
  const hasPulse = Object.keys(pulse).length > 0 || Boolean(result.id);
  return {
    created: booleanValue(result.created),
    queued: booleanValue(result.queued),
    job_id: nullableString(result.job_id),
    queue_backend: nullableString(result.queue_backend),
    pulse: hasPulse
      ? toThesisPulseResponse(Object.keys(pulse).length > 0 ? pulse : result)
      : null,
  };
}

export function toThesisPulseMemoResponse(
  memo: JsonRecord,
): ThesisPulseMemoResponse {
  const payload = recordValue(memo.payload ?? memo.payload_json);
  return {
    id: nullableString(memo.id),
    workspace_id: stringValue(memo.workspace_id, 'local'),
    thesis_id: stringValue(memo.thesis_id),
    monitor_plan_id: stringValue(memo.monitor_plan_id),
    baseline_run_id: nullableString(memo.baseline_run_id),
    memo_type: stringValue(memo.memo_type, 'manual'),
    window_start: nullableString(memo.window_start),
    window_end: nullableString(memo.window_end),
    created_at: nullableString(memo.created_at),
    status: stringValue(memo.status, 'unknown'),
    summary: stringValue(memo.summary),
    what_changed: stringList(memo.what_changed ?? memo.what_changed_json),
    why_it_matters: stringList(memo.why_it_matters ?? memo.why_it_matters_json),
    what_to_watch_next: stringList(
      memo.what_to_watch_next ?? memo.what_to_watch_next_json,
    ),
    recommended_action: stringValue(memo.recommended_action, 'none'),
    rerun_full_recommended: booleanValue(memo.rerun_full_recommended),
    confidence: nullableNumber(memo.confidence),
    referenced_pulse_ids: stringList(
      memo.referenced_pulse_ids ?? memo.referenced_pulse_ids_json,
    ),
    prompt_version: stringValue(memo.prompt_version, 'pulse_memo.v1'),
    provider: stringValue(memo.provider, 'unknown'),
    model: stringValue(memo.model, 'unknown'),
    payload,
  };
}

export function toRunThesisPulseMemoResponse(
  result: JsonRecord,
): RunThesisPulseMemoResponse {
  const memo = recordValue(result.memo);
  const hasMemo = Object.keys(memo).length > 0 || Boolean(result.memo_id);
  return {
    created: booleanValue(result.created),
    skipped: booleanValue(result.skipped),
    skip_reason: nullableString(result.skip_reason),
    queued: booleanValue(result.queued),
    job_id: nullableString(result.job_id),
    queue_backend: nullableString(result.queue_backend),
    memo: hasMemo
      ? toThesisPulseMemoResponse(Object.keys(memo).length > 0 ? memo : result)
      : null,
  };
}

export function toScenarioResponse(scenario: JsonRecord): ScenarioResponse {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  return {
    id: nullableString(scenario.id),
    workspace_id: stringValue(scenario.workspace_id, 'local'),
    thesis_id: stringValue(scenario.thesis_id),
    probability_band: stringValue(scenario.probability_band),
    suggested_user_action: stringValue(scenario.suggested_user_action),
    condition: stringValue(scenario.condition ?? payload.condition),
    expected_behavior: stringValue(
      scenario.expected_behavior ??
        scenario.expected_market_behavior ??
        payload.expected_behavior ??
        payload.expected_market_behavior,
    ),
    payload,
  };
}

export function toThesisDecisionResponse(
  decision: JsonRecord,
): ThesisDecisionResponse {
  return {
    id: nullableString(decision.id),
    workspace_id: stringValue(decision.workspace_id, 'local'),
    thesis_id: stringValue(decision.thesis_id),
    action: stringValue(decision.action),
    user_notes: stringValue(decision.user_notes),
    entry: stringValue(decision.entry),
    stop_loss: stringValue(decision.stop_loss),
    take_profit: stringValue(decision.take_profit),
    position_intent: stringValue(decision.position_intent),
    decided_at: nullableString(decision.decided_at),
  };
}

export function toThesisReviewResponse(review: JsonRecord): ThesisReviewResponse {
  return {
    id: nullableString(review.id),
    workspace_id: stringValue(review.workspace_id, 'local'),
    thesis_id: stringValue(review.thesis_id),
    result: stringValue(review.result),
    lessons: stringValue(review.lessons),
    max_favorable_excursion: nullableNumber(review.max_favorable_excursion),
    max_adverse_excursion: nullableNumber(review.max_adverse_excursion),
    reviewed_at: nullableString(review.reviewed_at),
    invalidated: booleanValue(review.invalidated),
  };
}

export function toPerformanceOutcomeReviewResponse(
  review: JsonRecord,
): PerformanceOutcomeReviewResponse {
  return {
    ...toThesisReviewResponse(review),
    symbol: stringValue(review.symbol),
    direction: stringValue(review.direction, 'watch'),
    setup_type: stringValue(review.setup_type, 'unspecified'),
    confidence: nullableNumber(review.confidence),
    thesis_created_at: nullableString(review.thesis_created_at),
  };
}

export function toCalibrationEvaluationResponse(
  evaluation: JsonRecord,
): CalibrationEvaluationResponse {
  const result = calibrationResultValue(evaluation.result);
  const outcomeReviewId = nullableString(evaluation.outcome_review_id);
  const calendarMature = booleanValue(
    evaluation.calendar_mature,
    isCalendarMature(nullableString(evaluation.evaluation_end)),
  );
  const providedBlockers = stringList(evaluation.record_review_blockers)
    .map(calibrationBlockerValue)
    .filter((item): item is CalibrationRecordReviewBlocker => item !== null);
  const recordReviewBlockers =
    providedBlockers.length > 0
      ? providedBlockers
      : calibrationRecordReviewBlockers(result, calendarMature, outcomeReviewId);
  return {
    id: nullableString(evaluation.id),
    workspace_id: stringValue(evaluation.workspace_id, 'local'),
    thesis_id: stringValue(evaluation.thesis_id),
    outcome_review_id: outcomeReviewId,
    symbol: stringValue(evaluation.symbol),
    window_days: numberValue(evaluation.window_days),
    evaluation_start: nullableString(evaluation.evaluation_start),
    evaluation_end: nullableString(evaluation.evaluation_end),
    evaluated_at: nullableString(evaluation.evaluated_at),
    result,
    max_favorable_excursion: nullableNumber(
      evaluation.max_favorable_excursion,
    ),
    max_adverse_excursion: nullableNumber(evaluation.max_adverse_excursion),
    invalidated: booleanValue(evaluation.invalidated),
    warnings: stringList(evaluation.warnings ?? evaluation.warnings_json),
    evidence: recordValue(evaluation.evidence ?? evaluation.evidence_json),
    calendar_mature: calendarMature,
    can_record_review: recordReviewBlockers.length === 0,
    record_review_blockers: recordReviewBlockers,
    payload: recordValue(evaluation.payload ?? evaluation.payload_json),
  };
}

export function toMaturedEvaluationPreviewRowResponse(
  row: JsonRecord,
): MaturedEvaluationPreviewRowResponse {
  return {
    thesis_id: stringValue(row.thesis_id),
    symbol: stringValue(row.symbol),
    created_at: nullableString(row.created_at),
    window_days: numberValue(row.window_days),
    evaluation_start: nullableString(row.evaluation_start),
    evaluation_end: nullableString(row.evaluation_end),
    status: maturedPreviewStatusValue(row.status),
    reason: maturedReasonValue(row.reason),
    evaluation_id: nullableString(row.evaluation_id),
  };
}

export function toMaturedEvaluationApplyRowResponse(
  row: JsonRecord,
): MaturedEvaluationApplyRowResponse {
  return {
    thesis_id: stringValue(row.thesis_id),
    symbol: stringValue(row.symbol),
    created_at: nullableString(row.created_at),
    window_days: numberValue(row.window_days),
    evaluation_start: nullableString(row.evaluation_start),
    evaluation_end: nullableString(row.evaluation_end),
    status: maturedApplyStatusValue(row.status),
    reason: maturedReasonValue(row.reason),
    evaluation_id: nullableString(row.evaluation_id),
    result:
      row.result === null || row.result === undefined
        ? null
        : calibrationResultValue(row.result),
    warnings: stringList(row.warnings),
    message: nullableString(row.message),
  };
}

export function toProviderHealthResponse(
  row: JsonRecord,
): ProviderHealthResponse {
  return {
    id: nullableString(row.id),
    provider: stringValue(row.provider),
    component: nullableString(row.component),
    status: stringValue(row.status, 'unknown'),
    checked_at: nullableString(row.checked_at),
    latency_ms: nullableNumber(row.latency_ms),
    error_type: nullableString(row.error_type),
    error_message: nullableString(row.error_message),
    payload: recordValue(row.payload ?? row.payload_json),
  };
}

export function toLlmCallResponse(row: JsonRecord): LlmCallResponse {
  return {
    id: nullableString(row.id),
    workspace_id: nullableString(row.workspace_id),
    research_run_id: nullableString(row.research_run_id),
    thesis_id: nullableString(row.thesis_id),
    provider: stringValue(row.provider),
    model: stringValue(row.model),
    stage: nullableString(row.stage),
    agent: nullableString(row.agent),
    input_tokens: numberValue(row.input_tokens),
    output_tokens: numberValue(row.output_tokens),
    latency_ms: nullableNumber(row.latency_ms),
    status: stringValue(row.status, 'unknown'),
    error_type: nullableString(row.error_type),
    error_message: nullableString(row.error_message),
    created_at: nullableString(row.created_at),
    payload: recordValue(row.payload ?? row.payload_json),
  };
}

export function toDataFreshnessResponse(row: JsonRecord): DataFreshnessResponse {
  return {
    id: nullableString(row.id),
    workspace_id: nullableString(row.workspace_id),
    research_run_id: nullableString(row.research_run_id),
    symbol: nullableString(row.symbol),
    source: stringValue(row.source),
    source_timestamp: nullableString(row.source_timestamp),
    observed_timestamp: nullableString(row.observed_timestamp),
    age_seconds: nullableNumber(row.age_seconds),
    threshold_seconds: nullableNumber(row.threshold_seconds),
    status: stringValue(row.status, 'unknown'),
    payload: recordValue(row.payload ?? row.payload_json),
  };
}

export function toSignalResponse(signal: JsonRecord): SignalResponse {
  const payload = recordValue(signal.payload ?? signal.payload_json);
  const provenance = recordValue(signal.provenance ?? payload.provenance);
  return {
    id: nullableString(signal.id),
    workspace_id: stringValue(signal.workspace_id, 'local'),
    research_run_id: nullableString(
      signal.research_run_id ?? payload.research_run_id,
    ),
    signal_snapshot_id: nullableString(
      signal.signal_snapshot_id ?? payload.signal_snapshot_id,
    ),
    symbol: stringValue(signal.symbol ?? payload.symbol),
    signal_type: stringValue(signal.signal_type ?? payload.signal_type),
    direction: stringValue(signal.direction ?? payload.direction),
    confidence: nullableNumber(signal.confidence ?? payload.confidence),
    observed_at: nullableString(
      signal.observed_at ?? payload.observed_at ?? provenance.observed_at,
    ),
    source: stringValue(signal.source ?? payload.source ?? provenance.source),
    source_timestamp: nullableString(
      signal.source_timestamp ??
        payload.source_timestamp ??
        provenance.source_timestamp,
    ),
    summary: stringValue(signal.summary ?? payload.summary),
  };
}

export function toSignalDetailResponse(signal: JsonRecord): SignalDetailResponse {
  const base = toSignalResponse(signal);
  const payload = recordValue(signal.payload ?? signal.payload_json);
  const provenance = recordValue(signal.provenance ?? payload.provenance);
  const provenanceMetadata = recordValue(provenance.metadata);
  const evidence = recordValue(signal.evidence ?? payload.evidence);
  const watchConditions = recordValue(
    signal.watch_conditions ?? payload.watch_conditions,
  );
  const expiresAt = nullableString(signal.expires_at ?? payload.expires_at);
  const provenanceFreshness = stringValue(provenance.freshness);
  const inferredStale =
    provenanceFreshness === 'stale' ||
    (expiresAt ? Date.parse(expiresAt) < Date.now() : false);
  return {
    ...base,
    expires_at: expiresAt,
    evidence_lane: stringValue(signal.evidence_lane ?? payload.evidence_lane),
    evidence_category: stringValue(
      signal.evidence_category ?? payload.evidence_category,
    ),
    strength: nullableNumber(signal.strength ?? payload.strength),
    heuristic_confidence: nullableNumber(
      signal.heuristic_confidence ?? payload.heuristic_confidence,
    ),
    empirical_confidence: nullableNumber(
      signal.empirical_confidence ?? payload.empirical_confidence,
    ),
    empirical_confidence_sample_size: nullableNumber(
      signal.empirical_confidence_sample_size ??
        payload.empirical_confidence_sample_size,
    ),
    empirical_confidence_oos_sample_size: nullableNumber(
      signal.empirical_confidence_oos_sample_size ??
        payload.empirical_confidence_oos_sample_size,
    ),
    confidence_version: stringValue(
      signal.confidence_version ?? payload.confidence_version,
      'unknown',
    ),
    freshness_status: stringValue(
      signal.freshness_status ??
        payload.freshness_status ??
        provenance.freshness_status ??
        provenance.freshness,
      inferredStale ? 'stale' : 'unknown',
    ),
    is_stale: booleanValue(
      signal.is_stale ?? payload.is_stale ?? provenance.is_stale,
      inferredStale,
    ),
    age_seconds: nullableNumber(
      signal.age_seconds ??
        payload.age_seconds ??
        provenance.age_seconds ??
        provenance.freshness_seconds,
    ),
    staleness_reason: stringValue(
      signal.staleness_reason ??
        payload.staleness_reason ??
        provenance.staleness_reason ??
        provenanceMetadata.staleness_reason,
    ),
    research_run_id: nullableString(
      signal.research_run_id ?? payload.research_run_id,
    ),
    signal_snapshot_id: nullableString(
      signal.signal_snapshot_id ?? payload.signal_snapshot_id,
    ),
    provenance,
    evidence,
    watch_conditions: watchConditions,
    payload,
  };
}

export function toEvidenceBundleResponse(
  workspace: JournalRunWorkspaceResponse,
  signalDetails: SignalDetailResponse[],
): EvidenceBundleResponse {
  return {
    schema_version: 'evidence_bundle.v1',
    exported_at: new Date().toISOString(),
    workspace_id: workspace.run.workspace_id,
    research_run_id: workspace.run.run_id ?? workspace.run.id ?? '',
    symbol: workspace.run.symbol,
    source: 'api',
    run: workspace.run,
    events: workspace.events,
    snapshots: workspace.snapshots,
    debate: workspace.debate,
    thesis: workspace.thesis,
    scenarios: workspace.scenarios,
    signal_details: signalDetails,
    artifacts: workspace.artifacts,
  };
}

export function toWatchlistResponse(watchlist: JsonRecord): WatchlistResponse {
  return {
    id: nullableString(watchlist.id),
    workspace_id: stringValue(watchlist.workspace_id, 'local'),
    name: stringValue(watchlist.name),
    enabled: booleanValue(watchlist.enabled, true),
    created_at: nullableString(watchlist.created_at),
  };
}

export function toWatchlistItemResponse(
  item: JsonRecord,
): WatchlistItemResponse {
  return {
    id: nullableString(item.id),
    workspace_id: stringValue(item.workspace_id, 'local'),
    watchlist_id: stringValue(item.watchlist_id),
    item_type: stringValue(item.item_type, 'symbol'),
    symbol: nullableString(item.symbol),
    thesis_id: nullableString(item.thesis_id),
    setup_type: nullableString(item.setup_type),
    enabled: booleanValue(item.enabled, true),
    created_at: nullableString(item.created_at),
  };
}

export function toBriefResponse(brief: JsonRecord): BriefResponse {
  const payload = recordValue(brief.payload ?? brief.payload_json);
  const assetSummaries = uniqueBriefAssetSummaries(
    toBriefAssetSummaryResponses(brief.asset_summaries ?? payload.asset_summaries),
  );
  const thesisUpdates = uniqueBriefThesisUpdates(
    toBriefThesisUpdateResponses(brief.thesis_updates ?? payload.thesis_updates),
  );
  const watchlistChanges = uniqueStrings(
    firstStringList(brief.watchlist_changes, payload.watchlist_changes),
  );
  const topSetups = uniqueStrings(
    firstStringList(brief.top_setups, payload.top_setups),
  );
  const topRisks = uniqueStrings(
    firstStringList(brief.top_risks, payload.top_risks),
  );
  const memoryNotes = uniqueStrings(
    firstStringList(brief.memory_notes, payload.memory_notes),
  );
  return {
    id: nullableString(brief.id),
    workspace_id: stringValue(brief.workspace_id, 'local'),
    brief_date: nullableString(brief.brief_date),
    watchlist_name: nullableString(brief.watchlist_name),
    title: stringValue(brief.title),
    created_at: nullableString(brief.created_at),
    previous_brief_id: nullableString(brief.previous_brief_id),
    summary: stringValue(
      brief.summary ?? brief.action_summary ?? brief.regime_summary,
    ),
    key_points: uniqueStrings(
      firstStringList(
        brief.key_points,
        payload.key_points,
        [...watchlistChanges, ...topSetups, ...topRisks].slice(0, 8),
      ),
    ),
    thesis_ids: uniqueStrings(
      firstStringList(
        brief.thesis_ids,
        payload.thesis_ids,
        thesisUpdates.map((update) => update.thesis_id),
      ),
    ),
    signal_ids: uniqueStrings(
      firstStringList(brief.signal_ids, payload.signal_ids),
    ),
    asset_summaries: assetSummaries,
    thesis_updates: thesisUpdates,
    watchlist_changes: watchlistChanges,
    top_setups: topSetups,
    top_risks: topRisks,
    memory_notes: memoryNotes,
  };
}

export function toAlertResponse(alert: JsonRecord): AlertResponse {
  return {
    id: nullableString(alert.id),
    workspace_id: stringValue(alert.workspace_id, 'local'),
    alert_type: stringValue(alert.alert_type),
    symbol: stringValue(alert.symbol),
    thesis_id: nullableString(alert.thesis_id),
    watchlist_item_id: nullableString(alert.watchlist_item_id),
    trigger_key: nullableString(alert.trigger_key),
    created_at: nullableString(alert.created_at),
    read_at: nullableString(alert.read_at),
    message: stringValue(alert.message),
    payload: recordValue(alert.payload ?? alert.payload_json),
  };
}

function toThesisSummaryResponse(
  summary: JsonRecord,
  entryZone: string,
  invalidation: string,
  targetZones: string[],
): ThesisSummaryResponse {
  return {
    rating: stringValue(summary.rating, 'Hold'),
    direction: stringValue(summary.direction, 'watch'),
    confidence: nullableNumber(summary.confidence),
    market_type: stringValue(summary.market_type, 'spot'),
    action_summary: stringValue(summary.action_summary),
    entry_zone: entryZone,
    upside_catalyst: stringValue(summary.upside_catalyst),
    invalidation,
    target_zones: targetZones,
    key_reasons: stringList(summary.key_reasons),
    risks: stringList(summary.risks),
    spot_notes: stringValue(summary.spot_notes),
    perp_notes: stringValue(summary.perp_notes),
    missing_data: stringList(summary.missing_data),
    missing_data_reason_codes: stringList(summary.missing_data_reason_codes),
    data_quality: nullableNumber(summary.data_quality),
    data_quality_label: stringValue(summary.data_quality_label, 'unknown'),
    is_degraded: booleanValue(summary.is_degraded),
    degradation_reasons: stringList(summary.degradation_reasons),
  };
}

function toBriefAssetSummaryResponses(value: unknown): BriefAssetSummaryResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const asset = recordValue(item);
    return {
      symbol: stringValue(asset.symbol),
      current_price: nullableNumber(asset.current_price),
      market_regime: stringValue(asset.market_regime, 'unknown'),
      trend_direction: stringValue(asset.trend_direction, 'unknown'),
      volatility_regime: stringValue(asset.volatility_regime, 'unknown'),
      source: nullableString(asset.source),
      source_timestamp: nullableString(asset.source_timestamp),
      summary: stringValue(asset.summary),
      change_from_previous: nullableString(asset.change_from_previous),
    };
  });
}

function toBriefThesisUpdateResponses(value: unknown): BriefThesisUpdateResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const update = recordValue(item);
    return {
      thesis_id: stringValue(update.thesis_id),
      symbol: stringValue(update.symbol),
      direction: stringValue(update.direction, 'watch'),
      setup_type: stringValue(update.setup_type, 'unspecified'),
      confidence: nullableNumber(update.confidence),
      status: stringValue(update.status, 'review'),
      update: stringValue(update.update),
      invalidation_level: nullableString(update.invalidation_level),
      recent_alerts: stringList(update.recent_alerts),
    };
  });
}

function uniqueBriefAssetSummaries(
  assets: BriefAssetSummaryResponse[],
): BriefAssetSummaryResponse[] {
  const seen = new Set<string>();
  const deduped: BriefAssetSummaryResponse[] = [];
  for (const asset of assets) {
    const key = asset.symbol.trim().toUpperCase();
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    deduped.push(asset);
  }
  return deduped;
}

function uniqueBriefThesisUpdates(
  updates: BriefThesisUpdateResponse[],
): BriefThesisUpdateResponse[] {
  const seen = new Set<string>();
  const deduped: BriefThesisUpdateResponse[] = [];
  for (const update of updates) {
    const key =
      update.thesis_id ||
      [
        update.symbol,
        update.direction,
        update.setup_type,
        update.update,
      ].join(':');
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    deduped.push({
      ...update,
      recent_alerts: uniqueStrings(update.recent_alerts),
    });
  }
  return deduped;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function calibrationRecordReviewBlockers(
  result: CalibrationResult,
  calendarMature: boolean,
  outcomeReviewId: string | null,
): CalibrationRecordReviewBlocker[] {
  const blockers: CalibrationRecordReviewBlocker[] = [];
  if (!calendarMature) {
    blockers.push('incomplete_window');
  }
  if (result === 'unknown') {
    blockers.push('unknown_result');
  }
  if (outcomeReviewId) {
    blockers.push('review_already_recorded');
  }
  return blockers;
}

function calibrationResultValue(value: unknown): CalibrationResult {
  const result = stringValue(value, 'unknown');
  if (
    result === 'hit_target' ||
    result === 'invalidated' ||
    result === 'mixed' ||
    result === 'expired' ||
    result === 'unknown'
  ) {
    return result;
  }
  return 'unknown';
}

function calibrationBlockerValue(
  value: string,
): CalibrationRecordReviewBlocker | null {
  if (
    value === 'incomplete_window' ||
    value === 'unknown_result' ||
    value === 'review_already_recorded'
  ) {
    return value;
  }
  return null;
}

function maturedPreviewStatusValue(value: unknown): MaturedEvaluationPreviewStatus {
  const status = stringValue(value);
  if (
    status === 'candidate' ||
    status === 'existing' ||
    status === 'not_mature' ||
    status === 'invalid_thesis'
  ) {
    return status;
  }
  return 'invalid_thesis';
}

function maturedApplyStatusValue(value: unknown): MaturedEvaluationApplyStatus {
  const status = stringValue(value);
  if (
    status === 'created' ||
    status === 'existing' ||
    status === 'failed' ||
    status === 'skipped'
  ) {
    return status;
  }
  return 'skipped';
}

function maturedReasonValue(value: unknown): MaturedEvaluationReason | null {
  const reason = nullableString(value);
  if (
    reason === 'evaluation_already_exists' ||
    reason === 'window_not_closed' ||
    reason === 'missing_created_at' ||
    reason === 'invalid_created_at' ||
    reason === 'missing_symbol' ||
    reason === 'engine_error' ||
    reason === 'provider_error' ||
    reason === 'unknown_error' ||
    reason === 'max_batch_excluded'
  ) {
    return reason;
  }
  return null;
}

function isCalendarMature(evaluationEnd: string | null): boolean {
  if (!evaluationEnd) {
    return false;
  }
  const parsed = Date.parse(evaluationEnd);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const result = nullableString(value);
    if (result) {
      return result;
    }
  }
  return '';
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return nullableNumber(value) ?? fallback;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => nullableString(item))
      .filter((item): item is string => item !== null);
  }
  const text = nullableString(value);
  return text ? [text] : [];
}

function firstStringList(...values: unknown[]): string[] {
  for (const value of values) {
    const result = stringList(value);
    if (result.length > 0) {
      return result;
    }
  }
  return [];
}

function targetLevels(value: unknown): ThesisTargetLevelResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (typeof item === 'number') {
        return { label: `target_${index + 1}`, price: item };
      }
      const target = recordValue(item);
      const price = nullableNumber(target.price ?? target.level);
      if (price === null) {
        return null;
      }
      return {
        label: stringValue(target.label, `target_${index + 1}`),
        price,
      };
    })
    .filter((item): item is ThesisTargetLevelResponse => item !== null);
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function directionForRating(rating: string, fallback: string): string {
  const normalized = rating.trim().toLowerCase();
  if (normalized === 'buy' || normalized === 'overweight') {
    return 'long';
  }
  if (normalized === 'underweight') {
    return 'avoid';
  }
  if (normalized === 'sell') {
    return 'short';
  }
  if (normalized === 'hold') {
    return fallback === 'neutral' ? 'neutral' : 'watch';
  }
  return fallback || 'watch';
}
