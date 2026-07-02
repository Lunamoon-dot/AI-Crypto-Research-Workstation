import type { JsonRecord } from '../database/journal.types';

export interface TradePlaybookResponse {
  version: 'trade_playbook.v1';
  id: string;
  workspace_id: string;
  source_scenario_id: string;
  source_thesis_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: 'long' | 'short' | 'avoid';
  horizon: string;
  entry: {
    type: 'level' | 'zone' | 'condition';
    condition: string;
    level: number | null;
    zone_low: number | null;
    zone_high: number | null;
  };
  invalidation: {
    condition: string;
    level: number | null;
  };
  targets: Array<{
    label: string;
    level: number | null;
    rationale: string;
  }>;
  no_trade_conditions: string[];
  risk_context: string[];
  sizing_policy: {
    mode: 'manual_context_only';
    notes: string[];
  };
  evidence_refs: JsonRecord[];
  reliability_context: JsonRecord | null;
  compile_warnings: string[];
  compiler_version: 'playbook_compiler.v2';
  source_hashes: {
    scenario: string;
    decision_playbook: string;
    recommendation: string;
    runtime_decision: string;
  };
  status: 'current' | 'stale' | 'superseded';
  stale_reasons: string[];
  created_at: string;
}

export interface PlaybookCompileReportResponse {
  version: 'playbook_compile_report.v1';
  eligible: boolean;
  playbook: TradePlaybookResponse | null;
  rejection_reasons: string[];
  warnings: string[];
}
