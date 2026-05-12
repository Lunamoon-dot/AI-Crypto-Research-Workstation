"""observability contract tables

Revision ID: 0003_observability
Revises: 0002_hardening
"""

from __future__ import annotations

from alembic import op

revision = "0003_observability"
down_revision = "0002_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.exec_driver_sql(
        """
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
        )
        """
    )
    conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_provider_health_provider_checked
        ON provider_health(provider, checked_at DESC)
        """
    )
    conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_provider_health_status
        ON provider_health(status, checked_at DESC)
        """
    )
    conn.exec_driver_sql(
        """
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
        )
        """
    )
    conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_llm_calls_run_created
        ON llm_calls(research_run_id, created_at DESC)
        """
    )
    conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_llm_calls_provider_status
        ON llm_calls(provider, status, created_at DESC)
        """
    )
    conn.exec_driver_sql(
        """
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
        )
        """
    )
    conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_data_freshness_run_observed
        ON data_freshness_checks(research_run_id, observed_timestamp DESC)
        """
    )
    conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_data_freshness_source_status
        ON data_freshness_checks(source, status, observed_timestamp DESC)
        """
    )


def downgrade() -> None:
    pass
