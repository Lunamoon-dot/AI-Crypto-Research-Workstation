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
