import type {
  MarketChartInterval,
  MarketOhlcvCandleResponse,
} from '../market-data/market-ohlcv.service';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionConditionRole,
  ScenarioRuntimeDecision,
} from './scenario-decision.types';
import type {
  TradePlaybookStaleReason,
  TradePlaybookStatus,
} from '../playbooks/playbook.types';

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

export type ScenarioChartZoneRole =
  | 'watch'
  | 'trigger'
  | 'entry'
  | 'invalidation'
  | 'target'
  | 'avoid';

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
      role: ScenarioChartZoneRole;
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

export interface VisualPointV1 {
  time: string;
  price: number;
}

export type VisualSourceRefV1 = {
  type:
    | 'trade_playbook'
    | 'scenario_chart_projection'
    | 'simulation_run'
    | 'execution_event'
    | 'technical_pattern';
  id?: string | null;
  field?: string | null;
};

export type VisualOverlayStatusV1 =
  | 'active'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'unknown';

export type VisualOverlayRoleV1 =
  | 'entry'
  | 'risk_exit'
  | 'target'
  | 'expiry'
  | 'projected_path'
  | 'pattern_support'
  | 'pattern_resistance'
  | 'pattern_channel'
  | 'pattern_boundary'
  | 'measured_move'
  | 'current_price'
  | 'paper_fill'
  | 'paper_exit';

export type VisualOverlayV1 =
  | {
      type: 'line';
      id: string;
      role: VisualOverlayRoleV1;
      points: [VisualPointV1, VisualPointV1];
      label?: string;
      style?: 'solid' | 'dashed' | 'dotted';
      status?: VisualOverlayStatusV1;
      source_ref: VisualSourceRefV1;
    }
  | {
      type: 'zone';
      id: string;
      role: VisualOverlayRoleV1;
      price_low: number;
      price_high: number;
      time_start?: string | null;
      time_end?: string | null;
      label?: string;
      opacity?: number;
      status?: VisualOverlayStatusV1;
      source_ref: VisualSourceRefV1;
    }
  | {
      type: 'box';
      id: string;
      role: 'risk_box' | 'reward_box' | 'target' | 'expiry';
      time_start: string;
      time_end: string;
      price_low: number;
      price_high: number;
      label?: string;
      status?: VisualOverlayStatusV1;
      source_ref: VisualSourceRefV1;
    }
  | {
      type: 'path';
      id: string;
      role: 'setup_path' | 'measured_move' | 'pattern_projection';
      path_semantics:
        | 'planned_setup_path'
        | 'measured_move_projection'
        | 'pattern_projection';
      points: VisualPointV1[];
      arrow_end?: boolean;
      label?: string;
      confidence?: number;
      source_ref: VisualSourceRefV1;
    }
  | {
      type: 'marker';
      id: string;
      role: 'paper_fill' | 'paper_exit' | 'expiry' | 'current_price';
      point: VisualPointV1;
      label?: string;
      event_id?: string | null;
      status?: VisualOverlayStatusV1;
      source_ref: VisualSourceRefV1;
    };

export interface VisualLabelV1 {
  id: string;
  text: string;
  point?: VisualPointV1 | null;
  source_ref: VisualSourceRefV1;
}

export interface VisualOpportunityProjectionV1 {
  schema_version: 'visual_opportunity_projection.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id?: string;
  symbol: string;
  timeframe: string;
  generated_at: string;
  source_versions: {
    trade_playbook_id?: string | null;
    trade_playbook_hash?: string | null;
    simulation_run_id?: string | null;
    scenario_chart_projection_hash?: string | null;
    scenario_chart_generated_at?: string | null;
    technical_pattern_snapshot_id?: string | null;
  };
  opportunity: {
    kind:
      | 'trade_setup'
      | 'watch_setup'
      | 'narrative_checkpoint'
      | 'blocked';
    side: 'long' | 'short' | 'neutral';
    status:
      | 'watching'
      | 'waiting_entry'
      | 'entry_touched'
      | 'open'
      | 'target_hit'
      | 'risk_exit_hit'
      | 'expired'
      | 'cancelled'
      | 'blocked'
      | 'not_chartable';
    confidence?: number;
    stale_reasons: string[];
  };
  overlays: VisualOverlayV1[];
  labels: VisualLabelV1[];
  warnings: string[];
}

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
    trade_playbook_status: TradePlaybookStatus | 'missing';
    stale_reasons: TradePlaybookStaleReason[];
  };
  candles: MarketOhlcvCandleResponse[];
  overlays: ScenarioChartOverlay[];
  live_state: ScenarioLiveStateResponse;
  warnings: string[];
  visual_projection: VisualOpportunityProjectionV1 | null;
}

export interface ScenarioChartSummaryResponse {
  version: 'scenario_chart_summary.v1';
  workspace_id: string;
  scenario_id: string;
  mode: ScenarioChartMode;
  symbol: string;
  market_type: 'spot' | 'perp';
  generated_at: string;
  trigger_status: ScenarioRuntimeDecision['trigger_status'];
  validity_status: ScenarioRuntimeDecision['validity_status'];
  trade_playbook_status: TradePlaybookStatus | 'missing';
  blocker_count: number;
  warning_count: number;
  overlay_counts: {
    decision: number;
    trade: number;
    runtime: number;
    events: number;
    total: number;
  };
  latest_event: ScenarioEventResponse | null;
}
