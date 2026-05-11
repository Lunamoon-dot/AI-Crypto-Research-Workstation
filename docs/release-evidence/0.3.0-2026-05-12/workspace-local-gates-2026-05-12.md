# Workspace Local Quality Gates

Date: 2026-05-12
Workspace: `C:\Users\dell\TradingAgents`
Python: `.\.venv\Scripts\python.exe` (Python 3.12.5)
Commit base: `d3b12d377460f18b39479896ef4bdc444a10d2b9`

These checks were run from the active workspace with the project virtual
environment. Do not use global `python` for release verification; the global
interpreter in this workstation does not have the full dev dependency set.

| Gate | Command | Result |
|---|---|---|
| Ruff lint | `.\.venv\Scripts\python.exe -m ruff check .` | PASS: `All checks passed!` |
| Ruff format | `.\.venv\Scripts\python.exe -m ruff format --check .` | PASS: `225 files already formatted` |
| Mypy | `.\.venv\Scripts\python.exe -m mypy tradingagents cli` | PASS: `Success: no issues found in 173 source files` |
| Compile | `.\.venv\Scripts\python.exe -m compileall tradingagents cli tests` | PASS |
| Pytest | `.\.venv\Scripts\python.exe -m pytest` | PASS: `524 passed, 1 warning in 10.56s` |

Notes:

- A transient format failure was introduced in `tests/test_phase7_cli.py` while
  tightening the service-boundary tests. It was fixed with
  `.\.venv\Scripts\python.exe -m ruff format tests\test_phase7_cli.py`.
- Property tests ran as part of the full pytest suite with
  `hypothesis-6.152.6` installed in `.venv`.
- `.\.venv\Scripts\python.exe -m pip check` could not be used in this local
  venv because `pip` is not importable as a module here. The clean-clone
  dependency check remains recorded separately in `clean-clone-pip-check.log`.
- These local results do not replace GitHub Actions matrix evidence or
  second-reviewer sign-off.
