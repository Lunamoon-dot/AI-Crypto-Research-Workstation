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
    scope_type TEXT NOT NULL DEFAULT 'legacy_mixed'
        CHECK (scope_type IN ('fixed_symbol', 'legacy_mixed')),
    symbol TEXT,
    market_type TEXT NOT NULL DEFAULT 'mixed'
        CHECK (market_type IN ('mixed', 'spot', 'perp')),
    default_timeframe TEXT,
    archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

CREATE TABLE IF NOT EXISTS workspace_news_sources (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    target_analysts_json JSONB NOT NULL DEFAULT '["news"]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_news_sources_workspace_order
ON workspace_news_sources(workspace_id, sort_order, source_id);

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

CREATE TABLE IF NOT EXISTS research_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    research_run_id TEXT NOT NULL REFERENCES research_runs(id),
    symbol TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    time_context TEXT NOT NULL,
    symbol_view_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    tracked_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_artifacts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_snapshots_workspace_run
ON research_snapshots(workspace_id, research_run_id);

CREATE INDEX IF NOT EXISTS idx_research_snapshots_workspace_symbol
ON research_snapshots(workspace_id, symbol, captured_at DESC);

CREATE TABLE IF NOT EXISTS research_continuity_entries (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    symbol TEXT NOT NULL,
    research_run_id TEXT NOT NULL REFERENCES research_runs(id),
    current_snapshot_id TEXT REFERENCES research_snapshots(id),
    previous_entry_id TEXT REFERENCES research_continuity_entries(id),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('baseline', 'delta', 'degraded', 'skipped')),
    status TEXT NOT NULL CHECK (status IN ('completed', 'degraded', 'skipped', 'failed')),
    generated_at TIMESTAMPTZ NOT NULL,
    summary TEXT NOT NULL,
    sections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    events_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    snapshot_quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_run_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    writer_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_continuity_entries_symbol
ON research_continuity_entries(workspace_id, symbol, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_continuity_entries_run
ON research_continuity_entries(workspace_id, research_run_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS research_continuity_debug_access_audits (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    entry_id TEXT NOT NULL,
    research_run_id TEXT,
    symbol TEXT,
    requested_by_user_id TEXT,
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
    reason TEXT NOT NULL CHECK (
        reason IN (
            'allowed',
            'disabled_by_policy',
            'missing_user',
            'missing_workspace',
            'workspace_denied',
            'permission_required',
            'entry_not_found',
            'audit_unavailable'
        )
    ),
    requested_at TIMESTAMPTZ NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_research_continuity_debug_audits_workspace_requested
ON research_continuity_debug_access_audits(workspace_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_continuity_debug_audits_workspace_entry
ON research_continuity_debug_access_audits(workspace_id, entry_id);

CREATE INDEX IF NOT EXISTS idx_research_continuity_debug_audits_workspace_decision
ON research_continuity_debug_access_audits(workspace_id, decision, requested_at DESC);

CREATE TABLE IF NOT EXISTS research_continuity_repair_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    requested_by_user_id TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    dry_run BOOLEAN NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('started', 'completed', 'completed_with_failures', 'failed')
    ),
    idempotency_key TEXT,
    filters_json JSONB NOT NULL,
    requested_count INTEGER NOT NULL DEFAULT 0,
    repaired_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_entry_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    results_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_continuity_repair_runs_workspace_requested
ON research_continuity_repair_runs(workspace_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_continuity_repair_runs_workspace_status
ON research_continuity_repair_runs(workspace_id, status, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_continuity_repair_runs_idempotency
ON research_continuity_repair_runs(workspace_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_continuity_workspace_settings (
    workspace_id TEXT PRIMARY KEY,
    scheduled_repair_mode TEXT NOT NULL DEFAULT 'disabled' CHECK (
        scheduled_repair_mode IN ('disabled', 'dry_run', 'enabled')
    ),
    scheduled_repair_case_types_json JSONB NOT NULL DEFAULT '["missing_continuity","legacy_evidence"]'::jsonb,
    scheduled_repair_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (
        scheduled_repair_interval_hours BETWEEN 1 AND 168
    ),
    scheduled_repair_lookback_days INTEGER NOT NULL DEFAULT 30 CHECK (
        scheduled_repair_lookback_days BETWEEN 1 AND 365
    ),
    scheduled_repair_limit INTEGER NOT NULL DEFAULT 25 CHECK (
        scheduled_repair_limit BETWEEN 1 AND 100
    ),
    next_scheduled_repair_due_at TIMESTAMPTZ,
    last_scheduled_repair_at TIMESTAMPTZ,
    last_scheduled_repair_run_id TEXT,
    scheduler_lease_owner TEXT,
    scheduler_lease_expires_at TIMESTAMPTZ,
    last_scheduler_attempt_at TIMESTAMPTZ,
    last_scheduler_success_at TIMESTAMPTZ,
    last_scheduler_error TEXT,
    consecutive_scheduler_failures INTEGER NOT NULL DEFAULT 0,
    next_scheduler_retry_at TIMESTAMPTZ,
    updated_by_user_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE research_continuity_workspace_settings
ADD COLUMN IF NOT EXISTS scheduler_lease_owner TEXT,
ADD COLUMN IF NOT EXISTS scheduler_lease_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_scheduler_attempt_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_scheduler_success_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_scheduler_error TEXT,
ADD COLUMN IF NOT EXISTS consecutive_scheduler_failures INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_scheduler_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_research_continuity_workspace_settings_due
ON research_continuity_workspace_settings(scheduled_repair_mode, next_scheduled_repair_due_at);

CREATE INDEX IF NOT EXISTS idx_research_continuity_workspace_settings_worker_due
ON research_continuity_workspace_settings(
    scheduled_repair_mode,
    next_scheduler_retry_at,
    next_scheduled_repair_due_at,
    scheduler_lease_expires_at
);

CREATE INDEX IF NOT EXISTS idx_research_continuity_workspace_settings_updated
ON research_continuity_workspace_settings(updated_at DESC);

CREATE TABLE IF NOT EXISTS research_continuity_states (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    symbol TEXT NOT NULL,
    current_snapshot_id TEXT REFERENCES research_snapshots(id),
    latest_entry_id TEXT REFERENCES research_continuity_entries(id),
    latest_run_id TEXT REFERENCES research_runs(id),
    current_view_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    active_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    recent_resolved_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    recent_invalidated_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_continuity_states_symbol
ON research_continuity_states(workspace_id, symbol);

CREATE INDEX IF NOT EXISTS idx_research_continuity_states_workspace
ON research_continuity_states(workspace_id, updated_at DESC);

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

CREATE TABLE IF NOT EXISTS thesis_evaluations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    outcome_review_id TEXT,
    symbol TEXT NOT NULL,
    window_days INTEGER NOT NULL,
    evaluation_start DATE NOT NULL,
    evaluation_end DATE NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL,
    result TEXT NOT NULL,
    max_favorable_excursion DOUBLE PRECISION,
    max_adverse_excursion DOUBLE PRECISION,
    invalidated BOOLEAN NOT NULL DEFAULT false,
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_evaluations_unique_window
ON thesis_evaluations(workspace_id, thesis_id, window_days, evaluation_start, evaluation_end);

CREATE INDEX IF NOT EXISTS idx_thesis_evaluations_thesis
ON thesis_evaluations(workspace_id, thesis_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_evaluations_workspace
ON thesis_evaluations(workspace_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS thesis_evaluation_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    canonical_evaluation_id TEXT NOT NULL REFERENCES thesis_evaluations(id),
    thesis_id TEXT NOT NULL REFERENCES trade_theses(id),
    symbol TEXT NOT NULL,
    window_days INTEGER NOT NULL,
    evaluation_start DATE NOT NULL,
    evaluation_end DATE NOT NULL,
    requested_by_user_id TEXT,
    requested_at TIMESTAMPTZ NOT NULL,
    evaluated_at TIMESTAMPTZ,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    idempotency_key TEXT,
    status TEXT NOT NULL,
    result TEXT,
    max_favorable_excursion DOUBLE PRECISION,
    max_adverse_excursion DOUBLE PRECISION,
    invalidated BOOLEAN,
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_type TEXT,
    error_message TEXT,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thesis_evaluation_runs_evaluation
ON thesis_evaluation_runs(workspace_id, canonical_evaluation_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_evaluation_runs_thesis
ON thesis_evaluation_runs(workspace_id, thesis_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_evaluation_runs_idempotency
ON thesis_evaluation_runs(workspace_id, canonical_evaluation_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS thesis_evaluation_promotions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    canonical_evaluation_id TEXT NOT NULL REFERENCES thesis_evaluations(id),
    promoted_rerun_id TEXT REFERENCES thesis_evaluation_runs(id),
    action TEXT NOT NULL,
    promoted_by_user_id TEXT,
    promoted_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    idempotency_key TEXT,
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thesis_evaluation_promotions_evaluation
ON thesis_evaluation_promotions(workspace_id, canonical_evaluation_id, promoted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_evaluation_promotions_idempotency
ON thesis_evaluation_promotions(workspace_id, canonical_evaluation_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS scenario_evaluations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    thesis_id TEXT NOT NULL,
    research_run_id TEXT,
    symbol TEXT NOT NULL,
    market_type TEXT NOT NULL DEFAULT 'spot',
    horizon TEXT NOT NULL DEFAULT 'unknown',
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    evaluation_window JSONB NOT NULL DEFAULT '{}'::jsonb,
    result TEXT NOT NULL,
    trigger_hit BOOLEAN,
    invalidation_hit BOOLEAN,
    target_hit BOOLEAN,
    start_price DOUBLE PRECISION,
    end_price DOUBLE PRECISION,
    max_favorable_excursion DOUBLE PRECISION,
    max_adverse_excursion DOUBLE PRECISION,
    data_quality TEXT NOT NULL DEFAULT 'insufficient',
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_evaluations_scenario
ON scenario_evaluations(workspace_id, scenario_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS trade_playbooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    source_scenario_id TEXT NOT NULL,
    source_thesis_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    market_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    horizon TEXT NOT NULL DEFAULT 'unknown',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_playbooks_scenario
ON trade_playbooks(workspace_id, source_scenario_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scenario_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    thesis_id TEXT,
    event_type TEXT NOT NULL,
    event_time TIMESTAMPTZ NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_events_scenario
ON scenario_events(workspace_id, scenario_id, event_time DESC, id DESC);

CREATE TABLE IF NOT EXISTS backtest_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    playbook_id TEXT NOT NULL,
    status TEXT NOT NULL,
    assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_quality TEXT NOT NULL DEFAULT 'insufficient',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_playbook
ON backtest_runs(workspace_id, playbook_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backtest_trade_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    backtest_run_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    price DOUBLE PRECISION,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_backtest_trade_events_run
ON backtest_trade_events(workspace_id, backtest_run_id, event_index ASC);

CREATE TABLE IF NOT EXISTS scenario_decision_item_states (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    status TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (workspace_id, id)
);

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

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'local',
    alert_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    thesis_id TEXT REFERENCES trade_theses(id),
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

CREATE TABLE IF NOT EXISTS signal_observations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    research_run_id TEXT,
    signal_snapshot_id TEXT,
    signal_id TEXT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    source_timestamp TIMESTAMPTZ,
    observation_kind TEXT NOT NULL,
    factor_name TEXT NOT NULL,
    factor_family TEXT NOT NULL,
    direction TEXT NOT NULL,
    directional_edge DOUBLE PRECISION,
    heuristic_strength DOUBLE PRECISION,
    detector_confidence DOUBLE PRECISION,
    data_quality DOUBLE PRECISION,
    availability TEXT NOT NULL,
    raw_value DOUBLE PRECISION,
    threshold_breached BOOLEAN NOT NULL DEFAULT FALSE,
    market_regime TEXT NOT NULL DEFAULT 'unknown',
    volatility_regime TEXT NOT NULL DEFAULT 'unknown',
    provider TEXT,
    source_snapshot_hash TEXT,
    code_sha TEXT,
    signal_weight_version TEXT NOT NULL DEFAULT 'unknown',
    signal_threshold_version TEXT NOT NULL DEFAULT 'unknown',
    detector_version TEXT NOT NULL DEFAULT 'unknown',
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_outcome_labels_identity
ON signal_outcome_labels(workspace_id, observation_id, horizon_minutes, label_version);

CREATE INDEX IF NOT EXISTS idx_signal_outcome_labels_symbol_horizon
ON signal_outcome_labels(workspace_id, symbol, horizon_minutes);

CREATE TABLE IF NOT EXISTS signal_evaluation_reports (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    report_version TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    symbol TEXT,
    factor_name TEXT,
    horizon_minutes INTEGER NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_signal_evaluation_reports_workspace_generated
ON signal_evaluation_reports(workspace_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_evaluation_reports_symbol_horizon
ON signal_evaluation_reports(workspace_id, symbol, horizon_minutes, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_evaluation_reports_factor_horizon
ON signal_evaluation_reports(workspace_id, factor_name, horizon_minutes, generated_at DESC);

CREATE TABLE IF NOT EXISTS signal_weight_versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL,
    horizon_minutes INTEGER NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    promoted_at TIMESTAMPTZ
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
    publishable BOOLEAN NOT NULL DEFAULT FALSE,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    promoted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_calibrator_versions_workspace_version
ON signal_calibrator_versions(workspace_id, version);

CREATE TABLE IF NOT EXISTS signal_model_promotions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    to_weight_version TEXT NOT NULL,
    to_calibrator_version TEXT NOT NULL,
    promoted_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_signal_model_promotions_workspace_promoted
ON signal_model_promotions(workspace_id, promoted_at DESC);

CREATE TABLE IF NOT EXISTS signal_model_monitoring_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    active_weight_version TEXT,
    active_calibrator_version TEXT,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_signal_model_monitoring_workspace_generated
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
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
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
    executed_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_signal_model_rollbacks_workspace_executed
ON signal_model_rollbacks(workspace_id, executed_at DESC);
