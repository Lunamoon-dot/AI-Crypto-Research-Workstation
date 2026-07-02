# Signal

## Purpose

Signal is the deterministic quant-evidence layer for a research run. It is not a standalone LLM agent and it does not issue trade commands. It precomputes market bias and source-level factor evidence before the LangGraph workflow, then persists that evidence with provenance so analysts, Trade Thesis, Scenario Planner, API, and UI can audit what the run relied on.

## Code

- Runtime precompute: `apps/ai-service/luna_workstation/graph/quant_signals.py`
- Engine factory: `apps/ai-service/luna_workstation/agents/utils/signal_tools.py`
- Signal engine: `apps/ai-service/luna_workstation/signals/engine.py`
- Factor types: `apps/ai-service/luna_workstation/signals/base.py`
- Composite scoring: `apps/ai-service/luna_workstation/signals/composite.py`
- Factor detectors: `apps/ai-service/luna_workstation/signals/*_signals.py`
- Domain signal model: `apps/ai-service/luna_workstation/domain/signal.py`
- Provenance conversion: `apps/ai-service/luna_workstation/signals/provenance.py`
- Snapshot builders: `apps/ai-service/luna_workstation/signals/snapshots.py`
- Journal persistence: `apps/ai-service/luna_workstation/graph/journal_bridge.py`
- Local signal reads: `apps/ai-service/luna_workstation/services/signal_service.py`
- API: `apps/api/src/signals/`
- API contract mapper: `apps/api/src/contracts/frontend-contract.ts`
- Web client: `apps/web/src/services/signals.ts`
- Web pages: `apps/web/src/pages/SignalsPage.tsx` and `apps/web/src/pages/SignalDetailPage.tsx`

## When it runs

Signal precompute runs near the start of a research run, before analyst fan-out. `ResearchRunOrchestrator` calls `host._precompute_quant_signal(company_name, trade_date)`, stores the returned `SignalResult` on `host.quant_signal_result`, then saves the signal bundle through `_save_journal_quant_signals()`.

That means analysts receive a rendered quant context block instead of deriving deterministic indicators themselves. Signal persistence also happens before the expensive LLM debate finishes, so the run can link later artifacts back to exact signal IDs and snapshots.

## Inputs

Core input:

- `symbol`
- `trade_date`
- 90-day OHLCV fetched through `route_to_vendor("get_crypto_ohlcv", symbol, start, trade_date)`

Best-effort optional inputs:

- funding rate history or snapshot
- open interest history or snapshot
- liquidation data
- long/short ratio
- NVT
- exchange metrics

Optional source failures do not fail the full run by default. They are recorded as degradation reason codes such as `missing_funding_rate`, `exchange_oi_unsupported`, `missing_liquidations`, `missing_long_short_ratio`, or `missing_onchain_flows`. Core OHLCV failure is treated as a blocking input failure for signal generation.

## What it does

1. Fetches OHLCV for the run window.
2. Fetches optional perp/on-chain inputs when the configured provider supports them.
3. Builds a config-bound `SignalEngine` using `signal_weights` and `signal_thresholds`.
4. Runs deterministic factor detectors.
5. Records factor-level failures without discarding the whole signal result.
6. Combines factor outputs with `CompositeScorer`.
7. Produces a `SignalResult` with quant bias, heuristic confidence, optional empirical confidence, current price, trend, volatility, market regime, factor details, and degradation reasons.
8. Renders `SignalResult.to_prompt_block()` for prompt-safe agent context.
9. Converts the result into persisted domain `Signal` records.
10. Builds `MarketSnapshot` and immutable `SignalSnapshot` records for the run.

## Factor coverage

Current deterministic factor families:

- `regime`: trend direction, trend strength, volatility regime, and market regime from OHLCV.
- `rsi_divergence`: RSI divergence and overbought/oversold checks.
- `macd`: MACD crossover and histogram momentum checks.
- `volume_profile`: volume confirmation or rejection from OHLCV volume.
- `funding_oi`: funding and open-interest pressure when perp data is available.
- `liquidations`: long/short liquidation imbalance when liquidation data is available.
- `onchain`: long/short ratio, NVT, and exchange metrics when available.

Each detector returns a `FactorSignal` with a five-tier `SignalScore`, confidence, value, threshold flag, data quality, detail text, and metadata. The composite layer maps scores to `bullish`, `bearish`, or `neutral` quant bias for downstream consumers.

## Scoring and config

Signal weights and thresholds live in `DEFAULT_CONFIG`:

- `signal_weights.version`
- factor weights for `funding_oi`, `rsi_divergence`, `macd`, `volume_profile`, `liquidations`, `regime`, and `onchain`
- `signal_thresholds.strong_buy`
- `signal_thresholds.buy`
- `signal_thresholds.sell`
- `signal_thresholds.strong_sell`

`CompositeScorer` weights each factor by configured factor weight, factor confidence, and factor data quality. It then applies agreement bonus and volatility discount before assigning a five-tier score. The resulting `confidence` is a heuristic confidence. Empirical confidence is only publishable when enough validated sample and out-of-sample observations exist.

## Persisted records

Signal persistence creates three related artifact types:

- `Signal`: one aggregate `quant_bias` signal plus one record per factor.
- `MarketSnapshot`: point-in-time market context from the composite signal result.
- `SignalSnapshot`: immutable list of saved signal IDs for the research run.

Saved signals carry:

- `workspace_id`
- `symbol`
- `signal_type`
- `direction`
- `evidence_lane`
- `evidence_category`
- `strength`
- `confidence`
- heuristic and empirical confidence fields
- `confidence_version`
- `observed_at`
- `provenance`
- `evidence`
- `watch_conditions`
- `summary`

`JournalService.save_quant_signal_bundle()` saves signals, market snapshot, signal snapshot, and the updated research run in one transaction. The research run receives `market_snapshot_id`, `signal_snapshot_id`, and `signal_ids`.

## Lanes and watch conditions

Signal rules normalize legacy signal names and classify evidence into lanes:

- `quant_bias`: aggregate composite evidence.
- `spot`: spot/price/volume/regime evidence.
- `perp`: funding, open interest, basis, liquidation, and positioning evidence.
- `unknown`: unclassified evidence.

The same registry builds `watch_conditions` for each persisted signal. These are monitoring prompts such as what changed, what would invalidate the evidence, and when to review it. They are evidence-review guidance, not exchange execution instructions.

## Freshness and degradation

Signal provenance tracks source timestamp, observed timestamp, freshness state, age in seconds, source confidence, optional historical reliability, and metadata. The default stale-data window is 24 hours.

`stale_data.mode` controls runtime behavior:

- `warn`: log and persist stale/unknown freshness, then continue.
- `fail_fast`: raise `StaleDataError` when data exceeds the freshness threshold.

The journal bridge also logs snapshot health from total signal count and stale ratio. Trade Thesis later uses stale or unknown signal freshness as data-quality pressure.

## API and UI contract

The API exposes saved signals through:

- `GET /signals`
- `GET /signals/:id`
- `GET /signals/count`

`SignalsService` enforces user/workspace access, normalizes optional crypto symbols, clamps list limits, and maps records through `frontend-contract.ts`.

Postgres reads scope signals to the requested workspace and hide signals linked to failed research runs. Completed and completed-degraded runs remain visible. Standalone signals without a snapshot reference may also be returned.

The web surface uses:

- `SignalsPage`: groups signal records by research run or signal snapshot and shows direction/confidence summaries.
- `SignalDetailPage`: shows provenance, source freshness, evidence payload, watch conditions, linked run, linked signal snapshot, and raw API JSON.

## Downstream consumers

- Analyst prompts consume the rendered quant signal block as deterministic context.
- Trade Thesis uses `current_signals` and `quant_signal_result` to classify supporting and contradicting signal IDs, compute data-quality notes, and anchor confidence.
- Scenario Planner can receive `quant_signal_text` or `signal_text` as scenario source context.
- Research continuity, research chat, calibration, evaluation, and UI surfaces use persisted signal snapshots for auditability.
- API/web consumers inspect signals by workspace, symbol, run, snapshot, freshness, and provenance.

## Guardrails

- Does not call an LLM.
- Does not issue exchange orders.
- Does not replace analyst debate or thesis generation.
- Treats OHLCV as core data and optional perp/on-chain inputs as degradable evidence.
- Persists degradation and missing-data reason codes instead of hiding provider gaps.
- Keeps `quant_bias` as aggregate evidence, not execution guidance.
- Preserves workspace isolation at service and repository boundaries.
- Links signals to immutable snapshots so later thesis/scenario review can audit the exact evidence set used by the run.
