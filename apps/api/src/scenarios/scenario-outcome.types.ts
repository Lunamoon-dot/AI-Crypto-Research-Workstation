export type ScenarioOutcomeSettlementReason =
  | 'expired'
  | 'invalidated'
  | 'target_hit'
  | 'risk_exit_hit'
  | 'missed_entry'
  | 'data_end'
  | 'manual_abandon';

export type ScenarioOutcomePredictionQuality =
  | 'supported'
  | 'challenged'
  | 'invalidated'
  | 'inconclusive';

export type ScenarioOutcomeExecutionQuality =
  | 'not_simulated'
  | 'rule_following'
  | 'late_entry'
  | 'premature_entry'
  | 'missed_trigger'
  | 'insufficient_data';

export type ScenarioOutcomeDataQuality =
  | 'complete'
  | 'partial'
  | 'insufficient';

export interface ScenarioOutcomeSnapshotResponse {
  version: 'scenario_outcome_snapshot.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id: string;
  playbook_id: string | null;
  simulation_id: string | null;
  generated_at: string;
  settled_at: string;
  settlement_reason: ScenarioOutcomeSettlementReason;
  trigger_hit: boolean | null;
  trigger_hit_at: string | null;
  entry_hit: boolean | null;
  entry_hit_at: string | null;
  invalidation_hit: boolean | null;
  invalidation_hit_at: string | null;
  target_hit: boolean | null;
  target_hit_at: string | null;
  start_price: number | null;
  end_price: number | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  paper_realized_pnl: string | null;
  paper_realized_pnl_pct: string | null;
  prediction_quality: ScenarioOutcomePredictionQuality;
  execution_quality: ScenarioOutcomeExecutionQuality;
  data_quality: ScenarioOutcomeDataQuality;
  warnings: string[];
}
