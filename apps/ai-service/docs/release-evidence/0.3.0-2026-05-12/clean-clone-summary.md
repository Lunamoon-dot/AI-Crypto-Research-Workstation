# Clean Clone Quality Gate Summary

Date: 2026-05-12

Verification clone: `C:\Users\dell\TradingAgents-release-verify`
Base commit: `c403b148d6bf11d174ef36ff201728f16a497143`
Python: 3.12.5
Install: `pip install -e ".[dev]"` completed in the verification venv; see `clean-clone-setup.log` and `clean-clone-pip-list.log`.

Note: the verification clone includes the test-only Hypothesis health-check patch from this release workspace. The unpatched base commit exposed a cold-environment Hypothesis health-check flake; the release workspace now contains the fix.

| Gate | Result | Evidence |
|---|---|---|
| `python -m pip check` | PASS | `clean-clone-pip-check.log` |
| `python -m ruff check .` | PASS | `clean-clone-ruff-check.log` |
| `python -m ruff format --check .` | PASS | `clean-clone-ruff-format-check-rerun.log` |
| `python -m mypy luna_workstation cli` | PASS | `clean-clone-mypy.log` |
| `python -m compileall luna_workstation cli tests` | PASS | `clean-clone-compileall.log` |
| `python -m pytest tests/test_property_based_hardening.py -v` | PASS, 4 passed | `clean-clone-property-tests-rerun.log` |
| `python -m pytest -v` | PASS, 507 passed, 42 subtests passed | `clean-clone-pytest.log` |
