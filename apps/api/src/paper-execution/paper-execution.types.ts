import type { JsonRecord } from '../database/journal.types';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';

export type DecimalString = string;

export type SimulationMode = 'replay' | 'forward';

export type ReliabilitySampleKind =
  | 'forward_observation'
  | 'out_of_sample_replay'
  | 'in_sample_replay'
  | 'manual_experiment';

export type SimulationRunStatus =
  | 'created'
  | 'waiting_for_trigger'
  | 'entry_triggered'
  | 'order_pending'
  | 'position_open'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type SourceIntegrityStatus = 'verified' | 'failed' | 'unknown';

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

export interface SimulationRiskExit {
  type: 'hard_stop' | 'close_confirmation' | 'condition';
  level: DecimalString | null;
  condition: JsonRecord | null;
}

export interface SimulationThesisInvalidation {
  level: DecimalString | null;
  condition: JsonRecord | null;
}

export interface SimulationAssumptions {
  version: 'simulation_assumptions.v1';
  fill_policy: 'touch' | 'next_open_after_trigger';
  gap_fill_policy: 'requested_price' | 'first_tradable_price' | 'reject_if_skipped';
  intrabar_policy: 'stop_first' | 'target_first' | 'ambiguous_warning';
  slippage_bps: DecimalString;
  fee_bps: DecimalString;
  position_size: {
    mode: 'fixed_notional' | 'fixed_quantity';
    notional: DecimalString | null;
    quantity: DecimalString | null;
  };
  risk_exit: SimulationRiskExit;
  thesis_invalidation: SimulationThesisInvalidation;
  partial_take_profit: Array<{
    target_index: number;
    close_percent: DecimalString;
  }>;
  setup_expiry_at: string | null;
  position_max_duration_minutes: number | null;
  force_close_at_data_end: boolean;
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
  mode: SimulationMode;
  sample_kind: ReliabilitySampleKind;
  status: SimulationRunStatus;
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
  evaluation_window: {
    starts_at: string | null;
    ends_at: string | null;
    horizon: string;
  };
  playbook_snapshot: TradePlaybookResponse;
  analysis_snapshot: {
    scenario: JsonRecord;
    thesis: JsonRecord;
    scenario_recommendation: JsonRecord | null;
    decision_playbook: JsonRecord | null;
    chart_source_versions: JsonRecord | null;
  };
  assumptions: SimulationAssumptions;
  market_data_snapshot: MarketDataSnapshot;
  sample_identity: SimulationSampleIdentity;
  source_integrity_status: SourceIntegrityStatus;
  source_drift_after_start: boolean;
  source_hashes: {
    scenario: string;
    decision_playbook: string | null;
    recommendation: string | null;
    trade_playbook: string;
  };
}

export type PaperOrderStatus =
  | 'created'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export interface PaperOrderResponse {
  version: 'paper_order.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  side: 'buy' | 'sell';
  intent: 'entry' | 'exit' | 'stop' | 'target' | 'reduce';
  status: PaperOrderStatus;
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

export type PaperPositionStatus = 'open' | 'partially_closed' | 'closed';

export type PaperPositionCloseReason =
  | 'target'
  | 'stop'
  | 'position_timeout'
  | 'thesis_invalidation'
  | 'manual_close'
  | 'data_end';

export interface PaperPositionResponse {
  version: 'paper_position.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: 'long' | 'short';
  status: PaperPositionStatus;
  quantity_opened: DecimalString;
  quantity_remaining: DecimalString;
  average_entry_price: DecimalString | null;
  realized_pnl: DecimalString | null;
  unrealized_pnl: DecimalString | null;
  realized_pnl_pct: DecimalString | null;
  unrealized_pnl_pct: DecimalString | null;
  opened_at_market_time: string | null;
  closed_at_market_time: string | null;
  close_reason: PaperPositionCloseReason | null;
}

export type ExecutionEventType =
  | 'simulation_started'
  | 'playbook_snapshot_frozen'
  | 'entry_zone_entered'
  | 'entry_condition_confirmed'
  | 'paper_order_created'
  | 'paper_order_partially_filled'
  | 'paper_order_filled'
  | 'paper_order_cancelled'
  | 'paper_order_rejected'
  | 'paper_order_expired'
  | 'position_opened'
  | 'target_hit'
  | 'position_partially_closed'
  | 'stop_hit'
  | 'invalidation_hit'
  | 'setup_expired'
  | 'position_timeout_hit'
  | 'data_end_reached'
  | 'position_closed'
  | 'simulation_completed'
  | 'simulation_cancelled'
  | 'simulation_failed'
  | 'evaluation_completed';

export interface ExecutionEventResponse {
  version: 'execution_event.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  source_scenario_id: string;
  event_type: ExecutionEventType;
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

export type ThesisOutcome =
  | 'supported'
  | 'challenged'
  | 'invalidated'
  | 'inconclusive';

export type ResearchEvaluationStatus = 'pending' | 'rule_based' | 'llm_assisted';

export type ExecutionResult = 'win' | 'loss' | 'breakeven' | 'missed' | 'inconclusive';

export type ExecutionQuality =
  | 'rule_following'
  | 'poor_entry'
  | 'poor_exit'
  | 'missed_trigger'
  | 'invalid_experiment'
  | 'insufficient_data';

export type DiagnosisCode =
  | 'THESIS_SUPPORTED'
  | 'THESIS_CHALLENGED'
  | 'THESIS_INVALIDATED'
  | 'ENTRY_PREMATURE'
  | 'ENTRY_MISSED'
  | 'STOP_TOO_TIGHT'
  | 'TARGET_REACHED_AFTER_EXPIRY'
  | 'AMBIGUOUS_INTRABAR'
  | 'INSUFFICIENT_FUTURE_DATA'
  | 'DATA_END_REACHED'
  | 'SOURCE_INTEGRITY_FAILED'
  | 'ENGINE_FAILURE';

export type SimulationCloseReason = PaperPositionCloseReason | 'setup_expiry' | null;

export interface SimulationOutcomeResponse {
  version: 'simulation_outcome.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_scenario_id: string;
  source_playbook_id: string;
  sample_kind: ReliabilitySampleKind;
  sample_identity: SimulationSampleIdentity;
  execution_result: ExecutionResult;
  research_evaluation_status: ResearchEvaluationStatus;
  thesis_outcome: ThesisOutcome | null;
  execution_quality: ExecutionQuality;
  close_reason: SimulationCloseReason;
  realized_pnl: DecimalString | null;
  realized_pnl_pct: DecimalString | null;
  max_favorable_excursion: DecimalString | null;
  max_adverse_excursion: DecimalString | null;
  reliability_eligible: boolean;
  diagnosis_codes: DiagnosisCode[];
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

export type CreateSimulationRequest = Partial<SimulationAssumptions> & {
  mode?: SimulationMode;
  sample_kind?: ReliabilitySampleKind;
  timeframe?: string;
  starts_at?: string;
  ends_at?: string | null;
};

export interface CloseSimulationRequest {
  close_policy: 'manual_close' | 'abandon_inconclusive';
  price?: DecimalString;
  market_time?: string;
  reason?: string;
}
