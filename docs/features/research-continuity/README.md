# Research Continuity

Last updated: 2026-05-28
Status: implemented feature overview

## Purpose

Research Continuity turns repeated research runs for the same symbol into a
memory trail.

It answers:

```text
What changed since the previous research run?
What stayed valid?
What became invalid or less useful?
What should be watched next?
```

It does not answer:

```text
Was the thesis correct after 7d/30d?
Did the market validate a trade?
Which agent is historically best?
```

Those belong to Calibration, performance analytics, or later continuity
analytics.

## Product Boundary

```text
Research = produce the current view.
Research Continuity = track how the view changes across runs.
Calibration = evaluate a thesis after market time has passed.
```

Research Continuity is not a replacement for thesis evaluation. It is the daily
memory layer around research.

## Core Model

V1 uses four artifacts:

```text
ResearchSnapshot
  Structured view extracted from one research run.

DailyContinuityEntry
  Append-only baseline/delta report for one symbol/run.

ContinuityLedger
  The complete append-only history of entries for a symbol.

ContinuityState
  Small latest projection used by the next run.
```

The source of truth is the append-only ledger. The latest state is only a
projection/cache and must be rebuildable from the ledger.

## V1 Scope

V1 builds the minimum useful continuity loop:

```text
research run completed
  -> build structured snapshot
  -> compare against latest continuity state
  -> create baseline or daily delta entry
  -> update latest state when safe
  -> show the daily diff report in the web app
```

V1 does not implement long-range analytics, semantic retrieval, or a multi-agent
continuity debate.

## Agent Policy

V1 should be deterministic-first:

```text
Snapshot Builder       deterministic / schema-first
Delta Engine           deterministic
State Projector        deterministic
Continuity Writer      optional narrative writer only
```

If an LLM writer is added, it can only render prose from computed events. It
must not create source-of-truth events, change symbol view, add forecast
windows, or declare a thesis correct/incorrect. A deterministic fallback report
is required.

## Version Links

| Version | Status | Plan |
| --- | --- | --- |
| V1 | implemented | [v1/implementation-plan.md](v1/implementation-plan.md) |
| V1.1 | implemented | [v1.1/implementation-plan.md](v1.1/implementation-plan.md) |
| V1.2 | implemented | [v1.2/implementation-plan.md](v1.2/implementation-plan.md) |
| V1.3 | goal-ready | [v1.3/implementation-plan.md](v1.3/implementation-plan.md) |

## Later Versions

Likely follow-ups:

- V1.4+: optional repair job audit table, scheduled repair, or richer
  operations after V1.3 proves the manual control surface.
- V2.x: timeline, graph/node model, provenance explorer, and multi-symbol
  views.
