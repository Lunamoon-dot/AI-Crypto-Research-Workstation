# Research Manager

## Purpose

Research Manager chot investment debate thanh mot structured research plan cho Setup Planner. No khong dat lenh; no quyet dinh research stance tren thang 5 bac.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/managers/research_manager.py`
- Schema: `ResearchPlan` in `apps/ai-service/luna_workstation/agents/schemas.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Research Manager`
- Stage: `research_manager`

## Inputs

- `company_of_interest`
- `investment_debate_state.history`
- Full `investment_debate_state`

## What it does

1. Reads bull/bear debate history.
2. Uses instrument context to preserve exact ticker.
3. Evaluates debate against the quantitative baseline mentioned in Market Report.
4. Chooses exactly one research stance:
   - `Buy`
   - `Overweight`
   - `Hold`
   - `Underweight`
   - `Sell`
5. Produces a `ResearchPlan` with:
   - `recommendation`
   - `rationale`
   - `strategic_actions`
6. Renders that plan to markdown.
7. Updates debate state with `judge_decision`.

## Fallback behavior

If structured/freetext LLM output fails with `LLMOutputError`, it creates deterministic fallback:

- stance: `Hold`
- rationale: LLM unavailable, preserve neutral stance
- review focus: manual review and degraded memo

## Guardrails

- Debate history is wrapped by `guard_untrusted_context`.
- Hold should be reserved for genuinely balanced evidence.
- Strong quant signal should not be overridden by weak qualitative arguments, and weak quant signal should not override strong evidence.

## Output

- `investment_plan`: rendered research plan.
- updated `investment_debate_state` with:
  - `judge_decision`
  - unchanged debate histories
  - `current_response` set to investment plan

## Downstream consumers

- Setup Planner reads `investment_plan`.
- Portfolio Manager receives the plan later.
- Scenario Planner receives it indirectly.
