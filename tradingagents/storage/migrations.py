"""Idempotent SQLite journal migrations.

The project ships Alembic-compatible migration files for operators that use
Alembic directly, but the local-first CLI must also work when Alembic is not
installed.  These helpers are the single source for app-managed upgrades.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from .schema import SCHEMA_SQL

SCHEMA_VERSION = 2


HARDENING_SQL: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_research_runs_status "
    "ON research_runs(status, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_run_events_event_type "
    "ON run_events(event_type, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_watchlist_item "
    "ON alerts(watchlist_item_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_trigger_key "
    "ON alerts(alert_type, trigger_key, thesis_id, watchlist_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_market_briefs_previous "
    "ON market_briefs(previous_brief_id)",
)


def migrate_sqlite(conn: sqlite3.Connection) -> None:
    """Upgrade a journal database in-place.

    Safe to run repeatedly against both empty and existing databases.
    """
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_SQL)
    ensure_column(conn, "research_runs", "signal_snapshot_id", "TEXT")
    ensure_column(conn, "research_runs", "debate_id", "TEXT")
    ensure_column(conn, "run_events", "thesis_id", "TEXT")
    ensure_column(conn, "alerts", "trigger_key", "TEXT")
    for sql in HARDENING_SQL:
        conn.execute(sql)
    backfill_alert_trigger_keys(conn)
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def migrate_path(path: str | Path) -> None:
    db_path = Path(path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        migrate_sqlite(conn)


def ensure_column(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    column_type: str,
) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")


def backfill_alert_trigger_keys(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT id, payload_json
        FROM alerts
        WHERE trigger_key IS NULL OR trigger_key = ''
        """
    ).fetchall()
    updates: list[tuple[str, str]] = []
    for alert_id, payload_json in rows:
        trigger_key = _extract_trigger_key(payload_json)
        if trigger_key:
            updates.append((trigger_key, alert_id))
    if updates:
        conn.executemany(
            "UPDATE alerts SET trigger_key = ? WHERE id = ?",
            updates,
        )


def index_names(conn: sqlite3.Connection) -> set[str]:
    rows: Iterable[sqlite3.Row | tuple] = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'index'"
    )
    return {row["name"] if isinstance(row, sqlite3.Row) else row[0] for row in rows}


def _extract_trigger_key(payload_json: str | None) -> str | None:
    if not payload_json:
        return None
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        return None
    value = payload.get("trigger_key")
    if value is None and isinstance(payload.get("payload"), dict):
        value = payload["payload"].get("trigger_key")
    if value is None:
        return None
    text = str(value).strip()
    return text or None
