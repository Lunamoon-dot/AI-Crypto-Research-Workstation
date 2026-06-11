# Thesis Contract Hardening

Last updated: 2026-06-11
Status: draft feature spec

## Purpose

Thesis Contract Hardening makes saved trade theses trustworthy enough to be a
first-class research artifact.

The current pipeline already has structured output support and post-build
guards, but the readable `FULL THESIS` text is still ultimately produced by the
Portfolio Manager LLM call and then persisted as `TradeThesis.thesis_text`.
That is too weak for an artifact that downstream watchlists, continuity,
calibration, and UI review treat as important.

This feature changes the ownership boundary:

```text
Portfolio Manager = proposes a structured thesis candidate.
Thesis Validator = decides whether the candidate is valid, degraded, or blocked.
Thesis Compiler = renders the saved full thesis from validated fields.
TradeThesis = persisted artifact with status, evidence, validation, and audit trail.
```

LLM prose should not be the source of truth for saved thesis fields.

## Problem Statement

The current implementation has useful safeguards:

- `PortfolioDecision` structured output exists.
- `TRADE_THESIS_JSON` exists.
- `ThesisBuilder` checks rating consistency.
- `ThesisBuilder` records missing structured fields as degradation reasons.
- confidence can be capped by data quality, quant confidence, and MTF penalty.

The remaining product risk is that a full-looking thesis can still be created
from weak or free-text output. The system can normalize and cap it, but it does
not yet prove that every saved thesis has a valid contract and evidence-backed
critical claims.

## Product Boundary

```text
Research agents = produce reports and opinions.
Portfolio Manager = synthesize a candidate stance from current evidence.
Thesis Validator = enforce artifact eligibility.
Thesis Compiler = render inspectable thesis text deterministically.
Research Continuity = track thesis changes after persistence.
Calibration = evaluate saved thesis quality after time passes.
Watchlist = monitor validated or degraded thesis rules.
```

This feature is not an automated trading system, not a PnL backtester, and not
a new agent family. It is a contract and artifact-hardening layer for existing
research output.

## Key Decisions

- Keep one public `Portfolio Manager` graph node.
- Keep `Trade Thesis` as a post-analysis artifact builder stage.
- Do not add a second opaque LLM rewrite pass for final thesis text.
- Make structured thesis candidate output mandatory for new thesis creation.
- Do not allow free-text fallback to create a normal-looking valid thesis.
- Add deterministic validation before persistence.
- Add deterministic full-thesis rendering after validation.
- Preserve legacy historical thesis display where possible.
- Expose status and validation/degradation reasons through API and UI.
- Keep continuity ownership boundaries unchanged.

## Target Architecture

```text
Analysts, signals, debate
  -> Portfolio Manager structured ThesisCandidate
  -> ThesisValidator
  -> ThesisCompiler
  -> TradeThesis persisted
  -> API response with thesis status and validation result
  -> UI renders compiled full thesis plus status and caveats
```

The model may still generate natural-language reasoning inside structured
fields. The saved thesis text, however, should be assembled from validated
fields rather than accepted as one raw model-written blob.

## Version Links

| Phase | Status | Plan |
| --- | --- | --- |
| Phase 1 / V1 | draft goal-ready | [v1/implementation-plan.md](v1/implementation-plan.md) |
| Phase 2 / V2 | draft goal-ready | [v2/implementation-plan.md](v2/implementation-plan.md) |

## Phase Summary

### Phase 1: Structured Candidate And Validation Gate

Phase 1 stops weak model output from becoming a trusted thesis.

It introduces a mandatory `ThesisCandidate` contract, a deterministic
`ThesisValidator`, explicit artifact statuses, and blocked/degraded behavior.
It keeps existing UI rendering mostly intact but makes the API expose whether a
thesis is valid, degraded, or blocked.

Phase 1 should answer:

```text
Can this model output become a saved thesis artifact?
If not, why not?
If yes, what exact structured fields and evidence support it?
```

### Phase 2: Deterministic Full Thesis Compiler

Phase 2 removes raw LLM prose as the primary full-thesis renderer.

It introduces `ThesisCompiler`, makes `thesis_text` a deterministic rendering
of validated fields, and updates API/UI surfaces so users can inspect compiled
thesis text, validation issues, evidence coverage, and legacy/degraded status.

Phase 2 should answer:

```text
What exactly did the validated thesis say, and which fields produced each line?
```

## Invariants

- A saved valid thesis must have a structured candidate.
- A saved valid thesis must have rating and direction consistency.
- A saved valid thesis must have confirmation and invalidation conditions.
- A saved valid thesis must not rely on prose parsing for critical fields.
- A saved valid thesis must not hide stale, missing, or low-quality data.
- A blocked thesis must not be presented as a normal full thesis.
- A degraded thesis must make degradation reasons visible in API and UI.
- Historical legacy theses should remain readable, but they should not be
  silently treated as fully validated new-contract artifacts.

## Later Versions

Likely follow-ups after Phase 2:

- stricter evidence-reference coverage for every claim;
- provider-specific structured-output reliability scoring;
- thesis prompt version comparison in Calibration Lab;
- richer UI drilldown from thesis line to evidence item;
- migration/backfill tooling for historical thesis records.

These are intentionally out of scope for the first two phases.
