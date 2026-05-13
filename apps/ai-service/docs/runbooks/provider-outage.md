# Provider Outage Runbook

**Last updated**: 2026-05-11
**Audience**: Operators and developers running TradingAgents
**Severity levels**: Degraded → Partial Outage → Full Outage

---

## 1. Detection

### Automated signals

| Signal | Source | Meaning |
|--------|--------|---------|
| `provider.rate_limit` event in structured log | `tradingagents.observability` | A data or LLM provider returned 429 |
| `circuit_opened` event | `LLMOrchestrator` | Consecutive failures tripped the circuit breaker for an LLM provider |
| `health.failed` event | Data provider health check | A data vendor is unreachable |
| `data.stale` event | Signal engine | Cached data exceeds `max_age_hours` |
| `provider.call` with status `failed` | Data layer | A single vendor call failed |

### Manual checks

```bash
# Check the last N events in the journal
lunacrypto journal timeline --limit 20

# Run a targeted health check
python -c "
from tradingagents.dataflows.health import check_provider_health
print(check_provider_health('ccxt'))
"
```

---

## 2. Impact Assessment

### Data provider outage (CCXT, CoinGecko)

**Degraded**: One vendor fails but fallback chain succeeds.
- No user-visible impact; `route_to_vendor` transparently falls back.
- Monitor the `provider.call` event rate — if >10% fail, escalate.

**Partial Outage**: Fallback chain returns stale or partial data.
- Signal engine may produce lower-confidence scores (`stale_count` increases).
- Research run continues but the final rating carries a `stale_data` flag.

**Full Outage**: All vendors for a category fail.
- The graph raises an exception captured by `execute_with_fallback`.
- The run is marked `FAILED` and can be resumed via `--checkpoint` when the provider recovers.

### LLM provider outage (DeepSeek, OpenAI, etc.)

**Degraded**: Primary provider rate-limited, fallback provider active.
- `LLMOrchestrator` switches transparently.
- Check logs for `Switched LLM provider from X to Y`.

**Partial Outage**: Fallback also degraded.
- LLM calls may retry repeatedly; `circuit_breaker_window_sec` controls cooling period.
- Runs may take longer but still complete.

**Full Outage**: All LLM providers down.
- `execute_with_fallback` raises the last error.
- Run status → `FAILED`.

---

## 3. Response Procedures

### Data provider: switch vendor

Edit `config/local.toml` or the runtime config:

```toml
[data_vendors]
# Before: ccxt only
technical_indicators = "ccxt"
# After: add coingecko as primary, ccxt as fallback
technical_indicators = "coingecko,ccxt"
```

Or disable a failing vendor entirely:

```toml
disabled_data_vendors = ["ccxt"]
```

### LLM provider: manual override

```toml
# Switch primary provider
llm_provider = "openrouter"

# Extend fallback chain
[llm_fallback]
fallback_providers = ["openai", "xai", "google"]
```

### Extend timeouts

```toml
[provider_runtime]
timeout_sec = 40.0   # increase from default 20
retries = 3           # increase from default 2
```

### Checkpoint resume

If a run was interrupted:

```bash
lunacrypto research BTC/USDT --checkpoint
```

The graph resumes from the last successful node.

---

## 4. Recovery Verification

After the provider is restored:

1. Run a smoke test:
   ```bash
   python scripts/smoke_structured_output.py
   ```

2. Check recent run events:
   ```bash
   lunacrypto journal timeline --limit 5
   ```

3. Verify circuit breakers are closed:
   - No `circuit_opened` events in the last `circuit_breaker_window_sec` seconds.
   - `LLMOrchestrator.is_circuit_open(provider)` returns `False`.

4. For data providers, verify freshness:
   ```bash
   lunacrypto signals BTC/USDT
   ```
   - Check that `stale_count` is 0.

---

## 5. Escalation

| Condition | Action |
|-----------|--------|
| Single provider down > 30 min | Switch to fallback, file issue with provider |
| All LLM providers down | Run is blocked — wait or use local model (Ollama) |
| All data vendors down | Run is blocked — stale-data mode `fail_fast` prevents bad signals |
| Repeated circuit breaker trips | Increase `circuit_breaker_window_sec` or reduce `circuit_breaker_threshold` |

---

## 6. Provider Status Pages

| Provider | Status Page |
|----------|-------------|
| DeepSeek | https://status.deepseek.com |
| OpenAI | https://status.openai.com |
| Anthropic | https://status.anthropic.com |
| Google AI | https://status.cloud.google.com |
| xAI | https://status.x.ai |
| OpenRouter | https://openrouter.ai/status |
| CCXT | https://github.com/ccxt/ccxt/issues |
| CoinGecko | https://status.coingecko.com |
