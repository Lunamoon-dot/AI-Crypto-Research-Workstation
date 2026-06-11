# Scenario Horizon Planner

Last updated: 2026-06-10
Status: goal-ready feature overview

## Purpose

Scenario Horizon Planner turns the current single Scenario Planner output into a
time-horizon-aware scenario map.

It answers:

```text
What is the short-term tactical branch for the current thesis?
What is the medium-term follow-through branch for the current thesis?
What is the long-term structural branch for the current thesis?
How should prior continuity memory influence those branches without overriding current evidence?
```

It does not answer:

```text
Should the graph add three new top-level nodes?
Should continuity become direct evidence for scenario generation?
Should scenario planning evaluate thesis correctness after market time passes?
```

Those belong to graph restructuring, continuity policy, or Calibration.

## Product Boundary

```text
Portfolio Manager = decide the current thesis.
Scenario Horizon Planner = expand the decided thesis into short/mid/long conditional branches.
Research Continuity = track how thesis and scenarios change across runs.
Calibration = evaluate thesis outcome after market time passes.
```

The planner must remain a forward-planning layer, not an automated trading
layer and not a thesis-evaluation layer.

## Core Model

V1 keeps one public `Scenario Planner` graph node and one normalized
`ScenarioPlan` contract.

Internally, the planner orchestrates three horizon specialists:

```text
short_term
mid_term
long_term
```

Each specialist receives the same shared run context plus horizon-specific
prompt policy. The parent planner normalizes all outputs back into one
structured `ScenarioPlan`.

## Key Decisions

- Keep one graph node: `Scenario Planner`.
- Do not add three top-level LangGraph nodes in V1.
- Add horizon metadata to structured scenario output instead of replacing the
  public scenario contract.
- Keep journal persistence and downstream report flows compatible with the
  existing `ScenarioPlan`.
- Expose horizon metadata through existing scenario read surfaces so the web UI
  can filter short/mid/long scenarios without inventing a parallel scenario
  endpoint.
- Do not inject raw `latest_continuity_context` directly into horizon prompts.
- If continuity prior is needed, pass it through a Portfolio Manager-authored
  scenario handoff shape.

## Version Links

| Version | Status | Plan |
| --- | --- | --- |
| V1 | goal-ready | [v1/implementation-plan.md](v1/implementation-plan.md) |

## Later Versions

Likely follow-ups:

- V1.x follow-ups should stay additive inside the same boundary:
  stronger prompt policies, richer continuity digests, better UI grouping, and
  provider/model specialization only if research quality proves it necessary.
- V2.x: only revisit graph-level node boundaries if one planner-orchestrator
  shape can no longer preserve quality or observability.
