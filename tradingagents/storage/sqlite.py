"""Small SQLite helper for local-first persistence."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Iterable

from tradingagents.exceptions import StorageError
from tradingagents.observability import start_span

from .migrations import ensure_column, migrate_sqlite


class SQLiteStore:
    """Owns the journal database path and connection creation."""

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA synchronous = NORMAL")
        return conn

    def initialize(self) -> None:
        with sqlite3.connect(self.path) as conn:
            # Persist WAL mode so every connection (including other
            # processes) benefits from concurrent-read behaviour.
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.execute("PRAGMA busy_timeout = 5000")
            conn.execute("PRAGMA foreign_keys = ON")
            migrate_sqlite(conn)

    @staticmethod
    def _ensure_column(
        conn: sqlite3.Connection,
        table: str,
        column: str,
        column_type: str,
    ) -> None:
        ensure_column(conn, table, column, column_type)

    def execute(self, sql: str, params: Iterable = (), *, _conn: sqlite3.Connection | None = None) -> None:
        try:
            if _conn is not None:
                with start_span("sqlite.execute", db_path=str(self.path)):
                    _conn.execute(sql, tuple(params))
                return
            with self.connect() as conn:
                with start_span("sqlite.execute", db_path=str(self.path)):
                    conn.execute(sql, tuple(params))
        except sqlite3.Error as exc:
            raise StorageError(f"SQLite execute failed: {exc}") from exc

    def fetchone(self, sql: str, params: Iterable = ()) -> sqlite3.Row | None:
        try:
            with self.connect() as conn:
                with start_span("sqlite.fetchone", db_path=str(self.path)):
                    return conn.execute(sql, tuple(params)).fetchone()
        except sqlite3.Error as exc:
            raise StorageError(f"SQLite fetch failed: {exc}") from exc

    def fetchall(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        try:
            with self.connect() as conn:
                with start_span("sqlite.fetchall", db_path=str(self.path)):
                    return list(conn.execute(sql, tuple(params)).fetchall())
        except sqlite3.Error as exc:
            raise StorageError(f"SQLite fetch failed: {exc}") from exc

    @contextmanager
    def transaction(self) -> Generator[sqlite3.Connection, None, None]:
        """Context manager that wraps operations in a single transaction.

        Usage::

            with store.transaction() as conn:
                conn.execute("INSERT INTO ...", ...)
                conn.execute("INSERT INTO ...", ...)
                # auto-commits on exit; rollback on exception
        """
        conn = self.connect()
        try:
            with start_span("sqlite.transaction", db_path=str(self.path)):
                conn.execute("BEGIN")
                yield conn
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
