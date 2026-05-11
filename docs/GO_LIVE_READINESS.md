# Go-Live Readiness Checklist

Practical checklist for moving TradingAgents from local research workstation to a supportable production release.

**Current decision:** not production-ready as of 2026-05-12.
**Current acceptable use:** controlled local alpha/beta for research workflows only.

See also: [Production readiness review](PRODUCTION_READINESS_REVIEW.md).

## Current Evidence

| Gate | Result |
|------|--------|
| Ruff lint | PASS: `python -m ruff check .` |
| Ruff format | PASS: `python -m ruff format --check .` |
| Pytest | PASS: `503 passed, 1 skipped, 42 subtests passed` |
| Mypy | PASS: `python -m mypy tradingagents cli` |
| Compile | PASS: `python -m compileall tradingagents cli tests` |
| Dependency check | PASS: `python -m pip check`; local interpreter reports stale invalid-distribution warnings |

The skipped test is caused by missing `hypothesis` in the current interpreter. A clean `pip install -e ".[dev]"` should install it before release.

## Release Gates

### Must Pass Before A Production Tag

- [x] Local lint passes.
- [x] Local format check passes.
- [x] Local pytest passes.
- [x] Local mypy passes.
- [x] Local compile check passes.
- [ ] Clean clone install verified with `pip install -e ".[dev]"`.
- [ ] CI matrix passes on Python 3.10, 3.11, and 3.12.
- [ ] Property-based tests run with `hypothesis` installed, with no unexpected skips.
- [ ] Real-provider smoke run completed and attached to release evidence.
- [ ] Journal migration verified on a copy of an older real journal DB.
- [ ] Journal backup and restore procedure verified.
- [ ] Dependency/security audit completed.
- [ ] Secret scan completed.
- [ ] Release notes include known limitations and research-only positioning.
- [ ] Second reviewer signs off.

### Operational Drills

- [ ] Provider outage runbook executed.
- [ ] LLM deprecation runbook executed.
- [ ] API key rotation runbook executed.
- [ ] Credential leak tabletop completed.
- [ ] User-facing incident message template prepared.

### Product Boundaries

- [x] README states the project is not an autonomous trading bot.
- [x] Core repo has no exchange order placement path.
- [x] Historical evaluation is described as thesis-quality evaluation, not broker-accurate backtesting.
- [ ] Retention/deletion guidance for journal DB and generated reports is documented.
- [ ] Cloud/local data boundary is documented before any hosted tier.

## Production Blockers To Close

- Finish release evidence from clean environments, not only the current workstation.
- Drill runbooks and record reviewer sign-off.
- Wire graph-stage budget/timeline observability into real runs.
- Verify migrations, backup, and restore against realistic journal data.
- Complete dependency audit and secret scanning.
- Keep assisted execution out of scope until explicit approval, confirmation, and immutable audit trails exist.

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
