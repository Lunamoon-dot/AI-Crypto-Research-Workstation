# Operational Drills Evidence

Date: 2026-05-12

These drills were executed as documentation/tabletop checks for the local workstation release. No hosted service exists in this release, so drills validate operator procedure, command availability, and evidence capture rather than live production failover.

| Drill | Result | Evidence |
|---|---|---|
| Provider outage | PASS | Existing runbook reviewed: `docs/runbooks/provider-outage.md`; fallback/config/checkpoint steps documented. |
| LLM deprecation | PASS | Existing runbook reviewed: `docs/runbooks/llm-deprecation.md`; model replacement, validation, and affected-run query documented. |
| API key rotation | PASS | Existing runbook reviewed: `docs/runbooks/key-rotation.md`; rotation methods and redaction check documented. |
| Credential leak tabletop | PASS | Added `docs/runbooks/credential-leak-tabletop.md`; scenario, containment, search, rotation, and completion criteria documented. |
| Incident message template | PASS | Added `docs/runbooks/incident-message-template.md`; user-facing template with data-safety rules documented. |
| Backup/restore drill | PASS | `journal-migration-backup-restore.md` shows migration and restore commands exited 0 with `integrity_check ok`. |
| Retention/deletion and cloud/local boundary | PASS | Added `docs/data-retention-and-boundary.md`; local-only boundary and deletion guidance documented. |

## Follow-Ups

- Repeat provider outage, LLM deprecation, and key rotation drills with a second reviewer present before a production tag.
- Add authenticated GitHub Actions evidence for the Python 3.10/3.11/3.12 matrix.
- Keep second reviewer sign-off pending until a real reviewer approves the release evidence.
