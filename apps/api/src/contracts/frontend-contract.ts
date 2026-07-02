import { JsonRecord } from '../database/journal.types';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionPlaybook,
  ScenarioEvaluationReadiness,
  ScenarioEvaluationSnapshot,
  ScenarioEvidenceRef,
  ScenarioRecommendation,
  ScenarioRuntimeDecision,
} from '../scenarios/scenario-decision.types';
import type {
  ScenarioEvaluationResponse,
  ScenarioEvaluationState,
} from '../scenarios/scenario-evaluation.types';
import type { ScenarioReliabilityProfileResponse } from '../scenarios/scenario-reliability.types';
import type {
  PlaybookCompileReportResponse,
  TradePlaybookResponse,
} from '../playbooks/playbook.types';
import type {
  BacktestRunResponse,
  BacktestTradeEventResponse,
} from '../backtests/backtest.types';
import type {
  ScenarioDecisionQueueItemResponse,
  ScenarioDecisionWorkbenchResponse,
} from '../scenario-decision/scenario-decision.types';
import { researchItemTextList } from './research-evidence';
import {
  decisionConditionFromRecord,
  derivePriceConditionFromText,
  normalizeScenarioConditionText,
  priceTriggerSpecFromText,
} from '../scenarios/scenario-text-conditions';

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
  stability_guard: JsonRecord;
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

export interface ScenarioResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  scenario_name: string;
  direction: string;
  thesis_impact: string;
  relation_to_thesis: ScenarioRelationToThesis;
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
  decision_playbook: ScenarioDecisionPlaybook | null;
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
export type ScenarioRelationToThesis = 'supports' | 'challenges' | 'invalidates' | 'neutral';

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
  heuristic_strength: number | null;
  confidence_semantics: 'heuristic' | 'empirical' | 'unavailable';
  availability: 'valid' | 'missing' | 'stale' | 'parse_failed' | 'error' | 'unknown';
  display_name: string;
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
  empirical_probability: number | null;
  empirical_probability_sample_size: number | null;
  empirical_probability_oos_sample_size: number | null;
  source_note: string | null;
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

export interface AlertResponse {
  id: string | null;
  workspace_id: string;
  alert_type: string;
  symbol: string;
  thesis_id: string | null;
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
  | 'provider';

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
  active_scenarios: ScenarioResponse[];
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
    cancellation_requested_at: nullableString(run.cancellation_requested_at),
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
  const identifiers = [
    event.payload.agent_name,
    event.payload.analyst_name,
    event.payload.graph_node,
    event.payload.stage,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  if (identifiers.length > 0) {
    return identifiers.some((value) =>
      aliases.some((alias) => textMatchesAlias(value, alias)),
    );
  }
  return typeof event.message === 'string'
    ? aliases.some((alias) => textMatchesAlias(event.message, alias))
    : false;
}

function textMatchesAlias(value: string, alias: string): boolean {
  const normalizedValue = normalizeAliasText(value);
  const normalizedAlias = normalizeAliasText(alias);
  if (!normalizedValue || !normalizedAlias) {
    return false;
  }
  return normalizedValue === normalizedAlias || normalizedValue.includes(normalizedAlias);
}

function normalizeAliasText(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized ? ` ${normalized} ` : '';
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
  const monitorNext = researchItemTextList(thesis.monitor_next);
  const entryZone = firstString(thesis.entry_zone, summary.entry_zone);
  const confirmationCondition = firstString(
    thesis.confirmation_condition,
    summary.confirmation_condition,
  );
  const invalidation = firstString(
    thesis.invalidation_level,
    thesis.invalidation,
    summary.invalidation,
  );
  const targets = firstStringList(thesis.target_zones, summary.target_zones);
  const profitTargets = firstStringList(thesis.profit_targets, summary.profit_targets);
  const downsideObjectives = firstStringList(
    thesis.downside_objectives,
    summary.downside_objectives,
  );
  const accumulationZones = firstStringList(
    thesis.accumulation_zones,
    summary.accumulation_zones,
  );
  const indicatorThresholds = firstStringList(
    thesis.indicator_thresholds,
    summary.indicator_thresholds,
  );
  const summaryResponse = toThesisSummaryResponse(
    summary,
    entryZone,
    confirmationCondition,
    invalidation,
    targets,
    profitTargets,
    downsideObjectives,
    accumulationZones,
    indicatorThresholds,
  );
  const direction = directionForRating(
    summaryResponse.rating,
    stringValue(thesis.direction, 'watch'),
  );
  summaryResponse.direction = directionForRating(
    summaryResponse.rating,
    summaryResponse.direction,
  );
  const decisionBrief = normalizeThesisDecisionBrief({
    direction,
    entryPlanStatus: summaryResponse.entry_plan_status,
    entryZone,
    marketBias: summaryResponse.market_bias,
    rating: summaryResponse.rating,
    recommendedAction: summaryResponse.recommended_action,
    researchRunId: nullableString(thesis.research_run_id),
    status: stringValue(thesis.status),
  });
  summaryResponse.recommended_action = decisionBrief.recommended_action;
  summaryResponse.market_bias = decisionBrief.market_bias;
  summaryResponse.entry_plan_status = decisionBrief.entry_plan_status;
  return {
    id: nullableString(thesis.id),
    workspace_id: stringValue(thesis.workspace_id, 'local'),
    research_run_id: nullableString(thesis.research_run_id),
    symbol: stringValue(thesis.symbol),
    decision: decisionBrief.decision,
    recommended_action: decisionBrief.recommended_action,
    recommended_action_label: decisionBrief.recommended_action_label,
    market_bias: decisionBrief.market_bias,
    market_bias_label: decisionBrief.market_bias_label,
    entry_plan_status: decisionBrief.entry_plan_status,
    entry_plan_status_label: decisionBrief.entry_plan_status_label,
    analysis_mode: decisionBrief.analysis_mode,
    analysis_mode_label: decisionBrief.analysis_mode_label,
    thesis_status: decisionBrief.thesis_status,
    thesis_status_label: decisionBrief.thesis_status_label,
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
    confirmation_condition: confirmationCondition,
    invalidation_level: invalidation,
    target_zones: targets,
    profit_targets: profitTargets,
    downside_objectives: downsideObjectives,
    accumulation_zones: accumulationZones,
    indicator_thresholds: indicatorThresholds,
    thesis_text: stringValue(thesis.thesis_text),
    summary: summaryResponse,
    supporting_signal_ids: stringList(thesis.supporting_signal_ids),
    contradicting_signal_ids: stringList(thesis.contradicting_signal_ids),
    stale_or_missing_data: stringList(thesis.stale_or_missing_data),
    monitor_next:
      monitorNext.length > 0 ? monitorNext : researchItemTextList(summary.monitor_next),
    artifact_status: thesisArtifactStatusValue(thesis.artifact_status),
    thesis_text_source: thesisTextSourceValue(thesis.thesis_text_source),
    compiled_sections: compiledThesisSectionResponses(
      thesis.compiled_sections ?? evidence.compiled_sections,
    ),
    compiler_version: nullableString(thesis.compiler_version ?? evidence.compiler_version),
    validation_issues: thesisValidationIssueResponses(thesis.validation_issues),
    degradation_reasons: stringList(thesis.degradation_reasons),
    blocked_reasons: stringList(thesis.blocked_reasons),
    candidate_schema_version: nullableString(thesis.candidate_schema_version),
  };
}

function thesisArtifactStatusValue(value: unknown): ThesisArtifactStatus {
  if (value === 'valid' || value === 'degraded' || value === 'blocked') {
    return value;
  }
  return 'legacy';
}

function thesisTextSourceValue(value: unknown): ThesisTextSource {
  if (
    value === 'compiled' ||
    value === 'legacy' ||
    value === 'diagnostic' ||
    value === 'missing'
  ) {
    return value;
  }
  return 'legacy';
}

function compiledThesisSectionResponses(value: unknown): CompiledThesisSectionResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const section = recordValue(item);
      return {
        key: stringValue(section.key),
        title: stringValue(section.title),
        text: stringValue(section.text),
        source_fields: stringList(section.source_fields),
      };
    })
    .filter((section) => section.key && section.title && section.text);
}

function thesisValidationIssueResponses(value: unknown): ThesisValidationIssueResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const issue = recordValue(item);
    return {
      code: stringValue(issue.code),
      severity: thesisValidationSeverityValue(issue.severity),
      message: stringValue(issue.message),
      field: nullableString(issue.field),
      source: nullableString(issue.source),
    };
  }).filter((issue) => issue.code || issue.message);
}

function thesisValidationSeverityValue(value: unknown): ThesisValidationSeverity {
  if (value === 'info' || value === 'warning' || value === 'error' || value === 'blocker') {
    return value;
  }
  return 'info';
}

export function toScenarioResponse(
  scenario: JsonRecord,
  thesis?: JsonRecord | null,
): ScenarioResponse {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const legacyMeta = legacyScenarioMeta(payload, scenario);
  const horizon = scenarioHorizonValue(scenario.horizon ?? payload.horizon);
  const decisionPlaybook = scenarioDecisionPlaybookValue(
    scenario.decision_playbook ?? payload.decision_playbook,
  );
  const rawScenarioRecommendation = scenarioRecommendationValue(
    scenario.scenario_recommendation ?? payload.scenario_recommendation,
  );
  const latestEvaluation = scenarioEvaluationResponseValue(
    scenario.latest_evaluation ?? payload.latest_evaluation,
  );
  const scenarioName = firstScenarioString(scenario.scenario_name, payload.scenario_name, payload.scenarioName);
  const direction = firstScenarioString(scenario.direction, payload.direction, payload.scenario_direction);
  const thesisImpact = firstScenarioString(scenario.thesis_impact, payload.thesis_impact);
  const suggestedUserAction = cleanScenarioAction(
    firstScenarioString(scenario.suggested_user_action, payload.suggested_user_action, payload.suggested_action),
  );
  const condition = cleanScenarioBlock(
    firstScenarioString(scenario.condition, payload.condition),
  );
  const expectedBehavior = cleanScenarioBlock(
    firstScenarioString(
      scenario.expected_behavior,
      scenario.expected_market_behavior,
      payload.expected_behavior,
      payload.expected_market_behavior,
    ),
  );
  const impactOnThesis = firstScenarioString(scenario.impact_on_thesis, payload.impact_on_thesis);
  const riskMap = firstScenarioStringList(scenario.risk_map, payload.risk_map, payload.risk_factors);
  const watchTriggers = firstScenarioStringList(
    scenario.watch_triggers,
    payload.watch_triggers,
    payload.watchTriggers,
    payload.watch,
  );
  const asOf = firstScenarioString(
    scenario.as_of,
    payload.as_of,
    payload.asOf,
    payload.source_timestamp,
    legacyMeta.as_of,
  );
  const timeframe = firstScenarioString(
    scenario.timeframe,
    payload.timeframe,
    payload.time_frame,
    legacyMeta.timeframe,
  );
  const source = firstScenarioStringList(
    scenario.source,
    payload.source,
    payload.sources,
    payload.source_artifacts,
    legacyMeta.source,
  );
  const triggerSpec = nullableRecord(scenario.trigger_spec ?? payload.trigger_spec)
    ?? priceTriggerSpecFromText([condition, ...watchTriggers, expectedBehavior]);
  const scenarioRecommendation = rawScenarioRecommendation ?? derivedScenarioRecommendation({
    scenario,
    horizon,
    scenarioName,
    direction,
    thesisImpact,
    suggestedUserAction,
    condition,
    expectedBehavior,
    invalidation: firstScenarioString(scenario.invalidation, payload.invalidation),
    evidence: firstScenarioStringList(scenario.evidence, payload.evidence, payload.evidence_items),
    watchTriggers,
    impactOnThesis,
    riskMap,
    asOf,
    timeframe,
    triggerSpec,
  });
  return {
    id: nullableString(scenario.id),
    workspace_id: stringValue(scenario.workspace_id, 'local'),
    thesis_id: stringValue(scenario.thesis_id),
    scenario_name: scenarioName,
    direction,
    thesis_impact: thesisImpact,
    relation_to_thesis: scenarioRelationToThesisValue(
      firstScenarioString(
        scenario.relation_to_thesis,
        payload.relation_to_thesis,
        payload.relationToThesis,
      ),
      {
        thesis,
        branchType: firstScenarioString(payload.branchType, payload.branch_type),
        direction,
        thesisImpact,
        scenarioName,
        condition,
        expectedBehavior,
        impactOnThesis,
        suggestedUserAction,
        riskMap,
      },
    ),
    probability_band: firstScenarioString(scenario.probability_band, payload.probability_band),
    suggested_user_action: suggestedUserAction,
    condition,
    expected_behavior: expectedBehavior,
    invalidation: firstScenarioString(scenario.invalidation, payload.invalidation),
    evidence: firstScenarioStringList(scenario.evidence, payload.evidence, payload.evidence_items),
    watch_triggers: watchTriggers,
    impact_on_thesis: impactOnThesis,
    risk_map: riskMap,
    as_of: asOf,
    timeframe,
    horizon,
    timeframe_label: nullableString(scenario.timeframe_label ?? payload.timeframe_label),
    source,
    status: firstScenarioString(scenario.status, payload.status, 'watching'),
    status_reason: firstScenarioString(scenario.status_reason, payload.status_reason),
    distance_to_trigger: nullableNumber(scenario.distance_to_trigger ?? payload.distance_to_trigger),
    last_evaluated_at: nullableString(scenario.last_evaluated_at ?? payload.last_evaluated_at),
    trigger_spec: triggerSpec,
    decision_playbook: decisionPlaybook,
    scenario_recommendation: scenarioRecommendation,
    runtime_decision: scenarioRuntimeDecisionValue(
      scenario.runtime_decision ?? payload.runtime_decision,
    ),
    evaluation_snapshot: scenarioEvaluationSnapshotValue(
      scenario.evaluation_snapshot ?? payload.evaluation_snapshot,
      scenarioRecommendation,
      horizon,
    ),
    latest_evaluation: latestEvaluation,
    evaluation_state: scenarioEvaluationState(
      latestEvaluation,
      scenarioEvaluationSnapshotValue(
        scenario.evaluation_snapshot ?? payload.evaluation_snapshot,
        scenarioRecommendation,
        horizon,
      ),
    ),
    reliability_profile: scenarioReliabilityProfileValue(
      scenario.reliability_profile ?? payload.reliability_profile,
    ),
    latest_playbook: tradePlaybookValue(
      scenario.latest_playbook ?? payload.latest_playbook,
    ),
    latest_backtest: backtestRunValue(
      scenario.latest_backtest ?? payload.latest_backtest,
    ),
    payload,
  };
}

function scenarioHorizonValue(value: unknown): ScenarioHorizon {
  if (value === 'short_term' || value === 'mid_term' || value === 'long_term') {
    return value;
  }
  return 'unknown';
}

export function toScenarioEvaluationResponse(
  value: JsonRecord,
): ScenarioEvaluationResponse {
  return {
    version: 'scenario_evaluation.v1',
    id: stringValue(value.id),
    workspace_id: stringValue(value.workspace_id, 'local'),
    scenario_id: stringValue(value.scenario_id),
    thesis_id: stringValue(value.thesis_id),
    research_run_id: nullableString(value.research_run_id),
    symbol: stringValue(value.symbol),
    market_type: marketTypeValue(value.market_type),
    horizon: stringValue(value.horizon, 'unknown'),
    evaluated_at: stringValue(value.evaluated_at, new Date().toISOString()),
    evaluation_window: scenarioEvaluationWindowValue(value.evaluation_window),
    result: scenarioEvaluationResultValue(value.result),
    trigger_hit: nullableBoolean(value.trigger_hit),
    invalidation_hit: nullableBoolean(value.invalidation_hit),
    target_hit: nullableBoolean(value.target_hit),
    start_price: nullableNumber(value.start_price),
    end_price: nullableNumber(value.end_price),
    max_favorable_excursion: nullableNumber(value.max_favorable_excursion),
    max_adverse_excursion: nullableNumber(value.max_adverse_excursion),
    data_quality: scenarioEvaluationDataQualityValue(value.data_quality),
    warnings: stringList(value.warnings ?? value.warnings_json),
    evidence: recordValue(value.evidence ?? value.evidence_json),
  };
}

export function toScenarioReliabilityProfileResponse(
  value: JsonRecord,
): ScenarioReliabilityProfileResponse {
  return {
    version: 'scenario_reliability_profile.v1',
    workspace_id: stringValue(value.workspace_id, 'local'),
    symbol: nullableString(value.symbol),
    market_type: reliabilityMarketTypeValue(value.market_type),
    horizon: stringValue(value.horizon, 'unknown'),
    relation_to_thesis: stringValue(value.relation_to_thesis, 'unknown'),
    action_bias: stringValue(value.action_bias, 'unknown'),
    setup_type: nullableString(value.setup_type),
    sample_size: Math.max(0, Math.trunc(numberValue(value.sample_size, 0))),
    hit_rate: nullableNumber(value.hit_rate),
    invalidation_rate: nullableNumber(value.invalidation_rate),
    mixed_rate: nullableNumber(value.mixed_rate),
    inconclusive_rate: nullableNumber(value.inconclusive_rate),
    average_mfe: nullableNumber(value.average_mfe),
    average_mae: nullableNumber(value.average_mae),
    data_quality_notes: stringList(value.data_quality_notes),
    recent_lessons: stringList(value.recent_lessons),
    generated_at: stringValue(value.generated_at, new Date().toISOString()),
  };
}

export function toTradePlaybookResponse(value: JsonRecord): TradePlaybookResponse {
  const entry = recordValue(value.entry);
  const invalidation = recordValue(value.invalidation);
  const sizingPolicy = recordValue(value.sizing_policy);
  return {
    version: 'trade_playbook.v1',
    id: stringValue(value.id),
    workspace_id: stringValue(value.workspace_id, 'local'),
    source_scenario_id: stringValue(value.source_scenario_id),
    source_thesis_id: stringValue(value.source_thesis_id),
    symbol: stringValue(value.symbol),
    market_type: marketTypeValue(value.market_type),
    direction: playbookDirectionValue(value.direction),
    horizon: stringValue(value.horizon, 'unknown'),
    entry: {
      type: playbookEntryTypeValue(entry.type),
      condition: stringValue(entry.condition),
      level: nullableNumber(entry.level),
      zone_low: nullableNumber(entry.zone_low),
      zone_high: nullableNumber(entry.zone_high),
    },
    invalidation: {
      condition: stringValue(invalidation.condition),
      level: nullableNumber(invalidation.level),
    },
    targets: arrayRecords(value.targets).map((target) => ({
      label: stringValue(target.label),
      level: nullableNumber(target.level),
      rationale: stringValue(target.rationale),
    })),
    no_trade_conditions: stringList(value.no_trade_conditions),
    risk_context: stringList(value.risk_context),
    sizing_policy: {
      mode: 'manual_context_only',
      notes: stringList(sizingPolicy.notes),
    },
    evidence_refs: arrayRecords(value.evidence_refs),
    reliability_context: nullableRecord(value.reliability_context),
    compile_warnings: stringList(value.compile_warnings),
    created_at: stringValue(value.created_at, new Date().toISOString()),
  };
}

export function toPlaybookCompileReportResponse(
  value: JsonRecord,
): PlaybookCompileReportResponse {
  const playbook = tradePlaybookValue(value.playbook);
  return {
    version: 'playbook_compile_report.v1',
    eligible: booleanValue(value.eligible, Boolean(playbook)),
    playbook,
    rejection_reasons: stringList(value.rejection_reasons),
    warnings: stringList(value.warnings),
  };
}

export function toBacktestRunResponse(value: JsonRecord): BacktestRunResponse {
  const assumptions = recordValue(value.assumptions);
  const result = recordValue(value.result);
  return {
    version: 'backtest_run.v1',
    id: stringValue(value.id),
    workspace_id: stringValue(value.workspace_id, 'local'),
    playbook_id: stringValue(value.playbook_id),
    status: backtestStatusValue(value.status),
    assumptions: {
      version: 'backtest_assumption_set.v1',
      fee_bps: numberValue(assumptions.fee_bps, 0),
      slippage_bps: numberValue(assumptions.slippage_bps, 0),
      fill_policy: backtestFillPolicyValue(assumptions.fill_policy),
      sizing_policy: backtestSizingPolicyValue(assumptions.sizing_policy),
      starting_equity: numberValue(assumptions.starting_equity, 10_000),
      risk_fraction: nullableNumber(assumptions.risk_fraction),
      timeframe: stringValue(assumptions.timeframe, '1d'),
      start_at: stringValue(assumptions.start_at),
      end_at: stringValue(assumptions.end_at),
    },
    result: {
      total_return_pct: nullableNumber(result.total_return_pct),
      max_drawdown_pct: nullableNumber(result.max_drawdown_pct),
      trade_count: Math.max(0, Math.trunc(numberValue(result.trade_count, 0))),
      win_rate: nullableNumber(result.win_rate),
      profit_factor: nullableNumber(result.profit_factor),
    },
    warnings: stringList(value.warnings ?? value.warnings_json),
    data_quality: backtestDataQualityValue(value.data_quality),
    trade_events: arrayRecords(value.trade_events).map(toBacktestTradeEventResponse),
    created_at: stringValue(value.created_at, new Date().toISOString()),
    completed_at: nullableString(value.completed_at),
  };
}

export function toBacktestTradeEventResponse(
  value: JsonRecord,
): BacktestTradeEventResponse {
  const details = { ...value };
  delete details.version;
  delete details.id;
  delete details.workspace_id;
  delete details.backtest_run_id;
  delete details.event_index;
  delete details.event_type;
  delete details.event_time;
  delete details.price;
  return {
    version: 'backtest_trade_event.v1',
    id: stringValue(value.id),
    workspace_id: stringValue(value.workspace_id, 'local'),
    backtest_run_id: stringValue(value.backtest_run_id),
    event_index: Math.max(0, Math.trunc(numberValue(value.event_index, 0))),
    event_type: stringValue(value.event_type, 'event'),
    event_time: stringValue(value.event_time),
    price: nullableNumber(value.price),
    details,
  };
}

export function toScenarioDecisionQueueItemResponse(
  value: JsonRecord,
): ScenarioDecisionQueueItemResponse {
  return {
    version: 'scenario_decision_queue_item.v1',
    id: stringValue(value.id),
    workspace_id: stringValue(value.workspace_id, 'local'),
    type: scenarioDecisionQueueItemTypeValue(value.type),
    priority: Math.trunc(numberValue(value.priority, 0)),
    title: stringValue(value.title),
    summary: stringValue(value.summary),
    scenario_id: nullableString(value.scenario_id),
    thesis_id: nullableString(value.thesis_id),
    playbook_id: nullableString(value.playbook_id),
    backtest_id: nullableString(value.backtest_id),
    status: scenarioDecisionItemStatusValue(value.status),
    blockers: stringList(value.blockers),
    next_action: stringValue(value.next_action),
    due_at: nullableString(value.due_at),
    created_at: stringValue(value.created_at, new Date().toISOString()),
  };
}

export function toScenarioDecisionWorkbenchResponse(
  value: JsonRecord,
): ScenarioDecisionWorkbenchResponse {
  const items = arrayRecords(value.items).map(toScenarioDecisionQueueItemResponse);
  return {
    version: 'scenario_decision_workspace.v1',
    workspace_id: stringValue(value.workspace_id, 'local'),
    generated_at: stringValue(value.generated_at, new Date().toISOString()),
    total_open: Math.max(0, Math.trunc(numberValue(value.total_open, items.length))),
    items,
  };
}

function scenarioRelationToThesisValue(
  explicit: string,
  context: {
    thesis?: JsonRecord | null;
    branchType: string;
    direction: string;
    thesisImpact: string;
    scenarioName: string;
    condition: string;
    expectedBehavior: string;
    impactOnThesis: string;
    suggestedUserAction: string;
    riskMap: string[];
  },
): ScenarioRelationToThesis {
  const normalizedExplicit = normalizeRelationToThesis(explicit);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const branchType = context.branchType.toLowerCase();
  const relationText = [
    context.thesisImpact,
    context.scenarioName,
    context.condition,
    context.expectedBehavior,
    context.impactOnThesis,
    context.suggestedUserAction,
    ...context.riskMap,
  ].join(' ').toLowerCase();
  const thesisStance = directionalStance(
    context.thesis?.direction,
    recordValue(context.thesis?.summary).direction,
    context.thesis?.market_bias,
    recordValue(context.thesis?.summary).market_bias,
  );
  const scenarioStance = directionalStance(context.direction);

  if (
    branchType === 'invalidation' ||
    includesAny(relationText, [
      'invalidates',
      'invalidated',
      'cancels',
      'cancel the current thesis',
    ])
  ) {
    return 'invalidates';
  }

  if (
    includesAny(relationText, [
      'challenge',
      'challenges',
      'weakens',
      'weaken',
      'reassess',
      'reduce',
      'downgrade',
      'deteriorates',
    ]) ||
    stancesOppose(thesisStance, scenarioStance)
  ) {
    return 'challenges';
  }

  if (
    branchType === 'confirmation' ||
    includesAny(relationText, [
      'supports',
      'supporting',
      'strengthen',
      'strengthens',
      'confirms',
      'confirmation',
      'follow-through',
    ]) ||
    stancesAlign(thesisStance, scenarioStance)
  ) {
    return 'supports';
  }

  return 'neutral';
}

function normalizeRelationToThesis(value: string): ScenarioRelationToThesis | null {
  const normalized = value.toLowerCase().replaceAll('-', '_').replace(/\s+/g, '_');
  if (['supports', 'support', 'supports_thesis', 'confirmation'].includes(normalized)) {
    return 'supports';
  }
  if (['challenges', 'challenge', 'weakens', 'opposes', 'stress_test'].includes(normalized)) {
    return 'challenges';
  }
  if (['invalidates', 'invalidate', 'invalidated', 'cancels', 'canceled'].includes(normalized)) {
    return 'invalidates';
  }
  if (['neutral', 'linked', 'watch', 'wait'].includes(normalized)) {
    return 'neutral';
  }
  return null;
}

type DirectionalStance = 'bullish' | 'bearish' | 'neutral' | 'unknown';

function directionalStance(...values: unknown[]): DirectionalStance {
  const normalized = values.map((value) => stringValue(value)).join(' ').toLowerCase();
  if (includesAny(normalized, ['long', 'bull', 'buy', 'overweight', 'upside'])) {
    return 'bullish';
  }
  if (includesAny(normalized, ['short', 'bear', 'sell', 'underweight', 'downside'])) {
    return 'bearish';
  }
  if (
    includesAny(normalized, [
      'watch',
      'neutral',
      'range',
      'sideways',
      'no trade',
      'wait',
      'defensive',
    ])
  ) {
    return 'neutral';
  }
  return 'unknown';
}

function stancesAlign(left: DirectionalStance, right: DirectionalStance): boolean {
  return left !== 'unknown' && left !== 'neutral' && left === right;
}

function stancesOppose(left: DirectionalStance, right: DirectionalStance): boolean {
  return (
    (left === 'bullish' && right === 'bearish') ||
    (left === 'bearish' && right === 'bullish')
  );
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
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
    base_evaluation_id:
      nullableString(evaluation.base_evaluation_id) ??
      nullableString(evaluation.id),
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
    active_source: calibrationActiveSourceValue(evaluation.active_source),
    active_rerun_id: nullableString(evaluation.active_rerun_id),
    active_promotion_id: nullableString(evaluation.active_promotion_id),
    payload: recordValue(evaluation.payload ?? evaluation.payload_json),
  };
}

export function toCalibrationEvaluationRerunResponse(
  rerun: JsonRecord,
): CalibrationEvaluationRerunResponse {
  return {
    id: nullableString(rerun.id),
    workspace_id: stringValue(rerun.workspace_id, 'local'),
    canonical_evaluation_id: stringValue(rerun.canonical_evaluation_id),
    thesis_id: stringValue(rerun.thesis_id),
    symbol: stringValue(rerun.symbol),
    window_days: numberValue(rerun.window_days),
    evaluation_start: nullableString(rerun.evaluation_start),
    evaluation_end: nullableString(rerun.evaluation_end),
    requested_by_user_id: nullableString(rerun.requested_by_user_id),
    requested_at: nullableString(rerun.requested_at),
    evaluated_at: nullableString(rerun.evaluated_at),
    source: stringValue(rerun.source),
    reason: calibrationRerunReasonValue(rerun.reason),
    notes: nullableString(rerun.notes),
    idempotency_key: nullableString(rerun.idempotency_key),
    status: calibrationRerunStatusValue(rerun.status),
    result: nullableCalibrationResultValue(rerun.result),
    max_favorable_excursion: nullableNumber(
      rerun.max_favorable_excursion,
    ),
    max_adverse_excursion: nullableNumber(rerun.max_adverse_excursion),
    invalidated:
      rerun.invalidated === null || rerun.invalidated === undefined
        ? null
        : booleanValue(rerun.invalidated),
    warnings: stringList(rerun.warnings ?? rerun.warnings_json),
    evidence: recordValue(rerun.evidence ?? rerun.evidence_json),
    diff: recordValue(
      rerun.diff ?? rerun.diff_json,
    ) as CalibrationEvaluationRerunDiffResponse,
    error_type: nullableString(rerun.error_type),
    error_message: nullableString(rerun.error_message),
    payload: recordValue(rerun.payload ?? rerun.payload_json),
  };
}

export function toCalibrationEvaluationPromotionResponse(
  promotion: JsonRecord,
): CalibrationEvaluationPromotionResponse {
  return {
    id: nullableString(promotion.id),
    workspace_id: stringValue(promotion.workspace_id, 'local'),
    canonical_evaluation_id: stringValue(promotion.canonical_evaluation_id),
    promoted_rerun_id: nullableString(promotion.promoted_rerun_id),
    action: calibrationPromotionActionValue(promotion.action),
    promoted_by_user_id: nullableString(promotion.promoted_by_user_id),
    promoted_at: nullableString(promotion.promoted_at),
    reason: calibrationRerunReasonValue(promotion.reason),
    notes: nullableString(promotion.notes),
    idempotency_key: nullableString(promotion.idempotency_key),
    payload: recordValue(promotion.payload ?? promotion.payload_json),
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

function signalConfidenceSemantics(
  signal: JsonRecord,
  payload: JsonRecord,
  heuristicStrength: number | null,
  empiricalProbability: number | null,
): SignalResponse['confidence_semantics'] {
  const explicit = stringValue(
    signal.confidence_semantics ?? payload.confidence_semantics,
  );
  if (
    explicit === 'heuristic' ||
    explicit === 'empirical' ||
    explicit === 'unavailable'
  ) {
    return explicit;
  }
  if (empiricalProbability !== null) {
    return 'empirical';
  }
  return heuristicStrength === null ? 'unavailable' : 'heuristic';
}

function signalAvailability(
  signal: JsonRecord,
  payload: JsonRecord,
  evidence: JsonRecord,
  provenance: JsonRecord,
): SignalResponse['availability'] {
  const provenanceMetadata = recordValue(provenance.metadata);
  const raw = stringValue(
    signal.availability ??
      payload.availability ??
      evidence.availability ??
      provenanceMetadata.availability,
  );
  if (
    raw === 'valid' ||
    raw === 'missing' ||
    raw === 'stale' ||
    raw === 'parse_failed' ||
    raw === 'error'
  ) {
    return raw;
  }
  const freshness = stringValue(
    signal.freshness_status ?? payload.freshness_status ?? provenance.freshness,
  );
  return freshness === 'stale' ? 'stale' : 'unknown';
}

function signalDisplayName(
  signal: JsonRecord,
  payload: JsonRecord,
  evidence: JsonRecord,
  provenanceMetadata: JsonRecord,
): string {
  const explicit = stringValue(
    signal.display_name ??
      payload.display_name ??
      evidence.display_name ??
      provenanceMetadata.display_name,
  );
  if (explicit) {
    return explicit;
  }
  const signalType = stringValue(signal.signal_type ?? payload.signal_type);
  return signalType === 'onchain' ? 'Market structure proxy' : signalType;
}

function publishableEmpiricalProbability(
  signal: JsonRecord,
  payload: JsonRecord,
): number | null {
  const explicit = nullableNumber(
    signal.empirical_probability ?? payload.empirical_probability,
  );
  if (explicit !== null) {
    return explicit;
  }
  const empirical = nullableNumber(
    signal.empirical_confidence ?? payload.empirical_confidence,
  );
  const sampleSize = nullableNumber(
    signal.empirical_confidence_sample_size ??
      payload.empirical_confidence_sample_size,
  );
  const oosSampleSize = nullableNumber(
    signal.empirical_confidence_oos_sample_size ??
      payload.empirical_confidence_oos_sample_size,
  );
  if (
    empirical !== null &&
    sampleSize !== null &&
    oosSampleSize !== null &&
    sampleSize >= 30 &&
    oosSampleSize >= 10
  ) {
    return empirical;
  }
  return null;
}

export function toSignalResponse(signal: JsonRecord): SignalResponse {
  const payload = recordValue(signal.payload ?? signal.payload_json);
  const provenance = recordValue(signal.provenance ?? payload.provenance);
  const provenanceMetadata = recordValue(provenance.metadata);
  const evidence = recordValue(signal.evidence ?? payload.evidence);
  const heuristicStrength = nullableNumber(
    signal.heuristic_strength ??
      payload.heuristic_strength ??
      signal.heuristic_confidence ??
      payload.heuristic_confidence ??
      evidence.heuristic_confidence ??
      signal.confidence ??
      payload.confidence,
  );
  const empiricalProbability = publishableEmpiricalProbability(signal, payload);
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
    heuristic_strength: heuristicStrength,
    confidence_semantics: signalConfidenceSemantics(
      signal,
      payload,
      heuristicStrength,
      empiricalProbability,
    ),
    availability: signalAvailability(signal, payload, evidence, provenance),
    display_name: signalDisplayName(signal, payload, evidence, provenanceMetadata),
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
  const empiricalProbability = publishableEmpiricalProbability(signal, payload);
  const empiricalProbabilitySampleSize = nullableNumber(
    signal.empirical_probability_sample_size ??
      payload.empirical_probability_sample_size ??
      signal.empirical_confidence_sample_size ??
      payload.empirical_confidence_sample_size,
  );
  const empiricalProbabilityOosSampleSize = nullableNumber(
    signal.empirical_probability_oos_sample_size ??
      payload.empirical_probability_oos_sample_size ??
      signal.empirical_confidence_oos_sample_size ??
      payload.empirical_confidence_oos_sample_size,
  );
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
    empirical_probability: empiricalProbability,
    empirical_probability_sample_size: empiricalProbabilitySampleSize,
    empirical_probability_oos_sample_size: empiricalProbabilityOosSampleSize,
    source_note: nullableString(
      signal.source_note ??
        payload.source_note ??
        evidence.source_note ??
        provenanceMetadata.source_note,
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

export function toAlertResponse(alert: JsonRecord): AlertResponse {
  return {
    id: nullableString(alert.id),
    workspace_id: stringValue(alert.workspace_id, 'local'),
    alert_type: stringValue(alert.alert_type),
    symbol: stringValue(alert.symbol),
    thesis_id: nullableString(alert.thesis_id),
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
  confirmationCondition: string,
  invalidation: string,
  targetZones: string[],
  profitTargets: string[],
  downsideObjectives: string[],
  accumulationZones: string[],
  indicatorThresholds: string[],
): ThesisSummaryResponse {
  return {
    rating: stringValue(summary.rating, 'Hold'),
    direction: stringValue(summary.direction, 'watch'),
    confidence: nullableNumber(summary.confidence),
    market_type: stringValue(summary.market_type, 'spot'),
    action_summary: stringValue(summary.action_summary),
    recommended_action: stringValue(summary.recommended_action),
    market_bias: stringValue(summary.market_bias),
    entry_plan_status: stringValue(summary.entry_plan_status),
    confirmation_condition: confirmationCondition,
    entry_zone: entryZone,
    upside_catalyst: stringValue(summary.upside_catalyst),
    invalidation,
    target_zones: targetZones,
    profit_targets: profitTargets,
    downside_objectives: downsideObjectives,
    accumulation_zones: accumulationZones,
    indicator_thresholds: indicatorThresholds,
    key_reasons: researchItemTextList(summary.key_reasons),
    risks: researchItemTextList(summary.risks),
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

function nullableCalibrationResultValue(value: unknown): CalibrationResult | null {
  return nullableString(value) === null ? null : calibrationResultValue(value);
}

function calibrationActiveSourceValue(
  value: unknown,
): CalibrationEvaluationActiveSource {
  return stringValue(value) === 'promoted_rerun'
    ? 'promoted_rerun'
    : 'base_canonical';
}

function calibrationPromotionActionValue(
  value: unknown,
): CalibrationEvaluationPromotionAction {
  return stringValue(value) === 'reset_to_base'
    ? 'reset_to_base'
    : 'promote_rerun';
}

function calibrationRerunReasonValue(
  value: unknown,
): CalibrationEvaluationRerunReason {
  const reason = stringValue(value, 'other');
  if (
    reason === 'manual_check' ||
    reason === 'engine_rule_change' ||
    reason === 'market_data_fix' ||
    reason === 'bug_fix_verification' ||
    reason === 'suspected_drift' ||
    reason === 'other'
  ) {
    return reason;
  }
  return 'other';
}

function calibrationRerunStatusValue(
  value: unknown,
): CalibrationEvaluationRerunStatus {
  return stringValue(value) === 'completed' ? 'completed' : 'failed';
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

function boundedNumber(value: unknown, fallback = 0): number {
  const parsed = nullableNumber(value);
  if (parsed === null) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
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

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
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

function firstScenarioString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text && !isScenarioNotRecorded(text)) {
      return text;
    }
  }
  return '';
}

function firstScenarioStringList(...values: unknown[]): string[] {
  for (const value of values) {
    const items = stringList(value)
      .map((item) => item.trim())
      .filter((item) => item && !isScenarioNotRecorded(item));
    if (items.length > 0) {
      return [...new Set(items)];
    }
  }
  return [];
}

function isScenarioNotRecorded(value: string): boolean {
  return ['not recorded', 'n/a', 'none', 'unknown'].includes(value.trim().toLowerCase());
}

function cleanScenarioBlock(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  const scenarioHeader = text.match(/^(?:#{1,6}\s*)?Scenario\s+\d+\s*:\s*(.+)$/i);
  return (scenarioHeader?.[1] ?? text).slice(0, 500);
}

function cleanScenarioAction(value: string): string {
  return splitLegacyScenarioMeta(value).action.replace(/\s+/g, ' ').trim();
}

function legacyScenarioMeta(
  payload: JsonRecord,
  scenario: JsonRecord,
): { as_of: string; timeframe: string; source: string[] } {
  const candidates = [
    scenario.suggested_user_action,
    payload.suggested_user_action,
    payload.suggested_action,
    scenario.condition,
    payload.condition,
  ]
    .map((item) => stringValue(item))
    .filter(Boolean);
  for (const candidate of candidates) {
    const parsed = splitLegacyScenarioMeta(candidate);
    if (parsed.as_of || parsed.timeframe || parsed.source.length > 0) {
      return {
        as_of: parsed.as_of,
        timeframe: parsed.timeframe,
        source: parsed.source,
      };
    }
  }
  return { as_of: '', timeframe: '', source: [] };
}

function splitLegacyScenarioMeta(
  value: string,
): { action: string; as_of: string; timeframe: string; source: string[] } {
  const text = stringValue(value);
  const match = text.match(/\bSource,\s*timeframe,\s*(?:and\s*)?as_of\b\s*:?\s*([\s\S]*)$/i);
  if (!match) {
    return { action: text, as_of: '', timeframe: '', source: [] };
  }
  const raw = match[1].trim();
  const action = text.slice(0, match.index).trim();
  const source: string[] = [];
  let timeframe = '';
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^\s*[-*]\s*/, '');
    if (!cleaned) {
      continue;
    }
    const timeframeMatch = cleaned.match(
      /^(?:khung\s+thời\s+gian\s+ưu\s+tiên|khung\s+thoi\s+gian\s+uu\s+tien|time\s*frame|timeframe)\s*:?\s*(.+)$/i,
    );
    if (timeframeMatch) {
      timeframe = cleanScenarioActionMeta(timeframeMatch[1]);
      continue;
    }
    source.push(cleanScenarioActionMeta(cleaned));
  }
  if (!timeframe) {
    timeframe = raw.match(/\b(1m|5m|15m|1h|4h|daily|weekly|monthly|1D|4H|1W)\b/i)?.[1] ?? '';
  }
  return {
    action,
    as_of: raw.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '',
    timeframe,
    source,
  };
}

function cleanScenarioActionMeta(value: unknown): string {
  return stringValue(value).replace(/[.;]\s*$/, '').trim();
}

function nullableRecord(value: unknown): JsonRecord | null {
  const record = recordValue(value);
  return Object.keys(record).length > 0 ? record : null;
}

function scenarioDecisionPlaybookValue(
  value: unknown,
): ScenarioDecisionPlaybook | null {
  const record = recordValue(value);
  return record.version === 'scenario_decision_playbook.v1'
    ? (record as unknown as ScenarioDecisionPlaybook)
    : null;
}

function scenarioRecommendationValue(value: unknown): ScenarioRecommendation | null {
  const record = recordValue(value);
  if (record.version !== 'scenario_recommendation.v1') {
    return null;
  }
  const action = scenarioRecommendationActionValue(record.action);
  const bias = scenarioRecommendationBiasValue(record.action_bias);
  const readiness = scenarioEvaluationReadinessValue(record.evaluation_readiness);
  const window = recordValue(record.evaluation_window);
  if (!action || !bias || !readiness || Object.keys(window).length === 0) {
    return null;
  }
  return {
    version: 'scenario_recommendation.v1',
    generated_at: nullableString(record.generated_at),
    source: stringValue(record.source) === 'llm' ? 'llm' : 'derived_v1',
    action,
    action_bias: bias,
    confidence: boundedNumber(record.confidence, 0.5),
    summary: stringValue(record.summary),
    thesis_link: stringValue(record.thesis_link),
    required_conditions: scenarioDecisionConditionList(record.required_conditions),
    invalidation_conditions: scenarioDecisionConditionList(record.invalidation_conditions),
    wait_for: stringList(record.wait_for),
    hard_gates: scenarioRecommendationGateList(record.hard_gates),
    blocking_reasons: stringList(record.blocking_reasons),
    risk_notes: stringList(record.risk_notes),
    evidence_refs: scenarioEvidenceRefList(record.evidence_refs),
    valid_until: nullableString(record.valid_until),
    evaluation_readiness: readiness,
    evaluation_window: {
      starts_at: nullableString(window.starts_at),
      ends_at: nullableString(window.ends_at),
      horizon: scenarioHorizonValue(window.horizon),
      metric_hint: scenarioEvaluationMetricHintValue(window.metric_hint),
    },
  };
}

function derivedScenarioRecommendation(input: {
  scenario: JsonRecord;
  horizon: ScenarioHorizon;
  scenarioName: string;
  direction: string;
  thesisImpact: string;
  suggestedUserAction: string;
  condition: string;
  expectedBehavior: string;
  invalidation: string;
  evidence: string[];
  watchTriggers: string[];
  impactOnThesis: string;
  riskMap: string[];
  asOf: string;
  timeframe: string;
  triggerSpec: JsonRecord | null;
}): ScenarioRecommendation | null {
  const triggerCondition =
    decisionConditionFromRecord(input.triggerSpec) ??
    derivePriceConditionFromText([
      input.condition,
      ...input.watchTriggers,
      input.expectedBehavior,
    ].join(' '));
  const invalidationCondition = derivePriceConditionFromText(input.invalidation);
  if (!triggerCondition && !invalidationCondition) {
    return null;
  }
  const actionBias = derivedScenarioActionBias(input, triggerCondition);
  const action = derivedScenarioAction(input.suggestedUserAction, actionBias);
  const blockingReasons: string[] = [];
  if (!triggerCondition) {
    blockingReasons.push('Missing trigger.');
  }
  if (!invalidationCondition) {
    blockingReasons.push('Missing invalidation.');
  }
  if (actionBias === 'neutral' || actionBias === 'unknown') {
    blockingReasons.push('Scenario is watch-only or not directional.');
  }
  const evidenceRefs: ScenarioEvidenceRef[] = [];
  if (triggerCondition) {
    evidenceRefs.push({
      type: 'scenario',
      id: nullableString(input.scenario.id),
      field: 'condition',
      label: 'Derived trigger condition',
      supports: input.condition || input.watchTriggers[0] || 'Derived from scenario text.',
    });
  }
  if (invalidationCondition) {
    evidenceRefs.push({
      type: 'scenario',
      id: nullableString(input.scenario.id),
      field: 'invalidation',
      label: 'Derived invalidation condition',
      supports: input.invalidation,
    });
  }
  return {
    version: 'scenario_recommendation.v1',
    generated_at: nullableString(input.asOf),
    source: 'derived_v1',
    action,
    action_bias: actionBias,
    confidence: actionBias === 'neutral' || actionBias === 'unknown' ? 0.45 : 0.55,
    summary: input.suggestedUserAction || input.condition || input.scenarioName,
    thesis_link: input.impactOnThesis || input.thesisImpact,
    required_conditions: triggerCondition ? [triggerCondition] : [],
    invalidation_conditions: invalidationCondition ? [invalidationCondition] : [],
    wait_for: input.watchTriggers.length > 0
      ? input.watchTriggers
      : stringList(input.condition),
    hard_gates: [],
    blocking_reasons: blockingReasons,
    risk_notes: input.riskMap,
    evidence_refs: evidenceRefs,
    valid_until: null,
    evaluation_readiness: derivedEvaluationReadiness(
      Boolean(triggerCondition),
      Boolean(invalidationCondition),
    ),
    evaluation_window: {
      starts_at: null,
      ends_at: null,
      horizon: input.horizon,
      metric_hint: actionBias === 'neutral' ? 'avoidance_check' : 'trigger_then_mfe_mae',
    },
  };
}

function derivedEvaluationReadiness(
  hasTrigger: boolean,
  hasInvalidation: boolean,
): ScenarioEvaluationReadiness {
  if (!hasTrigger) {
    return 'missing_trigger';
  }
  if (!hasInvalidation) {
    return 'missing_invalidation';
  }
  return 'ready';
}

function derivedScenarioAction(
  suggestedUserAction: string,
  actionBias: ScenarioRecommendation['action_bias'],
): ScenarioRecommendation['action'] {
  const actionText = normalizeScenarioConditionText(suggestedUserAction);
  if (actionText.match(/\b(wait|watch|review|theo doi|cho|quan sat)\b/)) {
    return 'wait';
  }
  if (actionText.match(/\b(avoid|khong mua|khong ban|no trade)\b/)) {
    return 'avoid';
  }
  if (actionBias === 'short') {
    return 'consider_short';
  }
  if (actionBias === 'long') {
    return 'consider_long';
  }
  return 'review';
}

function derivedScenarioActionBias(
  input: {
    direction: string;
    suggestedUserAction: string;
    condition: string;
    expectedBehavior: string;
  },
  triggerCondition: ScenarioDecisionCondition | null,
): ScenarioRecommendation['action_bias'] {
  const actionText = normalizeScenarioConditionText(input.suggestedUserAction);
  const isWatchOnlyAction = actionText.match(
    /\b(watch|wait|review|theo doi|cho|quan sat|khong mua|khong ban|do not act|not an exchange order|no trade|avoid)\b/,
  );
  if (
    actionText.match(/\b(short|sell|ban|entry short|consider short)\b/) &&
    !actionText.match(/\b(khong ban|not sell|do not sell|no trade|avoid)\b/)
  ) {
    return 'short';
  }
  if (
    actionText.match(/\b(long|buy|mua|dca|entry long|consider long)\b/) &&
    !actionText.match(/\b(khong mua|not buy|do not buy|no trade|avoid)\b/)
  ) {
    return 'long';
  }
  const explicitDirection = normalizeScenarioConditionText(input.direction);
  if (explicitDirection.match(/\b(short|bear|bearish|giam)\b/)) {
    return 'short';
  }
  if (explicitDirection.match(/\b(long|bull|bullish|tang)\b/)) {
    return 'long';
  }
  if (isWatchOnlyAction) {
    return 'neutral';
  }
  const directionText = normalizeScenarioConditionText(
    [
      input.direction,
      input.condition,
      input.expectedBehavior,
    ].join(' '),
  );
  if (directionText.match(/\b(short|bear|bearish|breakdown|reject|giam|pha vo)\b/)) {
    return 'short';
  }
  if (directionText.match(/\b(long|bull|bullish|breakout|reclaim|tang|phuc hoi)\b/)) {
    return 'long';
  }
  if (triggerCondition?.type === 'price_below' || triggerCondition?.type === 'price_reject_level') {
    return 'short';
  }
  if (triggerCondition?.type === 'price_above' || triggerCondition?.type === 'price_reclaim_level') {
    return 'long';
  }
  return 'unknown';
}

function scenarioEvaluationSnapshotValue(
  value: unknown,
  recommendation: ScenarioRecommendation | null,
  horizon: ScenarioHorizon,
): ScenarioEvaluationSnapshot {
  const record = recordValue(value);
  if (record.version === 'scenario_evaluation_snapshot.v1') {
    return {
      version: 'scenario_evaluation_snapshot.v1',
      readiness:
        scenarioEvaluationReadinessValue(record.readiness) ??
        recommendation?.evaluation_readiness ??
        'needs_review',
      planned_evaluation_at: nullableString(record.planned_evaluation_at),
      expected_horizon: scenarioHorizonValue(record.expected_horizon),
      trigger_observed: nullableBoolean(record.trigger_observed),
      invalidation_observed: nullableBoolean(record.invalidation_observed),
      max_favorable_excursion: nullableNumber(record.max_favorable_excursion),
      max_adverse_excursion: nullableNumber(record.max_adverse_excursion),
      outcome: scenarioEvaluationOutcomeValue(record.outcome),
      notes: stringList(record.notes),
    };
  }
  return {
    version: 'scenario_evaluation_snapshot.v1',
    readiness: recommendation?.evaluation_readiness ?? 'needs_review',
    planned_evaluation_at: recommendation?.evaluation_window.ends_at ?? null,
    expected_horizon: horizon,
    trigger_observed: null,
    invalidation_observed: null,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    outcome: recommendation ? 'pending' : 'not_ready',
    notes: recommendation ? [] : ['Scenario recommendation is missing.'],
  };
}

function scenarioDecisionConditionList(value: unknown): ScenarioDecisionCondition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const conditions: ScenarioDecisionCondition[] = [];
  for (const item of value) {
      const record = recordValue(item);
      const type = scenarioDecisionConditionTypeValue(record.type);
      if (!type) {
        continue;
      }
      const condition: ScenarioDecisionCondition = { type };
      const level = nullableNumber(record.level);
      const zoneLow = nullableNumber(record.zone_low);
      const zoneHigh = nullableNumber(record.zone_high);
      const timeframe = nullableString(record.timeframe);
      const candleCloseRequired = nullableBoolean(record.candle_close_required);
      const lookbackPeriods = nullableNumber(record.lookback_periods);
      const multiplier = nullableNumber(record.multiplier);
      const thresholdPct = nullableNumber(record.threshold_pct);
      if (level !== null) condition.level = level;
      if (zoneLow !== null) condition.zone_low = zoneLow;
      if (zoneHigh !== null) condition.zone_high = zoneHigh;
      if (timeframe !== null) condition.timeframe = timeframe;
      if (candleCloseRequired !== null) {
        condition.candle_close_required = candleCloseRequired;
      }
      if (lookbackPeriods !== null) condition.lookback_periods = lookbackPeriods;
      if (multiplier !== null) condition.multiplier = multiplier;
      if (thresholdPct !== null) condition.threshold_pct = thresholdPct;
      conditions.push(condition);
  }
  return conditions;
}

function scenarioRecommendationGateList(
  value: unknown,
): ScenarioRecommendation['hard_gates'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = recordValue(item);
      const status = scenarioRecommendationGateStatusValue(record.status);
      return status
        ? {
            id: stringValue(record.id),
            label: stringValue(record.label),
            status,
            reason: stringValue(record.reason),
          }
        : null;
    })
    .filter(
      (item): item is ScenarioRecommendation['hard_gates'][number] =>
        item !== null && Boolean(item.id || item.label),
    );
}

function scenarioEvidenceRefList(value: unknown): ScenarioEvidenceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = recordValue(item);
      return {
        type: stringValue(record.type),
        id: nullableString(record.id),
        field: stringValue(record.field),
        label: stringValue(record.label),
        supports: stringValue(record.supports),
      };
    })
    .filter((item) => item.field || item.label || item.supports);
}

function scenarioRecommendationActionValue(
  value: unknown,
): ScenarioRecommendation['action'] | null {
  const action = stringValue(value);
  if (
    action === 'wait' ||
    action === 'consider_long' ||
    action === 'consider_short' ||
    action === 'entry_long_now' ||
    action === 'entry_short_now' ||
    action === 'avoid' ||
    action === 'reduce' ||
    action === 'exit' ||
    action === 'review'
  ) {
    return action;
  }
  return null;
}

function scenarioRecommendationBiasValue(
  value: unknown,
): ScenarioRecommendation['action_bias'] | null {
  const bias = stringValue(value);
  if (bias === 'long' || bias === 'short' || bias === 'neutral' || bias === 'unknown') {
    return bias;
  }
  return null;
}

function scenarioEvaluationReadinessValue(
  value: unknown,
): ScenarioEvaluationReadiness | null {
  const readiness = stringValue(value);
  if (
    readiness === 'ready' ||
    readiness === 'missing_trigger' ||
    readiness === 'missing_invalidation' ||
    readiness === 'missing_time_window' ||
    readiness === 'not_actionable' ||
    readiness === 'needs_review'
  ) {
    return readiness;
  }
  return null;
}

function scenarioEvaluationMetricHintValue(
  value: unknown,
): ScenarioRecommendation['evaluation_window']['metric_hint'] {
  const metric = stringValue(value);
  if (
    metric === 'trigger_then_mfe_mae' ||
    metric === 'avoidance_check' ||
    metric === 'manual_review'
  ) {
    return metric;
  }
  return 'manual_review';
}

function scenarioEvaluationOutcomeValue(
  value: unknown,
): ScenarioEvaluationSnapshot['outcome'] {
  const outcome = stringValue(value);
  if (outcome === 'pending' || outcome === 'not_ready' || outcome === 'inconclusive') {
    return outcome;
  }
  return 'not_ready';
}

function scenarioEvaluationResponseValue(
  value: unknown,
): ScenarioEvaluationResponse | null {
  const record = recordValue(value);
  return record.version === 'scenario_evaluation.v1' || record.id
    ? toScenarioEvaluationResponse(record)
    : null;
}

function scenarioReliabilityProfileValue(
  value: unknown,
): ScenarioReliabilityProfileResponse | null {
  const record = recordValue(value);
  return record.version === 'scenario_reliability_profile.v1' || record.sample_size
    ? toScenarioReliabilityProfileResponse(record)
    : null;
}

function tradePlaybookValue(value: unknown): TradePlaybookResponse | null {
  const record = recordValue(value);
  return record.version === 'trade_playbook.v1' || record.id
    ? toTradePlaybookResponse(record)
    : null;
}

function backtestRunValue(value: unknown): BacktestRunResponse | null {
  const record = recordValue(value);
  return record.version === 'backtest_run.v1' || record.id
    ? toBacktestRunResponse(record)
    : null;
}

function scenarioEvaluationState(
  latestEvaluation: ScenarioEvaluationResponse | null,
  snapshot: ScenarioEvaluationSnapshot,
): ScenarioEvaluationState {
  if (latestEvaluation) {
    return latestEvaluation.result === 'inconclusive'
      ? 'inconclusive'
      : 'evaluated';
  }
  if (snapshot.outcome === 'not_ready' || snapshot.readiness !== 'ready') {
    return 'not_ready';
  }
  const planned = nullableString(snapshot.planned_evaluation_at);
  if (!planned) {
    return 'pending';
  }
  const plannedMs = Date.parse(planned);
  return Number.isFinite(plannedMs) && plannedMs <= Date.now() ? 'due' : 'pending';
}

function scenarioEvaluationWindowValue(
  value: unknown,
): ScenarioEvaluationResponse['evaluation_window'] {
  const record = recordValue(value);
  return {
    starts_at: nullableString(record.starts_at),
    ends_at: nullableString(record.ends_at),
  };
}

function scenarioEvaluationResultValue(value: unknown): ScenarioEvaluationResponse['result'] {
  const result = stringValue(value);
  if (
    result === 'hit' ||
    result === 'invalidated' ||
    result === 'missed' ||
    result === 'mixed' ||
    result === 'inconclusive'
  ) {
    return result;
  }
  return 'inconclusive';
}

function scenarioEvaluationDataQualityValue(
  value: unknown,
): ScenarioEvaluationResponse['data_quality'] {
  const quality = stringValue(value);
  if (quality === 'complete' || quality === 'partial' || quality === 'insufficient') {
    return quality;
  }
  return 'insufficient';
}

function marketTypeValue(value: unknown): 'spot' | 'perp' {
  return value === 'perp' ? 'perp' : 'spot';
}

function reliabilityMarketTypeValue(value: unknown): 'spot' | 'perp' | 'mixed' {
  if (value === 'perp' || value === 'mixed') {
    return value;
  }
  return 'spot';
}

function playbookDirectionValue(value: unknown): TradePlaybookResponse['direction'] {
  if (value === 'short' || value === 'avoid') {
    return value;
  }
  return 'long';
}

function playbookEntryTypeValue(value: unknown): TradePlaybookResponse['entry']['type'] {
  if (value === 'zone' || value === 'condition') {
    return value;
  }
  return 'level';
}

function backtestStatusValue(value: unknown): BacktestRunResponse['status'] {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'partial'
  ) {
    return value;
  }
  return 'failed';
}

function backtestFillPolicyValue(
  value: unknown,
): BacktestRunResponse['assumptions']['fill_policy'] {
  if (value === 'close_confirmed' || value === 'next_open') {
    return value;
  }
  return 'touch';
}

function backtestSizingPolicyValue(
  value: unknown,
): BacktestRunResponse['assumptions']['sizing_policy'] {
  return value === 'fixed_fraction' ? 'fixed_fraction' : 'fixed_notional';
}

function backtestDataQualityValue(
  value: unknown,
): BacktestRunResponse['data_quality'] {
  if (value === 'complete' || value === 'partial' || value === 'insufficient') {
    return value;
  }
  return 'insufficient';
}

function scenarioDecisionQueueItemTypeValue(
  value: unknown,
): ScenarioDecisionQueueItemResponse['type'] {
  if (
    value === 'active_scenario' ||
    value === 'evaluation_due' ||
    value === 'evaluation_inconclusive' ||
    value === 'reliability_changed' ||
    value === 'playbook_candidate' ||
    value === 'backtest_ready'
  ) {
    return value;
  }
  return 'active_scenario';
}

function scenarioDecisionItemStatusValue(
  value: unknown,
): ScenarioDecisionQueueItemResponse['status'] {
  if (value === 'snoozed' || value === 'resolved') {
    return value;
  }
  return 'open';
}

function scenarioDecisionConditionTypeValue(
  value: unknown,
): ScenarioDecisionCondition['type'] | null {
  const type = stringValue(value);
  if (
    type === 'price_above' ||
    type === 'price_below' ||
    type === 'price_in_zone' ||
    type === 'price_reclaim_level' ||
    type === 'price_reject_level' ||
    type === 'volume_above_average' ||
    type === 'overextended_from_trigger'
  ) {
    return type;
  }
  return null;
}

function scenarioRecommendationGateStatusValue(
  value: unknown,
): ScenarioRecommendation['hard_gates'][number]['status'] | null {
  const status = stringValue(value);
  if (
    status === 'passed' ||
    status === 'failed' ||
    status === 'pending' ||
    status === 'unknown'
  ) {
    return status;
  }
  return null;
}

function scenarioRuntimeDecisionValue(value: unknown): ScenarioRuntimeDecision {
  const record = recordValue(value);
  if (record.version === 'scenario_runtime_decision.v1') {
    return record as unknown as ScenarioRuntimeDecision;
  }
  return {
    version: 'scenario_runtime_decision.v1',
    evaluated_at: new Date().toISOString(),
    trigger_status: 'needs_review',
    validity_status: 'needs_review',
    recommended_action: 'review',
    confidence: 0,
    matched_conditions: [],
    failed_conditions: [],
    blocking_reasons: ['runtime_decision_missing'],
    risk_notes: [],
    evidence_refs: [],
    source: 'rule_engine_from_decision_playbook',
    playbook_source: 'missing',
    status_reason: 'Runtime decision has not been evaluated.',
    distance_to_trigger: null,
    llm_recommendation: null,
    final_decision: {
      action: 'review',
      reason: 'Runtime decision has not been evaluated.',
      overrides: ['runtime_decision_missing'],
    },
  };
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') {
    return null;
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
  return null;
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

function normalizeThesisDecisionBrief({
  direction,
  entryPlanStatus,
  entryZone,
  marketBias,
  rating,
  recommendedAction,
  researchRunId,
  status,
}: {
  direction: string;
  entryPlanStatus: string;
  entryZone: string;
  marketBias: string;
  rating: string;
  recommendedAction: string;
  researchRunId: string | null;
  status: string;
}): Pick<
  ThesisResponse,
  | 'decision'
  | 'recommended_action'
  | 'recommended_action_label'
  | 'market_bias'
  | 'market_bias_label'
  | 'entry_plan_status'
  | 'entry_plan_status_label'
  | 'analysis_mode'
  | 'analysis_mode_label'
  | 'thesis_status'
  | 'thesis_status_label'
> {
  const normalizedRating = machineKey(rating);
  const normalizedDirection = machineKey(direction);
  const riskOff =
    normalizedRating === 'underweight' ||
    normalizedRating === 'sell' ||
    ['avoid', 'short'].includes(normalizedDirection) ||
    normalizedDirection.includes('bear');
  const riskOn =
    normalizedRating === 'overweight' ||
    normalizedRating === 'buy' ||
    normalizedDirection === 'long' ||
    normalizedDirection.includes('bull');
  const action =
    normalizeRecommendedAction(recommendedAction) ??
    (riskOff
      ? (['avoid_long', 'Avoid long'] as const)
      : riskOn
        ? (['consider_long', 'Consider long'] as const)
        : (['watch_only', 'Watch only'] as const));
  const bias =
    normalizeMarketBias(marketBias) ??
    (riskOff
      ? (['defensive', 'Defensive'] as const)
      : riskOn
        ? (['bullish', 'Bullish'] as const)
        : (['neutral', 'Neutral'] as const));
  const entryPlan =
    normalizeEntryPlanStatus(entryPlanStatus) ??
    defaultEntryPlanStatus(action[0], entryZone);
  const analysisMode = researchRunId
    ? ['ai_assisted', 'AI assisted analysis']
    : ['manual', 'Manual analysis'];
  const thesisStatus = normalizeThesisStatus(status);
  return {
    decision: rating || 'Hold',
    recommended_action: action[0],
    recommended_action_label: action[1],
    market_bias: bias[0],
    market_bias_label: bias[1],
    entry_plan_status: entryPlan[0],
    entry_plan_status_label: entryPlan[1],
    analysis_mode: analysisMode[0],
    analysis_mode_label: analysisMode[1],
    thesis_status: thesisStatus[0],
    thesis_status_label: thesisStatus[1],
  };
}

function machineKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function normalizeRecommendedAction(value: string): readonly [string, string] | null {
  switch (machineKey(value)) {
    case 'avoid':
    case 'avoid_long':
    case 'no_long':
    case 'stand_aside':
    case 'no_trade':
      return ['avoid_long', 'Avoid long'];
    case 'watch':
    case 'watch_only':
    case 'monitor':
    case 'wait':
      return ['watch_only', 'Watch only'];
    case 'reduce':
    case 'reduce_exposure':
    case 'trim':
    case 'trim_exposure':
      return ['reduce_exposure', 'Reduce exposure'];
    case 'consider_long':
    case 'enter_long':
    case 'long':
    case 'buy':
      return ['consider_long', 'Consider long'];
    case 'consider_short':
    case 'enter_short':
    case 'short':
    case 'sell':
      return ['consider_short', 'Consider short'];
    default:
      return null;
  }
}

function normalizeMarketBias(value: string): readonly [string, string] | null {
  switch (machineKey(value)) {
    case 'defensive':
    case 'risk_off':
    case 'cautious':
    case 'avoid':
      return ['defensive', 'Defensive'];
    case 'bullish':
    case 'bull':
    case 'long':
    case 'risk_on':
      return ['bullish', 'Bullish'];
    case 'bearish':
    case 'bear':
    case 'short':
      return ['bearish', 'Bearish'];
    case 'neutral':
    case 'watch':
    case 'mixed':
      return ['neutral', 'Neutral'];
    default:
      return null;
  }
}

function normalizeEntryPlanStatus(value: string): readonly [string, string] | null {
  switch (machineKey(value)) {
    case 'no_trade':
    case 'no_entry':
    case 'none':
    case 'avoid':
    case 'stand_aside':
      return ['no_trade', 'No trade'];
    case 'ready':
    case 'actionable':
    case 'active':
      return ['ready', 'Ready'];
    case 'conditional':
    case 'wait_for_confirmation':
    case 'watch':
      return ['conditional', 'Conditional'];
    default:
      return null;
  }
}

function defaultEntryPlanStatus(
  recommendedAction: string,
  entryZone: string,
): readonly [string, string] {
  if (recommendedAction === 'avoid_long') {
    return ['no_trade', 'No trade'];
  }
  if (entryZone.trim()) {
    return ['conditional', 'Conditional'];
  }
  if (recommendedAction === 'watch_only') {
    return ['no_trade', 'No trade'];
  }
  return ['conditional', 'Conditional'];
}

function normalizeThesisStatus(status: string): [string, string] {
  const normalized = status.trim().toLowerCase();
  if (['tracked', 'watched', 'watching'].includes(normalized)) {
    return ['tracked', 'Tracked'];
  }
  if (['accepted', 'reviewed'].includes(normalized)) {
    return ['reviewed', 'Reviewed'];
  }
  if (['rejected', 'invalidated'].includes(normalized)) {
    return ['closed', 'Closed'];
  }
  return ['draft', 'Draft'];
}
