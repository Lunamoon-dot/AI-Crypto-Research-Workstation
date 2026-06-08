# Trade Thesis

## Purpose

Trade Thesis is the final persisted thesis artifact builder. It is displayed like a workflow node, but it is not a standalone LLM agent. It packages Portfolio Manager output, quant context, signal classification, debate links, evidence, confidence, and data-quality notes into a `TradeThesis`.

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
4. Strips JSON block from readable decision text.
5. Resolves market type from payload, state, run, or config.
6. Validates rating consistency across:
   - structured summary rating
   - rating parsed from final decision text
   - `final_signal`
7. Resolves thesis direction from rating and requested direction.
8. Reads quant confidence, empirical confidence, sample sizes, signal version, and current price.
9. Links debate id and agent opinion ids.
10. Classifies current signals into supporting and contradicting sets for the thesis direction.
11. Extracts entry, confirmation, invalidation, and target zones from structured payload.
12. Falls back to prose extraction if structured fields are missing.
13. Builds degradation reasons for missing or prose-derived fields.
14. Builds supporting evidence and contradicting evidence from signal summaries.
15. Builds stale/missing data notes from signals and opinions.
16. Runs price sanity checks against current price.
17. Derives data quality score, label, and missing-data reason codes.
18. Builds `why_this_thesis` from first line of final decision, or a fallback sentence.
19. Builds `monitor_next` from structured watchpoints plus entry/confirmation/invalidation/targets.
20. Derives final thesis confidence from structured confidence, opinion/debate alignment, quant confidence, stale data, and contract degradation.
21. Applies data-quality confidence cap.
22. Applies low-quant-confidence cap.
23. Applies multi-timeframe confidence penalty.
24. Builds confidence rationale.
25. Builds `TradeThesisStructuredSummary`.
26. Builds `TradeThesis`.
27. Applies stability guard to avoid weak unjustified thesis flips.
28. Refreshes price sanity notes.
29. Ensures run has `decision_id`.
30. Logs `thesis_generated` and `decision_created`.

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
- confirmation condition
- invalidation
- target zones
- key reasons
- risks
- monitor next
- supporting evidence
- contradicting evidence
- missing data
- data quality
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

It also updates/logs:

- `thesis_generated`
- `decision_created`
- run `decision_id` when missing

## Downstream consumers

- Journal persistence.
- Thesis Library.
- Thesis Detail.
- Scenario linkage.
- Calibration/evaluation.
- Research continuity.
