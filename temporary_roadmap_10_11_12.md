## Implementation checklist - 2026-05-12

### Phase 10: Python Core Reliability

- [x] Config contract standardized through `config/default.toml`, `config/local.example.toml`, `ConfigLoader`, and `TRADINGAGENTS_RUNTIME_ENVIRONMENT`.
- [x] Local/dev/production modes are explicit; production mode fails fast and rejects sample/fake provider chains.
- [x] Crypto-first env vars are documented for LLM keys, CryptoPanic, CoinGecko, CCXT exchange config, and runtime paths.
- [x] Provider runtime reliability uses timeout, retry, backoff, and rate-limit controls through `provider_runtime`.
- [x] Optional provider failures degrade with typed reasons; required failures surface typed provider/config errors.
- [x] Provider, LLM, storage, stale-data, and config failures use the project exception taxonomy.
- [x] Secret redaction is installed for structured logs, config hash, and observability payloads.
- [x] Worker-ready engine command is implemented as `tradingagents engine run --request request.json`.

### Phase 11: Observability & Trust Contract

- [x] Canonical events include `run.started`, `provider.call`, `llm.call`, `data.freshness`, `signal.generated`, `thesis.generated`, `run.completed`, and `run.failed`.
- [x] SQLite persistence now includes `run_events`, `provider_health`, `llm_calls`, and `data_freshness_checks`.
- [x] LLM metrics persist provider, model, stage/agent, token counts, latency, status, and error fields.
- [x] Data freshness persists source, timestamps, age, threshold, and fresh/stale/unknown status.
- [x] Trade thesis explainability fields are explicit: why, supporting evidence, contradicting evidence, stale/missing data, invalidation, monitor-next, and confidence rationale.
- [x] Python worker progress events are persisted so NestJS can forward them through HTTP now and SSE/WebSocket later.

### Phase 12: NestJS Product Backend Boundary

- [x] Monorepo app structure exists: `apps/api`, `apps/web`, and existing Python `tradingagents`.
- [x] NestJS modules exist for auth, users, workspaces, research runs, theses, signals, watchlists, briefs, and jobs.
- [x] Core REST endpoints are implemented for research runs, run events, theses, thesis decisions/reviews, signals, watchlists, watchlist items, and daily briefs.
- [x] Job orchestration boundary accepts validated NestJS requests and enqueues through BullMQ/Redis when configured, with memory and inline-worker fallbacks for local/dev.
- [x] Python worker boundary uses the stable request/result JSON contract.
- [x] NestJS reads product records from a Postgres-oriented journal repository; local Python SQLite mode remains supported.
- [x] SQLite-to-Postgres migration strategy is documented in `docs/postgres-migration-strategy.md`.

Đúng, cách nghĩ đó chuẩn hơn: Python nên là công nghệ lõi/engine, không phải backend sản phẩm chính.

Nên định nghĩa lại kiến trúc:

Frontend
-> NestJS Backend
-> Job Queue / RPC Boundary
-> Python Research Engine
-> Database / Object Storage
Vai trò từng phần:

Python core

LangGraph agents
LLM orchestration
signal engine
thesis generation
provider adapters
research worker
không quản lý user/session/billing/team/API public
NestJS backend

auth/user/workspace
REST/GraphQL API
request validation
job orchestration
permissions
subscriptions/websocket progress
billing sau này
đọc kết quả từ DB và trả cho frontend
Database

Postgres cho hosted/cloud
SQLite chỉ nên là local mode
schema phải đủ rõ để NestJS đọc/ghi các entity sản phẩm
Queue

BullMQ/Redis hoặc Temporal sau này
NestJS enqueue research job
Python worker consume job, chạy engine, persist events/results
Vậy cần sửa tư duy roadmap Phase 12:

Không phải “Python REST API”, mà là:

Phase 12: Product Backend Boundary

NestJS API:
- research runs
- theses
- signals
- watchlists
- briefs
- journal
- users/workspaces
- job status

Python Engine:
- stable CLI/worker contract
- accepts run request JSON
- emits progress events
- writes normalized results
Nói ngắn gọn: Python là engine, NestJS là backend, frontend không bao giờ gọi Python trực tiếp.



5:37 AM
thế cho xin lại xem qua roadmap, nêu rõ những thứ cần implement ở phase 10/11/12, có thể thay đổi road map để phù hợp nếu muốn
5:37 AM


Đúng, nên sửa roadmap theo hướng: Python = research engine lõi, NestJS = backend sản phẩm.

Roadmap nên đổi như sau
Phase 10/11 vẫn chủ yếu harden Python core, vì engine phải đáng tin trước. Phase 12 không nên là Python REST API nữa, mà đổi thành NestJS backend + Python worker boundary.

Phase 10: Python Core Reliability
Mục tiêu: làm Python engine chạy ổn định, có config rõ, lỗi rõ, không leak secrets.

Cần implement:

Config contract cho engine:

Chuẩn hóa config/default.toml, config/local.example.toml.
Tách rõ local, dev, production.
Production mode không được silently fallback sang fake/sample data.
Rà lại env vars cho crypto-first provider: LLM keys, CoinGecko/CryptoPanic/CCXT/exchange config.
Provider reliability:

Mọi data provider phải có timeout, retry, backoff, rate-limit.
Provider fail thì research run degrade có ghi lý do, không crash toàn bộ nếu optional.
Required provider fail thì trả lỗi typed.
Error taxonomy:

Đã có nền DataProviderError, StaleDataError, LLMOutputError, ConfigurationError, StorageError, RateLimitError.
Cần ép toàn bộ provider/LLM/storage dùng các lỗi này nhất quán.
Secret safety:

Không log API key/header/token.
Redaction filter áp dụng toàn bộ logging.
Config/health output phải redact secrets.
Worker-ready engine:

Python core phải có entrypoint không phụ thuộc CLI/TUI:
tradingagents engine run --request request.json
hoặc function/service nhận JSON request và trả structured result.
Phase 11: Observability & Trust Contract
Mục tiêu: NestJS/frontend sau này đọc được progress, trace, evidence, cost, failure reason.

Cần implement:

Chuẩn hóa run events:

run.started
provider.call
llm.call
data.freshness
signal.generated
thesis.generated
run.completed
run.failed
Thêm bảng/records observability riêng:

run_events
provider_health
llm_calls
data_freshness_checks
Persist LLM metrics:

provider
model
stage/agent
input/output tokens
latency
status/error
Persist data freshness:

source
source timestamp
observed timestamp
age
threshold
fresh/stale/unknown
Thesis explainability contract:
Mỗi thesis phải có fields rõ:

why this thesis
supporting evidence
contradicting evidence
stale/missing data
invalidation
monitor next
confidence rationale
Progress stream contract:

Python worker emit progress events.
NestJS có thể forward qua WebSocket/SSE cho frontend.
Phase 12: NestJS Product Backend Boundary
Mục tiêu: chuyển từ “Python API” sang “NestJS backend gọi Python engine”.

Cần implement:

Monorepo/app structure:

apps/api/              # NestJS backend
apps/web/              # frontend sau này
python/tradingagents/  # hoặc giữ tradingagents/ làm Python engine
NestJS modules:

AuthModule
UsersModule
WorkspacesModule
ResearchRunsModule
ThesesModule
SignalsModule
WatchlistsModule
BriefsModule
JobsModule
Core API endpoints:

POST /research-runs
GET  /research-runs/:id
GET  /research-runs/:id/events

GET  /theses
GET  /theses/:id
POST /theses/:id/decision
POST /theses/:id/review

GET  /signals?symbol=BTC
GET  /watchlists
POST /watchlists/:id/items
GET  /briefs/daily
Job orchestration:

NestJS nhận request.
Validate user/workspace/permissions.
Enqueue job qua BullMQ/Redis.
Python worker consume job.
Python ghi events/results vào DB.
NestJS đọc DB trả status/result.
Database direction:

Local mode: SQLite vẫn OK.
Cloud/NestJS mode: Postgres nên là target.
Cần migration strategy từ SQLite domain sang Postgres schema.
Python worker boundary:
Request shape:

{
  "run_id": "...",
  "workspace_id": "...",
  "symbol": "BTC/USDT",
  "asset_class": "crypto",
  "analysis_date": "2026-05-12",
  "analysts": ["market", "news", "social", "onchain"],
  "config_profile": "default"
}
Result shape:

{
  "run_id": "...",
  "status": "completed",
  "thesis_id": "...",
  "summary": "...",
  "events_written": 42
}
Roadmap sửa lại ngắn gọn

Phase 10: harden Python research engine.
Phase 11: define/persist observability + trust contract.
Phase 12: build NestJS product backend and connect it to Python worker.
Điểm quan trọng: đừng để Phase 12 thành Python web API. Python chỉ nên expose engine contract, còn backend thật là NestJS.
