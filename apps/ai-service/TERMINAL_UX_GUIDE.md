# TradingAgents Terminal UX Guide

> Cập nhật: 2026-05-12. Áp dụng cho `apps/ai-service` version `0.3.0`.

Hướng dẫn này mô tả cách dùng TradingAgents như một **AI Crypto Research Workstation** trên terminal. Terminal UX tập trung vào research, thesis, journal, watchlist, market brief, replay và outcome review.

TradingAgents không phải autonomous trading bot. CLI không tự đặt lệnh, không mở/đóng vị thế, không biến prose của LLM thành lệnh exchange, và không chạy background execution loop.

## 1. Entry Point

Chạy từ package đã cài:

```bash
tradingagents
```

Chạy trực tiếp từ source trong `apps/ai-service`:

```bash
python -m cli.main
```

Nếu chưa cài editable package:

```bash
cd apps/ai-service
python -m pip install -e ".[dev]"
```

Không truyền subcommand sẽ mở interactive research wizard.

## 2. Command Map Hiện Tại

Top-level commands đang được mount:

```bash
tradingagents analyze
tradingagents watchlist ...
tradingagents dashboard
tradingagents config ...
tradingagents journal ...
tradingagents thesis ...
tradingagents signals ...
tradingagents brief ...
tradingagents diff ...
tradingagents research ...
tradingagents replay ...
tradingagents engine ...
```

Namespace `research` gom các workflow research-first và alias:

```bash
tradingagents research run
tradingagents research workspace
tradingagents research brief
tradingagents research journal ...
tradingagents research thesis ...
tradingagents research signals ...
tradingagents research watchlist ...
tradingagents research briefs ...
tradingagents research evaluate ...
tradingagents research replay ...
tradingagents research diff ...
```

Lưu ý: `evaluate` hiện được mount dưới `research evaluate`, chưa phải top-level command. Không có top-level `risk` command trong CLI hiện tại.

## 3. Workflow Khuyến Nghị Hằng Ngày

```text
Setup/config
-> Run research
-> Inspect journal workspace
-> Decide or watch thesis
-> Build daily brief
-> Check watchlist alerts explicitly
-> Review outcome later
-> Evaluate / retrospective
```

Các màn hình dùng nhiều nhất:

```bash
tradingagents dashboard
tradingagents journal workspace <run_id>
tradingagents thesis show <thesis_id>
tradingagents watchlist brief
tradingagents brief daily
tradingagents journal retrospective
```

## 4. Setup Và Cấu Hình

### First-run summary

Lệnh read-only để xem journal path, provider routing và next commands:

```bash
tradingagents config setup
```

### File cấu hình

TradingAgents dùng chuỗi ưu tiên cấu hình từ thấp đến cao:

1. Code defaults trong `tradingagents/default_config.py`
2. `config/default.toml`
3. `config/local.toml`, dùng cho override cá nhân và gitignored
4. Profile trong `~/.tradingagents/profiles/<name>.yaml`
5. Biến môi trường prefix `TRADINGAGENTS_`
6. CLI hoặc programmatic overrides

### API keys

Tạo `.env` từ template:

```bash
cp .env.example .env
```

Các biến phổ biến:

```text
DEEPSEEK_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
XAI_API_KEY
DASHSCOPE_API_KEY
ZHIPU_API_KEY
OPENROUTER_API_KEY
AZURE_OPENAI_API_KEY
AZURE_OPENAI_ENDPOINT
CRYPTOPANIC_API_TOKEN
COINGECKO_API_KEY
```

Override key riêng cho TradingAgents dùng prefix `TRADINGAGENTS_`, ví dụ:

```bash
export TRADINGAGENTS_OPENAI_API_KEY=...
```

### Validate và health check

Kiểm tra cấu hình effective:

```bash
tradingagents config validate
tradingagents config validate --warn
tradingagents config validate --profile <profile_name>
```

Xem config đã merge và đã redact secrets:

```bash
tradingagents config effective
tradingagents config effective --profile <profile_name>
tradingagents config show <profile_name> --effective
```

Tạo `config/local.toml` bằng wizard:

```bash
tradingagents config init
```

Health check provider:

```bash
tradingagents config health
tradingagents config health --no-live
tradingagents config health --no-llm
tradingagents config health --json
```

Profile management:

```bash
tradingagents config list
tradingagents config save <profile_name>
tradingagents config show <profile_name>
tradingagents config show <profile_name> --full
tradingagents config delete <profile_name>
```

## 5. Chạy Research

### Interactive mode

```bash
tradingagents
tradingagents research run
```

Wizard hỏi symbol, date, analysts, provider/model, research depth và thesis planning.

### Non-interactive mode

Dùng cho script, CI hoặc terminal nhanh:

```bash
tradingagents research run BTC/USDT \
  --yes \
  --plain \
  --date 2026-05-08 \
  --analysts market,social,news,onchain \
  --research-depth 1
```

Chỉ định provider/model:

```bash
tradingagents research run ETH/USDT \
  --yes \
  --plain \
  --llm-provider openai \
  --quick-model gpt-5.4-mini \
  --deep-model gpt-5.4
```

Lưu report:

```bash
tradingagents research run BTC/USDT \
  --yes \
  --plain \
  --save-report \
  --save-path reports/BTC_manual_run
```

Dry run để validate config/data access mà không chạy LLM pipeline:

```bash
tradingagents research run BTC/USDT --yes --dry-run
tradingagents analyze --ticker BTC/USDT --non-interactive --dry-run
```

Checkpoint resume:

```bash
tradingagents analyze --checkpoint
tradingagents analyze --clear-checkpoints
```

## 6. Research Namespace

`research` là namespace cho terminal-first research workflow. Các alias quan trọng:

```bash
tradingagents research run BTC/USDT --date 2026-05-08
tradingagents research workspace <run_id>
tradingagents research brief
tradingagents research brief --watchlist default --no-save
```

Các group con:

```bash
tradingagents research journal ...
tradingagents research thesis ...
tradingagents research signals ...
tradingagents research watchlist ...
tradingagents research briefs ...
tradingagents research evaluate ...
tradingagents research replay ...
tradingagents research diff ...
```

## 7. Journal Workflow

Xem journal SQLite path:

```bash
tradingagents journal path
```

Apply idempotent migrations:

```bash
tradingagents journal migrate
```

List và inspect runs:

```bash
tradingagents journal list
tradingagents journal list --limit 50
tradingagents journal show <run_id>
```

Màn hình chính sau research:

```bash
tradingagents journal workspace <run_id>
```

Workspace hiển thị run, market snapshot, signal snapshot, debate, thesis, scenarios, timeline và next useful commands.

Xem timeline, snapshots và debate:

```bash
tradingagents journal timeline <run_id>
tradingagents journal market-snapshot <snapshot_id>
tradingagents journal signal-snapshot <snapshot_id>
tradingagents journal debate <debate_id>
```

Export portable evidence bundle:

```bash
tradingagents journal bundle <run_id>
tradingagents journal bundle <run_id> --out reports/run_bundle.json
```

Outcome analytics:

```bash
tradingagents journal outcomes
tradingagents journal outcomes --symbol BTC/USDT
tradingagents journal retrospective
tradingagents journal retrospective --symbol BTC/USDT
```

Nhiều journal commands hỗ trợ `--json` và `--plain` cho automation.

## 8. Thesis Workflow

List và inspect thesis:

```bash
tradingagents thesis list
tradingagents thesis show <thesis_id>
tradingagents thesis scenarios <thesis_id>
tradingagents thesis timeline <thesis_id>
```

Ghi decision thủ công:

```bash
tradingagents thesis decide <thesis_id> watched --notes "Waiting for confirmation"
```

Actions hợp lệ:

```text
accepted
rejected
watched
ignored
needs_more_research
```

Review outcome sau khi thị trường đã diễn biến:

```bash
tradingagents thesis review <thesis_id> mixed \
  --lessons "Funding overheated before confirmation" \
  --mfe 0.08 \
  --mae -0.03
```

Results hợp lệ:

```text
hit_target
invalidated
mixed
expired
unknown
```

## 9. Signals Workflow

List signals:

```bash
tradingagents signals list
tradingagents signals list BTC/USDT
tradingagents signals list BTC/USDT --limit 100
```

Xem signal provenance:

```bash
tradingagents signals show <signal_id>
```

Signal view giúp kiểm tra source, observed time, source timestamp, freshness, confidence, evidence và historical reliability nếu có.

## 10. Watchlist Và Alerts

Thêm symbol watch-only:

```bash
tradingagents watchlist add-symbol SOL/USDT
```

Thêm thesis vào watchlist:

```bash
tradingagents watchlist add-thesis <thesis_id>
```

Xem watchlist:

```bash
tradingagents watchlist list
tradingagents watchlist list --all
tradingagents watchlist list --watchlist default --json
```

Daily watchlist brief:

```bash
tradingagents watchlist brief
tradingagents watchlist brief --unread
tradingagents watchlist brief --evaluate-snapshots
```

`watchlist brief` là read-only. Nó không tạo alert mới.

Chạy one-shot monitoring check:

```bash
tradingagents watchlist check
```

Override giá hiện tại thủ công:

```bash
tradingagents watchlist check --price BTC/USDT=110100
```

`check` có thể tạo alerts như:

- `thesis_invalidated`
- `target_zone_reached`
- `scenario_activated`

Xem alerts:

```bash
tradingagents watchlist alerts
tradingagents watchlist alerts --unread
tradingagents watchlist alerts --symbol BTC/USDT
tradingagents watchlist alerts --thesis-id <thesis_id>
```

Disable watchlist item:

```bash
tradingagents watchlist remove <item_id>
```

## 11. Market Brief

`brief` tạo daily market brief từ dữ liệu đã persist trong journal/watchlist.

Tạo brief:

```bash
tradingagents brief daily
tradingagents brief daily --watchlist default --date 2026-05-12
tradingagents brief daily --no-evaluate-snapshots
tradingagents brief daily --no-save
```

List và show brief đã lưu:

```bash
tradingagents brief list
tradingagents brief list --watchlist default
tradingagents brief show <brief_id>
```

Alias trong research namespace:

```bash
tradingagents research brief
tradingagents research briefs list
```

## 12. Diff Workflow

So sánh hai thesis:

```bash
tradingagents diff thesis <thesis_id_1> <thesis_id_2>
tradingagents diff thesis <thesis_id_1> <thesis_id_2> --json
```

So sánh hai research runs:

```bash
tradingagents diff run <run_id_1> <run_id_2>
tradingagents diff run <run_id_1> <run_id_2> --json
```

Diff dùng để review thay đổi về signals, thesis, debate stance và analyst opinions giữa hai lần research.

## 13. Historical Replay

`replay` chạy lại research pipeline cho ngày quá khứ với no-lookahead guardrails. Đây là replay research, không phải broker backtest.

Single-date replay:

```bash
tradingagents replay single BTC/USDT 2025-01-15 --lookback 60
tradingagents replay single BTC/USDT 2025-01-15 --strict
```

Batch replay:

```bash
tradingagents replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7
tradingagents replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7 --strict
```

Xem capability contract của data providers:

```bash
tradingagents replay capabilities
tradingagents replay capabilities --vendor ccxt
tradingagents replay capabilities --vendor ccxt --json
```

Alias:

```bash
tradingagents research replay single BTC/USDT 2025-01-15
```

## 14. Historical Thesis Evaluation

Evaluation hiện nằm dưới `research evaluate`:

```bash
tradingagents research evaluate thesis <thesis_id>
tradingagents research evaluate thesis <thesis_id> --window 30
tradingagents research evaluate thesis <thesis_id> --record-review
```

Batch và saved evaluations:

```bash
tradingagents research evaluate batch --symbol BTC/USDT --limit 20
tradingagents research evaluate list
tradingagents research evaluate analytics
tradingagents research evaluate analytics --json
```

Reliability và calibration:

```bash
tradingagents research evaluate factors
tradingagents research evaluate agents
tradingagents research evaluate confidence
tradingagents research evaluate contradictions
```

Auto-evaluation và health:

```bash
tradingagents research evaluate matured
tradingagents research evaluate trend
tradingagents research evaluate health
tradingagents research evaluate health --json
```

Evaluation là historical thesis quality review. Không đọc nó như PnL thật, Sharpe thật hoặc broker-accurate execution performance.

## 15. Dashboard

Mở terminal home screen:

```bash
tradingagents dashboard
tradingagents dashboard --watchlist default --limit 10
```

Dashboard dùng dữ liệu local đã persist: recent research runs, watched theses và recent alerts. Nó không gọi provider live.

## 16. Scriptable Output

Các command inspect chính hỗ trợ output machine-readable:

```bash
tradingagents journal list --json
tradingagents journal workspace <run_id> --json
tradingagents thesis show <thesis_id> --json
tradingagents signals list BTC/USDT --json
tradingagents watchlist brief --json
tradingagents watchlist alerts --plain
tradingagents diff run <run_id_1> <run_id_2> --json
```

Không dùng `--json` và `--plain` cùng lúc. CLI sẽ reject để tránh output mơ hồ.

## 17. Engine Contract

`engine` là contract cho worker hoặc service khác gọi Python research engine bằng JSON request file:

```bash
tradingagents engine run --request request.json
```

Output là JSON. Exit code khác 0 nếu engine result không phải `completed`.

## 18. Provider Fallback Và Circuit Breaker

Khi LLM provider chính gặp timeout, connection error hoặc rate limit, TradingAgents có thể thử fallback providers. Sau số lần fail liên tiếp theo cấu hình, circuit breaker sẽ tạm skip provider trước khi thử lại.

Ví dụ cấu hình trong `config/local.toml`:

```toml
[llm_fallback]
enabled = true
fallback_providers = ["openrouter", "openai"]
circuit_breaker_threshold = 3
circuit_breaker_window_sec = 300
```

Tắt fallback:

```toml
[llm_fallback]
enabled = false
```

Authentication errors như 401, 403 hoặc invalid API key cần sửa key. Không nên dựa vào fallback để che lỗi credential.

## 19. Nguyên Tắc An Toàn

- AI không tự đặt lệnh.
- Alerts không phải lệnh buy/sell.
- Copy trong terminal dùng ngôn ngữ `review`, `watch`, `reassess`, `stand aside`.
- `watchlist brief` và `brief daily` là read-only với provider live.
- `watchlist check` là explicit command có thể tạo alert.
- `replay` và `research evaluate` là historical research/thesis review, không phải broker backtest.
- Nếu sau này có execution layer, nó phải đi qua user approval, execution ticket, manual confirmation và audit trail.

## 20. Quick Start

Một flow ngắn để test sản phẩm:

```bash
tradingagents config setup
tradingagents config validate --warn
tradingagents research run BTC/USDT --yes --plain --date 2026-05-08
tradingagents journal list
tradingagents journal workspace <run_id>
tradingagents thesis list
tradingagents thesis show <thesis_id>
tradingagents watchlist add-thesis <thesis_id>
tradingagents watchlist brief --evaluate-snapshots
tradingagents brief daily
tradingagents watchlist check --price BTC/USDT=110100
tradingagents watchlist alerts
tradingagents thesis review <thesis_id> mixed --lessons "Manual review note"
tradingagents journal retrospective
tradingagents research evaluate thesis <thesis_id> --window 14
```
