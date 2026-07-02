"""SQLite schema for the local decision journal."""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    symbol TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    timeframe TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    deep_think_model TEXT,
    quick_think_model TEXT,
    llm_provider TEXT,
    config_hash TEXT,
    market_snapshot_id TEXT,
    signal_snapshot_id TEXT,
    debate_id TEXT,
    thesis_id TEXT,
    decision_id TEXT,
    user_decision_id TEXT,
    outcome_review_id TEXT,
    degradation_reasons_json TEXT NOT NULL DEFAULT '[]',
    missing_core_data_json TEXT NOT NULL DEFAULT '[]',
    missing_optional_data_json TEXT NOT NULL DEFAULT '[]',
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_runs_started_at
ON research_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_runs_workspace_created
ON research_runs(workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_runs_symbol
ON research_runs(symbol);

CREATE INDEX IF NOT EXISTS idx_research_runs_status
ON research_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS market_snapshots (
    id TEXT PRIMARY KEY,
    research_run_id TEXT,
    symbol TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    current_price REAL,
    source TEXT NOT NULL,
    source_timestamp TEXT,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_run
ON market_snapshots(research_run_id);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_symbol_captured
ON market_snapshots(symbol, captured_at DESC);

CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    symbol TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    confidence REAL,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL,
    source_timestamp TEXT,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_observed
ON signals(symbol, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signals_workspace_observed
ON signals(workspace_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS signal_snapshots (
    id TEXT PRIMARY KEY,
    research_run_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    composite_signal_id TEXT,
    signal_count INTEGER NOT NULL,
    bullish_count INTEGER NOT NULL,
    bearish_count INTEGER NOT NULL,
    neutral_count INTEGER NOT NULL,
    stale_count INTEGER NOT NULL,
    unknown_freshness_count INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_run
ON signal_snapshots(research_run_id);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_symbol_captured
ON signal_snapshots(symbol, captured_at DESC);

CREATE TABLE IF NOT EXISTS debates (
    id TEXT PRIMARY KEY,
    research_run_id TEXT,
    symbol TEXT NOT NULL,
    consensus_stance TEXT NOT NULL,
    conflict_level TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_debates_run
ON debates(research_run_id);

CREATE INDEX IF NOT EXISTS idx_debates_symbol_created
ON debates(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_opinions (
    id TEXT PRIMARY KEY,
    research_run_id TEXT,
    debate_id TEXT,
    agent_name TEXT NOT NULL,
    role TEXT NOT NULL,
    stance TEXT NOT NULL,
    confidence REAL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id),
    FOREIGN KEY(debate_id) REFERENCES debates(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_opinions_run
ON agent_opinions(research_run_id);

CREATE INDEX IF NOT EXISTS idx_agent_opinions_debate
ON agent_opinions(debate_id);

CREATE TABLE IF NOT EXISTS trade_theses (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    setup_type TEXT NOT NULL,
    confidence REAL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_trade_theses_created_at
ON trade_theses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_theses_workspace_created
ON trade_theses(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_theses_run
ON trade_theses(research_run_id);

CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    probability_band TEXT NOT NULL,
    suggested_user_action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(thesis_id) REFERENCES trade_theses(id)
);

CREATE INDEX IF NOT EXISTS idx_scenarios_thesis
ON scenarios(thesis_id);

CREATE TABLE IF NOT EXISTS user_decisions (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    action TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    user_notes TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(thesis_id) REFERENCES trade_theses(id)
);

CREATE INDEX IF NOT EXISTS idx_user_decisions_thesis
ON user_decisions(thesis_id);

CREATE TABLE IF NOT EXISTS outcome_reviews (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    result TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    invalidated INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(thesis_id) REFERENCES trade_theses(id)
);

CREATE INDEX IF NOT EXISTS idx_outcome_reviews_thesis
ON outcome_reviews(thesis_id);

CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT NOT NULL,
    thesis_id TEXT,
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_run_events_run
ON run_events(research_run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_run_events_workspace_created
ON run_events(workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_run_events_thesis
ON run_events(thesis_id, created_at);

CREATE INDEX IF NOT EXISTS idx_run_events_event_type
ON run_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_health (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    component TEXT,
    status TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    latency_ms REAL,
    error_type TEXT,
    error_message TEXT,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_health_provider_checked
ON provider_health(provider, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_health_status
ON provider_health(status, checked_at DESC);

CREATE TABLE IF NOT EXISTS llm_calls (
    id TEXT PRIMARY KEY,
    research_run_id TEXT,
    thesis_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    stage TEXT,
    agent TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms REAL,
    status TEXT NOT NULL,
    error_type TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id),
    FOREIGN KEY(thesis_id) REFERENCES trade_theses(id)
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_run_created
ON llm_calls(research_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_calls_provider_status
ON llm_calls(provider, status, created_at DESC);

CREATE TABLE IF NOT EXISTS data_freshness_checks (
    id TEXT PRIMARY KEY,
    research_run_id TEXT,
    symbol TEXT,
    source TEXT NOT NULL,
    source_timestamp TEXT,
    observed_timestamp TEXT NOT NULL,
    age_seconds INTEGER,
    threshold_seconds INTEGER,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_data_freshness_run_observed
ON data_freshness_checks(research_run_id, observed_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_data_freshness_source_status
ON data_freshness_checks(source, status, observed_timestamp DESC);

CREATE TABLE IF NOT EXISTS thesis_evaluations (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    evaluated_at TEXT NOT NULL,
    evaluation_start TEXT NOT NULL,
    evaluation_end TEXT NOT NULL,
    result TEXT NOT NULL,
    invalidated INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(thesis_id) REFERENCES trade_theses(id)
);

CREATE INDEX IF NOT EXISTS idx_thesis_evaluations_thesis
ON thesis_evaluations(thesis_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_evaluations_symbol
ON thesis_evaluations(symbol, evaluated_at DESC);

-- Phase 4 (tail): Reliability snapshots for rolling-window factor performance
CREATE TABLE IF NOT EXISTS reliability_snapshots (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    rolling_window_days INTEGER NOT NULL,
    overall_hit_rate REAL,
    overall_sample_size INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reliability_snapshots_symbol_date
ON reliability_snapshots(symbol, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_reliability_snapshots_window
ON reliability_snapshots(rolling_window_days, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS signal_observations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    research_run_id TEXT,
    signal_snapshot_id TEXT,
    signal_id TEXT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source_timestamp TEXT,
    observation_kind TEXT NOT NULL,
    factor_name TEXT NOT NULL,
    factor_family TEXT NOT NULL,
    direction TEXT NOT NULL,
    directional_edge REAL,
    heuristic_strength REAL,
    detector_confidence REAL,
    data_quality REAL,
    availability TEXT NOT NULL,
    raw_value REAL,
    threshold_breached INTEGER NOT NULL DEFAULT 0,
    market_regime TEXT NOT NULL DEFAULT 'unknown',
    volatility_regime TEXT NOT NULL DEFAULT 'unknown',
    provider TEXT,
    source_snapshot_hash TEXT,
    code_sha TEXT,
    signal_weight_version TEXT NOT NULL DEFAULT 'unknown',
    signal_threshold_version TEXT NOT NULL DEFAULT 'unknown',
    detector_version TEXT NOT NULL DEFAULT 'unknown',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_observations_workspace_observed
ON signal_observations(workspace_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_observations_workspace_symbol
ON signal_observations(workspace_id, symbol, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_observations_factor
ON signal_observations(workspace_id, factor_name, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_observations_snapshot
ON signal_observations(workspace_id, signal_snapshot_id);

CREATE TABLE IF NOT EXISTS signal_outcome_labels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    horizon_minutes INTEGER NOT NULL,
    label_status TEXT NOT NULL,
    label_version TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_outcomes_unique_version
ON signal_outcome_labels(workspace_id, observation_id, horizon_minutes, label_version);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_workspace_symbol
ON signal_outcome_labels(workspace_id, symbol, horizon_minutes);

CREATE TABLE IF NOT EXISTS signal_evaluation_reports (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    report_version TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    symbol TEXT,
    factor_name TEXT,
    horizon_minutes INTEGER NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_eval_reports_workspace_generated
ON signal_evaluation_reports(workspace_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_eval_reports_workspace_symbol
ON signal_evaluation_reports(workspace_id, symbol, horizon_minutes, generated_at DESC);

CREATE TABLE IF NOT EXISTS signal_weight_versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL,
    horizon_minutes INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    promoted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_weight_versions_workspace_version
ON signal_weight_versions(workspace_id, version);

CREATE TABLE IF NOT EXISTS signal_calibrator_versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    version TEXT NOT NULL,
    weight_version TEXT NOT NULL,
    status TEXT NOT NULL,
    horizon_minutes INTEGER NOT NULL,
    publishable INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    promoted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_calibrator_versions_workspace_version
ON signal_calibrator_versions(workspace_id, version);

CREATE TABLE IF NOT EXISTS signal_model_promotions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    to_weight_version TEXT NOT NULL,
    to_calibrator_version TEXT NOT NULL,
    promoted_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_model_promotions_workspace
ON signal_model_promotions(workspace_id, promoted_at DESC);

CREATE TABLE IF NOT EXISTS signal_model_monitoring_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    active_weight_version TEXT,
    active_calibrator_version TEXT,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_model_monitoring_workspace
ON signal_model_monitoring_snapshots(workspace_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS signal_model_alerts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    active_weight_version TEXT,
    active_calibrator_version TEXT,
    symbol TEXT,
    factor_name TEXT,
    message TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    acknowledged_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_model_alerts_workspace_status
ON signal_model_alerts(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS signal_model_rollbacks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    from_weight_version TEXT NOT NULL,
    to_weight_version TEXT NOT NULL,
    from_calibrator_version TEXT NOT NULL,
    to_calibrator_version TEXT NOT NULL,
    executed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_model_rollbacks_workspace
ON signal_model_rollbacks(workspace_id, executed_at DESC);
"""
