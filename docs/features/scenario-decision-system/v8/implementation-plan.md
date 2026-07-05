# Paper Execution V8 Implementation Plan

Status: implemented MVP
Implementation readiness: implemented baseline; richer chart visualization is tracked in V8.1.
Last updated: 2026-07-05

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**North Star:** Research-backed opportunity detection with deterministic paper execution.

**Goal:** Turn current scenario trade playbooks into Autochartist-like opportunity cards that can run deterministic paper simulations, wait for entry triggers, create virtual orders, manage virtual positions, and write append-only execution evidence for later evaluation and reliability updates.

**Architecture:** V8 adds a paper execution layer after `trade_playbook.v1`. It does not mutate playbooks into position state. It freezes a playbook snapshot into a `simulation_run.v1`, emits sequenced append-only execution events, derives paper order and position state from those events, and reports deterministic outcomes back into scenario evaluation/reliability. Chart overlays and opportunity cards remain read models.

**Tech Stack:** NestJS/TypeScript API, Postgres journal repository, existing market OHLCV services, existing scenario chart projection/live-state services, React/Vite, TanStack Query, `lightweight-charts`, Node test runner.

---

## Product Scope

V8 answers:

```text
Can a current trade playbook be run as a deterministic paper simulation?
Can the engine wait for entry instead of opening immediately at current price?
Can paper orders and positions be rebuilt from an append-only ledger?
Can the chart show Autochartist-like opportunity state without becoming the source of truth?
Can outcomes separate thesis quality from execution quality?
```

V8 is a simulation and audit release. It must not create:

```text
broker credentials
exchange order placement
live order routing
real account balances
automated portfolio allocation
strategy optimization
portfolio-level risk accounting
```

## Preconditions

V8 assumes V7.1 has stabilized:

```text
trade_playbook.v1 freshness status
scenario_chart_projection.v1
scenario_chart_summary.v1
scenario_live_state.v1
scenario_event.v1 transition semantics
stable scenario/playbook source hashes
candle-aware condition evaluation
```

If V7.1 is not fully implemented, V8 can be documented and staged, but implementation must stop before persistent paper execution writes.

## Source Of Truth Rules

V8 locks these rules:

- `trade_playbook.v1` is the source plan. It is not a position, order, or mutable execution object.
- `simulation_run.v1` freezes the playbook, scenario, thesis, chart source versions, market-data snapshot, and execution assumptions at start time.
- `execution_event.v1` is the append-only source of truth for what happened.
- `paper_order.v1`, `paper_position.v1`, opportunity cards, chart markers, and PnL snapshots are derived from the run snapshot plus ledger events.
- A stale, unverifiable, or superseded playbook cannot start a new simulation.
- Existing simulations keep using their frozen snapshot even if the source scenario or playbook changes later.
- Source changes after run start are informational only. They do not mutate, stale, or invalidate the frozen run.
- A snapshot that was stale at start must be rejected before the run is created.
- A snapshot whose stored hash fails integrity checks after creation is not reliability-eligible.
- Replay simulations must not read candles beyond the current simulated market time when deciding entry, fill, stop, target, or expiry.
- Forward simulations may consume newly available candles, but all orders and positions remain virtual.

## P0 Semantic Locks

These items are not enhancements. They must be encoded in contracts and tests before engine implementation starts.

1. V8 does not support `risk_fraction` sizing. Without virtual account equity, exposure, available balance, and concurrent-position accounting, risk-fraction sizing is underdefined. V8 supports only `fixed_notional` and `fixed_quantity`. Portfolio/equity-based paper simulation belongs in V9.
2. `pending_trigger` is not a paper order status. Before the entry condition fires, no order exists. Waiting belongs to `simulation_run.v1`.
3. `pending_fill` is not a paper position status. A position exists only after the first fill.
4. Every execution event must have a deterministic `sequence`, `aggregate_version`, `correlation_id`, `causation_event_id`, and `idempotency_key`.
5. `/simulations/:id/refresh` must be concurrency-safe. One transaction must lock the run, read the watermark, evaluate candles, append events, update projections, update the watermark, and commit.
6. Fill, gap, intrabar, expiry, cancellation, and data-end behavior must be deterministic and tested.
7. Numeric invalidation must either compile into an explicit `risk_exit`, or V8 must treat it as a hard paper stop with touch semantics. Developers must not infer this differently per implementation.
8. `engine_failure` must not create a synthetic position close. A service failure marks the run failed, keeps any paper position state as last rebuilt from ledger, produces an inconclusive outcome, and sets `reliability_eligible = false`.

## Product Model

The product chain becomes:

```text
Evidence
  -> Thesis
  -> Scenario
  -> Opportunity Card
  -> Trade Playbook
  -> Simulation Run
  -> Paper Order
  -> Paper Position
  -> Execution Ledger
  -> Outcome
  -> Reliability Update
```

The Opportunity Card is a read model, not an entity source:

```text
entry / stop / targets       <- frozen trade_playbook snapshot
setup status                 <- playbook freshness and active forward run
expires / mode               <- simulation_run and assumptions
fill / PnL / exposure        <- paper_position projection
trigger markers / exits      <- execution_event ledger
confidence / evidence        <- scenario and frozen analysis snapshot
stale warnings               <- source_versions and run assumptions
```

When one playbook has multiple simulations:

- The base card shows playbook readiness: ready, stale, expired, or unverifiable.
- If an active forward run exists, the card shows the active run state.
- Replay runs live in a history panel.
- V8 allows at most one active forward simulation per workspace, playbook, and assumptions hash.

## New Contracts

Use decimal-safe strings for all prices, quantities, fees, and PnL values that cross API boundaries. Backend persistence should use Postgres `numeric` or an equivalent decimal-safe representation.

```ts
export type DecimalString = string;
```

### Simulation Run

```ts
export type SimulationMode = 'replay' | 'forward';

export type ReliabilitySampleKind =
  | 'forward_observation'
  | 'out_of_sample_replay'
  | 'in_sample_replay'
  | 'manual_experiment';

export type SimulationRunStatus =
  | 'created'
  | 'waiting_for_trigger'
  | 'entry_triggered'
  | 'order_pending'
  | 'position_open'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type SourceIntegrityStatus =
  | 'verified'
  | 'failed'
  | 'unknown';

export interface MarketDataSnapshot {
  version: 'market_data_snapshot.v1';
  provider: string;
  canonical_symbol: string;
  provider_symbol: string;
  timeframe: string;
  timezone: 'UTC';
  price_source: 'last' | 'mark' | 'index';
  dataset_version: string | null;
  dataset_hash: string | null;
  candle_close_policy: 'finalized_only';
  starts_at: string;
  ends_at: string | null;
}

export interface SimulationSampleIdentity {
  scenario_hash: string;
  playbook_hash: string;
  market_data_hash: string | null;
  evaluation_window_hash: string;
  assumptions_hash: string;
}

export interface SimulationRunResponse {
  version: 'simulation_run.v1';
  id: string;
  workspace_id: string;
  source_scenario_id: string;
  source_thesis_id: string;
  source_playbook_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  mode: SimulationMode;
  sample_kind: ReliabilitySampleKind;
  status: SimulationRunStatus;
  status_reason: string | null;
  aggregate_version: number;
  started_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  failure_reason: string | null;
  market_time: string | null;
  last_processed_candle_id: string | null;
  assumptions_hash: string;
  setup_expiry_at: string | null;
  position_max_duration_minutes: number | null;
  evaluation_window: {
    starts_at: string | null;
    ends_at: string | null;
    horizon: string;
  };
  playbook_snapshot: TradePlaybookResponse;
  analysis_snapshot: {
    scenario: Record<string, unknown>;
    thesis: Record<string, unknown>;
    scenario_recommendation: Record<string, unknown> | null;
    decision_playbook: Record<string, unknown> | null;
    chart_source_versions: Record<string, unknown> | null;
  };
  assumptions: SimulationAssumptions;
  market_data_snapshot: MarketDataSnapshot;
  sample_identity: SimulationSampleIdentity;
  source_integrity_status: SourceIntegrityStatus;
  source_drift_after_start: boolean;
  source_hashes: {
    scenario: string;
    decision_playbook: string | null;
    recommendation: string | null;
    trade_playbook: string;
  };
}
```

### Simulation Assumptions

```ts
export interface SimulationRiskExit {
  type: 'hard_stop' | 'close_confirmation' | 'condition';
  level: DecimalString | null;
  condition: Record<string, unknown> | null;
}

export interface SimulationThesisInvalidation {
  level: DecimalString | null;
  condition: Record<string, unknown> | null;
}

export interface SimulationAssumptions {
  version: 'simulation_assumptions.v1';
  fill_policy: 'touch' | 'next_open_after_trigger';
  gap_fill_policy: 'requested_price' | 'first_tradable_price' | 'reject_if_skipped';
  intrabar_policy: 'stop_first' | 'target_first' | 'ambiguous_warning';
  slippage_bps: DecimalString;
  fee_bps: DecimalString;
  position_size: {
    mode: 'fixed_notional' | 'fixed_quantity';
    notional: DecimalString | null;
    quantity: DecimalString | null;
  };
  risk_exit: SimulationRiskExit;
  thesis_invalidation: SimulationThesisInvalidation;
  partial_take_profit: Array<{
    target_index: number;
    close_percent: DecimalString;
  }>;
  setup_expiry_at: string | null;
  position_max_duration_minutes: number | null;
  force_close_at_data_end: boolean;
}
```

`close_confirmation` fill policy is intentionally deferred. If the product later needs it, it must specify whether fill happens at candle close or next open.

### Paper Order

```ts
export type PaperOrderStatus =
  | 'created'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export interface PaperOrderResponse {
  version: 'paper_order.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  side: 'buy' | 'sell';
  intent: 'entry' | 'exit' | 'stop' | 'target' | 'reduce';
  status: PaperOrderStatus;
  order_type: 'market' | 'limit' | 'stop';
  trigger_condition: Record<string, unknown>;
  requested_price: DecimalString | null;
  filled_price: DecimalString | null;
  quantity: DecimalString;
  created_at_market_time: string | null;
  filled_at_market_time: string | null;
  cancelled_at_market_time: string | null;
  reason_code: string;
}
```

### Paper Position

```ts
export type PaperPositionStatus =
  | 'open'
  | 'partially_closed'
  | 'closed';

export type PaperPositionCloseReason =
  | 'target'
  | 'stop'
  | 'position_timeout'
  | 'thesis_invalidation'
  | 'manual_close'
  | 'data_end';

export interface PaperPositionResponse {
  version: 'paper_position.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: 'long' | 'short';
  status: PaperPositionStatus;
  quantity_opened: DecimalString;
  quantity_remaining: DecimalString;
  average_entry_price: DecimalString | null;
  realized_pnl: DecimalString | null;
  unrealized_pnl: DecimalString | null;
  realized_pnl_pct: DecimalString | null;
  unrealized_pnl_pct: DecimalString | null;
  opened_at_market_time: string | null;
  closed_at_market_time: string | null;
  close_reason: PaperPositionCloseReason | null;
}
```

### Execution Event Ledger

```ts
export type ExecutionEventType =
  | 'simulation_started'
  | 'playbook_snapshot_frozen'
  | 'entry_zone_entered'
  | 'entry_condition_confirmed'
  | 'paper_order_created'
  | 'paper_order_partially_filled'
  | 'paper_order_filled'
  | 'paper_order_cancelled'
  | 'paper_order_rejected'
  | 'paper_order_expired'
  | 'position_opened'
  | 'target_hit'
  | 'position_partially_closed'
  | 'stop_hit'
  | 'invalidation_hit'
  | 'setup_expired'
  | 'position_timeout_hit'
  | 'data_end_reached'
  | 'position_closed'
  | 'simulation_completed'
  | 'simulation_cancelled'
  | 'simulation_failed'
  | 'evaluation_completed';

export interface ExecutionEventResponse {
  version: 'execution_event.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_playbook_id: string;
  source_scenario_id: string;
  event_type: ExecutionEventType;
  sequence: number;
  aggregate_version: number;
  correlation_id: string;
  causation_event_id: string | null;
  idempotency_key: string;
  order_id: string | null;
  position_id: string | null;
  target_index: number | null;
  occurrence_index: number;
  market_time: string | null;
  recorded_at: string;
  price: DecimalString | null;
  quantity: DecimalString | null;
  reason_code: string;
  source_candle_id: string | null;
  payload: Record<string, unknown>;
}
```

Ledger constraints:

```text
UNIQUE(simulation_run_id, sequence)
UNIQUE(simulation_run_id, idempotency_key)
```

The idempotency key must include enough deterministic identity to distinguish repeated events in the same candle, such as command id, order id, position id, target index, and occurrence index.

### Simulation Outcome

```ts
export type ThesisOutcome =
  | 'supported'
  | 'challenged'
  | 'invalidated'
  | 'inconclusive';

export type ResearchEvaluationStatus =
  | 'pending'
  | 'rule_based'
  | 'llm_assisted';

export type ExecutionResult =
  | 'win'
  | 'loss'
  | 'breakeven'
  | 'missed'
  | 'inconclusive';

export type ExecutionQuality =
  | 'rule_following'
  | 'poor_entry'
  | 'poor_exit'
  | 'missed_trigger'
  | 'invalid_experiment'
  | 'insufficient_data';

export type DiagnosisCode =
  | 'THESIS_SUPPORTED'
  | 'THESIS_CHALLENGED'
  | 'THESIS_INVALIDATED'
  | 'ENTRY_PREMATURE'
  | 'ENTRY_MISSED'
  | 'STOP_TOO_TIGHT'
  | 'TARGET_REACHED_AFTER_EXPIRY'
  | 'AMBIGUOUS_INTRABAR'
  | 'INSUFFICIENT_FUTURE_DATA'
  | 'DATA_END_REACHED'
  | 'SOURCE_INTEGRITY_FAILED'
  | 'ENGINE_FAILURE';

export type SimulationCloseReason =
  | PaperPositionCloseReason
  | 'setup_expiry'
  | null;

export interface SimulationOutcomeResponse {
  version: 'simulation_outcome.v1';
  id: string;
  workspace_id: string;
  simulation_run_id: string;
  source_scenario_id: string;
  source_playbook_id: string;
  sample_kind: ReliabilitySampleKind;
  sample_identity: SimulationSampleIdentity;
  execution_result: ExecutionResult;
  research_evaluation_status: ResearchEvaluationStatus;
  thesis_outcome: ThesisOutcome | null;
  execution_quality: ExecutionQuality;
  close_reason: SimulationCloseReason;
  realized_pnl: DecimalString | null;
  realized_pnl_pct: DecimalString | null;
  max_favorable_excursion: DecimalString | null;
  max_adverse_excursion: DecimalString | null;
  reliability_eligible: boolean;
  diagnosis_codes: DiagnosisCode[];
  diagnosis_summary: string;
  warnings: string[];
  evaluated_at: string;
}
```

Reliability must read machine-readable codes and metrics, not free-text diagnosis.

## Lifecycle Rules

V8 must keep separate lifecycles:

```text
Trade Playbook:
  current -> stale -> superseded
  current -> unverifiable

Simulation Run:
  created -> waiting_for_trigger -> entry_triggered -> order_pending
  order_pending -> position_open -> completed
  created/waiting_for_trigger/order_pending/position_open -> cancelled
  created/waiting_for_trigger/order_pending/position_open -> failed

Paper Order:
  created -> filled
  created -> partially_filled -> filled
  created/partially_filled -> cancelled
  created -> rejected
  created -> expired

Paper Position:
  open -> partially_closed -> closed
  open -> closed
```

Do not encode close outcomes as position statuses such as `closed_target`.
Use:

```text
status = 'closed'
close_reason = 'target' | 'stop' | 'position_timeout' | ...
```

`SimulationRun.status` is a summary projection. The exact state must be rebuildable from the frozen run snapshot and execution ledger.

## Simulation Rules

### Starting A Simulation

`POST /playbooks/:id/simulations` must reject when:

- Playbook status is not `current`.
- Playbook direction is `avoid`.
- Entry has no numeric level or zone.
- Invalidation has no numeric level and no explicit risk-exit rule can be compiled.
- Targets are missing or all targets lack numeric levels.
- Position sizing assumptions are missing or invalid.
- Position sizing mode is `risk_fraction`.
- Setup expiry or evaluation window cannot be derived.
- Market data source cannot provide candles for requested mode.
- Workspace access is missing.
- A forward simulation is already active for the same workspace, playbook, and assumptions hash.

Allow start with warnings when:

- Research evidence quality is low.
- Reliability sample is small.
- Source scenario confidence is low.
- Backtest history is absent.

### Entry Behavior

The simulator must not open at current price unless the playbook's entry rule explicitly says market entry now.

For a short retest playbook:

```text
current price = 566
entry zone = 578-582
```

The simulation starts in `waiting_for_trigger`. It opens only after candles touch or confirm the entry zone according to `fill_policy`.

### Fill And Gap Semantics

Supported V8 fill policies:

| Fill policy | Trigger observation | Fill market time | Fill base price |
| --- | --- | --- | --- |
| `touch` | Candle range intersects entry level or zone | Current candle | Deterministic entry boundary |
| `next_open_after_trigger` | Candle T satisfies trigger condition | Candle T+1 | Next candle open |

For entry zones:

- Long entries fill at the lower accepted boundary when price enters from above, or the breakout boundary when the playbook explicitly defines breakout entry.
- Short entries fill at the upper accepted boundary when price enters from below, or the breakdown boundary when the playbook explicitly defines breakdown entry.
- If the candle skips the requested boundary, apply `gap_fill_policy`.

Gap policies:

| Gap policy | Behavior |
| --- | --- |
| `requested_price` | Fill at the requested deterministic boundary. |
| `first_tradable_price` | Fill at the first available candle open after the skip. |
| `reject_if_skipped` | Do not fill; emit `ENTRY_MISSED` or keep waiting if the setup remains valid. |

If trigger and stop/target are touched inside the same candle, apply `intrabar_policy`. With `ambiguous_warning`, mark the outcome inconclusive or emit `AMBIGUOUS_INTRABAR`; do not overclaim the trade result.

### Stop And Thesis Invalidation

Stop execution and thesis invalidation are separate concepts:

```text
risk_exit           -> paper execution exit rule
thesis_invalidation -> research invalidation rule
```

For V8 MVP:

- If the playbook already provides an explicit `risk_exit`, use it.
- If it only provides numeric invalidation, compile that numeric level into `risk_exit.type = 'hard_stop'` with touch semantics.
- Keep the original invalidation condition in `thesis_invalidation` for research evaluation.

### Expiry, Timeout, And Data End

V8 must separate three clocks:

```text
setup_expiry_at
  Ends the waiting-for-entry period.

position_max_duration_minutes
  Limits how long an opened paper position can remain open.

market_data_snapshot.ends_at
  Marks dataset end for replay; this is not automatically a business exit.
```

Rules:

- While waiting for entry, `setup_expiry_at` completes the run as `missed` with `close_reason = 'setup_expiry'`.
- After a position opens, `position_max_duration_minutes` closes the position with `close_reason = 'position_timeout'` when configured.
- If replay reaches data end, default outcome is `inconclusive` with `DATA_END_REACHED`. Do not invent a closing trade.
- If `force_close_at_data_end = true`, close at the last confirmed market price and set `close_reason = 'data_end'`.

### Cancellation

Cancellation must be explicit:

- Waiting for trigger: cancel run; no order or position exists.
- Order created but unfilled: cancel order, then cancel run.
- Position open: reject plain cancel. Require a close policy:
  - `manual_close` at current simulated price, or
  - abandon as inconclusive without synthetic PnL.

The UI must not silently close an open paper position at an implicit price.

### Engine Failure

If the service fails:

- `simulation_run.status = 'failed'`.
- Any paper position remains at the last state rebuildable from the ledger.
- Outcome is inconclusive.
- `reliability_eligible = false`.
- No `position_closed` event is emitted unless a separate explicit force-close command runs later.

### Replay Mode

Replay mode consumes a bounded historical window:

```text
from = simulation starts_at
to = simulation ends_at
```

The engine must process candles in order and make decisions only from candles at or before the current simulated market time.

### Forward Mode

Forward mode consumes newly available OHLCV data. It may be polled or refreshed manually in V8. It must still create virtual orders and positions only.

## API Surfaces

Likely endpoints:

```text
POST /playbooks/:id/simulations
GET /playbooks/:id/simulations
GET /simulations/:id
POST /simulations/:id/refresh
POST /simulations/:id/cancel
POST /simulations/:id/close
GET /simulations/:id/events
GET /simulations/:id/orders
GET /simulations/:id/position
GET /simulations/:id/outcome
```

Keep simulation creation separate from scenario/chart read endpoints.

`POST /simulations/:id/refresh` must run as one atomic transition:

```text
lock simulation_run_id
read last_processed_candle_id and aggregate_version
read next finalized candles
evaluate deterministic commands
append execution events with sequence and idempotency keys
rebuild or update projections
update watermark and aggregate_version
commit
```

Use either a Postgres advisory lock keyed by `simulation_run_id` or optimistic concurrency with `aggregate_version`. The implementation may choose one, but tests must prove duplicate refresh requests cannot emit duplicate transitions.

## Persistence

Add durable tables or repository methods for:

```text
simulation_runs
paper_orders
paper_positions
execution_events
simulation_outcomes
```

`execution_events` must be append-only. Projection tables may be updated, deleted, and rebuilt from:

```text
simulation_run snapshot
execution_events ordered by sequence
```

Minimum constraints:

```text
UNIQUE(simulation_run_id, sequence)
UNIQUE(simulation_run_id, idempotency_key)
UNIQUE(workspace_id, source_playbook_id, assumptions_hash)
  WHERE mode = 'forward' AND status IN ('created', 'waiting_for_trigger', 'entry_triggered', 'order_pending', 'position_open')
```

Do not update historical events to change their meaning. Append a compensating event if a correction is needed.

## Chart And Opportunity UI

### Opportunity Card

The card should show:

```text
BNB Short Retest
Entry: 578-582
Stop: 620
Targets: 550 / 535
Expires: 31h
Status: Waiting for retest
Mode: Simulation
```

The card is a read model. It must not store duplicated source levels.

Status priority:

```text
playbook stale/unverifiable
active forward run state
latest completed forward run
ready to simulate
replay history available
```

### Chart Overlay

The chart should show:

- Entry line or zone from frozen playbook snapshot.
- Stop/risk-exit line.
- Thesis invalidation marker when different from hard stop.
- Target lines.
- Setup expiry marker.
- Waiting-for-trigger status.
- Fill markers.
- Partial close markers.
- Stop/target/timeout/data-end close markers.
- Realized and unrealized PnL summary.
- Event reasons on hover.

### Actions

Allowed actions:

```text
Start simulation
Run replay
Continue simulation
Cancel simulation
Close paper position
Open simulation ledger
```

Forbidden copy:

```text
Buy
Sell
Place order
Submit order
Auto trade
Connect exchange
```

## Evaluation And Reliability

V8 outcome evaluation must classify execution deterministically and research separately:

| Thesis | Execution | Interpretation |
| --- | --- | --- |
| Supported | Rule-following | Valid win or valid thesis support |
| Supported | Poor | Playbook or entry failure |
| Challenged/Invalidated | Rule-following | Thesis failure |
| Pending/Inconclusive | Any | Do not update reliability as a confirmed sample |

A stopped-out trade does not automatically mean the thesis was wrong. The research evaluator must be able to inspect directional move, expected target zone, evaluation horizon, invalidation condition, maximum favorable excursion, and maximum adverse excursion after scenario time.

Minimum diagnosis fields:

```text
execution_result
research_evaluation_status
thesis_outcome
execution_quality
close_reason
reliability_eligible
diagnosis_codes
diagnosis_summary
```

Only reliability-eligible outcomes should feed scenario reliability memory. Runs with missing candles, ambiguous intrabar sequencing, source integrity failure, manual abandonment, engine failure, or insufficient future data should be excluded or clearly labeled.

Repeated runs over the same sample cannot inflate reliability. A reliability cohort may count only one result for each:

```text
scenario_hash
playbook_hash
market_data_hash
evaluation_window_hash
assumptions_hash
sample_kind
```

Forward observations, out-of-sample replay, in-sample replay, and manual experiments must not be merged into one undifferentiated reliability score.

## Non-Goals

V8 must not implement:

- Broker integration.
- Live orders.
- Exchange account linking.
- Strategy optimization.
- Portfolio-level sizing optimization.
- Risk-fraction sizing.
- Cross-workspace performance aggregation.
- LLM-driven tick-by-tick reassessment.
- Free-text scenario simulation without a current numeric trade playbook.

## Implementation Plan

### Step 1: Contracts And OpenAPI

- [ ] Add API response types for simulation run, assumptions, market-data snapshot, sample identity, paper order, paper position, execution event, and simulation outcome.
- [ ] Encode decimal strings for price, quantity, fee, and PnL API fields.
- [ ] Remove `risk_fraction`, `pending_trigger`, `pending_fill`, and `engine_failure` as position close reason.
- [ ] Add OpenAPI schemas and generated client types.
- [ ] Add stale-source, numeric-playbook, market-data, and forward-run uniqueness validation errors.
- [ ] Verify API and web type alignment.

### Step 2: Persistence

- [ ] Add journal repository methods for simulation runs, paper orders, paper positions, execution events, and simulation outcomes.
- [ ] Add Postgres schema and local repository support.
- [ ] Enforce append-only execution events.
- [ ] Enforce event `sequence` and `idempotency_key` uniqueness per simulation run.
- [ ] Store market-data snapshot and sample identity on simulation creation.
- [ ] Add projection rebuild support from run snapshot plus ledger.
- [ ] Add workspace-scoped read/write tests.

### Step 3: Simulation Engine

- [ ] Implement replay candle iteration without lookahead.
- [ ] Implement entry trigger detection from playbook entry level or zone.
- [ ] Implement `touch` and `next_open_after_trigger` fill policies.
- [ ] Implement gap policy and intrabar ambiguity policy.
- [ ] Implement risk exit, target, partial close, setup expiry, position timeout, data end, and cancellation behavior.
- [ ] Emit ledger events for every transition.
- [ ] Keep engine failure separate from market-driven position close.

### Step 4: API Service

- [ ] Implement `POST /playbooks/:id/simulations`.
- [ ] Implement simulation list/detail/read endpoints.
- [ ] Implement refresh, cancel, and explicit close endpoints.
- [ ] Reject invalid or stale playbooks before creating simulations.
- [ ] Freeze playbook, analysis, source hashes, market-data snapshot, and assumptions at simulation start.
- [ ] Make refresh atomic and concurrency-safe.

### Step 5: Outcome Evaluation

- [ ] Derive final PnL, MFE, MAE, result, close reason, and warnings from deterministic projections.
- [ ] Split deterministic execution outcome from research evaluation.
- [ ] Add machine-readable diagnosis codes and narrative diagnosis summary.
- [ ] Mark reliability eligibility from source integrity, data completeness, ambiguity, and sample identity.
- [ ] Connect eligible outcomes to scenario reliability memory without raw ledger injection into prompts.

### Step 6: Web UI

- [ ] Add Start simulation / Run replay actions from scenario chart or thesis detail playbook blocks.
- [ ] Add opportunity card read model with active-forward-run priority and replay history.
- [ ] Add chart markers from execution events.
- [ ] Add simulation ledger panel.
- [ ] Add paper position summary with realized/unrealized PnL.
- [ ] Add explicit close policy UI for open paper positions.
- [ ] Keep broker-like copy out of the UI.

### Step 7: Verification

- [ ] Add contract tests for invalid playbook rejection.
- [ ] Add replay tests for waiting-for-trigger behavior.
- [ ] Add tests for stop, target, partial close, setup expiry, position timeout, cancellation, and data-end outcomes.
- [ ] Add no-lookahead tests.
- [ ] Add concurrent refresh idempotency tests.
- [ ] Add projection rebuild tests that delete projection state and rebuild from snapshot plus ledger.
- [ ] Add reliability sample identity deduplication tests.
- [ ] Add workspace isolation tests.
- [ ] Add web tests for opportunity card and forbidden execution copy.
- [ ] Run focused API tests, API typecheck/build, web typecheck/tests, and `git diff --check`.

## Minimum Test Matrix

- Valid short retest waits at current price below entry and opens only when entry zone is touched.
- Valid long breakout opens only after trigger confirmation.
- Stale playbook cannot start simulation.
- Playbook with textual target and no numeric target is rejected.
- `risk_fraction` sizing is rejected in V8.
- Stop hit before target closes with `close_reason = 'stop'`.
- Target hit before stop closes or partially closes according to assumptions.
- Same-candle stop and target follows `intrabar_policy`.
- Replay engine cannot use future candles to decide entry.
- Gap across entry follows configured `gap_fill_policy`.
- Existing simulation remains valid after source scenario changes because it uses a frozen snapshot.
- Snapshot integrity failure makes the outcome not reliability-eligible.
- Concurrent refresh requests cannot emit duplicate transitions.
- Projection state can be deleted and rebuilt entirely from run snapshot plus ledger.
- Reaching data end does not invent a closing trade unless `force_close_at_data_end = true`.
- Plain cancellation of an open position is rejected unless a close policy is supplied.
- Engine failure does not emit a synthetic `position_closed` event.
- Repeated runs over the same sample identity do not inflate reliability counts.

## Definition Of Done

V8 is done when:

- Current numeric trade playbooks can start replay simulations.
- Simulations wait for entry instead of opening at current price by default.
- V8 supports `fixed_notional` and `fixed_quantity`, and rejects `risk_fraction`.
- Virtual orders, fills, positions, and outcomes are persisted.
- Execution events are append-only, sequenced, idempotent, and can rebuild the visible state.
- Concurrent refresh requests cannot emit duplicate transitions.
- Chart and opportunity card render from simulation read models.
- Opportunity cards resolve active forward run vs replay history deterministically.
- Stale or unverifiable playbooks cannot start new simulations.
- All price, quantity, fee, and PnL arithmetic uses decimal-safe values.
- Replay results identify the exact market-data snapshot used.
- Fill, gap, cancellation, and data-end behavior are deterministic and tested.
- Source changes after run start do not mutate or invalidate the frozen run.
- Outcome evaluation separates deterministic execution result from research evaluation.
- Reliability updates consume only eligible simulation outcomes and deduplicate by sample identity.
- UI copy remains simulation-only and contains no live execution language.

## Exit Criteria To V9

Move beyond V8 only when:

- Paper execution outcomes are stable enough to compare by setup type, horizon, asset, regime, and fill policy.
- The system can explain whether failures came from research, playbook structure, execution assumptions, or market data quality.
- Opportunity cards can show historical reliability without overstating sample size or data quality.
- Portfolio and equity accounting are required enough to justify risk-fraction sizing.

Potential V9 themes:

```text
cohort reliability analytics
portfolio-level paper simulation
virtual account equity and risk-fraction sizing
regime-aware opportunity scoring
advanced fill/slippage assumptions
```
