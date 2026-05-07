# TradingAgents Terminal UX Guide

Hướng dẫn này mô tả cách dùng TradingAgents như một **AI Crypto Research Workstation** trên terminal. Mục tiêu là research, quản lý thesis, theo dõi watchlist, ghi journal và review outcome. Tool không tự động đặt lệnh giao dịch.

## 1. Lệnh Chính

Entry point:

```bash
tradingagents
```

Các nhóm lệnh quan trọng:

```bash
tradingagents analyze
tradingagents research ...
tradingagents dashboard
tradingagents journal ...
tradingagents thesis ...
tradingagents signals ...
tradingagents watchlist ...
tradingagents evaluate ...
tradingagents config ...
tradingagents risk ...
```

## 2. Workflow Khuyến Nghị Hằng Ngày

```text
Setup/config
-> Run research
-> Inspect journal workspace
-> Decide or watch thesis
-> Check watchlist/alerts
-> Review outcome later
-> Retrospective
```

## 3. Setup Và Kiểm Tra Journal

Xem config profiles:

```bash
tradingagents config list
tradingagents config show <profile_name>
```

Xem file SQLite journal đang lưu ở đâu:

```bash
tradingagents journal path
```

Mở terminal home screen:

```bash
tradingagents dashboard
```

Dashboard hiện dùng dữ liệu local đã persist: recent research runs, watched theses, recent alerts. Nó không gọi provider live.

## 4. Chạy Research

### Interactive Mode

Chạy wizard mặc định:

```bash
tradingagents
```

Hoặc:

```bash
tradingagents analyze
```

Wizard sẽ hỏi symbol, date, analysts, model/provider, research depth và thesis planning.

### Non-Interactive Mode

Dùng khi muốn chạy bằng script/CI/terminal nhanh:

```bash
tradingagents analyze \
  --non-interactive \
  --plain \
  --ticker BTC/USDT \
  --date 2026-05-08 \
  --analysts market,social,news,onchain \
  --research-depth 1
```

Có thể chỉ định model/provider:

```bash
tradingagents analyze \
  --non-interactive \
  --plain \
  --ticker ETH/USDT \
  --llm-provider openai \
  --quick-model gpt-5.4-mini \
  --deep-model gpt-5.4
```

Lưu report không cần prompt:

```bash
tradingagents analyze \
  --non-interactive \
  --plain \
  --ticker BTC/USDT \
  --save-report \
  --save-path reports/BTC_manual_run
```

## 5. Research Namespace

`research` là namespace mới để gom các workflow research-first. Các lệnh cũ vẫn dùng được.

Chạy research:

```bash
tradingagents research run BTC/USDT --date 2026-05-08
```

Mở workspace:

```bash
tradingagents research workspace <run_id>
```

Mở daily brief/watchlist brief:

```bash
tradingagents research brief
```

Các alias group:

```bash
tradingagents research journal ...
tradingagents research thesis ...
tradingagents research signals ...
tradingagents research watchlist ...
```

## 6. Journal Workflow

Sau khi chạy research, xem danh sách runs:

```bash
tradingagents journal list
```

Xem một run:

```bash
tradingagents journal show <run_id>
```

Màn hình quan trọng nhất sau research:

```bash
tradingagents journal workspace <run_id>
```

Workspace hiển thị:

- run id, symbol, status;
- market/signal snapshot IDs;
- debate id;
- thesis id;
- consensus/conflict nếu có;
- thesis, scenarios;
- timeline;
- next useful commands.

Xem timeline:

```bash
tradingagents journal timeline <run_id>
```

Xem snapshots:

```bash
tradingagents journal market-snapshot <snapshot_id>
tradingagents journal signal-snapshot <snapshot_id>
```

Xem debate:

```bash
tradingagents journal debate <debate_id>
```

## 7. Thesis Workflow

List thesis:

```bash
tradingagents thesis list
```

Xem thesis chi tiết:

```bash
tradingagents thesis show <thesis_id>
```

Xem scenarios gắn với thesis:

```bash
tradingagents thesis scenarios <thesis_id>
```

Ghi decision của user:

```bash
tradingagents thesis decide <thesis_id> --action watched --notes "Waiting for confirmation"
```

Các action thường dùng:

```text
accepted
rejected
watched
ignored
needs_more_research
```

Xem thesis timeline:

```bash
tradingagents thesis timeline <thesis_id>
```

Review outcome sau khi thị trường đã diễn biến:

```bash
tradingagents thesis review <thesis_id> \
  --result mixed \
  --lessons "Funding overheated before confirmation" \
  --mfe 0.08 \
  --mae -0.03
```

## 8. Signals Workflow

List signals:

```bash
tradingagents signals list
tradingagents signals list BTC/USDT
```

Xem signal provenance:

```bash
tradingagents signals show <signal_id>
```

Signal view giúp kiểm tra:

- source;
- observed time;
- source timestamp;
- freshness;
- confidence;
- evidence.

## 9. Watchlist Và Alerts

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
```

Daily home screen:

```bash
tradingagents watchlist brief
```

Brief là read-only. Nó không tạo alert mới.

Nếu muốn brief dùng last persisted market snapshot để đánh giá scenario status:

```bash
tradingagents watchlist brief --evaluate-snapshots
```

Chạy one-shot monitoring check:

```bash
tradingagents watchlist check
```

Override giá hiện tại thủ công:

```bash
tradingagents watchlist check --price BTC/USDT=110100
```

`check` có thể tạo alerts như:

- `thesis_invalidated`;
- `target_zone_reached`;
- `scenario_activated`.

Xem alerts:

```bash
tradingagents watchlist alerts
tradingagents watchlist alerts --unread
tradingagents watchlist alerts --symbol BTC/USDT
tradingagents watchlist alerts --thesis-id <thesis_id>
```

Remove/disable watchlist item:

```bash
tradingagents watchlist remove <item_id>
```

## 10. Retrospective Và Outcome Analytics

Xem outcomes:

```bash
tradingagents journal outcomes
tradingagents journal outcomes --symbol BTC/USDT
```

Xem retrospective intelligence:

```bash
tradingagents journal retrospective
tradingagents journal retrospective --symbol BTC/USDT
```

Mục tiêu là học từ lịch sử thesis:

- hit rate;
- invalidation rate;
- average MFE;
- average MAE;
- lessons.

## 11. Historical Thesis Evaluation

Lệnh historical evaluation:

```bash
tradingagents evaluate run ...
```

Đây là **historical thesis evaluation**, không phải broker-accurate backtest. Không nên đọc nó như PnL thật, Sharpe thật, hoặc performance execution thật.

## 12. Risk Utilities

Các lệnh risk hiện là utilities riêng:

```bash
tradingagents risk var
tradingagents risk stress
tradingagents risk decompose
```

Chúng không phải live execution workflow.

## 13. Các Màn Hình Nên Dùng Nhiều Nhất

Terminal home:

```bash
tradingagents dashboard
```

Sau research:

```bash
tradingagents journal workspace <run_id>
```

Daily monitoring:

```bash
tradingagents watchlist brief
```

Thesis detail:

```bash
tradingagents thesis show <thesis_id>
```

Outcome learning:

```bash
tradingagents journal retrospective
```

## 14. Nguyên Tắc An Toàn

- AI không tự đặt lệnh.
- Alerts không phải lệnh buy/sell.
- Copy trong terminal dùng ngôn ngữ `review`, `watch`, `reassess`, `stand aside`.
- `watchlist brief` là read-only.
- `watchlist check` là explicit command có thể tạo alert.
- Historical evaluation không phải broker backtest.

## 15. Quick Start

Một flow ngắn để test sản phẩm:

```bash
tradingagents analyze --non-interactive --plain --ticker BTC/USDT --date 2026-05-08
tradingagents journal list
tradingagents journal workspace <run_id>
tradingagents thesis list
tradingagents watchlist add-thesis <thesis_id>
tradingagents watchlist brief
tradingagents watchlist check --price BTC/USDT=110100
tradingagents watchlist alerts
tradingagents thesis review <thesis_id> --result mixed --lessons "Manual review note"
tradingagents journal retrospective
```
