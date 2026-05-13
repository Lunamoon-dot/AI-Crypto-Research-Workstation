# LunaCrypto AI Service

This is the Python AI research service for the LunaPerception monorepo. It lives in `apps/ai-service`, keeps the existing Python package name `tradingagents` for import compatibility, and exposes the public CLI command as `lunacrypto`.

A local-first Spot/Perp AI workstation for crypto market research, trade-thesis generation, decision journaling, signal provenance, and outcome review.

The core product is research workflow software: collect context, generate signals, let agents debate, produce a thesis, save the decision, and review the outcome.

## What This Project Is

The product direction is:

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
- User decision and outcome review commands.
- Assisted trade-plan artifact for manual review only.
- Checkpoint resume for long research runs.
- Multi-provider LLM support.

## Product Boundary

The workstation stops at research artifacts and user-reviewed decisions:

```text
market context
-> deterministic signals
-> trade thesis
-> user decision
-> journal
-> outcome review
```

## Architecture

High-level architecture:

```text
cli/
  interactive CLI, journal commands, signal explorer

tradingagents/graph/
  LangGraph orchestration, journal bridge, planning helpers

tradingagents/domain/
  ResearchRun, Signal, TradeThesis, MarketSnapshot, SignalSnapshot,
  UserDecision, OutcomeReview, Scenario

tradingagents/signals/
  deterministic signal engine, factor signals, provenance adapter,
  snapshot builders

tradingagents/storage/
  SQLite schema, persistence helpers, repositories

tradingagents/services/
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
~/.tradingagents/
```

Important paths:

```text
~/.tradingagents/cache/research_journal.sqlite
~/.tradingagents/memory/trading_memory.md
~/.tradingagents/cache/checkpoints/
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

Set at least one LLM provider key:

```bash
export OPENAI_API_KEY=...
```

Optional provider keys:

```bash
export GOOGLE_API_KEY=...
export ANTHROPIC_API_KEY=...
export XAI_API_KEY=...
export DEEPSEEK_API_KEY=...
export DASHSCOPE_API_KEY=...
export ZHIPU_API_KEY=...
export OPENROUTER_API_KEY=...
export AZURE_OPENAI_API_KEY=...
export ALPHA_VANTAGE_API_KEY=...
```

You can also create a local `.env` file.

## CLI Usage

Launch the interactive research workflow:

```bash
tradingagents
```

Or run from source:

```bash
python -m cli.main
```

Useful journal commands:

```bash
lunacrypto journal path
lunacrypto journal list
lunacrypto journal show <run_id>
lunacrypto journal market-snapshot <snapshot_id>
lunacrypto journal signal-snapshot <snapshot_id>
```

Thesis commands:

```bash
lunacrypto thesis list
lunacrypto thesis show <thesis_id>
lunacrypto thesis decide <thesis_id> watched --notes "Waiting for confirmation"
lunacrypto thesis review <thesis_id> mixed --lessons "Funding overheated before confirmation"
```

Signal provenance commands:

```bash
lunacrypto signals latest ETH/USDT
lunacrypto signals snapshot <run_id>
lunacrypto signals explain <signal_id>
lunacrypto signals list BTC/USDT
```

Signal snapshots are run-scoped. Public signal wording uses
`bullish` / `bearish` / `neutral`, with `quant_bias` as aggregate evidence
rather than a final user decision. Spot and perp evidence lanes are shown
separately.

Historical thesis evaluation:

```bash
lunacrypto research evaluate thesis <thesis_id>
lunacrypto research evaluate analytics
```

This evaluates research/thesis quality, not realized PnL.

## Python Usage

Use the research-oriented graph entrypoint:

```python
from tradingagents.graph import ResearchAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG

config = DEFAULT_CONFIG.copy()
config["llm_provider"] = "openai"
config["deep_think_llm"] = "gpt-5.4"
config["quick_think_llm"] = "gpt-5.4-mini"

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
python -m mypy tradingagents cli
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

- [docs/ROADMAP_DEV.md](docs/ROADMAP_DEV.md) — phases 1–9 (implementation)
- [docs/ROADMAP_PRODUCTION.md](docs/ROADMAP_PRODUCTION.md) — phases 10–14 (reliability, API/cloud, monetization)
- [docs/postgres-migration-strategy.md](docs/postgres-migration-strategy.md) — SQLite local mode to Postgres hosted mode
- [docs/PRODUCTION_READINESS_REVIEW.md](docs/PRODUCTION_READINESS_REVIEW.md) — current production-readiness verdict and blockers

Abbreviated direction:

```text
Dev (1–9): foundation → journal → signal provenance → multi-agent workspace → scenarios → watchlists → terminal UX → brief → historical thesis evaluation
Production (10–14): config/secrets → observability → service/API layer → workstation UI/API hardening
```

## Production Status

This project is not production-ready yet. As of the 2026-05-12 readiness review, it is suitable for controlled local alpha/beta research use, but not for a broad production launch or hosted paid product.

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
