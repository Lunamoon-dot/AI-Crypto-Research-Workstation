# Portfolio Manager

## Purpose

Portfolio Manager synthesizes risk debate thanh final research thesis stance. No la LLM agent chot `final_trade_decision` va `final_trade_summary_json`; Trade Thesis builder sau do moi dong goi thanh persisted `TradeThesis`.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py`
- Schema: `PortfolioDecision` in `apps/ai-service/luna_workstation/agents/schemas.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Portfolio Manager`
- Stage: `portfolio_manager`

## Inputs

- `company_of_interest`
- `risk_debate_state.history`
- `investment_plan`
- `trader_investment_plan`
- `market_type`
- optional `past_context`
- optional `latest_continuity_context`
- performance feedback context from config/service

## What it does

1. Reads Research Manager plan.
2. Reads Setup Planner proposal.
3. Reads full risk debate history.
4. Optionally reads prior lessons and Research Continuity memory.
5. Produces final 5-tier stance:
   - `Buy`
   - `Overweight`
   - `Hold`
   - `Underweight`
   - `Sell`
6. Produces final readable markdown decision.
7. Produces or synthesizes `TRADE_THESIS_JSON`.
8. Strips JSON block from readable `final_trade_decision` when needed.
9. Updates `risk_debate_state` with `judge_decision`.

## Required thesis semantics

Prompt requires every thesis to state:

- why stance is bullish/bearish/watch
- what confirms it
- what invalidates it
- spot-specific notes when market type is spot
- perp-specific notes when market type is perp
- missing data instead of overstated confidence

## Machine-readable JSON fields

The JSON block includes:

- `rating`
- `direction`
- `confidence`
- `market_type`
- `action_summary`
- `confirmation_condition`
- `upside_catalyst`
- `invalidation`
- `key_reasons`
- `risks`
- `monitor_next`
- `supporting_evidence`
- `spot_notes`
- `perp_notes`
- `missing_data`

## Fallback behavior

If Portfolio Manager LLM output fails, deterministic fallback builds a degraded decision using:

- symbol
- market type
- research plan
- setup proposal
- risk debate
- error type

If the final output lacks JSON, `_synthesize_trade_summary_json` derives a summary from text and market type.

## Guardrails

- Research plan, setup proposal, prior memory, performance feedback, and risk debate are wrapped by `guard_untrusted_context`.
- Prior continuity memory is explicitly treated as prior memory, not current evidence.
- It is a research stance for manual review, not an exchange order.
- Rating and direction must stay consistent:
  - Buy/Overweight -> long
  - Hold -> watch or neutral
  - Underweight -> avoid
  - Sell -> short

## Output

- `final_trade_decision`
- `final_trade_summary_json`
- updated `risk_debate_state`

## Downstream consumers

- Scenario Planner
- Trade Thesis builder
- journal persistence
- UI final decision/thesis surfaces
