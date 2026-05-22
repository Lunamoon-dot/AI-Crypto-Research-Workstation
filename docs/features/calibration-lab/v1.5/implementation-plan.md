# Calibration Lab V1.5 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1.5 end-to-end.

Read this document first:
docs/features/calibration-lab/v1.5/implementation-plan.md

Objective:
- Add an explicit manual evaluation version policy so a completed V1.3 rerun can
  be promoted as the active evaluation source without losing audit history.

Required behavior:
- Promotion is manual and editor-only.
- Promotion starts from an existing completed rerun for an existing canonical
  ThesisEvaluation.
- Promotion is audited append-only.
- Calibration read paths can resolve the active evaluation source.
- Existing base ThesisEvaluation rows remain traceable.
- Promotion is blocked when it would invalidate an already-recorded
  OutcomeReview unless a later version explicitly designs review replacement.

Do not implement:
- Automatic promotion.
- Batch promotion.
- Scheduler/background jobs.
- New evaluation scoring rules.
- OutcomeReview replacement.
- Charts, export, subscriptions, or broad analytics.

Definition of done:
- Users can inspect active/current evaluation source.
- Users can manually promote a completed rerun when safe.
- Symbol and Agent Calibration can use the active evaluation resolver.
- Audit history clearly shows who promoted what and why.
- Focused API tests and web typecheck pass.
```

## One Outcome

Define how a rerun becomes the active evaluation used by Calibration Lab.

V1.5 answers:

```text
This rerun looks better than the original evaluation. Can I make it the active
evaluation result without destroying history?
```

## Resolved Decisions

- Promotion is manual.
- Promotion is editor-only.
- Promotion is append-only audited.
- Promotion does not delete rerun records.
- Promotion does not delete or hide the original canonical ThesisEvaluation.
- Promotion should not silently alter historical OutcomeReview meaning.
- Promotion must be explicit in UI copy.

## Proposed Data Model

Add a promotion/audit table instead of rewriting V1.3 rerun history.

Suggested model:

```text
thesis_evaluation_promotions
- id
- workspace_id
- canonical_evaluation_id
- promoted_rerun_id nullable
- previous_promoted_rerun_id nullable
- promoted_by_user_id nullable
- promoted_at
- reason
- notes nullable
- active boolean
- payload_json
```

Semantics:

```text
active promotion with promoted_rerun_id = null means base canonical is active.
active promotion with promoted_rerun_id = X means rerun X is active.
```

Implementation options:

```text
Preferred:
  append a new promotion row and mark older rows inactive in one transaction.

Acceptable if simpler:
  append-only rows and resolve latest promoted_at as active.
```

If using `active`, enforce at most one active promotion per workspace/evaluation
with a partial unique index when the repo migration style supports it.

## API Contract

Inspect policy:

```text
GET /calibration/evaluations/:id/version-policy
```

Promote rerun:

```text
POST /calibration/evaluations/:id/reruns/:rerun_id/promote
```

Body:

```json
{
  "reason": "bug_fix_verification",
  "notes": "Promote rerun after provider data fix."
}
```

Reset to base canonical:

```text
POST /calibration/evaluations/:id/version-policy/reset
```

Body:

```json
{
  "reason": "manual_check",
  "notes": "Return to base canonical evaluation."
}
```

Allowed reasons:

```text
manual_check
engine_rule_change
market_data_fix
bug_fix_verification
suspected_drift
other
```

## Active Evaluation Resolver

Add one internal resolver:

```text
resolveActiveEvaluation(canonical_evaluation_id, workspace_id)
```

It returns:

```text
base canonical ThesisEvaluation when no promotion exists
promoted rerun projection when active promotion exists
```

Projection fields must match the fields used by reports:

```text
id
workspace_id
thesis_id
symbol
window_days
evaluation_start
evaluation_end
evaluated_at
result
max_favorable_excursion
max_adverse_excursion
invalidated
warnings
evidence
payload
active_source
active_rerun_id
```

`active_source`:

```text
base_canonical
promoted_rerun
```

## Safety Rules

Block promotion when:

```text
canonical evaluation not found
rerun not found
rerun belongs to another canonical evaluation
rerun status is not completed
canonical evaluation already has outcome_review_id
```

Return a clear blocker:

```text
review_already_recorded
rerun_not_completed
rerun_mismatch
```

Do not mutate OutcomeReview in V1.5.

## UI UX

Add to existing Rerun Audit section:

```text
Active source badge
Promote completed rerun button
Reset to base button when promoted
Promotion history list
```

Copy must be explicit:

```text
Promote rerun as active evaluation
Reset active evaluation to base
Promotion changes Calibration Lab reports, not historical audit records.
```

## Relevant Context

Prerequisites:

```text
V1.3 rerun audit implemented.
V1.4 Agent Calibration should use the active evaluation resolver once V1.5 exists.
```

Files to inspect first:

```text
docs/features/calibration-lab/v1.3/implementation-plan.md
docs/features/calibration-lab/v1.4/implementation-plan.md
packages/database/prisma/schema.prisma
apps/api/src/calibration/calibration.service.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
```

## Required Tests

- Promoting a completed rerun creates audit state.
- Duplicate promotion attempts are deterministic.
- Promotion is workspace scoped.
- Promotion is blocked for failed reruns.
- Promotion is blocked when `outcome_review_id` exists.
- Active resolver returns base canonical with no promotion.
- Active resolver returns promoted rerun projection after promotion.
- Symbol Calibration uses active resolver.
- Agent Calibration uses active resolver when available.
- Reset to base returns reports to base canonical result.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Load one evaluation with rerun history.
- Promote a completed rerun.
- Confirm active source badge changes.
- Confirm Symbol/Agent Calibration reports use the promoted result.
- Reset to base and confirm reports revert.

## Stop Rules

Stop and report instead of expanding scope when:

- manual promotion/reset policy is complete;
- implementation would require OutcomeReview replacement;
- implementation would require batch or automatic promotion;
- implementation would require scheduler/background jobs;
- active evaluation semantics cannot be implemented without a broad rewrite.
