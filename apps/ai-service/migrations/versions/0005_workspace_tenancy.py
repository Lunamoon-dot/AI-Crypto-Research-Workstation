"""workspace tenancy columns

Revision ID: 0005_workspace_tenancy
Revises: 0004_run_degradation
"""

from __future__ import annotations

from alembic import op

from luna_workstation.storage.migrations import ensure_column

revision = "0005_workspace_tenancy"
down_revision = "0004_run_degradation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    raw = bind.connection
    for table in (
        "research_runs",
        "trade_theses",
        "signals",
        "run_events",
    ):
        ensure_column(raw, table, "workspace_id", "TEXT NOT NULL DEFAULT 'local'")

    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_research_runs_workspace_created "
        "ON research_runs(workspace_id, started_at DESC)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_trade_theses_workspace_created "
        "ON trade_theses(workspace_id, created_at DESC)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_signals_workspace_observed "
        "ON signals(workspace_id, observed_at DESC)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_run_events_workspace_created "
        "ON run_events(workspace_id, created_at)"
    )


def downgrade() -> None:
    pass
