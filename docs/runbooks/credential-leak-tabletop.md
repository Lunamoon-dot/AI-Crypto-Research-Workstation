# Credential Leak Tabletop

**Last updated**: 2026-05-12
**Scope**: Suspected leaked LLM or data-provider credential in logs, docs, shell history, journal payloads, or Git history.

## Scenario

A provider API key is accidentally pasted into a local run log or committed file. Treat the key as compromised even if the repository is private.

## Drill Steps

1. Identify the credential type and provider without copying the secret into new files.
2. Revoke the exposed key in the provider console.
3. Generate a replacement key and update only approved storage: environment variable, ignored `.env`, or keyring.
4. Search tracked files and history:
   ```bash
   detect-secrets scan $(git ls-files)
   git log --all --full-history -- .env
   ```
5. Search local journal payloads for common key markers:
   ```sql
   SELECT id, symbol, started_at
   FROM research_runs
   WHERE payload_json LIKE '%api_key%'
      OR payload_json LIKE '%sk-%'
      OR payload_json LIKE '%Bearer %';
   ```
6. Run a real-provider smoke after rotation.
7. Record incident timeline, impacted key, revocation time, replacement time, and user notification decision.

## Decision Points

- If a key reached Git history, purge it with a history-rewrite tool and rotate every key that might share the same storage path.
- If a key reached journal payloads, preserve a backup, then scrub affected rows or delete the local journal according to retention policy.
- If billing abuse is visible, open a provider support ticket and keep the incident open until charges and quotas are reconciled.

## Completion Criteria

- Old key revoked.
- Replacement key verified.
- Secret scan is clean or every finding is triaged as non-secret.
- Incident report and user-facing message are prepared.
