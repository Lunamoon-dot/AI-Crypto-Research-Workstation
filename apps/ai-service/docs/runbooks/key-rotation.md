# Key Rotation Runbook

**Last updated**: 2026-05-13
**Audience**: Operators who manage API credentials for LunaCrypto
**Scope**: Rotating LLM and data provider API keys without downtime or data loss

---

## 1. Overview

LunaCrypto reads API keys from environment variables (default `secrets.source: "env"`) with optional keyring fallback. The current key resolution order:

1. Explicit `api_key` kwarg passed to `create_llm_client()` (e.g., from config)
2. `SecretsManager` (if `secrets.source` includes `"keyring"`)
3. OS environment variables (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, etc.)

No keys are persisted to the journal database — `SecretRedactionFilter` strips them before logging.

---

## 2. When to Rotate

| Trigger | Frequency |
|---------|-----------|
| Routine rotation (security policy) | Every 90 days recommended |
| Key leaked or committed to VCS | Immediately |
| Provider announces key compromise | Immediately |
| Team member with access leaves | Within 24 hours |
| After a security incident | As part of incident response |

---

## 3. Pre-Rotation Preparation

### 3.1 Identify all keys in use

```bash
# List configured providers (shows which env vars are expected)
lunacrypto config show | grep -i "api_key\|provider"

# Check .env file (if using one)
cat .env | grep -i "api_key\|token\|secret"
```

Common keys for LunaCrypto:

| Provider | Env Var |
|----------|---------|
| DeepSeek | `DEEPSEEK_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google AI | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| xAI | `XAI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Qwen / DashScope | `DASHSCOPE_API_KEY` |
| GLM / Zhipu | `ZHIPU_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` |
| CoinGecko | `COINGECKO_API_KEY` |
| CryptoPanic | `CRYPTOPANIC_API_TOKEN` |

### 3.2 Verify current keys work

```bash
# Smoke-test LLM connectivity
python scripts/smoke_structured_output.py

# Run a minimal research to verify data providers
lunacrypto research run BTC/USDT --yes --plain
```

If the current key is already expired, skip to Section 4.

---

## 4. Rotation Procedure

### Method A: Environment variables (recommended for local dev)

1. **Generate new key** from the provider's console/dashboard.

2. **Update environment**:
   ```bash
   # Linux/macOS
   export DEEPSEEK_API_KEY="sk-new-key-value"

   # Windows PowerShell
   $env:DEEPSEEK_API_KEY = "sk-new-key-value"
   ```

3. **Remove old key** from persistent storage:
   - Delete from `.env` file if using one
   - Remove from shell profile (`.bashrc`, `.zshrc`, etc.)
   - Revoke old key in provider console

4. **Verify**:
   ```bash
   python scripts/smoke_structured_output.py
   ```

### Method B: `.env` file (recommended for team setups)

1. **Generate new key**.

2. **Update `.env`**:
   ```bash
   # .env
   DEEPSEEK_API_KEY=sk-new-key-value
   ```

3. **Revoke old key** in provider console.

4. **Verify**:
   ```bash
   python scripts/smoke_structured_output.py
   ```

5. **Commit `.env.example` update** (if the key name changed):
   ```bash
   # .env.example — NEVER commit actual keys
   DEEPSEEK_API_KEY=your-deepseek-api-key-here
   ```

### Method C: Keyring (for headless/CI)

1. **Generate new key**.

2. **Store in system keyring**:
   ```bash
   # Requires `secrets.source = "keyring"` or `"env,keyring"` in config
   python -c "
   import keyring
   keyring.set_password('tradingagents', 'DEEPSEEK_API_KEY', 'sk-new-key-value')
   "
   ```

3. **Update config** if switching to keyring:
   ```toml
   [secrets]
   source = "keyring"
   ```

4. **Revoke old key**.

5. **Verify**.

### Method D: Multiple providers simultaneously

When rotating keys for multiple providers (e.g., after a team change):

```bash
# 1. Generate all new keys first
# 2. Update all at once
export DEEPSEEK_API_KEY="sk-new-deepseek"
export OPENAI_API_KEY="sk-new-openai"
export ANTHROPIC_API_KEY="sk-ant-new"

# 3. Revoke all old keys
# 4. Verify all providers
python scripts/smoke_structured_output.py
```

---

## 5. During Rotation: Handling Active Runs

### If no run is active

Rotate immediately — no coordination needed.

### If a run is in progress

- **LLM key rotation during a run**: The `LLMOrchestrator` will detect the 401 error on the next LLM call, classify it as non-retryable, and fail the run. **Wait for the run to complete or fail before rotating.**
- **Data provider key rotation**: Data provider calls are also keyed. Same guidance — wait for the run to finish.
- **Checkpoint recovery**: If a run fails mid-rotation, resume with the new key:
  ```bash
  lunacrypto research run BTC/USDT --checkpoint --yes --plain
  ```

### Zero-downtime rotation (advanced)

For continuous operation:

1. Generate new key but do NOT revoke old key yet.
2. Update env with new key.
3. Wait for any in-progress runs to complete.
4. Revoke old key.
5. Verify.

---

## 6. Post-Rotation Verification

```bash
# 1. Smoke test the rotated LLM provider
python scripts/smoke_structured_output.py deepseek

# 2. Run a full research cycle
lunacrypto research run BTC/USDT --yes --plain

# 3. Check journal for no auth errors
lunacrypto journal list --limit 10
lunacrypto journal timeline <run_id>
# Expect: research_run_started → ... → research_run_completed
# NOT: storage_operation_failed or llm_call status=failed

# 4. Verify secret redaction still works
# Check structured logs — no real keys should appear
```

### Redaction verification

```bash
python -c "
from tradingagents.observability.logging import redact_secrets
payload = {'api_key': 'should-be-redacted', 'model': 'v4-pro'}
print(redact_secrets(payload))
# Expected: {'api_key': '[REDACTED]', 'model': 'v4-pro'}
"
```

---

## 7. Incident: Key Compromised

If an API key is known to be compromised:

### Immediate (within 5 minutes)

1. **Revoke the key** in the provider console.
2. **Check for unauthorized usage** in provider billing dashboard.
3. **Remove key from all environments** (`.env`, shell profiles, CI secrets).

### Containment (within 1 hour)

1. **Generate new key**.
2. **Deploy new key** to all environments.
3. **Rotate all other keys** if the compromise vector is unknown.
4. **Audit recent runs** for anomalies:
   ```bash
   lunacrypto journal list --limit 20
   ```

### Recovery (within 24 hours)

1. File an incident report.
2. Review `SecretRedactionFilter` coverage — ensure no keys were logged.
3. Audit `.git` history for the old key:
   ```bash
   git log --all --full-history -- .env
   ```
4. If the key was committed, use `git filter-branch` or `BFG Repo-Cleaner` to purge it, then force-push.
5. Consider enabling `secrets.warn_on_plaintext_env` (default `true`) for future runs.

### Key leaked to logs/journal?

The journal stores `payload_json` for research runs. Check if any redacted keys leaked:

```sql
SELECT id, symbol, started_at
FROM research_runs
WHERE payload_json LIKE '%sk-%'
   OR payload_json LIKE '%api_key%';
```

If results found, those rows need manual cleanup.

---

## 8. Automation (Future)

Planned enhancements:

- `tradingagents key rotate` CLI command to automate key rotation.
- Key expiration tracking in config with warnings.
- Integration with provider key management APIs.

For now, this runbook covers the manual process.

---

## 9. Checklist

- [ ] New key generated in provider console
- [ ] Old key revoked (if compromised: revoked FIRST)
- [ ] Environment updated (env var, `.env`, or keyring)
- [ ] Smoke test passed
- [ ] Full research run verified
- [ ] Journal checked (no auth errors)
- [ ] Redaction verified
- [ ] Old key removed from all locations
- [ ] Team notified of key change
- [ ] Incident report filed (if compromise)
