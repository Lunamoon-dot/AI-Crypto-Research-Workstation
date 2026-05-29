import json
import sqlite3

from luna_workstation.storage.migrations import SCHEMA_VERSION, migrate_path
from luna_workstation.storage.sqlite import SQLiteStore, restore_sqlite_backup


def test_sqlite_migration_backup_restore_smoke(tmp_path):
    legacy_db = tmp_path / "legacy.sqlite"
    backup_db = tmp_path / "backup.sqlite"
    restored_db = tmp_path / "restored.sqlite"

    with sqlite3.connect(legacy_db) as conn:
        conn.executescript(
            """
            CREATE TABLE research_runs (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                asset_class TEXT NOT NULL,
                timeframe TEXT,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                payload_json TEXT NOT NULL
            );
            INSERT INTO research_runs (
                id, symbol, asset_class, timeframe, status, started_at, payload_json
            ) VALUES (
                'run_legacy', 'BTC/USDT', 'crypto', '2026-05-12', 'completed',
                '2026-05-12T00:00:00+00:00',
                '{"id":"run_legacy","symbol":"BTC/USDT","asset_class":"crypto","status":"completed"}'
            );
            """
        )

    migrate_path(legacy_db)
    store = SQLiteStore(legacy_db)
    store.backup_to(backup_db)
    restore_sqlite_backup(backup_db, restored_db)

    with sqlite3.connect(restored_db) as conn:
        conn.row_factory = sqlite3.Row
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        user_version = conn.execute("PRAGMA user_version").fetchone()[0]
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(research_runs)")
        }
        run = conn.execute(
            "SELECT id, workspace_id, payload_json FROM research_runs WHERE id = ?",
            ("run_legacy",),
        ).fetchone()

    payload = json.loads(run["payload_json"])
    assert integrity == "ok"
    assert user_version == SCHEMA_VERSION
    assert "workspace_id" in columns
    assert run["workspace_id"] == "local"
    assert payload["symbol"] == "BTC/USDT"
