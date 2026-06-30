# Signal Evaluation V3 Implementation Plan

Last updated: 2026-06-30
Status: draft

## Goal-Ready Prompt

```text
/goal Implement Signal Evaluation V3.

Read this document first:
docs/features/signal-evaluation/v3/implementation-plan.md

Objective:
- Add multi-horizon outcome labeling for SignalObservation rows using
  point-in-time forward market data.
```

## One Outcome

For every eligible signal observation, the system can answer:

```text
What happened after this signal over 1h, 4h, 24h, 3d, and 7d windows?
```

V3 creates labels. It does not aggregate model metrics beyond basic label
counts and quality diagnostics.

## Non-Goals

- Do not train weights.
- Do not publish empirical probabilities.
- Do not evaluate thesis correctness.
- Do not simulate orders, fees, slippage, or portfolio PnL.
- Do not random-split time-series data.

## Dependencies

V3 depends on V2 native `SignalObservation` rows.

Minimum required fields:

```text
id
workspace_id
symbol
observed_at
factor_name
direction
directional_edge
availability
market_regime
volatility_regime
source_timestamp
```

Rows with `availability != valid` can receive data-health labels but must not
be treated as directional signal samples.

## Horizons

Required horizons:

```text
1h
4h
24h
3d
7d
```

Represent horizon in minutes for storage:

```text
60
240
1440
4320
10080
```

## Outcome Label Model

```python
class SignalOutcomeLabel:
    id: str
    workspace_id: str
    observation_id: str
    symbol: str
    horizon_minutes: int

    label_status: Literal[
        "complete",
        "insufficient_forward_data",
        "missing_entry_price",
        "missing_atr",
        "provider_error",
        "not_directional",
    ]

    entry_price: float | None
    exit_price: float | None
    forward_return: float | None
    benchmark_return: float | None
    excess_return: float | None
    volatility_adjusted_return: float | None

    mfe: float | None
    mae: float | None

    direction_label: Literal["up", "flat", "down", "unknown"]
    signal_direction: Literal["bullish", "bearish", "neutral", "mixed", "unknown"]
    signed_return: float | None
    direction_correct: bool | None

    upper_barrier_pct: float | None
    lower_barrier_pct: float | None
    upper_barrier_hit: bool | None
    lower_barrier_hit: bool | None
    first_barrier: Literal["upper", "lower", "timeout", "unknown"] | None
    time_to_first_barrier_minutes: int | None

    data_quality: Literal["complete", "partial", "insufficient"]
    provider: str | None
    candle_count: int
    expected_candle_count: int | None
    label_version: str
    evidence_json: dict
    created_at: datetime
```

## Label Semantics

### Forward Return

```text
forward_return = (exit_price - entry_price) / entry_price
```

For directional correctness:

```text
signed_return = forward_return for bullish
signed_return = -forward_return for bearish
signed_return = null for neutral/mixed/unknown
direction_correct = signed_return > neutral_threshold
```

Neutral observations are valid observations, but they are not directional
correctness samples.

### Direction Label

Use a volatility-aware threshold when ATR is available:

```text
up   = forward_return > max(min_return_threshold, atr_pct * flat_atr_mult)
down = forward_return < -max(min_return_threshold, atr_pct * flat_atr_mult)
flat = otherwise
```

Default V3 values:

```text
min_return_threshold = 0.0025
flat_atr_mult = 0.10
```

Keep thresholds versioned under `label_version`.

## Triple-Barrier Label

V3 should implement triple-barrier labels when ATR or equivalent volatility is
available. If ATR is unavailable, store non-barrier forward labels and set
barrier fields to null.

Barrier definition:

```text
upper = entry_price * (1 + k * atr_pct)
lower = entry_price * (1 - k * atr_pct)
timeout = horizon end
```

Default:

```text
k = 1.0
atr_window = 14
```

Classification:

```text
first_barrier = upper if upper touched before lower
first_barrier = lower if lower touched before upper
first_barrier = timeout if neither touched
```

Same-candle ambiguity:

```text
If upper and lower are touched in the same candle, mark first_barrier = unknown
and add evidence_json.same_candle_barrier_ambiguity = true.
```

Do not silently choose a favorable side.

## Market Data Rules

Use point-in-time forward OHLCV only:

- no candles before observation time except ATR lookback;
- no candles after horizon end;
- no provider data with source timestamp after label generation cutoff when
  replaying historical labels;
- store candle range and provider in evidence.

If current provider granularity is daily-only, V3 may label `3d` and `7d` first
and mark intraday horizons as `insufficient_forward_data`. Do not fake 1h/4h
labels from daily candles.

## Dataset Builder

Add a service that selects eligible observations:

```text
availability = valid
observed_at <= now - horizon
symbol matches supported OHLCV provider
not already labeled for observation_id + horizon + label_version
```

Suggested files:

```text
apps/ai-service/luna_workstation/signals/evaluation/labeler.py
apps/ai-service/luna_workstation/signals/evaluation/barriers.py
apps/ai-service/luna_workstation/signals/evaluation/dataset_builder.py
apps/ai-service/luna_workstation/storage/repositories/signal_outcomes.py
```

## API Surface

Read endpoints:

```text
GET /signals/outcomes?symbol=&factor=&horizon=&from=&to=&limit=
GET /signals/observations/:id/outcomes
```

Optional job endpoint if background jobs are available:

```text
POST /signals/outcomes/label
```

Request:

```ts
interface LabelSignalOutcomesRequest {
  symbol?: string;
  horizon_minutes?: number[];
  observed_before?: string;
  limit?: number;
  dry_run?: boolean;
}
```

Response:

```ts
interface LabelSignalOutcomesResponse {
  requested: number;
  labeled: number;
  skipped: number;
  skipped_reasons: Record<string, number>;
  label_version: string;
}
```

## Required Tests

Labeler:

- bullish signal with positive forward return is directionally correct;
- bearish signal with negative forward return is directionally correct;
- neutral signal is labeled but excluded from directional correctness;
- insufficient forward candles produce `insufficient_forward_data`;
- same-candle upper/lower barrier ambiguity is explicit;
- no labels are produced from candles outside the forward window;
- label idempotency prevents duplicate labels for the same version.

Dataset builder:

- selects matured observations only;
- filters unavailable observations out of directional labeling;
- respects workspace and symbol filters.

API:

- list outcomes by workspace, symbol, factor, and horizon;
- observation detail can include outcome labels;
- dry-run label job reports counts without writing rows.

## Validation Loop

```bash
node scripts/python.cjs -m pytest apps/ai-service/tests -k "signal and outcome"
pnpm --filter @lunaperception/api test -- api-contract
git diff --check
```

## Definition Of Done

- V2 observations can receive labels for 1h, 4h, 24h, 3d, and 7d when data
  granularity supports the horizon.
- Missing/insufficient data is recorded as label status, not hidden.
- Triple-barrier labels exist where ATR is available.
- Labeling is idempotent by observation, horizon, and label version.
- V4 can aggregate labels without consulting thesis outcomes.

## Stop Rules

Stop and write a follow-up if:

- intraday OHLCV is unavailable and would require provider expansion;
- same-candle ambiguity cannot be represented;
- implementation starts changing signal generation behavior;
- metric aggregation or weight learning enters the V3 patch.
