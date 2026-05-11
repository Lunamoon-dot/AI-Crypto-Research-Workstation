# CI Matrix Status

Date: 2026-05-12
Pull request: https://github.com/Lunamoon-dot/AI-Crypto-Research-Workstation/pull/1
Branch: `release-readiness-gates-codex`
Head commit: `83dfdf3db0ca7c70f93915d66ae7c7f6a007c066`
Workflow: `.github/workflows/ci.yml`
Workflow run: `25699827162`
Run number: `36`

Result: PASS. GitHub Actions completed successfully for the release-candidate
branch after fixing the Python 3.10 test import fallback.

## Job Results

| Job | Job ID | Conclusion | Evidence |
|---|---:|---|---|
| Lint & Format | `75457127472` | success | Ruff full lint and Ruff format check completed successfully. |
| Type Check (mypy) | `75457127455` | success | `Run mypy` completed successfully. |
| Python 3.10 | `75457324606` | success | Install, import smoke, compile, unit tests, and remaining tests completed successfully. |
| Python 3.11 | `75457324579` | success | Install, import smoke, compile, unit tests, and remaining tests completed successfully. |
| Python 3.12 | `75457324544` | success | Install, import smoke, compile, unit tests, and remaining tests completed successfully. |

## Superseded Failed Run

Earlier run `25699596393` failed on the `Python 3.10` job because
`tests/test_phase34_hardening.py` and `tests/test_property_based_hardening.py`
imported `tomllib` directly. Python 3.10 does not provide `tomllib`; the fix
uses `tomllib` with a `tomli` fallback, matching the existing
`tomli>=2.0.0; python_version < "3.11"` dependency.

Readiness handling: the CI matrix gate is now satisfied for this release
candidate. Second-reviewer sign-off is still required before a release tag.
