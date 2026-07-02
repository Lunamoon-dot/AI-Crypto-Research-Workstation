# Calibration Lab V1 Implementation Plan

Last updated: 2026-05-21  
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1 end-to-end.

Read this document first:
docs/features/calibration-lab/v1/implementation-plan.md

Objective:
- Add a dedicated /calibration workflow that evaluates one saved thesis over a
  7d, 14d, or 30d forward window, persists a ThesisEvaluation idempotently, and
  lets the user record an OutcomeReview only after inspecting a usable mature
  evaluation.

Required behavior:
- /calibration supports /calibration?thesis_id=<id>.
- Thesis Detail links to /calibration?thesis_id=<id> via an Evaluate thesis action.
- POST /calibration/evaluations/thesis creates or returns an idempotent
  ThesisEvaluation.
- GET /calibration/evaluations and GET /calibration/evaluations/:id return
  workspace-scoped evaluation DTOs.
- POST /calibration/evaluations/:id/outcome-review creates an idempotent
  OutcomeReview only when the evaluation is mature and result is usable.
- The web page uses 14d by default, with 7d/14d/30d presets.
- The page shows result, evidence summary, warnings, record-review blockers, and
  a collapsed raw JSON/debug view.

Do not implement:
- Batch matured evaluation.
- Historical replay UI.
- Scheduling/background evaluation.
- Provider/exchange selection.
- Evaluation delete.
- Evaluation export.
- Calibration charts.
- Trading/order execution, broker PnL, Sharpe, alpha, or execution simulation.
- Hosted auth, billing, tenant-product work, or broad production hardening.

Definition of done:
- The route, API, engine command, Postgres persistence, web UI, and focused tests
  work together for one thesis.
- Re-running the same thesis/window returns an existing evaluation instead of a
  duplicate.
- Recording an outcome review is a second explicit action, is idempotent, and is
  blocked for incomplete windows or unknown results.
- Relevant API/Python/web checks pass, or blockers are documented with exact
  command summaries.
```

## One Outcome

Add a dedicated Calibration Lab V1 workflow for manual single-thesis evaluation.

The user can select a saved thesis, evaluate it over a fixed forward window,
inspect the machine evaluation, and optionally record the evaluation as an
official outcome review only after seeing the result.

## Resolved Decisions

- Route is `/calibration`.
- Deep link is `/calibration?thesis_id=thesis_abc`.
- Sidebar/nav label is `Calibration`.
- Page title is `Calibration Lab`.
- V1 is manual single-thesis evaluation only.
- Batch matured evaluation is V1.1.
- Default window is `14d`.
- Window presets are `7d`, `14d`, and `30d`.
- No custom window input in V1.
- No provider/exchange selector in V1.
- No chart in V1.
- No export in V1.
- No delete endpoint in V1.
- Use a separate `CalibrationModule`.
- Add a new Python engine JSON command: `python -m luna_workstation.engine evaluate --request`.
- Python returns JSON evaluation results; NestJS persists product-state rows.
- NestJS creates `OutcomeReview`, not Python.
- `POST /calibration/evaluations/thesis` does not accept `record_review`.
- Recording an outcome review uses:

```text
POST /calibration/evaluations/:id/outcome-review
```

- Outcome review notes are editable but prefilled with deterministic trace text.
- Outcome review result is fixed from the evaluation result.
- `unknown` cannot be recorded as an outcome review.
- `hit_target`, `invalidated`, `mixed`, and `expired` can be recorded if mature.
- `expired` remains `expired`.
- `mixed` remains `mixed`.
- `mixed` means both target and invalidation appeared in the window, or favorable
  and adverse movement were both material and order is not reliable enough to
  classify as clean hit/invalidated.
- Incomplete windows can be evaluated and persisted, but cannot be recorded as
  outcome reviews.
- API returns evaluation plus warnings instead of failing the whole request when
  review creation is blocked by maturity/result policy.
- `/performance` remains based on `OutcomeReview`.
- `/calibration` owns `ThesisEvaluation`.
- Recent global evaluations show only when no thesis is selected.
- When thesis is selected, show that thesis's evaluation history.
- Clicking a history row shows inline detail; no evaluation detail route page.
- Query params only include `thesis_id`; no `evaluation_id` param in V1.

## Unresolved Decisions

None intentionally left open for V1. If implementation discovers a conflicting
repo pattern, stop and document the conflict before broadening scope.

## Relevant Context

Current repo facts:

- Python SQLite journal already has `thesis_evaluations`.
- Python domain/repository already has `ThesisEvaluation`.
- Prisma/Postgres schema currently does not have `ThesisEvaluation`.
- Web already has Thesis Detail and Performance Analytics.
- Existing dirty worktree changes may exist outside this plan. Do not revert them.

Files to inspect first:

```text
packages/database/prisma/schema.prisma
apps/api/src/database/journal.types.ts
apps/api/src/database/prisma-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/src/performance/performance.module.ts
apps/api/src/performance/performance.service.ts
apps/api/src/theses/theses.service.ts
apps/api/src/theses/theses.controller.ts
apps/api/test/api-contract.test.ts

apps/ai-service/luna_workstation/domain/evaluation.py
apps/ai-service/luna_workstation/services/evaluation_service.py
apps/ai-service/luna_workstation/engine/schemas.py
apps/ai-service/luna_workstation/engine/entrypoint.py
apps/ai-service/tests/test_evaluation_window_guard.py
apps/ai-service/tests/test_evaluation_aggregation.py

apps/web/src/routes/index.tsx
apps/web/src/layouts/MainLayout.tsx
apps/web/src/components/navigation/SidebarNav.tsx
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/pages/PerformanceAnalyticsPage.tsx
apps/web/src/services/theses.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
apps/web/src/components/research/json-view.tsx
apps/web/src/components/ui/state.tsx
```

Likely files to change:

```text
packages/database/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/calibration/calibration.module.ts
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/*.ts
apps/api/src/jobs/python-engine.client.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts

apps/ai-service/luna_workstation/engine/schemas.py
apps/ai-service/luna_workstation/engine/entrypoint.py
apps/ai-service/tests/test_evaluation_window_guard.py

apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/routes/index.tsx
apps/web/src/components/navigation/SidebarNav.tsx
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
apps/web/src/styles/index.css
```

## Data Model

Add a normalized Postgres/Prisma model for `thesis_evaluations`.

Recommended columns:

```text
id
workspace_id
thesis_id
outcome_review_id nullable
symbol
window_days
evaluation_start
evaluation_end
evaluated_at
result
max_favorable_excursion
max_adverse_excursion
invalidated
warnings_json
evidence_json
payload_json
```

Recommended unique key:

```text
workspace_id + thesis_id + window_days + evaluation_start + evaluation_end
```

Recommended Prisma relation:

- `TradeThesis` has many `ThesisEvaluation`.
- `ThesisEvaluation` belongs to `TradeThesis`.
- `OutcomeReview` relation can be nullable if easy; otherwise keep
  `outcome_review_id` and repository lookup.

Do not add user-facing delete support.

## API Contract

Routes:

```text
POST /calibration/evaluations/thesis
GET  /calibration/evaluations
GET  /calibration/evaluations/:id
POST /calibration/evaluations/:id/outcome-review
```

Evaluate request:

```json
{
  "thesis_id": "thesis_abc",
  "window_days": 14
}
```

Evaluate response:

```json
{
  "created": true,
  "evaluation": {
    "id": "eval_abc",
    "workspace_id": "local",
    "thesis_id": "thesis_abc",
    "outcome_review_id": null,
    "symbol": "ETH/USDT",
    "window_days": 14,
    "evaluation_start": "2026-05-01",
    "evaluation_end": "2026-05-15",
    "evaluated_at": "2026-05-21T00:00:00.000Z",
    "result": "hit_target",
    "max_favorable_excursion": 0.12,
    "max_adverse_excursion": -0.04,
    "invalidated": false,
    "warnings": [],
    "evidence": {
      "candle_count": 336,
      "first_candle_at": "2026-05-01T00:00:00.000Z",
      "last_candle_at": "2026-05-15T00:00:00.000Z",
      "highest_high": 3600,
      "lowest_low": 3080,
      "target_hit": true,
      "invalidation_hit": false
    },
    "calendar_mature": true,
    "can_record_review": true,
    "record_review_blockers": []
  },
  "warnings": []
}
```

Outcome review request:

```json
{
  "notes": "Optional user-edited note."
}
```

Outcome review response:

```json
{
  "created": true,
  "outcome_review": {},
  "evaluation": {}
}
```

If a review already exists for the evaluation:

```json
{
  "created": false,
  "outcome_review": {},
  "evaluation": {}
}
```

Evaluation DTO should include:

```text
calendar_mature
can_record_review
record_review_blockers
```

V1 blockers:

```text
incomplete_window
unknown_result
review_already_recorded
```

## Result And Warning Semantics

Result enum:

```text
hit_target
invalidated
mixed
expired
unknown
```

Warnings are separate from result:

```text
incomplete_window
missing_ohlcv
provider_warning
incomplete_data
```

Rules:

- Missing/lightly incomplete data can persist `unknown` with warnings.
- Hard request/runtime failures should return API/engine errors and not persist a
  misleading evaluation.
- `calendar_mature` is computed dynamically from `evaluation_end`; do not store
  it as a DB column.
- Python computes evaluation evidence/result/warnings.
- NestJS enforces product policy before creating outcome reviews.

## Python Engine Boundary

Add stable command:

```text
python -m luna_workstation.engine evaluate --request request.json
```

Engine request:

```json
{
  "thesis_id": "thesis_abc",
  "workspace_id": "local",
  "window_days": 14,
  "metadata": {
    "source": "calibration_lab_v1"
  }
}
```

Engine result:

```json
{
  "workspace_id": "local",
  "thesis_id": "thesis_abc",
  "evaluation_id": "eval_abc",
  "status": "completed",
  "evaluation": {},
  "warnings": [],
  "error_type": null,
  "error": null
}
```

Do not use terminal-formatted output for the API. Keep this as a machine JSON
contract.

## Web UX

Route behavior:

- `/calibration?thesis_id=<id>` preselects a thesis.
- `/calibration` without query param shows thesis picker and recent evaluations.
- When a thesis is selected, show only that thesis's evaluation history.

Main UI:

- Header: `Calibration Lab`.
- Thesis picker using existing `listTheses`.
- Selected thesis summary.
- Window selector: 7d / 14d / 30d, default 14d.
- Primary action: `Evaluate`.
- Result badge:
  - `New evaluation` when `created = true`.
  - `Existing evaluation` when `created = false`.
- Evidence summary, warnings, and raw JSON/debug section collapsed by default.
- Inline history/detail view.
- `Record outcome review` action appears after evaluation result is visible.
- If record is blocked, disable the action and show blockers.
- If review already exists, show `Review recorded` and link to `/performance`.
- Stay on `/calibration` after success; do not auto-redirect.

Outcome review form:

- Inline form or compact panel.
- Textarea `notes`.
- Prefill deterministic note:

```text
Auto-recorded from Calibration Lab evaluation eval_abc over 14 day(s). Result: hit_target. MFE: 12.0%. MAE: -4.0%.
```

- User may edit notes.
- Result is not editable in this form.

Copy rules:

- Use "evaluate", "review", "calibrate", and "thesis quality".
- Keep copy focused on evidence, outcomes, calibration, and thesis quality.

## Implementation Checklist

- [ ] Add Prisma/Postgres `ThesisEvaluation` model and unique key.
- [ ] Add journal repository types/methods for evaluation upsert/list/get/update
      review link.
- [ ] Add frontend contract DTOs/mappers for calibration evaluations.
- [ ] Add OpenAPI entries if following the repo's generated contract pattern.
- [ ] Add Python engine evaluate request/result schemas.
- [ ] Add `python -m luna_workstation.engine evaluate --request` command.
- [ ] Add `PythonEngineClient.evaluateThesis`.
- [ ] Add `CalibrationModule`, controller, service, and DTOs.
- [ ] Implement idempotent evaluation upsert.
- [ ] Implement idempotent outcome-review creation from evaluation.
- [ ] Add `/calibration` web service/query keys/types.
- [ ] Add `CalibrationLabPage`.
- [ ] Add sidebar/nav item.
- [ ] Add Thesis Detail `Evaluate thesis` link.
- [ ] Add raw JSON/debug collapsed section.
- [ ] Add focused API tests.
- [ ] Add focused Python tests.
- [ ] Run verification commands.

## Validation Loop

Run smallest useful checks first:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

If Python changes are made:

```bash
cd apps/ai-service
python -m pytest tests/test_evaluation_window_guard.py tests/test_evaluation_aggregation.py
python -m pytest
```

Manual checks:

- Open `/calibration`.
- Select a thesis.
- Confirm 14d is default.
- Run evaluation.
- Confirm result/evidence/warnings render.
- Confirm repeated evaluate returns existing evaluation.
- Confirm record review is blocked for incomplete/unknown.
- Confirm record review creates one review and does not duplicate on repeat.
- Confirm Thesis Detail `Evaluate thesis` deep-links correctly.

## Checkpoint Behavior

Work milestone by milestone:

1. DB/repository contract.
2. Python engine JSON command.
3. API module and DTO mapping.
4. Web route/page.
5. Tests and verification.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving forward;
- do not expand into V1.1 or replay features;
- keep unrelated dirty worktree changes intact.

## Stop Rules

Stop and report instead of broadening scope when:

- the single-thesis workflow is complete;
- implementing the next request would require batch, replay, scheduler, export,
  charting, provider selection, auth, billing, or trading execution;
- Prisma/Postgres schema conflicts with current repository assumptions;
- Python evaluation output cannot provide enough data for a stable DTO;
- validation fails due to environment/dependency issues outside the changed code.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/calibration-lab/v1/implementation-plan.md first and treat it
as the source of truth for Calibration Lab V1.

Implement only the V1 manual single-thesis evaluation workflow. Do not implement
batch matured evaluation, historical replay UI, scheduler/background evaluation,
provider selection, charts, export, delete, hosted auth, billing, trading/order
execution, broker PnL, Sharpe, or alpha analytics.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, Python engine, Prisma, React Router, TanStack Query, and
local CSS patterns. Preserve unrelated dirty worktree changes.

Ask grill-me questions only if a decision is not covered by the plan or if the
codebase contradicts the plan.
```

## Definition Of Done

- `/calibration` exists and supports `?thesis_id=`.
- Thesis Detail links to Calibration Lab.
- `POST /calibration/evaluations/thesis` creates or returns one idempotent
  evaluation.
- `GET /calibration/evaluations` and `GET /calibration/evaluations/:id` work.
- `POST /calibration/evaluations/:id/outcome-review` is idempotent and policy
  guarded.
- Postgres stores normalized evaluation fields plus payload JSON.
- Python exposes `engine evaluate --request` JSON contract.
- Web renders result/evidence/warnings/history and collapsed raw JSON.
- `/performance` remains based on `OutcomeReview`.
- Relevant tests and checks pass, or exact blockers are documented.
