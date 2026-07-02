"""Idempotent SQLite journal migrations.

The project ships Alembic-compatible migration files for operators that use
Alembic directly. These helpers are the single source for app-managed upgrades
when Alembic is not installed.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from .schema import SCHEMA_SQL
from luna_workstation.signals.rules import (
    normalize_signal_payload,
    normalize_signal_snapshot_payload,
)

SCHEMA_VERSION = 11


DECOMMISSIONED_FEATURE_SQL: tuple[str, ...] = (
    "DROP TABLE IF EXISTS alerts",
    "DROP TABLE IF EXISTS watchlist_items",
    "DROP TABLE IF EXISTS watchlists",
    "DROP TABLE IF EXISTS market_briefs",
)


HARDENING_SQL: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_research_runs_status "
    "ON research_runs(status, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_run_events_event_type "
    "ON run_events(event_type, created_at DESC)",
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
    "CREATE INDEX IF NOT EXISTS idx_run_events_workspace_created "
    "ON run_events(workspace_id, created_at)",
)


def migrate_sqlite(conn: sqlite3.Connection) -> None:
    """Upgrade a journal database in-place.

    Safe to run repeatedly against both empty and existing databases.
    """
    conn.execute("PRAGMA foreign_keys = ON")
    _preensure_legacy_columns(conn)
    for sql in DECOMMISSIONED_FEATURE_SQL:
        conn.execute(sql)
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
    ensure_column(conn, "signal_model_alerts", "message", "TEXT NOT NULL DEFAULT ''")
    ensure_column(
        conn,
        "signal_model_alerts",
        "evidence_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )
    ensure_column(conn, "signal_model_alerts", "acknowledged_at", "TEXT")
    ensure_column(conn, "signal_model_alerts", "resolved_at", "TEXT")
    for sql in HARDENING_SQL:
        conn.execute(sql)
    for sql in TENANCY_SQL:
        conn.execute(sql)
    backfill_legacy_signal_payloads(conn)
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def _ensure_workspace_columns(conn: sqlite3.Connection) -> None:
    for table in (
        "research_runs",
        "trade_theses",
        "signals",
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
    for table in ("trade_theses", "signals"):
        if _table_exists(conn, table):
            ensure_column(conn, table, "workspace_id", "TEXT NOT NULL DEFAULT 'local'")


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


def _compact_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
