# Session Work Summary — 2026-05-11

## Overview

Hoàn thành 4 task từ excellence backlog trên TradingAgents repo:

| # | Task | Status |
|---|------|--------|
| 1 | Model identifier + config hash trên ResearchRun | ✅ Done |
| 2 | Runbooks: provider outage, LLM deprecation, key rotation | ✅ Done |
| 3 | Run trace completeness — events cover toàn bộ pipeline | ✅ Done |
| 4 | Token/latency budgets per graph stage | ✅ Done |

---

## Task 1: Model identifier + config hash trên ResearchRun

### Files changed

#### `tradingagents/domain/research_run.py`
Thêm 4 fields vào `ResearchRun` model:
- `deep_think_model: str | None` — model name cho deep-thinking LLM (vd: `deepseek-v4-pro`)
- `quick_think_model: str | None` — model name cho quick-thinking LLM (vd: `deepseek-v4-flash`)
- `llm_provider: str | None` — provider name (vd: `deepseek`, `openai`)
- `config_hash: str | None` — SHA-256 16-char hex của effective config (secrets redacted)

Tất cả default `None` để backward compatible.

#### `tradingagents/storage/schema.py`
Thêm 4 cột vào `CREATE TABLE research_runs`:
- `deep_think_model TEXT`
- `quick_think_model TEXT`
- `llm_provider TEXT`
- `config_hash TEXT`

#### `tradingagents/graph/config_hash.py` (NEW)
Module `compute_config_hash(config: dict) -> str`:
- Redact tất cả giá trị của key chứa pattern secret (`api_key`, `token`, `secret`, `password`, `authorization`, v.v.)
- Loại trừ non-deterministic top-level keys (`project_dir`, `results_dir`, `data_cache_dir`)
- Sort keys recursively để hash ổn định cross-run
- SHA-256, trả về 16 ký tự hex đầu tiên

#### `tradingagents/graph/research_agents_graph.py`
- Import `compute_config_hash` từ `.config_hash`
- Import `BudgetTracker` từ observability
- Khi tạo `ResearchRun` trong `_run_graph()`: populate `deep_think_model`, `quick_think_model`, `llm_provider`, `config_hash` từ config
- Khởi tạo `self.budget_tracker = BudgetTracker(self.config)` trong `__init__`
- Wrap `self.graph.invoke()` trong `self.budget_tracker.stage("total")`
- Thêm `record_llm_usage(input_tokens, output_tokens)` method
- Emit `budget_summary` event khi run hoàn thành

#### `tradingagents/storage/repositories/journal.py`
Cập nhật `save_research_run()`:
- SQL INSERT: thêm 4 cột mới + 4 tham số `?`
- SQL ON CONFLICT DO UPDATE: thêm 4 cột mới
- Tuple values: thêm `run.deep_think_model`, `run.quick_think_model`, `run.llm_provider`, `run.config_hash`

### Test

#### `tests/test_config_hash.py` (NEW)
13 tests trong 2 class:
- `TestConfigHash`: empty config, stability, different configs, secret redaction, nested secrets, path exclusion, key ordering, nested structure, list values
- `TestResearchRunModelIdentity`: default None, explicit setting, serialization roundtrip, model_dump includes fields

---

## Task 2: Runbooks (docs only)

### Files created

#### `docs/runbooks/provider-outage.md`
- **Detection**: automated signals (rate_limit, circuit_opened, health.failed, stale data) + manual checks
- **Impact**: phân biệt degraded/partial/full outage cho cả data provider và LLM provider
- **Response**: switch vendor config, manual override LLM, extend timeouts, checkpoint resume
- **Recovery verification**: smoke test, timeline check, circuit breaker status, freshness check
- **Escalation table**: các tình huống và hành động tương ứng
- **Provider status pages**: DeepSeek, OpenAI, Anthropic, Google, xAI, OpenRouter, CCXT, CoinGecko

#### `docs/runbooks/llm-deprecation.md`
- **Detection**: automated signals + proactive monitoring (config_hash query)
- **Impact assessment**: SQL queries để tìm runs affected bởi deprecated model, config hash grouping
- **Migration**: 4-step process (identify replacement → update config → validate → re-run)
- **Model-specific notes**: DeepSeek (thinking mode, structured output), OpenAI, Anthropic, Google
- **Fallback handling**: fallback chain behavior, rollback procedure
- **Checklist**: 7 mục pre/post-migration

#### `docs/runbooks/key-rotation.md`
- **4 methods**: env var, `.env` file, keyring, multi-provider simultaneous
- **Zero-downtime rotation**: generate new → update env → wait runs → revoke old
- **Compromise incident**: immediate (5 min), containment (1 hour), recovery (24 hours)
- **SQL audit**: query journal DB cho leaked keys
- **Verification**: smoke test, research cycle, redaction check
- **Checklist**: 10 mục

---

## Task 3: Run trace completeness

### Files changed

#### `tradingagents/observability/logging.py`

**`_TIMELINE_EVENT_TYPES`** mở rộng từ 14 → 26 entries:

| Before (14) | After (26) — new entries |
|-------------|--------------------------|
| run.started | signal.quant_computed |
| run.completed | analyst.started |
| run.failed | analyst.completed |
| provider.call | debate.round_started |
| llm.call | debate.round_completed |
| snapshot.health | debate.concluded |
| data.stale | research_manager.decision |
| storage.failed | trader.decision |
| provider.rate_limit | risk.round_started |
| llm.output_failure | risk.round_completed |
| health.failed | risk.concluded |
| data.fetched | portfolio_manager.decision |
| signal.generated | scenario_plan.generated |
| decision.created | checkpoint.saved |
| risk.checked | provider.circuit_opened |
| order.submitted | provider.fallback_succeeded |
| | budget.exceeded |

**`_timeline_message()`** — thêm handler message cho tất cả 26 event types.

#### `tradingagents/graph/analyst_runtime.py`
- Thêm `import time, logging` và `from tradingagents.observability import log_event`
- `make_analyst_runner()` nhận thêm param `analyst_name: str = ""`
- Emit `analyst_started` khi bắt đầu analyst run
- Emit `analyst_completed` với `duration_ms` và `report_length` khi kết thúc

#### `tradingagents/graph/setup.py`
- Pass `analyst_name=node_name` vào `make_analyst_runner()` cho mỗi analyst (Market, Social, News, Onchain)

---

## Task 4: Token/latency budgets per graph stage

### Files changed

#### `tradingagents/observability/budget.py` (NEW)

**`StageBudget`** class — per-stage tracking:
- `start()` / `stop()` — đo latency bằng `time.perf_counter()`
- `add_tokens(count)` — cộng dồn token usage
- `check_budgets()` — trả về list message nếu vượt ngưỡng
- `summary()` — dict với stage, tokens, max_tokens, latency_sec, max_latency_sec

**`BudgetTracker`** class — multi-stage orchestrator:
- `stage(stage, **ctx)` — context manager: start/stop clock, check budgets on exit, emit `budget_exceeded` event
- `add_tokens(input, output)` — cộng token vào stage hiện tại + total
- `summary()` — list tất cả stage summaries
- `check_total_budget()` — kiểm tra total budget

**`merge_budget_config(config)`** — utility merge user config với defaults

**Default budgets** — 9 stages:

| Stage | max_tokens | max_latency_sec |
|-------|-----------|-----------------|
| analyst (per) | 20,000 | 60s |
| analysts_total | 80,000 | 240s |
| debate | 40,000 | 120s |
| research_manager | 15,000 | 45s |
| trader | 10,000 | 30s |
| risk_debate | 50,000 | 150s |
| portfolio_manager | 15,000 | 45s |
| scenario_planner | 10,000 | 30s |
| total | 250,000 | 600s |

#### `tradingagents/observability/__init__.py`
Export thêm: `BudgetTracker`, `StageBudget`, `merge_budget_config`

#### `tradingagents/default_config.py`
Thêm section `budgets` với đầy đủ 9 stage configs (có thể override từng stage).

### Test

#### `tests/test_budget_tracking.py` (NEW)
19 tests trong 4 class:
- `TestStageBudget` (9 tests): initial state, add tokens, latency, within budget, token exceeded, latency exceeded, both exceeded, summary dict, budget remaining
- `TestBudgetTracker` (7 tests): nested stage tracking, total accumulation, latency, unknown stage, total budget check, summary, token accumulation across multiple starts
- `TestMergeBudgetConfig` (3 tests): empty config, partial override, full override
- `TestDefaultBudgets` (3 tests): total exceeds sum of stages, all required stages present, budgets are positive

---

## File inventory

### New files (7)
```
tradingagents/graph/config_hash.py
tradingagents/observability/budget.py
docs/runbooks/provider-outage.md
docs/runbooks/llm-deprecation.md
docs/runbooks/key-rotation.md
tests/test_config_hash.py
tests/test_budget_tracking.py
```

### Modified files (10)
```
tradingagents/domain/research_run.py
tradingagents/storage/schema.py
tradingagents/storage/repositories/journal.py
tradingagents/graph/research_agents_graph.py
tradingagents/graph/analyst_runtime.py
tradingagents/graph/setup.py
tradingagents/observability/logging.py
tradingagents/observability/__init__.py
tradingagents/default_config.py
```

### Total: 17 files (7 new + 10 modified)

---

## Breaking changes

- **Không có.** Tất cả field mới trên `ResearchRun` đều default `None` → backward compatible.
- SQLite schema thêm cột mới nhưng không xóa cột cũ → migration path an toàn.
- Event types cũ vẫn giữ nguyên, chỉ thêm mới.
- BudgetTracker là additive, không thay đổi hành vi existing code.
