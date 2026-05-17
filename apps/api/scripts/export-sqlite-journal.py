"""Export one research run and related SQLite journal rows as JSON.

The NestJS API uses this as a short-term bridge while the Python engine still
writes the canonical local journal to SQLite and the web reads Postgres.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any


RUN_SCOPED_TABLES = (
    "market_snapshots",
    "signal_snapshots",
    "debates",
    "run_events",
    "data_freshness_checks",
)


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print(
            "Usage: export-sqlite-journal.py <sqlite_path> <run_id>|--thesis <thesis_id>",
            file=sys.stderr,
        )
        return 2

    db_path = Path(sys.argv[1]).expanduser()
    if not db_path.exists():
        print(f"SQLite journal not found: {db_path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        if len(sys.argv) == 4 and sys.argv[2] == "--thesis":
            result = export_thesis(conn, sys.argv[3])
        elif len(sys.argv) == 3:
            result = export_run(conn, sys.argv[2])
        else:
            print(
                "Usage: export-sqlite-journal.py <sqlite_path> <run_id>|--thesis <thesis_id>",
                file=sys.stderr,
            )
            return 2
    finally:
        conn.close()

    print(json.dumps(result, ensure_ascii=True))
    return 0


def export_thesis(
    conn: sqlite3.Connection, thesis_id: str
) -> dict[str, list[dict[str, Any]]]:
    thesis = one(conn, "trade_theses", "id = ?", (thesis_id,))
    if thesis is None:
        return {"research_runs": [], "trade_theses": []}
    run_id = str(thesis.get("research_run_id") or "")
    if run_id:
        return export_run(conn, run_id)
    output: dict[str, list[dict[str, Any]]] = {
        "research_runs": [],
        "trade_theses": [thesis],
    }
    output["scenarios"] = related_by_ids(conn, "scenarios", "thesis_id", [thesis_id])
    output["user_decisions"] = related_by_ids(
        conn, "user_decisions", "thesis_id", [thesis_id]
    )
    output["outcome_reviews"] = related_by_ids(
        conn, "outcome_reviews", "thesis_id", [thesis_id]
    )
    output["alerts"] = related_by_ids(conn, "alerts", "thesis_id", [thesis_id])
    output["thesis_monitor_plans"] = related_by_ids(
        conn, "thesis_monitor_plans", "thesis_id", [thesis_id]
    )
    output["thesis_pulses"] = related_by_ids(
        conn, "thesis_pulses", "thesis_id", [thesis_id]
    )
    output["thesis_pulse_memos"] = related_by_ids(
        conn, "thesis_pulse_memos", "thesis_id", [thesis_id]
    )
    output["llm_calls"] = related_llm_calls(conn, run_id, [thesis_id])
    return output


def export_run(conn: sqlite3.Connection, run_id: str) -> dict[str, list[dict[str, Any]]]:
    run = one(conn, "research_runs", "id = ?", (run_id,))
    if run is None:
        return {"research_runs": []}

    workspace_id = str(run.get("workspace_id") or "local")
    symbol = str(run.get("symbol") or "")
    output: dict[str, list[dict[str, Any]]] = {"research_runs": [run]}

    for table in RUN_SCOPED_TABLES:
        output[table] = many(conn, table, "research_run_id = ?", (run_id,))

    debate_ids = [str(row["id"]) for row in output.get("debates", []) if row.get("id")]
    output["agent_opinions"] = related_agent_opinions(conn, run_id, debate_ids)

    theses = many(conn, "trade_theses", "research_run_id = ?", (run_id,))
    output["trade_theses"] = theses
    thesis_ids = [str(row["id"]) for row in theses if row.get("id")]

    output["scenarios"] = related_by_ids(conn, "scenarios", "thesis_id", thesis_ids)
    output["user_decisions"] = related_by_ids(
        conn, "user_decisions", "thesis_id", thesis_ids
    )
    output["outcome_reviews"] = related_by_ids(
        conn, "outcome_reviews", "thesis_id", thesis_ids
    )
    output["llm_calls"] = related_llm_calls(conn, run_id, thesis_ids)

    # Signals are not run-scoped in the SQLite schema. For MVP sync, copy the
    # current workspace+symbol signal trail so the web Signal Explorer can show
    # provenance for the run's asset.
    output["signals"] = many(
        conn,
        "signals",
        "workspace_id = ? AND symbol = ?",
        (workspace_id, symbol),
    )

    output["alerts"] = related_by_ids(conn, "alerts", "thesis_id", thesis_ids)
    output["thesis_monitor_plans"] = related_by_ids(
        conn, "thesis_monitor_plans", "thesis_id", thesis_ids
    )
    output["thesis_pulses"] = related_by_ids(
        conn, "thesis_pulses", "thesis_id", thesis_ids
    )
    output["thesis_pulse_memos"] = related_by_ids(
        conn, "thesis_pulse_memos", "thesis_id", thesis_ids
    )
    return output


def one(
    conn: sqlite3.Connection,
    table: str,
    where: str,
    params: tuple[Any, ...],
) -> dict[str, Any] | None:
    if not table_exists(conn, table):
        return None
    row = conn.execute(f"SELECT * FROM {table} WHERE {where} LIMIT 1", params).fetchone()
    return row_to_dict(row) if row else None


def many(
    conn: sqlite3.Connection,
    table: str,
    where: str,
    params: tuple[Any, ...],
) -> list[dict[str, Any]]:
    if not table_exists(conn, table):
        return []
    rows = conn.execute(f"SELECT * FROM {table} WHERE {where}", params).fetchall()
    return [row_to_dict(row) for row in rows]


def related_by_ids(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    ids: list[str],
) -> list[dict[str, Any]]:
    if not ids or not table_exists(conn, table):
        return []
    placeholders = ", ".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT * FROM {table} WHERE {column} IN ({placeholders})",
        tuple(ids),
    ).fetchall()
    return [row_to_dict(row) for row in rows]


def related_agent_opinions(
    conn: sqlite3.Connection,
    run_id: str,
    debate_ids: list[str],
) -> list[dict[str, Any]]:
    if not table_exists(conn, "agent_opinions"):
        return []
    clauses = ["research_run_id = ?"]
    params: list[Any] = [run_id]
    if debate_ids:
        placeholders = ", ".join("?" for _ in debate_ids)
        clauses.append(f"debate_id IN ({placeholders})")
        params.extend(debate_ids)
    rows = conn.execute(
        f"SELECT * FROM agent_opinions WHERE {' OR '.join(clauses)}",
        tuple(params),
    ).fetchall()
    return [row_to_dict(row) for row in rows]


def related_llm_calls(
    conn: sqlite3.Connection,
    run_id: str,
    thesis_ids: list[str],
) -> list[dict[str, Any]]:
    if not table_exists(conn, "llm_calls"):
        return []
    clauses = ["research_run_id = ?"]
    params: list[Any] = [run_id]
    if thesis_ids:
        placeholders = ", ".join("?" for _ in thesis_ids)
        clauses.append(f"thesis_id IN ({placeholders})")
        params.extend(thesis_ids)
    rows = conn.execute(
        f"SELECT * FROM llm_calls WHERE {' OR '.join(clauses)}",
        tuple(params),
    ).fetchall()
    return [row_to_dict(row) for row in rows]


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


if __name__ == "__main__":
    raise SystemExit(main())
