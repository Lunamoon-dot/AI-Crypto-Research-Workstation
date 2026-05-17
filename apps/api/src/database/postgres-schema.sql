-- Product backend target schema.
-- Canonical local Postgres schema/client: packages/database/prisma/schema.prisma.
-- Keep this raw SQL aligned as migration/reference material.
-- Python ai-service remains the current focus; NestJS can use DATABASE_URL
-- later when backend work resumes.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin', 'owner')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_user
ON workspace_memberships(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_workspace
ON workspace_memberships(user_id, workspace_id);

CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    symbol TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    timeframe TEXT,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
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
    degradation_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_core_data_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_optional_data_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_runs_status
ON research_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_runs_workspace_created
ON research_runs(workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS research_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    queue_backend TEXT NOT NULL,
    queue_name TEXT,
    queue_job_id TEXT,
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out')
    ),
    request_json JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    heartbeat_at TIMESTAMPTZ,
    cancellation_requested_at TIMESTAMPTZ,
    timeout_at TIMESTAMPTZ,
    result_summary_json JSONB,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_jobs_run_created
ON research_jobs(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_jobs_workspace_status
ON research_jobs(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_jobs_heartbeat
ON research_jobs(status, heartbeat_at);

CREATE TABLE IF NOT EXISTS market_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    current_price DOUBLE PRECISION,
    source TEXT NOT NULL,
    source_timestamp TIMESTAMPTZ,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_workspace_run
ON market_snapshots(workspace_id, research_run_id);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_workspace_symbol
ON market_snapshots(workspace_id, symbol, captured_at DESC);

CREATE TABLE IF NOT EXISTS signal_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT NOT NULL REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    composite_signal_id TEXT,
    signal_count INTEGER NOT NULL,
    bullish_count INTEGER NOT NULL,
    bearish_count INTEGER NOT NULL,
    neutral_count INTEGER NOT NULL,
    stale_count INTEGER NOT NULL,
    unknown_freshness_count INTEGER NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_workspace_run
ON signal_snapshots(workspace_id, research_run_id);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_workspace_symbol
ON signal_snapshots(workspace_id, symbol, captured_at DESC);

CREATE TABLE IF NOT EXISTS debates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    consensus_stance TEXT NOT NULL,
    conflict_level TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debates_workspace_run
ON debates(workspace_id, research_run_id);

CREATE TABLE IF NOT EXISTS agent_opinions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    debate_id TEXT REFERENCES debates(id),
    research_run_id TEXT REFERENCES research_runs(id),
    agent_name TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    stance TEXT NOT NULL,
    confidence DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_opinions_workspace_debate
ON agent_opinions(workspace_id, debate_id);

CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT NOT NULL REFERENCES research_runs(id),
    thesis_id TEXT,
    event_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    message TEXT NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_events_run
ON run_events(research_run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_run_events_workspace_created
ON run_events(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS trade_theses (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    setup_type TEXT NOT NULL,
    confidence DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_theses_workspace_created
ON trade_theses(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS thesis_monitor_plans (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    baseline_run_id TEXT REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    market_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'invalid', 'archived')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    baseline_price DOUBLE PRECISION,
    baseline_price_source TEXT,
    baseline_observed_at TIMESTAMPTZ,
    entry_low DOUBLE PRECISION,
    entry_high DOUBLE PRECISION,
    invalidation_level DOUBLE PRECISION,
    invalidation_direction TEXT CHECK (invalidation_direction IN ('below', 'above') OR invalidation_direction IS NULL),
    targets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    scenario_triggers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    price_interval_minutes INTEGER NOT NULL,
    signal_interval_minutes INTEGER NOT NULL,
    memo_interval_minutes INTEGER NOT NULL,
    watch_distance_pct DOUBLE PRECISION NOT NULL,
    review_distance_pct DOUBLE PRECISION NOT NULL,
    consecutive_review_to_rerun INTEGER NOT NULL,
    consecutive_invalidation_to_rerun INTEGER NOT NULL,
    run_memo_on_review BOOLEAN NOT NULL DEFAULT true,
    run_memo_on_rerun_full BOOLEAN NOT NULL DEFAULT true,
    skip_memo_if_no_new_pulses BOOLEAN NOT NULL DEFAULT true,
    enabled_signal_factors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    scheduler_enabled BOOLEAN NOT NULL DEFAULT false,
    latest_pulse_id TEXT,
    latest_memo_id TEXT,
    latest_status TEXT,
    latest_price DOUBLE PRECISION,
    latest_trigger_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_pulse_at TIMESTAMPTZ,
    next_pulse_due_at TIMESTAMPTZ,
    last_memo_at TIMESTAMPTZ,
    next_memo_due_at TIMESTAMPTZ,
    payload_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_monitor_plans_thesis
ON thesis_monitor_plans(workspace_id, thesis_id);

CREATE INDEX IF NOT EXISTS idx_thesis_monitor_plans_status
ON thesis_monitor_plans(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_monitor_plans_due
ON thesis_monitor_plans(workspace_id, scheduler_enabled, status, next_pulse_due_at, next_memo_due_at);

CREATE TABLE IF NOT EXISTS thesis_pulses (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    monitor_plan_id TEXT NOT NULL REFERENCES thesis_monitor_plans(id),
    baseline_run_id TEXT REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    market_type TEXT NOT NULL,
    pulse_type TEXT NOT NULL,
    bucket_start TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    current_price DOUBLE PRECISION,
    baseline_price DOUBLE PRECISION,
    price_change_pct DOUBLE PRECISION,
    distance_to_entry_pct DOUBLE PRECISION,
    distance_to_invalidation_pct DOUBLE PRECISION,
    nearest_target DOUBLE PRECISION,
    distance_to_nearest_target_pct DOUBLE PRECISION,
    signal_bias TEXT,
    signal_confidence DOUBLE PRECISION,
    signal_delta DOUBLE PRECISION,
    scenario_status TEXT,
    score INTEGER NOT NULL,
    status TEXT NOT NULL,
    suggested_action TEXT NOT NULL,
    trigger_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    hard_triggers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_data_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    payload_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_pulses_bucket
ON thesis_pulses(workspace_id, thesis_id, bucket_start, pulse_type);

CREATE INDEX IF NOT EXISTS idx_thesis_pulses_thesis_observed
ON thesis_pulses(workspace_id, thesis_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_pulses_status
ON thesis_pulses(workspace_id, status, observed_at DESC);

CREATE TABLE IF NOT EXISTS thesis_pulse_memos (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    monitor_plan_id TEXT NOT NULL REFERENCES thesis_monitor_plans(id),
    baseline_run_id TEXT REFERENCES research_runs(id),
    memo_type TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    what_changed_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    why_it_matters_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    what_to_watch_next_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_action TEXT NOT NULL,
    rerun_full_recommended BOOLEAN NOT NULL DEFAULT false,
    confidence DOUBLE PRECISION,
    referenced_pulse_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    prompt_version TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_pulse_memos_window
ON thesis_pulse_memos(workspace_id, thesis_id, window_start, window_end, memo_type);

CREATE INDEX IF NOT EXISTS idx_thesis_pulse_memos_thesis_created
ON thesis_pulse_memos(workspace_id, thesis_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_pulse_memos_status
ON thesis_pulse_memos(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS monitoring_jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    thesis_id TEXT REFERENCES trade_theses(id),
    job_type TEXT NOT NULL CHECK (
        job_type IN ('monitor_plan_build', 'thesis_pulse_run', 'thesis_pulse_memo_run', 'monitoring_retention_run')
    ),
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'dead_letter')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_type TEXT,
    error_message TEXT,
    idempotency_key TEXT NOT NULL,
    request_json JSONB NOT NULL,
    result_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monitoring_jobs_idempotency
ON monitoring_jobs(workspace_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_due
ON monitoring_jobs(workspace_id, status, run_after, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_thesis
ON monitoring_jobs(workspace_id, thesis_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_workers
ON monitoring_jobs(status, locked_by, locked_at);

CREATE TABLE IF NOT EXISTS monitoring_retention_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    dry_run BOOLEAN NOT NULL,
    deleted_pulses INTEGER NOT NULL DEFAULT 0,
    deleted_memos INTEGER NOT NULL DEFAULT 0,
    deleted_jobs INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    policy_json JSONB NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitoring_retention_runs_workspace_started
ON monitoring_retention_runs(workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    probability_band TEXT NOT NULL,
    suggested_user_action TEXT NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenarios_workspace_thesis
ON scenarios(workspace_id, thesis_id);

CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    symbol TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    confidence DOUBLE PRECISION,
    observed_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    source_timestamp TIMESTAMPTZ,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signals_workspace_observed
ON signals(workspace_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS watchlists (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_workspace_name
ON watchlists(workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_watchlists_workspace_created
ON watchlists(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    watchlist_id TEXT NOT NULL REFERENCES watchlists(id),
    item_type TEXT NOT NULL,
    symbol TEXT,
    thesis_id TEXT REFERENCES trade_theses(id),
    setup_type TEXT,
    enabled INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_workspace_watchlist
ON watchlist_items(workspace_id, watchlist_id);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    alert_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    thesis_id TEXT REFERENCES trade_theses(id),
    watchlist_item_id TEXT REFERENCES watchlist_items(id),
    trigger_key TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    read_at TIMESTAMPTZ,
    message TEXT NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_created
ON alerts(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_symbol
ON alerts(workspace_id, symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_thesis
ON alerts(workspace_id, thesis_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_briefs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    brief_date DATE NOT NULL,
    watchlist_name TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    previous_brief_id TEXT,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_briefs_workspace_created
ON market_briefs(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_decisions (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    action TEXT NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL,
    user_notes TEXT NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS outcome_reviews (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    result TEXT NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL,
    invalidated INTEGER NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_health (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    component TEXT,
    status TEXT NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL,
    latency_ms DOUBLE PRECISION,
    error_type TEXT,
    error_message TEXT,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
    id TEXT PRIMARY KEY,
    research_run_id TEXT REFERENCES research_runs(id),
    thesis_id TEXT REFERENCES trade_theses(id),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    stage TEXT,
    agent TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms DOUBLE PRECISION,
    status TEXT NOT NULL,
    error_type TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS data_freshness_checks (
    id TEXT PRIMARY KEY,
    research_run_id TEXT REFERENCES research_runs(id),
    symbol TEXT,
    source TEXT NOT NULL,
    source_timestamp TIMESTAMPTZ,
    observed_timestamp TIMESTAMPTZ NOT NULL,
    age_seconds INTEGER,
    threshold_seconds INTEGER,
    status TEXT NOT NULL,
    payload_json JSONB NOT NULL
);
