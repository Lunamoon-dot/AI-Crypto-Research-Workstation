"""Delete run-scoped rows from the local SQLite journal for one workspace."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "Usage: delete-sqlite-journal-run-data.py <sqlite_path> <workspace_id>",
            file=sys.stderr,
        )
        return 2

    db_path = Path(sys.argv[1]).expanduser()
    workspace_id = sys.argv[2]
    if not db_path.exists():
        print(f"SQLite journal not found: {db_path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(db_path))
    try:
        deleted_rows = delete_workspace_run_data(conn, workspace_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(
        json.dumps(
            {
                "workspace_id": workspace_id,
                "sqlite_path": str(db_path),
                "deleted_rows": deleted_rows,
            },
            ensure_ascii=True,
        )
    )
    return 0


def delete_workspace_run_data(
    conn: sqlite3.Connection,
    workspace_id: str,
) -> dict[str, int]:
    run_ids = ids(conn, "research_runs", "workspace_id = ?", (workspace_id,))
    thesis_ids = ids_by_values(conn, "trade_theses", "research_run_id", run_ids)
    debate_ids = ids_by_values(conn, "debates", "research_run_id", run_ids)
    watchlist_item_ids = ids_by_values(
        conn,
        "watchlist_items",
        "thesis_id",
        thesis_ids,
        extra_where="workspace_id = ?",
        extra_params=(workspace_id,),
    )
    deleted: dict[str, int] = {}

    delete_by_values(
        conn,
        deleted,
        "alerts",
        "thesis_id",
        thesis_ids,
        extra_where="workspace_id = ?",
        extra_params=(workspace_id,),
    )
    delete_by_values(
        conn,
        deleted,
        "alerts",
        "watchlist_item_id",
        watchlist_item_ids,
        extra_where="workspace_id = ?",
        extra_params=(workspace_id,),
    )
    delete_by_values(
        conn,
        deleted,
        "watchlist_items",
        "thesis_id",
        thesis_ids,
        extra_where="workspace_id = ?",
        extra_params=(workspace_id,),
    )

    for table in (
        "thesis_evaluation_promotions",
        "thesis_evaluation_runs",
        "thesis_evaluations",
        "scenarios",
        "user_decisions",
        "outcome_reviews",
    ):
        delete_by_values(conn, deleted, table, "thesis_id", thesis_ids)

    delete_by_values(conn, deleted, "llm_calls", "research_run_id", run_ids)
    delete_by_values(conn, deleted, "llm_calls", "thesis_id", thesis_ids)
    delete_by_values(conn, deleted, "data_freshness_checks", "research_run_id", run_ids)
    delete_by_values(conn, deleted, "agent_opinions", "research_run_id", run_ids)
    delete_by_values(conn, deleted, "agent_opinions", "debate_id", debate_ids)

    for table in (
        "debates",
        "run_events",
        "market_snapshots",
        "signal_snapshots",
        "research_snapshots",
        "research_continuity_debug_access_audits",
        "research_continuity_entries",
    ):
        delete_by_values(conn, deleted, table, "research_run_id", run_ids)

    delete_by_values(conn, deleted, "research_continuity_states", "latest_run_id", run_ids)
    delete_by_values(conn, deleted, "trade_theses", "id", thesis_ids)
    delete_where(conn, deleted, "signals", "workspace_id = ?", (workspace_id,))
    delete_by_values(conn, deleted, "research_runs", "id", run_ids)
    return deleted


def ids(
    conn: sqlite3.Connection,
    table: str,
    where: str,
    params: tuple[Any, ...],
) -> list[str]:
    if not table_exists(conn, table):
        return []
    rows = conn.execute(f"SELECT id FROM {table} WHERE {where}", params).fetchall()
    return [str(row[0]) for row in rows if row[0]]


def ids_by_values(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    values: list[str],
    *,
    extra_where: str | None = None,
    extra_params: tuple[Any, ...] = (),
) -> list[str]:
    if not values or not table_exists(conn, table):
        return []
    placeholders = ", ".join("?" for _ in values)
    where = f"{column} IN ({placeholders})"
    params: tuple[Any, ...] = tuple(values)
    if extra_where:
        where = f"{extra_where} AND {where}"
        params = extra_params + params
    return ids(conn, table, where, params)


def delete_by_values(
    conn: sqlite3.Connection,
    deleted: dict[str, int],
    table: str,
    column: str,
    values: list[str],
    *,
    extra_where: str | None = None,
    extra_params: tuple[Any, ...] = (),
) -> None:
    if not values or not table_exists(conn, table):
        return
    placeholders = ", ".join("?" for _ in values)
    where = f"{column} IN ({placeholders})"
    params: tuple[Any, ...] = tuple(values)
    if extra_where:
        where = f"{extra_where} AND {where}"
        params = extra_params + params
    delete_where(conn, deleted, table, where, params)


def delete_where(
    conn: sqlite3.Connection,
    deleted: dict[str, int],
    table: str,
    where: str,
    params: tuple[Any, ...],
) -> None:
    if not table_exists(conn, table):
        return
    cursor = conn.execute(f"DELETE FROM {table} WHERE {where}", params)
    deleted[table] = deleted.get(table, 0) + max(cursor.rowcount, 0)


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


if __name__ == "__main__":
    raise SystemExit(main())
