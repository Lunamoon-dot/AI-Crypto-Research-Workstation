# Technical Pattern System V1 Implementation Plan

Status: design-ready
Last updated: 2026-07-05

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**North Star:** Make chart-pattern evidence explicit, replayable, and renderable
without asking the LLM to draw or infer levels from screenshots.

**Goal:** Add a deterministic technical pattern evidence layer that produces
structured pattern snapshots for Scenario Planner, Trade Playbook Compiler,
Visual Opportunity Projection, and paper simulation review.

**Architecture:** V1 adds pattern detection before scenario planning. The
detector reads OHLCV candles, computes swing points, clusters levels, classifies
pattern geometry, and writes `technical_pattern_snapshot.v1`. The LLM consumes a
compact evidence block derived from that snapshot. The chart consumes geometry
from the same snapshot. The chart and LLM are read consumers, not detection
sources.

**Tech Stack:** Python or TypeScript detector inside the existing research
pipeline boundary, NestJS API contracts, Postgres journal repository,
React/Vite, `lightweight-charts`, SVG chart overlay layer, existing scenario
planner prompts and contract tests.

---

## Product Scope

V1 answers:

```text
Which technical pattern is forming or confirmed?
Which candles and anchors justify it?
Where are entry, invalidation, targets, and expiry window?
How strong is the evidence, and what weakens it?
Can the pattern be rendered on the chart without parsing AI prose?
```

V1 must not create:

```text
broker orders
exchange integration
live trade automation
portfolio sizing
LLM-only chart drawing
unreviewable pattern calls
```

## Source Of Truth Rules

- Candles and derived swing points are the source data for pattern detection.
- `technical_pattern_snapshot.v1` is the persisted evidence snapshot.
- Pattern geometry is produced by the detector, not by UI code.
- LLM prompts may summarize and reason over detected patterns, but must not
  invent new anchors, zones, or targets.
- A scenario or playbook may ignore, downgrade, or accept a pattern; the pattern
  itself is not a trade.
- Chart overlays render from snapshot geometry and scenario/playbook read
  models only.

## Pattern Snapshot Contract

`technical_pattern_snapshot.v1` groups all pattern candidates for one market
window.

```ts
type TechnicalPatternSnapshotV1 = {
  schema_version: "technical_pattern_snapshot.v1";
  id: string;
  workspace_id: string;
  research_run_id?: string;
  symbol: string;
  market_type: "spot" | "perp" | "futures" | "index" | "equity" | "unknown";
  timeframe: string;
  candle_window: {
    start_time: string;
    end_time: string;
    candle_count: number;
  };
  detector_version: string;
  source_hash: string;
  generated_at: string;
  patterns: TechnicalPatternV1[];
  warnings: string[];
};
```

`technical_pattern.v1` is one detected candidate.

```ts
type TechnicalPatternV1 = {
  schema_version: "technical_pattern.v1";
  id: string;
  pattern_type:
    | "support_resistance"
    | "range_rectangle"
    | "breakout"
    | "breakdown"
    | "retest"
    | "channel_up"
    | "channel_down"
    | "triangle_symmetrical"
    | "triangle_ascending"
    | "triangle_descending"
    | "wedge_rising"
    | "wedge_falling"
    | "abcd_basic"
    | "measured_move";
  status: "forming" | "confirmed" | "failed" | "expired";
  direction_bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  anchors: PatternAnchorV1[];
  lines: PatternLineV1[];
  zones: PatternZoneV1[];
  targets: PatternTargetV1[];
  invalidation: PatternInvalidationV1 | null;
  expiry_window: {
    start_time?: string;
    end_time?: string;
    max_bars?: number;
  } | null;
  evidence_refs: PatternEvidenceRefV1[];
  quality_flags: string[];
};
```

Geometry types must be explicit enough for the web chart to draw without
understanding pattern semantics:

```ts
type PatternAnchorV1 = {
  id: string;
  time: string;
  price: number;
  kind: "swing_high" | "swing_low" | "breakout" | "retest" | "projection";
};

type PatternLineV1 = {
  id: string;
  from_anchor_id: string;
  to_anchor_id: string;
  role: "support" | "resistance" | "midline" | "projection";
};

type PatternZoneV1 = {
  id: string;
  low: number;
  high: number;
  start_time: string;
  end_time?: string;
  role: "support" | "resistance" | "entry" | "invalidation" | "target";
};

type PatternTargetV1 = {
  id: string;
  price: number;
  method: "range_height" | "measured_move" | "abcd_extension" | "manual_review";
  confidence: number;
};
```

## Detection Rules

V1 should start with simple, auditable rules:

- Swing points use a configurable pivot window over highs and lows.
- Support and resistance zones cluster nearby swing highs and lows by percentage
  or ATR-normalized tolerance.
- Ranges require repeated touches on both sides, minimum duration, and limited
  drift between boundary touches.
- Breakouts and breakdowns require candle close beyond a zone and optional
  volume confirmation when volume is available.
- Retests require a breakout or breakdown followed by a return to the broken
  zone without immediate invalidation.
- Channels use two or more swing points per boundary and bounded parallel drift.
- Triangles and wedges use converging trendlines, minimum anchor count, and a
  remaining apex window.
- Basic ABCD uses four alternating swing anchors with ratio tolerances.
- Measured move targets use a documented source leg and projection anchor.

Every detector should return quality flags when evidence is weak, for example
`thin_volume`, `insufficient_touches`, `wide_zone`, `late_pattern`,
`overlapping_patterns`, or `stale_breakout`.

## Prompt Integration

Scenario Planner should receive a compact technical block:

```text
Technical pattern evidence:
- Pattern: triangle_ascending, status forming, bias bullish, confidence 0.68
- Anchors: resistance 566.5 touched 3 times, rising support from 545.2 to 558.4
- Trigger: close above 566.5
- Invalidation: close below 558.4
- Target: 581.0 by measured height
- Weakness: volume confirmation missing
```

Prompt rules:

- The model may use detected patterns as supporting or opposing evidence.
- The model must cite pattern evidence IDs when a recommendation depends on
  technical structure.
- The model must not emit chart drawing coordinates that are not present in the
  snapshot.
- If pattern evidence is weak or stale, the scenario should surface it as a
  blocker or confidence reduction.

## API And Storage Impact

- Persist pattern snapshots with source hash, detector version, and generated
  time.
- Expose latest pattern snapshots by workspace, symbol, timeframe, and research
  run when available.
- Include pattern snapshot IDs in scenario recommendation and trade playbook
  evidence references.
- Keep pattern snapshots immutable. New candles create a new snapshot.
- Add OpenAPI/client types for pattern snapshot reads before wiring the web UI.

## Web Impact

V1 web rendering should be read-only:

- chart overlay lines for support, resistance, channels, triangles, and wedges;
- shaded zones for support, resistance, entry, invalidation, and target regions;
- anchor markers for swing points, breakouts, retests, and projections;
- target labels and expiry markers when present;
- evidence panel that links a scenario/playbook decision back to pattern IDs.

The web UI must not recompute pattern geometry. It may hide clutter, filter by
confidence, and render warnings.

## Implementation Tasks

- [ ] Add pattern snapshot and pattern geometry contracts.
- [ ] Add detector module and unit tests for swing points, zones, breakouts,
      retests, channels, triangles, wedges, ABCD, and measured moves.
- [ ] Persist immutable pattern snapshots with source hash and detector version.
- [ ] Add API read endpoints and generated web client types.
- [ ] Add compact pattern evidence injection to Scenario Planner prompts.
- [ ] Attach pattern evidence references to scenario recommendations and trade
      playbooks when used.
- [ ] Render pattern overlays in the chart through a generic overlay geometry
      layer.
- [ ] Add contract tests that prove LLM prose is not required to draw pattern
      geometry.

## Verification

- Detector unit tests cover each V1 pattern type and weak-evidence quality
  flags.
- API contract tests cover snapshot read shape and immutable source metadata.
- Prompt tests verify pattern IDs are cited when technical evidence is used.
- Web tests verify overlays render from geometry fields only.
- Replay tests verify the same candle window and detector version produce the
  same pattern snapshot hash.

## Definition Of Done

V1 is done when:

- a research run can produce at least one immutable technical pattern snapshot
  for a supported symbol/timeframe;
- Scenario Planner can consume a compact pattern evidence block;
- trade playbooks can reference pattern evidence IDs;
- chart overlays can render pattern geometry without parsing prose;
- weak or stale technical evidence is visible as a warning rather than silently
  ignored;
- no broker, exchange, or live execution language appears in the pattern
  surface.
