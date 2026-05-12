# Go-Live Readiness Checklist

Practical checklist for moving TradingAgents from local research workstation to a supportable production release.

**Current decision:** not production-ready as of 2026-05-12.
**Current acceptable use:** controlled local alpha/beta for research workflows only.

See also: [Production readiness review](PRODUCTION_READINESS_REVIEW.md).

Release evidence directory: [0.3.0-2026-05-12](release-evidence/0.3.0-2026-05-12/).
Completion audit: [completion-audit-2026-05-12.md](release-evidence/0.3.0-2026-05-12/completion-audit-2026-05-12.md).

## Current Evidence

| Gate | Result |
|------|--------|
| Clean clone install | PASS: `pip install -e ".[dev]"`; see [clean-clone summary](release-evidence/0.3.0-2026-05-12/clean-clone-summary.md) |
| Ruff lint | PASS: `python -m ruff check .`; see [clean-clone summary](release-evidence/0.3.0-2026-05-12/clean-clone-summary.md) |
| Ruff format | PASS after rerun: `python -m ruff format --check .`; see [format rerun](release-evidence/0.3.0-2026-05-12/clean-clone-ruff-format-check-rerun.log) |
| Pytest | PASS: `507 passed, 42 subtests passed`; see [pytest log](release-evidence/0.3.0-2026-05-12/clean-clone-pytest.log) |
| Current workspace rerun | PASS with `.\.venv\Scripts\python.exe`: ruff lint, ruff format, mypy, compile, and `524 passed`; see [workspace gates](release-evidence/0.3.0-2026-05-12/workspace-local-gates-2026-05-12.md) |
| Property tests | PASS: `4 passed` with `hypothesis` installed; see [property log](release-evidence/0.3.0-2026-05-12/clean-clone-property-tests-rerun.log) |
| Mypy | PASS: `python -m mypy tradingagents cli`; see [mypy log](release-evidence/0.3.0-2026-05-12/clean-clone-mypy.log) |
| Compile | PASS: `python -m compileall tradingagents cli tests`; see [compile log](release-evidence/0.3.0-2026-05-12/clean-clone-compileall.log) |
| Dependency check | PASS: `python -m pip check`; see [pip check log](release-evidence/0.3.0-2026-05-12/clean-clone-pip-check.log) |
| CI matrix | PASS: GitHub Actions run `25699827162` passed lint, mypy, and Python 3.10/3.11/3.12 matrix jobs for PR #1; see [CI evidence](release-evidence/0.3.0-2026-05-12/ci-matrix-status.md) |
| Dependency audit | PASS: `pip-audit`; see [audit log](release-evidence/0.3.0-2026-05-12/dependency-audit-pip-audit.log) |
| Secret scan | PASS after manual triage of placeholders/test fixtures; see [scan log](release-evidence/0.3.0-2026-05-12/secret-scan-detect-secrets.log) and [triage](release-evidence/0.3.0-2026-05-12/secret-scan-triage.md) |

## Release Gates

### Must Pass Before A Production Tag

- [x] Local lint passes.
- [x] Local format check passes.
- [x] Local pytest passes.
- [x] Local mypy passes.
- [x] Local compile check passes.
- [x] Clean clone install verified with `pip install -e ".[dev]"`.
- [x] CI matrix passes on Python 3.10, 3.11, and 3.12.
- [x] Property-based tests run with `hypothesis` installed, with no unexpected skips.
- [x] Real-provider smoke run completed and attached to release evidence.
- [x] Journal migration verified on a copy of an older real journal DB.
- [x] Journal backup and restore procedure verified.
- [x] Dependency/security audit completed.
- [x] Secret scan completed.
- [x] Release notes include known limitations and research-only positioning.
- [ ] Second reviewer signs off.

### Operational Drills

- [x] Provider outage runbook executed.
- [x] LLM deprecation runbook executed.
- [x] API key rotation runbook executed.
- [x] Credential leak tabletop completed.
- [x] User-facing incident message template prepared.

### Product Boundaries

- [x] README states the project is not an autonomous trading bot.
- [x] Core repo has no exchange order placement path.
- [x] Historical evaluation is described as thesis-quality evaluation, not broker-accurate backtesting.
- [x] Retention/deletion guidance for journal DB and generated reports is documented.
- [x] Cloud/local data boundary is documented before any hosted tier.

## Production Blockers To Close

- Record second reviewer sign-off.
- Keep assisted execution out of scope until explicit approval, confirmation, and immutable audit trails exist.

## Evidence Notes

- DeepSeek real-provider smoke passed after fixing the smoke script to pass `DEFAULT_CONFIG` into the Portfolio Manager and use ASCII-safe section labels on Windows.
- The clean verification clone is based on commit `c403b148d6bf11d174ef36ff201728f16a497143` and includes the test-only Hypothesis health-check patch from this release workspace. The unpatched base commit exposed a cold-environment Hypothesis health-check flake.
- Journal migration and backup/restore ran against DB copies outside the repo; raw journal DB files are not committed.
- Current workspace verification must use `.\.venv\Scripts\python.exe`, not global `python`, so Hypothesis-backed property tests are not accidentally skipped.
- Graph-stage budget/timeline observability is wired into real graph runs through `BudgetTracker`, `BudgetCallbackHandler`, and per-node stage wrappers; coverage is in `tests/test_budget_tracking.py`, `tests/test_observability_logging.py`, and `tests/test_llm_fallback.py`.
- GitHub Actions CI run `25699827162` passed for PR #1 on branch `release-readiness-gates-codex` after fixing Python 3.10 `tomllib` test imports to use the existing `tomli` fallback dependency.

## Sign-Off Template

```text
Release: <version>
Date: <YYYY-MM-DD>

Quality:
- Ruff lint: PASS/FAIL
- Ruff format: PASS/FAIL
- Pytest: PASS/FAIL
- Mypy: PASS/FAIL
- Compile: PASS/FAIL

Reliability:
- Real provider smoke: PASS/FAIL
- Migration on old journal copy: PASS/FAIL
- Backup/restore: PASS/FAIL

Security:
- Dependency audit: PASS/FAIL
- Secret scan: PASS/FAIL
- Key rotation drill: PASS/FAIL

Operations:
- Provider outage drill: PASS/FAIL
- LLM deprecation drill: PASS/FAIL

Decision:
- Approved by: <name>
- Notes: <risks and mitigations>
```
