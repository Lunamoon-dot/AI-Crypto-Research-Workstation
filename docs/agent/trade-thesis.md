# Trade Thesis

## Purpose

Trade Thesis is the final persisted thesis artifact builder. It is displayed like a workflow node, but it is not a standalone LLM agent. It packages Portfolio Manager output, candidate-contract metadata, quant context, signal classification, debate links, evidence, confidence, and data-quality notes into a `TradeThesis`.

## Code

- Builder: `apps/ai-service/luna_workstation/graph/thesis_builder.py`
- Trigger: `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
- Domain model: `apps/ai-service/luna_workstation/domain/thesis.py`
- Node label in logs/UI: `Trade Thesis`

## When it runs

After graph execution finishes, `run_orchestrator` checks `host.current_trade_thesis`. If empty, it logs `agent_node_started` for `Trade Thesis`, calls `host._build_trade_thesis(final_state)`, then logs `thesis_generated` and `agent_node_completed`.

This is why it can finish fast: the expensive LLM/debate/data work already happened upstream.

## Inputs

From `final_state`:

- `final_trade_decision`
- `final_trade_summary_json`
- `final_trade_candidate_source`
- `final_trade_candidate_schema_version`
- `final_signal`
- `company_of_interest`
- `market_type`
- `setup_type`
- signal/MTF fields used for confidence penalty

From host/current run:

- `current_research_run`
- `quant_signal_result`
- `current_debate`
- `current_agent_opinions`
- `current_signals`
- journal bridge for previous thesis stability guard
- config

## What it does

1. Reads `final_trade_decision`.
2. Reads `final_trade_summary_json`, or extracts `TRADE_THESIS_JSON` from decision text.
3. Parses structured summary payload.
4. Validates `ThesisCandidate` when structured payload is available.
5. Resolves source contract and candidate schema version.
6. Strips JSON block from readable decision text.
7. Resolves market type from payload, state, run, or config.
8. Validates rating consistency across:
   - structured summary rating
   - rating parsed from final decision text
   - `final_signal`
9. Resolves thesis direction from rating and requested direction.
10. Reads quant confidence, empirical confidence, sample sizes, signal version, and current price.
11. Links debate id and agent opinion ids.
12. Classifies current signals into supporting and contradicting sets for the thesis direction.
13. Extracts entry, confirmation, invalidation, and target zones from structured payload.
14. Falls back to prose extraction if structured fields are missing.
15. Builds degradation reasons for missing or prose-derived fields.
16. Builds supporting evidence and contradicting evidence from signal summaries.
17. Builds stale/missing data notes from signals and opinions.
18. Runs price sanity checks against current price.
19. Derives data quality score, label, and missing-data reason codes.
20. Builds `why_this_thesis` from first line of final decision, or a fallback sentence.
21. Builds `monitor_next` from structured watchpoints plus entry/confirmation/invalidation/targets.
22. Derives final thesis confidence from structured confidence, opinion/debate alignment, quant confidence, stale data, and contract degradation.
23. Applies data-quality confidence cap.
24. Applies low-quant-confidence cap.
25. Applies multi-timeframe confidence penalty.
26. Builds confidence rationale.
27. Builds `TradeThesisStructuredSummary`.
28. Compiles final thesis text and sections with `ThesisCompiler`.
29. Builds `TradeThesis`.
30. Applies stability guard to avoid weak unjustified thesis flips.
31. Refreshes price sanity notes.
32. Ensures run has `decision_id`.
33. Logs `thesis_generated` and `decision_created`.

## Direction/rating mapping

Rating drives direction:

- `Buy` / `Overweight` -> `long`
- `Sell` -> `short`
- `Underweight` -> `avoid`
- `Hold` -> `watch` or `neutral`

If ratings conflict across sources, builder raises consistency errors instead of silently producing contradictory thesis.

## Structured summary fields

The resulting structured summary includes:

- rating
- direction
- market type
- confidence
- action summary
- recommended action
- market bias
- entry plan status
- confirmation condition
- entry zone
- upside catalyst
- invalidation
- target zones
- key reasons
- risks
- monitor next
- supporting evidence
- contradicting evidence
- missing data
- missing data reason codes
- data quality
- data quality label
- degraded flag
- degradation reasons
- system risk notes

## Evidence and provenance

Trade Thesis links:

- supporting signal ids
- contradicting signal ids
- agent opinion ids
- debate id
- current price
- quant confidence
- quant bias
- data quality
- missing-data reason codes
- contract degradation reasons
- source contract and candidate schema version
- price sanity notes
- multi-timeframe confidence penalty payload

## Guardrails

- Does not call market/news/social tools.
- Does not rerun analyst debate.
- Enforces rating consistency.
- Enforces no conflicting rating mentions in final decision.
- Caps confidence when data quality or quant confidence is weak.
- Adds degradation reasons instead of hiding missing structured fields.
- Uses stability guard before allowing weak flip from prior thesis.
- Uses price sanity notes to flag suspicious entry/invalidation/target text.

## Output

Primary output is `host.current_trade_thesis`, a `TradeThesis` domain object ready for journal persistence and UI.

It also logs:

- `thesis_generated`
- `decision_created`
- run `decision_id` when missing

The persisted `TradeThesis` also stores:

- `candidate_schema_version`
- `source_contract`
- `thesis_candidate`

## Downstream consumers

- Journal persistence.
- Thesis Library.
- Thesis Detail.
- Scenario linkage.
- Calibration/evaluation.
- Research continuity.
