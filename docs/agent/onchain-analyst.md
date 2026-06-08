# Onchain Analyst

## Purpose

Onchain Analyst doc crypto market-structure and on-chain-adjacent proxies. Despite name, current tools are mostly exchange/CoinGecko proxies, not full wallet-level on-chain data.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/analysts/onchain_analyst.py`
- Common runner: `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Onchain Analyst`
- Selection key: `onchain`
- Report key: `fundamentals_report`
- Opinion key: `fundamentals_opinion`
- Source report type: `onchain`

## Inputs

- `company_of_interest`
- `trade_date`
- `messages`
- `quant_signal`: contains pre-computed funding, OI, and liquidation data.

## Tools

- `get_crypto_ticker`
- `get_crypto_long_short_ratio`
- `get_crypto_nvt`
- `get_crypto_supply`
- `get_crypto_exchange_metrics`

## What it does

1. Reviews exchange market snapshot and position skew.
2. Reviews market-cap-over-volume/NVT proxy.
3. Reviews supply and turnover/liquidity proxies.
4. References pre-computed quant signal for funding, open interest, and liquidation data.
5. Writes market-structure/fundamentals-style report.
6. Appends a Markdown table.
7. Runtime converts the report into `AgentOpinion`.

## Guardrails

- Do not treat proxy metrics as wallet-level evidence.
- Do not claim institutional entry from tight spreads or liquidity.
- Do not infer accumulation from low turnover alone.
- Describe NVT as market cap / exchange volume proxy, not true network transaction NVT.
- Burn mechanics reduce supply; never describe burns as minting.
- Do not re-fetch funding/OI/liquidation data; use the pre-computed signal.

## Output

- `fundamentals_report`
- `fundamentals_opinion`
- `messages`

## Downstream consumers

- Bull/Bear debate
- Risk debate
- Portfolio Manager
- Scenario Planner evidence chips
- Trade Thesis missing-data and evidence summaries
