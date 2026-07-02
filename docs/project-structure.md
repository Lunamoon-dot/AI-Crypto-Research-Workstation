# LunaCrypto Project Structure

Last updated: 2026-05-29

Tài liệu này giải thích cấu trúc folder và file trong repo theo kiểu "nhìn cây thư mục, đọc ghi chú bên cạnh". Repo này là monorepo cho LunaCrypto: web workstation React, API NestJS, AI service Python, database Prisma và tài liệu vận hành.

Phạm vi tài liệu:

- Có liệt kê các folder/file nguồn chính đang có trong workspace.
- Không bung chi tiết `node_modules/`, `.git/`, `dist/`, `.venv/`, cache, log runtime vì đó là dependency hoặc output sinh ra.
- Không đọc nội dung `.env`; chỉ ghi vai trò file cấu hình môi trường.

## 1. Folder Map

```text
LunaCrypto/
|-- apps/                              # Các ứng dụng chạy thật trong sản phẩm
|  |-- ai-service/                     # Python AI engine + worker engine contract
|  |-- api/                            # NestJS backend API boundary
|  |-- web/                            # Vite/React workstation UI
|  `-- landing/                        # Placeholder landing app, chưa có implementation
|-- packages/                          # Package dùng chung trong pnpm workspace
|  |-- database/                       # Prisma schema/client cho Postgres product model
|  |-- config/                         # Placeholder shared config package
|  |-- types/                          # Placeholder shared types package
|  `-- ui-shared/                      # Placeholder shared UI package
|-- docs/                              # Tài liệu kiến trúc, roadmap, ADR, feature plans
|  |-- adr/                            # Architecture Decision Records
|  |-- features/                       # Feature registry và implementation plans theo version
|  `-- preview/                        # Hình/PDF preview UI concept
|-- .github/                           # GitHub Actions CI
|-- .understand-anything/              # Knowledge graph/cấu hình của công cụ hiểu codebase
|-- .claude/                           # Local Claude/Codex-related settings
|-- .codex/                            # Local Codex artifacts, screenshots, run output
|-- .deepseek/                         # Local DeepSeek/subagent state
|-- .hypothesis/                       # Cache/data của Hypothesis tests
|-- logs/                              # Runtime logs local
|-- dist/                              # Build output TypeScript
|-- node_modules/                      # Workspace dependencies
`-- .venv/                             # Python virtual environment local
```

## 2. Product Flow

```text
apps/web
  -> gọi API qua apps/web/src/services/*
apps/api
  -> xử lý route theo module domain
  -> đọc/ghi Postgres qua packages/database và apps/api/src/database/*
  -> chạy research job bằng memory queue/BullMQ
  -> gọi Python engine khi cần research run
apps/ai-service
  -> lấy market/news/onchain/sentiment data
  -> chạy deterministic signals + multi-agent research
  -> tạo thesis, journal artifacts, outcome/reliability data
```

## 3. Root Files

```text
LunaCrypto/
|-- README.md                                      # Tổng quan sản phẩm, workspace layout, lệnh dev/build/test
|-- package.json                                   # Root pnpm scripts: dev, build, lint, test, db, ai
|-- pnpm-workspace.yaml                            # Khai báo pnpm workspace packages/apps
|-- pnpm-lock.yaml                                 # Lockfile dependencies của pnpm
|-- turbo.json                                     # Turborepo task pipeline và env pass-through
|-- docker-compose.yml                             # Local stack: Postgres, Redis, API, worker, web, optional AI service
|-- eslint.config.mjs                              # ESLint config cho TypeScript packages
|-- .gitignore                                     # File/folder Git bo qua
|-- .dockerignore                                  # File/folder Docker build context bo qua
|-- .env                                           # Local secrets/env; không nên commit nội dung thật
|-- LICENSE                                        # License của project
|-- CHANGELOG.md                                   # Lịch sử thay đổi/release notes
|-- CLAUDE.md                                      # Hướng dẫn local cho agent/tooling
|-- Workflow.md                                    # Mô tả product workflow và research pipeline
|-- CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md       # Plan về cloud job queue và tenant isolation
|-- TECHNICAL_REVIEW.md                            # Technical review lịch sử
|-- TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md # Review kiến trúc phase 1-11
|-- temporary_roadmap_10_11_12.md                  # Roadmap tạm thời cho các phase tiếp theo
|-- futures_monitor.json                           # Local monitor config/data cho futures
|-- spot_monitor.json                              # Local monitor config/data cho spot
`-- stitch_file_based_design_implementation.zip    # Archive/reference implementation asset
```

## 4. `apps/` File Map

### 4.1 `apps/ai-service/`

`apps/ai-service` là Python engine. Nó giữ package import là `luna_workstation`, không còn expose public command-line UI, và phụ trách research pipeline, signals, journal, outcome review. API/worker gọi engine qua `python -m luna_workstation.engine`.

```text
apps/ai-service/
|-- README.md                         # Tổng quan AI service, installation, engine contract
|-- ROADMAP.md                        # Roadmap riêng của AI service
|-- CHANGELOG.md                      # Lịch sử thay đổi của AI service
|-- pyproject.toml                    # Python package metadata, dependencies, pytest/ruff/mypy config
|-- requirements.txt                  # Dependency list cho pip-style install
|-- uv.lock                           # Lockfile cho uv/Python deps
|-- package.json                      # pnpm wrapper scripts cho Python service
|-- main.py                           # Thin entrypoint/import bootstrap cho service
|-- Dockerfile                        # Docker image cho AI service
|-- .dockerignore                     # Docker ignore riêng của AI service
|-- .env.example                      # Ví dụ env local
|-- .env.enterprise.example           # Ví dụ env enterprise/provider nâng cao
|-- alembic.ini                       # Alembic migration config
|-- config/                           # Config TOML cho engine
|-- luna_workstation/                 # Core Python package
|-- migrations/                       # Alembic migrations
|-- tests/                            # Pytest suite
|-- scripts/                          # Helper scripts
|-- docs/                             # AI-service docs/runbooks/release evidence
`-- assets/                           # Image assets cho docs
```

#### `apps/ai-service/config/`

```text
config/
|-- default.toml                      # Default runtime config cho engine/provider/model
`-- local.example.toml                # Mẫu config local override
```

#### `apps/ai-service/luna_workstation/`

```text
luna_workstation/
|-- __init__.py                       # Package marker
|-- default_config.py                 # Default config object/constants
|-- config_manager.py                 # Load/manage config at app level
|-- config_validation.py              # Validate config rules
|-- exceptions.py                     # Custom exception types
|-- types.py                          # Shared Python typing aliases/models
|-- agents/                           # Agent prompts/roles/tools
|-- config/                           # Config schema/provider/model loaders
|-- dataflows/                        # Market/news/onchain/sentiment providers
|-- domain/                           # Pure domain models
|-- engine/                           # Worker-style engine contract and module entrypoint
|-- graph/                            # LangGraph orchestration
|-- llm_clients/                      # LLM provider adapters
|-- observability/                    # Logging/tracing/budget tracking
|-- reporting/                        # Report generation
|-- services/                         # Application services
|-- signals/                          # Deterministic signal engine
|-- storage/                          # SQLite persistence/repositories
|-- templates/                        # Research/thesis template registry
|-- utils/                            # Small shared helpers
`-- websocket/                        # Websocket package placeholder
```

#### `luna_workstation/agents/`

```text
agents/
|-- __init__.py                       # Package marker
|-- schemas.py                        # Shared agent output/input schemas
|-- aggregation/
|  |-- __init__.py                    # Package marker
|  |-- confidence.py                  # Confidence aggregation logic
|  |-- consensus.py                   # Consensus aggregation logic
|  `-- contradictions.py              # Detect/score contradictions
|-- analysts/
|  |-- market_analyst.py              # Market/price/technical analyst agent
|  |-- news_analyst.py                # News catalyst analyst agent
|  |-- onchain_analyst.py             # Onchain signal analyst agent
|  `-- social_media_analyst.py        # Social/sentiment analyst agent
|-- managers/
|  |-- portfolio_manager.py           # Portfolio/risk manager role
|  `-- research_manager.py            # Research manager/decision synthesis role
|-- planners/
|  |-- __init__.py                    # Package marker
|  |-- scenario_planner.py            # Scenario planning agent
|  `-- setup_planner.py               # Setup/trade plan agent
|-- researchers/
|  |-- bear_researcher.py             # Bear/contrarian thesis researcher
|  `-- bull_researcher.py             # Bull thesis researcher
|-- risk_mgmt/
|  |-- aggressive_debator.py          # Aggressive risk debate voice
|  |-- conservative_debator.py        # Conservative risk debate voice
|  `-- neutral_debator.py             # Neutral risk debate voice
`-- utils/
   |-- agent_states.py                # Agent state structures
   |-- agent_utils.py                 # Shared agent helper functions
   |-- crypto_tools.py                # Crypto data/tool helpers
   |-- multi_timeframe_tools.py       # Multi-timeframe analysis helpers
   |-- news_data_tools.py             # News provider/tool helpers
   |-- rating.py                      # Rating/scoring helpers
   |-- sentiment_tools.py             # Sentiment helpers
   |-- signal_tools.py                # Signal helper tools for agents
   |-- structured.py                  # Structured output helpers
   |-- technical_indicators_tools.py  # Technical indicator helpers
   `-- thesis_json.py                 # Thesis JSON parsing/formatting helpers
```

#### `luna_workstation/config/`

```text
config/
|-- __init__.py                       # Package marker
|-- loader.py                         # Load config from TOML/env
|-- models.py                         # Config model definitions
|-- providers.py                      # Provider config mapping
|-- schema.py                         # Config schema
|-- toml_writer.py                    # TOML serialization helper for local config files
`-- secrets.py                        # Secret/env key handling
```

#### `luna_workstation/dataflows/`

```text
dataflows/
|-- __init__.py                       # Package marker
|-- ccxt_provider.py                  # Exchange market data via CCXT
|-- config.py                         # Dataflow config
|-- crypto_news_provider.py           # Crypto news provider integration
|-- health.py                         # Provider/dataflow health checks
|-- historical_contract.py            # Historical data contract
|-- http_utils.py                     # HTTP request helpers
|-- interface.py                      # Dataflow public interface
|-- onchain_provider.py               # Onchain data provider abstraction
|-- protocols.py                      # Protocol typing for providers
|-- replay_audit.py                   # Replay/audit helpers
|-- retry.py                          # Retry policy helpers
|-- sentiment_provider.py             # Sentiment provider abstraction
|-- stockstats_utils.py               # Indicator helpers backed by stockstats
|-- timeframe_analyzer.py             # Timeframe analysis utilities
`-- utils.py                          # Shared dataflow helpers
```

#### `luna_workstation/domain/`

```text
domain/
|-- __init__.py                       # Package marker
|-- agent_opinion.py                  # Agent opinion domain model
|-- calibration.py                    # Calibration domain objects
|-- debate.py                         # Debate domain model
|-- decision.py                       # User decision domain model
|-- evaluation.py                     # Evaluation domain model
|-- observability.py                  # Observability event/domain model
|-- outcome.py                        # Outcome review domain model
|-- outcome_analytics.py              # Outcome analytics model/helpers
|-- provenance.py                     # Evidence/provenance model
|-- research_run.py                   # ResearchRun model
|-- scenario.py                       # Scenario model
|-- signal.py                         # Signal model
|-- snapshot.py                       # Market/signal/research snapshot model
|-- template.py                       # Template domain model
|-- tenancy.py                        # Workspace/tenant model
|-- thesis.py                         # Trade thesis model
|-- timeline.py                       # Timeline/event model
`-- trending.py                       # Trending symbol/topic model
```

#### `luna_workstation/engine/`

```text
engine/
|-- __init__.py                       # Package marker
|-- market_validation.py              # Validate requested market/symbol data
|-- runner.py                         # Worker-style engine runner
`-- schemas.py                        # Engine request/response schemas
```

#### `luna_workstation/graph/`

```text
graph/
|-- __init__.py                       # Package marker
|-- analyst_runtime.py                # Runtime wrapper cho analyst agents
|-- checkpointer.py                   # Checkpoint/resume support
|-- conditional_logic.py              # Conditional branches trong graph
|-- config_hash.py                    # Hash config để track reproducibility
|-- graph_factory.py                  # Build graph instances
|-- historical_replay.py              # Replay graph từ historical data
|-- journal_bridge.py                 # Bridge graph output sang journal service
|-- journal_coordinator.py            # Coordinate journal writes
|-- journal_mixin.py                  # Shared journal helper mixin
|-- node_names.py                     # Constants cho graph node names
|-- opinions.py                       # Opinion/debate graph helpers
|-- propagation.py                    # Propagate state/result giữa nodes
|-- protocols.py                      # Protocol typing cho graph components
|-- quant_signals.py                  # Deterministic quant signal nodes
|-- report_writer.py                  # Report writing node/helpers
|-- research_agents_graph.py          # Main multi-agent research graph
|-- research_graph.py                 # Research graph orchestration
|-- run_context.py                    # Context object cho một research run
|-- run_orchestrator.py               # High-level orchestration một run
|-- scenarios.py                      # Scenario graph helpers
|-- setup.py                          # Graph setup/import wiring
|-- signal_processing.py              # Signal processing graph steps
|-- thesis_builder.py                 # Build structured thesis từ graph output
|-- tool_runtime.py                   # Runtime cho tools dùng bởi graph
`-- tooling.py                        # Định nghĩa/helper cho tools
```

#### `luna_workstation/llm_clients/`

```text
llm_clients/
|-- __init__.py                       # Package marker
|-- anthropic_client.py               # Anthropic adapter
|-- azure_client.py                   # Azure OpenAI adapter
|-- base_client.py                    # Shared base client contract
|-- factory.py                        # Factory chon LLM client
|-- google_client.py                  # Google/Gemini adapter
|-- model_catalog.py                  # Model capability/catalog metadata
|-- openai_client.py                  # OpenAI-compatible adapter
|-- orchestrator.py                   # LLM routing/fallback orchestration
`-- validators.py                     # Validate model/provider request
```

#### `luna_workstation/observability/`

```text
observability/
|-- __init__.py                       # Package marker
|-- budget.py                         # Token/cost/budget tracking
|-- logging.py                        # Structured logging helpers
`-- tracing.py                        # Trace/span helpers
```

#### `luna_workstation/reporting/`

```text
reporting/
|-- __init__.py                       # Package marker
`-- report_generator.py               # Generate research/thesis reports
```

#### `luna_workstation/services/`

```text
services/
|-- __init__.py                       # Package marker
|-- async_journal_service.py          # Async journal operations
|-- evaluation_service.py             # Outcome/evaluation use cases
|-- journal_service.py                # Journal persistence/use cases
|-- performance_tracker.py            # Performance/reliability tracking
|-- research_service.py               # Research run use cases
|-- signal_service.py                 # Signal query/persistence use cases
`-- thesis_service.py                 # Thesis use cases
```

#### `luna_workstation/signals/`

```text
signals/
|-- __init__.py                       # Package marker
|-- base.py                           # Base signal definitions
|-- composite.py                      # Composite signal scoring
|-- divergence_signals.py             # Divergence signal rules
|-- engine.py                         # Signal engine entrypoint
|-- funding_oi_signals.py             # Funding/open-interest signals
|-- onchain_signals.py                # Onchain signal rules
|-- provenance.py                     # Signal provenance conversion
|-- regime_signals.py                 # Market regime signals
|-- rules.py                          # Shared rule definitions
|-- snapshots.py                      # Build signal snapshots
`-- volume_signals.py                 # Volume-based signals
```

#### `luna_workstation/storage/`

```text
storage/
|-- __init__.py                       # Package marker
|-- migrations.py                     # SQLite migration helpers
|-- schema.py                         # SQLite schema definition
|-- serialization.py                  # Serialize/deserialize domain data
|-- sqlite.py                         # SQLite connection/access helpers
`-- repositories/
   |-- __init__.py                    # Package marker
   |-- base.py                        # Base repository helpers
   |-- evaluations.py                 # Evaluation repository
   |-- journal.py                     # Journal repository
   |-- observability.py               # Observability repository
   |-- runs.py                        # Research run repository
   |-- signals.py                     # Signal repository
   `-- theses.py                      # Thesis repository
```

#### `luna_workstation/templates/`

```text
templates/
|-- __init__.py                       # Package marker
|-- registry.py                       # Template registry
`-- definitions/
   |-- __init__.py                    # Package marker
   |-- breakout.py                    # Breakout setup template
   |-- funding_squeeze.py             # Funding squeeze template
   |-- liquidity_sweep.py             # Liquidity sweep template
   |-- macro_event.py                 # Macro event template
   |-- news_event.py                  # News event template
   |-- range_reversion.py             # Range reversion template
   `-- trend_pullback.py              # Trend pullback template
```

#### `luna_workstation/utils/` and `websocket/`

```text
utils/
|-- __init__.py                       # Package marker
|-- collections.py                    # Collection helper functions
|-- numbers.py                        # Numeric formatting/calculation helpers
`-- price_sanity.py                   # Sanity checks for prices

websocket/
`-- __init__.py                       # Package marker/place for websocket code
```

#### `apps/ai-service/migrations/`

```text
migrations/
|-- env.py                            # Bootstrap env Alembic
|-- script.py.mako                    # Template migration Alembic
`-- versions/
   |-- 0001_baseline.py               # Schema DB baseline
   |-- 0002_hardening_indexes_trigger_key.py # Hardening indexes/trigger key migration
   |-- 0003_observability_contract.py # Observability contract migration
   |-- 0004_research_run_degradation.py # Các field degradation của research run
   |-- 0005_workspace_tenancy.py      # Workspace tenancy migration
   `-- 0006_signal_legacy_normalization.py # Normalize dữ liệu signal legacy
```

#### `apps/ai-service/scripts/`

```text
scripts/
|-- python.cjs                        # Node wrapper để gọi Python từ pnpm scripts
|-- show_latest_journal_timeline.py   # Debug/hiển thị latest journal timeline
`-- smoke_structured_output.py        # Smoke test structured LLM output
```

#### `apps/ai-service/tests/`

```text
tests/
|-- conftest.py                       # Pytest fixtures/shared setup
|-- test_analyst_prompt_guards.py     # Guardrails cho analyst prompts
|-- test_analyst_runtime.py           # Analyst runtime behavior
|-- test_budget_tracking.py           # Budget/token/cost tracking
|-- test_ccxt_provider.py             # CCXT market data provider
|-- test_checkpoint_resume.py         # Checkpoint/resume behavior
|-- test_composite_scoring.py         # Composite signal scoring
|-- test_conditional_logic.py         # Graph conditional branches
|-- test_config_hash.py               # Config hash reproducibility
|-- test_config_loader.py             # Config loader behavior
|-- test_config_validation.py         # Config validation
|-- test_dataflow_config.py           # Dataflow config
|-- test_dataflow_resilience.py       # Provider resilience/fallback
|-- test_deepseek_reasoning.py        # DeepSeek reasoning integration behavior
|-- test_divergence_signals.py        # Divergence signals
|-- test_engine_contract.py           # Worker engine request/response contract
|-- test_evaluation_aggregation.py    # Evaluation aggregation
|-- test_evaluation_window_guard.py   # Evaluation time-window guard
|-- test_exceptions.py                # Custom exception behavior
|-- test_google_api_key.py            # Google API key handling
|-- test_historical_contract.py       # Historical data contract
|-- test_historical_replay.py         # Historical replay
|-- test_journal_bridge_scenarios.py  # Journal bridge scenarios
|-- test_journal_criticality.py       # Journal criticality semantics
|-- test_journal_service.py           # Journal service
|-- test_llm_fallback.py              # LLM fallback behavior
|-- test_model_catalog.py             # Model catalog metadata
|-- test_model_validation.py          # Model validation
|-- test_observability_logging.py     # Observability logging
|-- test_onchain_signals.py           # Onchain signals
|-- test_performance_tracker.py       # Performance tracker
|-- test_phase34_hardening.py         # Phase hardening tests
|-- test_production_provider_policy.py # Production provider policy
|-- test_prompt_ticker_sanitize.py    # Prompt ticker sanitization
|-- test_property_based_hardening.py  # Hypothesis/property-based hardening
|-- test_provider_capability_table.py # Provider capability metadata
|-- test_providers.py                 # Provider integration/unit behavior
|-- test_replay_smoke.py              # Replay smoke coverage
|-- test_report_rating_rendering.py   # Report rating rendering
|-- test_route_to_vendor_historical.py # Historical vendor routing
|-- test_run_orchestrator.py          # Run orchestrator
|-- test_safe_ticker_component.py     # Safe ticker component handling
|-- test_scenario_generation.py       # Scenario generation
|-- test_secrets.py                   # Secret handling
|-- test_sentiment_guards.py          # Sentiment guardrails
|-- test_signal_engine_degradation.py # Signal engine degradation behavior
|-- test_signal_processing.py         # Signal processing
|-- test_signal_provenance.py         # Signal provenance
|-- test_snapshots.py                 # Snapshot building
|-- test_sqlite_migration_backup_restore.py # SQLite backup/restore/migration
|-- test_structured_agents.py         # Structured agent outputs
|-- test_template_registry.py         # Template registry
|-- test_thesis_explainability.py     # Thesis explainability
`-- test_ticker_symbol_handling.py    # Ticker/symbol handling
```

#### `apps/ai-service/docs/`

```text
docs/
|-- PROJECT_OVERVIEW.md               # AI-service architecture/product overview
|-- PRODUCTION_READINESS_REVIEW.md    # Readiness review
|-- GO_LIVE_READINESS.md              # Go-live checklist/evidence
|-- ROADMAP_DEV.md                    # Development roadmap
|-- ROADMAP_PRODUCTION.md             # Production roadmap
|-- TROUBLESHOOTING.md                # Troubleshooting guide
|-- data-retention-and-boundary.md    # Data retention/product boundary
|-- postgres-migration-strategy.md    # Postgres migration strategy
|-- release-sign-off-template.md      # Release sign-off template
|-- runbooks/
|  |-- credential-leak-tabletop.md    # Credential leak drill
|  |-- incident-message-template.md   # Incident communication template
|  |-- journal-backup-restore.md      # Journal backup/restore runbook
|  |-- key-rotation.md                # Key rotation runbook
|  |-- llm-deprecation.md             # LLM deprecation runbook
|  `-- provider-outage.md             # Provider outage runbook
`-- release-evidence/0.3.0-2026-05-12/
   |-- ci-matrix-status.md            # CI matrix evidence
   |-- clean-clone-summary.md         # Clean clone verification
   |-- completion-audit-2026-05-12.md # Completion audit
   |-- journal-migration-backup-restore.md # Backup/restore evidence
   |-- operational-drills.md          # Operational drill evidence
   |-- secret-scan-detect-secrets.json # Secret scan machine output
   |-- secret-scan-triage.md          # Secret scan triage notes
   `-- workspace-local-gates-2026-05-12.md # Local gate evidence
```

#### `apps/ai-service/assets/`

```text
assets/
|-- analyst.png                       # Visual asset
|-- researcher.png                    # Visual asset
|-- risk.png                          # Visual asset
|-- schema.png                        # Visual asset
|-- TauricResearch.png                # Visual asset
|-- trader.png                        # Visual asset
`-- wechat.png                        # Visual asset
```

### 4.2 `apps/api/`

`apps/api` là NestJS API boundary. Pattern chính: mỗi domain có `*.module.ts`, `*.controller.ts`, `*.service.ts`; DTO nằm trong `dto/`.

```text
apps/api/
|-- package.json                      # API scripts/dependency workspace
|-- Dockerfile                        # Docker image cho API
|-- tsconfig.app.json                 # TypeScript config cho API build
|-- scripts/
|  `-- export-sqlite-journal.py       # Export SQLite journal helper
|-- test/
|  `-- api-contract.test.ts           # API contract tests
`-- src/
   |-- main.ts                        # NestJS bootstrap
   |-- app.module.ts                  # Root module import tất cả domain modules
   |-- system.controller.ts           # Health/openapi/system endpoints
   |-- alerts/                        # Alert inbox/checks
   |-- auth/                          # Local auth guard/service
   |-- calibration/                   # Calibration/outcome evaluation endpoints
   |-- common/                        # Helper/constants dùng chung
   |-- comparisons/                   # Compare runs/theses
   |-- config/                        # Env parsing
   |-- contracts/                     # Frontend/OpenAPI contracts
   |-- database/                      # Postgres/Prisma persistence boundary
   |-- jobs/                          # Research job queue/worker/Python engine client
   |-- journal/                       # Journal endpoints
   |-- market-data/                   # Market price/OHLCV endpoints
   |-- operations/                    # Operations/provider/model/freshness endpoints
   |-- performance/                   # Reliability/performance analytics
   |-- research-continuity/           # Continuity snapshot/delta/report
   |-- research-runs/                 # Tạo/chi tiết/lịch sử research run
   |-- scenarios/                     # Scenario monitor
   |-- signals/                       # Signal explorer/detail
   |-- theses/                        # Thesis library/detail/decision/review
   |-- users/                         # User boundary
   |-- workbench/                     # Workbench summary endpoint
   `-- workspaces/                    # Workspace membership/access
```

#### `apps/api/src/alerts/`

```text
alerts/
|-- alerts.controller.ts              # HTTP routes cho alerts
|-- alerts.module.ts                  # Nest module wiring
`-- alerts.service.ts                 # Alert business logic
```

#### `apps/api/src/auth/`

```text
auth/
|-- auth.guard.ts                     # Auth/workspace guard
|-- auth.module.ts                    # Nest module wiring
`-- auth.service.ts                   # Auth helper/local header validation
```

#### `apps/api/src/calibration/`

```text
calibration/
|-- calibration.controller.ts         # Calibration HTTP routes
|-- calibration.module.ts             # Nest module wiring
|-- calibration.service.ts            # Calibration logic
`-- dto/
   |-- agent-calibration.dto.ts       # Agent calibration request/response shape
   |-- evaluate-thesis.dto.ts         # Thesis evaluation DTO
   |-- evaluation-rerun.dto.ts        # Rerun evaluation DTO
   |-- evaluation-version-policy.dto.ts # Evaluation version policy DTO
   |-- matured-evaluations.dto.ts     # Matured evaluations query DTO
   |-- outcome-review.dto.ts          # Outcome review DTO
   `-- symbol-calibration.dto.ts      # Symbol calibration DTO
```

#### `apps/api/src/common/` and `config/`

```text
common/
|-- market-symbols.ts                 # Shared market symbol helpers/constants
`-- query-limit.ts                    # Query limit parsing/defaults

config/
`-- env.ts                            # Environment variable parsing/defaults
```

#### `apps/api/src/comparisons/`

```text
comparisons/
|-- comparisons.controller.ts         # Compare endpoint routes
|-- comparisons.module.ts             # Nest module wiring
`-- comparisons.service.ts            # Run/thesis comparison logic
```

#### `apps/api/src/contracts/`

```text
contracts/
|-- frontend-contract.ts              # Source of truth types cho frontend contract
|-- openapi.generated.ts              # Document/types OpenAPI generated
`-- research-evidence.ts              # Helper/types evidence contract
```

#### `apps/api/src/database/`

```text
database/
|-- database.module.ts                # Provides database repositories/clients
|-- journal.types.ts                  # Journal persistence types
|-- postgres-availability.ts          # Check/guard Postgres availability
|-- postgres-journal.repository.ts    # Postgres journal repository
|-- postgres-schema.sql               # Raw SQL schema/reference/init script
`-- prisma-journal.repository.ts      # Prisma-backed journal repository
```

#### `apps/api/src/jobs/`

```text
jobs/
|-- job-lifecycle.service.ts          # Job state/progress lifecycle logic
|-- jobs.controller.ts                # Job HTTP routes
|-- jobs.module.ts                    # Nest module wiring
|-- jobs.service.ts                   # Job enqueue/query/cancel logic
|-- python-engine.client.ts           # Spawns/calls Python engine module contract
|-- research-job.processor.ts         # BullMQ processor/memory processor logic
|-- research-worker.ts                # Worker process entrypoint
`-- sqlite-journal-sync.service.ts    # Sync local SQLite journal output to API/Postgres boundary
```

#### `apps/api/src/journal/`

```text
journal/
|-- journal.controller.ts             # Journal HTTP routes
`-- journal.module.ts                 # Nest module wiring
```

#### `apps/api/src/market-data/`

```text
market-data/
|-- market-data.controller.ts         # Market data routes
|-- market-data.module.ts             # Nest module wiring
|-- market-ohlcv.service.ts           # OHLCV/candle data fetch logic
`-- market-price.service.ts           # Latest price fetch logic
```

#### `apps/api/src/operations/`, `performance/`, `scenarios/`, `signals/`

```text
operations/
|-- operations.controller.ts          # Operations routes
|-- operations.module.ts              # Nest module wiring
`-- operations.service.ts             # Provider/model/freshness operations logic

performance/
|-- performance.controller.ts         # Performance analytics routes
|-- performance.module.ts             # Nest module wiring
`-- performance.service.ts            # Reliability/outcome analytics logic

scenarios/
|-- scenarios.controller.ts           # Scenario routes
|-- scenarios.module.ts               # Nest module wiring
`-- scenarios.service.ts              # Scenario monitor logic

signals/
|-- signals.controller.ts             # Signal routes
|-- signals.module.ts                 # Nest module wiring
`-- signals.service.ts                # Signal explorer/detail logic
```

#### `apps/api/src/research-continuity/`

```text
research-continuity/
|-- continuity-delta.engine.ts        # Computes delta between continuity snapshots
|-- continuity-report.renderer.ts     # Renders continuity report
|-- continuity-state.projector.ts     # Projects current continuity state
|-- research-continuity.controller.ts # Continuity HTTP routes
|-- research-continuity.module.ts     # Nest module wiring
|-- research-continuity.service.ts    # Continuity use cases
|-- research-snapshot.builder.ts      # Builds normalized research snapshot
`-- dto/
   `-- research-continuity.dto.ts     # Continuity request/response DTOs
```

#### `apps/api/src/research-runs/`

```text
research-runs/
|-- market-data-guard.service.ts      # Guard data quality/availability before runs
|-- research-runs.controller.ts       # Research run routes
|-- research-runs.module.ts           # Nest module wiring
|-- research-runs.service.ts          # Research run logic
`-- dto/
   `-- create-research-run.dto.ts     # Request DTO tạo research run
```

#### `apps/api/src/theses/`

```text
theses/
|-- theses.controller.ts              # Thesis routes
|-- theses.module.ts                  # Nest module wiring
|-- theses.service.ts                 # Thesis logic
`-- dto/
   |-- thesis-decision.dto.ts         # User decision DTO
   `-- thesis-review.dto.ts           # Thesis review/outcome DTO
```

#### `apps/api/src/users/`, `workbench/`, `workspaces/`

```text
users/
|-- users.module.ts                   # Nest module wiring
`-- users.service.ts                  # User lookup/membership helper logic

workbench/
|-- workbench.controller.ts           # Workbench summary routes
|-- workbench.module.ts               # Nest module wiring
`-- workbench.service.ts              # Aggregates dashboard/workbench data

workspaces/
|-- workspaces.module.ts              # Nest module wiring
`-- workspaces.service.ts             # Workspace membership/access logic
```

### 4.3 `apps/web/`

`apps/web` là Vite/React UI. Pattern chính: `pages/` là screen, `services/` là API client, `components/` là UI pieces, `routes/` map URL.

```text
apps/web/
|-- README.md                         # Web app overview, routes, local dev
|-- package.json                      # Web dependencies/scripts
|-- Dockerfile                        # Docker image cho web
|-- index.html                        # Vite HTML entry
|-- nginx.conf                        # Production static/proxy config
|-- tsconfig.json                     # TypeScript config
|-- vite.config.ts                    # Vite config/proxy/aliases
|-- public/
|  `-- agent-avatars/                 # Agent avatar PNG assets
`-- src/
   |-- main.tsx                       # React root render
   |-- App.tsx                        # App wrapper/provider setup
   |-- vite-env.d.ts                  # Vite env typing
   |-- components/                    # Reusable UI components
   |-- layouts/                       # Main app shell
   |-- lib/                           # Small frontend helpers
   |-- navigation/                    # Navigation group config
   |-- pages/                         # Route pages
   |-- routes/                        # React Router setup
   |-- schemas/                       # Zod/frontend schemas
   |-- services/                      # API client layer
   |-- store/                         # Zustand store
   |-- styles/                        # Global CSS
   `-- types/                         # Shared frontend types
```

#### `apps/web/src/components/`

```text
components/
|-- navigation/
|  |-- SidebarNav.tsx                 # Left sidebar navigation
|  |-- TopCommandStrip.tsx            # Top command/status strip
|  `-- WorkspaceSwitcher.tsx          # Workspace switcher UI
|-- research/
|  |-- badges.tsx                     # Research status/badge UI
|  |-- bento.tsx                      # Bento/grid display primitives
|  |-- header-stats.tsx               # Header stats widgets
|  |-- json-view.tsx                  # JSON viewer component
|  |-- page-header.tsx                # Shared research page header
|  |-- panel.tsx                      # Research panel container
|  `-- workflow-visualization.tsx     # Agent workflow visualization
`-- ui/
   `-- state.tsx                      # Loading/empty/error state UI
```

#### `apps/web/src/layouts/`, `lib/`, `navigation/`, `routes/`

```text
layouts/
`-- MainLayout.tsx                    # App shell layout with nav/outlet

lib/
|-- env.ts                            # Frontend env parsing/defaults
|-- format.ts                         # Formatting helpers
|-- routes.ts                         # Route/path helpers
`-- utils.ts                          # Small utility helpers

navigation/
`-- nav-groups.ts                     # Sidebar/nav group definitions

routes/
`-- index.tsx                         # React Router route table
```

#### `apps/web/src/pages/`

```text
pages/
|-- AlertsPage.tsx                    # Alert inbox
|-- CalibrationLabPage.tsx            # Calibration/outcome lab
|-- NotFoundPage.tsx                  # Fallback 404 page
|-- OperationsPage.tsx                # Operations/provider/model/freshness surface
|-- PerformanceAnalyticsPage.tsx      # Outcome/reliability analytics
|-- ResearchContinuityPage.tsx        # Research continuity view
|-- ResearchHistoryPage.tsx           # Research run history
|-- ResearchRunFormPage.tsx           # Launch new research run
|-- ResearchRunWorkspacePage.tsx      # Main run/journal workspace
|-- RunComparisonPage.tsx             # Compare runs/theses
|-- ScenarioMonitorPage.tsx           # Scenario monitor
|-- SettingsPage.tsx                  # Local auth/API/workspace settings
|-- SignalDetailPage.tsx              # Signal detail
|-- SignalsPage.tsx                   # Signal explorer
|-- ThesisDetailPage.tsx              # Thesis detail workflow
|-- ThesisLibraryPage.tsx             # Thesis library
`-- WorkbenchPage.tsx                 # Main daily command center
```

#### `apps/web/src/services/`

```text
services/
|-- client.ts                         # Axios client/base headers/base URL
|-- alerts.ts                         # Alert API calls
|-- calibration.ts                    # Calibration API calls
|-- comparisons.ts                    # Comparison API calls
|-- market-data.ts                    # Market data API calls
|-- market-realtime.ts                # Realtime market feed helpers
|-- operations.ts                     # Operations API calls
|-- performance.ts                    # Performance analytics API calls
|-- query-keys.ts                     # TanStack Query key constants
|-- research-continuity.ts            # Research continuity API calls
|-- research-runs.ts                  # Research run API calls
|-- scenarios.ts                      # Scenario API calls
|-- signals.ts                        # Signal API calls
|-- theses.ts                         # Thesis API calls
|-- workbench.ts                      # Workbench API calls
`-- generated/
   `-- api-client.ts                  # Generated/mirrored API contract client types
```

#### `apps/web/src/schemas/`, `store/`, `styles/`, `types/`

```text
schemas/
|-- research-run.ts                   # Research run frontend schema
`-- workspace.ts                      # Workspace frontend schema

store/
`-- useWorkspaceStore.ts              # Zustand store for workspace/user state

styles/
`-- index.css                         # Global CSS primitives/theme

types/
`-- index.ts                          # Shared frontend TypeScript types
```

#### `apps/web/public/agent-avatars/`

```text
agent-avatars/
|-- bull-contrarian-debate-agent.png  # Avatar asset
|-- market-analyst.png                # Avatar asset
|-- news-analyst.png                  # Avatar asset
|-- onchain-analyst.png               # Avatar asset
|-- portfolio-manager-agent.png       # Avatar asset
|-- research-manager-agent.png        # Avatar asset
|-- risk-debate-agent.png             # Avatar asset
|-- scenario-planner-agent.png        # Avatar asset
|-- setup-planner-agent.png           # Avatar asset
|-- signal.png                        # Avatar asset
|-- social-analyst.png                # Avatar asset
|-- spot-checks.png                   # Avatar asset
`-- trade-thesis-agent.png            # Avatar asset
```

### 4.4 `apps/landing/`

```text
apps/landing/
`-- .gitkeep                          # Giữ folder trong Git; landing app chưa được implement
```

## 5. `packages/` File Map

```text
packages/
|-- database/
|  |-- .gitkeep                       # Placeholder marker
|  |-- package.json                   # Prisma scripts: generate, db push, migrate
|  |-- prisma.config.ts               # Prisma CLI config
|  `-- prisma/
|     `-- schema.prisma               # Product Postgres schema/source of truth
|-- config/
|  `-- .gitkeep                       # Placeholder shared config package
|-- types/
|  `-- .gitkeep                       # Placeholder shared types package
`-- ui-shared/
   `-- .gitkeep                       # Placeholder shared UI package
```

`packages/database/prisma/schema.prisma` là nơi định nghĩa product data model chính: users, workspaces, memberships, research runs, jobs, snapshots, theses, signals, debates, evaluation artifacts và cac bang lien quan.

## 6. `docs/` File Map

```text
docs/
|-- README.md                         # Documentation map/start here
|-- backend-system-design.md          # Backend/API architecture notes
|-- frontend-system-design.md         # Frontend architecture notes
|-- project-status.md                 # Current project status
|-- project-roadmap.md                # Cross-repo roadmap hub
|-- operations-monitoring.md          # Operations/monitoring checklist
|-- known-issues.md                   # Known issues/technical debt
|-- goal-skill.md                     # Goal-ready implementation plan template
|-- figma-roadmap-page-plan.md        # Figma/design roadmap plan
|-- lunacrypto-workstation-ux.md      # Workstation UX notes
|-- lunacrypto-workstation-ui-concept.html # UI concept prototype/reference
|-- lunacrypto-roadmap-design-board.html   # Roadmap design board prototype/reference
|-- web-app-implementation-roadmap.md # Web app implementation roadmap
|-- project-structure.md              # File này: structure map
|-- adr/
|  |-- README.md                      # ADR index/convention
|  `-- 0001-versioned-feature-docs-and-tracking-hubs.md # ADR về convention docs/versioning
|-- features/
|  |-- README.md                      # Feature registry/convention
|  |-- calibration-lab/
|  |  |-- README.md                   # Calibration lab feature hub
|  |  |-- v1/implementation-plan.md   # Calibration lab v1 plan
|  |  |-- v1.1/implementation-plan.md # Calibration lab v1.1 plan
|  |  |-- v1.1/batch-matured-evaluation.md # Batch matured evaluation plan
|  |  |-- v1.2/implementation-plan.md # Calibration lab v1.2 plan
|  |  |-- v1.2.1/implementation-plan.md # Calibration lab v1.2.1 plan
|  |  |-- v1.3/implementation-plan.md # Calibration lab v1.3 plan
|  |  |-- v1.4/implementation-plan.md # Calibration lab v1.4 plan
|  |  |-- v1.5/implementation-plan.md # Calibration lab v1.5 plan
|  |  |-- v2.0/implementation-plan.md # Calibration lab v2.0 plan
|  |  |-- v2.1/implementation-plan.md # Calibration lab v2.1 plan
|  |  |-- v2.2/implementation-plan.md # Calibration lab v2.2 plan
|  |  |-- v2.3/implementation-plan.md # Calibration lab v2.3 plan
|  |  |-- v2.4/implementation-plan.md # Calibration lab v2.4 plan
|  |  |-- v2.5/implementation-plan.md # Calibration lab v2.5 plan
|  |  `-- v3.0/implementation-plan.md # Calibration lab v3.0 plan
|  `-- research-continuity/
|     |-- README.md                   # Research continuity feature hub
|     |-- v1/implementation-plan.md   # Research continuity v1 plan
|     |-- v1.1/implementation-plan.md # Research continuity v1.1 plan
|     |-- v1.2/implementation-plan.md # Research continuity v1.2 plan
|     |-- v1.3/implementation-plan.md # Research continuity v1.3 plan
|     `-- v1.4/implementation-plan.md # Research continuity v1.4 plan
`-- preview/
   |-- lunacrypto-roadmap-design-board.pdf # Design board preview
   `-- lunacrypto-workstation-ui-concept.png # Workstation UI concept image
```

## 7. Tooling/Hidden Folders

```text
.github/
`-- workflows/
   `-- ci.yml                         # GitHub Actions CI: secret scan, Python/API gates

.understand-anything/
|-- .understandignore                 # Ignore rules for codebase analysis
|-- config.json                       # Understand-anything config
|-- meta.json                         # Analysis metadata
|-- intermediate/
|  `-- inventory.json                 # Inventory generated during analysis
`-- knowledge-graph.json              # Generated graph; large, not hand-edited

.claude/
|-- settings.json                     # Settings Claude shared/local
`-- settings.local.json               # Settings Claude local; có thể chứa config riêng của máy

.deepseek/
`-- state/
   `-- subagents.v1.json              # Local subagent state

.codex/
`-- *.png / run-logs/                 # Local screenshots and Codex run artifacts

.hypothesis/
|-- constants/                        # Hypothesis generated constants/cache
|-- tmp/                              # Hypothesis temp files
`-- unicode_data/                     # Hypothesis unicode data cache
```

## 8. Generated/Local Output To Avoid Editing

```text
node_modules/                        # Installed JS dependencies
packages/database/node_modules/      # Package-local dependencies
dist/                                # TypeScript build output
.turbo/ and **/.turbo/               # Turborepo cache/logs
.venv/                               # Python virtual environment
.mypy_cache/                         # mypy cache
.ruff_cache/                         # Ruff cache
logs/                                # Runtime logs
*.log                                # Local process logs
```

## 9. Quick Navigation

```text
Muốn sửa UI route/page      -> apps/web/src/pages/* + apps/web/src/routes/index.tsx
Muốn sửa API endpoint       -> apps/api/src/<domain>/*.controller.ts + *.service.ts
Muốn sửa contract frontend  -> apps/api/src/contracts/frontend-contract.ts + apps/web/src/services/generated/api-client.ts
Muốn sửa DB schema          -> packages/database/prisma/schema.prisma
Muốn sửa research pipeline  -> apps/ai-service/luna_workstation/graph/*
Muốn sửa agent behavior     -> apps/ai-service/luna_workstation/agents/*
Muốn sửa deterministic signal -> apps/ai-service/luna_workstation/signals/*
Muốn sửa engine worker      -> apps/ai-service/luna_workstation/engine/* + apps/api/src/jobs/python-engine.client.ts
Muốn sửa docs/plan feature  -> docs/features/<feature>/<version>/implementation-plan.md
```
