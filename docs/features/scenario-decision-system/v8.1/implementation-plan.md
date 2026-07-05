# Visual Opportunity Projection V8.1 Implementation Plan

Status: design-ready, recommended next implementation slice before Technical Pattern V1
Last updated: 2026-07-05

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**North Star:** Make the built-in chart explain the opportunity like
Autochartist, while keeping simulation state and trade plans as the source of
truth.

**Goal:** Turn trade playbooks, simulation state, scenario chart projections,
and optional technical pattern snapshots into rich read-only chart overlays:
entry area, risk exit, targets, projected path, expiry window, pattern geometry,
and current execution state.

**Architecture:** V8.1 does not add a new execution engine. It derives a
`visual_opportunity_projection.v1` read model from `trade_playbook.v1`,
`simulation_run.v1`, `execution_event.v1`, `scenario_chart_projection.v1`, and
optional `technical_pattern_snapshot.v1`. Technical pattern snapshots are not a
V8.1 blocker. The chart renders candles with `lightweight-charts` and draws an
SVG overlay layer above the chart using converted time and price coordinates.
Projection data is read-only and can be rebuilt from source snapshots.

**Tech Stack:** NestJS/TypeScript contracts, existing scenario and paper
execution services, React/Vite, `lightweight-charts`, SVG overlays, TanStack
Query, Node test runner.

---

## Product Scope

V8.1 answers:

```text
Where is the entry area?
What risk exit invalidates the setup?
Where are target and measured move areas?
How long is the setup valid?
Which technical structure justifies the setup?
What happened after the entry was touched in paper simulation?
```

V8.1 must not create:

```text
broker order tickets
live order routing
exchange execution buttons
new paper execution lifecycle rules
LLM-drawn chart coordinates
free-text chart parsing
```

## Source Of Truth Rules

- `trade_playbook.v1` remains the plan source.
- `simulation_run.v1` and `execution_event.v1` remain the execution source for
  paper state.
- `scenario_chart_projection.v1` remains the candle, live-state, and base
  overlay source.
- `technical_pattern_snapshot.v1` is optional bonus geometry, not a dependency
  for V8.1a.
- `visual_opportunity_projection.v1` is a derived read model only.
- The chart never decides whether a trade exists, fills, wins, loses, or
  expires.
- If a source snapshot is stale or missing, the projection must show a warning
  instead of inventing geometry.

## Delivery Phases

V8.1 should be implemented in two phases:

```text
V8.1a: Visual projection from playbook + simulation only
V8.1b: Optional technical pattern geometry integration
```

V8.1a must be useful without Technical Pattern System. It should render entry,
risk exit, target, expiry, current price, risk/reward boxes, setup path, and
paper fill/exit markers from:

```text
trade_playbook.v1
scenario_chart_projection.v1
simulation_run.v1
execution_event.v1
```

V8.1b may accept `technical_pattern_snapshot.v1` and render support,
resistance, channels, triangles, wedges, measured moves, or Fibonacci-like
geometry from fixtures or sample snapshots. Real pattern detection belongs to
Technical Pattern System V1 unless that work is explicitly pulled forward.

## Visual Projection Contract

`visual_opportunity_projection.v1` should be compact enough for the API and web
to share directly.

```ts
type VisualOpportunityProjectionV1 = {
  schema_version: "visual_opportunity_projection.v1";
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id?: string;
  symbol: string;
  timeframe: string;
  generated_at: string;
  source_versions: {
    trade_playbook_id?: string | null;
    trade_playbook_hash?: string | null;
    simulation_run_id?: string | null;
    scenario_chart_projection_hash?: string | null;
    scenario_chart_generated_at?: string | null;
    technical_pattern_snapshot_id?: string | null;
  };
  opportunity: {
    kind:
      | "trade_setup"
      | "watch_setup"
      | "narrative_checkpoint"
      | "blocked";
    side: "long" | "short" | "neutral";
    status:
      | "watching"
      | "waiting_entry"
      | "entry_touched"
      | "open"
      | "target_hit"
      | "risk_exit_hit"
      | "expired"
      | "cancelled"
      | "blocked"
      | "not_chartable";
    confidence?: number;
    stale_reasons: string[];
  };
  overlays: VisualOverlayV1[];
  labels: VisualLabelV1[];
  warnings: string[];
};
```

Overlay primitives should be generic:

```ts
type VisualPointV1 = {
  time: string;
  price: number;
};

type VisualSourceRefV1 = {
  type:
    | "trade_playbook"
    | "scenario_chart_projection"
    | "simulation_run"
    | "execution_event"
    | "technical_pattern";
  id?: string | null;
  field?: string | null;
};

type VisualOverlayStatusV1 =
  | "active"
  | "passed"
  | "failed"
  | "blocked"
  | "unknown";

type VisualOverlayV1 =
  | VisualLineOverlayV1
  | VisualZoneOverlayV1
  | VisualPathOverlayV1
  | VisualBoxOverlayV1
  | VisualMarkerOverlayV1;

type VisualOverlayRoleV1 =
  | "entry"
  | "risk_exit"
  | "target"
  | "expiry"
  | "projected_path"
  | "pattern_support"
  | "pattern_resistance"
  | "pattern_channel"
  | "pattern_boundary"
  | "measured_move"
  | "current_price"
  | "paper_fill"
  | "paper_exit";

type VisualLineOverlayV1 = {
  type: "line";
  id: string;
  role: VisualOverlayRoleV1;
  points: [VisualPointV1, VisualPointV1];
  label?: string;
  style?: "solid" | "dashed" | "dotted";
  status?: VisualOverlayStatusV1;
  source_ref: VisualSourceRefV1;
};

type VisualZoneOverlayV1 = {
  type: "zone";
  id: string;
  role: VisualOverlayRoleV1;
  price_low: number;
  price_high: number;
  time_start?: string | null;
  time_end?: string | null;
  label?: string;
  opacity?: number;
  status?: VisualOverlayStatusV1;
  source_ref: VisualSourceRefV1;
};

type VisualBoxOverlayV1 = {
  type: "box";
  id: string;
  role: "risk_box" | "reward_box" | "target" | "expiry";
  time_start: string;
  time_end: string;
  price_low: number;
  price_high: number;
  label?: string;
  status?: VisualOverlayStatusV1;
  source_ref: VisualSourceRefV1;
};

type VisualPathOverlayV1 = {
  type: "path";
  id: string;
  role: "setup_path" | "measured_move" | "pattern_projection";
  path_semantics:
    | "planned_setup_path"
    | "measured_move_projection"
    | "pattern_projection";
  points: VisualPointV1[];
  arrow_end?: boolean;
  label?: string;
  confidence?: number;
  source_ref: VisualSourceRefV1;
};

type VisualMarkerOverlayV1 = {
  type: "marker";
  id: string;
  role: "paper_fill" | "paper_exit" | "expiry" | "current_price";
  point: VisualPointV1;
  label?: string;
  event_id?: string | null;
  status?: VisualOverlayStatusV1;
  source_ref: VisualSourceRefV1;
};
```

The contract should carry `time` and `price` values, not pixel coordinates.
Pixel coordinates are a web rendering detail.

If `opportunity.kind` is `narrative_checkpoint`, the projection should only
render current price, source warnings, and a callout. It must not draw
risk/reward boxes, entries, targets, or setup paths for non-chartable narrative
scenarios.

Use `setup_path`, `planned_setup_path`, or `measured_move_projection` language in
UI copy. Do not label projected paths as predictions or forecasts.

## Rendering Approach

Use a two-layer chart:

```text
lightweight-charts candle layer
SVG overlay layer bound to chart dimensions
```

The SVG layer should use adapter helpers:

```text
time -> x coordinate
price -> y coordinate
visible range clipping
overlay hit testing
label collision avoidance
```

Phase 1 should use SVG because it is faster to implement, easier to test, and
supports labels, zones, paths, and boxes cleanly. Native
`lightweight-charts` primitives can be considered later only if SVG becomes a
measurable performance problem.

Migration rule:

```text
scenario_chart_projection.v1 = candle/live-state/base overlay source
visual_opportunity_projection.v1 = richer visual read model derived from it
ScenarioChart renders visual projection when available
ScenarioChart falls back to old projection overlays when unavailable
```

The frontend must not render both overlay systems with equal priority. If visual
projection is available, suppress duplicate current-price, entry, target, and
event markers from the old overlay path.

## Chart Elements

V8.1 should render:

- entry zone or trigger line;
- risk-exit zone or stop line;
- target zone and target label;
- risk/reward box from entry to target and risk exit;
- projected path from current price to entry and target when available;
- expiry marker or shaded expiry window;
- current price line;
- paper fill and paper exit markers after simulation events;
- pattern lines, channels, wedges, triangles, and measured moves when technical
  pattern snapshots are available;
- warning labels for stale playbooks, missing evidence, or non-actionable bias.

Risk/reward boxes must be deterministic:

```text
Long:
  risk box = entry reference -> risk exit below entry
  reward box = entry reference -> target above entry

Short:
  risk box = entry reference -> risk exit above entry
  reward box = entry reference -> target below entry
```

`entry_reference_price` resolves in this order:

```text
1. position average entry if the simulation is open
2. deterministic playbook entry fill price if known
3. entry zone midpoint for visual-only preview
```

If these rules cannot produce a sane box, the projection should emit a warning
and skip the risk/reward box instead of drawing misleading geometry.

When entry is touched, the projection should add state-specific visual evidence:

- mark the touch candle or fill candle;
- switch the setup label from `waiting_entry` to `entry_touched` or `open`;
- show paper order or position markers if V8 simulation created them;
- keep the original planned entry/risk/target geometry visible for audit;
- add exit markers only after a target, risk exit, expiry, or cancellation
  event exists.

## Opportunity Card Impact

The opportunity card should mirror the chart:

- setup status and side;
- entry, risk exit, target, and expiry;
- simulation state and latest event;
- stale or blocker reasons;
- technical pattern evidence IDs when present;
- paper position and PnL only when a simulation has actually opened.

Copy must remain simulation-only. Avoid words that imply broker execution,
account balances, investment advice, or live trading.

## Implementation Tasks

- [ ] Add `visual_opportunity_projection.v1` contract and OpenAPI/client types,
      including `opportunity.kind`, overlay `source_ref`, overlay statuses, and
      concrete overlay shapes.
- [ ] Add non-chartable narrative scenario state.
- [ ] Build a projection builder that merges playbook, scenario projection,
      simulation read model, and optional technical pattern geometry.
- [ ] Implement V8.1a without requiring `technical_pattern_snapshot.v1`.
- [ ] Add stale-source and missing-evidence warnings to the projection builder.
- [ ] Add risk/reward box derivation rules for long and short setups.
- [ ] Add SVG overlay coordinate adapters for time, price, clipping, and resize.
- [ ] Render entry, risk exit, targets, expiry, current price, and paper event
      markers.
- [ ] Add fallback mode that renders old `ScenarioChartProjection` overlays when
      visual projection is unavailable.
- [ ] Add duplicate overlay suppression for current price, entry, target, and
      event markers.
- [ ] Add mobile label density mode for compact chart widths.
- [ ] Render pattern geometry when `technical_pattern_snapshot.v1` is available
      in V8.1b.
- [ ] Update the opportunity card to use projection status and warnings.
- [ ] Add visual fixtures for long setup, short setup, missing playbook, active
      simulation, completed simulation, and non-chartable narrative scenarios.
- [ ] Add focused tests for projection derivation, stale warnings, and overlay
      geometry mapping.

## Verification

- Contract tests cover the projection shape and source version fields.
- Projection-builder tests prove overlays are derived from source snapshots.
- Web tests prove the chart still renders when technical patterns are absent.
- Web tests prove old projection overlays still render when visual projection is
  unavailable.
- Web tests prove the chart renders entry, risk exit, target, expiry, and
  touched-entry markers from structured data.
- Web tests prove non-chartable narrative scenarios do not draw trade setup
  boxes.
- Visual QA verifies desktop and mobile chart overlays do not overlap key labels.
- Existing V8 paper execution tests continue to pass unchanged.

## Definition Of Done

V8.1 is done when:

- a current playbook can produce a visual opportunity projection without a
  running simulation;
- V8.1 is useful without any technical pattern snapshot;
- a running simulation can add paper fill and exit markers to the same chart;
- entry, risk exit, target, expiry, and current price are visible from
  structured overlay data;
- technical pattern geometry can be rendered when present and ignored safely
  when absent;
- non-chartable narrative scenarios are shown as such instead of forcing
  trade-setup geometry;
- stale or missing sources are surfaced as warnings instead of silent blank
  charts;
- chart rendering remains a read-only projection and does not decide execution
  lifecycle state.
