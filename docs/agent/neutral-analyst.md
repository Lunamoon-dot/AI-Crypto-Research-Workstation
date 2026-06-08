# Neutral Analyst

## Purpose

Neutral Analyst la risk debate agent theo huong balanced. No challenge ca aggressive va conservative views, tim cach dieu chinh setup theo risk/reward hop ly hon.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/risk_mgmt/neutral_debator.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Neutral Analyst`
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
4. Reads latest Aggressive and Conservative responses if any.
5. Challenges aggressive optimism and conservative caution.
6. Builds moderate risk-adjusted view.
7. Updates `risk_debate_state`.

## Guardrails

- Context is wrapped by `guard_untrusted_context`.
- Output conversationally, no special formatting.
- Shared debate instruction limits length and avoids restating every source.
- Does not make final portfolio decision.

## Output

Returns updated `risk_debate_state`:

- Appends `Neutral Analyst: ...` to `history`.
- Appends same argument to `neutral_history`.
- Sets `latest_speaker` to `Neutral`.
- Sets `current_neutral_response`.
- Increments `count`.

## Downstream consumers

- Aggressive Analyst
- Conservative Analyst
- Portfolio Manager
