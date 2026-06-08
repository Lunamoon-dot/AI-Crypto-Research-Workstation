# Bear Researcher

## Purpose

Bear Researcher la debate agent ben bearish/contrarian. No tao case chong lai thesis bullish hoac chi ra downside risk, dung reports tu cac analyst va tranh luan truc tiep voi Bull Researcher.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/researchers/bear_researcher.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Bear Researcher`
- Stage: `debate`

## Inputs

- `investment_debate_state`
- `market_report`
- `sentiment_report`
- `news_report`
- `fundamentals_report`

## What it does

1. Reads all analyst reports.
2. Reads debate history and last Bull argument.
3. Builds bearish case around risks, weak market structure, adverse catalysts, or over-optimistic assumptions.
4. If quant signal is bullish, finds weaknesses in factor composition.
5. If quant signal is bearish, amplifies it as downside evidence.
6. Produces conversational debate text.
7. Updates `investment_debate_state`.

## Guardrails

- Analyst reports are wrapped by `guard_untrusted_context`.
- Must engage with Bull argument directly.
- Response is constrained by shared debate response instruction.
- Does not produce final decision; Research Manager judges debate later.

## Output

Returns updated `investment_debate_state`:

- Appends `Bear Analyst: ...` to `history`.
- Appends same argument to `bear_history`.
- Sets `current_response` to latest bear argument.
- Increments `count`.

## Downstream consumers

- Bull Researcher during debate loop.
- Research Manager final debate judgment.
