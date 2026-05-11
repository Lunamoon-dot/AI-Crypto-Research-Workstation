# AI Crypto Research Workstation

A local-first AI workstation for crypto market research, trade-thesis generation, decision journaling, signal provenance, and outcome review.

This project is **not** an autonomous trading bot. It does not place live orders, auto-close positions, parse LLM prose into exchange actions, or bypass risk checks. The core product is research workflow software: collect context, generate signals, let agents debate, produce a thesis, save the decision, and review the outcome.

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

The intended end state is closer to:

```text
Obsidian / Cursor for crypto research
```

not:

```text
AI hedge fund
autonomous futures bot
one-click trading system
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

## Safety Boundary

The following are intentionally disabled or removed from the core product:

- autonomous live trading;
- live CCXT order routing;
- prose-based execution parsing;
- auto bracket order handling;
- auto-close monitoring;
- hidden risk bypasses;
- background execution loops.

If execution is added later, it must be an optional assistant layer:

```text
AI research
-> trade thesis
-> user approval
-> execution ticket
-> manual confirmation
-> audited exchange action
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

Clone the repository and enter the project directory:

```bash
git clone https://github.com/Lunamoon-dot/AI-Crypto-Research-Workstation.git
cd AI-Crypto-Research-Workstation
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
pip install -e ".[dev]"
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
tradingagents journal path
tradingagents journal list
tradingagents journal show <run_id>
tradingagents journal market-snapshot <snapshot_id>
tradingagents journal signal-snapshot <snapshot_id>
```

Thesis commands:

```bash
tradingagents thesis list
tradingagents thesis show <thesis_id>
tradingagents thesis decide <thesis_id> watched --notes "Waiting for confirmation"
tradingagents thesis review <thesis_id> mixed --lessons "Funding overheated before confirmation"
```

Signal provenance commands:

```bash
tradingagents signals list
tradingagents signals list BTC/USDT
tradingagents signals show <signal_id>
```

Historical thesis evaluation:

```bash
tradingagents evaluate
```

This is not a broker-accurate trading backtest. It is for evaluating research/thesis quality.

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

Run focused tests:

```bash
python -m pytest tests/test_journal_service.py
python -m pytest tests/test_signal_provenance.py
python -m pytest tests/test_snapshots.py
```

CI runs:

- install package with dev dependencies;
- Ruff critical checks;
- compile modules;
- pytest.

## Roadmap

Start at [ROADMAP.md](ROADMAP.md) (hub). Detailed docs:

- [docs/ROADMAP_DEV.md](docs/ROADMAP_DEV.md) — phases 1–9 (implementation)
- [docs/ROADMAP_PRODUCTION.md](docs/ROADMAP_PRODUCTION.md) — phases 10–14 (reliability, API/cloud, monetization)

Abbreviated direction:

```text
Dev (1–9): foundation → journal → signal provenance → multi-agent workspace → scenarios → watchlists → terminal UX → brief → historical thesis evaluation
Production (10–14): config/secrets → observability → service/API layer → optional assisted execution → cloud tiers
```

## Production Status

This project is still early.

Reasonable current use:

- local research workstation;
- structured decision journal;
- AI-assisted thesis generation;
- signal provenance inspection;
- paper/hypothetical planning.

Not production-ready for:

- autonomous live trading;
- leveraged futures automation;
- broker/exchange order management;
- regulated investment advice;
- unattended portfolio management.

## Disclaimer

This software is for research and workflow support only. It is not financial, investment, legal, or trading advice. You are responsible for your own decisions, risk management, and compliance.