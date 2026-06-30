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
