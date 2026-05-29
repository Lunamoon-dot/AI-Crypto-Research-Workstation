# Data Retention And Cloud Boundary

**Last updated**: 2026-05-13

LunaCrypto is currently a local research workstation. There is no hosted tier in this release, and the project should be operated as local-only unless a future cloud product explicitly changes this boundary.

## Local Data

Stored locally by default:

- SQLite research journal: `~/.luna_workstation/cache/research_journal.sqlite`
- SQLite checkpoint DBs under `~/.luna_workstation/cache/checkpoints/`
- Generated reports under the configured reports directory
- Local config files and ignored `.env` secrets

The journal can contain symbols, model names, provider metadata, prompts, generated research text, run events, and user-entered decision notes. Treat it as user-private data.

## Retention

Recommended local defaults:

- Keep journal DBs until the user deletes or archives them.
- Keep generated reports until the user deletes the report directory.
- Keep checkpoint DBs only while resume is useful; delete stale checkpoints after the related run is complete.
- Keep release evidence logs, but do not commit raw journal DB copies or `.env` files.

## Deletion

To delete local research data:

1. Stop active runs.
2. Back up the journal if needed.
3. Delete the journal DB and sidecars:
   ```bash
   rm ~/.luna_workstation/cache/research_journal.sqlite*
   ```
4. Delete generated reports if requested:
   ```bash
   rm -rf reports/
   ```
5. Delete checkpoints if requested:
   ```bash
   rm -rf ~/.luna_workstation/cache/checkpoints/
   ```

On Windows PowerShell, use `Remove-Item -LiteralPath <path> -Force` for files and add `-Recurse` for directories after verifying the resolved path.

## Cloud Boundary

Before any hosted tier exists, the default policy is:

- Do not sync journal DBs, generated reports, logs, or `.env` files to a service controlled by this project.
- Do not upload local journal content for support unless the user explicitly exports and redacts it.
- Do not store provider API keys in the journal or generated reports.
- If a future hosted tier is added, it must define encryption, deletion, export, retention, audit logging, and tenant isolation before accepting user journal data.

## Evidence Handling

Release evidence may include command output and hashes. It must not include raw API keys or raw copied journal databases. When migration evidence requires a real DB, run it against a copy outside the repository and commit only logs with paths, hashes, row/schema checks, and command exit codes.
