# Troubleshooting

**Last updated**: 2026-05-12

This guide covers the common local install and provider failures for the AI service. Keep raw journal databases, `.env` files, API keys, and copied prompt payloads out of support artifacts unless the user explicitly exports and redacts them.

## Baseline Checks

Run these from `apps/ai-service`:

```powershell
..\..\.venv\Scripts\python.exe -m pip --version
..\..\.venv\Scripts\python.exe -m pip check
..\..\.venv\Scripts\python.exe -m pytest tests/test_config_loader.py tests/test_providers.py
```

If the root virtual environment is not available, create and activate a local one before installing:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

## Install Failures

### `pip` or `python` points to the wrong interpreter

Symptoms:

- `ModuleNotFoundError` for packages that should be installed.
- Tests skip unexpectedly because dev dependencies are missing.
- `python -m pip check` works in one shell but not another.

Actions:

1. Print the interpreter path with `python -c "import sys; print(sys.executable)"`.
2. Activate the intended virtual environment.
3. Reinstall with `python -m pip install -e ".[dev]"`.
4. Re-run the focused checks above.

### Editable install fails on Windows PowerShell

Actions:

1. Run PowerShell as the same user that owns the checkout.
2. Use quoted extras: `python -m pip install -e ".[dev]"`.
3. If activation is blocked, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then open a new shell.
4. Avoid committing generated `.venv`, cache, or journal files.

### Dependency check warns about packages outside the project

The release evidence may use a clean verification environment when the workstation has stale global packages. For release sign-off, prefer a fresh virtual environment and attach `pip check`, lint, type-check, compile, and pytest output from that environment.

## Provider Failures

### Missing or invalid API key

Symptoms:

- Authentication errors from the LLM or data provider.
- Provider health records show `unauthorized`, `forbidden`, or repeated 401/403 responses.

Actions:

1. Confirm the expected environment variable is set in the active shell.
2. Do not paste the key into logs, journal notes, or issue comments.
3. Re-run the smallest provider smoke test available for the provider.
4. If a key may be exposed, follow `docs/runbooks/key-rotation.md`.

### Provider outage or rate limiting

Symptoms:

- Repeated timeouts, 429 responses, or transient 5xx responses.
- Journal timeline shows provider errors across multiple symbols.

Actions:

1. Check whether the failure is isolated to one provider, model, symbol, or data source.
2. Switch to a configured fallback provider only when the provider policy allows it.
3. Record impact and user-facing wording with `docs/runbooks/provider-outage.md` and `docs/runbooks/incident-message-template.md`.

### Data freshness or empty historical data

Symptoms:

- Data freshness checks are stale.
- Historical evaluation fails with empty OHLCV or missing `open`, `high`, `low`, `close` columns.

Actions:

1. Verify the symbol format expected by the selected provider.
2. Narrow the date range and retry.
3. Confirm the provider supports the requested historical window before treating the result as a thesis-quality signal.

## Journal And Local Data

### Journal appears locked or stale

Actions:

1. Stop active runs and CLI sessions that may be using the same DB.
2. Confirm the journal path with `tradingagents journal path`.
3. Back up the DB before deleting sidecars.
4. Use `docs/runbooks/journal-backup-restore.md` for backup and restore checks.

### User asks to delete local data

Use `docs/data-retention-and-boundary.md`. The project is local-only for this release, and raw journal DBs should not be uploaded as support evidence.

## Evidence To Collect

For a supportable report, collect:

- command run;
- exact interpreter path;
- OS and Python version;
- sanitized provider/model name;
- sanitized error type and status code;
- whether the failure reproduces in a fresh virtual environment;
- relevant journal event IDs, not raw journal DB copies.
