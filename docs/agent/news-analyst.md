# News Analyst

## Purpose

News Analyst doc source-grounded catalyst context. No uu tien pre-computed news context gom LunaCrypto default sources va workspace user-configured sources; tools chi la fallback/enrichment khi coverage yeu.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/analysts/news_analyst.py`
- Common runner: `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `News Analyst`
- Selection key: `news`
- Report key: `news_report`
- Opinion key: `news_opinion`
- Source report type: `news`

## Inputs

- `company_of_interest`
- `trade_date`
- `messages`
- `news_context`: pre-computed context containing headlines, URLs, dates, quality, catalyst tags, and missing-data notes.

## Tools

- `get_news`
- `get_global_news`

## What it does

1. Reads pre-computed news context as primary evidence.
2. Uses tools only as degraded fallback or enrichment.
3. Separates confirmed primary-source catalysts from weaker media/aggregator/search context.
4. Writes report sections:
   - Catalyst Summary
   - Source Coverage And Quality
   - Confirmed Primary-Source Items
   - Media / Aggregator Context
   - Trading Implication
   - Missing Data / Conflicts
5. Runtime converts the report into `AgentOpinion`.

## Guardrails

- Do not fabricate headlines, URLs, publication dates, catalysts, or source names.
- Do not cite URLs absent from context or tool output.
- Treat source quality and missing data explicitly.
- Keep primary-source evidence separate from aggregator context.

## Output

- `news_report`
- `news_opinion`
- `messages`

## Downstream consumers

- Bull/Bear debate
- Scenario Planner catalyst branches
- Risk debate
- Portfolio Manager
- Trade Thesis risks and monitor-next items
