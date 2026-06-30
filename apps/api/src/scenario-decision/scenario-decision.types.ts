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
