# Research Continuity V1.1 Snapshot Quality And Evidence Trace Implementation Plan

Last updated: 2026-05-28
Status: goal-ready

V1.1 enriches the Research Continuity baseline with deterministic claim
extraction, source/evidence traceability, stable item identity, lightweight
lifecycle metadata, and an MVP `/research-continuity` workspace.

## Goal-Ready Prompt

```text
/goal Implement Research Continuity V1.1 end-to-end.

Read this document first:
docs/features/research-continuity/v1.1/implementation-plan.md

Objective:
- Improve Research Continuity snapshots and reports so users can trust and
  trace tracked claims, risks, watchpoints, invalidations, and levels across
  runs for one symbol.

Required behavior:
- Extract tracked claim items from structured thesis reason fields.
- Attach source/evidence/trace metadata to every tracked item when available.
- Improve deterministic item identity without causing fake added/resolved churn.
- Add lightweight lifecycle metadata to active continuity items.
- Add update events when the same item persists but its wording or attributes
  change.
- Add data quality and provenance coverage metrics.
- Add an MVP `/research-continuity` symbol-first, read-only workspace.

Do not implement:
- LLM parsing, embeddings, fuzzy semantic merge, or full-text thesis parsing.
- New DB tables, DB indexes, graph schema, or node explorer.
- Automatic backfill or silent regeneration of old continuity history.
- Multi-symbol dashboard, timeline graph, provenance drilldown, or filters.
- Symbol-level market correctness, PnL evaluation, or Calibration Lab logic.
- Research-core prompt/output changes unless a field already exists and can be
  consumed safely.

Definition of done:
- V1.1 snapshots include claim items, source trace, evidence when available,
  trace quality, identity confidence, canonical text, identity terms, and
  quality coverage metrics.
- Delta computation does not fake resolved/added when a V1 item matches through
  legacy identity or when a V1.1 item has the same stable identity.
- Same-identity item changes produce `*_updated` events with a small structured
  diff.
- Continuity state active items preserve first/last seen metadata and occurrence
  counts.
- `/research-continuity` renders a read-only single-symbol workspace with
  current view, trust/quality summary, active items, latest report, and recent
  entries.
- Focused backend tests and web typecheck pass, or exact blockers are
  documented.
```

## One Outcome

Make Research Continuity trustworthy enough for users to inspect why a symbol's
research view changed, what stayed alive, and where each tracked item came from.

V1.1 is not a graph release. It prepares structured data that can become graph
nodes later, while keeping the current runtime centered on `item_key`,
continuity events, and symbol state.

## Verifiable End State

- [ ] `ResearchSnapshotBuilder` creates `claim` tracked items from structured
      reason fields.
- [ ] Every tracked item has best-effort provenance fields:
      `source_artifact`, `source_id`, and `source_field`.
- [ ] Tracked items include `canonical_text`, `identity_terms`,
      `identity_confidence`, `trace_quality`, and `legacy_item_key`.
- [ ] `supporting_evidence` is attached as evidence metadata when present, but
      is not created as a separate tracked item.
- [ ] Item identity matching prevents fake `resolved + added` churn for V1
      legacy keys and V1.1 stable keys.
- [ ] Same-identity wording/detail changes produce `claim_updated`,
      `risk_updated`, `watchpoint_updated`, `invalidation_updated`, or
      `level_updated`.
- [ ] Continuity state active items include lightweight lifecycle metadata:
      `first_seen_at`, `first_seen_run_id`, `last_seen_at`,
      `last_seen_run_id`, `occurrence_count`, `previous_text`, and
      `current_text`.
- [ ] `data_quality` includes item counts, source coverage, evidence coverage,
      fallback identity ratio, and provenance status.
- [ ] The rendered report includes grouped material changes, source/evidence
      trace summary, and data quality notes.
- [ ] Web route `/research-continuity` exists and presents a single-symbol
      read-only workspace.
- [ ] Validation commands pass, or blockers are documented.

## Version Placement

```text
V1     Baseline post-research continuity loop.
V1.0.1 Auto-run patch for JobsService and BullMQ worker paths.
V1.1   Snapshot quality, evidence trace, identity stability, MVP workspace.
V1.2   Optional research-core evidence output improvements after observing
       V1.1 coverage.
V1.3   Explicit backfill/repair tooling if needed.
V2.x   Graph/timeline/provenance explorer and multi-symbol dashboard.
```

V1.1 must not absorb V1.2, V1.3, or V2 work.

## Relevant Context

V1 baseline expected behavior:

- Completed research runs can generate continuity entries.
- Research snapshots, continuity entries, and continuity states are persisted.
- A delta engine compares current snapshot against previous symbol state.
- A report renderer creates human-readable sections from structured events.
- V1.0.1 has patched actual job paths so continuity generation can auto-run
  after research completion.

Important implementation note:

```text
If the V1 baseline files are not present in the working branch, stop and report.
Do not re-implement V1 inside this V1.1 goal.
```

Files to inspect first:

```text
docs/goal-skill.md
docs/features/research-continuity/README.md
apps/api/src/research-continuity/research-snapshot.builder.ts
apps/api/src/research-continuity/continuity-delta.engine.ts
apps/api/src/research-continuity/continuity-state.projector.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/routes/index.tsx
apps/web/src/navigation/nav-groups.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Likely files to change:

```text
apps/api/src/research-continuity/research-snapshot.builder.ts
apps/api/src/research-continuity/continuity-delta.engine.ts
apps/api/src/research-continuity/continuity-state.projector.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/routes/index.tsx
apps/web/src/navigation/nav-groups.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

## Data Shape

### Tracked Item V1.1

Tracked items remain JSON records. Do not add a table in V1.1.

Example:

```json
{
  "item_key": "claim:market_structure:2f8a91db3c77",
  "legacy_item_key": "claim:8c9ad5e5a0d1",
  "item_key_version": "v1.1",
  "type": "claim",
  "topic": "market_structure",
  "status": "active",
  "text": "Market structure remains the main driver.",
  "canonical_text": "market structure remains main driver",
  "identity_terms": ["market_structure", "main_driver"],
  "identity_confidence": "high",
  "trace_quality": "sourced",
  "importance": "medium",
  "attributes": {},
  "evidence": [],
  "source_artifact": "thesis",
  "source_id": "thesis_123",
  "source_field": "summary.key_reasons[0]"
}
```

Do not add `node_key` in V1.1. Node/graph naming is future work.

### Source Fields To Consume

Claim sources:

```text
thesis.summary.key_reasons[]
thesis.summary.why_this_thesis
thesis.why_this_thesis
thesis.payload.structured_summary.key_reasons[]
thesis.payload.structured_summary.why_this_thesis
```

Evidence sources:

```text
thesis.summary.supporting_evidence[]
thesis.supporting_evidence[]
thesis.payload.structured_summary.supporting_evidence[]
agentOpinion.payload.evidence[]
agentOpinion.payload.supporting_evidence[]
```

Existing non-claim tracked items remain:

```text
risk          <- thesis risks and agent opinion risks
watchpoint    <- monitor_next
invalidation  <- invalidation fields
level         <- target_zones
```

Do not parse:

```text
full thesis_text
arbitrary markdown body
free-form action_summary as claim
```

### Dedupe Priority

If the same canonical identity appears in multiple item types, keep the more
specific operational type.

Priority:

```text
invalidation
risk
watchpoint
level
claim
```

Example: if the same funding text appears in both `summary.key_reasons` and
`summary.risks`, keep the `risk` item and do not duplicate it as `claim`.

### Identity Rules

Identity must be deterministic and conservative.

Allowed:

```text
lowercase
trim punctuation
normalize whitespace
normalize simple price/number tokens
remove very small stopword set
use safe crypto keyword buckets only when obvious
```

Examples of safe topic/identity terms:

```text
funding / perp funding / funding rates -> funding
late longs / long entries / chasing longs -> long_entry
break below / lost support / breakdown -> break_below
market structure -> market_structure
spot bid / spot demand -> spot_demand
open interest / OI -> open_interest
```

Disallowed:

```text
LLM merge
embedding similarity
Levenshtein/fuzzy matching
merging by symbol/date only
merging funding and open interest as one item
```

If identity terms are not confident, fall back to a hash of canonical text.
Fallback identity is acceptable but must be visible through
`identity_confidence` and quality metrics.

### Trace Quality

Per item:

```text
evidence_backed = source present and evidence attached
sourced          = source present but no evidence attached
unsourced        = source missing
```

Identity confidence:

```text
high   = topic and identity_terms are clear enough for stable key
medium = canonical hash fallback with adequate text
low    = text is too short, generic, or weakly sourced
```

These are traceability ratings, not truth/correctness scores.

### Snapshot Quality Metrics

Extend `data_quality` without making evidence a blocker:

```json
{
  "tracked_item_count": 8,
  "claim_count": 3,
  "risk_count": 2,
  "watchpoint_count": 1,
  "level_count": 1,
  "invalidation_count": 1,
  "sourced_item_count": 8,
  "unsourced_item_count": 0,
  "source_coverage": 1,
  "evidence_attached_count": 3,
  "evidence_coverage": 0.38,
  "identity_quality": {
    "stable_key_count": 6,
    "fallback_hash_count": 2,
    "fallback_hash_ratio": 0.25,
    "high_confidence_identity_count": 6
  },
  "provenance_status": "clean",
  "provenance_reasons": []
}
```

Do not skip or degrade solely because evidence coverage is low. Report it.

## Delta Rules

### Matching

When comparing previous active items and current snapshot items, match by:

```text
1. item_key exact match
2. legacy_item_key against previous item_key
3. previous legacy_item_key against current item_key if both exist
```

This avoids fake `resolved + added` churn after V1.1 key changes.

### Update Events

If identity matches but `text`, `canonical_text`, `attributes`, or evidence
summary changes, emit one of:

```text
claim_updated
risk_updated
watchpoint_updated
invalidation_updated
level_updated
```

Event payload should include:

```json
{
  "changed_fields": ["text", "attributes.intensity"],
  "changed_attributes": {
    "intensity": { "from": "slight", "to": "extreme" }
  },
  "previous_text": "Funding is slightly elevated.",
  "current_text": "Funding is extremely overheated.",
  "source": {
    "source_artifact": "thesis",
    "source_id": "thesis_456",
    "source_field": "summary.risks[0]"
  }
}
```

Do not add separate event types for evidence/source/trace changes in V1.1.
Store those details in the `*_updated` payload.

## State Lifecycle Metadata

When projecting state, active items should preserve lightweight lifecycle fields:

```json
{
  "first_seen_at": "2026-05-20T10:00:00.000Z",
  "first_seen_run_id": "run_1",
  "last_seen_at": "2026-05-21T10:00:00.000Z",
  "last_seen_run_id": "run_2",
  "occurrence_count": 2,
  "previous_text": "Funding is slightly elevated.",
  "current_text": "Funding is extremely overheated."
}
```

If a previous legacy item lacks lifecycle fields, use the best available
fallback:

```text
first_seen_at     <- previous state's updated_at or current snapshot captured_at
first_seen_run_id <- previous state's latest_run_id or current run id
occurrence_count  <- 1 before increment
```

Do not attempt historical reconstruction or backfill in V1.1.

## Report Rules

Group report sections for readability:

```text
1. Summary
2. Current View
3. Material Changes
4. Reinforced And Updated Claims
5. Risks And Invalidations
6. Watchpoints And Levels
7. Resolved Or Weakened Items
8. Source And Evidence Trace
9. Data Quality
```

Avoid spamming unchanged carried events. Prefer material changes and concise
coverage summaries.

The report should expose:

```text
source coverage
evidence coverage
fallback identity count
legacy snapshot notes
notable low-trace items
updated item text diffs when available
```

## UI MVP

Route:

```text
/research-continuity
```

Nav:

```text
Luna Research -> Research Continuity
```

The page is a read-only single-symbol workspace.

First screen:

```text
Symbol input: BTC/USDT

Current View:
- directional bias
- risk posture
- conviction
- time context
- latest run / latest entry

Trust And Quality:
- snapshot status
- source coverage
- evidence coverage
- stable identity coverage
- fallback identity count

Active Items:
- claims
- risks
- watchpoints
- invalidations
- levels
- trace badges

Latest Delta Report:
- report sections
- material events

Recent Entries:
- last 10 continuity entries for the symbol
```

Do not add generate/backfill actions on this page in V1.1. Manual generation
stays in the run detail/workspace flow.

## Constraints And Non-Goals

Explicitly do not:

- use LLMs, embeddings, or fuzzy semantic matching;
- parse arbitrary thesis text;
- add DB schema/tables/indexes;
- add graph/node UI or a node table;
- add automatic backfill;
- add a multi-symbol dashboard;
- add scheduler/background jobs;
- change calibration or market outcome evaluation;
- change research generator prompts or required output schema;
- silently rewrite old continuity entries.

## Implementation Checklist

- [ ] Confirm V1/V1.0.1 baseline files exist in the branch.
- [ ] Add helper logic for structured claim/evidence extraction.
- [ ] Add deterministic canonicalization, topic/identity terms, and legacy key
      computation.
- [ ] Add trace quality and identity confidence metadata per tracked item.
- [ ] Add dedupe by canonical identity with type priority.
- [ ] Add snapshot quality coverage metrics.
- [ ] Update delta engine matching to use `item_key` and `legacy_item_key`.
- [ ] Add `*_updated` event generation for same-identity changed items.
- [ ] Add lifecycle metadata preservation in state projector.
- [ ] Update report renderer section grouping and quality/provenance lines.
- [ ] Add or update DTO/contract types only as needed for enriched JSON shape.
- [ ] Add `/research-continuity` route and nav item.
- [ ] Add or finish `ResearchContinuityPage` as a single-symbol read-only
      workspace.
- [ ] Add focused tests.
- [ ] Run validation commands.

## Required Tests

Backend tests:

- [ ] Extracts `claim` items from `summary.key_reasons`.
- [ ] Adds `source_artifact`, `source_id`, and `source_field` to tracked items.
- [ ] Attaches supporting evidence when structured evidence exists.
- [ ] Computes `source_coverage`, `evidence_coverage`, and identity quality
      metrics.
- [ ] Matches a previous V1 item through `legacy_item_key` without producing
      fake `resolved + added`.
- [ ] Emits `risk_updated` or `claim_updated` when same identity has changed
      text/details.
- [ ] Preserves and increments lifecycle metadata in continuity state.
- [ ] Treats missing evidence as reportable quality metadata, not a blocker.

Web checks:

- [ ] `/research-continuity` route compiles.
- [ ] Navigation item points to `/research-continuity`.
- [ ] Page renders symbol input, current view, quality summary, active items,
      latest report, and recent entries from existing API responses.

No required tests:

- graph;
- backfill;
- multi-symbol dashboard;
- LLM parsing;
- Calibration Lab market validation.

## Validation Loop

Automated checks:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Run or use an existing completed research run with continuity generation.
- Open `/research-continuity`.
- Load `BTC/USDT`.
- Confirm latest state, active items, quality metrics, report sections, and
  recent entries render.
- Confirm legacy entries without V1.1 fields show low/legacy trace information
  instead of breaking the UI.
- Confirm manual generate still belongs to run detail/workspace, not the symbol
  page.

## Checkpoint Behavior

Work milestone by milestone:

1. Verify V1 baseline exists.
2. Snapshot builder claim/evidence/provenance enrichment.
3. Identity matching and update events.
4. State lifecycle metadata.
5. Report renderer quality/provenance sections.
6. MVP `/research-continuity` route/page/nav.
7. Tests and validation.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- preserve unrelated dirty worktree changes;
- keep scope inside V1.1;
- stop only when the objective is met or a blocker is explicit.

## Stop Rules

Stop and report instead of expanding scope when:

- V1 baseline files are missing from the branch;
- implementing a step requires LLM parsing, embeddings, graph UI, DB schema
  changes, automatic backfill, or multi-symbol dashboard work;
- existing code contradicts the matching/state model in this plan;
- validation fails for an external/environment reason;
- the objective is already met.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/research-continuity/v1.1/implementation-plan.md first and
treat it as the source of truth for Research Continuity V1.1.

Implement only V1.1 Snapshot Quality And Evidence Trace. Confirm the V1 and
V1.0.1 baseline continuity code exists before editing. If it is missing, stop
and report instead of rebuilding V1.

Do not use LLM parsing, embeddings, fuzzy semantic matching, DB schema changes,
automatic backfill, graph/node UI, multi-symbol dashboard, scheduler jobs, or
Calibration Lab market validation.

Before editing, inspect the files listed in "Files to inspect first". Follow
existing NestJS, repository, contract, React Query, routing, and CSS patterns.
Preserve unrelated dirty worktree changes.

Ask only if the codebase contradicts this plan or if required context is
missing.
```

## Definition Of Done

- Research snapshots contain enriched claim/provenance/evidence/identity
  metadata.
- Snapshot quality reports source, evidence, and identity coverage without
  blocking on missing evidence.
- Delta matching preserves continuity across V1 to V1.1 key changes.
- Same-identity text/detail changes are represented as update events.
- State active items carry lightweight lifecycle metadata.
- Report sections expose material changes, source/evidence trace, and data
  quality.
- `/research-continuity` is available as a read-only single-symbol MVP
  workspace.
- Required tests and validation commands pass, or blockers are documented.
