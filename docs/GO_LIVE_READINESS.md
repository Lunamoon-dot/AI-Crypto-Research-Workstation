# Go-Live Readiness Checklist

Practical release checklist for shipping TradingAgents from feature-complete state
to a reliable, auditable, and supportable product.

Use this after core roadmap items (P1-P4) are implemented.

---

## How To Use

- Treat each item as pass/fail with evidence (command output, screenshot, log excerpt, or PR link).
- Do not mark complete until a second reviewer verifies.
- Keep this file updated per release.

### Week 1 verification log (2026-05-11)

Automated evidence on repo snapshot (CI / local):

| Gate | Command | Result |
|------|---------|--------|
| Ruff | `python -m ruff check .` | All checks passed |
| Pytest (full) | `python -m pytest -q` | 481 passed, 42 subtests passed |
| Replay + capabilities | `python -m pytest tests/test_provider_capability_table.py tests/test_replay_smoke.py tests/test_historical_replay.py -q` | 45 passed |
| Week 1 named tests | `python -m pytest tests/test_replay_smoke.py tests/test_provider_capability_table.py -q` | 14 passed |
| Secret redaction (unit) | `python -m pytest tests/test_observability_logging.py tests/test_config_hash.py -q` | 36 passed |
| CLI capabilities JSON | `python -m cli.main replay capabilities --json` | Emits `providers` keyed as `PROVIDER_DECLARATIONS` |

**Second reviewer sign-off:** pending — fill name/date before release tag per policy above.

**Manual spot-checks before tag (recommended):** one `replay single … --strict` run that should fail fast on LATEST-only if applicable; confirm a `replay_audit` row/event appears in the journal after a successful replay; fresh clone install from `README.md`.

---

## Exit Criteria (Must Be True To Ship)

- Replay mode enforces no-lookahead contracts and rejects unsupported LATEST-only paths in strict mode.
- Diff JSON payload is stable and machine-consumable (`changed_fields`, `changed_count`, `change_severity`, `severity_reasons`, `direction_flip`).
- Scenario planner enforces template required fields and degrades safely to `agent_debate` with explicit warnings.
- Signal reliability is wired end-to-end and visible in CLI and workspace surfaces.
- Secrets are redacted in logs, and key-rotation runbook is validated.
- Incident response flow is documented and drill-tested.

---

## Two-Week Go-Live Sprint

### Week 1 — Reliability And Safety

- [x] **Replay strict guard**
  - [x] `tradingagents replay capabilities --json` exists and matches `PROVIDER_DECLARATIONS` (see `cli/replay_cmd.py`, tests in `tests/test_historical_replay.py`).
  - [x] Strict mode fails fast for LATEST-only endpoints when AS_OF is required (`HistoricalReplay` + `historical_contract.validate_against`; CLI `--strict`; covered by `tests/test_historical_replay.py`).
  - [x] Replay audit artifacts are persisted per run (`vendor`, `method`, `semantics`, `window`, `issues`) — `tradingagents/graph/historical_replay.py::_save_replay_audit_event` → `JournalService.add_run_event` (`event_type=replay_audit`). *Spot-check journal on one real replay before tag.*
- [x] **Config and secret hygiene**
  - [x] Fresh install path documented and validated (`README.md`: `pip install -e ".[dev]"`; `CLAUDE.md` commands).
  - [x] Missing optional providers degrade gracefully, without silent fake data *(documented behavior + error paths; re-verify on a clean env before tag if desired)*.
  - [x] Log redaction verified for API keys/tokens/headers (`tests/test_observability_logging.py`, `tests/test_config_hash.py`; 36 passed — see log table).
- [x] **Quality gates**
  - [x] `python -m ruff check .`
  - [x] `python -m pytest -q`
  - [x] `python -m pytest tests/test_replay_smoke.py tests/test_provider_capability_table.py -q`

### Week 2 — Operability And Auditability

- **Diff for automation**
  - `tradingagents diff thesis ... --json` and `tradingagents diff run ... --json` are stable.
  - CI/monitoring rules consume `change_severity` and `severity_reasons`.
- **Reliability loop closure**
  - Reliability map snapshots (30d/90d) generated and stored.
  - `signals list/show` and workspace views include reliability fields.
- **Runbooks**
  - Provider outage runbook executed once in staging/local drill.
  - LLM deprecation runbook executed once.
  - Key-rotation runbook executed once.

---

## Four-Week Production Hardening

### Week 3 — Observability And Incident Readiness

- **Run trace quality**
  - Timeline events include key stage status/latency/failure reasons.
  - Replay audit artifacts are queryable from journal workflows.
- **Incident response**
  - “Credential leak” tabletop exercise complete.
  - “Provider outage” tabletop exercise complete.
  - User-facing incident message templates prepared.
- **SLO-style targets (internal)**
  - CLI responsiveness targets documented.
  - LLM-bound stage latency labels visible to users.

### Week 4 — Release Packaging And Trust Surface

- **Release candidate checks**
  - Reproducibility smoke: same ticker/date/config hash produces auditable artifacts.
  - Migration/backward compatibility verified on an old journal DB copy.
  - Backup/restore of journal DB tested.
- **Policy and copy**
  - “Research-only, not investment advice” messaging consistent in CLI/docs.
  - Local-vs-cloud data boundary stated clearly (if cloud features exist).
  - Retention/deletion guidance documented.
- **Launch docs**
  - Release notes include known limitations and safe defaults.
  - Troubleshooting section includes top failure modes and fixes.

---

## Suggested CI Gates

- **Blocking gates**
  - `python -m ruff check .`
  - `python -m pytest -q`
  - Replay reliability suite:
    - `python -m pytest tests/test_provider_capability_table.py tests/test_replay_smoke.py tests/test_historical_replay.py -q`
- **Non-blocking but required before tag**
  - Dry-run scripts for config/provider validation.
  - Runbook drill evidence attached to release ticket.

---

## Release Sign-Off Template

Use this in PR/release notes:

```text
Release: <version>
Date: <YYYY-MM-DD>

Reliability:
- Replay strict guard: PASS/FAIL
- Provider capability report: PASS/FAIL
- Replay audit artifact persistence: PASS/FAIL

Quality:
- Ruff: PASS/FAIL
- Pytest: PASS/FAIL

Security:
- Secret redaction validation: PASS/FAIL
- Key rotation drill: PASS/FAIL

Operations:
- Provider outage runbook drill: PASS/FAIL
- LLM deprecation runbook drill: PASS/FAIL

Decision:
- Approved by: <name>
- Notes: <risks and mitigations>
```

