# Secret Scan Triage

Date: 2026-05-12
Tool: detect-secrets 1.5.0
Scope: tracked files in the clean verification clone, excluding `uv.lock`; ignored local `.env` was not scanned or copied.

Result: PASS after manual triage. The scanner reported 21 potential findings, all reviewed as placeholders, documentation examples, test fixtures, deterministic test hashes, or non-secret code paths.

| File | Lines | Triage |
|---|---:|---|
| `.github/workflows/ci.yml` | 106 | Placeholder API key environment values for CI tests. |
| `docs/runbooks/key-rotation.md` | 83, 152-154, 213 | Documentation examples using dummy key names/placeholders. |
| `tests/test_config_hash.py` | 33, 37, 45, 49, 125, 139 | Test fixtures for redaction and deterministic hash behavior. |
| `tests/test_deepseek_reasoning.py` | 60 | Placeholder API key in mocked client setup. |
| `tests/test_google_api_key.py` | 16, 19, 24 | Placeholder key strings in unit-test parametrization. |
| `tests/test_journal_service.py` | 45, 72 | Deterministic test config hashes, not credentials. |
| `tests/test_observability_logging.py` | 69 | Redaction test fixture intentionally containing fake key shape. |
| `tests/test_phase34_hardening.py` | 161 | Deterministic test config hash, not a credential. |
| `luna_workstation/llm_clients/openai_client.py` | 223 | Literal `ollama` dummy API key required by local Ollama-compatible client path. |
