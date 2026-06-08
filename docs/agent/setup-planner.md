# Setup Planner

## Purpose

Setup Planner converts Research Manager's plan into a spot/perp-aware setup proposal for manual review. It does not place orders, route execution, or imply automated trading.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/planners/setup_planner.py`
- Schema: `SetupProposal` in `apps/ai-service/luna_workstation/agents/schemas.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Setup Planner`
- Stage: `setup_planner`
- Legacy alias: `create_trader`

## Inputs

- `company_of_interest`
- `investment_plan`
- `market_type` from state or config, default `spot`

## What it does

1. Resolves market type:
   - `spot`
   - `perp` / `perpetual` / `futures` / `future`
2. Builds market guidance:
   - spot: accumulation/DCA, swing setup, allocation risk, liquidity, invalidation, objective zones
   - perp: funding, OI, liquidation risk, leverage cap, invalidation distance, margin risk
3. Converts `investment_plan` into `SetupProposal`.
4. Renders markdown setup proposal.
5. Emits state for risk debate.

## Structured fields

`SetupProposal` includes:

- `market_type`
- `action`: `Buy`, `Hold`, or `Sell`
- `reasoning`
- `entry_zone`
- `confirmation_condition`
- `invalidation`
- `target_zones`
- `position_sizing`
- `spot_notes`
- `perp_notes`
- `missing_data`
- legacy optional fields: `entry_price`, `stop_loss`, `take_profit`

## Guardrails

- For spot, do not discuss leverage or margin.
- For perp, missing funding/OI/liquidation data must go into `missing_data`.
- Output is a setup proposal for manual review, not an execution instruction.
- `investment_plan` is wrapped by `guard_untrusted_context`.

## Output

- `trader_investment_plan`: rendered setup proposal.
- `market_type`: normalized market type.
- `sender`: `Setup Planner`
- `messages`: AI message containing setup proposal.

## Downstream consumers

- Aggressive Analyst
- Conservative Analyst
- Neutral Analyst
- Portfolio Manager
- Scenario Planner
- Trade Thesis extraction fallback for entry/invalidation/targets via final decision path
