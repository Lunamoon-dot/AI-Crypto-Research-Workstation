# Thesis Pulse Monitoring Architecture Plan

Last updated: 2026-05-18  
Status: agreed implementation plan for the next core workflow slice

## Goal-Ready Execution Brief

Use this document as architecture context, not as one giant implementation task.
The safest `/goal` flow is to split work into small vertical slices with a clear
definition of done.

Recommended first `/goal`:

```text
Implement Thesis Pulse manual monitoring vertical slice v1.

Read docs/thesis-pulse-monitoring-architecture-plan.md first, especially the
Goal-Ready Execution Brief and First Goal Checklist.

Objective:
- Create the thesis-anchored monitoring foundation:
  TradeThesis -> ThesisMonitorPlan -> deterministic ThesisPulse -> web chart.
- Support manual pulse runs only.
- Do not implement LLM memo, scheduler, Rust, auth, billing, production hardening,
  watchlist refactors, or brief refactors in this goal.

Required behavior:
- A saved full-research TradeThesis can have a ThesisMonitorPlan.
- The plan stores machine-readable baseline price, invalidation, targets, config,
  status, and missing-field validation.
- The user can run one deterministic pulse manually for a thesis.
- Pulse rows are persisted separately from ResearchRun.
- The API exposes monitor plan read/update enough for the UI, pulse run, and pulse
  list.
- ThesisDetailPage shows monitor status, a run pulse action, latest pulse status,
  and a basic price-to-thesis chart.
- Pulse never mutates thesis decision, user review, or research run status.

Verification:
- Add focused tests near touched modules.
- Run relevant Python tests for changed ai-service modules.
- Run npm run build:api.
- Run npm --prefix apps/web run typecheck.
```

Hard boundaries for the first goal:

- Do not implement `ThesisPulseMemo` UI or LLM calls yet.
- Do not implement any scheduler or background loop yet.
- Do not create a global watchlist-driven monitor.
- Do not store pulse rows inside `research_runs`.
- Do not make pulse status automatically change thesis decisions or reviews.
- Do not rewrite anything to Rust yet; keep the JSON engine boundary stable for
  that later.
- Do not clean up unrelated dirty worktree changes while implementing this.
- Do not introduce broad production features such as auth, billing, tenant
  isolation, queue infra, or hosted operations views.

Recommended goal sequence:

| Goal | Scope | Stop condition |
| --- | --- | --- |
| A | Manual deterministic pulse vertical slice | Plan + pulse persistence + API + ThesisDetail chart works |
| B | Hourly/4h LLM memo workflow | Memo can summarize an existing pulse window manually |
| C | Per-thesis scheduler controls | Scheduler runs bounded intervals only for active enabled plans |
| D | Product/cloud hardening | Postgres writes, durable queue, retention, ops, contract parity |

Agent execution rules:

1. Read existing repository and service patterns before editing.
2. Keep implementation thesis-scoped.
3. Prefer additive domain models, DTOs, and services over broad refactors.
4. Add mappers at API boundaries; web should not depend on raw SQLite/internal
   Python shapes.
5. Keep tests close to the changed module and focused on behavior.
6. If an existing file has unrelated changes, work around them and do not revert.
7. If the first vertical slice becomes too large, stop after persistence + API and
   document the remaining UI work clearly.

Files and areas to inspect first:

```text
apps/ai-service/tradingagents/domain/
apps/ai-service/tradingagents/storage/
apps/ai-service/tradingagents/services/
apps/ai-service/tradingagents/engine/
apps/ai-service/tradingagents/cli/

apps/api/src/database/
apps/api/src/theses/
apps/api/src/jobs/
apps/api/src/contracts/

apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/services/
apps/web/src/types/
apps/web/src/lib/
```

First-goal design constraints:

- `ThesisMonitorPlan` is the source of truth for monitoring levels/config.
- `ThesisPulse` is a cheap deterministic snapshot, not an LLM analysis.
- The initial chart can be simple, but it must show the thesis levels and pulse
  markers clearly enough to judge whether the thesis is intact.
- The web experience starts inside `ThesisDetailPage`; do not add a new primary
  route for v1.
- API responses should already look like future Postgres DTOs, even if Python
  persists SQLite first.
- Idempotency should be implemented from the start using a thesis/time bucket
  concept so repeated manual runs do not create noisy duplicates.
- `price_interval_minutes` / `Pulse bucket minutes` is a manual run dedupe bucket
  in Goal A. It must not be presented or implemented as automatic scheduling
  until Goal C.

Recommended second `/goal`:

```text
Implement Thesis Pulse Memo workflow v1.

Read docs/thesis-pulse-monitoring-architecture-plan.md first, especially
Goal-Ready Execution Brief, Memo Workflow, and Second Goal Checklist.

Prerequisite:
- Goal A manual deterministic pulse vertical slice already works.
- ThesisDetailPage has monitor plan editor, manual Run pulse, chart, and pulse
  timeline.

Objective:
- Add a thesis-scoped manual LLM memo workflow over existing ThesisPulse rows.
- Build TradeThesis + ThesisMonitorPlan + recent ThesisPulse[] -> ThesisPulseMemo.
- Keep this as a small single-step structured LLM summary, not full research.

Required behavior:
- User can click Run memo now for one thesis.
- API can list memo history for that thesis.
- Memo input is compressed and references pulse ids.
- Memo output is structured JSON and persisted separately from ResearchRun and
  ThesisPulse.
- Memo shows in ThesisDetailPage as latest memo plus compact history.
- Memo recommends actions only; it never mutates thesis decision, review, pulse
  status, or research run status.

Do not implement:
- Scheduler/background loop.
- Automatic memo runs on interval.
- Full research rerun.
- Watchlist/brief refactor.
- Rust rewrite.
- Production queue/Postgres worker migration.

Verification:
- Add focused Python tests for memo window selection, idempotency, structured
  output validation, and referenced pulse ids.
- Add API contract tests for run/list memo endpoints and DTO validation.
- Run relevant Python tests, npm run build:api, pnpm --filter
  @lunaperception/api test, npm --prefix apps/web run typecheck, and web build.
```

## 1. Purpose

LunaCrypto should evolve from a one-shot daily research workflow into an active
market monitoring workstation. The current full research run is useful, but it is
too expensive to repeat every few minutes. Crypto markets move continuously, so
the system needs a cheaper workflow that monitors a live thesis against market
movement, deterministic signals, and scenario triggers.

The new core workflow is:

```text
FullResearchRun
-> TradeThesis baseline
-> ThesisMonitorPlan
-> ThesisPulse stream
-> ThesisPulseMemo
-> user review / rerun decision
```

This plan intentionally does not center watchlists or daily briefs. Those can
become consumers of the new monitoring artifacts later, or their role can be
changed without disturbing the core.

## 2. Product Direction

The product remains a research workstation, not a trading bot.

Current priority:

```text
Improve research and monitoring features.
Do not prioritize auth, billing, hosted SaaS, or broad production hardening now.
```

The main user value is helping the user keep up with the market:

- Understand whether an existing thesis is still intact.
- See when price approaches entry, invalidation, or targets.
- Detect lightweight deterministic signal changes.
- Create occasional LLM memos that summarize what changed across many cheap pulses.
- Recommend review or rerun, but keep the user in control.

Non-goals for this slice:

- No automated trading.
- No order routing.
- No automatic thesis decision mutation.
- No watchlist-first architecture.
- No global workspace scheduler in v1.
- No rewrite to Rust in v1.
- No full multi-agent rerun for every market movement.

## 3. Core Decisions

These are the decisions agreed during planning:

| Area | Decision |
| --- | --- |
| Core anchor | Pulse is anchored to an active `TradeThesis`, not a free-floating symbol. |
| Full research | `ResearchRun` remains the full/deep workflow only. |
| Pulse storage | `ThesisPulse` is a separate artifact under thesis lifecycle, not a research run. |
| Memo storage | `ThesisPulseMemo` is a separate structured LLM artifact under thesis lifecycle. |
| Baseline contract | Add `ThesisMonitorPlan` as a machine-readable monitoring contract. |
| Pulse engine | Deterministic, cheap, frequent. No LLM by default. |
| LLM memo | Small single-step memo workflow over a pulse window, not full multi-agent research. |
| UI | Put monitoring in `ThesisDetailPage` first, not a new route. |
| Chart v1 | Price-to-thesis chart: price line, entry, invalidation, targets, markers. |
| User control | Pulse/memo only recommends; user records decisions/reviews manually. |
| Config | Configurable with guardrails; v1 config lives on `ThesisMonitorPlan`. |
| Engine location | Python `ai-service` implements core v1. |
| Future Rust | Allowed later behind the same JSON engine contract if performance requires it. |
| Persistence v1 | Python persists SQLite first and returns JSON summary. |
| Product/cloud later | Worker should write normalized Postgres directly; API reads Postgres only. |
| API scope | Thesis-scoped endpoints under `/theses/:id/...`. |
| Engine call | NestJS calls Python through internal JSON subprocess contract. |
| Idempotency | Pulse uses time buckets; memo uses window buckets. |
| Scheduler v1 | Manual endpoints first; optional per-thesis scheduler later. |

## 4. New Core Model

### 4.1 FullResearchRun

The existing full workflow remains the expensive baseline creator:

```text
FullResearchRun
-> deterministic signal snapshot
-> multi-agent research
-> debate / risk / scenario planner
-> TradeThesis
```

It should not be repeated every few minutes. A full rerun should happen only
when pulse/memo evidence suggests the baseline thesis may no longer be reliable.

### 4.2 TradeThesis

`TradeThesis` remains the human-readable research artifact and thesis lifecycle
owner. It should not carry every monitoring datapoint directly. Instead it owns:

```text
TradeThesis
-> ThesisMonitorPlan
-> ThesisPulse[]
-> ThesisPulseMemo[]
```

### 4.3 ThesisMonitorPlan

`ThesisMonitorPlan` is the machine-readable contract used by the pulse engine.
It normalizes thesis levels and monitoring configuration once, so the pulse
engine does not repeatedly parse prose or ambiguous strings.

Required fields:

```text
symbol
market_type
baseline_price or latest price
invalidation_level
invalidation_direction: below | above
at least one target or scenario trigger
```

Optional fields:

```text
entry_low
entry_high
targets[]
scenario_triggers[]
```

Status model:

```text
draft   -> plan exists but needs user confirmation
active  -> manual pulse is usable and scheduler may run if enabled
paused  -> user paused monitoring
invalid -> required fields are missing or parse failed
```

Recommended behavior:

```text
TradeThesis saved
-> auto-create ThesisMonitorPlan

If required fields parsed:
  status = active
  scheduler_enabled = false

If required fields missing:
  status = draft or invalid
  UI asks user to confirm/edit plan
```

Baseline price priority:

```text
1. market_snapshot.current_price from the full research run
2. signal snapshot payload current_price if present
3. latest market snapshot for the same symbol before thesis.created_at
4. draft plan requiring user/API price refresh
```

### 4.4 ThesisPulse

`ThesisPulse` is an immutable time-series monitoring row. It is designed for
charts, timelines, status markers, and later analytics.

It answers:

```text
Compared with this thesis baseline, did the market change enough to matter?
```

Status model:

```text
calm       no meaningful change
watch      mild change; continue monitoring
review     user should inspect thesis/chart/scenario
rerun_full full research rerun may be warranted
```

Suggested action model:

```text
none
inspect_chart
record_review
run_memo
rerun_full_research
```

The pulse must not mutate thesis decision or outcome review automatically.

### 4.5 ThesisPulseMemo

`ThesisPulseMemo` is an occasional LLM-generated structured summary over a
window of pulse rows. It should be much cheaper than a full research run and
should not reanalyze the market from scratch.

It reads:

```text
baseline thesis summary
monitor plan levels
latest N pulse rows
trigger reasons
signal deltas
scenario status
previous memo if useful
```

It writes structured JSON, not only prose.

## 5. Pulse Workflow

### 5.1 v1 Inputs

Pulse v1 should use:

```text
thesis_id
monitor_plan_id
latest price
baseline price
entry zone if available
invalidation level and direction
target levels
scenario triggers
lightweight deterministic signals
recent pulse history for consecutive trigger checks
```

### 5.2 v1 Exclusions

Do not include these in v1 pulse:

```text
deep news analysis
deep onchain analysis
social sentiment agent
multi-agent analyst graph
LLM call for every pulse
```

### 5.3 Lightweight Signal Refresh

Use a low-cost deterministic subset first:

```text
price / OHLCV based:
  regime / trend
  RSI / MACD divergence if data is available
  volume signal if OHLCV is available
  composite bias / confidence

perp optional:
  funding / OI if provider support exists
```

`ThesisMonitorPlan` should store `enabled_signal_factors`, but the UI should
only expose limited, safe configuration in v1.

## 6. Pulse Comparison Algorithm

The pulse should not ask an LLM to decide what changed. The accurate layer is
deterministic diff against structured baseline fields.

Compare:

```text
current_price vs baseline_price
current_price vs entry_low / entry_high
current_price vs invalidation_level
current_price vs target levels
current signal bias vs baseline / prior pulse signal bias
signal confidence delta
scenario trigger activation
freshness and missing data
consecutive review / invalidation counts
```

### 6.1 Hard Rules

Hard rules catch unambiguous events:

```text
target touched -> review
scenario critical active -> review
signal bias hard flip -> review or rerun_full
invalidation touched once -> review
invalidation touched + signal flip -> rerun_full
N consecutive invalidation touches -> rerun_full
```

Agreed invalidation rule:

```text
1 invalidation touch:
  status = review
  suggested_action = inspect_chart

invalidation touch + signal flip against thesis:
  status = rerun_full
  suggested_action = rerun_full_research

N consecutive invalidation touches:
  status = rerun_full
```

Default `N` should be configurable with guardrails, e.g. 2 or 3.

### 6.2 Score Layer

Use score for ambiguous conditions:

```text
price_distance_score
signal_delta_score
scenario_score
freshness_score
consecutive_review_score
```

Suggested mapping:

```text
0-29   calm
30-59  watch
60-84  review
85+    rerun_full
```

Hard rules can override score upward.

### 6.3 Example Default Thresholds

Default profile should be conservative and cheap:

```text
watch:
  price within 5% of target or invalidation
  signal confidence delta >= 0.10

review:
  price within 2% of invalidation
  target touched
  signal bias flips

rerun_full:
  invalidation touched + signal flip
  consecutive review pulses exceeds threshold
  consecutive invalidation touches exceeds threshold
```

## 7. Configuration Philosophy

The workstation should be configurable because users have different market
styles. But config needs guardrails to avoid spam, cost blowups, and confusing
behavior.

Recommended config layers:

```text
System defaults
-> profile presets later
-> per-thesis overrides in ThesisMonitorPlan v1
```

v1 should put config directly on `ThesisMonitorPlan`.

Example config:

```json
{
  "price_interval_minutes": 5,
  "signal_interval_minutes": 15,
  "memo_interval_minutes": 240,
  "watch_distance_pct": 5.0,
  "review_distance_pct": 2.0,
  "consecutive_review_to_rerun": 3,
  "consecutive_invalidation_to_rerun": 2,
  "run_memo_on_review": true,
  "run_memo_on_rerun_full": true,
  "skip_memo_if_no_new_pulses": true,
  "enabled_signal_factors": ["regime", "macd", "rsi_divergence", "volume"]
}
```

Suggested guardrails:

```text
price_interval_minutes: 1..60
signal_interval_minutes: 5..240
memo_interval_minutes: 30..1440
watch_distance_pct: 1..20
review_distance_pct: 0.25..10
consecutive_review_to_rerun: 1..10
consecutive_invalidation_to_rerun: 1..10
```

Defaults:

```text
price pulse interval: 5m
signal refresh interval: 15m
LLM memo interval: 240m
```

User can later choose faster memo intervals such as 60m or 30m for important
intraday theses.

## 8. Memo Workflow

### 8.1 Trigger Policy

Memo trigger should be user-configurable with severity override:

```text
memo_policy:
  enabled: true
  interval_minutes: 240
  run_on_review: true
  run_on_rerun_full: true
  skip_if_no_new_pulses: true
```

Default:

```text
Run every 4h if enabled and new pulses exist.
Run early when pulse reaches review or rerun_full if policy allows.
```

Goal B v1 is manual only:

```text
Run memo now
-> select pulse window
-> compress thesis + plan + pulse deltas
-> call one structured LLM step
-> validate and persist ThesisPulseMemo
-> refetch latest memo/history in ThesisDetailPage
```

The interval policy above is config for Goal C scheduling. In Goal B it is used
only to choose a default memo window and explain when a memo would be due later.
No background timer, polling loop, or automatic memo trigger should be introduced
in Goal B.

### 8.2 Memo Input

The memo workflow should not read the full report every time. Use compressed
baseline and pulse deltas:

```text
baseline thesis summary
entry / invalidation / targets
market_type
latest 12-48 pulse rows or window rows
status transitions
trigger reasons
signal deltas
scenario states
previous memo if useful
```

Input compression rules for Goal B:

- Include the thesis id, symbol, direction, confidence, thesis text, and current
  plan levels.
- Include only the selected pulse window, defaulting to latest 12-48 rows or the
  last `memo_interval_minutes`, whichever is smaller and useful.
- Include pulse ids, observed times, status, score, price, signal fields,
  hard triggers, and trigger reasons.
- Do not include full research artifacts, debate transcripts, raw articles, or
  broad market context unless already summarized on the thesis/plan/pulse rows.
- If no pulses exist, return a stable "no pulses" response instead of calling
  the LLM.

### 8.3 Memo Output

Structured JSON:

```json
{
  "status": "watch",
  "summary": "Market has moved closer to the first target but invalidation remains intact.",
  "what_changed": [
    "Price moved 3.1% above baseline.",
    "Composite signal confidence improved from 0.54 to 0.63."
  ],
  "why_it_matters": [
    "The thesis is progressing toward target without invalidation pressure."
  ],
  "what_to_watch_next": [
    "Watch target 1 reaction.",
    "Watch whether signal confidence weakens on the next pulse."
  ],
  "recommended_action": "inspect_chart",
  "rerun_full_recommended": false,
  "referenced_pulse_ids": ["pulse_..."],
  "confidence": 0.72
}
```

Persist both structured fields and raw payload.

Output validation rules for Goal B:

- `status` must be one of `calm`, `watch`, `review`, `rerun_full`.
- `recommended_action` must be one of the existing pulse action vocabulary or
  `none`.
- `referenced_pulse_ids` must be a subset of the selected pulse window.
- `confidence` must be numeric from 0 to 1.
- Invalid structured output should become a stable engine/API error, not a
  partially persisted memo.

## 9. Persistence Design

v1 persistence remains in Python SQLite first. The schema should be shaped close
to future Postgres migration.

### 9.1 `thesis_monitor_plans`

Suggested fields:

```text
id
workspace_id
thesis_id
baseline_run_id
symbol
market_type
status
created_at
updated_at

baseline_price
baseline_price_source
baseline_observed_at

entry_low
entry_high
invalidation_level
invalidation_direction
targets_json
scenario_triggers_json

price_interval_minutes
signal_interval_minutes
memo_interval_minutes
watch_distance_pct
review_distance_pct
consecutive_review_to_rerun
consecutive_invalidation_to_rerun
run_memo_on_review
run_memo_on_rerun_full
skip_memo_if_no_new_pulses
enabled_signal_factors_json
scheduler_enabled

latest_pulse_id
latest_memo_id
latest_status
latest_price
latest_trigger_reasons_json
last_pulse_at
next_pulse_due_at
last_memo_at
next_memo_due_at

payload_json
```

### 9.2 `thesis_pulses`

Suggested fields:

```text
id
workspace_id
thesis_id
monitor_plan_id
baseline_run_id
symbol
market_type
pulse_type
bucket_start
observed_at

current_price
baseline_price
price_change_pct
distance_to_entry_pct
distance_to_invalidation_pct
nearest_target
distance_to_nearest_target_pct

signal_bias
signal_confidence
signal_delta
scenario_status

score
status
suggested_action
trigger_reasons_json
hard_triggers_json
missing_data_json

payload_json
```

Idempotency:

```text
unique(thesis_id, bucket_start, pulse_type)
```

Default behavior:

```text
force=false:
  return existing pulse for current bucket if present

force=true:
  recompute and update same pulse row
```

### 9.3 `thesis_pulse_memos`

Suggested fields:

```text
id
workspace_id
thesis_id
monitor_plan_id
baseline_run_id
memo_type
window_start
window_end
created_at

status
summary
what_changed_json
why_it_matters_json
what_to_watch_next_json
recommended_action
rerun_full_recommended
confidence
referenced_pulse_ids_json

prompt_version
provider
model
payload_json
```

Idempotency:

```text
unique(thesis_id, window_start, window_end, memo_type)
```

## 10. Retention

v1 retention:

```text
ThesisPulse raw rows:
  keep 30 days
  or max 10,000 rows per thesis

ThesisPulseMemo:
  keep 180 days by default
  local MVP may keep indefinitely until retention job exists
```

Chart default filters:

```text
last 24h
last 7d
all since thesis
```

## 11. Engine Boundary

NestJS should call Python through an internal JSON subprocess contract, following
the existing `lunacrypto engine run --request <file>` pattern.

Proposed internal commands:

```text
lunacrypto engine pulse --request pulse-request.json
lunacrypto engine pulse-memo --request memo-request.json
```

These are internal engine boundaries, not user-facing CLI UX.

### 11.1 Pulse Request

```json
{
  "thesis_id": "thesis_...",
  "workspace_id": "local",
  "force": false,
  "observed_at": "2026-05-18T10:00:00Z",
  "metadata": {
    "source": "api"
  }
}
```

### 11.2 Pulse Result

```json
{
  "pulse_id": "pulse_...",
  "workspace_id": "local",
  "thesis_id": "thesis_...",
  "monitor_plan_id": "plan_...",
  "status": "watch",
  "suggested_action": "inspect_chart",
  "observed_at": "2026-05-18T10:00:00Z",
  "bucket_start": "2026-05-18T10:00:00Z",
  "current_price": 103500.0,
  "trigger_reasons": ["price_near_target"],
  "score": 42,
  "created": true
}
```

### 11.3 Memo Request

```json
{
  "thesis_id": "thesis_...",
  "workspace_id": "local",
  "window_minutes": 240,
  "force": false,
  "metadata": {
    "source": "api"
  }
}
```

### 11.4 Memo Result

```json
{
  "memo_id": "memo_...",
  "workspace_id": "local",
  "thesis_id": "thesis_...",
  "monitor_plan_id": "plan_...",
  "window_start": "2026-05-18T06:00:00Z",
  "window_end": "2026-05-18T10:00:00Z",
  "status": "watch",
  "recommended_action": "inspect_chart",
  "rerun_full_recommended": false,
  "referenced_pulse_ids": ["pulse_..."],
  "created": true
}
```

## 12. API Design

Use thesis-scoped endpoints in v1:

```text
GET   /theses/:id/monitor-plan
PATCH /theses/:id/monitor-plan
POST  /theses/:id/pulses/run
GET   /theses/:id/pulses
POST  /theses/:id/pulse-memos/run
GET   /theses/:id/pulse-memos
```

Future aggregate monitor endpoints can be added later:

```text
GET /monitor/pulses
GET /monitor/status
```

### 12.1 API Responsibilities

NestJS should:

- enforce workspace access;
- call the Python engine contract for run actions;
- map SQLite/exported rows into stable frontend DTOs;
- return stable response shapes;
- keep web isolated from raw persistence shape;
- support SQLite fallback in local mode;
- later support Postgres repository reads when product persistence exists.

### 12.2 Frontend DTOs

Add explicit DTOs in `apps/api/src/contracts/frontend-contract.ts` and mirrored
web types:

```text
ThesisMonitorPlanResponse
ThesisPulseResponse
ThesisPulseMemoResponse
RunThesisPulseResponse
RunThesisPulseMemoResponse
```

## 13. Web UX Plan

v1 lives inside `ThesisDetailPage`.

Add a Monitor section:

```text
Latest monitoring status
Run pulse now
Run memo now
Enable scheduler later
Monitor plan status / edit link
Price-to-thesis chart
Pulse timeline
Latest memo
```

### 13.1 Chart v1

Main chart:

```text
X-axis: observed_at
Y-axis: current_price

Line:
  current price over time

Horizontal overlays:
  entry zone
  invalidation line
  target lines

Markers:
  calm / watch / review / rerun_full pulse
  target touched
  invalidation touched
  scenario active
  memo created
```

Secondary lanes can be added later:

```text
signal_bias over time
signal_confidence over time
distance_to_invalidation_pct
distance_to_nearest_target_pct
```

### 13.2 Initial UI Behavior

v1 should use manual refresh:

```text
Run pulse now
-> API runs pulse
-> invalidate/refetch monitor plan and pulse list
-> chart updates

Run memo now
-> API runs memo
-> invalidate/refetch memo list
```

No realtime polling in v1 unless scheduler is enabled later.

## 14. Implementation Order

Build as a thin vertical slice. Avoid a large hidden backend build before UI
feedback.

### Phase 1 - Domain And SQLite Schema

Python:

```text
Add domain models:
  ThesisMonitorPlan
  ThesisPulse
  ThesisPulseMemo

Add SQLite migrations:
  thesis_monitor_plans
  thesis_pulses
  thesis_pulse_memos

Add repository methods:
  save/get/update monitor plan
  list/create pulse
  list/create memo
  update latest monitoring state on plan
```

Tests:

```text
SQLite migration test
repository save/read/list test
idempotency test for pulse bucket
idempotency test for memo window
```

### Phase 2 - Monitor Plan Builder

Python:

```text
ThesisMonitorPlanService
  build plan from TradeThesis
  resolve baseline price
  parse entry/invalidation/targets
  infer invalidation_direction from text
  validate required fields
  create active/draft/invalid plan
```

Integration point:

```text
After TradeThesis saved:
  auto-create monitor plan
```

Tests:

```text
valid long thesis plan
valid short thesis plan
missing invalidation -> invalid/draft
entry optional
baseline price priority
invalidation direction inference
```

### Phase 3 - Pulse Engine

Python:

```text
ThesisPulseService
  run pulse for thesis_id
  load plan
  enforce bucket idempotency
  refresh price
  run lightweight deterministic signals
  compare against baseline levels
  calculate hard triggers
  calculate score
  assign status and suggested_action
  persist pulse
  update monitor plan latest state
```

Tests:

```text
calm pulse
watch when near target
review when target touched
review on single invalidation touch
rerun_full on invalidation + signal flip
rerun_full after consecutive invalidation touches
force=false returns existing bucket pulse
force=true recomputes bucket pulse
```

### Phase 4 - Engine JSON Contract

Python:

```text
EnginePulseRequest
EnginePulseResult
EnginePulseMemoRequest
EnginePulseMemoResult

Internal command:
  lunacrypto engine pulse --request <file>
  lunacrypto engine pulse-memo --request <file>
```

NestJS:

```text
PulseEngineClient
  writes request JSON temp file
  calls Python subprocess
  parses structured JSON
```

Tests:

```text
dry contract request validation
subprocess client parses result
engine errors map to stable API errors
```

### Phase 5 - API Endpoints And Contracts

NestJS:

```text
ThesisMonitoringModule or extend ThesesModule

GET   /theses/:id/monitor-plan
PATCH /theses/:id/monitor-plan
POST  /theses/:id/pulses/run
GET   /theses/:id/pulses
POST  /theses/:id/pulse-memos/run
GET   /theses/:id/pulse-memos
```

Repository:

```text
SQLite fallback/export path first
Postgres-shaped interface for future repository
```

Contracts:

```text
Add explicit response mappers.
Update mirrored/generated web client types.
Add API contract tests.
```

Tests:

```text
workspace access enforced
missing thesis -> 404
invalid plan -> stable response
run pulse endpoint returns pulse
list pulses endpoint returns chart rows
run memo endpoint returns memo
```

### Phase 6 - Web Thesis Monitor Section

Web:

```text
services/thesis-monitoring.ts
types for monitor plan / pulse / memo
query keys
ThesisDetailPage monitor section
Run pulse now button
Run memo now button
monitor plan status card
price-to-thesis chart
pulse timeline
latest memo card
```

Initial chart can use a lightweight custom SVG/canvas or an existing chart
library if the app already adopts one. Do not block core on chart polish.

States:

```text
loading
empty plan
invalid plan
no pulses yet
run pulse pending
run memo pending
API error
```

### Phase 7 - LLM Memo Workflow

Python:

```text
ThesisPulseMemoService
  load plan
  load pulse window
  skip if no new pulses and policy says skip
  build compressed memo input
  call one low-temperature structured LLM step
  validate structured output
  persist memo
  update plan latest memo state
```

Tests:

```text
window selection
skip if no new pulses
structured output validation
memo idempotency by window
memo references pulse ids
```

### Phase 8 - Optional Per-Thesis Scheduler

Do after manual pulse/memo works.

Scheduler v1:

```text
per-thesis scheduler_enabled
only active monitor plans
respect price_interval_minutes / signal_interval_minutes / memo_interval_minutes
no global workspace scan UI first
no aggressive background work by default
```

Implementation can start memory/local-first. Durable queue should wait until
product/cloud mode.

## 15. Product/Cloud Migration Notes

Current v1:

```text
NestJS -> Python subprocess -> Python writes SQLite -> API reads fallback/export
```

Future product/cloud:

```text
NestJS -> durable queue/job
-> Python/Rust worker
-> normalized Postgres writes
-> API reads Postgres only
```

Needed later:

- Postgres migrations for the three monitoring tables.
- Worker persistence adapter that writes normalized Postgres directly.
- Durable scheduler through queue, not memory timers.
- Idempotency keys enforced in Postgres.
- Retention job for pulse rows.
- Contract tests proving SQLite and Postgres DTO outputs match.
- Operations page support for pulse/memo job health.

Rust migration later:

```text
Keep PulseEngine JSON request/result stable.
Replace Python pulse implementation only when metrics show Python is bottleneck.
Do not expose engine language to web/API.
```

Rust is appropriate later if:

- many theses are monitored at high frequency;
- Python price/signal diff becomes a bottleneck;
- low-latency streaming is needed;
- schema and data contracts have stabilized.

## 16. Acceptance Criteria

Do not use this section as one implementation goal. It defines the milestone
ladder.

### 16.1 Goal A - Manual Pulse Vertical Slice

Goal A is complete when:

1. A saved full-research thesis can produce or load a `ThesisMonitorPlan`.
2. Invalid or incomplete plans are visible and explain missing fields.
3. User can run a pulse manually for one thesis.
4. Pulse is persisted as a separate time-series row.
5. Pulse status uses hard rules plus deterministic score.
6. Single invalidation touch creates `review`, not automatic `rerun_full`.
7. Consecutive invalidation or invalidation plus signal flip can create
   `rerun_full`.
8. User can view monitor status and pulse chart inside Thesis Detail.
9. Pulse does not mutate user decision, outcome review, or research run state.
10. API build, web typecheck, and relevant Python tests pass.

Goal A explicitly excludes:

- LLM memo workflow.
- Scheduler controls.
- Product/cloud Postgres worker writes.
- Rust rewrite.
- Watchlist/brief redesign.

### 16.2 Goal B - LLM Pulse Memo

Goal B is complete when:

1. User can run an LLM memo manually over recent pulses.
2. Memo input is compressed and references existing pulse ids.
3. Memo output is structured JSON and validated before persistence.
4. Memo is persisted separately from pulse rows and research runs.
5. Memo does not mutate user decision or outcome review.
6. API and web expose latest memo plus memo history.
7. Memo idempotency works by thesis/window bucket.
8. Empty pulse windows return a useful no-op response without spending LLM
   tokens.
9. API build, API tests, web typecheck/build, and relevant Python memo tests
   pass.

Goal B explicitly excludes:

- Scheduler/background loop.
- Automatic memo trigger from `memo_interval_minutes`.
- Full research rerun.
- Watchlist/brief redesign.
- Product/cloud Postgres worker writes.
- Rust rewrite.

### 16.3 Goal C - Per-Thesis Scheduler

Goal C is complete when:

1. Scheduler only runs for active plans with `scheduler_enabled=true`.
2. Price/signal/memo intervals respect bounded config values.
3. Manual run remains available and predictable.
4. Scheduler has clear pause/resume behavior per thesis.
5. Background work does not scan or mutate unrelated workspace state.

## 17. First Goal Checklist

Use this checklist for the first `/goal`.

### 17.1 Read First

```text
[ ] Read existing thesis persistence path.
[ ] Read current engine JSON subprocess pattern.
[ ] Read current API repository/module style.
[ ] Read ThesisDetailPage data loading and UI patterns.
[ ] Check git status and avoid reverting unrelated changes.
```

### 17.2 Python ai-service

```text
[ ] Add domain models for ThesisMonitorPlan and ThesisPulse.
[ ] Add SQLite tables for thesis_monitor_plans and thesis_pulses.
[ ] Add repository methods: save/get/update plan, create/list pulse.
[ ] Add bucket idempotency for pulse rows.
[ ] Add monitor plan builder from existing TradeThesis.
[ ] Auto-create or lazily create monitor plan after thesis save/load.
[ ] Add deterministic pulse run service.
[ ] Add pulse scoring and status assignment.
[ ] Add pulse JSON engine request/result contract.
[ ] Add internal engine pulse command or runner entrypoint.
```

Do not add `ThesisPulseMemo` in Goal A unless the implementation already needs a
placeholder type for forward-compatible DTOs. If a placeholder is added, it must
not call LLMs or expose memo UI yet.

### 17.3 NestJS API

```text
[ ] Add DTOs/mappers for monitor plan and pulse rows.
[ ] Add engine client call for pulse run if needed.
[ ] Add GET /theses/:id/monitor-plan.
[ ] Add PATCH /theses/:id/monitor-plan if required for invalid-plan repair.
[ ] Add POST /theses/:id/pulses/run.
[ ] Add GET /theses/:id/pulses.
[ ] Enforce existing workspace/thesis access pattern.
[ ] Map engine/storage errors to stable API errors.
[ ] Keep response shape Postgres-friendly.
```

### 17.4 Web

```text
[ ] Add thesis monitoring service/types/query keys.
[ ] Add monitor panel inside ThesisDetailPage.
[ ] Add Run pulse now action.
[ ] Show plan status, latest pulse status, suggested action, and reasons.
[ ] Add basic price-to-thesis chart with entry/invalidation/target levels.
[ ] Add pulse markers by status.
[ ] Cover loading, empty, invalid plan, pending run, and API error states.
```

### 17.5 Tests And Verification

```text
[ ] Python test: valid long thesis monitor plan.
[ ] Python test: missing invalidation -> draft/invalid with missing field.
[ ] Python test: calm pulse.
[ ] Python test: invalidation touch -> review.
[ ] Python test: repeated bucket with force=false returns existing pulse.
[ ] API test: missing thesis -> 404.
[ ] API test: run pulse endpoint returns DTO.
[ ] API test: list pulses endpoint returns chart-friendly rows.
[ ] Web typecheck passes.
[ ] API build passes.
```

Commands to run before closing Goal A:

```text
npm run build:api
npm --prefix apps/web run typecheck
```

Also run the smallest relevant Python test command available in the repo for the
changed ai-service modules. If the repo does not have a stable Python test command,
record that clearly in the final status.

## 18. Second Goal Checklist

Use this checklist for Phase B / Goal B.

### 18.1 Read First

```text
[ ] Read the completed Goal A monitoring domain models and repositories.
[ ] Read current LLM client/service patterns in ai-service.
[ ] Read existing engine JSON subprocess pattern for pulse/monitor-plan.
[ ] Read current ThesisDetailPage monitor section and service/types.
[ ] Check git status and avoid reverting unrelated changes.
```

### 18.2 Python ai-service

```text
[ ] Add ThesisPulseMemo domain model if not already present.
[ ] Add thesis_pulse_memos SQLite table if not already present.
[ ] Add repository methods: create/get/list memo.
[ ] Add memo window idempotency by thesis_id/window_start/window_end/memo_type.
[ ] Add ThesisPulseMemoService.
[ ] Load monitor plan and selected pulse window.
[ ] Return no-op result if no pulses exist and policy says skip.
[ ] Build compressed memo input from thesis, plan, pulses, and previous memo.
[ ] Call one low-temperature structured LLM step.
[ ] Validate structured output before persistence.
[ ] Persist memo and update monitor plan latest memo state.
[ ] Add internal engine pulse-memo request/result contract.
```

### 18.3 NestJS API

```text
[ ] Add DTOs/mappers for ThesisPulseMemoResponse and RunThesisPulseMemoResponse.
[ ] Add PythonEngineClient pulseMemo call.
[ ] Add POST /theses/:id/pulse-memos/run.
[ ] Add GET /theses/:id/pulse-memos.
[ ] Enforce existing workspace/thesis access pattern.
[ ] Map engine validation/no-pulse/LLM errors to stable API errors.
[ ] Add API contract tests for run/list memo endpoints.
```

### 18.4 Web

```text
[ ] Add memo service/types/query keys.
[ ] Add Run memo now action inside ThesisDetailPage monitor section.
[ ] Show latest memo status, summary, recommended action, confidence, and created time.
[ ] Show compact memo history.
[ ] Cover no pulses, no memo, pending run, skipped/no-op, and API error states.
[ ] Do not add a new route for Goal B.
```

### 18.5 Tests And Verification

```text
[ ] Python test: no pulses -> no-op/no LLM spend.
[ ] Python test: memo window selection.
[ ] Python test: structured output validation.
[ ] Python test: memo idempotency by window.
[ ] Python test: memo references pulse ids.
[ ] API test: missing thesis -> 404.
[ ] API test: run memo endpoint returns DTO.
[ ] API test: list memo endpoint returns newest/history rows.
[ ] Web typecheck passes.
[ ] Web build passes.
[ ] API build/tests pass.
```

Commands to run before closing Goal B:

```text
npm run build:api
pnpm --filter @lunaperception/api test
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
```

Also run the smallest relevant Python test command available in the repo for the
changed ai-service memo modules. On this Windows workspace, prefer
`.venv\Scripts\python.exe -m pytest ...` if `python` resolves to the Windows
Store alias.

## 19. Error Prevention Checklist

Before coding:

```text
[ ] Confirm whether persistence source is SQLite-only for this slice.
[ ] Confirm whether monitor plan is auto-created immediately or lazily on read.
[ ] Confirm the exact thesis id type used across Python/API/web.
[ ] Confirm current engine subprocess contract and mirror its error handling.
[ ] Confirm whether the web currently has a chart library.
[ ] For Goal B, confirm the selected memo window and no-pulse behavior before
    adding LLM calls.
```

Before final response:

```text
[ ] No pulse data stored in research_runs.
[ ] No automatic decision/review mutation.
[ ] No scheduler accidentally started.
[ ] No LLM call in pulse path.
[ ] No automatic memo scheduling introduced in Goal B.
[ ] Memo referenced_pulse_ids are from the selected pulse window.
[ ] No watchlist/brief refactor included.
[ ] No unrelated dirty worktree changes reverted.
[ ] Verification commands and failures are reported honestly.
```
