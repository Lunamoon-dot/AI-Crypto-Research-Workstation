# Calibration Lab V1.3 Implementation Plan

Last updated: 2026-05-22  
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1.3 end-to-end.

Read this document first:
docs/features/calibration-lab/v1.3/implementation-plan.md

Objective:
- Add manual single-evaluation rerun audit for Calibration Lab. A user can rerun
  one existing canonical ThesisEvaluation, store the rerun attempt as append-only
  audit history, compare it with the canonical evaluation, and inspect rerun
  history from the existing Calibration Lab single/evaluation view.

Required behavior:
- POST /calibration/evaluations/:id/reruns runs a manual audit rerun for one
  existing evaluation id.
- GET /calibration/evaluations/:id/reruns lists rerun audit records for that
  evaluation id.
- Rerun audit records are stored append-only in a new table.
- Rerun does not overwrite or promote the canonical ThesisEvaluation row.
- POST requires editor access; GET requires reader access.
- POST requires a reason enum, accepts optional notes, and accepts optional
  idempotency_key.
- If the same workspace/evaluation/idempotency_key already exists, return the
  existing rerun record and do not call the Python engine again.
- Completed reruns store engine output, normalized evaluation fields, and a
  minimal deterministic diff against the canonical evaluation.
- Failed rerun attempts are also stored as audit records when possible, while
  the API still returns a clear error to the caller.
- The web UI adds an embedded Rerun Audit section to the existing Calibration Lab
  single/evaluation view.

Do not implement:
- Batch rerun.
- Automatic rerun.
- Scheduler/background queue/retry worker.
- Auto-promote or replace current/canonical evaluations.
- OutcomeReview creation or mutation from reruns.
- Symbol Calibration semantic changes.
- Agent Calibration.
- LLM parsing or LLM-assisted diffing.
- Full payload JSON diff.
- Charts, export, subscription/paywall logic, or broad analytics dashboards.

Definition of done:
- The API can create and list rerun audit records for an existing evaluation.
- Canonical ThesisEvaluation behavior remains unchanged for V1/V1.1/V1.2.
- Idempotent rerun requests do not double-call the engine.
- Failed attempts are visible in audit history.
- The web UI exposes reason/notes controls, a rerun action, and a compact
  history list.
- Focused API tests and web typecheck pass, or exact blockers are documented.
```

## One Outcome

Add manual single-evaluation rerun audit.

V1.3 answers:

```text
If I rerun this existing evaluation now, does the result change, and why was the
rerun performed?
```

It is an audit layer. It is not a replacement policy.

## Version Placement

```text
V1    Manual single-thesis evaluation.
V1.1  Batch matured evaluation: preview -> explicit bounded apply.
V1.2  Symbol Calibration MVP: read-only aggregate by symbol/window/lookback.
V1.3  Manual single-evaluation rerun audit.
V1.4  Agent Calibration MVP.
V2.0  Background jobs, scheduler, progress, retry queue.
V2.1  Persisted calibration reports / snapshots.
V2.x  Charts, historical replay, LLM stance parsing, and deeper analytics.
```

V1.3 must not absorb V1.4 or V2 work.

## Resolved Decisions

- V1.3 uses an append-only rerun audit table.
- V1.3 does not change the meaning of `thesis_evaluations`.
- Existing `ThesisEvaluation` rows remain the canonical/current evaluation.
- Rerun starts only from an existing canonical evaluation id.
- Rerun calls the Python engine for a single explicit user action.
- Rerun does not upsert into `thesis_evaluations`.
- Rerun does not auto-promote, replace, or mark a rerun as current.
- Rerun does not create or mutate `OutcomeReview`.
- Failed rerun attempts are stored when possible.
- POST requires editor permission.
- GET requires reader permission.
- `reason` is required.
- `notes` is optional.
- `idempotency_key` is optional.
- Diff is minimal and deterministic.
- UI is embedded inside the existing Calibration Lab single/evaluation view.
- No new standalone route/page is required for V1.3 UI.

## API Contract

### Create Rerun

Request:

```text
POST /calibration/evaluations/:id/reruns
```

Body:

```json
{
  "reason": "manual_check",
  "notes": "Verify after evaluation rule changes.",
  "idempotency_key": "f610f61f-8dcb-404f-a3fb-fd872f6a36d1"
}
```

Allowed `reason` values:

```text
manual_check
engine_rule_change
market_data_fix
bug_fix_verification
suspected_drift
other
```

Response on completed rerun:

```json
{
  "created": true,
  "rerun": {
    "id": "evaluation_rerun_abc",
    "workspace_id": "workspace_a",
    "canonical_evaluation_id": "evaluation_abc",
    "thesis_id": "thesis_abc",
    "symbol": "BTC/USDT",
    "window_days": 7,
    "evaluation_start": "2026-05-01",
    "evaluation_end": "2026-05-08",
    "requested_by_user_id": "user_a",
    "requested_at": "2026-05-22T08:00:00.000Z",
    "evaluated_at": "2026-05-22T08:00:03.000Z",
    "source": "calibration_lab_v1_3_rerun",
    "reason": "manual_check",
    "notes": "Verify after evaluation rule changes.",
    "idempotency_key": "f610f61f-8dcb-404f-a3fb-fd872f6a36d1",
    "status": "completed",
    "result": "hit_target",
    "max_favorable_excursion": 0.052,
    "max_adverse_excursion": -0.013,
    "invalidated": false,
    "warnings": [],
    "evidence": {
      "start_price": 100000,
      "end_price": 103000
    },
    "diff": {
      "result_changed": false,
      "canonical_result": "hit_target",
      "rerun_result": "hit_target",
      "mfe_delta": 0,
      "mae_delta": 0,
      "invalidated_changed": false,
      "warnings_added": [],
      "warnings_removed": [],
      "start_price_delta": 0,
      "end_price_delta": 0
    },
    "error_type": null,
    "error_message": null,
    "payload": {}
  },
  "warnings": []
}
```

If `idempotency_key` matches an existing rerun for the same workspace and
canonical evaluation:

```json
{
  "created": false,
  "rerun": {},
  "warnings": ["rerun_already_exists"]
}
```

If the engine fails, the service should attempt to persist a failed rerun record
and then return a clear HTTP error using the repo's existing error pattern. The
failed record must be returned by the list endpoint.

### List Reruns

Request:

```text
GET /calibration/evaluations/:id/reruns?limit=20
```

Response:

```json
[
  {
    "id": "evaluation_rerun_abc",
    "canonical_evaluation_id": "evaluation_abc",
    "thesis_id": "thesis_abc",
    "status": "completed",
    "reason": "manual_check",
    "notes": "Verify after evaluation rule changes.",
    "requested_at": "2026-05-22T08:00:00.000Z",
    "evaluated_at": "2026-05-22T08:00:03.000Z",
    "result": "hit_target",
    "diff": {
      "result_changed": false,
      "mfe_delta": 0,
      "mae_delta": 0,
      "warnings_added": [],
      "warnings_removed": []
    },
    "error_type": null,
    "error_message": null
  }
]
```

Sort:

```text
requested_at DESC
id ASC
```

Default limit:

```text
20
```

Max limit:

```text
50
```

## Database Model

Add a new append-only table. Suggested Prisma model:

```prisma
model ThesisEvaluationRun {
  id                    String   @id
  workspaceId           String   @default("local") @map("workspace_id")
  canonicalEvaluationId String   @map("canonical_evaluation_id")
  thesisId              String   @map("thesis_id")
  symbol                String
  windowDays            Int      @map("window_days")
  evaluationStart       DateTime @map("evaluation_start") @db.Date
  evaluationEnd         DateTime @map("evaluation_end") @db.Date
  requestedByUserId     String?  @map("requested_by_user_id")
  requestedAt           DateTime @map("requested_at") @db.Timestamptz(6)
  evaluatedAt           DateTime? @map("evaluated_at") @db.Timestamptz(6)
  source                String
  reason                String
  notes                 String?
  idempotencyKey        String?  @map("idempotency_key")
  status                String
  result                String?
  maxFavorableExcursion Float?   @map("max_favorable_excursion")
  maxAdverseExcursion   Float?   @map("max_adverse_excursion")
  invalidated           Boolean?
  warningsJson          Json     @default("[]") @map("warnings_json")
  evidenceJson          Json     @default("{}") @map("evidence_json")
  diffJson              Json     @default("{}") @map("diff_json")
  errorType             String?  @map("error_type")
  errorMessage          String?  @map("error_message")
  payloadJson           Json     @map("payload_json")

  canonicalEvaluation ThesisEvaluation @relation(fields: [canonicalEvaluationId], references: [id])
  thesis              TradeThesis       @relation(fields: [thesisId], references: [id])

  @@index([workspaceId, canonicalEvaluationId, requestedAt(sort: Desc)], map: "idx_thesis_evaluation_runs_evaluation")
  @@index([workspaceId, thesisId, requestedAt(sort: Desc)], map: "idx_thesis_evaluation_runs_thesis")
  @@map("thesis_evaluation_runs")
}
```

If the repo's migration pattern supports raw SQL, add a partial unique index for
idempotency:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_thesis_evaluation_runs_idempotency
ON thesis_evaluation_runs (workspace_id, canonical_evaluation_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
```

If partial indexes are not available through the current migration path, use an
application-level lookup before insert and document the residual race risk.

## Data Rules

Canonical evaluation:

```text
thesis_evaluations row loaded by :id and workspace
```

Rerun context:

```text
thesis_id         = canonical.thesis_id
window_days       = canonical.window_days
evaluation_start  = canonical.evaluation_start
evaluation_end    = canonical.evaluation_end
symbol            = canonical.symbol
```

Python engine request:

```json
{
  "thesis_id": "thesis_abc",
  "workspace_id": "workspace_a",
  "window_days": 7,
  "metadata": {
    "source": "calibration_lab_v1_3_rerun",
    "canonical_evaluation_id": "evaluation_abc",
    "rerun_reason": "manual_check"
  }
}
```

Do not persist the engine result through `upsertThesisEvaluation`.

## Diff Rules

Compare only these fields:

```text
result
max_favorable_excursion
max_adverse_excursion
invalidated
warnings
evidence.start_price
evidence.end_price
```

Diff output:

```json
{
  "result_changed": true,
  "canonical_result": "hit_target",
  "rerun_result": "mixed",
  "mfe_delta": -0.012,
  "mae_delta": 0.006,
  "invalidated_changed": false,
  "warnings_added": ["missing_target_price"],
  "warnings_removed": [],
  "start_price_delta": 0,
  "end_price_delta": -0.003
}
```

Rules:

- Missing numeric values produce `null` deltas.
- Warning comparison is set-based and sorted for stable output.
- Do not compute full JSON diff.
- Do not use LLM to interpret differences.
- Preserve raw engine output in `payload_json` for later debugging.

## UI UX

Route remains:

```text
/calibration
```

No new standalone rerun route/page in V1.3.

Add an embedded section to the existing single/evaluation workflow:

```text
Rerun Audit
```

Controls:

- reason select;
- optional notes textarea/input;
- Run audit rerun button;
- loading/disabled state while POST is in flight.

History list:

```text
requested_at
reason
status
result canonical -> rerun
MFE delta
MAE delta
changed / unchanged badge
warnings added/removed
error message for failed attempts
```

Recommended UI behavior:

- Load rerun history after an evaluation is available.
- Refetch history after a completed rerun.
- Generate a fresh `idempotency_key` per button click and reuse it for client
  retry of the same mutation.
- Do not automatically rerun when the page loads.
- Do not show rerun audit controls before an evaluation exists.

## Relevant Context

Current repo facts:

- V1 persists canonical `ThesisEvaluation` rows.
- V1.1 batch evaluation uses the canonical natural key and does not create
  duplicate canonical evaluations.
- V1.2 Symbol Calibration reads canonical `ThesisEvaluation` rows only.
- Existing `ThesisEvaluation` unique key should remain unchanged in V1.3.
- `OutcomeReview` links to canonical `ThesisEvaluation`.
- Python engine already supports `engine evaluate --request`.
- Existing dirty worktree changes may exist. Preserve unrelated changes.

Files to inspect first:

```text
docs/features/calibration-lab/v1.2/implementation-plan.md
packages/database/prisma/schema.prisma
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/*.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
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
apps/api/src/calibration/dto/evaluation-rerun.dto.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Python files should not change for V1.3 unless the existing engine command lacks
the needed evaluation payload.

## Implementation Checklist

- [ ] Add `ThesisEvaluationRun` schema/table.
- [ ] Add repository types for rerun create/list/idempotency lookup.
- [ ] Add Postgres repository methods.
- [ ] Add in-memory test repository support in `api-contract.test.ts`.
- [ ] Add DTO for rerun creation.
- [ ] Add contract response types and mappers.
- [ ] Add OpenAPI route/schema entries if following repo pattern.
- [ ] Add `POST /calibration/evaluations/:id/reruns`.
- [ ] Add `GET /calibration/evaluations/:id/reruns`.
- [ ] Implement editor permission for POST and reader permission for GET.
- [ ] Implement idempotency lookup before engine call.
- [ ] Call Python engine with canonical thesis/window context.
- [ ] Persist completed rerun records without touching canonical evaluations.
- [ ] Persist failed rerun attempts when possible.
- [ ] Compute minimal deterministic diff.
- [ ] Add web service/query key/type support.
- [ ] Add embedded Rerun Audit section to the Calibration Lab single/evaluation
      view.
- [ ] Add focused API contract tests.
- [ ] Run validation commands.

## Required Tests

API contract tests:

- [ ] `GET /calibration/evaluations/:id/reruns` returns reruns for the requested
      evaluation only.
- [ ] `GET` is workspace scoped.
- [ ] `POST` requires an existing evaluation id.
- [ ] `POST` requires valid `reason`.
- [ ] `POST` calls the engine and persists a completed rerun record.
- [ ] `POST` does not mutate or replace the canonical evaluation.
- [ ] `POST` computes result/MFE/MAE/invalidated/warnings/price diff.
- [ ] `POST` with duplicate idempotency key returns the existing rerun and does
      not call the engine again.
- [ ] Failed engine response persists a failed rerun attempt when possible.
- [ ] Rerun list sorting and limit behavior are stable.

Web:

- [ ] Typecheck passes.
- [ ] Rerun Audit section renders only after an evaluation is available.
- [ ] Mutation types and query keys are valid.

Python:

- [ ] No Python tests required unless Python files are touched.

## Validation Loop

Run:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Open `/calibration`.
- Evaluate or load a single thesis evaluation.
- Confirm Rerun Audit section appears after evaluation exists.
- Run a rerun with reason `manual_check`.
- Confirm history shows completed attempt and diff.
- Refresh the page and confirm history persists.
- Trigger/retry the same mutation idempotency key if practical and confirm no
  duplicate engine call.
- Confirm Symbol Calibration output is unchanged by rerun audit records.

## Checkpoint Behavior

Work milestone by milestone:

1. Schema/repository/contracts.
2. Service create/list rerun behavior.
3. Diff and idempotency logic.
4. Controller routes and API tests.
5. Web service/types/query keys.
6. Embedded Rerun Audit UI.
7. Validation and manual smoke.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving forward;
- preserve unrelated dirty worktree changes;
- do not expand into batch rerun, promotion policy, scheduler, charts, or agent
  calibration.

## Stop Rules

Stop and report instead of expanding scope when:

- manual single-evaluation rerun audit is complete;
- implementation would require batch jobs, scheduler, retry workers, promotion
  policy, OutcomeReview redesign, Symbol Calibration semantic changes, Agent
  Calibration, LLM parsing, charts, exports, or subscription logic;
- repository support is insufficient without a broad data-access rewrite;
- Python engine does not return enough evaluation payload to persist a rerun;
- validation fails for external/environment reasons;
- existing code contradicts this plan in a way that affects audit semantics.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/calibration-lab/v1.3/implementation-plan.md first and treat
it as the source of truth for Calibration Lab V1.3.

Implement only the V1.3 Manual Single-Evaluation Rerun Audit. It must be
append-only, start from an existing canonical evaluation id, call the Python
engine only for explicit single reruns, store completed and failed attempts, and
compute a minimal deterministic diff.

Do not overwrite/promote canonical ThesisEvaluation rows, do not mutate
OutcomeReview, do not change Symbol Calibration semantics, do not add batch
rerun, scheduler/background jobs, agent calibration, LLM parsing, charts, export,
or subscription logic.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, repository, contract, React Query, routing, and CSS
patterns. Preserve unrelated dirty worktree changes.

Ask grill-me questions only if a decision is not covered by the plan or if the
codebase contradicts the plan.
```

## Definition Of Done

- `POST /calibration/evaluations/:id/reruns` creates a manual audit rerun.
- `GET /calibration/evaluations/:id/reruns` lists rerun history.
- Rerun audit records are append-only and include completed and failed attempts.
- Canonical `ThesisEvaluation` rows remain unchanged by reruns.
- Idempotent POST behavior prevents duplicate engine calls for the same key.
- Minimal diff is stored and returned.
- `/calibration` shows an embedded Rerun Audit section for a loaded evaluation.
- Focused API tests and web typecheck pass, or blockers are documented.
