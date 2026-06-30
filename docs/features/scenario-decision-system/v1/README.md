# Scenario Decision System V1: Scenario Recommendation

Last updated: 2026-06-29
Status: goal-ready feature overview

Parent product spec: [Scenario Decision System](../README.md)

## Purpose

Scenario Recommendation turns scenario branches into structured, cautious
decision guidance that can be evaluated later.

It answers:

```text
What should the operator do with this scenario right now?
Which conditions must be true before action is allowed?
Which conditions block action?
What would invalidate this scenario?
Which evidence supports the recommendation?
Can this recommendation be evaluated after market time passes?
```

It does not answer:

```text
Should Luna place live orders?
Should scenario branches become broker instructions?
Should Calibration be replaced by a backtest engine?
Should Research Continuity remain a standalone product surface?
```

Those belong to execution systems, Trade Playbook, Backtest Lab, Calibration,
or continuity policy.

## Product Boundary

```text
Scenario Horizon Planner = generate short/mid/long scenario branches.
Scenario Recommendation = turn each branch into cautious operational guidance.
Scenario Runtime Evaluator = compute the current action from market data and gates.
Scenario Evaluation = later judge whether the recommendation worked.
Research Continuity = preserve scenario memory as prior context.
Calibration = evaluate thesis and scenario reliability after market time passes.
Backtest Lab = simulate executable playbooks, not V1 recommendations.
```

V1 is not a trading bot. It produces structured guidance for a human operator
and later evaluation. Any action stronger than `consider_*` must pass explicit
hard gates.

## Core Model

V1 keeps the existing scenario read surfaces and runtime decision path, then
hardens them around a first-class recommendation contract.

Each scenario can carry:

```text
scenario_recommendation
runtime_decision
evaluation_snapshot
```

The recommendation is generated or derived from the scenario. The runtime
decision is deterministic and re-computed from current market data. The
evaluation snapshot is a lightweight, non-final readiness shape that lets later
Calibration or Scenario Evaluation decide whether the recommendation was useful.

## Key Decisions

- Keep Research Continuity as memory substrate, not the next main product
  direction.
- Keep `Scenario Planner` and horizon identity intact.
- Do not create live orders or broker execution semantics in V1.
- Do not build Backtest Lab UI in V1.
- Do not hide runtime uncertainty. Missing, stale, overextended, neutral, or
  contradictory data must downgrade action to `wait`, `avoid`, or `review`.
- Prefer structured fields over text parsing for recommendation, blocking
  reasons, evidence, invalidation, and evaluation readiness.
- Surface the recommendation on Thesis Detail and Scenario Monitor using the
  existing scenario fetch paths.

## Version Links

| Version | Status | Plan |
| --- | --- | --- |
| V1 | goal-ready | [implementation-plan.md](implementation-plan.md) |

## Later Versions

Likely follow-ups:

- Scenario Evaluation V1: persist scenario outcome artifacts after the horizon
  matures.
- Trade Playbook V1: compile sufficiently structured recommendations into
  backtestable manual trade plans.
- Backtest Lab V1: simulate validated playbooks with fill, fee, slippage, and
  sizing rules.
- Empirical Memory: store historical playbook/setup results and feed compact
  priors back into Portfolio Manager.
