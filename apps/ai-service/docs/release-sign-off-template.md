# Release Sign-Off Template

**Last updated**: 2026-05-12

Use this template for every release candidate. Attach command output or links to files under `docs/release-evidence/<version-date>/`. Do not attach raw journal databases, `.env` files, provider API keys, or unredacted prompt payloads.

```text
Release: <version>
Candidate: <rc number or commit sha>
Date: <YYYY-MM-DD>
Reviewer: <name>

Quality gates:
- Ruff lint: PASS/FAIL, evidence: <path or URL>
- Ruff format: PASS/FAIL, evidence: <path or URL>
- Pytest: PASS/FAIL, evidence: <path or URL>
- Mypy: PASS/FAIL, evidence: <path or URL>
- Compile: PASS/FAIL, evidence: <path or URL>
- Pip check: PASS/FAIL, evidence: <path or URL>

Reliability gates:
- Clean clone install: PASS/FAIL, evidence: <path or URL>
- Real-provider smoke: PASS/FAIL, evidence: <path or URL>
- Journal migration on old DB copy: PASS/FAIL, evidence: <path or URL>
- Journal backup/restore: PASS/FAIL, evidence: <path or URL>

Security gates:
- Dependency audit: PASS/FAIL, evidence: <path or URL>
- Secret scan: PASS/FAIL, evidence: <path or URL>
- Key rotation drill: PASS/FAIL, evidence: <path or URL>

Operations gates:
- Provider outage drill: PASS/FAIL, evidence: <path or URL>
- LLM deprecation drill: PASS/FAIL, evidence: <path or URL>
- Incident message template reviewed: PASS/FAIL, evidence: <path or URL>
- Data retention/cloud boundary reviewed: PASS/FAIL, evidence: <path or URL>
- Troubleshooting doc reviewed: PASS/FAIL, evidence: <path or URL>

Scope confirmation:
- Research-only positioning preserved: YES/NO
- No autonomous exchange execution path added: YES/NO
- Known limitations documented in release notes: YES/NO

Decision:
- Approved for tag: YES/NO
- Required follow-ups before tag:
- Deferred risks accepted:
- Notes:
```
