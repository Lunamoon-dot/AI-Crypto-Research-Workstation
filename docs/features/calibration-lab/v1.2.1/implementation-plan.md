# Calibration Lab V1.2.1 Implementation Plan

Last updated: 2026-05-24
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1.2.1 end-to-end.

Read this document first:
docs/features/calibration-lab/v1.2.1/implementation-plan.md

Objective:
- Patch V1.2 semantics so symbol mode is framed as a research-centric Symbol
  Thesis Cluster Audit, not as evaluation of a symbol/market itself.

Required behavior:
- Keep the existing /calibration?mode=symbol surface and GET /calibration/symbol
  compatibility unless a rename can be done without breaking callers.
- Rename user-facing UI copy from "Symbol Calibration" to "Symbol Thesis
  Cluster" or "Symbol Thesis Cluster Audit".
- Treat symbol as a grouping/filter dimension for thesis evaluations.
- Do not claim the symbol itself is correct/incorrect.
- Remove or de-emphasize deterministic symbol verdict copy.
- Keep coverage, stance distribution, conflict/consistency, missing evaluation,
  and supporting thesis rows as the core report.
- Outcome metrics must be labeled as evaluated thesis outcome summary, not market
  or symbol verdict.
- CTA to batch evaluation remains explicit and only prepares V1.1 batch mode.

Do not implement:
- New evaluation engine behavior.
- LLM parsing.
- Provider OHLCV fetching.
- New DB tables.
- Active evaluation promotion policy.
- Rerun audit changes.
- Agent calibration changes beyond wording if needed.
- Charts, snapshots, scheduler/background jobs, exports, subscriptions, or
  broad dashboards.

Definition of done:
- Symbol mode no longer presents itself as evaluating BTC/ETH/the symbol.
- API/UI/docs use research-centric language: thesis cluster, coverage,
  consistency, and outcome summary.
- Correct/incorrect symbol verdict language is removed or replaced with safer
  coverage/consistency/outcome-status language.
- Existing V1.2 functionality still works, including symbol filter, coverage,
  rows, and batch CTA.
- Focused API tests and web typecheck pass, or exact blockers are documented.
```

## One Outcome

Reframe V1.2 around the correct research unit.

The correct unit of evaluation is:

```text
TradeThesis
```

The symbol is only:

```text
grouping/filter context
```

V1.2.1 answers:

```text
For BTC/USDT, what final theses did our research system produce, how many have
been evaluated, how consistent were they, and what happened to those evaluated
theses?
```

It must not answer:

```text
Was BTC correct?
Did we evaluate BTC?
Is the symbol itself good/bad?
```

## Why This Patch Exists

V1.2 implemented useful aggregation, but its naming can imply the system is
evaluating a market symbol directly.

That is the wrong mental model for this product.

The core product object is:

```text
ResearchRun -> AgentOpinions -> Final TradeThesis -> ThesisEvaluation
```

So the trustworthy framing is:

```text
Evaluate thesis.
Group evaluated theses by symbol.
Audit coverage and consistency by symbol.
```

The risky framing is:

```text
Evaluate BTC.
BTC thesis cluster was correct.
Symbol verdict correct/incorrect.
```

V1.2.1 corrects that language and contract before later versions build more
automation on top.

## Version Placement

```text
V1    Manual single-thesis evaluation.
V1.1  Batch matured thesis evaluation.
V1.2  Symbol aggregate MVP.
V1.2.1 Research-centric symbol thesis cluster semantics patch.
V1.3  Manual single-evaluation rerun audit.
V1.4  Agent Calibration MVP.
V1.5  Evaluation version policy and manual promotion.
V2.0  Background evaluation jobs.
```

V1.2.1 is a semantic patch. It should not rewrite V1.3, V1.4, or V1.5.

## Resolved Decisions

- Do not remove V1.3, V1.4, or V1.5.
- Do not remove thesis evaluation.
- Do not remove batch matured evaluation.
- Do not remove symbol filtering/grouping.
- Symbol mode remains useful, but its meaning changes:

```text
from: Symbol Calibration / symbol verdict
to:   Symbol Thesis Cluster Audit / thesis outcome summary
```

- The report must not claim a symbol is correct or incorrect.
- The report must not imply broker PnL or market-prediction certainty.
- `TradeThesis` remains the only evaluated research claim.
- `ThesisEvaluation` remains the machine evaluation artifact.
- Symbol-level view is a cluster audit over many thesis evaluations.
- Route compatibility is preferred:

```text
GET /calibration/symbol
/calibration?mode=symbol
```

- If API type names are expensive to rename, keep code-level names but update
  response semantics, documentation, and UI copy.
- If API response can be evolved safely, add safer fields and deprecate unsafe
  fields instead of breaking consumers.

## Terminology

Preferred user-facing names:

```text
Symbol Thesis Cluster
Symbol Thesis Cluster Audit
Thesis coverage by symbol
Thesis outcome summary
Consistency
Conflict
Missing evaluations
```

Avoid user-facing names:

```text
Symbol Calibration
Symbol Evaluation
BTC was correct
BTC was incorrect
Symbol verdict
Market verdict
Prediction score
```

Acceptable internal names when compatibility matters:

```text
calibrationSymbol
SymbolCalibrationReportResponse
GET /calibration/symbol
```

But UI copy and docs must explain the research-centric meaning.

## API Compatibility Strategy

Prefer a non-breaking patch.

Keep:

```text
GET /calibration/symbol
```

The endpoint should be documented as:

```text
Returns a symbol-scoped thesis cluster audit.
```

Do not add a replacement endpoint in V1.2.1 unless the existing API cannot be
patched cleanly.

Optional future alias, not required for V1.2.1:

```text
GET /calibration/thesis-clusters/symbol
```

## Response Semantics

Keep core fields:

```text
symbol
window_days
lookback_days
period_start
period_end
coverage
stance
outcome
rows
```

Coverage remains central:

```text
matured_thesis_count
evaluated_count
missing_evaluation_count
coverage_pct
```

Stance remains central:

```text
stance_counts
consensus_stance
conflict_rate
```

Rows remain central:

```text
thesis_id
created_at
symbol
stance
direction
confidence
status
evaluation_id
result
max_favorable_excursion
max_adverse_excursion
```

Outcome must be reframed as:

```text
evaluated thesis outcome summary
```

not:

```text
symbol result
market result
```

## Fields To Remove Or Deprecate

Unsafe field:

```text
outcome.verdict = correct | incorrect | inconclusive
```

Recommended V1.2.1 behavior:

```text
Keep field only if removing breaks API contract, but stop presenting it in UI.
Mark it deprecated in docs/contracts when possible.
```

Safer replacement fields:

```text
coverage_status: complete | partial | sparse | empty
consistency_status: coherent | mixed | unclear
outcome_status: favorable | unfavorable | mixed | inconclusive
```

Meanings:

```text
coverage_status:
  complete = all matured theses have evaluation
  partial  = some matured theses have evaluation
  sparse   = very few matured theses or low evaluated count
  empty    = no matured theses

consistency_status:
  coherent = one classified stance dominates
  mixed    = classified stances materially conflict
  unclear  = no classified stance or too much unknown

outcome_status:
  favorable    = evaluated thesis outcomes skew toward hit_target
  unfavorable  = evaluated thesis outcomes skew toward invalidated
  mixed        = evaluated outcomes are split/ambiguous
  inconclusive = too few evaluated rows or mostly unknown/expired/mixed
```

These statuses describe the thesis cluster, not the market symbol.

## Suggested Status Rules

Coverage:

```text
empty:
  matured_thesis_count = 0

complete:
  matured_thesis_count > 0 AND missing_evaluation_count = 0

partial:
  coverage_pct >= 0.5

sparse:
  coverage_pct < 0.5 OR evaluated_count < 3
```

Consistency:

```text
unclear:
  classified stance count = 0

coherent:
  conflict_rate <= 0.25

mixed:
  conflict_rate > 0.25
```

Outcome:

```text
inconclusive:
  evaluated_count = 0 OR decisive_count < 3

favorable:
  hit_target_count > invalidated_count

unfavorable:
  invalidated_count > hit_target_count

mixed:
  otherwise
```

`decisive_count`:

```text
hit_target_count + invalidated_count
```

Do not derive symbol correctness from `representative_return`.

## Representative Return

`representative_return` is risky because it can sound like full-symbol market
return.

Recommended V1.2.1 behavior:

```text
Keep it in API only if already used by tests/contracts.
Rename in UI/docs to "avg evaluation window return" if shown.
Do not use it to create a symbol verdict.
Hide it from primary UI if it causes confusion.
```

Never label it as:

```text
BTC return
symbol return
market return
```

Use:

```text
average evaluated thesis window return
```

## UI UX

Route compatibility:

```text
/calibration?mode=symbol
```

Mode label should change from:

```text
Symbol Calibration
```

to one of:

```text
Symbol Thesis Cluster
Symbol Thesis Audit
Thesis Cluster
```

Recommended label:

```text
Symbol Thesis Cluster
```

Panel title:

```text
Symbol Thesis Cluster Audit
```

Primary sections:

```text
Coverage
Stance Consistency
Evaluated Thesis Outcomes
Supporting Theses
```

Avoid sections:

```text
Symbol Verdict
Market Verdict
BTC Correctness
```

CTA stays:

```text
Prepare batch evaluation
```

CTA copy should clarify:

```text
Prepare missing thesis evaluations for this symbol.
```

not:

```text
Evaluate this symbol.
```

## Contract And Type Guidance

If low-risk:

```text
Add status fields:
- coverage_status
- consistency_status
- outcome_status
```

If medium/high risk:

```text
Keep response shape.
Add status fields as optional additions.
Stop using outcome.verdict in UI.
Update docs/tests to assert safer statuses.
```

Do not rename route or TypeScript types in V1.2.1 unless the codebase can absorb
that safely in one small patch.

## Relevant Context

Current repo facts:

- V1 evaluates single `TradeThesis`.
- V1.1 batch evaluates matured `TradeThesis` rows.
- V1.2 currently exposes `/calibration?mode=symbol` and
  `GET /calibration/symbol`.
- V1.3 rerun audit remains valid because it operates on `ThesisEvaluation`.
- V1.4 Agent Calibration remains valid if it is framed as alignment proxy over
  thesis evaluations.
- V1.5 promotion policy remains valid because it chooses active
  `ThesisEvaluation` source.
- Existing dirty worktree changes may exist. Preserve unrelated changes.

Files to inspect first:

```text
docs/features/calibration-lab/v1.2/implementation-plan.md
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/types/index.ts
```

Likely files to change:

```text
apps/api/src/calibration/calibration.service.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/types/index.ts
docs/features/calibration-lab/README.md
docs/features/calibration-lab/v1.2/implementation-plan.md
```

Python files should not change.

Schema files should not change.

## Implementation Checklist

- [ ] Update docs to describe V1.2 as symbol thesis cluster audit.
- [ ] Update UI label from Symbol Calibration to Symbol Thesis Cluster.
- [ ] Update panel copy to avoid evaluating the symbol itself.
- [ ] Add or expose safer statuses if low-risk:
      `coverage_status`, `consistency_status`, `outcome_status`.
- [ ] Stop showing `outcome.verdict` as primary UI.
- [ ] Replace correct/incorrect symbol language in UI.
- [ ] Keep coverage, stance counts, conflict rate, result counts, MFE/MAE, and
      supporting rows working.
- [ ] Ensure batch CTA says it prepares missing thesis evaluations.
- [ ] Update API/contract tests for safer semantics.
- [ ] Run validation commands.

## Required Tests

API contract tests:

- [ ] Existing `/calibration/symbol` route still returns report.
- [ ] Report includes coverage counts.
- [ ] Report includes stance distribution and conflict rate.
- [ ] Report includes evaluated thesis outcome summary.
- [ ] Report includes supporting thesis rows.
- [ ] Missing evaluations remain visible.
- [ ] Status fields are computed if added:
      coverage_status, consistency_status, outcome_status.
- [ ] Deprecated `outcome.verdict`, if retained, is not the primary asserted
      semantic.
- [ ] No test names or assertions claim the symbol itself is correct/incorrect.

Web:

- [ ] Typecheck passes.
- [ ] `/calibration?mode=symbol` still renders.
- [ ] UI label says Symbol Thesis Cluster or equivalent.
- [ ] UI does not show "BTC correct", "symbol verdict", or "evaluate symbol".
- [ ] Batch CTA still opens/prefills batch mode without applying.

Python:

- [ ] No Python tests required.

## Validation Loop

Run:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Open `/calibration?mode=symbol`.
- Confirm mode label uses Symbol Thesis Cluster wording.
- Load `BTC/USDT`, `7d`, `30d`.
- Confirm report reads like a thesis cluster audit.
- Confirm no UI copy claims BTC/the symbol is correct or incorrect.
- Confirm missing evaluations and Prepare batch evaluation still work.
- Confirm Single, Batch, Rerun Audit, Agent, and Version Policy modes are not
  changed by this patch.

## Checkpoint Behavior

Work milestone by milestone:

1. Contract/status semantics.
2. API tests.
3. UI copy and labels.
4. Documentation cleanup.
5. Validation and manual smoke.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving forward;
- preserve unrelated dirty worktree changes;
- do not expand into V1.3, V1.4, V1.5, or V2.0 work.

## Stop Rules

Stop and report instead of expanding scope when:

- symbol mode is research-centric and no longer implies symbol evaluation;
- implementation would require route removal or broad API breaking changes;
- implementation would require engine/provider/LLM changes;
- implementation would require schema changes;
- implementation would require rewriting V1.3-V1.5.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/calibration-lab/v1.2.1/implementation-plan.md first and treat
it as the source of truth for Calibration Lab V1.2.1.

Implement only the V1.2.1 Research-Centric Symbol Thesis Cluster semantics
patch. Keep route compatibility where possible. Do not evaluate a symbol or
claim the symbol is correct/incorrect. Symbol mode should be framed as grouping
and auditing thesis evaluations by symbol.

Do not call LLMs, call the Python engine, fetch providers, write DB rows, change
schema, implement rerun/promotion/agent/scheduler work, or remove V1.3-V1.5.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, contract, React Query, routing, and CSS patterns.
Preserve unrelated dirty worktree changes.
```

## Definition Of Done

- `/calibration?mode=symbol` remains usable.
- `GET /calibration/symbol` remains compatible unless a safe alias is added.
- User-facing copy says Symbol Thesis Cluster / thesis cluster audit.
- Symbol is treated as grouping/filter context only.
- UI does not present `correct/incorrect` as a symbol verdict.
- Coverage, stance consistency, evaluated thesis outcome summary, and supporting
  thesis rows remain available.
- Batch CTA only prepares missing thesis evaluations for the symbol.
- Focused API tests and web typecheck pass, or blockers are documented.
