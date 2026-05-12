"""research run degradation metadata

Revision ID: 0004_run_degradation
Revises: 0003_observability
"""

from __future__ import annotations

from alembic import op

from tradingagents.storage.migrations import ensure_column

revision = "0004_run_degradation"
down_revision = "0003_observability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    raw = op.get_bind().connection
    ensure_column(
        raw,
        "research_runs",
        "degradation_reasons_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )
    ensure_column(
        raw,
        "research_runs",
        "missing_core_data_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )
    ensure_column(
        raw,
        "research_runs",
        "missing_optional_data_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )


def downgrade() -> None:
    pass
