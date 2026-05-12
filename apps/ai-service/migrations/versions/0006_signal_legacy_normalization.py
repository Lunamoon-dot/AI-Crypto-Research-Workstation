"""signal legacy normalization

Revision ID: 0006_signal_legacy_normalization
Revises: 0005_workspace_tenancy
"""

from __future__ import annotations

from alembic import op

from tradingagents.storage.migrations import backfill_legacy_signal_payloads

revision = "0006_signal_legacy_normalization"
down_revision = "0005_workspace_tenancy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    raw = op.get_bind().connection
    backfill_legacy_signal_payloads(raw)


def downgrade() -> None:
    pass
