-- Product backend target schema.
-- Python local mode may keep SQLite; hosted/NestJS mode should use Postgres
-- with JSONB payload mirrors so both stacks can read normalized artifacts.

CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
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
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_runs_status
ON research_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    research_run_id TEXT NOT NULL REFERENCES research_runs(id),
    thesis_id TEXT,
    event_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    message TEXT NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_events_run
ON run_events(research_run_id, created_at);

CREATE TABLE IF NOT EXISTS trade_theses (
    id TEXT PRIMARY KEY,
    research_run_id TEXT REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    setup_type TEXT NOT NULL,
    confidence DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    confidence DOUBLE PRECISION,
    observed_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    source_timestamp TIMESTAMPTZ,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY,
    watchlist_id TEXT NOT NULL REFERENCES watchlists(id),
    item_type TEXT NOT NULL,
    symbol TEXT,
    thesis_id TEXT REFERENCES trade_theses(id),
    setup_type TEXT,
    enabled INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS market_briefs (
    id TEXT PRIMARY KEY,
    brief_date DATE NOT NULL,
    watchlist_name TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    previous_brief_id TEXT,
    payload_json JSONB NOT NULL
);

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
