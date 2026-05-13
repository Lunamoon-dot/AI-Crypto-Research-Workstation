# LLM Deprecation Runbook

**Last updated**: 2026-05-11
**Audience**: Developers and operators running TradingAgents
**Scope**: Handling model deprecation, EOL, and migration

---

## 1. Background

LLM providers periodically deprecate older models. When a model reaches EOL:

- The API may reject requests (HTTP 400 / 404 with "model not found" or "deprecated").
- `LLMOrchestrator` classifies these as non-retryable errors (401/403/not-found).
- The circuit breaker will NOT trip for non-retryable errors — the run fails immediately.

TradingAgents persists model identifiers on every `ResearchRun` (fields `deep_think_model`, `quick_think_model`, `llm_provider`), enabling retrospective impact analysis.

---

## 2. Detection

### Automated signals

| Signal | Meaning |
|--------|---------|
| `llm.call` event with status `failed`, error `"model not found"` or `"deprecated"` | A configured model is no longer available |
| `llm.output_failure` event | An LLM returned an unparseable response (may precede deprecation) |
| `research_run_failed` event with `error_type` containing `"NotFound"` or `"deprecated"` | A run failed due to model unavailability |

### Proactive monitoring

```bash
# List runs grouped by model to identify which historical runs are affected
lunacrypto journal timeline --limit 500 | grep -E "deep_think_llm|quick_think_llm"

# Check current config
lunacrypto config show
```

### Provider deprecation announcements

| Provider | Announcement Channel |
|----------|---------------------|
| DeepSeek | https://platform.deepseek.com/docs |
| OpenAI | https://platform.openai.com/docs/deprecations |
| Anthropic | https://docs.anthropic.com/en/docs/about-claude/deprecations |
| Google AI | https://ai.google.dev/gemini-api/docs/models |
| xAI | https://docs.x.ai/docs |

---

## 3. Impact Assessment

### Which runs used the deprecated model?

Query the journal database:

```sql
SELECT id, symbol, started_at, deep_think_model, quick_think_model, llm_provider, config_hash
FROM research_runs
WHERE deep_think_model = 'DEPRECATED_MODEL_NAME'
   OR quick_think_model = 'DEPRECATED_MODEL_NAME'
ORDER BY started_at DESC;
```

Or via CLI:

```bash
lunacrypto journal list --limit 20
```

### Config hash mapping

The `config_hash` field on each `ResearchRun` links to a specific configuration snapshot. Two runs with the same config hash used identical settings (modulo secrets). To find all runs that used a particular config:

```sql
SELECT config_hash, COUNT(*) as run_count
FROM research_runs
WHERE quick_think_model = 'DEPRECATED_MODEL_NAME'
GROUP BY config_hash;
```

---

## 4. Response: Model Migration

### Step 1: Identify replacement model

Check current provider model lists:

```bash
# For DeepSeek
python -c "
from tradingagents.llm_clients.model_catalog import KNOWN_MODELS
for k, v in KNOWN_MODELS.get('deepseek', {}).items():
    print(k, v)
"
```

Or consult the provider's documentation.

### Step 2: Update config

```toml
# config/local.toml
deep_think_llm = "deepseek-v4.1-pro"     # was "deepseek-v4-pro"
quick_think_llm = "deepseek-v4.1-flash"   # was "deepseek-v4-flash"
```

Or set environment variables:

```bash
export TRADINGAGENTS_DEEP_THINK_LLM="deepseek-v4.1-pro"
export TRADINGAGENTS_QUICK_THINK_LLM="deepseek-v4.1-flash"
```

### Step 3: Validate

```bash
# Smoke test with new model
python scripts/smoke_structured_output.py

# Run a single-ticker research to verify end-to-end
lunacrypto research BTC/USDT
```

### Step 4: Re-run affected research (optional)

For any critical past run that used the deprecated model, re-run with the new model to compare:

```bash
lunacrypto research BTC/USDT --date 2026-05-01
```

The new run will have a different `config_hash` and model fields, enabling side-by-side comparison.

---

## 5. Model-Specific Migration Notes

### DeepSeek

| Old Model | Replacement | Notes |
|-----------|-------------|-------|
| `deepseek-reasoner` | `deepseek-v4-pro` | Reasoning mode on V4 Pro is the successor |
| `deepseek-v4-pro` | `deepseek-v4.1-pro` (TBD) | Check API docs for latest |
| `deepseek-v4-flash` | `deepseek-v4.1-flash` (TBD) | Flash models are regularly updated |

**Thinking mode**: If migrating from a reasoning model, keep `DeepSeekChatOpenAI`'s thinking-mode round-trip intact — it handles `reasoning_content` propagation automatically.

**Structured output**: `deepseek-v4-pro` and `deepseek-reasoner` do NOT support `tool_choice`. The agent factory falls back to free-text generation (`invoke_structured_or_freetext`). If the replacement model supports function calling, structured output will activate automatically.

### OpenAI

| Old Model | Replacement |
|-----------|-------------|
| `gpt-4-turbo` | `gpt-4.1` |
| `gpt-4o` | `gpt-4.1` |

**Structured output**: Use `use_responses_api = True` (default for `openai` provider).

### Anthropic

| Old Model | Replacement |
|-----------|-------------|
| `claude-3-opus` | `claude-3.5-sonnet` or `claude-4` |
| `claude-3-sonnet` | `claude-3.5-sonnet` |

### Google

| Old Model | Replacement |
|-----------|-------------|
| `gemini-1.5-pro` | `gemini-2.0-flash` or `gemini-2.5-pro` |
| `gemini-1.5-flash` | `gemini-2.0-flash` |

---

## 6. Fallback Handling

If the deprecated model is the **primary** provider:

1. The `LLMOrchestrator` will attempt fallback providers in order.
2. If a fallback provider uses the same model name (unlikely), it will also fail.
3. Configuring `deep_think_llm` and `quick_think_llm` per provider avoids this.

If the deprecated model is in the **fallback** chain:
- The fallback provider will be skipped.
- No run failure unless all providers are exhausted.

To add a new fallback:

```toml
[llm_fallback]
fallback_providers = ["openrouter", "openai", "xai"]  # add xai
```

---

## 7. Rollback

If the new model produces worse results:

1. Switch back to the old model (if still available):
   ```toml
   deep_think_llm = "deepseek-v4-pro"  # rollback
   ```

2. Compare `config_hash` between runs:
   ```bash
   lunacrypto journal list --limit 20
   ```

3. Validate regression:
   ```bash
   lunacrypto research evaluate batch --symbol BTC/USDT --limit 20
   ```

---

## 8. Checklist

- [ ] Provider deprecation notice received/identified
- [ ] Replacement model selected and validated
- [ ] Config updated (`config/local.toml` or env vars)
- [ ] Smoke test passed (`smoke_structured_output.py`)
- [ ] Single-ticker research run successful
- [ ] Affected historical runs documented (via `config_hash` query)
- [ ] Team notified of model change
