# Bull Researcher

## Purpose

Bull Researcher la debate agent ben bullish. No tao case ung ho thesis tich cuc, dung reports tu cac analyst va tranh luan truc tiep voi Bear Researcher.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/researchers/bull_researcher.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Bull Researcher`
- Stage: `debate`

## Inputs

- `investment_debate_state`
- `market_report`
- `sentiment_report`
- `news_report`
- `fundamentals_report`

`investment_debate_state` includes:

- `history`
- `bull_history`
- `bear_history`
- `current_response`
- `count`

## What it does

1. Reads all analyst reports.
2. Reads full debate history and last Bear argument.
3. Builds bullish case around growth potential, competitive advantages, positive indicators, and quant baseline.
4. Refutes Bear counterpoints with evidence.
5. Produces conversational debate text, not structured JSON.
6. Updates `investment_debate_state`.

## Guardrails

- Analyst reports are wrapped by `guard_untrusted_context`.
- Response should stay concise via shared debate response instruction.
- Must engage with Bear argument instead of only listing data.
- Quant signal from Market Report is treated as primary quantitative baseline.

## Output

Returns updated `investment_debate_state`:

- Appends `Bull Analyst: ...` to `history`.
- Appends same argument to `bull_history`.
- Sets `current_response` to latest bull argument.
- Increments `count`.

## Downstream consumers

- Bear Researcher during debate loop.
- Research Manager final debate judgment.
