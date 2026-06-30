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
  details: Record<string, unknown>;
}
