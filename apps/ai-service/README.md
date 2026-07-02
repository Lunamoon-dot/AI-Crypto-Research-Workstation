# LunaCrypto AI Service

This is the Python engine behind LunaCrypto's thesis discipline workflow. It
turns market context, deterministic signals, agent debate, and outcome review
into auditable research artifacts.

It lives in `apps/ai-service`, keeps the existing Python package name
`luna_workstation` for import compatibility. It no longer exposes a public
human command-line UI; product access is through the web/API, while API workers use the
machine-only engine module `python -m luna_workstation.engine`.

A local-first Spot/Perp AI workstation for crypto market research,
trade-thesis generation, decision journaling, signal provenance, and outcome
review.

## Product Loop

The engine powers one loop:

```text
Market data
-> deterministic signals
-> multi-agent research
-> AI-generated trade thesis
-> user decision
-> journal
-> outcome review
```

The intended end state is:

```text
Obsidian / Cursor for crypto research
```

The commercial promise is decision quality: know the evidence, know the
invalidation, keep the paper trail, and improve after the outcome.

## Current Capabilities

- Multi-agent research workflow using LangGraph.
- Crypto-first analysis with market, news, sentiment, and onchain-oriented agents.
- Deterministic quantitative signal layer.
- Signal provenance records with source, timestamp, freshness, confidence, and evidence.
- Local SQLite decision journal.
- Research run persistence.
- Trade thesis persistence.
- Market snapshot persistence.
- Signal snapshot persistence.
- User decision and outcome review workflows.
- Assisted trade-plan artifact for manual review only.
- Checkpoint resume for long research runs.
- Multi-provider LLM support.
- Alerts, replay, historical evaluation, and the worker-style engine contract.

## Product Boundary

The workstation writes research artifacts and user-reviewed decisions:

```text
market context
-> deterministic signals
-> trade thesis
-> user decision
-> journal
-> outcome review
```

Order placement and account-performance claims live outside this service. Any
future assisted execution must be explicit, manually confirmed, and audited.

## Architecture

High-level architecture:

```text
luna_workstation/engine/
  machine-only JSON request/result contract for API workers

luna_workstation/graph/
  LangGraph orchestration, journal bridge, planning helpers

luna_workstation/domain/
  ResearchRun, Signal, TradeThesis, MarketSnapshot, SignalSnapshot,
  UserDecision, OutcomeReview, Scenario

luna_workstation/signals/
  deterministic signal engine, factor signals, provenance adapter,
  snapshot builders

luna_workstation/storage/
  SQLite schema, persistence helpers, repositories

luna_workstation/services/
  application services such as JournalService
```

Research run persistence flow:

```text
ResearchAgentsGraph
-> SignalEngine
-> domain Signal[]
-> MarketSnapshot
-> SignalSnapshot
-> TradeThesis
-> JournalService
-> SQLite
```

## Local Data

By default, local state is stored under:

```text
~/.luna_workstation/
```

Important paths:

```text
~/.luna_workstation/cache/research_journal.sqlite
~/.luna_workstation/memory/trading_memory.md
~/.luna_workstation/cache/checkpoints/
```

Override journal DB path:

```bash
export TRADINGAGENTS_JOURNAL_DB=/path/to/research_journal.sqlite
```

Override memory log:

```bash
export TRADINGAGENTS_MEMORY_LOG_PATH=/path/to/trading_memory.md
```

## Installation

From the monorepo root, enter the service directory:

```bash
cd apps/ai-service
```

Create a Python environment:

```bash
python -m venv .venv
source .venv/bin/activate
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install the package:

```bash
python -m pip install -e ".[dev]"
```

## Environment Variables

Set the key for the configured LLM provider. The default config currently uses
DeepSeek:

```bash
export DEEPSEEK_API_KEY=...
```

Optional provider keys:

```bash
export OPENAI_API_KEY=...
export GOOGLE_API_KEY=...
export GEMINI_API_KEY=...
export ANTHROPIC_API_KEY=...
export XAI_API_KEY=...
export DASHSCOPE_API_KEY=...
export ZHIPU_API_KEY=...
export OPENROUTER_API_KEY=...
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=...
export COINGECKO_API_KEY=...
export CRYPTOPANIC_API_TOKEN=...
```

You can also create a local `.env` file.

### Output Language

The AI service default output language is configured with `output_language` in
`config/default.toml` and can be overridden locally in `config/local.toml`:

```toml
output_language = "Vietnamese"
```

Operators can also set `TRADINGAGENTS_OUTPUT_LANGUAGE=Vietnamese`. The web/API
research launch flow may send a per-run `output_language`; that request-level
value takes precedence over default and local config. Internal agent debate
remains English to preserve reasoning quality, while analyst reports and final
decision output use the selected language.

## Engine Contract

Human workflows now go through the web/API. The remaining command entrypoint is
machine-only and intended for API workers or focused contract smoke checks:

```bash
python -m luna_workstation.engine run --request request.json
python -m luna_workstation.engine evaluate --request evaluation-request.json
python -m luna_workstation.engine schema
```

Signal snapshots are run-scoped. Public signal wording uses
`bullish` / `bearish` / `neutral`, with `quant_bias` as aggregate evidence
rather than a final user decision. Spot and perp evidence lanes are shown
separately.

Historical thesis evaluation remains a service/API capability and evaluates
research/thesis quality, not realized PnL.

Watchlist, Daily Brief, and the human command-line UI were decommissioned. Use
thesis, scenario, signal, alert, journal, and evaluation workflows in the
web/API for current monitoring and review.

## Python Usage

Use the research-oriented graph entrypoint:

```python
from luna_workstation.graph import ResearchAgentsGraph
from luna_workstation.default_config import DEFAULT_CONFIG

config = DEFAULT_CONFIG.copy()
config["llm_provider"] = "deepseek"
config["deep_think_llm"] = "deepseek-v4-pro"
config["quick_think_llm"] = "deepseek-v4-flash"

graph = ResearchAgentsGraph(debug=True, config=config)
final_state, rating = graph.propagate("BTC/USDT", "2026-05-08")

print(rating)
```

Legacy imports using `TradingAgentsGraph` are still available for compatibility, but new code should prefer `ResearchAgentsGraph`.

## Testing

Run the full test suite:

```bash
python -m pytest
```

Run local quality gates:

```bash
python -m ruff check .
python -m ruff format --check .
python -m mypy luna_workstation
```

Run focused tests:

```bash
python -m pytest tests/test_journal_service.py
python -m pytest tests/test_signal_provenance.py
python -m pytest tests/test_snapshots.py
```

CI runs:

- install package with dev dependencies;
- Ruff lint and format checks;
- mypy type check;
- compile modules;
- pytest.

## Operations Docs

- [Data retention and cloud boundary](docs/data-retention-and-boundary.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Go-live readiness checklist](docs/GO_LIVE_READINESS.md)
- [Release sign-off template](docs/release-sign-off-template.md)

## Roadmap

Start at [ROADMAP.md](ROADMAP.md) (hub). Detailed docs:

- [docs/ROADMAP_DEV.md](docs/ROADMAP_DEV.md) â€” phases 1â€“9 (implementation)
- [docs/ROADMAP_PRODUCTION.md](docs/ROADMAP_PRODUCTION.md) â€” phases 10â€“14 (reliability, API/cloud, monetization)
- [docs/postgres-migration-strategy.md](docs/postgres-migration-strategy.md) â€” SQLite local mode to Postgres hosted mode
- [docs/PRODUCTION_READINESS_REVIEW.md](docs/PRODUCTION_READINESS_REVIEW.md) â€” current production-readiness verdict and blockers

Abbreviated direction:

```text
Dev (1â€“9): foundation â†’ journal â†’ signal provenance â†’ multi-agent workspace â†’ scenarios â†’ terminal UX â†’ historical thesis evaluation
Production (10â€“14): config/secrets â†’ observability â†’ service/API layer â†’ workstation UI/API hardening
```

## Production Status

This project is not hosted-production-ready yet. As of the 2026-05-13 technical review, it is credible for controlled local beta research use with clear research-only disclaimers, but not for a broad hosted SaaS launch or regulated financial-decision platform.

Reasonable current use:

- local research workstation;
- structured decision journal;
- AI-assisted thesis generation;
- signal provenance inspection;
- paper/hypothetical planning.

Next production work should focus on workstation concerns: repeatable config,
observable runs, stable APIs, clearer UI surfaces, and stronger signal
calibration.

Current blockers are tracked in [docs/PRODUCTION_READINESS_REVIEW.md](docs/PRODUCTION_READINESS_REVIEW.md) and [docs/GO_LIVE_READINESS.md](docs/GO_LIVE_READINESS.md).

## Disclaimer

This software is for research and workflow support only. It is not financial, investment, legal, or trading advice. You are responsible for your own decisions, risk management, and compliance.
