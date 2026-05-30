# Research Continuity V1.9 Diff Report View Implementation Plan

Last updated: 2026-05-30
Status: planned

## Goal

Research Continuity V1.9 turns existing continuity data into a readable diff report.
When a user opens a continuity entry, they should quickly see what was added,
updated, resolved, weakened, or unavailable, with enough source context to trust
the report without opening debug traces.

The primary product question is: "What changed since the previous continuity
entry, and can I trust this diff?"

## Non-Goals

- Add a graph, timeline, provenance explorer, or multi-symbol dashboard.
- Add semantic or LLM-generated diff rewriting.
- Rewrite the continuity delta engine unless tests expose a blocking mapping bug.
- Persist a new `payload.report_views.diff` view, add backfill, or add migrations.
- Change audit retention or scheduler hardening unless V1.8 worker smoke exposes a
  separate blocker.

## Approach

Use an additive, computed-on-read API presenter.

The API derives a stable diff response shape from the continuity entry already
loaded from the journal. The normalizer reads structured `events` first, then
falls back to `payload.report_views.thin`, legacy `sections`, and
`snapshot_quality` when the entry is legacy, degraded, or skipped.

No new endpoint is required. Existing list and detail endpoints receive additive
fields:

- `GET /research-continuity/symbols/:symbol/entries` adds `diff_summary`.
- `GET /research-continuity/entries/:id` adds `diff_summary` and `diff_report`.

This keeps diff semantics in the API layer while leaving the web app as a
straightforward renderer.

## Architecture

Add a small diff report presenter near the current continuity response mapping
layer. It should not own persistence or delta generation.

```text
journal continuity entry
  -> toEntrySummaryResponse()
      -> buildDiffSummary(entry)
  -> toEntryDetailResponse()
      -> buildDiffReport(entry)
  -> web list/detail render stable fields
```

Suggested module boundary:

- API DTO types live in `apps/api/src/research-continuity/dto/research-continuity.dto.ts`.
- Diff normalization lives in a focused API helper such as
  `apps/api/src/research-continuity/continuity-diff-report.presenter.ts`.
- Existing response mapping in `research-continuity.service.ts` calls the helper.
- Web service/generated types expose the additive fields through the existing
  client flow.
- Web pages render fields without reimplementing event taxonomy.

## API Contract

`ResearchContinuityEntrySummaryResponse` gains:

```ts
diff_summary: ResearchContinuityDiffSummaryResponse;
```

`ResearchContinuityEntryDetailResponse` gains:

```ts
diff_summary: ResearchContinuityDiffSummaryResponse;
diff_report: ResearchContinuityDiffReportResponse;
```

Types:

```ts
export type ResearchContinuityDiffGroup =
  | 'added'
  | 'updated'
  | 'removed_resolved'
  | 'weakened'
  | 'context'
  | 'quality';

export type ResearchContinuityDiffQuality =
  | 'complete'
  | 'partial'
  | 'unavailable';

export type ResearchContinuityDiffSeverity =
  | 'info'
  | 'warning'
  | 'critical';

export type ResearchContinuityDiffItemType =
  | 'claim'
  | 'risk'
  | 'watchpoint'
  | 'level'
  | 'invalidation'
  | 'view'
  | 'quality'
  | 'unknown';

export interface ResearchContinuityDiffSummaryResponse {
  added_count: number;
  updated_count: number;
  removed_resolved_count: number;
  weakened_count: number;
  quality_count: number;
  has_material_changes: boolean;
  has_comparison: boolean;
  diff_quality: ResearchContinuityDiffQuality;
  is_repair: boolean;
  badges: string[];
  warnings: string[];
}

export interface ResearchContinuityChangedItemEvidenceResponse {
  status: string | null;
  source_artifact: string | null;
  source_id: string | null;
  source_field: string | null;
}

export interface ResearchContinuityChangedItemResponse {
  id: string;
  group: ResearchContinuityDiffGroup;
  event_type: string;
  item_type: ResearchContinuityDiffItemType;
  title: string;
  before: string | null;
  after: string | null;
  severity: ResearchContinuityDiffSeverity;
  evidence: ResearchContinuityChangedItemEvidenceResponse;
}

export interface ResearchContinuityChangeGroupResponse {
  group: ResearchContinuityDiffGroup;
  title: string;
  count: number;
  items: ResearchContinuityChangedItemResponse[];
}

export interface ResearchContinuityDiffReportResponse {
  version: 'research_continuity_diff.v1';
  summary: ResearchContinuityDiffSummaryResponse;
  change_groups: ResearchContinuityChangeGroupResponse[];
  changed_items: ResearchContinuityChangedItemResponse[];
}
```

The response intentionally excludes raw `from`, `to`, `changed_attributes`, and
full evidence arrays. Those remain available only through the existing debug
path.

## Normalization Rules

Structured event mapping:

- `added`: `claim_added`, `risk_added`, `watchpoint_added`, `level_added`,
  `invalidation_added`
- `updated`: `claim_updated`, `risk_updated`, `watchpoint_updated`,
  `level_updated`, `invalidation_updated`, `view_changed`
- `removed_resolved`: `risk_resolved`, `watchpoint_resolved`,
  `level_invalidated`
- `weakened`: `claim_weakened`
- `quality`: `data_quality_changed`, plus synthetic quality rows for degraded or
  skipped entries when no better material rows exist
- `context`: reinforced or carried important items, detail-only

Fallback order:

1. Use `entry.events` for grouped rows with before/after values.
2. If structured events are missing or unusable, derive text-only partial rows
   from `payload.report_views.thin.sections` or legacy `sections`.
3. If only quality metadata exists, return `diff_quality = 'unavailable'` with
   quality warnings and no fake material rows.
4. Detect repair entries from `payload.repair.is_repair`.

Special states:

- `baseline`: `has_comparison = false`. It can still show added rows if baseline
  initialization events include tracked items.
- `degraded`: `diff_quality = 'partial'` and warnings explain that a complete
  diff was not possible.
- `skipped`: `diff_quality = 'unavailable'`; render reason and quality metadata
  only.
- `repair`: `is_repair = true`; render a repair badge and a small repair context
  section from `payload.repair`.

Severity mapping:

- Raw `critical` remains `critical`.
- Raw `medium` maps to `warning`.
- Raw `low` maps to `info`.
- `risk_*`, `invalidation_*`, `level_invalidated`, and `data_quality_changed`
  are at least `warning`.
- `claim_weakened` is `warning` when evidence or source quality is missing;
  otherwise it is `info`.
- Degraded and skipped banners are `warning`, not `critical`.

## Web UI

### Entry Detail

Keep the existing top summary panel. Place a new full-width `Material Changes`
section immediately after Summary.

Group order:

1. Added
2. Updated
3. Removed or Resolved
4. Weakened
5. Quality
6. Important Context, when present

Each row renders:

- group/type badge
- title
- before value
- after value
- severity badge
- evidence/source line

If `diff_quality` is `partial` or `unavailable`, show a concise warning banner
above the rows. If the entry is repair-created, show a repair badge and repair
context near the diff report.

`Readable Digest`, `Quality`, `Evidence Digest`, `State Transition`, material
events, and debug access remain available below the diff section as supporting
context.

### Entry List

Each continuity entry row keeps existing entry type and status badges, then adds
badges from `diff_summary`:

- `+N added`
- `N updated`
- `N resolved`
- `N weakened`
- `degraded`
- `skipped`
- `repair`
- `no material change`

The list does not show `context` counts. Its job is to reveal whether an entry
contains material change before the user opens it.

## Error Handling And Degraded Clarity

The UI must not present partial or unavailable diffs as complete deltas.

Rules:

- Missing structured events do not break the detail page.
- Legacy entries render a partial text fallback when possible.
- Degraded snapshots clearly state that there is not enough data for a complete
  diff.
- Skipped entries avoid invented change rows.
- Unknown event types are ignored unless they can be safely mapped to a quality
  or context row.

## Testing

API tests should cover:

- Added, updated, removed/resolved, weakened, and quality groups from events.
- Baseline entries set `has_comparison = false`.
- Degraded entries set `diff_quality = 'partial'` and include a warning.
- Skipped entries set `diff_quality = 'unavailable'`.
- Repair entries set `is_repair = true` and include a repair badge.
- Legacy sections fallback creates partial text rows.
- Summary counts match the grouped changed items.
- Unknown events do not crash normalization.

Frontend tests should be added where the existing setup supports them cleanly:

- List rows render count and state badges from `diff_summary`.
- Entry detail renders Material Changes immediately after Summary.
- Degraded and skipped warnings are visible.

Manual smoke:

1. Open `/research-continuity?symbol=BTC%2FUSDT`.
2. Confirm continuity rows show count/state badges.
3. Open a continuity entry detail page.
4. Confirm Material Changes appears immediately after Summary.
5. Confirm degraded, skipped, and repair states are explicit when present.

## Acceptance Criteria

- Continuity list entries expose compact change badges without loading debug data.
- Continuity entry detail exposes a stable full diff report with grouped rows.
- Baseline, degraded, skipped, repair, and legacy entries render without crashing.
- Degraded or unavailable diffs are clearly labeled.
- The implementation remains additive to existing API responses.
- No database migration, backfill, or large delta engine rewrite is required.
