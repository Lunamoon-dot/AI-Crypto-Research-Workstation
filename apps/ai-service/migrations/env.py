"""Alembic environment for the local SQLite journal."""

from __future__ import annotations

from pathlib import Path

from alembic import context

config = context.config


def _db_url() -> str:
    raw = config.get_main_option("sqlalchemy.url")
    if raw:
        return raw
    from luna_workstation.default_config import DEFAULT_CONFIG
    from luna_workstation.services.journal_service import resolve_journal_db_path

    path = Path(resolve_journal_db_path(DEFAULT_CONFIG)).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path.as_posix()}"


def run_migrations_offline() -> None:
    context.configure(url=_db_url(), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine

    engine = create_engine(_db_url())
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
