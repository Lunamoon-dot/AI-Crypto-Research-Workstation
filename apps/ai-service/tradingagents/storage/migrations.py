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
from tradingagents.signals.rules import (
    normalize_signal_payload,
    normalize_signal_snapshot_payload,
)

SCHEMA_VERSION = 7


HARDENING_SQL: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_research_runs_status "
    "ON research_runs(status, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_run_events_event_type "
    "ON run_events(event_type, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_watchlist_item "
    "ON alerts(workspace_id, watchlist_item_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_trigger_key "
    "ON alerts(workspace_id, alert_type, trigger_key, thesis_id, watchlist_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_market_briefs_previous "
    "ON market_briefs(previous_brief_id)",
    "CREATE INDEX IF NOT EXISTS idx_provider_health_provider_checked "
    "ON provider_health(provider, checked_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_provider_health_status "
    "ON provider_health(status, checked_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_llm_calls_run_created "
    "ON llm_calls(research_run_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_llm_calls_provider_status "
    "ON llm_calls(provider, status, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_data_freshness_run_observed "
    "ON data_freshness_checks(research_run_id, observed_timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_data_freshness_source_status "
    "ON data_freshness_checks(source, status, observed_timestamp DESC)",
)


TENANCY_SQL: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_research_runs_workspace_created "
    "ON research_runs(workspace_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_trade_theses_workspace_created "
    "ON trade_theses(workspace_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_signals_workspace_observed "
    "ON signals(workspace_id, observed_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_watchlists_workspace_created "
    "ON watchlists(workspace_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_watchlist_items_workspace_watchlist "
    "ON watchlist_items(workspace_id, watchlist_id, enabled, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_watchlist_items_workspace_symbol "
    "ON watchlist_items(workspace_id, symbol, enabled)",
    "CREATE INDEX IF NOT EXISTS idx_watchlist_items_workspace_thesis "
    "ON watchlist_items(workspace_id, thesis_id, enabled)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_workspace_created "
    "ON alerts(workspace_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_workspace_symbol "
    "ON alerts(workspace_id, symbol, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_workspace_thesis "
    "ON alerts(workspace_id, thesis_id, created_at DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_workspace_name "
    "ON watchlists(workspace_id, name)",
    "CREATE INDEX IF NOT EXISTS idx_market_briefs_workspace_created "
    "ON market_briefs(workspace_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_run_events_workspace_created "
    "ON run_events(workspace_id, created_at)",
)


def migrate_sqlite(conn: sqlite3.Connection) -> None:
    """Upgrade a journal database in-place.

    Safe to run repeatedly against both empty and existing databases.
    """
    conn.execute("PRAGMA foreign_keys = ON")
    _rebuild_legacy_watchlists_table(conn)
    _preensure_legacy_columns(conn)
    conn.executescript(SCHEMA_SQL)
    _ensure_workspace_columns(conn)
    ensure_column(conn, "research_runs", "deep_think_model", "TEXT")
    ensure_column(conn, "research_runs", "quick_think_model", "TEXT")
    ensure_column(conn, "research_runs", "llm_provider", "TEXT")
    ensure_column(conn, "research_runs", "config_hash", "TEXT")
    ensure_column(conn, "research_runs", "market_snapshot_id", "TEXT")
    ensure_column(conn, "research_runs", "signal_snapshot_id", "TEXT")
    ensure_column(conn, "research_runs", "debate_id", "TEXT")
    ensure_column(conn, "research_runs", "thesis_id", "TEXT")
    ensure_column(conn, "research_runs", "decision_id", "TEXT")
    ensure_column(conn, "research_runs", "user_decision_id", "TEXT")
    ensure_column(conn, "research_runs", "outcome_review_id", "TEXT")
    ensure_column(
        conn, "research_runs", "degradation_reasons_json", "TEXT NOT NULL DEFAULT '[]'"
    )
    ensure_column(
        conn, "research_runs", "missing_core_data_json", "TEXT NOT NULL DEFAULT '[]'"
    )
    ensure_column(
        conn,
        "research_runs",
        "missing_optional_data_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )
    ensure_column(conn, "run_events", "thesis_id", "TEXT")
    ensure_column(conn, "alerts", "trigger_key", "TEXT")
    for sql in HARDENING_SQL:
        conn.execute(sql)
    for sql in TENANCY_SQL:
        conn.execute(sql)
    backfill_watchlist_tenancy(conn)
    backfill_alert_trigger_keys(conn)
    backfill_legacy_signal_payloads(conn)
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def _ensure_workspace_columns(conn: sqlite3.Connection) -> None:
    for table in (
        "research_runs",
        "trade_theses",
        "signals",
        "watchlists",
        "watchlist_items",
        "alerts",
        "market_briefs",
        "run_events",
    ):
        ensure_column(conn, table, "workspace_id", "TEXT NOT NULL DEFAULT 'local'")


def _preensure_legacy_columns(conn: sqlite3.Connection) -> None:
    if _table_exists(conn, "research_runs"):
        ensure_column(
            conn, "research_runs", "workspace_id", "TEXT NOT NULL DEFAULT 'local'"
        )
        ensure_column(conn, "research_runs", "deep_think_model", "TEXT")
        ensure_column(conn, "research_runs", "quick_think_model", "TEXT")
        ensure_column(conn, "research_runs", "llm_provider", "TEXT")
        ensure_column(conn, "research_runs", "config_hash", "TEXT")
        ensure_column(conn, "research_runs", "market_snapshot_id", "TEXT")
        ensure_column(conn, "research_runs", "signal_snapshot_id", "TEXT")
        ensure_column(conn, "research_runs", "debate_id", "TEXT")
        ensure_column(conn, "research_runs", "thesis_id", "TEXT")
        ensure_column(conn, "research_runs", "decision_id", "TEXT")
        ensure_column(conn, "research_runs", "user_decision_id", "TEXT")
        ensure_column(conn, "research_runs", "outcome_review_id", "TEXT")
        ensure_column(
            conn,
            "research_runs",
            "degradation_reasons_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )
        ensure_column(
            conn,
            "research_runs",
            "missing_core_data_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )
        ensure_column(
            conn,
            "research_runs",
            "missing_optional_data_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )
    if _table_exists(conn, "run_events"):
        ensure_column(
            conn, "run_events", "workspace_id", "TEXT NOT NULL DEFAULT 'local'"
        )
        ensure_column(conn, "run_events", "thesis_id", "TEXT")
    for table in ("trade_theses", "signals", "watchlists", "market_briefs"):
        if _table_exists(conn, table):
            ensure_column(conn, table, "workspace_id", "TEXT NOT NULL DEFAULT 'local'")
    if _table_exists(conn, "watchlist_items"):
        ensure_column(
            conn, "watchlist_items", "workspace_id", "TEXT NOT NULL DEFAULT 'local'"
        )
    if _table_exists(conn, "alerts"):
        ensure_column(conn, "alerts", "workspace_id", "TEXT NOT NULL DEFAULT 'local'")
        ensure_column(conn, "alerts", "trigger_key", "TEXT")


def _rebuild_legacy_watchlists_table(conn: sqlite3.Connection) -> None:
    """Replace the old globally-unique watchlists table with workspace uniqueness."""
    if not _table_exists(conn, "watchlists"):
        return
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'watchlists'"
    ).fetchone()
    table_sql = (row[0] or "").lower() if row else ""
    has_global_unique_name = "name text not null unique" in table_sql
    has_workspace_id = any(
        column[1] == "workspace_id"
        for column in conn.execute("PRAGMA table_info(watchlists)")
    )
    if has_workspace_id and not has_global_unique_name:
        return

    foreign_keys = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("DROP TABLE IF EXISTS watchlists_workspace_migration")
        conn.execute(
            """
            CREATE TABLE watchlists_workspace_migration (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL DEFAULT 'local',
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            )
            """
        )
        workspace_expr = "workspace_id" if has_workspace_id else "'local'"
        conn.execute(
            f"""
            INSERT INTO watchlists_workspace_migration (
                id, workspace_id, name, enabled, created_at, payload_json
            )
            SELECT id, COALESCE(NULLIF({workspace_expr}, ''), 'local'),
                   name, enabled, created_at, payload_json
            FROM watchlists
            """
        )
        conn.execute("DROP TABLE watchlists")
        conn.execute("ALTER TABLE watchlists_workspace_migration RENAME TO watchlists")
    finally:
        conn.execute(f"PRAGMA foreign_keys = {int(bool(foreign_keys))}")


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


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def backfill_watchlist_tenancy(conn: sqlite3.Connection) -> None:
    if _table_exists(conn, "watchlist_items") and _table_exists(conn, "watchlists"):
        conn.execute(
            """
            UPDATE watchlist_items
            SET workspace_id = COALESCE(
                NULLIF((
                    SELECT watchlists.workspace_id
                    FROM watchlists
                    WHERE watchlists.id = watchlist_items.watchlist_id
                ), ''),
                workspace_id,
                'local'
            )
            WHERE workspace_id IS NULL OR workspace_id = '' OR workspace_id = 'local'
            """
        )
    if not _table_exists(conn, "alerts"):
        return
    conn.execute(
        """
        UPDATE alerts
        SET workspace_id = COALESCE(
            NULLIF((
                SELECT watchlist_items.workspace_id
                FROM watchlist_items
                WHERE watchlist_items.id = alerts.watchlist_item_id
            ), ''),
            NULLIF((
                SELECT trade_theses.workspace_id
                FROM trade_theses
                WHERE trade_theses.id = alerts.thesis_id
            ), ''),
            workspace_id,
            'local'
        )
        WHERE workspace_id IS NULL OR workspace_id = '' OR workspace_id = 'local'
        """
    )


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


def backfill_legacy_signal_payloads(conn: sqlite3.Connection) -> None:
    """Normalize legacy signal payloads from the pre-lane schema.

    This is intentionally idempotent. It handles old rows that stored
    ``composite_quant`` and factor payloads without lane/category/watch fields.
    """
    if not _table_exists(conn, "signals"):
        return

    signal_rows = conn.execute(
        "SELECT id, signal_type, direction, payload_json FROM signals"
    ).fetchall()
    signal_updates: list[tuple[str, str, str, str]] = []
    normalized_payloads: dict[str, dict] = {}

    for signal_id, signal_type, direction, payload_json in signal_rows:
        try:
            payload = json.loads(payload_json)
        except (TypeError, json.JSONDecodeError):
            continue
        normalized = normalize_signal_payload(payload)
        normalized_payloads[signal_id] = normalized
        new_signal_type = str(normalized.get("signal_type") or signal_type)
        new_direction = str(normalized.get("direction") or direction)
        new_payload_json = _compact_json(normalized)
        if (
            new_signal_type != signal_type
            or new_direction != direction
            or new_payload_json != payload_json
        ):
            signal_updates.append(
                (new_signal_type, new_direction, new_payload_json, signal_id)
            )

    if signal_updates:
        conn.executemany(
            """
            UPDATE signals
            SET signal_type = ?, direction = ?, payload_json = ?
            WHERE id = ?
            """,
            signal_updates,
        )

    if not _table_exists(conn, "signal_snapshots"):
        return

    snapshot_rows = conn.execute(
        "SELECT id, composite_signal_id, payload_json FROM signal_snapshots"
    ).fetchall()
    snapshot_updates: list[tuple[str | None, str, str]] = []
    for snapshot_id, composite_signal_id, payload_json in snapshot_rows:
        try:
            payload = json.loads(payload_json)
        except (TypeError, json.JSONDecodeError):
            continue
        signal_ids = [str(item) for item in payload.get("signal_ids") or [] if item]
        payloads_by_id = {
            signal_id: normalized_payloads[signal_id]
            for signal_id in signal_ids
            if signal_id in normalized_payloads
        }
        normalized = normalize_signal_snapshot_payload(
            payload,
            signal_payloads_by_id=payloads_by_id,
        )
        new_composite_signal_id = normalized.get("composite_signal_id")
        new_payload_json = _compact_json(normalized)
        if (
            new_composite_signal_id != composite_signal_id
            or new_payload_json != payload_json
        ):
            snapshot_updates.append(
                (new_composite_signal_id, new_payload_json, snapshot_id)
            )

    if snapshot_updates:
        conn.executemany(
            """
            UPDATE signal_snapshots
            SET composite_signal_id = ?, payload_json = ?
            WHERE id = ?
            """,
            snapshot_updates,
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


def _compact_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
