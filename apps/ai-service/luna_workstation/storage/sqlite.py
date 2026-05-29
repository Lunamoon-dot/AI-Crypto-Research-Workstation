"""Small SQLite helper for local-first persistence."""

from __future__ import annotations

import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Generator, Iterable

from luna_workstation.exceptions import StorageError
from luna_workstation.observability import start_span

from .migrations import ensure_column, migrate_path, migrate_sqlite


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

    def backup_to(self, target: str | Path) -> Path:
        """Write a consistent SQLite backup and return the backup path."""
        return backup_sqlite(self.path, target)

    @classmethod
    def restore_from_backup(
        cls, backup_path: str | Path, target: str | Path
    ) -> "SQLiteStore":
        """Restore *backup_path* into *target* and return an initialized store."""
        restored_path = restore_sqlite_backup(backup_path, target)
        return cls(restored_path)

    @staticmethod
    def _ensure_column(
        conn: sqlite3.Connection,
        table: str,
        column: str,
        column_type: str,
    ) -> None:
        ensure_column(conn, table, column, column_type)

    def execute(
        self,
        sql: str,
        params: Iterable = (),
        *,
        _conn: sqlite3.Connection | None = None,
    ) -> None:
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


def backup_sqlite(source: str | Path, target: str | Path) -> Path:
    """Create a consistent backup of *source* at *target* using SQLite backup API."""
    source_path = Path(source).expanduser()
    target_path = Path(target).expanduser()
    if not source_path.exists():
        raise StorageError(f"SQLite backup source does not exist: {source_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with closing(sqlite3.connect(source_path)) as src:
            src.execute("PRAGMA wal_checkpoint(PASSIVE)")
            with closing(sqlite3.connect(target_path)) as dst:
                src.backup(dst)
                _assert_integrity(dst, target_path)
                dst.commit()
    except sqlite3.Error as exc:
        raise StorageError(f"SQLite backup failed: {exc}") from exc
    return target_path


def restore_sqlite_backup(backup_path: str | Path, target: str | Path) -> Path:
    """Restore a SQLite backup into *target* and run current app migrations."""
    source_path = Path(backup_path).expanduser()
    target_path = Path(target).expanduser()
    if not source_path.exists():
        raise StorageError(f"SQLite restore source does not exist: {source_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_name(f"{target_path.name}.restore-tmp")
    try:
        with closing(sqlite3.connect(source_path)) as src:
            _assert_integrity(src, source_path)
            if tmp_path.exists():
                tmp_path.unlink()
            with closing(sqlite3.connect(tmp_path)) as dst:
                src.backup(dst)
                _assert_integrity(dst, tmp_path)
                dst.commit()
        _unlink_sqlite_sidecars(target_path)
        tmp_path.replace(target_path)
        migrate_path(target_path)
    except sqlite3.Error as exc:
        raise StorageError(f"SQLite restore failed: {exc}") from exc
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    return target_path


def _assert_integrity(conn: sqlite3.Connection, path: Path) -> None:
    row = conn.execute("PRAGMA integrity_check").fetchone()
    status = row[0] if row else "missing"
    if status != "ok":
        raise StorageError(f"SQLite integrity check failed for {path}: {status}")


def _unlink_sqlite_sidecars(path: Path) -> None:
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{path}{suffix}")
        if sidecar.exists():
            sidecar.unlink()
