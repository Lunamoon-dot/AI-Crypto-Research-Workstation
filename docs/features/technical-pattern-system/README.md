# Technical Pattern System

Last updated: 2026-07-05

Status: draft

Technical Pattern System detects auditable chart structures from market data and
turns them into structured evidence for scenario planning, trade playbooks,
visual projections, and paper simulation.

## Product Boundary

The system is an evidence layer, not an execution engine.

It must:

- derive anchors, levels, zones, and targets from deterministic OHLCV and market
  structure rules;
- preserve enough evidence for review and replay;
- expose compact pattern summaries to the Scenario Planner and Trade Playbook
  Compiler;
- expose geometry that the web chart can render without re-parsing prose.

It must not:

- let an LLM invent chart anchors, levels, targets, or invalidation prices;
- place broker or exchange orders;
- treat a pattern as a trade unless a current scenario and playbook accept it;
- replace thesis evidence, risk review, or scenario lifecycle state.

## System Chain

```text
OHLCV candles
-> swing and level detection
-> technical_pattern_snapshot.v1
-> scenario and playbook evidence block
-> scenario_chart_projection.v1 / simulation read model
-> chart overlays and opportunity cards
```

## Roadmap

| Version | Capability | Detailed Plan |
| --- | --- | --- |
| V1 | Pattern Evidence MVP | [V1 implementation plan](v1/implementation-plan.md) |

## V1 Scope

V1 focuses on patterns that can be detected and audited from candle geometry
without vendor-only data:

- support and resistance zones;
- range and rectangle;
- breakout and breakdown;
- retest;
- ascending and descending channels;
- symmetrical, ascending, and descending triangles;
- rising and falling wedges;
- basic ABCD legs;
- measured move targets.

Later versions can add flags, double tops and bottoms, head and shoulders,
Fibonacci grids, sweep/reclaim logic, harmonic families, candle clusters, and
liquidation or order-book overlays once their data contracts are explicit.
