# LunaCrypto Terminal UX Guide

> Cập nhật: 2026-05-12. Áp dụng cho `apps/ai-service` version `0.3.0`.

Hướng dẫn này mô tả cách dùng LunaCrypto như một **AI Crypto Research Workstation** trên terminal. Terminal UX tập trung vào research, thesis, journal, watchlist, market brief, replay và outcome review.

LunaCrypto là Spot/Perp research workstation. CLI tạo research artifact, thesis, journal entry, watchlist context, market brief và outcome review để user tự ra quyết định.

## 1. Entry Point

Chạy từ package đã cài:

```bash
lunacrypto
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
lunacrypto analyze
lunacrypto watchlist ...
lunacrypto dashboard
lunacrypto config ...
lunacrypto journal ...
lunacrypto thesis ...
lunacrypto signals ...
lunacrypto brief ...
lunacrypto diff ...
lunacrypto research ...
lunacrypto replay ...
lunacrypto engine ...
```

Namespace `research` gom các workflow research-first và alias:

```bash
lunacrypto research run
lunacrypto research workspace
lunacrypto research brief
lunacrypto research journal ...
lunacrypto research thesis ...
lunacrypto research signals ...
lunacrypto research watchlist ...
lunacrypto research briefs ...
lunacrypto research evaluate ...
lunacrypto research replay ...
lunacrypto research diff ...
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
lunacrypto dashboard
lunacrypto journal workspace <run_id>
lunacrypto thesis show <thesis_id>
lunacrypto watchlist brief
lunacrypto brief daily
lunacrypto journal retrospective
```

## 4. Setup Và Cấu Hình

### First-run summary

Lệnh read-only để xem journal path, provider routing và next commands:

```bash
lunacrypto config setup
```

### File cấu hình

LunaCrypto dùng chuỗi ưu tiên cấu hình từ thấp đến cao:

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

Override key riêng cho LunaCrypto vẫn dùng prefix legacy `TRADINGAGENTS_`, ví dụ:

```bash
export TRADINGAGENTS_OPENAI_API_KEY=...
```

### Validate và health check

Kiểm tra cấu hình effective:

```bash
lunacrypto config validate
lunacrypto config validate --warn
lunacrypto config validate --profile <profile_name>
```

Xem config đã merge và đã redact secrets:

```bash
lunacrypto config effective
lunacrypto config effective --profile <profile_name>
lunacrypto config show <profile_name> --effective
```

Tạo `config/local.toml` bằng wizard:

```bash
lunacrypto config init
```

Health check provider:

```bash
lunacrypto config health
lunacrypto config health --no-live
lunacrypto config health --no-llm
lunacrypto config health --json
```

Profile management:

```bash
lunacrypto config list
lunacrypto config save <profile_name>
lunacrypto config show <profile_name>
lunacrypto config show <profile_name> --full
lunacrypto config delete <profile_name>
```

## 5. Chạy Research

### Interactive mode

```bash
lunacrypto
lunacrypto research run
```

Wizard hỏi symbol, date, analysts, provider/model, research depth và thesis planning.

### Non-interactive mode

Dùng cho script, CI hoặc terminal nhanh:

```bash
lunacrypto research run BTC/USDT \
  --yes \
  --plain \
  --date 2026-05-08 \
  --analysts market,social,news,onchain \
  --research-depth 1
```

Chỉ định provider/model:

```bash
lunacrypto research run ETH/USDT \
  --yes \
  --plain \
  --llm-provider deepseek \
  --quick-model deepseek-v4-flash \
  --deep-model deepseek-v4-pro
```

Lưu report:

```bash
lunacrypto research run BTC/USDT \
  --yes \
  --plain \
  --save-report \
  --save-path reports/BTC_manual_run
```

Dry run để validate config/data access mà không chạy LLM pipeline:

```bash
lunacrypto research run BTC/USDT --yes --dry-run
lunacrypto analyze --ticker BTC/USDT --non-interactive --dry-run
```

Checkpoint resume:

```bash
lunacrypto analyze --checkpoint
lunacrypto analyze --clear-checkpoints
```

`--clear-checkpoints` đứng một mình chỉ xóa file checkpoint rồi thoát. Muốn xóa rồi chạy ngay một lần research, thêm `--ticker` và `--non-interactive` (và `--plain` nếu cần).

## 6. Research Namespace

`research` là namespace cho terminal-first research workflow. Các alias quan trọng:

```bash
lunacrypto research run BTC/USDT --date 2026-05-08
lunacrypto research workspace <run_id>
lunacrypto research brief
lunacrypto research brief --watchlist default --no-save
```

Các group con:

```bash
lunacrypto research journal ...
lunacrypto research thesis ...
lunacrypto research signals ...
lunacrypto research watchlist ...
lunacrypto research briefs ...
lunacrypto research evaluate ...
lunacrypto research replay ...
lunacrypto research diff ...
```

## 7. Journal Workflow

Xem journal SQLite path:

```bash
lunacrypto journal path
```

Apply idempotent migrations:

```bash
lunacrypto journal migrate
```

List và inspect runs:

```bash
lunacrypto journal list
lunacrypto journal list --limit 50
lunacrypto journal show <run_id>
```

Màn hình chính sau research:

```bash
lunacrypto journal workspace <run_id>
```

Workspace hiển thị run, market snapshot, signal snapshot, debate, thesis, scenarios, timeline và next useful commands.

Xem timeline, snapshots và debate:

```bash
lunacrypto journal timeline <run_id>
lunacrypto journal market-snapshot <snapshot_id>
lunacrypto journal signal-snapshot <snapshot_id>
lunacrypto journal debate <debate_id>
```

Export portable evidence bundle:

```bash
lunacrypto journal bundle <run_id>
lunacrypto journal bundle <run_id> --out reports/run_bundle.json
```

Outcome analytics:

```bash
lunacrypto journal outcomes
lunacrypto journal outcomes --symbol BTC/USDT
lunacrypto journal retrospective
lunacrypto journal retrospective --symbol BTC/USDT
```

Nhiều journal commands hỗ trợ `--json` và `--plain` cho automation.

## 8. Thesis Workflow

List và inspect thesis:

```bash
lunacrypto thesis list
lunacrypto thesis show <thesis_id>
lunacrypto thesis scenarios <thesis_id>
lunacrypto thesis timeline <thesis_id>
```

Ghi decision thủ công:

```bash
lunacrypto thesis decide <thesis_id> watched --notes "Waiting for confirmation"
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
lunacrypto thesis review <thesis_id> mixed \
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

Review latest signal snapshot for one symbol:

```bash
lunacrypto signals latest ETH/USDT
```

Review the exact signal snapshot attached to one research run:

```bash
lunacrypto signals snapshot <run_id>
```

Explain one saved signal:

```bash
lunacrypto signals explain <signal_id>
```

`signals list` van ton tai nhu cross-run browser:

```bash
lunacrypto signals list
lunacrypto signals list BTC/USDT
lunacrypto signals list BTC/USDT --limit 100
```

Signal UX dung `bullish`, `bearish`, `neutral`; composite duoc hien thi la
`quant_bias`, khong phai final user decision. Snapshot tach evidence lane:
`spot` (price, volume, regime, on-chain, relative strength) va `perp`
(funding, OI, liquidations, long-short, basis). `signals explain` hien thi
what changed, invalidation va review trigger de dung nhu monitor condition.
Historical reliability chi nen tin sau khi outcome reviews duoc ghi deu.

Signal view giúp kiểm tra source, observed time, source timestamp, freshness, confidence, evidence và historical reliability nếu có.

## 10. Watchlist Và Alerts

Thêm symbol watch-only:

```bash
lunacrypto watchlist add-symbol SOL/USDT
```

Thêm thesis vào watchlist:

```bash
lunacrypto watchlist add-thesis <thesis_id>
```

Xem watchlist:

```bash
lunacrypto watchlist list
lunacrypto watchlist list --all
lunacrypto watchlist list --watchlist default --json
```

Daily watchlist brief:

```bash
lunacrypto watchlist brief
lunacrypto watchlist brief --unread
lunacrypto watchlist brief --evaluate-snapshots
```

`watchlist brief` là read-only. Nó không tạo alert mới.

Chạy one-shot monitoring check:

```bash
lunacrypto watchlist check
```

Override giá hiện tại thủ công:

```bash
lunacrypto watchlist check --price BTC/USDT=110100
```

`check` có thể tạo alerts như:

- `thesis_invalidated`
- `target_zone_reached`
- `scenario_activated`

Xem alerts:

```bash
lunacrypto watchlist alerts
lunacrypto watchlist alerts --unread
lunacrypto watchlist alerts --symbol BTC/USDT
lunacrypto watchlist alerts --thesis-id <thesis_id>
```

Disable watchlist item:

```bash
lunacrypto watchlist remove <item_id>
```

## 11. Market Brief

`brief` tạo daily market brief từ dữ liệu đã persist trong journal/watchlist.

Tạo brief:

```bash
lunacrypto brief daily
lunacrypto brief daily --watchlist default --date 2026-05-12
lunacrypto brief daily --no-evaluate-snapshots
lunacrypto brief daily --no-save
```

List và show brief đã lưu:

```bash
lunacrypto brief list
lunacrypto brief list --watchlist default
lunacrypto brief show <brief_id>
```

Alias trong research namespace:

```bash
lunacrypto research brief
lunacrypto research briefs list
```

## 12. Diff Workflow

So sánh hai thesis:

```bash
lunacrypto diff thesis <thesis_id_1> <thesis_id_2>
lunacrypto diff thesis <thesis_id_1> <thesis_id_2> --json
```

So sánh hai research runs:

```bash
lunacrypto diff run <run_id_1> <run_id_2>
lunacrypto diff run <run_id_1> <run_id_2> --json
```

Diff dùng để review thay đổi về signals, thesis, debate stance và analyst opinions giữa hai lần research.

## 13. Historical Replay

`replay` chạy lại research pipeline cho ngày quá khứ với no-lookahead guardrails. Đây là replay research, không phải PnL backtest.

Single-date replay:

```bash
lunacrypto replay single BTC/USDT 2025-01-15 --lookback 60
lunacrypto replay single BTC/USDT 2025-01-15 --strict
```

Batch replay:

```bash
lunacrypto replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7
lunacrypto replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7 --strict
```

Xem capability contract của data providers:

```bash
lunacrypto replay capabilities
lunacrypto replay capabilities --vendor ccxt
lunacrypto replay capabilities --vendor ccxt --json
```

Alias:

```bash
lunacrypto research replay single BTC/USDT 2025-01-15
```

## 14. Historical Thesis Evaluation

Evaluation hiện nằm dưới `research evaluate`:

```bash
lunacrypto research evaluate thesis <thesis_id>
lunacrypto research evaluate thesis <thesis_id> --window 30
lunacrypto research evaluate thesis <thesis_id> --record-review
```

Batch và saved evaluations:

```bash
lunacrypto research evaluate batch --symbol BTC/USDT --limit 20
lunacrypto research evaluate list
lunacrypto research evaluate analytics
lunacrypto research evaluate analytics --json
```

Reliability và calibration:

```bash
lunacrypto research evaluate factors
lunacrypto research evaluate agents
lunacrypto research evaluate confidence
lunacrypto research evaluate contradictions
```

Auto-evaluation và health:

```bash
lunacrypto research evaluate matured
lunacrypto research evaluate trend
lunacrypto research evaluate health
lunacrypto research evaluate health --json
```

Evaluation là historical thesis quality review. Không đọc nó như realized PnL, Sharpe thật hoặc performance đã thực hiện ngoài thị trường.

## 15. Dashboard

Mở terminal home screen:

```bash
lunacrypto dashboard
lunacrypto dashboard --watchlist default --limit 10
```

Dashboard dùng dữ liệu local đã persist: recent research runs, watched theses và recent alerts. Nó không gọi provider live.

## 16. Scriptable Output

Các command inspect chính hỗ trợ output machine-readable:

```bash
lunacrypto journal list --json
lunacrypto journal workspace <run_id> --json
lunacrypto thesis show <thesis_id> --json
lunacrypto signals latest BTC/USDT --json
lunacrypto signals snapshot <run_id> --json
lunacrypto signals explain <signal_id> --json
lunacrypto watchlist brief --json
lunacrypto watchlist alerts --plain
lunacrypto diff run <run_id_1> <run_id_2> --json
```

Không dùng `--json` và `--plain` cùng lúc. CLI sẽ reject để tránh output mơ hồ.

## 17. Engine Contract

`engine` là contract cho worker hoặc service khác gọi Python research engine bằng JSON request file:

```bash
lunacrypto engine run --request request.json
```

Output là JSON. Exit code khác 0 nếu engine result không phải `completed`.

## 18. Provider Fallback Và Circuit Breaker

Khi LLM provider chính gặp timeout, connection error hoặc rate limit, LunaCrypto có thể thử fallback providers. Sau số lần fail liên tiếp theo cấu hình, circuit breaker sẽ tạm skip provider trước khi thử lại.

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

## 19. Product Boundary

- CLI dừng ở research artifact, thesis, journal, watchlist context và outcome review.
- Alerts là điều kiện để review lại thesis/watchlist.
- Copy trong terminal dùng ngôn ngữ `review`, `watch`, `reassess`, `stand aside`.
- `watchlist brief` không tạo alert. `brief daily` không gọi provider live, nhưng mặc định lưu market brief trừ khi dùng `--no-save`.
- `watchlist check` là explicit command có thể tạo alert.
- `replay` và `research evaluate` là historical research/thesis review, không phải PnL backtest.

## 20. Command Cookbook Và Kết Quả Dự Kiến

Phần này dùng như UX cookbook cho terminal. `Kết quả dự kiến` là hình dạng output phỏng đoán dựa trên command thật; ID, số lượng dòng và trạng thái sẽ thay đổi theo local journal, API key, provider health và dữ liệu đã lưu.

Quy ước placeholder:

```text
<run_id>      ID của research run đã lưu
<thesis_id>   ID của trade thesis đã lưu
<signal_id>   ID của signal provenance đã lưu
<brief_id>    ID của market brief đã lưu
<item_id>     ID của watchlist item
```

### 20.1 Setup, validate và provider health

Dùng khi mới clone repo, đổi máy, đổi API key, hoặc cần xác nhận CLI đang đọc đúng config.

```text
lunacrypto config setup
```

Kết quả dự kiến:

```text
LunaCrypto Setup Summary
Journal path: ~/.tradingagents/cache/research_journal.sqlite
Journal enabled: yes
Disabled data vendors: none

Active provider routing:
- market: ccxt, coingecko
- news: cryptopanic
- onchain: coingecko

Next Useful Commands
- lunacrypto research run
- lunacrypto dashboard
- lunacrypto config health
```

Side effect: read-only, không tạo file, không gọi provider live.

```bash
lunacrypto config validate --warn
```

Kết quả dự kiến khi hợp lệ:

```text
Configuration is valid.
  LLM Provider: deepseek
  Deep thinker: deepseek-v4-pro
  Quick thinker: deepseek-v4-flash
  Asset class: crypto
  LLM fallback: enabled (openrouter -> openai)
  Secrets source: env
```

Kết quả dự kiến khi thiếu key hoặc config sai:

```text
Configuration validation failed:
Missing required API key for provider deepseek
```

Side effect: read-only. Dùng `--warn` khi muốn gom cảnh báo thay vì fail ngay ở lỗi đầu tiên.

```bash
lunacrypto config health --no-live --no-llm
lunacrypto config health --json
```

Kết quả dự kiến:

```text
Provider Status
Provider      Status
ccxt          enabled
coingecko     enabled
cryptopanic   disabled

Category Routing
Category      Configured           Enabled       Disabled
market        ccxt, coingecko      ccxt          -
news          cryptopanic          -             cryptopanic

System Health: degraded
provider_config   healthy
news_provider     warning   disabled vendor=cryptopanic
```

Side effect: `--no-live --no-llm` là local-only. Không truyền các flag này thì command có thể probe provider và LLM.

```bash
lunacrypto config effective
lunacrypto config effective --profile scalping
```

Kết quả dự kiến:

```yaml
llm_provider: deepseek
deep_think_llm: deepseek-v4-pro
quick_think_llm: deepseek-v4-flash
secrets:
  source: env
deepseek_api_key: sk-...abcd
```

Side effect: read-only, secrets được redact. Hữu ích khi debug vì sao CLI chọn provider/model khác kỳ vọng.

```bash
lunacrypto config save scalping
lunacrypto config list
lunacrypto config show scalping --effective
lunacrypto config delete scalping
```

Kết quả dự kiến:

```text
Profile saved: scalping
Location: ~/.tradingagents/profiles/scalping.yaml

Saved Configuration Profiles
Profile Name    File
scalping        ~/.tradingagents/profiles/scalping.yaml
```

Side effect: `save` và `delete` ghi/xóa file profile trong `~/.tradingagents/profiles/`.

### 20.2 Research run và dry-run

Dùng khi muốn tạo một research workspace đầy đủ: market snapshot, signal snapshot, debate, thesis, timeline và next commands.

```bash
lunacrypto research run BTC/USDT \
  --yes \
  --plain \
  --date 2026-05-08 \
  --analysts market,social,news,onchain \
  --research-depth 1 \
  --dry-run
```

Kết quả dự kiến:

```text
Dry-Run Summary
Ticker: BTC/USDT
Analysis Date: 2026-05-08
Asset Class: crypto
Exchange: default
Analysts: market, social, news, onchain
Research Depth: 1
LLM Provider: deepseek
Quick Model: deepseek-v4-flash
Deep Model: deepseek-v4-pro

Data provider health check:
  OK ccxt: healthy
  WARN cryptopanic: missing_api_key

Dry-run complete - configuration is valid.
Remove --dry-run to run the full research pipeline.
```

Side effect (chỉ `--dry-run`): không chạy LangGraph / LLM pipeline và không tạo thesis, không ghi journal như bản chạy đầy đủ. Có thể có **một probe mạng nhẹ** (ví dụ CCXT `fetch_ticker` qua `check_provider_health`) để xác nhận data path — không tốn token LLM.

```bash
lunacrypto research run BTC/USDT \
  --yes \
  --plain \
  --date 2026-05-08 \
  --llm-provider deepseek \
  --quick-model deepseek-v4-flash \
  --deep-model deepseek-v4-pro
```

Side effect (lệnh trên **không** có `--dry-run`): chạy provider/data/LLM thật, ghi journal SQLite, có thể ghi checkpoints nếu bật `--checkpoint`.

Kết quả dự kiến khi thành công:

```text
Research run complete
Run ID: <run_id>
Symbol: BTC/USDT
Status: completed
Thesis: <thesis_id>
Signal Snapshot: <snapshot_id>

Next Useful Commands:
- lunacrypto journal workspace <run_id>
- lunacrypto thesis show <thesis_id>
- lunacrypto watchlist add-thesis <thesis_id>
```

Kết quả dự kiến khi provider lỗi:

```text
openai is rate-limiting requests (HTTP 429).
Wait a few minutes and try again, or switch to a different provider.
No research report was generated.
```

```bash
lunacrypto analyze --ticker ETH/USDT --non-interactive --plain --dry-run
```

Kết quả dự kiến: giống `research run ... --dry-run` (cùng code path trong CLI). Đây là compatibility path cho script cũ; **không** áp dụng mô tả “chạy LLM / journal đầy đủ” của bản chạy không `--dry-run` ở trên.

```bash
lunacrypto analyze --checkpoint
lunacrypto analyze --clear-checkpoints
```

- Chỉ `--clear-checkpoints` (không kèm `--ticker` / `--non-interactive` / `--plain`): in dòng cleared rồi **thoát** — không mở wizard Step 0.
- `--checkpoint` một mình: vẫn vào **interactive wizard** như `lunacrypto analyze` thường, nhưng bật lưu checkpoint khi chạy pipeline.

Kết quả dự kiến khi chỉ xóa checkpoint:

```text
Cleared 3 checkpoint(s).
```

Side effect: `--checkpoint` bật lưu checkpoint SQLite trong cache khi chạy graph; `--clear-checkpoints` xóa toàn bộ file checkpoint DB trong thư mục checkpoints (và nếu chỉ có flag này thì không chạy thêm research).

### 20.3 Dashboard

Dùng làm màn hình home mỗi sáng hoặc sau nhiều lần research.

```bash
lunacrypto dashboard --watchlist default --limit 10
```

Kết quả dự kiến:

```text
Research Workspace
Journal DB: ~/.tradingagents/cache/research_journal.sqlite
Watchlist: default | Items: 4 | Theses: 3 | Recent alerts: 2

Recent Research Runs
Run ID       Symbol     Status       Started                 Thesis
<run_id>     BTC/USDT   completed    2026-05-12T08:30:00Z   <thesis_id>

Watched Theses
Thesis        Symbol     Direction   Confidence
<thesis_id>   BTC/USDT   long        62%

Recent Alerts
- target_zone_reached: BTC/USDT reached target zone 110000
```

Side effect: read-only. Dashboard chỉ đọc local data đã persist, không gọi provider live.

### 20.4 Journal workspace và evidence bundle

Dùng để xem lại toàn bộ một run, audit evidence, hoặc export bundle cho review.

```bash
lunacrypto journal path
lunacrypto journal migrate
```

Kết quả dự kiến:

```text
~/.tradingagents/cache/research_journal.sqlite
Journal migrated: ~/.tradingagents/cache/research_journal.sqlite
```

Side effect: `path` read-only. `migrate` apply migration idempotent vào SQLite.

```bash
lunacrypto journal list --limit 5
lunacrypto journal list --limit 5 --plain
lunacrypto journal list --limit 5 --json
```

Kết quả dự kiến:

```text
Research Runs
ID           Symbol     Status       Started                 Thesis
<run_id>     BTC/USDT   completed    2026-05-12T08:30:00Z   <thesis_id>
```

Khi chưa có data:

```text
No research runs saved yet.
```

Side effect: read-only. Dùng `--json` cho automation và parsing.

```bash
lunacrypto journal show <run_id>
```

Kết quả dự kiến:

```text
Research Run
ID: <run_id>
Symbol: BTC/USDT
Status: completed
Market Snapshot: <snapshot_id>
Signal Snapshot: <snapshot_id>
Signals: 12
Debate: <debate_id>
Thesis: <thesis_id>
User Decision: N/A
Outcome Review: N/A
Completion Quality: clean
```

Side effect: read-only. Nếu run không tồn tại, exit code 1 với `Research run not found`.

```bash
lunacrypto journal workspace <run_id>
lunacrypto research workspace <run_id>
```

Kết quả dự kiến:

```text
Research Workspace
ID: <run_id>
Symbol: BTC/USDT
Status: completed
Signals: 12
Debate: <debate_id>
Thesis: <thesis_id>

Signal Reliability (latest snapshot)
Window: 30 day(s)
Sample size: 18

Debate
Consensus: bullish
Confidence: 64%
Conflict: medium

Trade Thesis
Direction: long
Setup: trend_pullback
Confidence: 62%

Next Useful Commands
- lunacrypto journal timeline <run_id>
- lunacrypto thesis show <thesis_id>
- lunacrypto watchlist add-thesis <thesis_id>
```

Side effect: read-only. Đây là màn hình chính sau khi research xong.

```bash
lunacrypto journal timeline <run_id>
lunacrypto thesis timeline <thesis_id>
```

Kết quả dự kiến:

```text
Research Run Timeline: <run_id>
Time                    Event             Message
2026-05-12T08:30:01Z    run.started       Engine run started for BTC/USDT
2026-05-12T08:34:52Z    thesis.created    Trade thesis saved
```

Side effect: read-only. Dùng để debug lifecycle hoặc audit thay đổi.

```bash
lunacrypto journal market-snapshot <snapshot_id>
lunacrypto journal signal-snapshot <snapshot_id>
lunacrypto journal debate <debate_id>
```

Kết quả dự kiến:

```text
Market Snapshot
Symbol: BTC/USDT
Price: 110100
Trend: up
Volatility: high
Source: ccxt

Signal Snapshot
Signal Count: 12
Bullish: 7
Bearish: 3
Neutral: 2

Research Debate
Consensus: bullish
Conflict: medium
Opinions: 4
```

Side effect: read-only. Các command này giúp đi từ summary xuống evidence chi tiết.

```bash
lunacrypto journal bundle <run_id> --out reports/run_bundle.json
```

Kết quả dự kiến:

```text
Wrote bundle to reports/run_bundle.json
```

Side effect: ghi một JSON evidence bundle gồm run, snapshots, thesis, scenarios và hashes.

```bash
lunacrypto journal outcomes --symbol BTC/USDT
lunacrypto journal retrospective --symbol BTC/USDT
```

Kết quả dự kiến:

```text
Outcome Analytics
Symbol: BTC/USDT
Reviewed Outcomes: 12
Hit Rate: 42%
Invalidation Rate: 25%
Mixed Rate: 33%

Retrospective Insights
Type                 Evidence   Message
factor_weakness      6          Funding squeeze setups underperformed
```

Side effect: read-only. Dùng cho review chất lượng research, không phải realized PnL.

### 20.5 Thesis lifecycle

Dùng để xem thesis, đưa vào watchlist, ghi quyết định thủ công và review outcome sau này.

```bash
lunacrypto thesis list --limit 10
lunacrypto thesis show <thesis_id>
```

Kết quả dự kiến:

```text
Trade Theses
ID            Symbol     Direction   Confidence   Created
<thesis_id>   BTC/USDT   long        62%          2026-05-12T08:34:52Z

Trade Thesis
Symbol: BTC/USDT
Direction: long
Setup: trend_pullback
Confidence: 62%

Price Levels:
  Entry Zone: 108000-110000
  Invalidation: 104500
  Target Zones:
    - 113500
    - 118000

Quick Check:
  Signals:       7 support / 3 contradict
  Data Gaps:     none reported
  Consensus:     medium conflict, stance=bullish
```

Side effect: read-only. `show` là nơi tốt nhất để review thesis trước khi quyết định.

```bash
lunacrypto thesis scenarios <thesis_id>
```

Kết quả dự kiến:

```text
Thesis Scenarios: <thesis_id>
Probability   Condition                       Expected Behavior       Action
base          Holds above 108000              Rotation higher         watch
bear          Breaks invalidation 104500      Thesis invalidated      stand aside
```

Side effect: read-only. Dùng để biết `watchlist check` sẽ dựa vào điều kiện nào.

```bash
lunacrypto thesis decide <thesis_id> watched --notes "Waiting for confirmation"
```

Kết quả dự kiến:

```text
Decision saved: <decision_id>
```

Side effect: ghi user decision vào journal. Không đặt lệnh giao dịch.

```bash
lunacrypto thesis review <thesis_id> mixed \
  --lessons "Funding overheated before confirmation" \
  --mfe 0.08 \
  --mae -0.03
```

Kết quả dự kiến:

```text
Outcome review saved: <review_id>
```

Side effect: ghi outcome review. Dữ liệu này feed vào `journal retrospective` và `research evaluate analytics`.

### 20.6 Signal provenance

Dùng khi muốn biết một conclusion dựa trên signal nào, signal có tươi không, và source timestamp là gì.

```bash
lunacrypto signals latest BTC/USDT
lunacrypto signals snapshot <run_id>
lunacrypto signals latest BTC/USDT --json
```

Kết quả dự kiến:

```text
Signal Snapshot
Run: <run_id>
Snapshot: <snapshot_id>
Symbol: BTC/USDT
Quant bias is aggregate evidence, not the final user decision.
```

Side effect: read-only. Khi chua co research run, output bao chua co signal snapshot.

```bash
lunacrypto signals explain <signal_id>
```

Kết quả dự kiến:

```text
Signal Explain
ID: <signal_id>
Symbol: BTC/USDT
Type: funding_oi
Lane: perp
Bias: bearish
Confidence: 0.68

Provenance:
- Source: ccxt
- Source Timestamp: 2026-05-12T08:29:00Z
- Observed At: 2026-05-12T08:30:12Z
- Freshness: fresh
- Historical reliability: 54% (n=39)

Evidence:
- funding_rate: 0.00042
- open_interest_change: 0.12
```

Side effect: read-only. Dùng để audit freshness và source trước khi tin thesis.

### 20.7 Watchlist và alerts

Dùng khi muốn theo dõi symbol hoặc thesis theo kiểu explicit one-shot check.

```bash
lunacrypto watchlist add-symbol SOL/USDT
lunacrypto watchlist list
```

Kết quả dự kiến:

```text
Watchlist
Added SOL/USDT to watchlist default.
Item id: <item_id>

Watchlist: default
Item ID      Type      Symbol     Thesis   Enabled
<item_id>    symbol    SOL/USDT   -        yes
```

Side effect: ghi watchlist item. Symbol-only watch không có thesis rule.

```bash
lunacrypto watchlist add-thesis <thesis_id>
lunacrypto watchlist brief --evaluate-snapshots
```

Kết quả dự kiến:

```text
Thesis Watch
Watching thesis <thesis_id> for BTC/USDT.
Item id: <item_id>

Watchlist Brief
Watchlist: default
Items: 2 | Theses: 1 | Scenarios: 3 | Recent alerts: 0
Snapshot evaluation: enabled

Active Theses
Thesis        Symbol     Direction   Confidence   Last Snapshot      Invalidation
<thesis_id>   BTC/USDT   long        62%          110100 (ccxt)      104500

Saved Scenarios
Scenario      Symbol     Band   Activated   Snapshot Status
<scenario_id> BTC/USDT   base   no          active: price holds above trigger
```

Side effect: `add-thesis` ghi watchlist item. `brief` read-only và không tạo alert.

```bash
lunacrypto watchlist check --price BTC/USDT=110100
lunacrypto watchlist alerts --unread
```

Kết quả dự kiến:

```text
Watchlist Check
Checked items: 2
New alerts: 1
Skipped: 0

target_zone_reached BTC/USDT reached target zone 110000

Research Alerts
Created                 Type                 Symbol     Thesis        Message
2026-05-12T09:00:00Z    target_zone_reached  BTC/USDT   <thesis_id>   BTC/USDT reached target zone 110000
```

Side effect: `check` có thể tạo alerts. Nó không chạy background; nó chỉ kiểm tra watchlist conditions.

```bash
lunacrypto watchlist remove <item_id>
```

Kết quả dự kiến:

```text
Disabled watchlist item: <item_id>
```

Side effect: disable item, không xóa hard-delete. Dùng `watchlist list --all` để thấy item đã disable.

### 20.8 Market brief

Dùng để tạo daily brief từ journal/watchlist đã persist.

```bash
lunacrypto brief daily --watchlist default --date 2026-05-12
```

Kết quả dự kiến:

```text
Daily Market Brief
Brief ID: <brief_id>
Date: 2026-05-12
Watchlist: default
Previous: <previous_brief_id>

BTC / ETH / SOL And Watched Assets
Symbol     Price      Regime      Trend      Volatility   Change
BTC/USDT   110100     risk-on     up         high         higher vs previous brief

Active Thesis Updates
Thesis        Symbol     Direction   Status             Update
<thesis_id>   BTC/USDT   long        monitoring         Base scenario still active

Top Risks
- Funding overheated before confirmation
```

Side effect: mặc định ghi brief vào journal. Dùng `--no-save` nếu chỉ muốn preview.

```bash
lunacrypto brief list --watchlist default
lunacrypto brief show <brief_id>
```

Kết quả dự kiến:

```text
Market Briefs
Brief ID     Date         Watchlist   Created                 Previous
<brief_id>   2026-05-12   default     2026-05-12T09:10:00Z    <previous_brief_id>
```

Side effect: read-only.

### 20.9 Diff thesis và run

Dùng để so sánh hai lần research trước/sau sự kiện, hoặc so sánh thesis khi đổi model/provider.

```bash
lunacrypto diff thesis <thesis_id_1> <thesis_id_2>
lunacrypto diff thesis <thesis_id_1> <thesis_id_2> --json
```

Kết quả dự kiến:

```text
Thesis Diff
Comparing theses for BTC/USDT

Direction          LONG                 LONG
Confidence         62%                  48%
Invalidation level 104500               106200

Supporting signals
  Common (5): sig_a, sig_b, sig_c
  Only <thesis_id_2> (2): sig_new_1, sig_new_2

Evidence
  conflict_level (A): medium
  conflict_level (B): high
```

Kết quả JSON dự kiến:

```json
{
  "kind": "thesis_diff",
  "direction_flip": false,
  "changed_fields": ["confidence", "invalidation_level", "supporting_signal_ids"],
  "change_severity": "major"
}
```

Side effect: read-only.

```bash
lunacrypto diff run <run_id_1> <run_id_2>
```

Kết quả dự kiến:

```text
Run Diff
Comparing research runs

Symbol          BTC/USDT             BTC/USDT
Status          completed            completed
Signal snapshot <snapshot_id_1>      <snapshot_id_2>

Signal IDs
  Common (8): sig_a, sig_b
  Only <run_id_2> (4): sig_new_1, sig_new_2

Thesis Diff
Direction       LONG                 SHORT
```

Side effect: read-only. Nếu direction flip, review kỹ signals và timestamps.

### 20.10 Historical replay và evaluation

Dùng để replay research theo ngày quá khứ và review chất lượng thesis. Đây không phải PnL backtest.

```bash
lunacrypto replay capabilities
lunacrypto replay capabilities --vendor ccxt --json
```

Kết quả dự kiến:

```text
Provider: ccxt (default: hybrid)
Method              Semantics   Lookback   Granularity   Notes
get_ohlcv           as_of       365d       1d/1h         Historical candles
get_ticker          latest      live       latest        Not point-in-time

Known gaps:
  - Some exchange metadata is latest-only
```

Side effect: read-only. Dùng trước khi tin replay historical.

```bash
lunacrypto replay single BTC/USDT 2025-01-15 --lookback 60 --strict
```

Kết quả dự kiến:

```text
Historical Replay
Replaying BTC/USDT as of 2025-01-15
Lookback: 60d | Analysts: market, social, news, onchain STRICT MODE

Replay Result
Ticker      BTC/USDT
Date        2025-01-15
Signal      HOLD
Data calls  18

Thesis (excerpt)
The market structure as of 2025-01-15 suggests...
```

Side effect: chạy replay pipeline. `--strict` fail fast nếu endpoint chỉ có latest semantics.

```bash
lunacrypto replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7
```

Kết quả dự kiến:

```text
Historical Batch Replay
Range: 2025-01-01 -> 2025-03-31 (step 7d)
Total dates: 13 | Lookback: 30d

Batch Results - BTC/USDT
Date          Signal     Status
2025-01-01    HOLD       success
2025-01-08    BUY        success

Completed: 12/13 successful
```

Side effect: chạy nhiều replay, có thể tốn thời gian/token tùy config.

```bash
lunacrypto research evaluate thesis <thesis_id> --window 30 --record-review
```

Kết quả dự kiến:

```text
Thesis Evaluation - <thesis_id>
Field        Value
Result       mixed
Symbol       BTC/USDT
Window       30 day(s)
MFE          8.20%
MAE          -3.10%
Invalidated  False
```

Side effect: `--record-review` ghi outcome review. Không có flag này thì chỉ tính và hiển thị.

```bash
lunacrypto research evaluate analytics --symbol BTC/USDT
lunacrypto research evaluate factors --symbol BTC/USDT
lunacrypto research evaluate agents --symbol BTC/USDT
lunacrypto research evaluate confidence
lunacrypto research evaluate contradictions
lunacrypto research evaluate health --json
```

Kết quả dự kiến:

```text
Evaluation Analytics
Sample size: 24 theses
Hit rate: 46%
Invalidation rate: 21%

Factor Reliability
Best factor: trend_strength
Worst factor: funding_squeeze

Agent Calibration
Most accurate: market_analyst
Most biased: social_media_analyst

Performance Health Check
Status: HEALTHY
Recent (14d): 6 theses - hit rate: 50%
Baseline (60d): 24 theses - hit rate: 46%
```

Side effect: analytics commands read-only. `matured` có thể tạo saved evaluations cho theses đủ tuổi:

```bash
lunacrypto research evaluate matured --window 14 --max 10
```

Kết quả dự kiến:

```text
Evaluated 4 matured thesis(es).
```

### 20.11 Engine contract

Dùng khi API service, queue worker hoặc external orchestrator muốn gọi Python engine bằng JSON file.

Ví dụ `request.json`:

```json
{
  "run_id": "manual-btc-2026-05-12",
  "workspace_id": "local-alpha",
  "symbol": "BTC/USDT",
  "asset_class": "crypto",
  "analysis_date": "2026-05-12",
  "analysts": ["market", "social", "news", "onchain"],
  "config_profile": "default",
  "dry_run": true
}
```

Chạy:

```bash
lunacrypto engine run --request request.json
```

Kết quả dự kiến khi dry-run:

```json
{
  "run_id": "manual-btc-2026-05-12",
  "workspace_id": "local-alpha",
  "status": "completed",
  "thesis_id": null,
  "summary": "Dry run validated request and persistence contract.",
  "events_written": 2,
  "error_type": null,
  "error": null
}
```

Kết quả dự kiến khi lỗi:

```json
{
  "run_id": "manual-btc-2026-05-12",
  "workspace_id": "local-alpha",
  "status": "failed",
  "error_type": "llm_credential_error",
  "error": "Missing API key"
}
```

Side effect: ghi run lifecycle events vào journal. Exit code khác 0 nếu `status` không phải `completed`.

### 20.12 Kịch bản sử dụng ghép command

Onboard máy mới:

```bash
lunacrypto config setup
lunacrypto config validate --warn
lunacrypto config health --no-live --no-llm
lunacrypto research run BTC/USDT --yes --plain --dry-run
```

Kết quả kỳ vọng: biết journal nằm ở đâu, provider nào đang enabled, profile có hợp lệ không, và research input có thể chạy trước khi tốn token.

Research một symbol rồi đưa vào watchlist:

```bash
lunacrypto research run BTC/USDT --yes --plain --date 2026-05-12
lunacrypto journal workspace <run_id>
lunacrypto thesis show <thesis_id>
lunacrypto thesis decide <thesis_id> watched --notes "Monitor base scenario"
lunacrypto watchlist add-thesis <thesis_id>
lunacrypto watchlist brief --evaluate-snapshots
```

Kết quả kỳ vọng: có workspace để review, thesis được ghi decision, watchlist brief hiển thị thesis/scenarios và next commands.

Check khi giá chạm vùng quan trọng:

```bash
lunacrypto watchlist check --price BTC/USDT=110100
lunacrypto watchlist alerts --unread
lunacrypto journal timeline <run_id>
```

Kết quả kỳ vọng: nếu điều kiện scenario/invalidation/target match, CLI tạo alert và timeline cho thấy lifecycle liên quan.

So sánh research trước và sau tin tức:

```bash
lunacrypto research run BTC/USDT --yes --plain --date 2026-05-11
lunacrypto research run BTC/USDT --yes --plain --date 2026-05-12
lunacrypto diff run <run_id_1> <run_id_2>
lunacrypto diff thesis <thesis_id_1> <thesis_id_2>
```

Kết quả kỳ vọng: thấy direction có flip không, confidence đổi bao nhiêu, signal set nào mới xuất hiện, invalidation/targets có thay đổi không.

Retrospective cuối tuần:

```bash
lunacrypto research evaluate matured --window 14 --max 20
lunacrypto research evaluate analytics
lunacrypto research evaluate factors
lunacrypto research evaluate agents
lunacrypto journal retrospective
```

Kết quả kỳ vọng: biết setup nào underperform, factor nào đáng tin hơn, agent nào bias, và lesson nào nên feed vào research process tuần sau.

Ops/provider debug:

```bash
lunacrypto config effective
lunacrypto config health --json
lunacrypto replay capabilities
lunacrypto research run ETH/USDT --yes --plain --dry-run
```

Kết quả kỳ vọng: phân biệt lỗi config, lỗi credential, provider disabled, provider latest-only, hoặc data access timeout.

Worker/API integration smoke test:

```bash
lunacrypto engine run --request request.json
lunacrypto journal show manual-btc-2026-05-12
lunacrypto journal timeline manual-btc-2026-05-12
```

Kết quả kỳ vọng: engine contract trả JSON, journal có `run.started` và `run.completed` hoặc `run.failed`, backend có thể map status sang job lifecycle.

## 21. Quick Start

Một flow ngắn để test sản phẩm:

```bash
lunacrypto config setup
lunacrypto config validate --warn
lunacrypto research run BTC/USDT --yes --plain --date 2026-05-08
lunacrypto journal list
lunacrypto journal workspace <run_id>
lunacrypto thesis list
lunacrypto thesis show <thesis_id>
lunacrypto watchlist add-thesis <thesis_id>
lunacrypto watchlist brief --evaluate-snapshots
lunacrypto brief daily
lunacrypto watchlist check --price BTC/USDT=110100
lunacrypto watchlist alerts
lunacrypto thesis review <thesis_id> mixed --lessons "Manual review note"
lunacrypto journal retrospective
lunacrypto research evaluate thesis <thesis_id> --window 14
```
