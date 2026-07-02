import type {
  MarketChartInterval,
  MarketOhlcvCandleResponse,
} from '../market-data/market-ohlcv.service';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionConditionRole,
  ScenarioRuntimeDecision,
} from './scenario-decision.types';

export type ScenarioConditionEvaluationStatus =
  | 'passed'
  | 'failed'
  | 'pending'
  | 'unknown';

export interface ScenarioConditionEvaluationResponse {
  id: string;
  label: string;
  role: ScenarioDecisionConditionRole;
  type: ScenarioDecisionCondition['type'];
  status: ScenarioConditionEvaluationStatus;
  reason: string;
  level: number | null;
  zone_low: number | null;
  zone_high: number | null;
  source: 'decision_playbook' | 'trade_playbook' | 'runtime';
}

export interface ScenarioTargetProgressResponse {
  label: string;
  level: number | null;
  status: 'pending' | 'hit' | 'skipped' | 'unknown';
  hit_at: string | null;
  rationale: string;
}

export interface ScenarioEventResponse {
  version: 'scenario_event.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id: string | null;
  event_type:
    | 'scenario.generated'
    | 'scenario.near_trigger'
    | 'scenario.triggered'
    | 'scenario.condition_passed'
    | 'scenario.condition_failed'
    | 'scenario.target_hit'
    | 'scenario.weakened'
    | 'scenario.invalidated'
    | 'scenario.expired'
    | 'scenario.overextended';
  event_time: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ScenarioLiveStateResponse {
  version: 'scenario_live_state.v1';
  scenario_id: string;
  workspace_id: string;
  evaluated_at: string;
  current_price: number | null;
  trigger_status: ScenarioRuntimeDecision['trigger_status'];
  validity_status: ScenarioRuntimeDecision['validity_status'];
  recommended_action: ScenarioRuntimeDecision['recommended_action'];
  distance_to_trigger: number | null;
  condition_evaluations: ScenarioConditionEvaluationResponse[];
  target_progress: ScenarioTargetProgressResponse[];
  blockers: string[];
  commentary: string;
  latest_event: ScenarioEventResponse | null;
}

export type ScenarioChartMode =
  | 'watch'
  | 'trade'
  | 'indicator'
  | 'event'
  | 'narrative';

export type ScenarioChartOverlay =
  | {
      id: string;
      type: 'horizontal_line';
      role: 'trigger' | 'entry' | 'invalidation' | 'target' | 'current_price';
      source: 'decision_playbook' | 'trade_playbook' | 'runtime';
      price: number;
      label: string;
      status: 'active' | 'passed' | 'failed' | 'blocked' | 'unknown';
    }
  | {
      id: string;
      type: 'price_zone';
      role: 'watch' | 'entry' | 'avoid';
      source: 'decision_playbook' | 'trade_playbook';
      price_low: number;
      price_high: number;
      label: string;
      status: 'active' | 'passed' | 'failed' | 'blocked' | 'unknown';
    }
  | {
      id: string;
      type: 'event_marker';
      role: 'event';
      source: 'runtime';
      time: string;
      price: number | null;
      label: string;
      status: 'active' | 'passed' | 'failed' | 'blocked' | 'unknown';
    };

export interface ScenarioChartProjectionResponse {
  version: 'scenario_chart_projection.v1';
  workspace_id: string;
  scenario_id: string;
  thesis_id: string;
  mode: ScenarioChartMode;
  symbol: string;
  market_type: 'spot' | 'perp';
  interval: MarketChartInterval;
  generated_at: string;
  source_versions: {
    decision_playbook_source: 'llm' | 'derived_v1' | 'missing';
    trade_playbook_id: string | null;
    trade_playbook_status: 'current' | 'stale' | 'superseded' | 'missing';
  };
  candles: MarketOhlcvCandleResponse[];
  overlays: ScenarioChartOverlay[];
  live_state: ScenarioLiveStateResponse;
  warnings: string[];
}
