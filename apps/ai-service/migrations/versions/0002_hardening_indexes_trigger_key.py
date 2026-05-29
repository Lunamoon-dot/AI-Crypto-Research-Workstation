"""hardening indexes and alert trigger keys

Revision ID: 0002_hardening
Revises: 0001_baseline
"""

from __future__ import annotations

from alembic import op

from luna_workstation.storage.migrations import (
    HARDENING_SQL,
    backfill_alert_trigger_keys,
    ensure_column,
)

revision = "0002_hardening"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    raw = conn.connection
    ensure_column(raw, "alerts", "trigger_key", "TEXT")
    for sql in HARDENING_SQL:
        conn.exec_driver_sql(sql)
    backfill_alert_trigger_keys(raw)


def downgrade() -> None:
    pass
