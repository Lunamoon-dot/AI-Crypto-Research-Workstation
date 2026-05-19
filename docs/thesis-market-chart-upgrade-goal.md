# Thesis Market Chart Upgrade Goal Plan

Last updated: 2026-05-18

Purpose: replace the current simple thesis pulse SVG with a serious, exchange-like
market chart for the thesis monitor workstation. This is a local/web feature
goal. It must not expand into auth, billing, production infra, order execution,
or cloud deployment.

This document is intentionally written in English and ASCII-friendly terms so it
can be pasted into `/goal` with fewer interpretation errors.

## Copy-Paste Goal Prompt

Use this prompt for `/goal`:

```text
/goal Implement the Thesis Market Chart Upgrade described in docs/thesis-market-chart-upgrade-goal.md end-to-end.

Read docs/thesis-market-chart-upgrade-goal.md first, then inspect the current monitor implementation.

Objective:
- Replace the current custom SVG price-to-thesis chart with an exchange-like interactive chart in the thesis monitor page.
- Add a local API path for OHLCV candles so the chart can render real candlesticks instead of only pulse prices.
- Overlay thesis monitoring context on top of the market chart: baseline, invalidation, entry zone/entry bounds, targets, pulse markers, memo markers where available.
- Add workstation-grade controls: interval selector, range selector, chart type selector, overlay toggles, manual refresh, fit latest/fit thesis actions.
- Keep all existing thesis monitoring workflows working: manual pulse, memo run, plan edit, scheduler pause/resume/run-due.

Hard constraints:
- Do not add auth, billing, cloud Postgres/Redis requirements, or product infra.
- Do not trigger full research runs or LLM memo runs as part of verification.
- Do not change user decision/outcome review fields.
- Do not remove existing monitoring API behavior.
- Do not touch CLI flows.
- Do not use the paid/proprietary TradingView Advanced Charting Library.
- Use TradingView Lightweight Charts unless a codebase conflict makes it impossible.
- Keep implementation local-first and web-first.
- Do not revert unrelated dirty worktree changes.

Definition of done:
- The monitor page no longer uses the old custom SVG chart as the primary chart.
- The chart renders candles when OHLCV data is available and has a pulse-only fallback when candles are unavailable.
- Thesis overlays and pulse/memo markers render accurately.
- Chart controls work without page reload.
- Pulse timeline can focus/highlight related chart markers.
- API, web types/services, query keys, and UI are wired through existing patterns.
- Focused API tests cover the OHLCV endpoint and validation.
- Build/test commands listed in the document pass, or any blocker is documented with exact command output summary.
```

## One-Line Product Direction

The chart should feel like a market workstation chart with thesis intelligence
on top, not a generic dashboard card and not a trading execution terminal.

## Why This Goal Exists

The current chart is useful as a proof of concept but not enough for market
monitoring:

- It is a hand-written SVG inside `apps/web/src/components/theses/ThesisMonitorPanel.tsx`.
- It only plots `ThesisPulse.current_price`.
- With a small number of pulse rows, especially repeated prices, the chart is
  visually flat and cannot explain intraday movement.
- It has no candlesticks, no zoom/pan, no crosshair, no volume, no interval
  control, no chart type control, and no useful market context.

The new chart must make it easier to answer:

- Where is current price relative to thesis baseline?
- Has price approached invalidation?
- Did a pulse happen on meaningful market movement?
- Did a memo summarize a real cluster of pulse changes?
- What changed over 5m, 15m, 1h, 4h, or 1d windows?

## Current Code Map

Start with these files:

- `apps/web/package.json`
  - Currently has no `lightweight-charts` dependency.
- `apps/web/src/components/theses/ThesisMonitorPanel.tsx`
  - Current chart lives around the `Price-to-thesis chart` SVG.
  - Existing monitor controls, plan editor, pulse timeline, memo history, and
    scheduler controls also live here.
- `apps/web/src/styles/index.css`
  - Current chart styles are under `.thesis-monitor-chart`.
- `apps/web/src/services/thesis-monitoring.ts`
  - Existing web service for monitor plan, pulses, memos, scheduler.
- `apps/web/src/services/query-keys.ts`
  - Existing query key patterns.
- `apps/web/src/types/index.ts`
  - Existing frontend API response types.
- `apps/web/src/pages/ThesisMonitorPage.tsx`
  - Route page for `/theses/:id/monitor`.
- `apps/api/src/market-data/market-price.service.ts`
  - Existing local Binance ticker-style service.
- `apps/api/src/app.module.ts`
  - Add a market data module/controller through normal NestJS module wiring.
- `apps/api/test/api-contract.test.ts`
  - Existing API contract tests and harness patterns.

Useful existing monitoring endpoints:

- `GET /theses/:id/monitor-plan`
- `GET /theses/:id/pulses`
- `POST /theses/:id/pulses/run`
- `GET /theses/:id/pulse-memos`
- `POST /theses/:id/pulse-memos/run`
- `GET /theses/:id/scheduler`
- `POST /theses/:id/scheduler/resume`
- `POST /theses/:id/scheduler/pause`
- `POST /theses/:id/scheduler/run-due`

## Library Decision

Use TradingView Lightweight Charts:

- Official docs: https://tradingview.github.io/lightweight-charts/
- Product page: https://www.tradingview.com/lightweight-charts/
- Product comparison: https://www.tradingview.com/charting-library-docs/latest/getting_started/product-comparison/

Reasons:

- It is built for financial charts.
- It supports candlestick, line, area, histogram/volume, time scale, price scale,
  price lines, crosshair, markers, and streaming/custom data.
- It is much lighter than a full exchange terminal.
- It is suitable for local MVP and can be replaced later if product requirements
  demand a licensed advanced chart.

Important:

- Do not hide required attribution or violate the license/NOTICE requirements.
- Do not use TradingView Widgets for this goal because widgets cannot consume our
  thesis pulse/memo data as a first-class overlay.
- Do not use TradingView Advanced Charts/Charting Library for this goal.

## Scope

In scope:

- New OHLCV API endpoint for chart candles.
- Web service/types/query key for OHLCV.
- New interactive chart component.
- Thesis overlays: baseline, invalidation, entry bounds/zone, targets.
- Pulse markers.
- Memo markers if memo timestamps and referenced pulse IDs can be mapped.
- Interval/range/chart-type/overlay controls.
- Manual refresh.
- Responsive desktop/laptop/mobile layout.
- Empty/loading/error states.
- Tests and build verification.

Out of scope:

- User accounts/auth changes.
- Billing/subscription.
- Cloud Postgres/Redis/BullMQ requirements.
- Order placement, trade execution, long/short position orders.
- Order book, depth chart, liquidation heatmap.
- Full indicator suite.
- Pine Script, custom strategy editor, drawing tools.
- Rebuilding watchlists/briefs.
- Triggering expensive full research or LLM memo workflows during verification.

## Target UX

The monitor page should become a compact thesis workstation:

- Chart takes the primary width.
- Timeline/memo context stays nearby but should not dominate the chart.
- Controls sit above the chart in a compact toolbar.
- No marketing hero layout.
- No giant explanatory text inside the tool.
- No nested card-heavy layout.
- Use existing app style and `lucide-react` icons where useful.
- Keep numbers readable and stable.
- Prefer functional density over decorative visuals.

Chart should support:

- Candlestick mode.
- Line mode.
- Area mode.
- Volume pane/histogram toggle.
- Crosshair with OHLCV legend.
- Zoom and pan.
- Fit latest.
- Fit thesis window.
- Reset zoom.
- Manual refresh.
- Auto-refresh when scheduler is enabled, with conservative polling.
- Pulse-only fallback when OHLCV is unavailable.

## Backend Plan

### Backend Phase 1 - Add OHLCV Contract

Add frontend/backend types for:

```ts
export type MarketChartInterval =
  | '1m'
  | '5m'
  | '15m'
  | '1h'
  | '4h'
  | '1d';

export interface MarketOhlcvCandleResponse {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface MarketOhlcvResponse {
  symbol: string;
  market_type: 'spot' | 'perp';
  interval: MarketChartInterval;
  from: string;
  to: string;
  source: string;
  provider: string;
  generated_at: string;
  candles: MarketOhlcvCandleResponse[];
  warning: string | null;
}
```

Add a new endpoint:

```text
GET /market-data/ohlcv?symbol=ETH/USDT&market_type=spot&interval=5m&from=2026-05-18T00:00:00.000Z&to=2026-05-18T12:00:00.000Z&limit=500
```

Rules:

- `symbol` is required.
- Normalize crypto symbols using existing symbol helpers where possible.
- `market_type` defaults to `spot`.
- `interval` defaults to `15m`.
- `from` and `to` are optional, but the service must create safe defaults.
- `limit` defaults to a safe value and must be capped.
- Reject unknown intervals with `400 Bad Request`.
- Reject invalid date ranges with `400 Bad Request`.
- Reject absurd ranges that would require too many candles.
- Return candles sorted ascending by time.
- Deduplicate duplicate candle timestamps.
- Drop malformed candle rows.

Recommended default ranges:

```text
1m  -> last 6 hours, max 500 candles
5m  -> last 24 hours, max 500 candles
15m -> last 3 days, max 500 candles
1h  -> last 14 days, max 500 candles
4h  -> last 60 days, max 500 candles
1d  -> last 365 days, max 500 candles
```

### Backend Phase 2 - Provider Service

Add a dedicated service, likely near `apps/api/src/market-data`:

```text
apps/api/src/market-data/market-data.module.ts
apps/api/src/market-data/market-data.controller.ts
apps/api/src/market-data/market-ohlcv.service.ts
```

Provider approach for v1:

- Do not call the Python AI service for chart candles.
- Do not call an LLM.
- Use direct public exchange HTTP in the NestJS API, matching the style of
  `MarketPriceService`.
- For spot, use Binance spot klines by default:
  - base URL env: `OHLCV_SPOT_BASE_URL`, fallback `https://api.binance.com`
  - endpoint: `/api/v3/klines`
- For perp, use Binance futures klines by default:
  - base URL env: `OHLCV_PERP_BASE_URL`, fallback `https://fapi.binance.com`
  - endpoint: `/fapi/v1/klines`

Provider response mapping:

```text
raw[0] -> open time ms
raw[1] -> open
raw[2] -> high
raw[3] -> low
raw[4] -> close
raw[5] -> volume
```

Config:

```text
OHLCV_REFRESH_ENABLED=true
OHLCV_SPOT_BASE_URL=https://api.binance.com
OHLCV_PERP_BASE_URL=https://fapi.binance.com
OHLCV_TIMEOUT_MS=4000
OHLCV_CACHE_TTL_MS=30000
OHLCV_MAX_LIMIT=1000
```

If provider fails:

- Return a clear API error for direct endpoint calls.
- The web chart should still fall back to pulse-only visualization.
- Do not break monitor page rendering.

### Backend Phase 3 - Cache

Add a small in-memory cache in `MarketOhlcvService`.

Cache key:

```text
workspaceId + symbol + market_type + interval + from + to + limit
```

Cache rules:

- TTL default 30 seconds.
- Cap total entries to avoid unbounded memory growth.
- Return cached candles if fresh.
- Do not persist candles to Postgres/SQLite in this goal unless the repo already
  has an obvious market candle table. The first chart goal should stay local and
  low-risk.

### Backend Phase 4 - Tests

Add focused tests in `apps/api/test/api-contract.test.ts` or a nearby pattern:

- Valid request returns normalized candle response.
- Unknown interval returns `400`.
- Invalid range returns `400`.
- Limit is capped.
- Spot maps Binance klines correctly.
- Perp maps futures klines correctly if implemented.
- Provider failure produces a controlled error.

Mock `fetch` in tests. Do not hit real Binance in unit/contract tests.

## Frontend Plan

### Frontend Phase 1 - Dependency

Add dependency:

```powershell
pnpm --filter @lunaperception/web add lightweight-charts
```

Then verify `apps/web/package.json` includes it.

### Frontend Phase 2 - Types, Service, Query Key

Add types to `apps/web/src/types/index.ts`:

- `MarketChartInterval`
- `MarketOhlcvCandleResponse`
- `MarketOhlcvResponse`
- possibly `MarketChartType = 'candles' | 'line' | 'area'`

Add service:

```text
apps/web/src/services/market-data.ts
```

Service function:

```ts
export function getMarketOhlcv(
  auth: WorkspaceRequestContext,
  params: {
    symbol: string;
    market_type?: 'spot' | 'perp';
    interval?: MarketChartInterval;
    from?: string;
    to?: string;
    limit?: number;
  },
): Promise<MarketOhlcvResponse>
```

Add query key:

```ts
marketOhlcv: (symbol, marketType, interval, rangeKey) => ...
```

Follow existing query key and service patterns.

### Frontend Phase 3 - Chart Component

Create a separate component rather than growing `ThesisMonitorPanel.tsx` more:

```text
apps/web/src/components/theses/ThesisMarketChart.tsx
```

Props should include:

```ts
type ThesisMarketChartProps = {
  plan: ThesisMonitorPlanResponse;
  pulses: ThesisPulseResponse[];
  memos: ThesisPulseMemoResponse[];
  candles: MarketOhlcvCandleResponse[];
  isLoadingCandles: boolean;
  candleError: Error | null;
  interval: MarketChartInterval;
  chartType: 'candles' | 'line' | 'area';
  visibleOverlays: {
    thesisLevels: boolean;
    pulses: boolean;
    memos: boolean;
    volume: boolean;
  };
  selectedPulseId?: string | null;
  onSelectPulse?: (pulseId: string | null) => void;
  onRefresh?: () => void;
};
```

Implementation requirements:

- Use `useRef` for chart container and chart instance.
- Create the chart once per container lifecycle.
- Clean up chart instance on unmount.
- Use `ResizeObserver` for responsive sizing.
- Use `chart.addSeries(CandlestickSeries, ...)` for candles on v5 API.
- Use `LineSeries` or `AreaSeries` for line/area modes.
- Use `HistogramSeries` for volume when enabled.
- Use price lines for baseline, invalidation, and targets.
- Use markers for pulses and memos.
- Keep marker colors deterministic:
  - `calm`: neutral/green
  - `watch`: amber
  - `review`: orange
  - `invalidated`: red
- Do not store high-frequency crosshair movement in expensive parent state.
- Use a small local legend for OHLCV values from crosshair.

Pulse-only fallback:

- If candles are empty but pulses have `current_price`, render a line/area series
  from pulse observed timestamps.
- Still render thesis levels where possible.
- Show a compact warning that candle data is unavailable.

### Frontend Phase 4 - Controls

Add compact controls above chart:

Interval selector:

```text
1m 5m 15m 1h 4h 1d
```

Range selector:

```text
1D 7D 30D Thesis All
```

Chart type:

```text
Candles Line Area
```

Overlay toggles:

```text
Levels Pulses Memos Volume
```

Actions:

```text
Refresh
Fit latest
Fit thesis
Reset zoom
```

Rules:

- Use icons from `lucide-react` for action buttons where clear.
- Use text labels for interval/range selectors.
- Do not use hero-size typography inside the chart toolbar.
- Keep controls stable in size so toggling does not shift the layout.
- On mobile, controls wrap into compact rows without horizontal overflow.

### Frontend Phase 5 - Integrate With Monitor Page

Update `ThesisMonitorPanel.tsx`:

- Replace the old `PulseChart` SVG as the primary chart.
- Keep existing monitor status cards.
- Keep existing run pulse, run memo, edit plan, scheduler controls.
- Keep existing pulse timeline and memo history.
- Wire chart state:
  - selected interval
  - selected range
  - selected chart type
  - overlay visibility
  - selected pulse ID
- Fetch OHLCV only when a valid plan/symbol exists.
- Use existing auth/workspace query patterns.
- Auto-refresh candles and pulses conservatively when scheduler is enabled.

Recommended query behavior:

- `refetchInterval` only when scheduler is enabled.
- Keep interval conservative, for example 30-60 seconds for candles.
- Do not poll at 1-second frequency.
- Manual refresh should invalidate both candle and pulse queries.

### Frontend Phase 6 - Timeline Linking

Upgrade pulse timeline behavior:

- Clicking a pulse row selects that pulse.
- Selected pulse row gets a clear active state.
- Chart scrolls/fits around that pulse timestamp if possible.
- Chart marker for selected pulse is visually stronger.
- If the selected pulse is outside loaded candle range, show a compact message or
  adjust range if reasonable.

Memo linking:

- If memo references pulse IDs, memo marker should align to the latest referenced
  pulse timestamp or memo `created_at`.
- Clicking a memo can highlight referenced pulse markers if the data supports it.
- If memo references cannot be mapped, skip marker rather than guessing.

## UI Layout Recommendation

Desktop:

```text
Monitor status strip
Scheduler strip
Toolbar
Main chart: 70-75% width
Right rail: pulse timeline / memo snippets
Plan editor and detailed memo history below
```

Laptop:

```text
Toolbar wraps to two lines
Chart remains full-width first
Timeline appears below or as a right column if width allows
```

Mobile:

```text
Chart first
Controls wrap into segmented rows
Timeline below chart
No horizontal scrolling
```

Chart dimensions:

- Desktop height: about 460-560 px.
- Laptop height: about 400-480 px.
- Mobile height: about 320-380 px.
- Use stable min-height so loading/error states do not collapse the layout.

## Visual Requirements

The current app is dark and purple-accented. The chart should stay in the same
world but reduce the toy-like purple dominance:

- Background: near-black/zinc, not pure `#000000`.
- Grid: subtle gray lines.
- Bull candles: controlled green.
- Bear candles: controlled red.
- Baseline: neutral or soft violet.
- Invalidation: red dashed or red price line.
- Targets: blue/cyan or muted green price lines.
- Entry bounds: amber or neutral twin lines.
- Pulse markers: status-based.
- Memo markers: small, distinct, not louder than invalidation.

Avoid:

- Neon glows.
- Decorative gradient blobs.
- Oversized labels.
- Text overlapping candles.
- Toolbar buttons that resize on click.
- Chart labels that hide critical price levels.

## Data Semantics

Use thesis monitor plan fields:

- `baseline_price`
- `entry_low`
- `entry_high`
- `invalidation_level`
- `targets`
- `latest_price`
- `symbol`
- `market_type`

Use pulse fields:

- `id`
- `observed_at`
- `current_price`
- `status`
- `score`
- `suggested_action`
- `reason_codes`

Use memo fields:

- `id`
- `created_at`
- `window_started_at`
- `window_ended_at`
- `referenced_pulse_ids`
- any summary/action fields already present

Do not mutate these records for display. Derive chart markers in frontend.

## Edge Cases

Handle these explicitly:

- No monitor plan.
- Plan exists but no symbol.
- No candles from provider.
- Provider HTTP error.
- Candles have null/malformed values.
- Pulse has null `current_price`.
- Pulse timestamp is outside candle range.
- All candle prices are identical.
- Only one pulse row exists.
- Invalidation/baseline/targets are outside visible candle price range.
- Scheduler is paused.
- Scheduler is running and queries refresh while chart is visible.
- Mobile viewport narrow enough to force toolbar wrapping.

## Suggested Implementation Order

### Step 0 - Read And Confirm Current State

- Inspect current monitor page/component.
- Inspect existing service/query/type patterns.
- Confirm package manager and current dependency state.
- Confirm no chart library currently exists in `apps/web/package.json`.

Stop only if the repo state contradicts this document in a way that changes the
implementation approach.

### Step 1 - Backend OHLCV Endpoint

- Add `MarketDataModule`.
- Add `MarketDataController`.
- Add `MarketOhlcvService`.
- Add DTO/query parsing helpers.
- Add in-memory TTL cache.
- Wire module into `AppModule`.
- Add API tests with mocked fetch.

Acceptance:

- Endpoint returns candles for mocked provider response.
- Endpoint rejects bad input.
- API tests pass.

### Step 2 - Web Data Layer

- Add dependency `lightweight-charts`.
- Add frontend market data types.
- Add `services/market-data.ts`.
- Add query key.

Acceptance:

- TypeScript compiles through the new service/types.

### Step 3 - Chart Component

- Build `ThesisMarketChart`.
- Render candles.
- Render pulse-only fallback.
- Render price lines.
- Render markers.
- Add crosshair legend.
- Add cleanup/resizing.

Acceptance:

- Component does not leak chart instances on re-render/unmount.
- Empty/loading/error states are visible and stable.

### Step 4 - Monitor Integration

- Replace old SVG chart with new chart.
- Add chart toolbar state and controls.
- Fetch OHLCV using plan symbol/market type.
- Wire refresh and auto-refresh.
- Keep all existing monitor buttons working.

Acceptance:

- Manual pulse still works.
- Manual memo still works.
- Plan editor still works.
- Scheduler controls still work.
- Chart controls update the chart without page reload.

### Step 5 - Timeline/Memo Linking

- Add selected pulse state.
- Click pulse row focuses chart.
- Highlight selected pulse in timeline and chart.
- Add memo markers where mapping is deterministic.

Acceptance:

- Clicking a pulse changes chart focus/highlight.
- No crash if marker cannot be mapped.

### Step 6 - Visual Polish

- Make chart fill the monitor page properly.
- Ensure no text overlap.
- Ensure toolbar wraps on mobile.
- Make status colors consistent.
- Keep chart readable with 0, 1, 2, and many pulses.

Acceptance:

- Chart no longer looks like a placeholder.
- The UI still feels like a dense workstation.

### Step 7 - Verification

Run:

```powershell
npm run build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web build
```

If a command fails:

- Fix if it is caused by this goal.
- If it is an unrelated existing failure, document the exact command and summary
  of failure in the final answer.

Manual verification:

- Start API and web dev server if needed.
- Open a thesis monitor page such as:
  - `http://localhost:3001/theses/96417ec1-7005-4e1c-beff-0de2eab00e36/monitor`
- Confirm chart loads with candles or pulse-only fallback.
- Toggle intervals.
- Toggle chart type.
- Toggle overlays.
- Click a pulse row.
- Run manual pulse once only if needed for UI verification.
- Do not run full research.
- Do not run LLM memo just for chart verification.

## Acceptance Checklist

Mark items as complete only when verified:

- [x] `lightweight-charts` is added to `apps/web/package.json`.
- [x] Backend OHLCV endpoint exists and is wired into NestJS.
- [x] OHLCV endpoint validates interval, range, and limit.
- [x] OHLCV endpoint has mocked tests.
- [x] Web service and query key exist for OHLCV.
- [x] Old SVG is no longer the primary chart on monitor page.
- [x] Candlestick mode works.
- [x] Line mode works.
- [x] Area mode works.
- [x] Volume toggle works or is intentionally disabled with a documented reason.
- [x] Baseline line renders.
- [x] Invalidation line renders.
- [x] Entry bounds render.
- [x] Target lines render.
- [x] Pulse markers render.
- [x] Memo markers render when deterministic data is available.
- [x] Pulse-only fallback works when candles are unavailable.
- [x] Crosshair legend works.
- [x] Interval selector works.
- [x] Range selector works.
- [x] Overlay toggles work.
- [x] Manual refresh works.
- [x] Fit latest/reset zoom works.
- [x] Timeline pulse click highlights/focuses chart.
- [x] Existing manual pulse flow still works.
- [x] Existing manual memo flow still works.
- [x] Existing plan editor still works.
- [x] Existing scheduler controls still work.
- [x] Desktop layout is usable.
- [x] Mobile/narrow layout does not overflow horizontally.
- [x] `npm run build:api` passes.
- [x] `pnpm --filter @lunaperception/api test` passes.
- [x] `pnpm --filter @lunaperception/web build` passes.

Verification note (2026-05-18): local verification passed with `npm run
build:api`, `pnpm --filter @lunaperception/api test`, `pnpm --filter
@lunaperception/web build`, web typecheck/lint, and API lint. API tests mock
Binance spot/perp klines, interval/range/limit validation, limit capping,
dedupe/drop malformed rows, and controlled provider failure. No full research
run or LLM memo run was triggered for this chart verification.

## Common Failure Modes To Avoid

- Recreating the chart instance on every render.
- Forgetting to remove the chart on unmount.
- Storing crosshair updates in parent state at high frequency.
- Assuming TradingView Lightweight Charts fetches market data by itself.
- Using TradingView Widgets and then being unable to overlay thesis data.
- Fetching candles through a research/LLM path.
- Letting provider errors crash the monitor page.
- Rendering price lines without checking for null/invalid values.
- Using local timezone strings inconsistently.
- Passing millisecond timestamps where Lightweight Charts expects seconds or
  business-day time.
- Making toolbar controls shift layout when toggled.
- Breaking existing pulse/memo/scheduler actions while replacing the chart.
- Adding production infra as a dependency for local chart rendering.

## Post-Goal Backlog

These are useful later but should not block this goal:

- WebSocket or streaming candle updates.
- Persisted candle cache table.
- RSI/MACD/Bollinger indicators.
- Drawing tools.
- Multi-symbol compare.
- Order book/depth/liquidation views.
- Alert creation from chart price levels.
- Save chart layout per user/workspace.
- Full licensed TradingView Advanced Charts migration if product scope requires it.
