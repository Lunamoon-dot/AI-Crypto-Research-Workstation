import type { JsonRecord } from '../database/journal.types';

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

export type ScenarioActionBias = 'long' | 'short' | 'neutral' | 'unknown';
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

export interface ScenarioDecisionPlaybook {
  version: 'scenario_decision_playbook.v1';
  source: 'llm' | 'derived_v1';
  generated_at: string | null;
  generated_from_run_id: string | null;
  action_bias: ScenarioActionBias;
  confidence: number;
  preferred_action_if_triggered: ScenarioRecommendedAction;
  fallback_action: ScenarioRecommendedAction;
  near_trigger_threshold_pct: number;
  validity_window: {
    valid_from: string | null;
    valid_until: string | null;
    timeframe: string;
    rationale: string;
    refresh_policy: 'refresh_on_next_research_run' | 'manual_review';
  };
  entry_conditions: ScenarioDecisionCondition[];
  avoid_if: ScenarioDecisionCondition[];
  invalidation_conditions: ScenarioDecisionCondition[];
  wait_for: string[];
  risk_notes: string[];
  evidence_refs: ScenarioEvidenceRef[];
  rationale: string;
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
    horizon: 'short_term' | 'mid_term' | 'long_term' | 'unknown';
    metric_hint: 'trigger_then_mfe_mae' | 'avoidance_check' | 'manual_review';
  };
}

export interface ScenarioEvaluationSnapshot {
  version: 'scenario_evaluation_snapshot.v1';
  readiness: ScenarioEvaluationReadiness;
  planned_evaluation_at: string | null;
  expected_horizon: 'short_term' | 'mid_term' | 'long_term' | 'unknown';
  trigger_observed: boolean | null;
  invalidation_observed: boolean | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  outcome: 'pending' | 'not_ready' | 'inconclusive';
  notes: string[];
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
