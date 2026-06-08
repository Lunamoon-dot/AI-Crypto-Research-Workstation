# Conservative Analyst

## Purpose

Conservative Analyst la risk debate agent theo huong capital protection. No tim downside, volatility, sustainability risk, va tranh luan chong lai aggressive/neutral views.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/risk_mgmt/conservative_debator.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Conservative Analyst`
- Stage: `risk_debate`

## Inputs

- `risk_debate_state`
- `trader_investment_plan`
- `market_report`
- `sentiment_report`
- `news_report`
- `fundamentals_report`

## What it does

1. Reads Setup Planner proposal.
2. Reads analyst reports.
3. Reads risk debate history.
4. Reads latest Aggressive and Neutral responses if any.
5. Builds lower-risk critique of the setup.
6. Highlights where setup may expose user to excessive risk.
7. Updates `risk_debate_state`.

## Guardrails

- Context is wrapped by `guard_untrusted_context`.
- Output conversationally, no special formatting.
- Shared debate instruction limits length and forces concise strongest evidence.
- Does not make final portfolio decision.

## Output

Returns updated `risk_debate_state`:

- Appends `Conservative Analyst: ...` to `history`.
- Appends same argument to `conservative_history`.
- Sets `latest_speaker` to `Conservative`.
- Sets `current_conservative_response`.
- Increments `count`.

## Downstream consumers

- Neutral Analyst
- Aggressive Analyst
- Portfolio Manager
