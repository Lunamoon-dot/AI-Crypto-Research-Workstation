import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FormEvent,
  type ReactNode,
  Suspense,
  lazy,
  useEffect,
  useState,
} from 'react';
import {
  Activity,
  Brain,
  Clock3,
  FileText,
  GitBranch,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
} from 'lucide-react';
import { errorMessage } from '@/services/client';
import type {
  MarketChartRange,
  ThesisChartOverlays,
} from '@/components/theses/ThesisMarketChart';
import { EmptyState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { getMarketOhlcv } from '@/services/market-data';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type {
  MarketChartInterval,
  MarketChartType,
  PatchThesisMonitorPlanRequest,
  RunThesisPulseMemoResponse,
  ThesisMonitorPlanResponse,
  ThesisPulseMemoResponse,
  ThesisPulseResponse,
  ThesisSchedulerStatusResponse,
} from '@/types';

type MonitorTone = 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';

const ThesisMarketChart = lazy(() =>
  import('@/components/theses/ThesisMarketChart').then((module) => ({
    default: module.ThesisMarketChart,
  })),
);
const MARKET_CHART_PROVIDER = 'binance' as const;

export function ThesisMonitorSummaryCard({
  error,
  isError,
  isLoading,
  plan,
  pulses,
  scheduler,
  to,
}: {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  plan: ThesisMonitorPlanResponse | null;
  pulses: ThesisPulseResponse[];
  scheduler: ThesisSchedulerStatusResponse | null;
  to: string;
}) {
  const latestPulse = pulses.at(-1) ?? null;

  if (isLoading) {
    return <LoadingState label="Loading monitor summary..." />;
  }

  return (
    <div className="thesis-monitor thesis-monitor-compact">
      <div className="thesis-monitor-summary">
        <MonitorMetric
          icon={<Activity aria-hidden size={15} />}
          label="Plan"
          tone={monitorStatusTone(plan?.status)}
          value={plan?.status ?? 'missing'}
        />
        <MonitorMetric
          icon={<ShieldAlert aria-hidden size={15} />}
          label="Latest"
          tone={monitorStatusTone(plan?.latest_status ?? latestPulse?.status)}
          value={plan?.latest_status ?? latestPulse?.status ?? 'no pulse'}
        />
        <MonitorMetric
          icon={<Target aria-hidden size={15} />}
          label="Price"
          value={numberLabel(plan?.latest_price ?? latestPulse?.current_price)}
        />
        <MonitorMetric
          icon={<GitBranch aria-hidden size={15} />}
          label="Action"
          tone={monitorActionTone(latestPulse?.suggested_action)}
          value={latestPulse?.suggested_action ?? 'none'}
        />
        <MonitorMetric
          icon={<Clock3 aria-hidden size={15} />}
          label="Scheduler"
          tone={scheduler?.enabled ? 'constructive' : 'primary'}
          value={schedulerStatusLabel(scheduler)}
        />
      </div>

      <div className="thesis-monitor-toolbar">
        <Link className="button primary" to={to}>
          Open monitor
        </Link>
        {plan?.missing_fields.length ? (
          <div className="top-strip-meta">
            {plan.missing_fields.map((field) => (
              <span className="badge warning" key={field}>
                {field}
              </span>
            ))}
          </div>
        ) : null}
        {isError ? <span className="badge risk">{errorMessage(error)}</span> : null}
      </div>
    </div>
  );
}

type MonitorPlanFormState = {
  status: string;
  baselinePrice: string;
  baselinePriceSource: string;
  entryLow: string;
  entryHigh: string;
  invalidationLevel: string;
  invalidationDirection: 'below' | 'above';
  targetsText: string;
  scenarioTriggersText: string;
  priceIntervalMinutes: string;
  signalIntervalMinutes: string;
  memoIntervalMinutes: string;
  watchDistancePct: string;
  reviewDistancePct: string;
  consecutiveInvalidationToRerun: string;
  runMemoOnReview: boolean;
  runMemoOnRerunFull: boolean;
  skipMemoIfNoNewPulses: boolean;
};

export function ThesisMonitorSection({
  error,
  isError,
  isLoading,
  isRunningMemo,
  isRunning,
  isRunningScheduler,
  isSavingPlan,
  isTogglingScheduler,
  memoRunResult,
  memos,
  onPauseScheduler,
  onRunMemo,
  onRunPulse,
  onRunSchedulerDue,
  onSavePlan,
  onResumeScheduler,
  plan,
  pulses,
  scheduler,
  thesisId,
}: {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  isRunningMemo: boolean;
  isRunning: boolean;
  isRunningScheduler: boolean;
  isSavingPlan: boolean;
  isTogglingScheduler: boolean;
  memoRunResult: RunThesisPulseMemoResponse | null;
  memos: ThesisPulseMemoResponse[];
  onPauseScheduler: () => void;
  onRunMemo: () => void;
  onRunPulse: () => void;
  onRunSchedulerDue: () => void;
  onSavePlan: (request: PatchThesisMonitorPlanRequest) => Promise<unknown>;
  onResumeScheduler: () => void;
  plan: ThesisMonitorPlanResponse | null;
  pulses: ThesisPulseResponse[];
  scheduler: ThesisSchedulerStatusResponse | null;
  thesisId: string;
}) {
  const latestPulse = pulses.at(-1) ?? null;
  const sortedMemos = [...memos].sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
  );
  const latestMemo = sortedMemos[0] ?? null;
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<MonitorPlanFormState>(() =>
    monitorPlanToForm(plan),
  );
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [chartInterval, setChartInterval] =
    useState<MarketChartInterval>('15m');
  const [chartRange, setChartRange] = useState<MarketChartRange>('7D');
  const [chartType, setChartType] = useState<MarketChartType>('candles');
  const [selectedPulseId, setSelectedPulseId] = useState<string | null>(null);
  const [visibleOverlays, setVisibleOverlays] = useState<ThesisChartOverlays>({
    thesisLevels: true,
    pulses: true,
    memos: true,
    volume: true,
  });
  const marketType = plan?.market_type === 'perp' ? 'perp' : 'spot';
  const marketProvider = MARKET_CHART_PROVIDER;
  const candleRangeKey = marketWindowQueryKey(
    thesisId,
    chartRange,
    chartInterval,
    plan,
    pulses,
    memos,
  );
  const candlesQuery = useQuery({
    enabled: Boolean(plan?.symbol),
    queryKey: queryKeys.marketOhlcv(
      plan?.symbol ?? '',
      marketType,
      marketProvider ?? 'default',
      chartInterval,
      candleRangeKey,
    ),
    queryFn: () => {
      const candleWindow = marketWindowForRange(
        chartRange,
        chartInterval,
        plan,
        pulses,
        memos,
      );
      return getMarketOhlcv(auth, {
        symbol: plan?.symbol ?? '',
        market_type: marketType,
        provider: marketProvider,
        interval: chartInterval,
        from: candleWindow.from,
        to: candleWindow.to,
      });
    },
    refetchInterval: scheduler?.enabled ? 60_000 : false,
    retry: false,
    staleTime: scheduler?.enabled ? 20_000 : 60_000,
  });
  const realtimeProvider = marketProvider;

  useEffect(() => {
    setForm(monitorPlanToForm(plan));
    setFormError('');
  }, [plan]);

  useEffect(() => {
    if (
      selectedPulseId &&
      !pulses.some((pulse) => pulse.id === selectedPulseId)
    ) {
      setSelectedPulseId(null);
    }
  }, [pulses, selectedPulseId]);

  if (isLoading) {
    return <LoadingState label="Loading monitor..." />;
  }

  function toggleOverlay(overlay: keyof ThesisChartOverlays) {
    setVisibleOverlays((current) => ({
      ...current,
      [overlay]: !current[overlay],
    }));
  }

  function refreshMarketChart() {
    void candlesQuery.refetch();
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thesisPulses(thesisId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thesisPulseMemos(thesisId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thesisMonitorPlan(thesisId),
    });
  }

  async function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan) {
      return;
    }
    const parsed = monitorPlanFormToRequest(form);
    if ('error' in parsed) {
      setFormError(parsed.error);
      return;
    }
    setFormError('');
    await onSavePlan(parsed.request);
    setIsEditingPlan(false);
  }

  return (
    <div className="thesis-monitor">
      <div className="thesis-monitor-summary">
        <MonitorMetric
          icon={<Activity aria-hidden size={15} />}
          label="Plan"
          tone={monitorStatusTone(plan?.status)}
          value={plan?.status ?? 'missing'}
        />
        <MonitorMetric
          icon={<ShieldAlert aria-hidden size={15} />}
          label="Latest"
          tone={monitorStatusTone(plan?.latest_status ?? latestPulse?.status)}
          value={plan?.latest_status ?? latestPulse?.status ?? 'no pulse'}
        />
        <MonitorMetric
          icon={<Target aria-hidden size={15} />}
          label="Price"
          value={numberLabel(plan?.latest_price ?? latestPulse?.current_price)}
        />
        <MonitorMetric
          icon={<GitBranch aria-hidden size={15} />}
          label="Action"
          tone={monitorActionTone(latestPulse?.suggested_action)}
          value={latestPulse?.suggested_action ?? 'none'}
        />
        <MonitorMetric
          icon={<Clock3 aria-hidden size={15} />}
          label="Scheduler"
          tone={scheduler?.enabled ? 'constructive' : 'primary'}
          value={schedulerStatusLabel(scheduler)}
        />
      </div>

      <div className="thesis-monitor-toolbar">
        <button
          className="button primary"
          disabled={isRunning || !plan || plan.status !== 'active'}
          onClick={onRunPulse}
          type="button"
        >
          <RefreshCw aria-hidden size={15} />
          {isRunning ? 'Running pulse' : 'Run pulse now'}
        </button>
        <button
          className="button"
          disabled={isRunningMemo || !plan || plan.status !== 'active'}
          onClick={onRunMemo}
          type="button"
        >
          <Brain aria-hidden size={15} />
          {isRunningMemo ? 'Running memo' : 'Run memo now'}
        </button>
        <button
          className="button"
          disabled={!plan || isSavingPlan}
          onClick={() => setIsEditingPlan((value) => !value)}
          type="button"
        >
          <SlidersHorizontal aria-hidden size={15} />
          {isEditingPlan ? 'Close editor' : 'Edit plan'}
        </button>
        <button
          className="button"
          disabled={!plan || plan.status !== 'active' || isTogglingScheduler}
          onClick={scheduler?.enabled ? onPauseScheduler : onResumeScheduler}
          type="button"
        >
          {scheduler?.enabled ? (
            <Pause aria-hidden size={15} />
          ) : (
            <Play aria-hidden size={15} />
          )}
          {scheduler?.enabled ? 'Pause scheduler' : 'Resume scheduler'}
        </button>
        <button
          className="button"
          disabled={!scheduler?.enabled || isRunningScheduler}
          onClick={onRunSchedulerDue}
          type="button"
        >
          <Clock3 aria-hidden size={15} />
          {isRunningScheduler ? 'Checking due work' : 'Run due checks'}
        </button>
        {plan?.missing_fields.length ? (
          <div className="top-strip-meta">
            {plan.missing_fields.map((field) => (
              <span className="badge warning" key={field}>
                {field}
              </span>
            ))}
          </div>
        ) : null}
        {memoRunResult?.skipped ? (
          <span className="badge warning">
            Memo skipped: {memoRunResult.skip_reason ?? 'no new pulses'}
          </span>
        ) : null}
        {memoRunResult && !memoRunResult.skipped && !memoRunResult.created ? (
          <span className="badge constructive">Memo already current</span>
        ) : null}
        {isError ? <span className="badge risk">{errorMessage(error)}</span> : null}
      </div>

      {scheduler ? (
        <div className="thesis-scheduler-strip">
          <span>
            Next run <strong>{relativeOrEmpty(scheduler.next_run_at)}</strong>
          </span>
          <span>
            Pulse <strong>{relativeOrEmpty(scheduler.next_pulse_due_at)}</strong>
          </span>
          <span>
            Signal <strong>{relativeOrEmpty(scheduler.next_signal_due_at)}</strong>
          </span>
          <span>
            Memo <strong>{relativeOrEmpty(scheduler.next_memo_due_at)}</strong>
          </span>
          <span>
            Last <strong>{relativeOrEmpty(scheduler.last_run_at)}</strong>
          </span>
          {scheduler.last_error ? (
            <span className="badge risk">{scheduler.last_error}</span>
          ) : null}
        </div>
      ) : null}

      {plan && isEditingPlan ? (
        <form className="monitor-plan-editor" onSubmit={submitPlan}>
          <div className="monitor-plan-editor-header">
            <div>
              <strong>Monitor plan editor</strong>
              <p>
                Changes update the thesis monitoring contract used by manual
                pulses.
              </p>
            </div>
            <span className={`badge ${monitorStatusTone(plan.status)}`}>
              {plan.status}
            </span>
          </div>
          <div className="form-grid">
            <label className="label">
              Status
              <select
                className="select"
                onChange={(event) =>
                  setForm((current) => ({ ...current, status: event.target.value }))
                }
                value={form.status}
              >
                <option value="active">active</option>
                <option value="draft">draft</option>
                <option value="paused">paused</option>
                <option value="invalid">invalid</option>
              </select>
            </label>
            <label className="label">
              Baseline source
              <input
                className="input"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baselinePriceSource: event.target.value,
                  }))
                }
                value={form.baselinePriceSource}
              />
            </label>
            <NumberInput
              label="Baseline price"
              onChange={(value) =>
                setForm((current) => ({ ...current, baselinePrice: value }))
              }
              value={form.baselinePrice}
            />
            <NumberInput
              label="Entry low"
              onChange={(value) =>
                setForm((current) => ({ ...current, entryLow: value }))
              }
              value={form.entryLow}
            />
            <NumberInput
              label="Entry high"
              onChange={(value) =>
                setForm((current) => ({ ...current, entryHigh: value }))
              }
              value={form.entryHigh}
            />
            <NumberInput
              label="Invalidation level"
              onChange={(value) =>
                setForm((current) => ({ ...current, invalidationLevel: value }))
              }
              value={form.invalidationLevel}
            />
            <label className="label">
              Invalidation direction
              <select
                className="select"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    invalidationDirection: event.target.value as 'below' | 'above',
                  }))
                }
                value={form.invalidationDirection}
              >
                <option value="below">below</option>
                <option value="above">above</option>
              </select>
            </label>
            <NumberInput
              label="Pulse bucket minutes"
              max={60}
              min={1}
              onChange={(value) =>
                setForm((current) => ({ ...current, priceIntervalMinutes: value }))
              }
              step={1}
              value={form.priceIntervalMinutes}
            />
            <NumberInput
              label="Signal interval minutes"
              max={240}
              min={5}
              onChange={(value) =>
                setForm((current) => ({ ...current, signalIntervalMinutes: value }))
              }
              step={1}
              value={form.signalIntervalMinutes}
            />
            <NumberInput
              label="Memo interval minutes"
              max={1440}
              min={30}
              onChange={(value) =>
                setForm((current) => ({ ...current, memoIntervalMinutes: value }))
              }
              step={1}
              value={form.memoIntervalMinutes}
            />
            <NumberInput
              label="Watch band %"
              max={20}
              min={0.25}
              onChange={(value) =>
                setForm((current) => ({ ...current, watchDistancePct: value }))
              }
              value={form.watchDistancePct}
            />
            <NumberInput
              label="Review band %"
              max={10}
              min={0.1}
              onChange={(value) =>
                setForm((current) => ({ ...current, reviewDistancePct: value }))
              }
              value={form.reviewDistancePct}
            />
            <NumberInput
              label="Invalidations to rerun"
              max={10}
              min={1}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  consecutiveInvalidationToRerun: value,
                }))
              }
              step={1}
              value={form.consecutiveInvalidationToRerun}
            />
            <label className="label">
              Run memo on review
              <input
                checked={form.runMemoOnReview}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    runMemoOnReview: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
            <label className="label">
              Run memo on rerun full
              <input
                checked={form.runMemoOnRerunFull}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    runMemoOnRerunFull: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
            <label className="label">
              Skip memo if no new pulses
              <input
                checked={form.skipMemoIfNoNewPulses}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    skipMemoIfNoNewPulses: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
          </div>
          <div className="grid two">
            <label className="label">
              Targets
              <textarea
                className="textarea compact"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    targetsText: event.target.value,
                  }))
                }
                placeholder={'target_1: 2600\ntarget_2: 3000'}
                value={form.targetsText}
              />
            </label>
            <label className="label">
              Scenario triggers
              <textarea
                className="textarea compact"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scenarioTriggersText: event.target.value,
                  }))
                }
                placeholder={'funding spike\nrange breakdown'}
                value={form.scenarioTriggersText}
              />
            </label>
          </div>
          <div className="thesis-monitor-toolbar">
            <button className="button primary" disabled={isSavingPlan} type="submit">
              <Save aria-hidden size={15} />
              {isSavingPlan ? 'Saving plan' : 'Save plan'}
            </button>
            <button
              className="button"
              disabled={isSavingPlan}
              onClick={() => {
                setForm(monitorPlanToForm(plan));
                setFormError('');
              }}
              type="button"
            >
              Reset
            </button>
            {formError ? <span className="badge risk">{formError}</span> : null}
          </div>
        </form>
      ) : null}

      {plan ? (
        <>
          <div className="thesis-monitor-grid">
            <Suspense fallback={<LoadingState label="Loading market chart..." />}>
              <ThesisMarketChart
                candleError={candlesQuery.error}
                candleWarning={candlesQuery.data?.warning}
                candles={candlesQuery.data?.candles ?? []}
                chartType={chartType}
                interval={chartInterval}
                isLoadingCandles={candlesQuery.isLoading || candlesQuery.isFetching}
                marketType={marketType}
                memos={sortedMemos}
                onChartTypeChange={setChartType}
                onIntervalChange={setChartInterval}
                onRangeChange={setChartRange}
                onRefresh={refreshMarketChart}
                onSelectPulse={setSelectedPulseId}
                onToggleOverlay={toggleOverlay}
                plan={plan}
                pulses={pulses}
                range={chartRange}
                realtimeProvider={realtimeProvider}
                selectedPulseId={selectedPulseId}
                visibleOverlays={visibleOverlays}
              />
            </Suspense>
            <PulseTimeline
              onSelectPulse={setSelectedPulseId}
              pulses={pulses}
              selectedPulseId={selectedPulseId}
            />
          </div>
          <PulseMemoPanel
            latestMemo={latestMemo}
            memos={sortedMemos}
            onSelectPulse={setSelectedPulseId}
            selectablePulseIds={pulses
              .map((pulse) => pulse.id)
              .filter((id): id is string => Boolean(id))}
          />
        </>
      ) : (
        <EmptyState label="No monitor plan is available for this thesis." />
      )}
    </div>
  );
}

function NumberInput({
  label,
  max,
  min,
  onChange,
  step = 0.0001,
  value,
}: {
  label: string;
  max?: number;
  min?: number;
  onChange: (value: string) => void;
  step?: number;
  value: string;
}) {
  return (
    <label className="label">
      {label}
      <input
        className="input"
        inputMode="decimal"
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function marketWindowQueryKey(
  thesisId: string,
  range: MarketChartRange,
  interval: MarketChartInterval,
  plan: ThesisMonitorPlanResponse | null,
  pulses: ThesisPulseResponse[],
  memos: ThesisPulseMemoResponse[],
): string {
  const anchors = marketWindowAnchors(plan, pulses, memos);
  return [
    thesisId,
    range,
    interval,
    anchors.length ? Math.min(...anchors) : 'none',
    anchors.length ? Math.max(...anchors) : 'none',
    pulses.length,
    memos.length,
  ].join(':');
}

function marketWindowForRange(
  range: MarketChartRange,
  interval: MarketChartInterval,
  plan: ThesisMonitorPlanResponse | null,
  pulses: ThesisPulseResponse[],
  memos: ThesisPulseMemoResponse[],
): { from: string; to: string } {
  const now = new Date();
  const anchors = marketWindowAnchors(plan, pulses, memos);
  const latestAnchor = anchors.length ? Math.max(...anchors) : now.getTime();
  const to = new Date(Math.max(now.getTime(), latestAnchor));

  if (range === 'THESIS' || range === 'ALL') {
    const earliestAnchor = anchors.length
      ? Math.min(...anchors)
      : now.getTime() - 7 * 24 * 60 * 60_000;
    const padding = range === 'THESIS' ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
    return boundedMarketWindow(
      new Date(earliestAnchor - padding),
      new Date(to.getTime() + padding),
      interval,
    );
  }

  const days = range === '1D' ? 1 : range === '7D' ? 7 : 30;
  return boundedMarketWindow(
    new Date(to.getTime() - days * 24 * 60 * 60_000),
    to,
    interval,
  );
}

function marketWindowAnchors(
  plan: ThesisMonitorPlanResponse | null,
  pulses: ThesisPulseResponse[],
  memos: ThesisPulseMemoResponse[],
): number[] {
  return [
    plan?.baseline_observed_at,
    plan?.created_at,
    plan?.last_pulse_at,
    ...pulses.map((pulse) => pulse.observed_at),
    ...memos.map((memo) => memo.created_at),
  ]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
}

function boundedMarketWindow(
  from: Date,
  to: Date,
  interval: MarketChartInterval,
): { from: string; to: string } {
  const maxRangeMs: Record<MarketChartInterval, number> = {
    '1m': 2 * 24 * 60 * 60_000,
    '5m': 10 * 24 * 60 * 60_000,
    '15m': 30 * 24 * 60 * 60_000,
    '1h': 120 * 24 * 60 * 60_000,
    '4h': 365 * 24 * 60 * 60_000,
    '1d': 5 * 365 * 24 * 60 * 60_000,
  };
  const maxRange = maxRangeMs[interval];
  const safeFrom =
    to.getTime() - from.getTime() > maxRange
      ? new Date(to.getTime() - maxRange)
      : from;
  return { from: safeFrom.toISOString(), to: to.toISOString() };
}

function monitorPlanToForm(
  plan: ThesisMonitorPlanResponse | null,
): MonitorPlanFormState {
  return {
    status: plan?.status ?? 'draft',
    baselinePrice: formNumber(plan?.baseline_price),
    baselinePriceSource: plan?.baseline_price_source || 'manual',
    entryLow: formNumber(plan?.entry_low),
    entryHigh: formNumber(plan?.entry_high),
    invalidationLevel: formNumber(plan?.invalidation_level),
    invalidationDirection:
      plan?.invalidation_direction === 'above' ? 'above' : 'below',
    targetsText:
      plan?.targets
        .map((target, index) => `${target.label || `target_${index + 1}`}: ${target.price}`)
        .join('\n') ?? '',
    scenarioTriggersText: plan?.scenario_triggers.join('\n') ?? '',
    priceIntervalMinutes: formNumber(plan?.price_interval_minutes),
    signalIntervalMinutes: formNumber(plan?.signal_interval_minutes),
    memoIntervalMinutes: formNumber(plan?.memo_interval_minutes),
    watchDistancePct: formNumber(plan?.watch_distance_pct),
    reviewDistancePct: formNumber(plan?.review_distance_pct),
    consecutiveInvalidationToRerun: formNumber(
      plan?.consecutive_invalidation_to_rerun,
    ),
    runMemoOnReview: plan?.run_memo_on_review ?? true,
    runMemoOnRerunFull: plan?.run_memo_on_rerun_full ?? true,
    skipMemoIfNoNewPulses: plan?.skip_memo_if_no_new_pulses ?? true,
  };
}

function monitorPlanFormToRequest(
  form: MonitorPlanFormState,
): { request: PatchThesisMonitorPlanRequest } | { error: string } {
  const baselinePrice = parseNullableFormNumber(form.baselinePrice);
  const entryLow = parseNullableFormNumber(form.entryLow);
  const entryHigh = parseNullableFormNumber(form.entryHigh);
  const invalidationLevel = parseNullableFormNumber(form.invalidationLevel);
  const priceIntervalMinutes = parseRequiredFormNumber(
    form.priceIntervalMinutes,
    'Pulse bucket minutes',
    { min: 1, max: 60 },
  );
  const signalIntervalMinutes = parseRequiredFormNumber(
    form.signalIntervalMinutes,
    'Signal interval',
    { min: 5, max: 240 },
  );
  const memoIntervalMinutes = parseRequiredFormNumber(
    form.memoIntervalMinutes,
    'Memo interval',
    { min: 30, max: 1440 },
  );
  const watchDistancePct = parseRequiredFormNumber(
    form.watchDistancePct,
    'Watch band',
    { min: 1, max: 20 },
  );
  const reviewDistancePct = parseRequiredFormNumber(
    form.reviewDistancePct,
    'Review band',
    { min: 0.25, max: 10 },
  );
  const consecutiveInvalidationToRerun = parseRequiredFormNumber(
    form.consecutiveInvalidationToRerun,
    'Invalidations to rerun',
    { min: 1, max: 10 },
  );
  const targets = parseMonitorTargets(form.targetsText);
  if (baselinePrice === 'invalid') {
    return { error: 'Baseline price must be numeric.' };
  }
  if (entryLow === 'invalid' || entryHigh === 'invalid') {
    return { error: 'Entry levels must be numeric.' };
  }
  if (invalidationLevel === 'invalid') {
    return { error: 'Invalidation level must be numeric.' };
  }
  if ('error' in priceIntervalMinutes) {
    return priceIntervalMinutes;
  }
  if ('error' in signalIntervalMinutes) {
    return signalIntervalMinutes;
  }
  if ('error' in memoIntervalMinutes) {
    return memoIntervalMinutes;
  }
  if ('error' in watchDistancePct) {
    return watchDistancePct;
  }
  if ('error' in reviewDistancePct) {
    return reviewDistancePct;
  }
  if ('error' in consecutiveInvalidationToRerun) {
    return consecutiveInvalidationToRerun;
  }
  if ('error' in targets) {
    return targets;
  }
  return {
    request: {
      status: form.status,
      baseline_price: baselinePrice,
      baseline_price_source: form.baselinePriceSource.trim() || 'manual',
      entry_low: entryLow,
      entry_high: entryHigh,
      invalidation_level: invalidationLevel,
      invalidation_direction: form.invalidationDirection,
      targets: targets.targets,
      scenario_triggers: lines(form.scenarioTriggersText),
      price_interval_minutes: priceIntervalMinutes.value,
      signal_interval_minutes: signalIntervalMinutes.value,
      memo_interval_minutes: memoIntervalMinutes.value,
      watch_distance_pct: watchDistancePct.value,
      review_distance_pct: reviewDistancePct.value,
      consecutive_invalidation_to_rerun: consecutiveInvalidationToRerun.value,
      run_memo_on_review: form.runMemoOnReview,
      run_memo_on_rerun_full: form.runMemoOnRerunFull,
      skip_memo_if_no_new_pulses: form.skipMemoIfNoNewPulses,
    },
  };
}

function formNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? ''
    : String(value);
}

function parseNullableFormNumber(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 'invalid';
}

function parseRequiredFormNumber(
  value: string,
  label: string,
  bounds: { min?: number; max?: number } = {},
): { value: number } | { error: string } {
  const parsed = parseNullableFormNumber(value);
  if (parsed === null) {
    return { error: `${label} is required.` };
  }
  if (parsed === 'invalid') {
    return { error: `${label} must be numeric.` };
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    return { error: `${label} must be at least ${bounds.min}.` };
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    return { error: `${label} must be at most ${bounds.max}.` };
  }
  return { value: parsed };
}

function parseMonitorTargets(
  value: string,
): { targets: Array<{ label: string; price: number }> } | { error: string } {
  const targets: Array<{ label: string; price: number }> = [];
  for (const [index, rawLine] of lines(value).entries()) {
    const [labelRaw, priceRaw] = rawLine.includes(':')
      ? rawLine.split(':', 2)
      : [`target_${index + 1}`, rawLine];
    const price = Number(priceRaw.trim());
    if (!Number.isFinite(price)) {
      return { error: `Target ${index + 1} must have a numeric price.` };
    }
    targets.push({
      label: labelRaw.trim() || `target_${index + 1}`,
      price,
    });
  }
  return { targets };
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function MonitorMetric({
  icon,
  label,
  tone = 'primary',
  value,
}: {
  icon: ReactNode;
  label: string;
  tone?: MonitorTone;
  value: ReactNode;
}) {
  return (
    <div className="thesis-monitor-metric">
      <span>
        {icon}
        {label}
      </span>
      <strong className={`tone-${tone}`}>{value}</strong>
    </div>
  );
}

function PulseTimeline({
  onSelectPulse,
  pulses,
  selectedPulseId,
}: {
  onSelectPulse: (pulseId: string | null) => void;
  pulses: ThesisPulseResponse[];
  selectedPulseId: string | null;
}) {
  if (pulses.length === 0) {
    return <EmptyState label="No pulses yet." />;
  }
  return (
    <div className="thesis-pulse-timeline">
      <div className="row">
        <strong>Pulse timeline</strong>
        <span className="small muted">latest {Math.min(pulses.length, 10)}</span>
      </div>
      <div className="thesis-pulse-list">
        {pulses.slice(-10).reverse().map((pulse) => {
          const selected = Boolean(pulse.id && pulse.id === selectedPulseId);
          return (
          <button
            className={`thesis-pulse-row ${selected ? 'active' : ''}`}
            key={pulse.id ?? pulse.observed_at}
            onClick={() => onSelectPulse(selected ? null : pulse.id)}
            type="button"
          >
            <span className={`pulse-status-dot marker-${pulse.status}`} />
            <span>
              <span className="row">
                <strong>{pulse.status}</strong>
                <span className="small muted">{formatDateTime(pulse.observed_at)}</span>
              </span>
              <span className="thesis-pulse-row-copy">
                {numberLabel(pulse.current_price)} · score {pulse.score} ·{' '}
                {pulse.suggested_action}
              </span>
              {pulse.trigger_reasons.length ? (
                <span className="top-strip-meta">
                  {pulse.trigger_reasons.slice(0, 4).map((reason) => (
                    <span className={`badge ${monitorStatusTone(pulse.status)}`} key={reason}>
                      {reason}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </button>
          );
        })}
      </div>
    </div>
  );
}

function PulseMemoPanel({
  latestMemo,
  memos,
  onSelectPulse,
  selectablePulseIds,
}: {
  latestMemo: ThesisPulseMemoResponse | null;
  memos: ThesisPulseMemoResponse[];
  onSelectPulse: (pulseId: string | null) => void;
  selectablePulseIds: string[];
}) {
  const selectablePulseIdSet = new Set(selectablePulseIds);
  return (
    <div className="thesis-memo-grid">
      <section className="thesis-memo-card">
        <div className="row">
          <div className="row">
            <Sparkles aria-hidden size={15} />
            <strong>Latest memo</strong>
          </div>
          {latestMemo ? (
            <span className={`badge ${monitorStatusTone(latestMemo.status)}`}>
              {latestMemo.status}
            </span>
          ) : null}
        </div>
        {latestMemo ? (
          <>
            <p className="thesis-memo-summary">{latestMemo.summary}</p>
            <div className="thesis-memo-facts">
              <span>{latestMemo.recommended_action}</span>
              <span>{percentLabel(latestMemo.confidence)} confidence</span>
              <span>{latestMemo.provider}</span>
            </div>
            <div className="thesis-memo-sections">
              <MemoList title="Changed" values={latestMemo.what_changed} />
              <MemoList title="Matters" values={latestMemo.why_it_matters} />
              <MemoList title="Watch" values={latestMemo.what_to_watch_next} />
            </div>
            {latestMemo.referenced_pulse_ids.length ? (
              <div className="top-strip-meta">
                {latestMemo.referenced_pulse_ids.slice(0, 6).map((pulseId) => (
                  <button
                    className="badge primary pulse-reference-button"
                    disabled={!selectablePulseIdSet.has(pulseId)}
                    key={pulseId}
                    onClick={() => onSelectPulse(pulseId)}
                    type="button"
                  >
                    {pulseId}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState label="No memo has been generated yet." />
        )}
      </section>

      <section className="thesis-memo-card">
        <div className="row">
          <div className="row">
            <FileText aria-hidden size={15} />
            <strong>Memo history</strong>
          </div>
          <span className="small muted">{memos.length} memos</span>
        </div>
        {memos.length === 0 ? (
          <EmptyState label="Memo history is empty." />
        ) : (
          <div className="thesis-memo-history">
            {memos.slice(0, 6).map((memo) => (
              <article className="thesis-memo-row" key={memo.id ?? memo.created_at}>
                <div className="row">
                  <strong>{memo.status}</strong>
                  <span className="small muted">{formatDateTime(memo.created_at)}</span>
                </div>
                <p>{memo.summary}</p>
                <div className="top-strip-meta">
                  <span className={`badge ${monitorActionTone(memo.recommended_action)}`}>
                    {memo.recommended_action}
                  </span>
                  {memo.rerun_full_recommended ? (
                    <span className="badge risk">rerun recommended</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MemoList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="thesis-memo-section">
      <span>{title}</span>
      {values.length ? (
        <ul>
          {values.slice(0, 4).map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p>n/a</p>
      )}
    </div>
  );
}

function numberLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 4,
  }).format(value);
}

function percentLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
}

function monitorStatusTone(
  status: string | null | undefined,
): 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded' {
  if (status === 'active' || status === 'calm') {
    return 'constructive';
  }
  if (status === 'watch' || status === 'draft') {
    return 'warning';
  }
  if (status === 'review' || status === 'invalid' || status === 'paused') {
    return 'warning';
  }
  if (status === 'rerun_full') {
    return 'risk';
  }
  return 'primary';
}

function monitorActionTone(
  action: string | null | undefined,
): 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded' {
  if (action === 'rerun_full_research') {
    return 'risk';
  }
  if (action === 'inspect_chart' || action === 'record_review') {
    return 'warning';
  }
  if (action === 'none') {
    return 'constructive';
  }
  return 'primary';
}

function schedulerStatusLabel(
  scheduler: ThesisSchedulerStatusResponse | null,
): string {
  if (!scheduler) {
    return 'unknown';
  }
  if (scheduler.running) {
    return 'running';
  }
  if (scheduler.enabled) {
    return scheduler.scheduled ? 'enabled' : 'due';
  }
  return scheduler.scheduler_enabled ? scheduler.plan_status : 'paused';
}

function relativeOrEmpty(value: string | null | undefined): string {
  return value ? formatDateTime(value) : 'n/a';
}
