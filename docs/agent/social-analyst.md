# Social Analyst

## Purpose

Social Analyst doc market-wide crypto mood va asset-specific retail attention. No khong lam news/catalyst analysis va khong duoc bien social attention thanh lenh BUY/SELL.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py`
- Common runner: `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Social Analyst`
- Selection key: `social`
- Report key: `sentiment_report`
- Opinion key: `sentiment_opinion`
- Source report type: `sentiment`

## Inputs

- `company_of_interest`
- `trade_date`
- `messages`

## Tools

- `get_fear_greed_index`
- `get_social_sentiment`

## What it does

1. Uses Fear & Greed only for broad crypto market mood.
2. Uses CoinGecko trending/social attention for asset-specific retail attention.
3. Separates market-wide mood from asset attention.
4. Writes report sections:
   - Macro Mood
   - Asset Retail Attention
   - Trading Implication
   - Missing Data / Limits
5. Appends a Markdown table.
6. Runtime converts report into `AgentOpinion`.

## Guardrails

- Fear & Greed is market-wide only, never coin-specific sentiment.
- Do not fetch, cite, or infer project news coverage.
- Do not cite official posts, KOL posts, Telegram, Reddit, Discord, YouTube, or similar feeds in V1 because no trusted social feed is wired.
- Missing asset-specific social evidence should be labeled `missing_social_feed`, not `missing_news_feed`.
- Do not output direct BUY/SELL commands from social attention alone.

## Output

- `sentiment_report`
- `sentiment_opinion`
- `messages`

## Downstream consumers

- Bull/Bear debate
- Risk debate
- Portfolio Manager
- Trade Thesis evidence and missing-data notes
