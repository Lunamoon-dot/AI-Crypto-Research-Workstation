# Aggressive Analyst

## Purpose

Aggressive Analyst la risk debate agent theo huong high-reward/high-risk. No tranh luan de bao ve upside cua Setup Planner proposal va challenge conservative/neutral views.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/risk_mgmt/aggressive_debator.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Aggressive Analyst`
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
2. Reads all analyst reports.
3. Reads risk debate history.
4. Reads latest Conservative and Neutral responses if any.
5. Builds case for upside, growth potential, and bold risk-taking.
6. Responds directly to Conservative/Neutral objections.
7. Updates `risk_debate_state`.

## Guardrails

- Setup proposal, reports, and debate history are wrapped by `guard_untrusted_context`.
- Output conversationally, no special formatting.
- Shared debate instruction keeps response under 350 words and at most six concise points.
- Does not make final portfolio decision.

## Output

Returns updated `risk_debate_state`:

- Appends `Aggressive Analyst: ...` to `history`.
- Appends same argument to `aggressive_history`.
- Sets `latest_speaker` to `Aggressive`.
- Sets `current_aggressive_response`.
- Increments `count`.

## Downstream consumers

- Conservative Analyst
- Neutral Analyst
- Portfolio Manager
