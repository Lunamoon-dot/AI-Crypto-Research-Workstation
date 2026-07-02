"""hardening indexes

Revision ID: 0002_hardening
Revises: 0001_baseline
"""

from __future__ import annotations

from alembic import op

from luna_workstation.storage.migrations import HARDENING_SQL

revision = "0002_hardening"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    for sql in HARDENING_SQL:
        conn.exec_driver_sql(sql)


def downgrade() -> None:
    pass
