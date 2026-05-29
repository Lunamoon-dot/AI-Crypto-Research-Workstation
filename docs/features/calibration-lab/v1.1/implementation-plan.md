# Calibration Lab V1.1 Implementation Plan

Last updated: 2026-05-21  
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1.1 end-to-end.

Read this document first:
docs/features/calibration-lab/v1.1/implementation-plan.md

Objective:
- Add batch matured thesis evaluation to Calibration Lab using an explicit
  preview -> apply workflow that creates or reuses ThesisEvaluation rows without
  recording OutcomeReview rows.

Required behavior:
- /calibration shows a compact batch matured evaluations panel above the
  existing single-thesis workflow.
- POST /calibration/evaluations/matured/preview scans saved theses and returns
  candidate/existing/not_mature/invalid_thesis rows with summary counts.
- POST /calibration/evaluations/matured/apply recomputes candidates server-side,
  processes only eligible candidates up to max_batch, and returns per-row
  created/existing/skipped/failed results.
- Batch apply is idempotent, bounded, workspace-scoped, and supports an optional
  exact normalized symbol filter.
- Partial row failures do not fail the whole valid batch request.

Do not implement:
- OutcomeReview auto-recording.
- Force rerun or re-evaluate policy.
- Background jobs, scheduler, progress polling, retry queue, or dead-letter UI.
- New route page, modal-heavy workflow, charts, historical replay, export, or
  calibration analytics.
- Provider/exchange selection.
- Trading/order execution, broker PnL, Sharpe, alpha, or guaranteed-performance
  language.

Definition of done:
- Preview and apply endpoints are covered by focused API contract tests.
- The web page exposes the batch panel and typechecks.
- Re-running apply does not duplicate ThesisEvaluation rows.
- Existing evaluations are shown/reused, not re-run.
- Row-level engine/provider failures are reported without rolling back other
  successful rows.
- Validation commands pass, or exact blockers are documented.
```

## One Outcome

Add a bounded batch workflow for matured thesis evaluation.

V1.1 should reduce repetitive manual evaluation work without changing the
meaning of review/performance data. It creates machine evaluation artifacts
only. It does not promote those artifacts into official outcome reviews.

## Version Placement

```text
V1    Manual single-thesis evaluation.
V1.1  Batch matured evaluation: preview -> apply bounded batch.
V1.2  Symbol Calibration MVP: read-only aggregate by symbol/window/lookback.
V1.3  Evaluation versioning / rerun audit.
V1.4  Agent Calibration MVP.
V2.0  Background jobs, scheduler, progress, retry queue.
V2.1  Persisted calibration reports / snapshots.
V2.x  Charts, historical replay, LLM stance parsing, and deeper analytics.
```

V1.1 must stay inside the batch preview/apply boundary.

## Resolved Decisions

- V1.1 uses the existing `/calibration` route.
- Add the batch panel at the top of `/calibration`, immediately below the page
  header and above the single-thesis picker/history.
- Add two API routes:

```text
POST /calibration/evaluations/matured/preview
POST /calibration/evaluations/matured/apply
```

- Preview does not call the Python engine.
- Apply calls the existing single-thesis engine evaluation path per selected
  row.
- Apply recomputes candidates server-side. It does not accept a client-provided
  `thesis_ids` list in V1.1.
- Default `window_days` is `14`.
- Valid windows remain `7`, `14`, and `30`.
- Preview `scan_limit` default is `100`.
- Preview `scan_limit` hard cap is `500`.
- Apply `max_batch` default is `10`.
- Apply `max_batch` hard cap is `25`.
- Optional `symbol` filter is supported.
- Symbol matching is exact after using the repo's existing symbol normalization
  conventions where available.
- No fuzzy search, multi-symbol filter, or provider/market selector in V1.1.
- Candidate ordering is stable:

```text
evaluation_end ASC
created_at ASC
thesis_id ASC
```

- Existing evaluations appear in preview but are not re-run.
- No `force_rerun` in V1.1.
- Apply partial failures are row-level, not request-level.
- Valid batch requests return HTTP 200 even when individual rows fail.
- Apply does not rollback successful rows if another row fails.
- OutcomeReview remains manual and explicit through the V1 detail/review flow.
- Batch responses return compact rows, not full raw evidence/payload JSON.
- Apply requires lightweight confirmation in the UI.

## Matured Thesis Definition

A thesis is mature for batch evaluation when:

```text
evaluation_start = date(thesis.created_at)
evaluation_end   = evaluation_start + window_days
evaluation_end   < today_utc
```

Use `< today_utc`, not `<= now`, so batch avoids same-day partial candle/provider
freshness problems.

Additional eligibility requirements:

- thesis belongs to the active workspace;
- thesis has an id;
- thesis has valid `created_at`;
- thesis has a symbol;
- `window_days` is one of `7`, `14`, or `30`;
- no existing ThesisEvaluation exists for the same natural key.

Existing ThesisEvaluation natural key:

```text
workspace_id + thesis_id + window_days + evaluation_start + evaluation_end
```

Maturity and recordability are intentionally separate:

```text
matured   = old enough to evaluate
recordable = evaluation result is usable and no review exists
```

## API Contract

Preview request:

```json
{
  "window_days": 14,
  "scan_limit": 100,
  "symbol": "BTC/USDT"
}
```

`symbol` is optional.

Preview response:

```json
{
  "window_days": 14,
  "scan_limit": 100,
  "symbol": "BTC/USDT",
  "summary": {
    "candidate": 8,
    "existing": 3,
    "not_mature": 12,
    "invalid_thesis": 1
  },
  "rows": [
    {
      "thesis_id": "thesis_1",
      "symbol": "BTC/USDT",
      "created_at": "2026-05-01T08:15:00.000Z",
      "window_days": 14,
      "evaluation_start": "2026-05-01",
      "evaluation_end": "2026-05-15",
      "status": "candidate",
      "reason": null,
      "evaluation_id": null
    }
  ]
}
```

Apply request:

```json
{
  "window_days": 14,
  "max_batch": 10,
  "symbol": "BTC/USDT"
}
```

`symbol` is optional.

Apply response:

```json
{
  "window_days": 14,
  "max_batch": 10,
  "symbol": "BTC/USDT",
  "summary": {
    "created": 7,
    "existing": 2,
    "skipped": 15,
    "failed": 1
  },
  "rows": [
    {
      "thesis_id": "thesis_1",
      "symbol": "BTC/USDT",
      "created_at": "2026-05-01T08:15:00.000Z",
      "window_days": 14,
      "evaluation_start": "2026-05-01",
      "evaluation_end": "2026-05-15",
      "status": "created",
      "reason": null,
      "evaluation_id": "eval_1",
      "result": "hit_target",
      "warnings": [],
      "message": null
    },
    {
      "thesis_id": "thesis_2",
      "symbol": "BTC/USDT",
      "created_at": "2026-05-02T09:00:00.000Z",
      "window_days": 14,
      "evaluation_start": "2026-05-02",
      "evaluation_end": "2026-05-16",
      "status": "failed",
      "reason": "provider_error",
      "evaluation_id": null,
      "result": null,
      "warnings": [],
      "message": "Provider returned no candles"
    }
  ]
}
```

HTTP behavior:

```text
200 = valid batch request, even with per-row failures
400 = invalid request shape/window/max_batch/scan_limit
401/403 = auth/workspace issue
503 = required backend capability missing
```

## Row Statuses And Reasons

Preview statuses:

```text
candidate
existing
not_mature
invalid_thesis
```

Apply statuses:

```text
created
existing
failed
skipped
```

Reasons:

```text
evaluation_already_exists
window_not_closed
missing_created_at
invalid_created_at
missing_symbol
engine_error
provider_error
unknown_error
max_batch_excluded
```

Mapping:

```text
candidate              -> no reason
existing               -> evaluation_already_exists
not_mature             -> window_not_closed
invalid_thesis         -> missing_created_at | invalid_created_at | missing_symbol
skipped after cap      -> max_batch_excluded
failed during engine   -> engine_error | provider_error | unknown_error
```

## Relevant Context

Current repo facts:

- V1 already added `ThesisEvaluation` persistence and idempotent single-thesis
  evaluation.
- V1 already added `lunacrypto engine evaluate --request`.
- V1 already added `/calibration`, evaluation history/detail, and manual outcome
  review recording.
- Existing dirty worktree changes may exist. Preserve unrelated changes.

Files to inspect first:

```text
docs/features/calibration-lab/v1/implementation-plan.md
packages/database/prisma/schema.prisma
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/evaluate-thesis.dto.ts
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

Python files should not need changes unless the existing V1 engine contract is
insufficient.

## Implementation Checklist

- [ ] Add V1.1 DTOs for preview/apply requests.
- [ ] Add V1.1 response types and mappers to the frontend contract.
- [ ] Add OpenAPI entries if following the repo's generated contract pattern.
- [ ] Add repository support for listing thesis candidates with optional exact
      symbol filter and scan limit.
- [ ] Add repository/natural-key reads needed for existing evaluation detection.
- [ ] Add `previewMaturedEvaluations` service logic.
- [ ] Add `applyMaturedEvaluations` service logic.
- [ ] Ensure apply recomputes candidates server-side and uses stable ordering.
- [ ] Ensure apply creates only candidate rows up to `max_batch`.
- [ ] Ensure rows excluded by `max_batch` return `skipped/max_batch_excluded`.
- [ ] Ensure existing rows return `existing/evaluation_already_exists`.
- [ ] Ensure per-row engine/provider errors return `failed` rows without failing
      the entire valid request.
- [ ] Add controller routes.
- [ ] Add web service functions and query keys.
- [ ] Add compact batch panel to `CalibrationLabPage`.
- [ ] Add lightweight confirmation before apply.
- [ ] Refetch preview/history after apply.
- [ ] Add focused API contract tests.
- [ ] Run validation commands.

## Web UX

Route remains:

```text
/calibration
```

Page structure:

```text
Calibration Lab
[Batch matured evaluations panel]
[Single thesis evaluation panel]
[Evaluation history/detail]
```

Batch panel controls:

- window selector: `7d`, `14d`, `30d`, default `14d`;
- optional exact symbol input;
- preview button;
- apply button disabled until preview has candidates;
- lightweight confirmation before apply.

Recommended confirmation behavior:

```text
Preview first.
Apply disabled if candidate count = 0.
First click arms confirmation.
Second click sends apply.
Changing window/symbol/preview result clears confirmation.
After apply, clear confirmation and refetch preview/history.
```

Batch panel output:

- summary chips for `candidate`, `existing`, `not_mature`, `invalid_thesis`,
  `created`, `failed`, and `skipped` when relevant;
- compact rows with fixed-height or scrollable table;
- no raw JSON for every batch row;
- selecting/opening a row with an `evaluation_id` may reuse the existing V1
  inline detail/history behavior if cheap.

Copy rules:

- Use "evaluate", "batch", "matured", "calibration", and "thesis quality".
- Keep copy focused on evidence, matured outcomes, calibration, and thesis quality.

## Validation Loop

Run:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

If Python engine files are touched accidentally or contract behavior changes:

```bash
cd apps/ai-service
..\..\.venv\Scripts\python.exe -m pytest tests/test_engine_contract.py tests/test_evaluation_window_guard.py
```

Manual checks:

- Open `/calibration`.
- Confirm the batch panel is above the single-thesis workflow.
- Preview the default 14d window.
- Confirm existing evaluations are shown but not re-run.
- Confirm apply requires confirmation.
- Apply with a small max batch.
- Confirm created rows appear in evaluation history.
- Re-run apply and confirm no duplicates are created.
- Confirm symbol filter only includes exact normalized symbol matches.
- Confirm partial failures render as failed rows without hiding successes.

## Required Tests

API contract tests:

- [ ] Preview marks `candidate`, `existing`, `not_mature`, and
      `invalid_thesis`.
- [ ] Apply creates only candidates up to `max_batch`.
- [ ] Apply skips existing rows and rows excluded by `max_batch`.
- [ ] Apply returns failed rows without failing the whole request.
- [ ] Apply is idempotent on repeat.
- [ ] Symbol filter is exact and workspace-scoped.

Web:

- [ ] Typecheck passes.

Python:

- [ ] No new Python tests required unless the engine contract changes.

## Checkpoint Behavior

Work milestone by milestone:

1. API DTO/contract shape.
2. Repository candidate listing and existing-evaluation detection.
3. Service preview/apply behavior.
4. Controller routes and API tests.
5. Web batch panel.
6. Validation and manual smoke.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving forward;
- do not expand into V1.2/V2 features;
- keep a short progress note;
- preserve unrelated dirty worktree changes.

## Stop Rules

Stop and report instead of expanding scope when:

- V1.1 preview/apply is complete;
- implementation would require force rerun, audit replacement policy,
  background jobs, scheduler, progress polling, retry queue, charts, replay,
  export, provider selection, or OutcomeReview automation;
- the repo lacks enough repository support for safe workspace-scoped candidate
  listing and adding it would require a broad data-access rewrite;
- validation fails for external/environment reasons;
- existing code contradicts this plan in a way that affects product semantics.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/calibration-lab/v1.1/implementation-plan.md first and treat
it as the source of truth for Calibration Lab V1.1.

Implement only the V1.1 batch matured evaluation workflow: preview -> explicit
bounded apply. Do not implement OutcomeReview auto-recording, force rerun,
background jobs, scheduler, progress polling, retry queue, charts, historical
replay, export, provider selection, or trading/performance claims.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, repository, contract, React Query, routing, and CSS
patterns. Preserve unrelated dirty worktree changes.

Ask grill-me questions only if a decision is not covered by the plan or if the
codebase contradicts the plan.
```

## Definition Of Done

- `/calibration` has a compact batch matured evaluations panel.
- Preview endpoint scans saved theses and returns stable row statuses/reasons.
- Apply endpoint recomputes candidates, processes a bounded batch, and returns
  compact per-row results.
- Existing evaluations are reused/skipped, not duplicated or re-run.
- Partial row failures do not fail the entire valid request.
- No OutcomeReview is created by V1.1 batch apply.
- Focused API tests cover preview/apply/idempotency/filter behavior.
- API build/test and web typecheck pass, or blockers are documented.
