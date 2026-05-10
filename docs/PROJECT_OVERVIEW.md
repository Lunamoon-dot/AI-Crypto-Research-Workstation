# AI Crypto Research Workstation — Tổng Quan Dự Án

> **Living document** — cập nhật khi kiến trúc thay đổi.
> Lần sửa cuối: 2026-05-10 | Phiên bản dự án: 0.3.0

---

## 1. SẢN PHẨM NÀY LÀ GÌ

**Research Workstation** cho thị trường crypto — không phải bot giao dịch tự động.

```
Dữ liệu thị trường → Tín hiệu định lượng → Nghiên cứu đa tác nhân AI
→ Luận điểm giao dịch (AI tạo) → Người dùng quyết định
→ Nhật ký quyết định → Đánh giá kết quả
```

Định vị: **Obsidian/Cursor cho crypto research**, không phải AI hedge fund.

### Không phải

- Autonomous trading bot
- Live order router
- Broker/dealer system
- Regulated investment advisor

### Là

- Local-first research workstation
- Multi-agent AI research pipeline
- Structured decision journal
- Signal provenance tracker
- Thesis evaluation & outcome review

---

## 2. ĐỘ PHỨC TẠP

**Trung cấp-Cao** — phù hợp developer có:

| Kỹ năng | Mức cần |
|---------|---------|
| Python | Thành thạo |
| LangChain / LangGraph | Cơ bản |
| LLM / Generative AI | Trung cấp |
| SQL & kiến trúc phần mềm | Cơ bản |
| Crypto/blockchain | Hữu ích, không bắt buộc |

---

## 3. KIẾN TRÚC TỔNG THỂ

```
┌──────────────────────────────────────────────────────────────┐
│                    CLI Layer (cli/)                           │
│     Interactive TUI, journal, signals, backtest, config       │
├──────────────────────────────────────────────────────────────┤
│               Orchestration (tradingagents/graph/)            │
│     LangGraph StateGraph — pipeline tuần tự + debate loops    │
├──────────────────────────────────────────────────────────────┤
│  Agents           │  Signals          │  Domain Models        │
│  (agents/)        │  (signals/)       │  (domain/)            │
│                   │                   │                       │
│  Market Analyst   │  Funding/OI       │  ResearchRun          │
│  Social Analyst   │  RSI Divergence   │  Signal               │
│  News Analyst     │  MACD             │  TradeThesis          │
│  Onchain Analyst  │  Volume Profile   │  ResearchDebate       │
│  Bull/Bear        │  Liquidations     │  AgentOpinion         │
│  Research Mgr     │  Regime           │  Scenario             │
│  Trader           │  Onchain          │  UserDecision         │
│  Risk Analysts    │  Composite        │  OutcomeReview        │
│  Portfolio Mgr    │  Scoring          │  ...                  │
├──────────────────────────────────────────────────────────────┤
│  Data Layer (dataflows/)     │  Storage Layer (storage/)      │
│                              │                               │
│  CCXT (OHLCV/funding/OI)     │  SQLite (14 tables)           │
│  CoinGecko (NVT/supply)      │  Journal Repository           │
│  CryptoPanic (news)          │  Serialization                │
│  Fallback chain              │                               │
├──────────────────────────────────────────────────────────────┤
│               LLM Clients (llm_clients/)                     │
│  OpenAI | DeepSeek | Google | Anthropic | xAI | Azure | ...  │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. CÂY THƯ MỤC

```
AI-Crypto-Research-Workstation/
│
├── README.md
├── CLAUDE.md                       # Hướng dẫn cho Claude Code
├── CHANGELOG.md
├── ROADMAP.md
├── pyproject.toml
├── main.py
│
├── config/                         # File cấu hình
│   ├── default.toml                # TOML config (Layer 2)
│   └── local.example.toml
│
├── cli/                            # Giao diện dòng lệnh
│   ├── main.py                     # Entry point (Typer)
│   ├── orchestrator.py             # Điều phối phân tích
│   ├── tui.py                      # Rich Terminal UI
│   ├── selections.py               # Wizard → config mapping
│   ├── stream_events.py            # Live streaming display
│   ├── journal_cmd.py              # journal/thesis commands
│   ├── signals_cmd.py              # signal provenance commands
│   ├── backtest_cmd.py             # thesis evaluation
│   ├── watch_cmd.py                # watchlist management
│   ├── brief_cmd.py                # market brief
│   ├── risk_cmd.py                 # risk analytics
│   ├── config_cmd.py               # config management
│   ├── dashboard.py                # dashboard display
│   ├── preflight.py                # pre-flight checks
│   ├── stats_handler.py            # LLM/tool usage tracking
│   └── ...
│
├── tradingagents/                  # Thư viện lõi
│   │
│   ├── default_config.py           # DEFAULT_CONFIG — nguồn sự thật
│   ├── config_manager.py           # Profile management
│   ├── config/                     # Configuration subsystem (v0.3+)
│   │   ├── loader.py               # ConfigLoader: 6-layer priority
│   │   ├── schema.py               # Validation & normalization
│   │   ├── secrets.py              # SecretsManager: API key resolution
│   │   └── providers.py            # PROVIDER_REGISTRY metadata
│   │
│   ├── graph/                      # TRÁI TIM HỆ THỐNG
│   │   ├── research_agents_graph.py # ResearchAgentsGraph (orchestrator)
│   │   ├── setup.py                # GraphSetup: build LangGraph
│   │   ├── conditional_logic.py    # Debate/risk routing
│   │   ├── quant_signals.py        # Pre-compute SignalEngine
│   │   ├── journal_bridge.py       # Graph ↔ SQLite bridge
│   │   ├── planning.py             # Thesis & trade plan builders
│   │   ├── propagation.py          # Initial state factory
│   │   ├── reflection.py           # Post-trade reflection (LLM)
│   │   ├── signal_processing.py    # Rating extraction (deterministic)
│   │   ├── tooling.py              # Tool node factory
│   │   ├── opinions.py             # AgentOpinion & Debate builders
│   │   ├── scenarios.py            # Scenario generation
│   │   ├── checkpointer.py         # SQLite checkpoint/resume
│   │   └── analyst_runtime.py      # Internal tool-loop wrapper
│   │
│   ├── agents/                     # Agent implementations
│   │   ├── schemas.py              # Pydantic schemas (structured output)
│   │   ├── analysts/               # 4 analyst agents (quick llm)
│   │   ├── researchers/            # 2 debate agents
│   │   ├── managers/               # 2 decision agents (deep llm)
│   │   ├── risk_mgmt/              # 3 risk debate agents
│   │   ├── trader/                 # 1 trader agent
│   │   ├── aggregation/            # Confidence/consensus/contradiction
│   │   └── utils/                  # Shared: state, memory, tools, structured
│   │
│   ├── signals/                    # Deterministic quant layer
│   │   ├── engine.py               # SignalEngine orchestrator
│   │   ├── base.py                 # SignalResult, FactorSignal
│   │   ├── composite.py            # CompositeScorer (weighted)
│   │   ├── funding_oi_signals.py
│   │   ├── divergence_signals.py
│   │   ├── volume_signals.py
│   │   ├── regime_signals.py
│   │   ├── onchain_signals.py
│   │   ├── provenance.py           # Signal → domain conversion
│   │   └── snapshots.py            # Market/Signal snapshot builders
│   │
│   ├── dataflows/                  # Data vendor routing
│   │   ├── interface.py            # route_to_vendor() entry point
│   │   ├── ccxt_provider.py
│   │   ├── onchain_provider.py
│   │   ├── crypto_news_provider.py
│   │   ├── stockstats_utils.py
│   │   ├── config.py               # ContextVar config isolation
│   │   └── utils.py                # safe_ticker_component, etc.
│   │
│   ├── domain/                     # Domain models (28+)
│   ├── storage/                    # SQLite persistence
│   ├── services/                   # Application services
│   ├── llm_clients/                # LLM provider abstraction
│   ├── templates/                  # Scenario planning templates (7 types)
│   ├── risk/                       # Quantitative risk (VaR, CVaR, stress)
│   ├── portfolio/                  # Portfolio sizing & optimization
│   ├── exchange/                   # Exchange abstraction (paper only)
│   ├── reporting/                  # Markdown report generation
│   ├── observability/              # Structured logging
│   └── ...
│
├── docs/                           # Tài liệu dự án
│   └── PROJECT_OVERVIEW.md         # File này
│
├── tests/                          # Test suite (~30 files)
├── scripts/                        # Utility scripts
└── reports/                        # Generated reports (gitignored)
```

---

## 5. PIPELINE — 1 LẦN CHẠY ĐẦY ĐỦ

```
propagate("BTC/USDT", "2026-05-08")
│
├─ PRE-FLIGHT
│   ├─ Resolve pending memory log entries
│   ├─ Validate symbol on exchange
│   └─ Create ResearchRun (status=RUNNING)
│
├─ BƯỚC 1: QUANT SIGNAL (trước graph)
│   └─ SignalEngine.generate()
│       ├─ Fetch OHLCV (90d) + funding + OI + liq + L/S + NVT + reserves
│       ├─ 7 generators: regime, RSI, MACD, volume, funding/OI, liq, onchain
│       └─ CompositeScorer: weighted avg + agreement bonus + vol discount
│           → SignalResult { score, confidence, factors }
│
├─ BƯỚC 2: ANALYST CHAIN (tuần tự, mỗi agent có tool-loop riêng)
│   ├─ Market Analyst    → market_report
│   ├─ Social Analyst    → sentiment_report
│   ├─ News Analyst      → news_report
│   └─ Onchain Analyst   → fundamentals_report
│
├─ BƯỚC 3: BULL/BEAR DEBATE (conditional: max N rounds)
│   ├─ Bull Researcher ⇄ Bear Researcher
│   └─ Research Manager  → investment_plan (structured: ResearchPlan)
│
├─ BƯỚC 4: TRADER
│   └─ Trader → trader_investment_plan (structured: TraderProposal)
│
├─ BƯỚC 5: RISK DEBATE (conditional: max M rounds)
│   ├─ Aggressive ⇄ Conservative ⇄ Neutral
│   └─ Portfolio Manager → final_trade_decision (structured: PortfolioDecision)
│
├─ BƯỚC 6: POST-PROCESSING
│   ├─ Process signal (deterministic parse)
│   ├─ Build TradeThesis artifact
│   ├─ Build Trade Plan (if planning.enabled)
│   ├─ Save to memory log (for future reflection)
│   ├─ Generate markdown report
│   ├─ Save to SQLite journal
│   └─ Clear checkpoint
│
└─ Return: (final_state, rating)
```

### State transitions

```
START
  ├─ company_of_interest, trade_date [init]
  ├─ quant_signal [pre-computed]
  └─ past_context [from memory]

After Analysts:
  ├─ market_report ✓
  ├─ sentiment_report ✓
  ├─ news_report ✓
  └─ fundamentals_report ✓

After Bull/Bear Debate:
  └─ investment_debate_state ✓

After Research Manager:
  └─ investment_plan ✓

After Trader:
  └─ trader_investment_plan ✓

After Risk Debate:
  └─ risk_debate_state ✓

After Portfolio Manager:
  └─ final_trade_decision ✓ → END
```

---

## 6. CÁC KHÁI NIỆM CỐT LÕI

### 6.1 Structured Output + Fallback

Research Manager, Trader, Portfolio Manager dùng Pydantic schemas để LLM trả JSON.
Nếu provider không hỗ trợ → fallback về free-text. Sau đó render → markdown.

```python
# Pattern chuẩn:
structured_llm = bind_structured(llm, PortfolioDecision, "PM")
result = invoke_structured_or_freetext(structured_llm, llm, prompt, render_fn, name)
```

### 6.2 Signal Engine (Deterministic)

| Factor | Weight | Mô tả |
|--------|--------|-------|
| funding_oi | 20% | Funding rate + Open Interest delta |
| rsi_divergence | 12% | RSI phân kỳ |
| macd | 8% | MACD crossover |
| volume_profile | 12% | Volume profile |
| liquidations | 12% | Liquidation imbalance |
| regime | 16% | Market regime detection |
| onchain | 20% | NVT, L/S ratio, reserves |

Confidence = directional_strength × 0.6 + avg_factor_confidence × 0.4
+ agreement_bonus × volatility_discount

### 6.3 Data Vendor Routing

```python
route_to_vendor(method, *args)
  → resolve config (category-level → tool-level override)
  → build fallback chain (primary → remaining available)
  → try each with timeout + retry + backoff + rate limit
  → return first success
```

### 6.4 Memory System

- File: `~/.tradingagents/memory/trading_memory.md`
- Pending entries → resolved khi chạy lại cùng ticker
- Past context inject vào Portfolio Manager prompt
- Structured reflection: directional_correct, alpha_sign_correct, key_lesson

### 6.5 Journal (SQLite — 14 tables)

`research_runs` → `market_snapshots` → `signals` → `signal_snapshots`
→ `debates` → `agent_opinions` → `trade_theses` → `scenarios`
→ `user_decisions` → `outcome_reviews`
+ `watchlists`, `alerts`, `market_briefs`, `thesis_evaluations`, `run_events`

### 6.6 LLM Fallback + Circuit Breaker

```
Primary provider
  ├─ Fail 3 lần liên tiếp → Circuit OPEN (5 min)
  └─ Auto-switch → Fallback 1 → Fallback 2
      └─ Skip if circuit also OPEN
Retry policy: network/timeout/5xx → retry; 401/403 → raise immediately
```

### 6.7 Safety Boundary

Cố ý **vô hiệu hóa**:
- Autonomous live trading
- Live CCXT order routing
- Auto bracket / auto-close
- Background execution loops

`planning.enabled = true` → assisted trade plan, yêu cầu user approval thủ công.

---

## 7. CODE PATTERNS QUAN TRỌNG

| Pattern | Dùng ở đâu |
|---------|-----------|
| **Factory** | Agent creation: `create_*_analyst(llm, config) → callable` |
| **Strategy** | LLM clients: mỗi provider có client riêng |
| **Circuit Breaker** | `ResearchAgentsGraph._run_with_fallback()` |
| **Fallback Chain** | `route_to_vendor()` — vendor routing |
| **Observer / Streaming** | `graph.stream()` + `node_callback` cho CLI live display |
| **Context Manager** | `config_context()`, `observability_context()` |
| **Lazy Import** | `llm_clients/factory.py` — không import SDK khi chưa cần |
| **Best-effort Persistence** | Journal bridge: fail không crash pipeline |
| **Template Method** | `TemplateRegistry.detect()` — 7 setup templates |

---

## 8. CÁCH CHẠY

```bash
# Cài đặt
pip install -e .

# CLI tương tác
tradingagents

# Code
from tradingagents.graph import ResearchAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG

config = DEFAULT_CONFIG.copy()
config["llm_provider"] = "deepseek"
config["deep_think_llm"] = "deepseek-v4-pro"
config["quick_think_llm"] = "deepseek-v4-flash"

graph = ResearchAgentsGraph(debug=True, config=config)
final_state, rating = graph.propagate("BTC/USDT", "2026-05-08")

# Journal
tradingagents journal list
tradingagents journal show <run_id>

# Thesis
tradingagents thesis list
tradingagents thesis decide <thesis_id> watched --notes "..."

# Signals
tradingagents signals list BTC/USDT

# Evaluation
tradingagents evaluate
```

---

## 9. CON SỐ NHANH

| Khía cạnh | Giá trị |
|-----------|---------|
| Agent AI | 12 (4 analysts + 2 debaters + 2 managers + 3 risk + 1 trader) |
| Signal generators | 7 (deterministic) |
| Domain models | 28+ |
| SQLite tables | 14 |
| LLM providers | 10 (OpenAI, DeepSeek, Google, Anthropic, xAI, Qwen, GLM, Ollama, OpenRouter, Azure) |
| Data vendors | 2 (CCXT, CoinGecko) + CryptoPanic |
| Setup templates | 7 (breakout, range, squeeze, news, macro, pullback, sweep) |
| Test files | ~30 |
| Python version | 3.11+ |

---

## 10. GHI CHÚ THAY ĐỔI

> **Cập nhật file này khi:**
> - Thêm/xóa agent hoặc signal generator
> - Thay đổi kiến trúc pipeline
> - Đổi tên/thêm/xóa thư mục chính
> - Thêm vendor/provider mới
> - Nâng cấp phiên bản lớn
>
> **Không cần cập nhật khi:**
> - Sửa bug nhỏ
> - Refactor nội bộ một file
> - Thay đổi config default
> - Thêm test
