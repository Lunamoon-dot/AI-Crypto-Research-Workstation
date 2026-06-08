# Spot Checks

## Purpose

Spot Checks is a UI/stage view of Setup Planner behavior when `market_type` is `spot`. It is not a separate LLM agent. It highlights the spot-specific checks that Setup Planner is expected to include in the setup proposal.

## Code

- Setup Planner factory: `apps/ai-service/luna_workstation/agents/planners/setup_planner.py`
- UI stage: `apps/web/src/pages/ResearchRunWorkspacePage.tsx`
- API timing contract: `apps/api/src/contracts/frontend-contract.ts`
- Stage key: `spot_checks`
- Label: `Spot Checks`
- Completed by same event family as Setup Planner, especially `plan.recorded`

## When it appears

This stage appears only when normalized run market type is `spot`.

## Inputs

Same as Setup Planner:

- `company_of_interest`
- `investment_plan`
- `market_type`

## What it checks

For spot research, Setup Planner prompt asks the model to focus on:

- accumulation / DCA logic
- swing setup logic
- allocation risk
- liquidity
- invalidation
- objective zones
- spot-specific notes

## Guardrails

- Do not discuss leverage.
- Do not discuss margin.
- Keep output as manual-review research, not automated execution.
- Missing or weak data should be reflected in `missing_data`.

## Output

There is no separate `spot_checks` state payload. The material lives inside Setup Planner output:

- `trader_investment_plan`
- `market_type: spot`
- `spot_notes`
- allocation/invalidation/objective-zone text in rendered setup proposal

## Downstream consumers

- Risk debate
- Portfolio Manager
- Scenario Planner
- UI stage timing and display
