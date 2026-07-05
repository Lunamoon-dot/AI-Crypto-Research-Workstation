/* Generated from the API OpenAPI contract. Do not edit by hand. */

import type {
  AlertResponse,
  CreateWorkspaceRequest,
  EvidenceBundleResponse,
  GenerateResearchContinuityRequest,
  GenerateResearchContinuityResponse,
  MarketChartInterval,
  RecordThesisDecisionRequest,
  RecordThesisReviewRequest,
  ResearchContinuityRepairPreviewRequest,
  ResearchContinuityRepairPreviewResponse,
  ResearchContinuityRepairRunDetailResponse,
  ResearchContinuityRepairRunResponse,
  ResearchContinuityRepairRunsResponse,
  ResearchContinuitySchedulerRunDueResponse,
  ResearchContinuitySchedulerStatusResponse,
  ResearchContinuityEntriesResponse,
  ResearchContinuityEntryDebugResponse,
  ResearchContinuityEntryDetailResponse,
  ResearchContinuityEntrySummaryResponse,
  ResearchContinuityStateEnvelopeResponse,
  ResearchContinuityTimelineResponse,
  ResearchContinuityWorkspaceSettingsResponse,
  RunResearchContinuityRepairRequest,
  ScenarioChartProjectionResponse,
  ScenarioChartSummaryResponse,
  ScenarioDecisionConditionRole,
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
  SignalCountResponse,
  SignalDetailResponse,
  SignalResponse,
  ThesisDecisionResponse,
  ThesisReviewResponse,
  UpdateResearchContinuitySettingsRequest,
  WorkspaceSummary,
} from '@/types';

export type JsonRecord = Record<string, unknown>;

export interface HealthResponse {
  status: 'ok';
  service: 'api';
  uptime_seconds: number;
}

export interface EngineRunRequest {
  run_id: string;
  workspace_id: string;
  symbol: string;
  asset_class: string;
  market_type: 'spot' | 'perp';
  analysis_date: string;
  analysts: Array<'market' | 'news' | 'social' | 'onchain'>;
  config_profile: string;
  exchange?: string | null;
  output_language?: string | null;
  dry_run: boolean;
  metadata: JsonRecord;
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
  output_language?: string | null;
  dry_run?: boolean;
  metadata?: JsonRecord;
};

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

export interface ResearchRunDeletionResponse {
  removed: boolean;
  workspace_id: string;
  requested_run_id: string;
  deleted_count: number;
  deleted_run_ids: string[];
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
  attempts: number;
  max_attempts: number;
  progress: JsonRecord;
  heartbeat_at: string | null;
  cancellation_requested_at: string | null;
  timeout_at: string | null;
  result_summary?: JsonRecord;
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
  cancellation_requested_at: string | null;
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
  recommended_action: string;
  market_bias: string;
  entry_plan_status: string;
  confirmation_condition: string;
  entry_zone: string;
  upside_catalyst: string;
  invalidation: string;
  target_zones: string[];
  profit_targets: string[];
  downside_objectives: string[];
  accumulation_zones: string[];
  indicator_thresholds: string[];
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

export type ThesisArtifactStatus = 'valid' | 'degraded' | 'blocked' | 'legacy';

export type ThesisTextSource = 'compiled' | 'legacy' | 'diagnostic' | 'missing';

export type ThesisValidationSeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface ThesisValidationIssueResponse {
  code: string;
  severity: ThesisValidationSeverity;
  message: string;
  field: string | null;
  source: string | null;
}

export interface CompiledThesisSectionResponse {
  key: string;
  title: string;
  text: string;
  source_fields: string[];
}

export interface ThesisResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  symbol: string;
  decision: string;
  recommended_action: string;
  recommended_action_label: string;
  market_bias: string;
  market_bias_label: string;
  entry_plan_status: string;
  entry_plan_status_label: string;
  analysis_mode: string;
  analysis_mode_label: string;
  thesis_status: string;
  thesis_status_label: string;
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
  profit_targets: string[];
  downside_objectives: string[];
  accumulation_zones: string[];
  indicator_thresholds: string[];
  thesis_text: string;
  summary: ThesisSummaryResponse;
  supporting_signal_ids: string[];
  contradicting_signal_ids: string[];
  stale_or_missing_data: string[];
  monitor_next: string[];
  artifact_status: ThesisArtifactStatus;
  thesis_text_source: ThesisTextSource;
  compiled_sections: CompiledThesisSectionResponse[];
  compiler_version: string | null;
  validation_issues: ThesisValidationIssueResponse[];
  degradation_reasons: string[];
  blocked_reasons: string[];
  candidate_schema_version: string | null;
}

export type ScenarioTriggerStatus =
  | 'watching'
  | 'near_trigger'
  | 'triggered'
  | 'stale'
  | 'missing_price'
  | 'needs_review';

export type ScenarioValidityStatus =
  | 'valid'
  | 'weakening'
  | 'invalidated'
  | 'expired'
  | 'overextended'
  | 'conflicted'
  | 'needs_review';

export type ScenarioRecommendedAction =
  | 'wait'
  | 'entry_long_now'
  | 'entry_short_now'
  | 'consider_long'
  | 'consider_short'
  | 'avoid'
  | 'reduce'
  | 'exit'
  | 'review';

export type ScenarioRecommendationAction = ScenarioRecommendedAction;
export type ScenarioRecommendationBias = 'long' | 'short' | 'neutral' | 'unknown';

export type ScenarioEvaluationReadiness =
  | 'ready'
  | 'missing_trigger'
  | 'missing_invalidation'
  | 'missing_time_window'
  | 'not_actionable'
  | 'needs_review';

export interface ScenarioEvidenceRef {
  type: string;
  id: string | null;
  field: string;
  label: string;
  supports: string;
}

export interface ScenarioDecisionCondition {
  id?: string;
  label?: string;
  role?: ScenarioDecisionConditionRole;
  type:
    | 'price_above'
    | 'price_below'
    | 'price_in_zone'
    | 'price_reclaim_level'
    | 'price_reject_level'
    | 'volume_above_average'
    | 'overextended_from_trigger';
  level?: number;
  zone_low?: number;
  zone_high?: number;
  timeframe?: string;
  candle_close_required?: boolean;
  lookback_periods?: number;
  multiplier?: number;
  threshold_pct?: number;
}

export interface ScenarioRecommendationGate {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'pending' | 'unknown';
  reason: string;
}

export interface ScenarioRecommendation {
  version: 'scenario_recommendation.v1';
  generated_at: string | null;
  source: 'llm' | 'derived_v1';
  action: ScenarioRecommendationAction;
  action_bias: ScenarioRecommendationBias;
  confidence: number;
  summary: string;
  thesis_link: string;
  required_conditions: ScenarioDecisionCondition[];
  invalidation_conditions: ScenarioDecisionCondition[];
  wait_for: string[];
  hard_gates: ScenarioRecommendationGate[];
  blocking_reasons: string[];
  risk_notes: string[];
  evidence_refs: ScenarioEvidenceRef[];
  valid_until: string | null;
  evaluation_readiness: ScenarioEvaluationReadiness;
  evaluation_window: {
    starts_at: string | null;
    ends_at: string | null;
    horizon: ScenarioHorizon;
    metric_hint: 'trigger_then_mfe_mae' | 'avoidance_check' | 'manual_review';
  };
}

export interface ScenarioEvaluationSnapshot {
  version: 'scenario_evaluation_snapshot.v1';
  readiness: ScenarioEvaluationReadiness;
  planned_evaluation_at: string | null;
  expected_horizon: ScenarioHorizon;
  trigger_observed: boolean | null;
  invalidation_observed: boolean | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  outcome: 'pending' | 'not_ready' | 'inconclusive';
  notes: string[];
}

export type ScenarioEvaluationResult =
  | 'hit'
  | 'invalidated'
  | 'missed'
  | 'mixed'
  | 'inconclusive';

export type ScenarioEvaluationDataQuality =
  | 'complete'
  | 'partial'
  | 'insufficient';

export type ScenarioEvaluationState =
  | 'not_ready'
  | 'pending'
  | 'due'
  | 'evaluated'
  | 'inconclusive';

export interface ScenarioEvaluationResponse {
  version: 'scenario_evaluation.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id: string;
  research_run_id: string | null;
  symbol: string;
  market_type: 'spot' | 'perp';
  horizon: string;
  evaluated_at: string;
  evaluation_window: {
    starts_at: string | null;
    ends_at: string | null;
  };
  result: ScenarioEvaluationResult;
  trigger_hit: boolean | null;
  invalidation_hit: boolean | null;
  target_hit: boolean | null;
  start_price: number | null;
  end_price: number | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  data_quality: ScenarioEvaluationDataQuality;
  warnings: string[];
  evidence: JsonRecord;
}

export interface ScenarioReliabilityProfileResponse {
  version: 'scenario_reliability_profile.v1';
  workspace_id: string;
  symbol: string | null;
  market_type: 'spot' | 'perp' | 'mixed';
  horizon: string;
  relation_to_thesis: string;
  action_bias: string;
  setup_type: string | null;
  sample_size: number;
  hit_rate: number | null;
  invalidation_rate: number | null;
  mixed_rate: number | null;
  inconclusive_rate: number | null;
  average_mfe: number | null;
  average_mae: number | null;
  data_quality_notes: string[];
  recent_lessons: string[];
  generated_at: string;
}

export interface TradePlaybookResponse {
  version: 'trade_playbook.v1';
  id: string;
  workspace_id: string;
  source_scenario_id: string;
  source_thesis_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: 'long' | 'short' | 'avoid';
  horizon: string;
  entry: {
    type: 'level' | 'zone' | 'condition';
    condition: string;
    level: number | null;
    zone_low: number | null;
    zone_high: number | null;
  };
  invalidation: {
    condition: string;
    level: number | null;
  };
  targets: Array<{
    label: string;
    level: number | null;
    rationale: string;
  }>;
  no_trade_conditions: string[];
  risk_context: string[];
  sizing_policy: {
    mode: 'manual_context_only';
    notes: string[];
  };
  evidence_refs: JsonRecord[];
  reliability_context: JsonRecord | null;
  compile_warnings: string[];
  compiler_version: 'playbook_compiler.v2';
  source_hashes: {
    scenario: string;
    decision_playbook: string;
    recommendation: string;
    runtime_decision: string;
  };
  status: 'current' | 'stale' | 'superseded' | 'unverifiable';
  stale_reasons: string[];
  created_at: string;
}

export interface PlaybookCompileReportResponse {
  version: 'playbook_compile_report.v1';
  eligible: boolean;
  playbook: TradePlaybookResponse | null;
  rejection_reasons: string[];
  warnings: string[];
}

export interface BacktestAssumptionSetResponse {
  version: 'backtest_assumption_set.v1';
  fee_bps: number;
  slippage_bps: number;
  fill_policy: 'touch' | 'close_confirmed' | 'next_open';
  sizing_policy: 'fixed_notional' | 'fixed_fraction';
  starting_equity: number;
  risk_fraction: number | null;
  timeframe: string;
  start_at: string;
  end_at: string;
}

export interface BacktestRunResponse {
  version: 'backtest_run.v1';
  id: string;
  workspace_id: string;
  playbook_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
  assumptions: BacktestAssumptionSetResponse;
  result: {
    total_return_pct: number | null;
    max_drawdown_pct: number | null;
    trade_count: number;
    win_rate: number | null;
    profit_factor: number | null;
  };
  warnings: string[];
  data_quality: 'complete' | 'partial' | 'insufficient';
  trade_events: BacktestTradeEventResponse[];
  created_at: string;
  completed_at: string | null;
}

export interface BacktestTradeEventResponse {
  version: 'backtest_trade_event.v1';
  id: string;
  workspace_id: string;
  backtest_run_id: string;
  event_index: number;
  event_type: string;
  event_time: string;
  price: number | null;
  details: JsonRecord;
}

export type DecimalString = string;

export interface SimulationPositionSize {
  mode: 'fixed_notional' | 'fixed_quantity';
  notional: DecimalString | null;
  quantity: DecimalString | null;
}

export interface SimulationRiskExit {
  type: 'hard_stop' | 'close_confirmation' | 'condition';
  level: DecimalString | null;
  condition: JsonRecord | null;
}

export interface SimulationThesisInvalidation {
  level: DecimalString | null;
  condition: JsonRecord | null;
}

export interface SimulationPartialTakeProfit {
  target_index: number;
  close_percent: DecimalString;
}

export interface SimulationAssumptions {
  version: 'simulation_assumptions.v1';
  fill_policy: 'touch' | 'next_open_after_trigger';
  gap_fill_policy: 'requested_price' | 'first_tradable_price' | 'reject_if_skipped';
  intrabar_policy: 'stop_first' | 'target_first' | 'ambiguous_warning';
  slippage_bps: DecimalString;
  fee_bps: DecimalString;
  position_size: SimulationPositionSize;
  risk_exit: SimulationRiskExit;
  thesis_invalidation: SimulationThesisInvalidation;
  partial_take_profit: SimulationPartialTakeProfit[];
  setup_expiry_at: string | null;
  position_max_duration_minutes: number | null;
  force_close_at_data_end: boolean;
}

export interface MarketDataSnapshot {
  version: 'market_data_snapshot.v1';
  provider: string;
  canonical_symbol: string;
  provider_symbol: string;
  timeframe: string;
  timezone: 'UTC';
  price_source: 'last' | 'mark' | 'index';
  dataset_version: string | null;
  dataset_hash: string | null;
  candle_close_policy: 'finalized_only';
  starts_at: string;
  ends_at: string | null;
}

export interface SimulationSampleIdentity {
  scenario_hash: string;
  playbook_hash: string;
  market_data_hash: string | null;
  evaluation_window_hash: string;
  assumptions_hash: string;
}

export interface SimulationEvaluationWindow {
  starts_at: string | null;
  ends_at: string | null;
  horizon: string;
}

export interface SimulationAnalysisSnapshot {
  scenario: JsonRecord;
  thesis: JsonRecord;
  scenario_recommendation: JsonRecord | null;
  decision_playbook: JsonRecord | null;
  chart_source_versions: JsonRecord | null;
}

export interface SimulationSourceHashes {
  scenario: string;
  decision_playbook: string | null;
  recommendation: string | null;
  trade_playbook: string;
}

export interface CreateSimulationRequest {
  mode?: 'replay' | 'forward';
  sample_kind?: 'forward_observation' | 'out_of_sample_replay' | 'in_sample_replay' | 'manual_experiment';
  fill_policy?: 'touch' | 'next_open_after_trigger';
  gap_fill_policy?: 'requested_price' | 'first_tradable_price' | 'reject_if_skipped';
  intrabar_policy?: 'stop_first' | 'target_first' | 'ambiguous_warning';
  fee_bps?: DecimalString;
  slippage_bps?: DecimalString;
  position_size?: SimulationPositionSize;
  partial_take_profit?: Array<{
    target_index: number;
    close_percent: DecimalString;
  }>;
  timeframe?: string;
  starts_at?: string;
  ends_at?: string | null;
  setup_expiry_at?: string | null;
  position_max_duration_minutes?: number | null;
  force_close_at_data_end?: boolean;
}

export interface CloseSimulationRequest {
  close_policy: 'manual_close' | 'abandon_inconclusive';
  price?: DecimalString;
  market_time?: string;
  reason?: string;
}

export interface SimulationRunResponse {
  version: 'simulation_run.v1';
  id: string;
  workspace_id: string;
  source_scenario_id: string;
  source_thesis_id: string;
  source_playbook_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  mode: 'replay' | 'forward';
  sample_kind: 'forward_observation' | 'out_of_sample_replay' | 'in_sample_replay' | 'manual_experiment';
  status: 'created' | 'waiting_for_trigger' | 'entry_triggered' | 'order_pending' | 'position_open' | 'completed' | 'cancelled' | 'failed';
  status_reason: string | null;
  aggregate_version: number;
  started_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  failure_reason: string | null;
  market_time: string | null;
  last_processed_candle_id: string | null;
  assumptions_hash: string;
  setup_expiry_at: string | null;
  position_max_duration_minutes: number | null;
  evaluation_window: SimulationEvaluationWindow;
  playbook_snapshot: TradePlaybookResponse;
  analysis_snapshot: SimulationAnalysisSnapshot;
  assumptions: SimulationAssumptions;
  market_data_snapshot: MarketDataSnapshot;
  sample_identity: SimulationSampleIdentity;
  source_integrity_status: 'verified' | 'failed' | 'unknown';
  source_drift_after_start: boolean;
  source_hashes: SimulationSourceHashes;
}

export interface PaperOrderResponse {
  version: 'paper_order.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  side: 'buy' | 'sell';
  intent: 'entry' | 'exit' | 'stop' | 'target' | 'reduce';
  status: 'created' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'expired';
  order_type: 'market' | 'limit' | 'stop';
  trigger_condition: JsonRecord;
  requested_price: DecimalString | null;
  filled_price: DecimalString | null;
  quantity: DecimalString;
  fee: DecimalString;
  created_at_market_time: string | null;
  filled_at_market_time: string | null;
  cancelled_at_market_time: string | null;
  reason_code: string;
}

export interface PaperPositionResponse {
  version: 'paper_position.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: 'long' | 'short';
  status: 'open' | 'partially_closed' | 'closed';
  quantity_opened: DecimalString;
  quantity_remaining: DecimalString;
  average_entry_price: DecimalString | null;
  realized_pnl: DecimalString | null;
  unrealized_pnl: DecimalString | null;
  realized_pnl_pct: DecimalString | null;
  unrealized_pnl_pct: DecimalString | null;
  opened_at_market_time: string | null;
  closed_at_market_time: string | null;
  close_reason: 'target' | 'stop' | 'position_timeout' | 'thesis_invalidation' | 'manual_close' | 'data_end' | null;
}

export interface ExecutionEventResponse {
  version: 'execution_event.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  source_scenario_id: string;
  event_type: string;
  sequence: number;
  aggregate_version: number;
  correlation_id: string;
  causation_event_id: string | null;
  idempotency_key: string;
  order_id: string | null;
  position_id: string | null;
  target_index: number | null;
  occurrence_index: number;
  market_time: string | null;
  recorded_at: string;
  price: DecimalString | null;
  quantity: DecimalString | null;
  reason_code: string;
  source_candle_id: string | null;
  payload: JsonRecord;
}

export interface SimulationOutcomeResponse {
  version: 'simulation_outcome.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_scenario_id: string;
  source_playbook_id: string;
  sample_kind: string;
  sample_identity: SimulationSampleIdentity;
  execution_result: 'win' | 'loss' | 'breakeven' | 'missed' | 'inconclusive';
  research_evaluation_status: 'pending' | 'rule_based' | 'llm_assisted';
  thesis_outcome: string | null;
  execution_quality: string;
  close_reason: string | null;
  realized_pnl: DecimalString | null;
  realized_pnl_pct: DecimalString | null;
  max_favorable_excursion: DecimalString | null;
  max_adverse_excursion: DecimalString | null;
  reliability_eligible: boolean;
  diagnosis_codes: string[];
  diagnosis_summary: string;
  warnings: string[];
  evaluated_at: string;
}

export interface SimulationDetailResponse extends SimulationRunResponse {
  orders: PaperOrderResponse[];
  position: PaperPositionResponse | null;
  outcome: SimulationOutcomeResponse | null;
  events: ExecutionEventResponse[];
}

export type ScenarioDecisionQueueItemType =
  | 'active_scenario'
  | 'evaluation_due'
  | 'evaluation_inconclusive'
  | 'reliability_changed'
  | 'playbook_candidate'
  | 'backtest_ready';

export interface ScenarioDecisionQueueItemResponse {
  version: 'scenario_decision_queue_item.v1';
  id: string;
  workspace_id: string;
  type: ScenarioDecisionQueueItemType;
  priority: number;
  title: string;
  summary: string;
  scenario_id: string | null;
  thesis_id: string | null;
  playbook_id: string | null;
  backtest_id: string | null;
  status: 'open' | 'snoozed' | 'resolved';
  blockers: string[];
  next_action: string;
  due_at: string | null;
  created_at: string;
}

export interface ScenarioDecisionWorkbenchResponse {
  version: 'scenario_decision_workspace.v1';
  workspace_id: string;
  generated_at: string;
  total_open: number;
  items: ScenarioDecisionQueueItemResponse[];
}

export interface ScenarioRuntimeDecision {
  version: 'scenario_runtime_decision.v1';
  evaluated_at: string;
  trigger_status: ScenarioTriggerStatus;
  validity_status: ScenarioValidityStatus;
  recommended_action: ScenarioRecommendedAction;
  confidence: number;
  matched_conditions: string[];
  failed_conditions: string[];
  blocking_reasons: string[];
  risk_notes: string[];
  evidence_refs: ScenarioEvidenceRef[];
  source: 'rule_engine_from_decision_playbook';
  playbook_source: 'llm' | 'derived_v1' | 'missing';
  status_reason: string;
  distance_to_trigger: number | null;
  llm_recommendation: JsonRecord | null;
  final_decision: {
    action: ScenarioRecommendedAction;
    reason: string;
    overrides: string[];
  };
}

export interface ScenarioResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  scenario_name: string;
  direction: string;
  thesis_impact: string;
  relation_to_thesis: 'supports' | 'challenges' | 'invalidates' | 'neutral';
  probability_band: string;
  suggested_user_action: string;
  condition: string;
  expected_behavior: string;
  invalidation: string;
  evidence: string[];
  watch_triggers: string[];
  impact_on_thesis: string;
  risk_map: string[];
  as_of: string;
  timeframe: string;
  horizon: ScenarioHorizon;
  timeframe_label: string | null;
  source: string[];
  status: string;
  status_reason: string;
  distance_to_trigger: number | null;
  last_evaluated_at: string | null;
  trigger_spec: JsonRecord | null;
  decision_playbook: JsonRecord | null;
  scenario_recommendation: ScenarioRecommendation | null;
  runtime_decision: ScenarioRuntimeDecision;
  evaluation_snapshot: ScenarioEvaluationSnapshot | null;
  latest_evaluation: ScenarioEvaluationResponse | null;
  evaluation_state: ScenarioEvaluationState;
  reliability_profile: ScenarioReliabilityProfileResponse | null;
  latest_playbook: TradePlaybookResponse | null;
  latest_backtest: BacktestRunResponse | null;
  payload: JsonRecord;
}

export type ScenarioHorizon = 'short_term' | 'mid_term' | 'long_term' | 'unknown';

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

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
};

export type ApiTransport = <T>(
  path: string,
  options: ApiRequestOptions,
) => Promise<T>;

export function createApiClient(request: ApiTransport) {
  return {
    getHealth: () => request<HealthResponse>('/health', {}),
    listWorkspaces: () => request<WorkspaceSummary[]>('/workspaces', {}),
    createWorkspace: (body: CreateWorkspaceRequest) =>
      request<WorkspaceSummary>('/workspaces', { method: 'POST', body }),
    getWorkspace: (id: string) =>
      request<WorkspaceSummary>(`/workspaces/${encodeURIComponent(id)}`, {}),
    deleteWorkspace: (id: string) =>
      request<WorkspaceSummary>(`/workspaces/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    listResearchRuns: (params: {
      symbol?: string;
      status?: string;
      limit?: number;
    }) =>
      request<ResearchRunResponse[]>('/research-runs', {
        query: {
          symbol: params.symbol,
          status: params.status,
          limit: params.limit ?? 50,
        },
      }),
    createResearchRun: (body: CreateResearchRunRequest) =>
      request<ResearchRunQueuedResponse>('/research-runs', {
        method: 'POST',
        body,
      }),
    getResearchRunWorkspace: (id: string) =>
      request<JournalRunWorkspaceResponse>(
        `/research-runs/${encodeURIComponent(id)}/workspace`,
        {},
      ),
    getResearchRunEvidenceBundle: (id: string) =>
      request<EvidenceBundleResponse>(
        `/research-runs/${encodeURIComponent(id)}/evidence-bundle`,
        {},
      ),
    getResearchRunContinuity: (id: string) =>
      request<ResearchContinuityEntrySummaryResponse | null>(
        `/research-runs/${encodeURIComponent(id)}/continuity`,
        {},
      ),
    generateResearchRunContinuity: (
      id: string,
      body: GenerateResearchContinuityRequest = {},
    ) =>
      request<GenerateResearchContinuityResponse>(
        `/research-runs/${encodeURIComponent(id)}/continuity`,
        { method: 'POST', body },
      ),
    getResearchContinuityState: (symbol: string) =>
      request<ResearchContinuityStateEnvelopeResponse>(
        `/research-continuity/symbols/${encodeURIComponent(symbol)}/state`,
        {},
      ),
    listResearchContinuityEntries: (
      symbol: string,
      params: { limit?: number } = {},
    ) =>
      request<ResearchContinuityEntriesResponse>(
        `/research-continuity/symbols/${encodeURIComponent(symbol)}/entries`,
        { query: { limit: params.limit ?? 20 } },
      ),
    getResearchContinuityTimeline: (
      symbol: string,
      params: {
        include_context?: boolean;
        item_type?: string;
        limit?: number;
        status?: string;
      } = {},
    ) =>
      request<ResearchContinuityTimelineResponse>(
        `/research-continuity/symbols/${encodeURIComponent(symbol)}/timeline`,
        {
          query: {
            include_context: params.include_context,
            item_type: params.item_type,
            limit: params.limit ?? 50,
            status: params.status,
          },
        },
      ),
    getResearchContinuitySettings: () =>
      request<ResearchContinuityWorkspaceSettingsResponse>(
        '/research-continuity/settings',
        {},
      ),
    updateResearchContinuitySettings: (
      body: UpdateResearchContinuitySettingsRequest,
    ) =>
      request<ResearchContinuityWorkspaceSettingsResponse>(
        '/research-continuity/settings',
        { method: 'PATCH', body },
      ),
    getResearchContinuityScheduler: () =>
      request<ResearchContinuitySchedulerStatusResponse>(
        '/research-continuity/scheduler',
        {},
      ),
    runDueResearchContinuityScheduler: () =>
      request<ResearchContinuitySchedulerRunDueResponse>(
        '/research-continuity/scheduler/run-due',
        { method: 'POST' },
      ),
    previewResearchContinuityRepair: (
      params: ResearchContinuityRepairPreviewRequest = {},
    ) =>
      request<ResearchContinuityRepairPreviewResponse>(
        '/research-continuity/repair/preview',
        {
          query: {
            symbol: params.symbol,
            from: params.from,
            to: params.to,
            case_types: params.case_types?.join(','),
            limit: params.limit ?? 25,
          },
        },
      ),
    runResearchContinuityRepair: (body: RunResearchContinuityRepairRequest) =>
      request<ResearchContinuityRepairRunResponse>(
        '/research-continuity/repair/run',
        { method: 'POST', body },
      ),
    listResearchContinuityRepairRuns: (
      params: {
        dry_run?: boolean;
        limit?: number;
        status?: string;
      } = {},
    ) =>
      request<ResearchContinuityRepairRunsResponse>(
        '/research-continuity/repair/runs',
        {
          query: {
            dry_run: params.dry_run,
            limit: params.limit ?? 20,
            status: params.status,
          },
        },
      ),
    getResearchContinuityRepairRun: (id: string) =>
      request<ResearchContinuityRepairRunDetailResponse>(
        `/research-continuity/repair/runs/${encodeURIComponent(id)}`,
        {},
      ),
    getResearchContinuityEntry: (id: string) =>
      request<ResearchContinuityEntryDetailResponse>(
        `/research-continuity/entries/${encodeURIComponent(id)}`,
        {},
      ),
    getResearchContinuityEntryDebug: (id: string) =>
      request<ResearchContinuityEntryDebugResponse>(
        `/research-continuity/entries/${encodeURIComponent(id)}/debug`,
        {},
      ),
    getJournalRunWorkspace: (id: string) =>
      request<JournalRunWorkspaceResponse>(
        `/journal/runs/${encodeURIComponent(id)}/workspace`,
        {},
      ),
    getJournalRunEvidenceBundle: (id: string) =>
      request<EvidenceBundleResponse>(
        `/journal/runs/${encodeURIComponent(id)}/evidence-bundle`,
        {},
      ),
    getResearchRun: (id: string) =>
      request<ResearchRunResponse>(`/research-runs/${encodeURIComponent(id)}`, {}),
    deleteWorkspaceResearchRunData: () =>
      request<ResearchRunDeletionResponse>('/research-runs', {
        method: 'DELETE',
      }),
    deleteResearchRun: (id: string) =>
      request<ResearchRunDeletionResponse>(`/research-runs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    listResearchRunEvents: (id: string) =>
      request<ResearchRunEventResponse[]>(
        `/research-runs/${encodeURIComponent(id)}/events`,
        {},
      ),
    getResearchRunSnapshots: (id: string) =>
      request<ResearchRunSnapshotsResponse>(
        `/research-runs/${encodeURIComponent(id)}/snapshots`,
        {},
      ),
    getResearchRunDebate: (id: string) =>
      request<ResearchRunDebateResponse>(
        `/research-runs/${encodeURIComponent(id)}/debate`,
        {},
      ),
    listSignals: (params: { symbol?: string; limit?: number }) =>
      request<SignalResponse[]>('/signals', {
        query: {
          symbol: params.symbol,
          limit: params.limit ?? 50,
        },
      }),
    getSignal: (id: string) =>
      request<SignalDetailResponse>(`/signals/${encodeURIComponent(id)}`, {}),
    countSignals: (params: { symbol?: string }) =>
      request<SignalCountResponse>('/signals/count', {
        query: { symbol: params.symbol },
      }),
    listTheses: (params: { limit?: number }) =>
      request<ThesisResponse[]>('/theses', {
        query: { limit: params.limit ?? 50 },
      }),
    getThesis: (id: string) =>
      request<ThesisResponse>(`/theses/${encodeURIComponent(id)}`, {}),
    getThesisScenarios: (id: string) =>
      request<ScenarioResponse[]>(
        `/theses/${encodeURIComponent(id)}/scenarios`,
        {},
      ),
    listScenarioEvaluations: (id: string) =>
      request<ScenarioEvaluationResponse[]>(
        `/scenarios/${encodeURIComponent(id)}/evaluations`,
        {},
      ),
    evaluateScenario: (id: string) =>
      request<ScenarioEvaluationResponse>(
        `/scenarios/${encodeURIComponent(id)}/evaluations`,
        { method: 'POST' },
      ),
    getScenarioEvaluation: (id: string) =>
      request<ScenarioEvaluationResponse>(
        `/scenario-evaluations/${encodeURIComponent(id)}`,
        {},
      ),
    listScenarioReliability: (params: {
      symbol?: string;
      market_type?: 'spot' | 'perp';
      horizon?: string;
      limit?: number;
    }) =>
      request<ScenarioReliabilityProfileResponse[]>('/scenario-reliability', {
        query: {
          symbol: params.symbol,
          market_type: params.market_type,
          horizon: params.horizon,
          limit: params.limit ?? 50,
        },
      }),
    getScenarioReliabilityForSymbol: (
      symbol: string,
      params: { market_type?: 'spot' | 'perp'; horizon?: string; limit?: number },
    ) =>
      request<ScenarioReliabilityProfileResponse[]>(
        `/scenario-reliability/${encodeURIComponent(symbol)}`,
        {
          query: {
            market_type: params.market_type,
            horizon: params.horizon,
            limit: params.limit ?? 50,
          },
        },
      ),
    rebuildScenarioReliability: (params: {
      symbol?: string;
      market_type?: 'spot' | 'perp';
      horizon?: string;
      limit?: number;
    } = {}) =>
      request<ScenarioReliabilityProfileResponse[]>('/scenario-reliability/rebuild', {
        method: 'POST',
        query: {
          symbol: params.symbol,
          market_type: params.market_type,
          horizon: params.horizon,
          limit: params.limit ?? 50,
        },
      }),
    compileScenarioPlaybook: (id: string) =>
      request<PlaybookCompileReportResponse>(
        `/scenarios/${encodeURIComponent(id)}/playbook`,
        { method: 'POST' },
      ),
    getScenarioLiveState: (scenarioId: string) =>
      request<ScenarioLiveStateResponse>(
        `/scenarios/${encodeURIComponent(scenarioId)}/live`,
        {},
      ),
    refreshScenarioLiveState: (scenarioId: string) =>
      request<ScenarioLiveStateResponse>(
        `/scenarios/${encodeURIComponent(scenarioId)}/live/refresh`,
        { method: 'POST' },
      ),
    listScenarioEvents: (
      scenarioId: string,
      params: { limit?: number } = {},
    ) =>
      request<ScenarioEventResponse[]>(
        `/scenarios/${encodeURIComponent(scenarioId)}/events`,
        { query: { limit: params.limit ?? 50 } },
      ),
    getScenarioChartProjection: (
      scenarioId: string,
      params: {
        interval?: MarketChartInterval;
        limit?: number;
        simulationId?: string | null;
      } = {},
    ) =>
      request<ScenarioChartProjectionResponse>(
        `/scenarios/${encodeURIComponent(scenarioId)}/chart`,
        {
          query: {
            interval: params.interval ?? '15m',
            limit: params.limit ?? 200,
            simulation_id: params.simulationId ?? undefined,
          },
        },
      ),
    getScenarioChartSummary: (scenarioId: string) =>
      request<ScenarioChartSummaryResponse>(
        `/scenarios/${encodeURIComponent(scenarioId)}/chart-summary`,
        {},
      ),
    getScenarioChartSummaries: (scenarioIds: string[]) =>
      request<ScenarioChartSummaryResponse[]>('/scenarios/chart-summaries', {
        method: 'POST',
        body: { scenario_ids: scenarioIds },
      }),
    listScenarioPlaybooks: (id: string) =>
      request<TradePlaybookResponse[]>(
        `/scenarios/${encodeURIComponent(id)}/playbook`,
        {},
      ),
    getPlaybook: (id: string) =>
      request<TradePlaybookResponse>(`/playbooks/${encodeURIComponent(id)}`, {}),
    createPlaybookBacktest: (id: string, body: Partial<BacktestAssumptionSetResponse>) =>
      request<BacktestRunResponse>(
        `/playbooks/${encodeURIComponent(id)}/backtests`,
        { method: 'POST', body },
      ),
    listPlaybookBacktests: (id: string) =>
      request<BacktestRunResponse[]>(
        `/playbooks/${encodeURIComponent(id)}/backtests`,
        {},
      ),
    getBacktest: (id: string) =>
      request<BacktestRunResponse>(`/backtests/${encodeURIComponent(id)}`, {}),
    listBacktestTradeEvents: (id: string) =>
      request<BacktestTradeEventResponse[]>(
        `/backtests/${encodeURIComponent(id)}/events`,
        {},
      ),
    createPlaybookSimulation: (id: string, body: CreateSimulationRequest) =>
      request<SimulationDetailResponse>(
        `/playbooks/${encodeURIComponent(id)}/simulations`,
        { method: 'POST', body },
      ),
    listPlaybookSimulations: (id: string) =>
      request<SimulationRunResponse[]>(
        `/playbooks/${encodeURIComponent(id)}/simulations`,
        {},
      ),
    getSimulation: (id: string) =>
      request<SimulationDetailResponse>(`/simulations/${encodeURIComponent(id)}`, {}),
    refreshSimulation: (id: string) =>
      request<SimulationDetailResponse>(
        `/simulations/${encodeURIComponent(id)}/refresh`,
        { method: 'POST' },
      ),
    cancelSimulation: (id: string) =>
      request<SimulationDetailResponse>(
        `/simulations/${encodeURIComponent(id)}/cancel`,
        { method: 'POST' },
      ),
    closeSimulation: (id: string, body: CloseSimulationRequest) =>
      request<SimulationDetailResponse>(
        `/simulations/${encodeURIComponent(id)}/close`,
        { method: 'POST', body },
      ),
    listSimulationEvents: (id: string) =>
      request<ExecutionEventResponse[]>(
        `/simulations/${encodeURIComponent(id)}/events`,
        {},
      ),
    listSimulationOrders: (id: string) =>
      request<PaperOrderResponse[]>(
        `/simulations/${encodeURIComponent(id)}/orders`,
        {},
      ),
    getSimulationPosition: (id: string) =>
      request<PaperPositionResponse | null>(
        `/simulations/${encodeURIComponent(id)}/position`,
        {},
      ),
    getSimulationOutcome: (id: string) =>
      request<SimulationOutcomeResponse | null>(
        `/simulations/${encodeURIComponent(id)}/outcome`,
        {},
      ),
    getScenarioDecisionWorkbench: () =>
      request<ScenarioDecisionWorkbenchResponse>(
        '/scenario-decision/workbench',
        {},
      ),
    resolveScenarioDecisionItem: (id: string) =>
      request<ScenarioDecisionQueueItemResponse>(
        `/scenario-decision/items/${encodeURIComponent(id)}/resolve`,
        { method: 'POST', body: {} },
      ),
    snoozeScenarioDecisionItem: (id: string, body: { due_at: string }) =>
      request<ScenarioDecisionQueueItemResponse>(
        `/scenario-decision/items/${encodeURIComponent(id)}/snooze`,
        { method: 'POST', body },
      ),
    recordThesisDecision: (
      id: string,
      body: RecordThesisDecisionRequest,
    ) =>
      request<ThesisDecisionResponse>(
        `/theses/${encodeURIComponent(id)}/decision`,
        { method: 'POST', body },
      ),
    recordThesisReview: (id: string, body: RecordThesisReviewRequest) =>
      request<ThesisReviewResponse>(
        `/theses/${encodeURIComponent(id)}/review`,
        { method: 'POST', body },
      ),
    listAlerts: (params: {
      symbol?: string;
      thesis_id?: string;
      unread?: boolean;
      limit?: number;
    }) =>
      request<AlertResponse[]>('/alerts', {
        query: {
          symbol: params.symbol,
          thesis_id: params.thesis_id,
          unread: params.unread,
          limit: params.limit ?? 50,
        },
      }),
    markAlertRead: (id: string) =>
      request<AlertResponse>(`/alerts/${encodeURIComponent(id)}/read`, {
        method: 'POST',
      }),
    getJobStatus: (id: string) =>
      request<JobStatusResponse>(`/jobs/${encodeURIComponent(id)}`, {}),
    cancelJob: (id: string) =>
      request<JobStatusResponse>(`/jobs/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
      }),
  };
}
