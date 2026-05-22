# Calibration Lab V1.5 Implementation Plan

Last updated: 2026-05-23
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1.5 end-to-end.

Read this document first:
docs/features/calibration-lab/v1.5/implementation-plan.md

Objective:
- Add an explicit manual evaluation version policy so a completed V1.3 rerun can
  be promoted as the active evaluation source for Calibration Lab reports without
  losing canonical evaluation or rerun audit history.

Required behavior:
- Promotion policy is a pure append-only event ledger.
- Promotion/reset is manual and editor-only.
- Version policy reads are reader-accessible.
- Promotion starts from an existing completed rerun for an existing canonical
  ThesisEvaluation.
- Reset returns active source to the base canonical evaluation.
- Promote/reset accepts a required reason, optional notes, and optional
  idempotency_key.
- Same idempotency key returns the existing event and does not append a
  duplicate event.
- Same-state promote/reset is a no-op and does not append an event.
- Promote/reset is blocked when the canonical evaluation already has
  outcome_review_id.
- Active evaluation projection keeps the canonical evaluation id and adds
  active source metadata.
- GET /calibration/evaluations/:id returns active projection.
- GET /calibration/symbol and GET /calibration/agents use active evaluation
  values in metrics and expose active source metadata in rows.
- Raw history endpoints remain raw and are not silently projected.
- Web UI adds version policy controls to the existing Rerun Audit section with
  inline 2-step confirmation.

Do not implement:
- Automatic promotion.
- Batch promotion.
- Scheduler/background jobs.
- OutcomeReview replacement or mutation.
- New evaluation scoring rules.
- New rerun behavior.
- Charts, export, subscriptions, or broad analytics.

Definition of done:
- Users can inspect active/current evaluation source.
- Users can manually promote a completed rerun when safe.
- Users can reset to base when safe.
- Symbol and Agent Calibration reports use the active evaluation resolver.
- Report rows expose whether metrics came from base canonical or promoted rerun.
- Audit history clearly shows who promoted/reset what and why.
- Focused API tests and web typecheck pass.
```

## One Outcome

Define how a rerun becomes the active evaluation used by Calibration Lab.

V1.5 answers:

```text
This rerun looks better than the original evaluation. Can I make it the active
evaluation result for reports without destroying history?
```

V1.5 is a version policy layer. It is not a review replacement system.

## Version Placement

```text
V1.3  Manual single-evaluation rerun audit.
V1.4  Agent Calibration MVP.
V1.5  Evaluation version policy and manual promotion.
V2.0  Background evaluation jobs.
V2.1  Persisted calibration report snapshots.
```

V1.5 must complete before V2.0 automation expands evaluation volume.

## Resolved Decisions

- Use a pure append-only promotion event ledger.
- Do not use `active boolean` as source of truth.
- Active source is resolved from the latest promotion/reset event.
- No event means base canonical evaluation is active.
- `promote_rerun` event means the promoted rerun is active.
- `reset_to_base` event means base canonical evaluation is active.
- Promote/reset requires editor access.
- Version policy read requires reader access.
- Promote/reset accepts optional `idempotency_key`.
- Same idempotency key returns existing event.
- Same-state promote/reset returns no-op and does not append an event.
- Promote/reset is blocked if canonical evaluation has `outcome_review_id`.
- Active projection keeps `id = canonical evaluation id`.
- Active projection adds `active_source`, `active_rerun_id`,
  `active_promotion_id`, and `base_evaluation_id`.
- Active resolver applies to:

```text
GET /calibration/evaluations/:id
GET /calibration/symbol
GET /calibration/agents
```

- Raw history remains raw:

```text
GET /calibration/evaluations
GET /calibration/evaluations/:id/reruns
GET /calibration/evaluations/:id/version-policy
```

- Symbol and Agent report rows must expose active source metadata.
- Promotion/reset reuses the V1.3 evaluation audit reason enum:

```text
manual_check
engine_rule_change
market_data_fix
bug_fix_verification
suspected_drift
other
```

- Web UI uses inline 2-step confirmation, consistent with existing batch apply
  confirmation style.

## API Contract

### Get Version Policy

Request:

```text
GET /calibration/evaluations/:id/version-policy
```

Access:

```text
reader
```

Response:

```json
{
  "canonical_evaluation_id": "evaluation_base_abc",
  "active_source": "promoted_rerun",
  "active_rerun_id": "evaluation_rerun_xyz",
  "active_promotion_id": "promotion_123",
  "base_evaluation": {
    "id": "evaluation_base_abc",
    "result": "mixed",
    "max_favorable_excursion": 0.041,
    "max_adverse_excursion": -0.026
  },
  "active_evaluation": {
    "id": "evaluation_base_abc",
    "base_evaluation_id": "evaluation_base_abc",
    "active_source": "promoted_rerun",
    "active_rerun_id": "evaluation_rerun_xyz",
    "active_promotion_id": "promotion_123",
    "result": "hit_target",
    "max_favorable_excursion": 0.052,
    "max_adverse_excursion": -0.013
  },
  "events": [
    {
      "id": "promotion_123",
      "workspace_id": "workspace_a",
      "canonical_evaluation_id": "evaluation_base_abc",
      "promoted_rerun_id": "evaluation_rerun_xyz",
      "action": "promote_rerun",
      "promoted_by_user_id": "user_a",
      "promoted_at": "2026-05-23T08:00:00.000Z",
      "reason": "bug_fix_verification",
      "notes": "Promote rerun after provider data fix.",
      "idempotency_key": "client-key-1"
    }
  ],
  "warnings": []
}
```

Sort events:

```text
promoted_at DESC
id ASC
```

### Promote Rerun

Request:

```text
POST /calibration/evaluations/:id/reruns/:rerun_id/promote
```

Access:

```text
editor
```

Body:

```json
{
  "reason": "bug_fix_verification",
  "notes": "Promote rerun after provider data fix.",
  "idempotency_key": "client-key-1"
}
```

Response when event is appended:

```json
{
  "created": true,
  "event": {
    "id": "promotion_123",
    "canonical_evaluation_id": "evaluation_base_abc",
    "promoted_rerun_id": "evaluation_rerun_xyz",
    "action": "promote_rerun",
    "reason": "bug_fix_verification"
  },
  "policy": {},
  "warnings": []
}
```

Response when idempotency key matches existing event:

```json
{
  "created": false,
  "event": {},
  "policy": {},
  "warnings": ["promotion_already_exists"]
}
```

Response when rerun is already active:

```json
{
  "created": false,
  "event": null,
  "policy": {},
  "warnings": ["promotion_already_active"]
}
```

### Reset To Base

Request:

```text
POST /calibration/evaluations/:id/version-policy/reset
```

Access:

```text
editor
```

Body:

```json
{
  "reason": "manual_check",
  "notes": "Return to base canonical evaluation.",
  "idempotency_key": "client-key-2"
}
```

Response when event is appended:

```json
{
  "created": true,
  "event": {
    "id": "promotion_124",
    "canonical_evaluation_id": "evaluation_base_abc",
    "promoted_rerun_id": null,
    "action": "reset_to_base",
    "reason": "manual_check"
  },
  "policy": {},
  "warnings": []
}
```

Response when base is already active:

```json
{
  "created": false,
  "event": null,
  "policy": {},
  "warnings": ["base_already_active"]
}
```

## Data Model

Add a promotion/audit event table.

Suggested Prisma model:

```prisma
model ThesisEvaluationPromotion {
  id                    String   @id
  workspaceId           String   @default("local") @map("workspace_id")
  canonicalEvaluationId String   @map("canonical_evaluation_id")
  promotedRerunId       String?  @map("promoted_rerun_id")
  action                String
  promotedByUserId      String?  @map("promoted_by_user_id")
  promotedAt            DateTime @map("promoted_at") @db.Timestamptz(6)
  reason                String
  notes                 String?
  idempotencyKey        String?  @map("idempotency_key")
  payloadJson           Json     @map("payload_json")

  canonicalEvaluation ThesisEvaluation    @relation(fields: [canonicalEvaluationId], references: [id])
  promotedRerun       ThesisEvaluationRun? @relation(fields: [promotedRerunId], references: [id])

  @@index([workspaceId, canonicalEvaluationId, promotedAt(sort: Desc)], map: "idx_thesis_evaluation_promotions_evaluation")
  @@map("thesis_evaluation_promotions")
}
```

If the repo's raw SQL schema supports partial unique indexes, add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_evaluation_promotions_idempotency
ON thesis_evaluation_promotions (workspace_id, canonical_evaluation_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
```

Do not use an `active` column as source of truth.

## Repository Methods

Add repository methods:

```text
listThesisEvaluationPromotions(canonicalEvaluationId, limit, workspaceId)
getThesisEvaluationPromotionByIdempotencyKey(canonicalEvaluationId, idempotencyKey, workspaceId)
createThesisEvaluationPromotion(input, workspaceId)
getLatestThesisEvaluationPromotion(canonicalEvaluationId, workspaceId)
```

Existing methods reused:

```text
getThesisEvaluation(id, workspaceId)
listThesisEvaluationRuns({ canonicalEvaluationId }, workspaceId)
```

If a direct rerun read method is missing, add:

```text
getThesisEvaluationRun(id, workspaceId)
```

## Active Evaluation Resolver

Add one internal resolver:

```text
resolveActiveEvaluation(canonical_evaluation_id, workspace_id)
```

No event:

```text
return base canonical projection
active_source = base_canonical
active_rerun_id = null
active_promotion_id = null
```

Latest `reset_to_base` event:

```text
return base canonical projection
active_source = base_canonical
active_rerun_id = null
active_promotion_id = latest_event.id
```

Latest `promote_rerun` event:

```text
load promoted rerun
return canonical identity with rerun values
active_source = promoted_rerun
active_rerun_id = promoted_rerun.id
active_promotion_id = latest_event.id
```

Projection fields:

```text
id = canonical evaluation id
base_evaluation_id = canonical evaluation id
workspace_id
thesis_id
outcome_review_id from canonical
symbol
window_days
evaluation_start
evaluation_end
evaluated_at from active source
result from active source
max_favorable_excursion from active source
max_adverse_excursion from active source
invalidated from active source
warnings from active source
evidence from active source
payload from active source
calendar_mature
can_record_review
record_review_blockers
active_source
active_rerun_id
active_promotion_id
```

`outcome_review_id` remains canonical. V1.5 does not attach OutcomeReview to a
rerun.

## Safety Rules

Block promote/reset when:

```text
canonical evaluation not found
canonical evaluation has outcome_review_id
```

Block promote when:

```text
rerun not found
rerun belongs to another canonical evaluation
rerun status is not completed
```

Blocker strings:

```text
review_already_recorded
rerun_not_found
rerun_not_completed
rerun_mismatch
```

Same-state no-op warnings:

```text
promotion_already_active
base_already_active
```

Idempotency warning:

```text
promotion_already_exists
```

## Report Integration

Apply active resolver to:

```text
GET /calibration/symbol
GET /calibration/agents
```

Rows must expose:

```text
evaluation_id = canonical evaluation id
base_evaluation_id
active_source
active_rerun_id
active_promotion_id
```

Required row types:

```text
SymbolCalibrationRowResponse
AgentCalibrationRowResponse
```

Optional if cheap:

```text
active_source_counts in coverage summary
```

Do not project:

```text
GET /calibration/evaluations
GET /calibration/evaluations/:id/reruns
GET /calibration/evaluations/:id/version-policy
```

## DTOs And Types

Reuse V1.3 audit reasons when practical.

If renaming is low-risk, prefer:

```text
EVALUATION_AUDIT_REASONS
EvaluationAuditReason
```

If renaming creates broad churn, export the existing V1.3 reason enum and reuse
it for V1.5.

New response types:

```text
CalibrationEvaluationActiveSource = base_canonical | promoted_rerun
CalibrationEvaluationPromotionAction = promote_rerun | reset_to_base
CalibrationEvaluationPromotionResponse
CalibrationEvaluationVersionPolicyResponse
PromoteCalibrationEvaluationResponse
```

## UI UX

Add to existing Rerun Audit section:

```text
Active source badge
Version policy summary
Promote completed rerun button
Reset to base button when promoted
Promotion history list
```

Inline 2-step confirmation:

```text
First click arms action.
Second click submits.
Changing selected evaluation or rerun clears armed state.
```

Promotion copy:

```text
Promote rerun as active source
This changes Calibration Lab reports for this evaluation. It does not rewrite
the base evaluation, rerun audit history, or outcome reviews.
```

Reset copy:

```text
Reset to base evaluation
This changes Calibration Lab reports back to the base canonical evaluation.
```

Disable promote/reset when:

```text
canonical has outcome_review_id
rerun failed
mutation pending
same-state no-op
```

## Relevant Context

Current repo facts:

- V1.3 rerun audit is implemented with `thesis_evaluation_runs`.
- V1.4 Agent Calibration is implemented with `GET /calibration/agents`.
- `OutcomeReview` links to canonical `ThesisEvaluation`.
- Symbol and Agent Calibration currently read canonical `ThesisEvaluation`
  values.
- Existing dirty worktree changes may exist. Preserve unrelated changes.

Files to inspect first:

```text
docs/features/calibration-lab/v1.3/implementation-plan.md
docs/features/calibration-lab/v1.4/implementation-plan.md
packages/database/prisma/schema.prisma
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/evaluation-rerun.dto.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/database/postgres-schema.sql
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Likely files to change:

```text
packages/database/prisma/schema.prisma
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/evaluation-version-policy.dto.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/database/postgres-schema.sql
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Python files should not change for V1.5.

## Implementation Checklist

- [ ] Add promotion event schema/table.
- [ ] Add partial unique idempotency index in raw SQL if supported.
- [ ] Add repository types and methods for promotions.
- [ ] Add direct rerun read method if missing.
- [ ] Add DTO for promote/reset body.
- [ ] Add contract response types and mappers.
- [ ] Add OpenAPI entries for version policy, promote, and reset.
- [ ] Implement latest-event active policy resolver.
- [ ] Implement active evaluation projection.
- [ ] Update `GET /calibration/evaluations/:id` to return active projection.
- [ ] Update Symbol Calibration to use active values and row source metadata.
- [ ] Update Agent Calibration to use active values and row source metadata.
- [ ] Add controller routes.
- [ ] Add web service/query key/type support.
- [ ] Add Version Policy controls inside Rerun Audit section.
- [ ] Add inline 2-step confirmation for promote/reset.
- [ ] Add focused API contract tests.
- [ ] Run validation commands.

## Required Tests

API contract tests:

- [ ] `GET /calibration/evaluations/:id/version-policy` returns base policy when
      no events exist.
- [ ] Promoting a completed rerun appends a promotion event.
- [ ] Resetting to base appends a reset event.
- [ ] Latest event wins.
- [ ] Duplicate idempotency key returns existing event.
- [ ] Same-state promote returns no-op with `promotion_already_active`.
- [ ] Same-state reset returns no-op with `base_already_active`.
- [ ] Promotion is workspace scoped.
- [ ] Promotion is blocked for missing rerun.
- [ ] Promotion is blocked for failed rerun.
- [ ] Promotion is blocked for rerun belonging to another evaluation.
- [ ] Promote/reset is blocked when `outcome_review_id` exists.
- [ ] Active projection keeps canonical id and adds source metadata.
- [ ] `GET /calibration/evaluations/:id` returns active projection.
- [ ] Raw evaluation list remains canonical/raw.
- [ ] Raw rerun list remains raw.
- [ ] Symbol Calibration uses promoted rerun values.
- [ ] Symbol Calibration rows expose active source metadata.
- [ ] Agent Calibration uses promoted rerun values.
- [ ] Agent Calibration rows expose active source metadata.
- [ ] Viewer can read policy but cannot promote/reset.

Web:

- [ ] Typecheck passes.
- [ ] Active source badge renders.
- [ ] Promotion history renders.
- [ ] Promote action has inline 2-step confirmation.
- [ ] Reset action has inline 2-step confirmation.
- [ ] Reviewed evaluations disable promote/reset.
- [ ] Symbol/Agent rows can display active source metadata without layout
      breakage.

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

- Load one evaluation with completed rerun history.
- Confirm active source starts as base canonical.
- Promote a completed rerun.
- Confirm active source badge changes to promoted rerun.
- Confirm `GET /calibration/evaluations/:id` values reflect promoted rerun while
  id remains canonical.
- Confirm Symbol Calibration report uses promoted result and row metadata.
- Confirm Agent Calibration report uses promoted result and row metadata.
- Reset to base.
- Confirm reports revert to base canonical.
- Attempt promote/reset on reviewed evaluation and confirm blocker.

## Checkpoint Behavior

Work milestone by milestone:

1. Schema/repository/contracts.
2. Active policy resolver and projection.
3. Promote/reset service behavior.
4. Symbol/Agent report integration.
5. Controller routes and API tests.
6. Web service/types/query keys.
7. Rerun Audit UI version-policy controls.
8. Validation and manual smoke.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving forward;
- preserve unrelated dirty worktree changes;
- do not expand into OutcomeReview replacement, batch promotion, scheduler,
  charts, or report snapshots.

## Stop Rules

Stop and report instead of expanding scope when:

- manual promotion/reset policy is complete;
- implementation would require OutcomeReview replacement;
- implementation would require batch or automatic promotion;
- implementation would require scheduler/background jobs;
- implementation would require new evaluation scoring semantics;
- active evaluation semantics cannot be implemented without a broad rewrite.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/calibration-lab/v1.5/implementation-plan.md first and treat
it as the source of truth for Calibration Lab V1.5.

Implement only the V1.5 manual evaluation version policy. Use a pure append-only
promotion event ledger, resolve active source from the latest promotion/reset
event, keep canonical evaluation id stable in active projections, and apply the
active resolver to evaluation detail, Symbol Calibration, and Agent Calibration.

Do not implement automatic promotion, batch promotion, scheduler/background
jobs, OutcomeReview replacement or mutation, new scoring semantics, charts,
exports, subscriptions, or report snapshots.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, repository, contract, React Query, routing, and CSS
patterns. Preserve unrelated dirty worktree changes.

Ask grill-me questions only if a decision is not covered by the plan or if the
codebase contradicts the plan.
```

## Definition Of Done

- `GET /calibration/evaluations/:id/version-policy` returns active policy and
  event history.
- `POST /calibration/evaluations/:id/reruns/:rerun_id/promote` promotes a
  completed rerun when safe.
- `POST /calibration/evaluations/:id/version-policy/reset` resets to base when
  safe.
- Active projection keeps canonical evaluation id and exposes source metadata.
- Evaluation detail, Symbol Calibration, and Agent Calibration use active
  evaluation values.
- Raw evaluation/rerun history remains raw.
- Promote/reset is idempotent and no-op safe.
- Reviewed evaluations block promote/reset.
- Web UI exposes active source, promotion history, promote, and reset controls.
- Focused API tests and web typecheck pass, or blockers are documented.
