# Perp Checks

## Purpose

Perp Checks is a UI/stage view of Setup Planner behavior when `market_type` is `perp`. It is not a separate LLM agent. It highlights the perp-specific risk checks that Setup Planner is expected to include in the setup proposal.

## Code

- Setup Planner factory: `apps/ai-service/luna_workstation/agents/planners/setup_planner.py`
- UI stage: `apps/web/src/pages/ResearchRunWorkspacePage.tsx`
- API timing contract: `apps/api/src/contracts/frontend-contract.ts`
- Stage key: `perp_checks`
- Label: `Perp Checks`
- Completed by same event family as Setup Planner, especially `plan.recorded`

## When it appears

This stage appears only when normalized run market type is `perp`.

## Inputs

Same as Setup Planner:

- `company_of_interest`
- `investment_plan`
- `market_type`

## What it checks

For perpetual futures research, Setup Planner prompt asks the model to explicitly evaluate:

- funding
- open interest
- liquidation risk
- leverage cap
- invalidation distance
- margin risk
- perp-specific notes

## Guardrails

- If funding/OI/liquidation data is missing, list it in `missing_data`.
- Do not overstate confidence when perp data is incomplete.
- Keep output as manual-review research, not automated execution.

## Output

There is no separate `perp_checks` state payload. The material lives inside Setup Planner output:

- `trader_investment_plan`
- `market_type: perp`
- `perp_notes`
- funding/OI/liquidation/margin-risk text in rendered setup proposal

## Downstream consumers

- Risk debate
- Portfolio Manager
- Scenario Planner
- UI stage timing and display
