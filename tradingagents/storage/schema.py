"""SQLite schema for the local decision journal."""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    timeframe TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    market_snapshot_id TEXT,
    thesis_id TEXT,
    user_decision_id TEXT,
    outcome_review_id TEXT,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_runs_started_at
ON research_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_runs_symbol
ON research_runs(symbol);

CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS trade_theses (
    id TEXT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_trade_theses_run
ON trade_theses(research_run_id);

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
    research_run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(research_run_id) REFERENCES research_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_run_events_run
ON run_events(research_run_id, created_at);
"""
