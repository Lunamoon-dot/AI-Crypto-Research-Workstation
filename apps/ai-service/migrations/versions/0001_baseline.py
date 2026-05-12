"""baseline journal schema

Revision ID: 0001_baseline
Revises:
"""

from __future__ import annotations

from alembic import op

from tradingagents.storage.schema import SCHEMA_SQL

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    for statement in SCHEMA_SQL.split(";"):
        sql = statement.strip()
        if sql:
            conn.exec_driver_sql(sql)


def downgrade() -> None:
    pass
