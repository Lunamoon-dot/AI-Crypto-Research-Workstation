# Journal Backup And Restore Runbook

**Last updated**: 2026-05-12
**Scope**: Local SQLite research journal at `TRADINGAGENTS_JOURNAL_DB` or the default `~/.luna_workstation/cache/research_journal.sqlite`.

## Backup

1. Stop active research runs so SQLite WAL files are stable.
2. Resolve the active path:
   ```bash
   lunacrypto journal path
   ```
3. Copy the database and any sidecars with the same basename:
   ```bash
   cp research_journal.sqlite backup/research_journal.sqlite
   cp research_journal.sqlite-wal backup/  # if present
   cp research_journal.sqlite-shm backup/  # if present
   ```
4. Record SHA256 for the copied DB and store the backup outside the repo.

## Restore

1. Stop active research runs.
2. Set a restore target:
   ```bash
   export TRADINGAGENTS_JOURNAL_DB=/path/to/restored/research_journal.sqlite
   ```
3. Copy the DB and sidecars into place.
4. Verify:
   ```bash
   lunacrypto journal list --limit 3
   python -c "import sqlite3, os; c=sqlite3.connect(os.environ['TRADINGAGENTS_JOURNAL_DB']); print(c.execute('PRAGMA integrity_check').fetchone()[0])"
   ```
5. Run migrations after restore:
   ```bash
   lunacrypto journal migrate
   ```

## Acceptance Criteria

- `PRAGMA integrity_check` returns `ok`.
- `PRAGMA user_version` matches the current schema version.
- `lunacrypto journal list` and timeline inspection can read restored rows.
- The source DB hash is unchanged when migration is tested on a copy.
