# Production Readiness Review

**Review date:** 2026-05-12

**Scope:** source code, tracked Markdown/docs, local CI gates, and release posture.

**Verdict:** not ready for broad production launch yet. Ready for controlled local alpha/beta use as a research workstation.

This project should remain positioned as a local-first AI crypto research workstation. It is not a live trading system, investment adviser, broker connector, or unattended automation product.

## Evidence From This Review

| Gate | Result |
|------|--------|
| `python -m ruff check .` | PASS |
| `python -m ruff format --check .` | PASS after formatting repo |
| `python -m pytest -q` | PASS: 503 passed, 1 skipped, 42 subtests passed |
| `python -m mypy tradingagents cli` | PASS |
| `python -m compileall tradingagents cli tests` | PASS |
| `python -m pip check` | PASS: no broken requirements; local Python reports stale invalid-distribution warnings outside the project |

The skipped test is `tests/test_property_based_hardening.py` because `hypothesis` is not installed in the current local interpreter. It is declared in the `dev` extra, so a clean dev install should remove this skip.

## Changes Made During This Review

- Removed stale Markdown that no longer served the project:
  - `Old_reviews_No_need_to_read/TECHNICAL_REVIEW.md`
  - `Old_reviews_No_need_to_read/TECHNICAL_REVIEW1.md`
  - `Old_reviews_No_need_to_read/TECHNICAL_REVIEW_PHASE1_9.md`
  - `TECHNICAL_REVIEW_STAFF.md`
  - `docs/changes/SESSION_WORK_SUMMARY.md`
  - `tradingagents/llm_clients/TODO.md`
- Removed tracked temporary root scripts:
  - `_check_imports.py`
  - `_tmp_inspect.py`
  - `_tmp_read.py`
- Formatted the repository so the configured CI format gate can pass.
- Fixed `ResearchRun` provenance persistence so `deep_think_model`, `quick_think_model`, `llm_provider`, and `config_hash` are written to structured SQLite columns and migrated into existing journals.
- Added regression coverage for the provenance persistence and legacy migration path.
- Fixed mypy failures in runtime config models, provider health typing, journal event persistence, and evaluation analysis.

## Production Decision

Do not move to production yet.

It is reasonable to ship a controlled local beta if the release notes are explicit:

- research-only;
- local SQLite journal;
- no autonomous execution;
- no broker/exchange order placement;
- no investment advice;
- known provider/data freshness limitations.

It is not ready for:

- unattended operation;
- paid hosted cloud;
- multi-tenant team workspace;
- regulated advice-like positioning;
- exchange execution or order management.

## Remaining Blockers

### P0 Before A Production Tag

- Run the full CI matrix on Linux for Python 3.10, 3.11, and 3.12.
- Validate a clean clone install with `pip install -e ".[dev]"`; confirm `hypothesis` is installed and no tests are skipped unexpectedly.
- Execute at least one real-provider smoke run for BTC/USDT with real credentials in a staging/local environment.
- Drill and sign off the runbooks:
  - provider outage;
  - LLM model deprecation;
  - API key rotation and credential leak response.
- Verify journal backup and restore on a copy of an older real journal database.
- Run dependency/security audit and secret scan before tagging.
- Confirm release packaging, version, changelog entry, and install commands from a fresh shell.

### P1 Hardening

- Wire token/latency budgets into the actual graph stages, not only the standalone budget utility.
- Expand timeline events so analyst/debate/risk/scenario stages are visible end-to-end in journal `run_events`.
- Reduce `ResearchAgentsGraph` ownership of mutable run state; split graph running, thesis building, and journal coordination.
- Finish dependency-injection boundaries for services that currently instantiate collaborators internally.
- Continue batch-fetch/JOIN cleanup for remaining read-heavy analytics paths.
- Keep observability event names in research/planning terminology unless real audited assisted execution is deliberately added later.

### P2 Product And Operations

- [x] Define retention/deletion guidance for local journal and generated report artifacts: `docs/data-retention-and-boundary.md`.
- [x] Prepare troubleshooting docs for top install/provider failures: `docs/TROUBLESHOOTING.md`.
- [x] Add release sign-off template usage to every release candidate: `docs/release-sign-off-template.md`.
- Keep cloud/API work out of scope until local workflows, auditability, and runbook drills are stable.

## Markdown Cleanup Policy

Keep Markdown that is current, user-facing, or operational:

- `README.md`
- `CHANGELOG.md`
- `ROADMAP.md`
- `CLAUDE.md`
- `TERMINAL_UX_GUIDE.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/ROADMAP_DEV.md`
- `docs/ROADMAP_PRODUCTION.md`
- `docs/GO_LIVE_READINESS.md`
- `docs/PRODUCTION_READINESS_REVIEW.md`
- `docs/runbooks/*.md`

Generated reports under `reports/` are ignored runtime artifacts. They were not deleted in this review because they may contain local user output rather than project documentation.
