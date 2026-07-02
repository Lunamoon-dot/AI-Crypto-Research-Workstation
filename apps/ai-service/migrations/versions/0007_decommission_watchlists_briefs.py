"""decommission watchlists and briefs

Revision ID: 0007_decommission_watchlists_briefs
Revises: 0006_signal_legacy_normalization
"""

from __future__ import annotations

from alembic import op

revision = "0007_decommission_watchlists_briefs"
down_revision = "0006_signal_legacy_normalization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    for table in ("alerts", "watchlist_items", "watchlists", "market_briefs"):
        bind.exec_driver_sql(f"DROP TABLE IF EXISTS {table}")


def downgrade() -> None:
    pass
