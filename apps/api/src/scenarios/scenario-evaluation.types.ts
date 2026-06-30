import type { JsonRecord } from '../database/journal.types';

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

export type ScenarioEvaluationState =
  | 'not_ready'
  | 'pending'
  | 'due'
  | 'evaluated'
  | 'inconclusive';
