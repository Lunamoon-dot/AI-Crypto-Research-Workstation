"""Small SQLite helper for local-first persistence."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable

from .schema import SCHEMA_SQL


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
        return conn

    def initialize(self) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.executescript(SCHEMA_SQL)

    def execute(self, sql: str, params: Iterable = ()) -> None:
        with self.connect() as conn:
            conn.execute(sql, tuple(params))

    def fetchone(self, sql: str, params: Iterable = ()) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(sql, tuple(params)).fetchone()

    def fetchall(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return list(conn.execute(sql, tuple(params)).fetchall())
