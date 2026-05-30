# Research Continuity V2.0 Timeline And Item Lifecycle Implementation Plan

Last updated: 2026-05-30
Status: implemented

## Goal

Research Continuity V2.0 turns the symbol ledger into a timeline and item
lifecycle explorer.

The primary product question is:

```text
When did this claim, risk, watchpoint, level, or invalidation first appear,
how did it change across runs, is it still active, and which evidence/run
supports each transition?
```

V1.9 answers what changed inside one continuity entry. V2.0 answers how one
memory item evolved across many entries.

## Non-Goals

- Add an interactive graph canvas.
- Add a multi-symbol dashboard.
- Add semantic search, embeddings, or LLM-generated lifecycle reasoning.
- Change snapshot extraction, delta event semantics, repair execution, or
  scheduler behavior unless tests expose a blocking lifecycle bug.
- Persist a new graph table or perform a broad backfill.
- Evaluate whether a thesis was correct after market time. That remains
  Calibration or performance analytics.

## Product Boundary

V2.0 is the graph substrate, not the graph UI.

It should normalize continuity entries into stable graph-ready primitives:

```text
symbol -> entry -> event -> item -> source/evidence/run
```

The web app should render these primitives as a dense timeline and lifecycle
panel first. A later version can project the same data into nodes and edges for
a graph renderer without rewriting domain logic.

Suggested later split:

```text
V2.0 = graph-ready lifecycle model + timeline API + table/timeline UI
V2.1 = graph projection endpoint: nodes/edges
V2.2 = interactive graph UI
```

## Approach

Use a computed-on-read presenter over the existing append-only ledger.

Do not add a migration in V2.0. Existing continuity entries already contain the
needed source data:

- `events` from the deterministic delta engine.
- `entry_type`, `status`, `previous_entry_id`, `research_run_id`, and
  `generated_at`.
- `snapshot_quality` and thin/diff report metadata.
- repair metadata under `payload.repair`.
- active lifecycle hints in `ContinuityStateProjector`, including
  first/last seen fields and occurrence counts.

Add a focused API helper such as:

```text
apps/api/src/research-continuity/continuity-timeline.presenter.ts
```

Keep `ResearchContinuityService` as an orchestration layer only. It should load
ledger entries and call the presenter, not own timeline normalization logic.
If source run completion times are needed for `observed_at`, load only the
minimal run metadata needed for the entries in the requested window.

## API Contract

Add:

```text
GET /research-continuity/symbols/:symbol/timeline
```

Query parameters:

- `limit`: entry window size, default `50`, max `200`.
- `item_type`: optional `claim`, `risk`, `watchpoint`, `level`,
  `invalidation`.
- `status`: optional `active`, `updated`, `resolved`, `weakened`,
  `invalidated`, `quality`, `context`.
- `include_context`: optional boolean, default `false`.

Response:

```ts
export type ResearchContinuityLifecycleItemType =
  | 'claim'
  | 'risk'
  | 'watchpoint'
  | 'level'
  | 'invalidation'
  | 'view'
  | 'quality'
  | 'unknown';

export type ResearchContinuityLifecycleStatus =
  | 'active'
  | 'updated'
  | 'resolved'
  | 'weakened'
  | 'invalidated'
  | 'context'
  | 'quality';

export interface ResearchContinuityTimelineWindowResponse {
  entry_limit: number;
  truncated: boolean;
  coverage: 'complete' | 'windowed';
}

export interface ResearchContinuityTimelineEventResponse {
  id: string;
  entry_id: string;
  research_run_id: string | null;
  observed_at: string | null;
  recorded_at: string | null;
  event_type: string;
  stable_item_key: string | null;
  item_type: ResearchContinuityLifecycleItemType;
  status: ResearchContinuityLifecycleStatus;
  title: string;
  before: string | null;
  after: string | null;
  severity: 'info' | 'warning' | 'critical';
  diff_quality: 'complete' | 'partial' | 'unavailable';
  entry_type: string;
  entry_status: string;
  is_repair: boolean;
  repair_case_type: string | null;
  source_entry_id: string | null;
  source_run_id: string | null;
  evidence_status: string | null;
  source_artifact: string | null;
  source_id: string | null;
  source_field: string | null;
}

export interface ResearchContinuityLifecycleItemResponse {
  stable_item_key: string;
  item_type: ResearchContinuityLifecycleItemType;
  status: ResearchContinuityLifecycleStatus;
  title: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  first_seen_run_id: string | null;
  last_seen_run_id: string | null;
  occurrence_count: number;
  entry_count: number;
  latest_entry_id: string | null;
  latest_event_type: string | null;
  source_artifacts: string[];
  timeline_event_ids: string[];
}

export interface ResearchContinuityTimelineResponse {
  symbol: string;
  workspace_id: string;
  generated_at: string;
  window: ResearchContinuityTimelineWindowResponse;
  entry_count: number;
  event_count: number;
  lifecycle_items: ResearchContinuityLifecycleItemResponse[];
  timeline_events: ResearchContinuityTimelineEventResponse[];
  warnings: string[];
}
```

The canonical shape is flat `timeline_events` plus `lifecycle_items` that refer
to event ids through `timeline_event_ids`. Do not nest complete event histories
inside each lifecycle item; that duplicates data and makes filtering harder.

The response should not expose raw debug payloads or full evidence arrays. It
should expose only enough provenance to link back to source entries, runs, and
source artifacts.

## Normalization Rules

Identity:

- Prefer `event.item_key`.
- Fall back to `to.item_key`, `from.item_key`, `to.legacy_item_key`, then
  `from.legacy_item_key`.
- If no stable key exists, create a deterministic timeline event id only. Do not
  create a lifecycle item for that row.
- Do not merge items across different item types unless an explicit legacy key
  proves they are the same item.
- Do not use semantic text matching, embeddings, or LLM judgment to merge two
  similar-looking items in V2.0.

Lifecycle status:

- `*_added` -> `active`.
- `*_updated`, `view_changed` -> `updated`.
- `risk_resolved`, `watchpoint_resolved` -> `resolved`.
- `claim_weakened` -> `weakened`.
- `level_invalidated`, `invalidation_updated` with invalidation semantics ->
  `invalidated`.
- `data_quality_changed` -> `quality`.
- carried/reinforced/view observed/baseline events -> `context`, excluded unless
  `include_context=true`.
- `resolved`, `weakened`, and `invalidated` are soft terminal statuses. The
  latest material event wins, so a later `*_added` or `*_updated` event for the
  same stable item can reactivate it.

Item rollup:

- Only events with `stable_item_key` can contribute to `lifecycle_items`.
- `first_seen_at` and `first_seen_run_id` come from the first active/update event
  for that item inside the loaded window.
- `last_seen_at` and `last_seen_run_id` come from the latest event for that item
  inside the loaded window.
- `occurrence_count` increments for each entry where the item appears as active,
  updated, carried, or reinforced.
- terminal status wins when the latest material event is resolved, weakened, or
  invalidated.
- repaired entries remain visible with `is_repair=true`, but should not hide the
  original source entry.
- Repair is metadata overlay, not a new source signal. Prefer source run time
  for ordering when available, and expose repair metadata separately.

Windowing:

- `limit` controls how many recent ledger entries are scanned.
- When the ledger has more entries than the loaded window, `window.coverage`
  must be `windowed` and `window.truncated` must be `true`.
- In windowed mode, `first_seen_at`, `occurrence_count`, and current status are
  only true within the loaded window. The API and UI must not imply whole-ledger
  truth when `truncated=true`.

Quality:

- A partial or unavailable diff must mark affected timeline events with
  `diff_quality`.
- Degraded/skipped entries can contribute quality timeline events, but must not
  invent material item changes.
- Unknown event types are ignored unless they can be safely represented as
  `context` or `quality`.

Ordering:

- Each timeline event exposes `observed_at` and `recorded_at`.
- `observed_at` should be the source research run completion/capture time when
  available. `recorded_at` should be the continuity entry `generated_at`.
- `timeline_events` sort newest first by `observed_at`, falling back to
  `recorded_at`, then entry id.
- `lifecycle_items` sort by status priority, then latest activity:
  active/updated, weakened/invalidated/resolved, quality/context.

## Web UI

Add a timeline section to `/research-continuity?symbol=...`.

The page should keep the existing snapshot, latest report, evidence health,
active memory, repair, and entry list sections. V2.0 adds a new full-width
section between "Latest research delta" and "Active research memory":

```text
Item Lifecycle
```

Expected controls:

- item type segmented control or select.
- status filter.
- context toggle.
- compact count chips for active, updated, resolved, weakened, invalidated.
- selected lifecycle item state.

Expected layout:

- Left or top: lifecycle item list grouped by status.
- Right or below: selected item timeline with entry/run links.
- Each event row shows date, event type, before/after summary, severity,
  diff quality, repair badge, and source line.
- If `window.truncated=true`, show that lifecycle counts and first-seen values
  apply only inside the loaded window.

The UI should not look like a graph yet. It should be dense, inspectable, and
operator-friendly. The graph renderer belongs to a later version.

## Error Handling

- Empty ledgers return an empty response with `entry_count = 0`.
- Legacy entries without structured events still render partial timeline rows
  when V1.9 fallback data can identify an item title. They do not become
  lifecycle items unless a stable item key exists.
- Entries with unavailable diffs contribute warnings, not fake material rows.
- Missing source fields should render as `null`, not crash the page.
- Workspace access and symbol normalization follow existing Research Continuity
  endpoints.

## Testing

API tests should cover:

- Timeline endpoint is workspace scoped.
- Added, updated, resolved, weakened, invalidated, quality, repair, and context
  events normalize into timeline rows.
- Stable item keys merge events across multiple entries.
- Events without stable keys appear in `timeline_events` but not
  `lifecycle_items`.
- Legacy item keys bridge old and new item identities.
- Soft terminal statuses win only until a later material event reactivates the
  same stable item.
- Partial/unavailable diff quality is preserved.
- Context rows are excluded by default and included when requested.
- `observed_at` is used for ordering when available, with `recorded_at` as
  fallback.
- Windowed responses set `window.truncated=true` and do not claim complete
  lifecycle coverage.
- Repair rows preserve source entry/run references and are labeled as repair
  overlays.
- Unknown event types do not crash normalization.
- Empty ledger returns a stable empty response.

Frontend tests should cover where the current setup supports them:

- Timeline section renders lifecycle counts.
- Selecting an item shows its event history.
- Filters reduce visible rows without refetching incompatible state.
- Partial/unavailable and repair badges are visible.
- Windowed lifecycle state is labeled when the API reports truncation.

Manual smoke:

1. Open `/research-continuity?symbol=BTC%2FUSDT`.
2. Confirm existing V1.9 diff badges still render.
3. Confirm Item Lifecycle shows claims, risks, watchpoints, levels, and
   invalidations from the ledger.
4. Select a lifecycle item and confirm its event history links to source entries
   and research runs.
5. Confirm degraded, skipped, repair, and legacy entries are labeled honestly.
6. Confirm the UI labels lifecycle values as windowed when the response is
   truncated.

## Acceptance Criteria

- A user can answer when a memory item first appeared, how it changed, and
  whether it is still active inside the loaded window.
- Timeline rows link continuity entries to source runs and evidence/source
  metadata without exposing debug payloads.
- Events without stable identity remain timeline rows and do not pollute the
  lifecycle item set.
- Repair entries are labeled as overlays and do not distort source run ordering.
- The API response is stable enough to serve as the substrate for a later graph
  projection.
- V2.0 does not add a graph UI, migration-heavy graph store, or LLM reasoning
  layer.
- `research-continuity.service.ts` stays an orchestration layer; timeline logic
  lives in a focused presenter/helper.
