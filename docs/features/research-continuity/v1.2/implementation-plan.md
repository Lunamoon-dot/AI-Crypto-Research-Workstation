# Research Continuity V1.2 Research Evidence Contract Implementation Plan

Last updated: 2026-05-28
Status: implemented

V1.2 improves the source data that Research Continuity depends on. V1.1 made
continuity snapshots capable of carrying provenance, evidence, trace quality,
identity confidence, and item lifecycle metadata. V1.2 makes the research output
contract produce and preserve structured evidence consistently enough for that
continuity layer to become trustworthy.

## Goal-Ready Prompt

```text
/goal Implement Research Continuity V1.2 end-to-end.

Read this document first:
docs/features/research-continuity/v1.2/implementation-plan.md

Objective:
- Add a normalized research evidence contract so research outputs can preserve
  item-level observed, reasoning, and missing evidence for claims, risks, and
  watchpoints without breaking legacy thesis APIs.

Required behavior:
- Support object-first evidence items with `text`, `evidence_kind`, source
  artifact metadata, and optional strength.
- Support object-first reason/risk/watchpoint items with item-level
  `supporting_evidence`.
- Keep legacy string arrays working for existing research outputs and public
  response fields.
- Add a strict normalization layer at the API/research boundary so malformed
  evidence is normalized or safely degraded instead of crashing.
- Preserve normalized object reasons/evidence inside `structured_summary`.
- Update continuity snapshot building to attach item-level evidence first, then
  fall back to global evidence.
- Add evidence quality metrics for observed, reasoning-only, missing-limited,
  and no-evidence tracked items.
- Add small `/research-continuity` UI improvements to inspect evidence quality
  and evidence lines for active items.

Do not implement:
- New DB tables, schema resets, graph/node tables, or indexes.
- Automatic backfill or migration of historical research payloads.
- Public thesis DTO breaking changes from string arrays to object arrays.
- New LLM agent, embeddings, fuzzy matching, semantic merge, or graph UI.
- Multi-symbol dashboard, provenance drilldown page, or source artifact detail
  page.
- Calibration, PnL, market correctness, or thesis outcome evaluation logic.
- A dev reset script or automated data deletion workflow.

Definition of done:
- Research output normalization accepts both legacy string arrays and new object
  arrays for reasons, risks, watchpoints, and supporting evidence.
- Normalized `structured_summary` preserves item-level evidence objects.
- Public legacy fields still expose string arrays where the app currently
  expects them.
- Continuity snapshots attach the correct item-level evidence to each tracked
  claim/risk/watchpoint and avoid globally attaching unrelated evidence when
  item evidence exists.
- Snapshot quality includes observed/reasoning/missing evidence coverage
  metrics and per-item evidence quality.
- `/research-continuity` shows evidence quality badges and evidence lines
  without adding a new page or graph.
- Focused API tests, API build, and web typecheck pass, or exact blockers are
  documented.
```

## One Outcome

Make research outputs evidence-aware at the structured summary boundary.

After V1.2, a research run should be able to produce claims, risks, and
watchpoints that carry their own supporting evidence. Research Continuity can
then trace each tracked item to observed data, reasoning, or missing-data
limitations without guessing from prose.

## Verifiable End State

- [x] A normalized evidence item supports:
      `text`, `evidence_kind`, `source_artifact`, `source_id`,
      `source_field`, `evidence_type`, and `strength`.
- [x] Allowed `evidence_kind` values are:
      `observed`, `reasoning`, and `missing`.
- [x] Allowed V1.2 `source_artifact` values are:
      `market_snapshot`, `signal_snapshot`, `trade_thesis`, `agent_opinion`,
      `research_debate`, `research_run`, `external_report`, and `unknown`.
- [x] `structured_summary.key_reasons`, `structured_summary.risks`, and
      `structured_summary.monitor_next` can be legacy string arrays or object
      arrays with `text` and `supporting_evidence`.
- [x] The normalizer preserves object arrays internally and can still extract
      string text for legacy public fields.
- [x] Invalid evidence objects do not crash the API; they are dropped,
      normalized to `unknown`, or converted to missing/reasoning evidence
      according to deterministic rules.
- [x] Continuity builder attaches item-level evidence to the matching tracked
      item.
- [x] Continuity builder falls back to global evidence only when an item has no
      item-level evidence.
- [x] Continuity tracked items include `evidence_quality`:
      `observed_backed`, `reasoning_only`, `missing_limited`, or `none`.
- [x] Snapshot `data_quality` includes observed, reasoning, missing, and
      no-evidence counts/coverage.
- [x] Public thesis and web UI contracts that currently expect `string[]` do
      not break.
- [x] `/research-continuity` can show evidence quality and evidence lines for
      active items.
- [x] Validation commands pass, or blockers are documented.

## Implementation Verification

Verified on 2026-05-28:

- `pnpm --filter @lunaperception/api test`
- `pnpm build:api`
- `pnpm --filter @lunaperception/web typecheck`
- `node apps\ai-service\scripts\python.cjs -m pytest apps\ai-service\tests\test_thesis_explainability.py`
- Local API smoke against `BTC/USDT` continuity state and entries returned HTTP
  200 with real continuity records.
- Browser smoke for `/research-continuity?symbol=BTC%2FUSDT` rendered current
  view, latest delta, trust/evidence, tracked items, and recent entries without
  app console errors.

## Version Placement

```text
V1     Baseline post-research continuity loop.
V1.0.1 Auto-run patch for JobsService and BullMQ worker paths.
V1.1   Snapshot quality, evidence trace, identity stability, MVP workspace.
V1.2   Research Evidence Contract.
V1.3   Explicit backfill or repair tooling if needed.
V2.x   Timeline, graph/node model, provenance explorer, and multi-symbol views.
```

V1.2 should deepen evidence correctness. It must not absorb graph, backfill,
multi-symbol, or calibration work.

## Relevant Context

Supporting materials:

- [docs/goal-skill.md](../../../goal-skill.md)
- [docs/features/research-continuity/README.md](../README.md)
- [docs/features/research-continuity/v1.1/implementation-plan.md](../v1.1/implementation-plan.md)
- [docs/features/calibration-lab/README.md](../../calibration-lab/README.md)

Current repo facts:

- V1.1 continuity snapshots already support evidence arrays, source metadata,
  trace quality, identity confidence, and data quality coverage metrics.
- V1.1 consumes legacy `supporting_evidence` if present, but the research core
  does not yet have a strong evidence contract.
- Many API/frontend thesis response fields still expect `string[]` for reasons,
  risks, targets, and monitor items.
- `TradeThesis.payload_json` and `structured_summary` JSON can carry object
  arrays without a DB schema change.
- Existing local DB data can be ignored or reset manually if it blocks local
  validation, but V1.2 must not add automatic data deletion behavior.

Files to inspect first:

```text
apps/ai-service
apps/api/src/jobs/python-engine.client.ts
apps/api/src/jobs/research-job.processor.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/src/research-continuity/research-snapshot.builder.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/types/index.ts
```

Likely files to change:

```text
apps/ai-service/**
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/src/research-continuity/research-snapshot.builder.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/types/index.ts
```

If the engine contract is defined elsewhere, update the smallest existing
schema/prompt/parser surface that controls generated thesis structured
summaries. Do not invent a parallel research output system.

## Evidence Contract

### Evidence Item

Object-first shape:

```json
{
  "text": "BTC reclaimed the prior range and held above it into close.",
  "evidence_kind": "observed",
  "source_artifact": "market_snapshot",
  "source_id": "market_btc_20260528",
  "source_field": "payload.market_structure",
  "evidence_type": "market_structure",
  "strength": "medium"
}
```

Required after normalization:

```text
text
evidence_kind
source_artifact
```

Optional:

```text
source_id
source_field
evidence_type
strength
```

Allowed `evidence_kind`:

```text
observed
reasoning
missing
```

Meanings:

```text
observed:
  Derived from a persisted market/signal/debate/run artifact or a specific
  source field.

reasoning:
  Agent interpretation, synthesis, or conclusion that is useful but not directly
  traceable to one source field.

missing:
  A known data gap or limitation that affects confidence in the item.
```

Allowed `source_artifact`:

```text
market_snapshot
signal_snapshot
trade_thesis
agent_opinion
research_debate
research_run
external_report
unknown
```

Allowed `strength`:

```text
low
medium
high
unknown
```

Do not invent source artifact types for systems that are not persisted yet.
For example, do not add `tweet`, `funding_feed`, `orderbook_snapshot`, or
`onchain_metric` until those artifacts exist as durable sources.

### Structured Research Item

Object-first shape for key reasons, risks, and watchpoints:

```json
{
  "text": "Market structure improved after reclaiming the prior range.",
  "supporting_evidence": [
    {
      "text": "Price reclaimed the prior range and held above it into close.",
      "evidence_kind": "observed",
      "source_artifact": "market_snapshot",
      "source_field": "payload.market_structure",
      "strength": "medium"
    }
  ],
  "confidence": "medium"
}
```

Risk example:

```json
{
  "text": "Funding remains crowded.",
  "severity": "medium",
  "supporting_evidence": [
    {
      "text": "Perp funding stayed above its recent baseline.",
      "evidence_kind": "observed",
      "source_artifact": "signal_snapshot",
      "source_field": "payload.funding",
      "strength": "medium"
    }
  ]
}
```

Watchpoint example:

```json
{
  "text": "Watch whether BTC accepts above resistance.",
  "trigger": "daily close above resistance",
  "supporting_evidence": [
    {
      "text": "Prior rejection zone remains overhead.",
      "evidence_kind": "reasoning",
      "source_artifact": "trade_thesis",
      "strength": "medium"
    }
  ]
}
```

Legacy strings remain valid:

```json
{
  "key_reasons": ["Market structure improved after reclaiming the prior range."],
  "risks": ["Funding remains crowded."],
  "monitor_next": ["Watch whether BTC accepts above resistance."]
}
```

The normalizer should convert string values into internal item records with
`text` and no item-level evidence. Continuity can then fall back to global
evidence, or mark the item `none` / `reasoning_only`.

### Structured Summary Placement

Normalized evidence stays in `structured_summary`.

Do not add a second source of truth such as:

```text
normalized_evidence_summary
```

Preferred internal payload:

```json
{
  "structured_summary": {
    "key_reasons": [
      {
        "text": "Market structure improved after reclaiming the prior range.",
        "supporting_evidence": [
          {
            "text": "Price reclaimed the prior range.",
            "evidence_kind": "observed",
            "source_artifact": "market_snapshot"
          }
        ]
      }
    ],
    "risks": [],
    "monitor_next": [],
    "supporting_evidence": []
  }
}
```

Raw engine output can remain in the existing raw/debug payload fields if the
repo already stores them. Do not add a duplicate normalized summary just for
V1.2.

## Normalization Rules

Add or reuse a boundary normalizer that applies deterministic rules:

```text
string evidence:
  -> { text, evidence_kind: "reasoning", source_artifact: "trade_thesis" }

object evidence with text but missing evidence_kind:
  -> evidence_kind = "reasoning"

object evidence with text but unknown source_artifact:
  -> source_artifact = "unknown"

object evidence with evidence_kind outside allowed enum:
  -> evidence_kind = "reasoning"

object evidence missing text:
  -> drop if no useful text-like field exists
  -> otherwise map first useful field to text

object item with text:
  -> preserve object shape and normalized supporting_evidence

string item:
  -> { text, supporting_evidence: [] }
```

Useful text-like fields for fallback:

```text
text
summary
reason
description
message
```

Do not crash on malformed arrays. Normalize what is safe, drop what cannot be
represented, and add a deterministic warning only if the surrounding code
already has a warning channel.

## Continuity Consumption Rules

V1.2 should update the continuity builder to consume richer item-level evidence.

For each tracked item:

```text
1. Use the item's own supporting_evidence if present.
2. Else use global structured_summary.supporting_evidence.
3. Else use existing legacy thesis/opinion evidence fallback.
4. Else attach no evidence.
```

Do not attach every global evidence item to every tracked item if the item has
its own evidence. Global evidence is only a fallback.

Per tracked item, add:

```text
evidence_quality
observed_evidence_count
reasoning_evidence_count
missing_evidence_count
```

Allowed `evidence_quality`:

```text
observed_backed
reasoning_only
missing_limited
none
```

Rules:

```text
observed_backed:
  at least one evidence item has evidence_kind = observed

missing_limited:
  no observed evidence and at least one evidence item has evidence_kind = missing

reasoning_only:
  no observed/missing evidence and at least one reasoning evidence exists

none:
  no evidence
```

Snapshot `data_quality` should include:

```json
{
  "observed_evidence_count": 4,
  "reasoning_evidence_count": 3,
  "missing_evidence_count": 1,
  "observed_evidence_coverage": 0.5,
  "reasoning_only_item_count": 2,
  "missing_evidence_item_count": 1,
  "no_evidence_item_count": 1
}
```

Missing observed evidence must not block snapshot creation. It should affect
quality reporting only.

## API And Public Compatibility

Do not break public thesis response fields that currently expose string arrays.

If the current public contract has:

```ts
key_reasons: string[];
risks: string[];
monitor_next: string[];
```

keep those fields as string arrays by extracting `.text` from object items.

Object evidence should be preserved internally in payload JSON and surfaced
through continuity artifacts first:

```text
ResearchSnapshot.tracked_items[].evidence
ResearchSnapshot.tracked_items[].evidence_quality
ResearchContinuityEntry.sections
ResearchContinuityState.active_items[]
```

Do not broadly convert Thesis Detail, Watchlists, Briefs, Calibration, or other
pages to object arrays in V1.2.

If adding public enriched thesis fields is cheap and follows an existing
pattern, they must be additive and optional. Do not make them required.

## UI MVP

Update only `/research-continuity`.

Add small inspection improvements:

```text
Active item badges:
  observed-backed
  reasoning-only
  missing-limited
  no-evidence
  source artifact

Expandable evidence lines:
  [observed][market_snapshot] BTC reclaimed prior range.
  [reasoning][agent_opinion] Analyst judged spot bid as constructive.
  [missing][research_run] Funding data unavailable.

Trust panel metrics:
  observed evidence coverage
  reasoning-only item count
  missing evidence item count
  no-evidence item count
```

Do not add:

```text
new page
graph view
source artifact detail page
filtering/sorting by evidence
multi-symbol dashboard
manual backfill/generate action
```

## Constraints And Non-Goals

Explicitly do not:

- add DB tables, indexes, or schema resets;
- add automatic backfill;
- migrate historical payloads;
- create a data deletion or reset script;
- break public string-array thesis fields;
- add graph/node schema or UI;
- add embeddings, fuzzy matching, or semantic merge;
- add a new LLM agent;
- implement Calibration, PnL, symbol correctness, or thesis outcome evaluation;
- build a multi-symbol dashboard;
- expand beyond the smallest research output contract, API normalization,
  continuity consumption, and continuity UI inspection changes.

## Implementation Checklist

- [ ] Locate the existing research output schema, prompt, parser, or summary
      construction path.
- [ ] Define local TypeScript/Python types or validators for evidence items and
      structured research items in the existing pattern.
- [ ] Update research output generation guidance/schema so item-level evidence
      can be produced.
- [ ] Add a deterministic normalizer for legacy strings and new object items.
- [ ] Preserve normalized object arrays in `structured_summary`.
- [ ] Keep public legacy string fields mapped from `.text`.
- [ ] Update continuity builder to read item-level evidence before global
      evidence.
- [ ] Add `evidence_quality` and evidence kind counts per tracked item.
- [ ] Extend snapshot quality with observed/reasoning/missing/no-evidence
      metrics.
- [ ] Update report renderer to mention observed/reasoning/missing evidence
      coverage where useful.
- [ ] Update `/research-continuity` UI badges and evidence line display.
- [ ] Add focused tests.
- [ ] Run validation commands.

## Required Tests

Normalizer tests:

- [ ] Legacy `string[]` reasons and evidence normalize without crashing.
- [ ] Object `key_reasons[]` with item-level evidence is preserved.
- [ ] Object `risks[]` and `monitor_next[]` with item-level evidence are
      preserved.
- [ ] Invalid evidence kind falls back to `reasoning`.
- [ ] Unknown source artifact falls back to `unknown`.
- [ ] Evidence objects missing text are dropped or normalized from a safe
      text-like field.

Persistence/API compatibility tests:

- [ ] `TradeThesis.payload_json.structured_summary` preserves object evidence.
- [ ] Public thesis summary response still exposes legacy `key_reasons:
      string[]`.
- [ ] Existing thesis/watchlist/brief/calibration tests continue to pass without
      object-array breaking changes.

Continuity integration tests:

- [ ] Item-level observed evidence attaches only to the matching claim/risk.
- [ ] Global evidence is used only as fallback when item-level evidence is
      absent.
- [ ] Tracked items include `evidence_quality`.
- [ ] Snapshot quality includes observed/reasoning/missing/no-evidence metrics.
- [ ] Missing observed evidence does not block snapshot or state creation.
- [ ] Report/sections mention evidence quality coverage.

Web checks:

- [ ] `/research-continuity` route compiles.
- [ ] Active items show evidence quality badges.
- [ ] Evidence lines render when present.
- [ ] Existing pages that expect legacy string arrays still typecheck.

No required tests:

- graph;
- backfill;
- multi-symbol dashboard;
- Playwright;
- DB migration, unless the implementation unexpectedly touches schema.

## Validation Loop

Automated checks:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

If Python research output code changes, also run the smallest relevant Python
tests. Prefer the repo virtual environment if system Python lacks dependencies:

```bash
.venv\Scripts\python.exe -m pytest apps/ai-service
```

Manual checks:

- Use or seed a research run whose structured summary contains object
  `key_reasons`, `risks`, `monitor_next`, and item-level evidence.
- Generate continuity for that run.
- Open `/research-continuity?symbol=BTC%2FUSDT`.
- Confirm active items show evidence quality badges.
- Expand or inspect at least one item and confirm evidence lines render.
- Confirm public thesis/detail views still show readable string reasons.
- Confirm no UI claims the thesis or symbol was correct/incorrect.

## Checkpoint Behavior

Work milestone by milestone:

1. Inspect research output construction and existing mappers.
2. Add evidence/item normalizer and contract types.
3. Preserve object evidence in `structured_summary`.
4. Maintain legacy public string-array fields.
5. Update continuity builder evidence attachment and metrics.
6. Update report and `/research-continuity` UI inspection.
7. Add tests and run validation.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- preserve unrelated dirty worktree changes;
- keep scope inside V1.2;
- stop only when the objective is met or a blocker is explicit.

## Stop Rules

Stop and report instead of expanding scope when:

- implementing the next step requires a DB table/schema reset;
- implementing the next step requires graph/node UI;
- implementing the next step requires automatic backfill or historical
  migration;
- implementing the next step requires a public DTO breaking change;
- the research output construction path cannot be located safely;
- validation fails for external/environment reasons;
- V1.2's evidence contract objective is already met.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/research-continuity/v1.2/implementation-plan.md first and
treat it as the source of truth for Research Continuity V1.2.

Implement only V1.2 Research Evidence Contract. The goal is to make research
outputs produce and preserve normalized object-first evidence for claims, risks,
and watchpoints while keeping legacy public thesis fields compatible.

Do not add DB tables, reset schema, backfill historical data, add graph/node UI,
break public string-array DTOs, add a new LLM agent, implement semantic merge,
or add Calibration/market correctness behavior.

Before editing, inspect the files listed in "Files to inspect first". Follow
existing Python engine, NestJS, repository, contract, React Query, routing, and
CSS patterns. Preserve unrelated dirty worktree changes.

Ask only if the codebase contradicts this plan or if required context is
missing.
```

## Definition Of Done

- Research output normalization supports object-first evidence and legacy
  strings.
- Normalized `structured_summary` preserves item-level evidence.
- Public legacy thesis fields remain string-array compatible.
- Continuity snapshots attach item-specific evidence and compute
  observed/reasoning/missing/no-evidence quality metrics.
- `/research-continuity` shows evidence quality and evidence details.
- Required tests and validation commands pass, or blockers are documented.
