import { Link, useParams } from 'react-router-dom';
import { FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Brain,
  CheckCircle2,
  Download,
  FileText,
  GitBranch,
  RefreshCw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
} from 'lucide-react';
import { getResearchRunEvidenceBundle } from '@/services/research-runs';
import {
  getThesisMonitorPlan,
  listThesisPulseMemos,
  listThesisPulses,
  runThesisPulseMemo,
  runThesisPulse,
  updateThesisMonitorPlan,
} from '@/services/thesis-monitoring';
import {
  getThesis,
  getThesisScenarios,
  recordThesisDecision,
  recordThesisReview,
} from '@/services/theses';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import {
  ConfidenceBadge,
  DataQualityBadge,
  DirectionBadge,
  IdChip,
  RatingBadge,
} from '@/components/research/badges';
import { BentoGrid } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import type {
  JsonRecord,
  PatchThesisMonitorPlanRequest,
  RunThesisPulseMemoResponse,
  ScenarioResponse,
  ThesisMonitorPlanResponse,
  ThesisPulseMemoResponse,
  ThesisPulseResponse,
} from '@/types';

export function ThesisDetailPage() {
  const { id } = useParams();
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const thesisId = id ?? '';
  const thesisQuery = useQuery({
    queryKey: queryKeys.thesis(thesisId),
    queryFn: () => getThesis(thesisId, auth),
  });
  const scenariosQuery = useQuery({
    queryKey: queryKeys.thesisScenarios(thesisId),
    queryFn: () => getThesisScenarios(thesisId, auth),
  });
  const monitorPlanQuery = useQuery({
    queryKey: queryKeys.thesisMonitorPlan(thesisId),
    queryFn: () => getThesisMonitorPlan(thesisId, auth),
  });
  const pulsesQuery = useQuery({
    queryKey: queryKeys.thesisPulses(thesisId),
    queryFn: () => listThesisPulses(thesisId, auth, { limit: 240 }),
  });
  const memoQuery = useQuery({
    queryKey: queryKeys.thesisPulseMemos(thesisId),
    queryFn: () => listThesisPulseMemos(thesisId, auth, { limit: 50 }),
  });

  const [decisionAction, setDecisionAction] = useState('watched');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionEntry, setDecisionEntry] = useState('');
  const [decisionStopLoss, setDecisionStopLoss] = useState('');
  const [decisionTakeProfit, setDecisionTakeProfit] = useState('');
  const [positionIntent, setPositionIntent] = useState('watch_only');
  const [reviewResult, setReviewResult] = useState('unknown');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewMfe, setReviewMfe] = useState('');
  const [reviewMae, setReviewMae] = useState('');
  const [exportingBundle, setExportingBundle] = useState(false);
  const [exportError, setExportError] = useState('');

  const decisionMutation = useMutation({
    mutationFn: () =>
      recordThesisDecision(
        thesisId,
        {
          action: decisionAction,
          notes: decisionNotes,
          entry: optionalString(decisionEntry),
          stop_loss: optionalString(decisionStopLoss),
          take_profit: optionalString(decisionTakeProfit),
          position_intent: optionalString(positionIntent),
        },
        auth,
      ),
    onSuccess: () => {
      setDecisionNotes('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesis(thesisId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesesRoot() });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      recordThesisReview(
        thesisId,
        {
          result: reviewResult,
          notes: reviewNotes,
          max_favorable_excursion: optionalNumber(reviewMfe),
          max_adverse_excursion: optionalNumber(reviewMae),
        },
        auth,
      ),
    onSuccess: () => {
      setReviewNotes('');
      setReviewMfe('');
      setReviewMae('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesis(thesisId) });
    },
  });
  const runPulseMutation = useMutation({
    mutationFn: () => runThesisPulse(thesisId, {}, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.thesisMonitorPlan(thesisId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.thesisPulses(thesisId),
      });
    },
  });
  const runMemoMutation = useMutation({
    mutationFn: () => runThesisPulseMemo(thesisId, {}, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.thesisMonitorPlan(thesisId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.thesisPulseMemos(thesisId),
      });
    },
  });
  const updateMonitorPlanMutation = useMutation({
    mutationFn: (request: PatchThesisMonitorPlanRequest) =>
      updateThesisMonitorPlan(thesisId, request, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.thesisMonitorPlan(thesisId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.thesisPulses(thesisId),
      });
    },
  });

  if (thesisQuery.isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading thesis..." />
      </main>
    );
  }
  if (thesisQuery.isError) {
    return (
      <main className="page">
        <ErrorState error={thesisQuery.error} />
      </main>
    );
  }
  const thesis = thesisQuery.data;
  const stabilityGuard = thesis?.stability_guard ?? {};
  if (!thesis) {
    return (
      <main className="page">
        <EmptyState label="Thesis not found." />
      </main>
    );
  }
  const actionSummary =
    thesis.summary.action_summary || thesis.thesis_text || 'No thesis text.';
  const entry = thesis.entry_zone || thesis.summary.entry_zone || 'n/a';
  const invalidation =
    thesis.invalidation_level || thesis.summary.invalidation || 'No invalidation recorded.';

  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    decisionMutation.mutate();
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reviewMutation.mutate();
  }

  async function exportEvidenceBundle() {
    const currentThesis = thesis;
    if (!currentThesis?.research_run_id) {
      return;
    }
    const runId = currentThesis.research_run_id;
    setExportingBundle(true);
    setExportError('');
    try {
      const bundle = await getResearchRunEvidenceBundle(runId, auth);
      downloadJson(
        bundle,
        `evidence-bundle-${safeFileName(runId)}.json`,
      );
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExportingBundle(false);
    }
  }

  return (
    <main className="page thesis-detail-page">
      <PageHeader
        eyebrow="04 Thesis Detail"
        title={`${thesis.symbol} thesis`}
        description={`Created ${formatDateTime(thesis.created_at)}. Review the evidence, contradiction set, scenarios, and journal actions.`}
        action={
          <div className="page-header-action-stack">
            <HeaderStats
              stats={[
                {
                  icon: <FileText aria-hidden size={14} />,
                  label: 'Rating',
                  tone: 'primary',
                  value: <RatingBadge value={thesis.summary.rating || 'Hold'} />,
                },
                {
                  icon: <CheckCircle2 aria-hidden size={14} />,
                  label: 'Confidence',
                  tone: 'constructive',
                  value: <ConfidenceBadge value={thesis.confidence} />,
                },
                {
                  icon: <Target aria-hidden size={14} />,
                  label: 'Targets',
                  meta: 'Target zones',
                  value: thesis.target_zones.length,
                },
                {
                  icon: <ShieldAlert aria-hidden size={14} />,
                  label: 'Data gaps',
                  meta: 'Stale or missing',
                  tone: thesis.stale_or_missing_data.length > 0 ? 'warning' : 'constructive',
                  value: thesis.stale_or_missing_data.length,
                },
              ]}
            />
            <DirectionBadge value={thesis.direction} />
          </div>
        }
      />

      <BentoGrid>
        <Panel
          className="span-5 thesis-brief-panel"
          title="Thesis brief"
          description="Decision, risk boundary, and source context"
        >
          <div className="thesis-brief">
            <section className="thesis-brief-summary">
              <span>Action summary</span>
              <p>{actionSummary}</p>
            </section>

            <div className="thesis-fact-grid">
              <ThesisFact label="Setup">{thesis.setup_type || 'n/a'}</ThesisFact>
              <ThesisFact label="Entry">{entry}</ThesisFact>
              <ThesisFact label="Data quality">
                <DataQualityBadge
                  label={thesis.summary.data_quality_label}
                  value={thesis.summary.data_quality}
                />
              </ThesisFact>
              <ThesisFact label="Quant confidence">
                <ConfidenceBadge value={thesis.quant_confidence} />
              </ThesisFact>
              <ThesisFact label="Confidence basis" wide>
                {thesis.confidence_source || 'n/a'}
              </ThesisFact>
              {stabilityGuard.applied === true ? (
                <ThesisFact label="Stability guard" wide>
                  <span className="badge primary">{stabilityGuardSummary(stabilityGuard)}</span>
                </ThesisFact>
              ) : null}
            </div>

            <section className="thesis-boundary">
              <span>Invalidation</span>
              <p>{invalidation}</p>
            </section>

            <div className="top-strip-meta thesis-brief-actions">
              {thesis.research_run_id ? (
                <span className="thesis-run-inline">
                  <span>Run</span>
                  <IdChip value={thesis.research_run_id} />
                </span>
              ) : null}
              {thesis.research_run_id ? (
                <Link className="button" to={routes.researchRun(thesis.research_run_id)}>
                  Open run
                </Link>
              ) : null}
              {thesis.research_run_id ? (
                <button
                  className="button"
                  disabled={exportingBundle}
                  onClick={exportEvidenceBundle}
                  type="button"
                >
                  <Download aria-hidden size={15} />
                  {exportingBundle ? 'Exporting' : 'Export evidence'}
                </button>
              ) : null}
              {thesis.id ? (
                <Link
                  className="button primary"
                  to={`${routes.watchlists}?track_thesis=${encodeURIComponent(thesis.id)}`}
                >
                  Track this thesis
                </Link>
              ) : null}
            </div>
            {exportError ? <span className="badge risk">{exportError}</span> : null}
          </div>
        </Panel>

        <Panel
          className="span-7"
          title="Evidence and contradictions"
          description="Readable thesis drivers first, source IDs second."
        >
          <EvidenceAndContradictions
            contradictingSignalIds={thesis.contradicting_signal_ids}
            keyReasons={thesis.summary.key_reasons}
            risks={thesis.summary.risks}
            supportingSignalIds={thesis.supporting_signal_ids}
          />
          {stabilityGuard.applied === true ? (
            <div className="stack small">
              <strong>Stability guard audit</strong>
              <JsonView value={stabilityGuard} />
            </div>
          ) : null}
        </Panel>

        <Panel
          className="span-12"
          title="Thesis pulse monitor"
          description="Manual deterministic monitoring against baseline, invalidation, and targets."
        >
          <ThesisMonitorSection
            error={
              monitorPlanQuery.error ??
              pulsesQuery.error ??
              memoQuery.error ??
              runPulseMutation.error ??
              runMemoMutation.error ??
              updateMonitorPlanMutation.error
            }
            isError={
              monitorPlanQuery.isError ||
              pulsesQuery.isError ||
              memoQuery.isError ||
              runPulseMutation.isError ||
              runMemoMutation.isError ||
              updateMonitorPlanMutation.isError
            }
            isLoading={
              monitorPlanQuery.isLoading || pulsesQuery.isLoading || memoQuery.isLoading
            }
            isRunningMemo={runMemoMutation.isPending}
            isRunning={runPulseMutation.isPending}
            isSavingPlan={updateMonitorPlanMutation.isPending}
            memoRunResult={runMemoMutation.data ?? null}
            memos={memoQuery.data ?? []}
            onRunMemo={() => runMemoMutation.mutate()}
            onRunPulse={() => runPulseMutation.mutate()}
            onSavePlan={(request) => updateMonitorPlanMutation.mutateAsync(request)}
            plan={monitorPlanQuery.data ?? null}
            pulses={pulsesQuery.data ?? []}
          />
        </Panel>

        <Panel className="span-4" title="Scenario radar" description="Conditional outcomes">
          {scenariosQuery.isLoading ? <LoadingState /> : null}
          {scenariosQuery.isError ? <ErrorState error={scenariosQuery.error} /> : null}
          {scenariosQuery.data?.length === 0 ? (
            <EmptyState label="No scenarios for this thesis." />
          ) : null}
          <div className="scenario-radar-list">
            {scenariosQuery.data?.map((scenario, index) => (
              <ScenarioRadarCard
                index={index}
                key={scenario.id ?? scenario.condition}
                scenario={scenario}
              />
            ))}
          </div>
        </Panel>

        <Panel className="span-8" title="Manual decision journal and AI source rail">
          <div className="grid two">
            <form className="stack" onSubmit={submitDecision}>
              <strong>Record decision</strong>
              <label className="label">
                Action
                <select
                  className="select"
                  value={decisionAction}
                  onChange={(event) => setDecisionAction(event.target.value)}
                >
                  <option value="watched">watched</option>
                  <option value="accepted">accepted</option>
                  <option value="rejected">rejected</option>
                  <option value="ignored">ignored</option>
                  <option value="needs_more_research">needs_more_research</option>
                </select>
              </label>
              <label className="label">
                Notes
                <textarea
                  className="textarea"
                  value={decisionNotes}
                  onChange={(event) => setDecisionNotes(event.target.value)}
                />
              </label>
              <div className="grid three">
                <label className="label">
                  Entry
                  <input
                    className="input"
                    onChange={(event) => setDecisionEntry(event.target.value)}
                    placeholder={thesis.entry_zone || '100000-101500'}
                    value={decisionEntry}
                  />
                </label>
                <label className="label">
                  SL
                  <input
                    className="input"
                    onChange={(event) => setDecisionStopLoss(event.target.value)}
                    placeholder={thesis.invalidation_level || '95000'}
                    value={decisionStopLoss}
                  />
                </label>
                <label className="label">
                  TP
                  <input
                    className="input"
                    onChange={(event) => setDecisionTakeProfit(event.target.value)}
                    placeholder={thesis.target_zones[0] || '110000'}
                    value={decisionTakeProfit}
                  />
                </label>
              </div>
              <label className="label">
                Position intent
                <select
                  className="select"
                  onChange={(event) => setPositionIntent(event.target.value)}
                  value={positionIntent}
                >
                  <option value="watch_only">watch_only</option>
                  <option value="spot_accumulation">spot_accumulation</option>
                  <option value="long_perp">long_perp</option>
                  <option value="short_perp">short_perp</option>
                  <option value="hedge_or_reduce">hedge_or_reduce</option>
                  <option value="no_trade">no_trade</option>
                </select>
              </label>
              {decisionMutation.isError ? <span className="badge risk">{errorMessage(decisionMutation.error)}</span> : null}
              {decisionMutation.isSuccess ? <span className="badge constructive">decision recorded</span> : null}
              <button className="button primary" disabled={decisionMutation.isPending} type="submit">
                Record decision
              </button>
            </form>

            <form className="stack" onSubmit={submitReview}>
              <strong>Outcome review</strong>
              <label className="label">
                Result
                <select
                  className="select"
                  value={reviewResult}
                  onChange={(event) => setReviewResult(event.target.value)}
                >
                  <option value="worked">worked</option>
                  <option value="failed">failed</option>
                  <option value="mixed">mixed</option>
                  <option value="invalidated">invalidated</option>
                  <option value="expired">expired</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
              <label className="label">
                Lessons
                <textarea
                  className="textarea"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                />
              </label>
              <div className="grid two">
                <label className="label">
                  MFE
                  <input
                    className="input"
                    inputMode="decimal"
                    onChange={(event) => setReviewMfe(event.target.value)}
                    placeholder="0.12"
                    type="number"
                    step="0.0001"
                    value={reviewMfe}
                  />
                </label>
                <label className="label">
                  MAE
                  <input
                    className="input"
                    inputMode="decimal"
                    onChange={(event) => setReviewMae(event.target.value)}
                    placeholder="-0.05"
                    type="number"
                    step="0.0001"
                    value={reviewMae}
                  />
                </label>
              </div>
              {reviewMutation.isError ? <span className="badge risk">{errorMessage(reviewMutation.error)}</span> : null}
              {reviewMutation.isSuccess ? <span className="badge constructive">review recorded</span> : null}
              <button className="button" disabled={reviewMutation.isPending} type="submit">
                Record review
              </button>
            </form>
          </div>
        </Panel>

        <Panel className="span-12" title="Monitor next" description="Follow-up IDs, target zones, and missing data">
          <div className="grid three">
            <EvidenceBlock title="Target zones" tone="constructive" values={thesis.target_zones} />
            <EvidenceBlock title="Monitor next" tone="primary" values={thesis.monitor_next} />
            <EvidenceBlock title="Stale or missing data" tone="warning" values={thesis.stale_or_missing_data} />
          </div>
          <div style={{ marginTop: 14 }} className="badge">
            <GitBranch aria-hidden size={14} />
            {thesis.summary.market_type || thesis.summary.direction || 'research thesis'}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function stabilityGuardSummary(guard: JsonRecord) {
  const proposed = asRecord(guard.proposed);
  const rating = stringValue(proposed.rating);
  const direction = stringValue(proposed.direction);
  const confidence = numberValue(proposed.confidence);
  const ageMinutes = numberValue(guard.age_minutes);
  const stance = [rating, direction].filter(Boolean).join(' / ');
  const confidenceText = confidence === null ? '' : ` ${Math.round(confidence * 100)}%`;
  const ageText = ageMinutes === null ? '' : ` at ${ageMinutes.toFixed(1)}m`;
  return stance
    ? `held prior thesis; blocked ${stance}${confidenceText}${ageText}`
    : `held prior thesis${ageText}`;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  watchDistancePct: string;
  reviewDistancePct: string;
  consecutiveInvalidationToRerun: string;
  runMemoOnReview: boolean;
  runMemoOnRerunFull: boolean;
  skipMemoIfNoNewPulses: boolean;
};

function ThesisMonitorSection({
  error,
  isError,
  isLoading,
  isRunningMemo,
  isRunning,
  isSavingPlan,
  memoRunResult,
  memos,
  onRunMemo,
  onRunPulse,
  onSavePlan,
  plan,
  pulses,
}: {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  isRunningMemo: boolean;
  isRunning: boolean;
  isSavingPlan: boolean;
  memoRunResult: RunThesisPulseMemoResponse | null;
  memos: ThesisPulseMemoResponse[];
  onRunMemo: () => void;
  onRunPulse: () => void;
  onSavePlan: (request: PatchThesisMonitorPlanRequest) => Promise<unknown>;
  plan: ThesisMonitorPlanResponse | null;
  pulses: ThesisPulseResponse[];
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

  useEffect(() => {
    setForm(monitorPlanToForm(plan));
    setFormError('');
  }, [plan]);

  if (isLoading) {
    return <LoadingState label="Loading monitor..." />;
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
              min={1}
              onChange={(value) =>
                setForm((current) => ({ ...current, priceIntervalMinutes: value }))
              }
              step={1}
              value={form.priceIntervalMinutes}
            />
            <NumberInput
              label="Watch band %"
              min={0.25}
              onChange={(value) =>
                setForm((current) => ({ ...current, watchDistancePct: value }))
              }
              value={form.watchDistancePct}
            />
            <NumberInput
              label="Review band %"
              min={0.1}
              onChange={(value) =>
                setForm((current) => ({ ...current, reviewDistancePct: value }))
              }
              value={form.reviewDistancePct}
            />
            <NumberInput
              label="Invalidations to rerun"
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
            <PriceToThesisChart plan={plan} pulses={pulses} />
            <PulseTimeline pulses={pulses} />
          </div>
          <PulseMemoPanel latestMemo={latestMemo} memos={sortedMemos} />
        </>
      ) : (
        <EmptyState label="No monitor plan is available for this thesis." />
      )}
    </div>
  );
}

function NumberInput({
  label,
  min,
  onChange,
  step = 0.0001,
  value,
}: {
  label: string;
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
        min={min}
        onChange={(event) => onChange(event.target.value)}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
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
  );
  const watchDistancePct = parseRequiredFormNumber(
    form.watchDistancePct,
    'Watch band',
  );
  const reviewDistancePct = parseRequiredFormNumber(
    form.reviewDistancePct,
    'Review band',
  );
  const consecutiveInvalidationToRerun = parseRequiredFormNumber(
    form.consecutiveInvalidationToRerun,
    'Invalidations to rerun',
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
): { value: number } | { error: string } {
  const parsed = parseNullableFormNumber(value);
  if (parsed === null) {
    return { error: `${label} is required.` };
  }
  if (parsed === 'invalid') {
    return { error: `${label} must be numeric.` };
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
  tone?: 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';
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

function PriceToThesisChart({
  plan,
  pulses,
}: {
  plan: ThesisMonitorPlanResponse;
  pulses: ThesisPulseResponse[];
}) {
  const prices = pulses
    .map((pulse) => pulse.current_price)
    .filter((price): price is number => price !== null);
  const overlayValues = [
    plan.baseline_price,
    plan.entry_low,
    plan.entry_high,
    plan.invalidation_level,
    ...plan.targets.map((target) => target.price),
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  const values = [...prices, ...overlayValues];
  if (values.length === 0) {
    return <EmptyState label="No chartable monitor levels yet." />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.16, max * 0.01, 1);
  const yMin = min - padding;
  const yMax = max + padding;
  const xFor = (index: number) =>
    pulses.length <= 1 ? 56 : 56 + (index / (pulses.length - 1)) * 572;
  const yFor = (value: number) => 238 - ((value - yMin) / (yMax - yMin)) * 186;
  const linePoints = pulses
    .map((pulse, index) =>
      pulse.current_price === null ? null : `${xFor(index)},${yFor(pulse.current_price)}`,
    )
    .filter((point): point is string => point !== null)
    .join(' ');
  const overlays = [
    plan.baseline_price === null
      ? null
      : { label: 'baseline', value: plan.baseline_price, className: 'baseline' },
    plan.entry_low === null
      ? null
      : { label: 'entry low', value: plan.entry_low, className: 'entry' },
    plan.entry_high === null
      ? null
      : { label: 'entry high', value: plan.entry_high, className: 'entry' },
    plan.invalidation_level === null
      ? null
      : {
          label: 'invalidation',
          value: plan.invalidation_level,
          className: 'invalidation',
        },
    ...plan.targets.map((target) => ({
      label: target.label || 'target',
      value: target.price,
      className: 'target',
    })),
  ].filter((item): item is { label: string; value: number; className: string } => item !== null);

  return (
    <div className="thesis-monitor-chart">
      <div className="row">
        <strong>Price-to-thesis chart</strong>
        <span className="small muted">{pulses.length} pulse rows</span>
      </div>
      <svg aria-label="Price-to-thesis chart" role="img" viewBox="0 0 680 280">
        <rect className="chart-bg" height="236" rx="8" width="636" x="22" y="22" />
        {[0, 1, 2, 3].map((line) => {
          const y = 52 + line * 52;
          return <line className="chart-grid" key={line} x1="48" x2="636" y1={y} y2={y} />;
        })}
        {overlays.map((overlay) => {
          const y = yFor(overlay.value);
          return (
            <g key={`${overlay.className}-${overlay.label}-${overlay.value}`}>
              <line
                className={`thesis-chart-level ${overlay.className}`}
                x1="48"
                x2="636"
                y1={y}
                y2={y}
              />
              <text className="thesis-chart-label" x="52" y={Math.max(34, y - 5)}>
                {overlay.label} {numberLabel(overlay.value)}
              </text>
            </g>
          );
        })}
        {linePoints ? <polyline className="thesis-price-line" points={linePoints} /> : null}
        {pulses.map((pulse, index) =>
          pulse.current_price === null ? null : (
            <circle
              className={`thesis-pulse-marker marker-${pulse.status}`}
              cx={xFor(index)}
              cy={yFor(pulse.current_price)}
              key={pulse.id ?? `${pulse.observed_at}-${index}`}
              r="5"
            />
          ),
        )}
      </svg>
    </div>
  );
}

function PulseTimeline({ pulses }: { pulses: ThesisPulseResponse[] }) {
  if (pulses.length === 0) {
    return <EmptyState label="No pulses yet." />;
  }
  return (
    <div className="thesis-pulse-timeline">
      <div className="row">
        <strong>Pulse timeline</strong>
        <span className="small muted">latest {Math.min(pulses.length, 8)}</span>
      </div>
      <div className="thesis-pulse-list">
        {pulses.slice(-8).reverse().map((pulse) => (
          <article className="thesis-pulse-row" key={pulse.id ?? pulse.observed_at}>
            <span className={`pulse-status-dot marker-${pulse.status}`} />
            <div>
              <div className="row">
                <strong>{pulse.status}</strong>
                <span className="small muted">{formatDateTime(pulse.observed_at)}</span>
              </div>
              <p>
                {numberLabel(pulse.current_price)} · score {pulse.score} ·{' '}
                {pulse.suggested_action}
              </p>
              {pulse.trigger_reasons.length ? (
                <div className="top-strip-meta">
                  {pulse.trigger_reasons.slice(0, 4).map((reason) => (
                    <span className={`badge ${monitorStatusTone(pulse.status)}`} key={reason}>
                      {reason}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function PulseMemoPanel({
  latestMemo,
  memos,
}: {
  latestMemo: ThesisPulseMemoResponse | null;
  memos: ThesisPulseMemoResponse[];
}) {
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
                  <span className="badge primary" key={pulseId}>
                    {pulseId}
                  </span>
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

function ScenarioRadarCard({
  scenario,
  index,
}: {
  scenario: ScenarioResponse;
  index: number;
}) {
  const band = cleanScenarioText(scenario.probability_band) || 'scenario';
  const bandTone = scenarioBandTone(band);
  const action = cleanScenarioText(
    scenario.suggested_user_action ||
      stringValue(scenario.payload.suggested_action) ||
      'review',
  );
  const actionParts = splitAction(action);
  const condition = cleanScenarioText(
    scenario.condition || stringValue(scenario.payload.condition),
  ) || 'No condition recorded.';
  const expected = cleanScenarioText(
    scenario.expected_behavior ||
      stringValue(scenario.payload.expected_market_behavior) ||
      stringValue(scenario.payload.expected_behavior),
  );
  const invalidation = cleanScenarioText(stringValue(scenario.payload.invalidation));
  const riskMap = stringList(
    scenario.payload.risk_map ?? scenario.payload.risk_factors,
  );

  return (
    <article className={`scenario-card scenario-card-${bandTone}`}>
      <div className="scenario-card-header">
        <div className="scenario-title">
          <span className="scenario-index">{index + 1}</span>
          <strong>{titleCaseBand(band)}</strong>
        </div>
        <span className={`badge ${bandTone}`}>{band}</span>
      </div>

      <p className="scenario-condition">{condition}</p>

      <div className="scenario-action">
        <span className={`badge ${actionTone(actionParts.label)}`}>
          {actionParts.label}
        </span>
        {actionParts.detail ? <span>{actionParts.detail}</span> : null}
      </div>

      {expected ? (
        <div className="scenario-field">
          <span>Expected</span>
          <p>{expected}</p>
        </div>
      ) : null}

      {invalidation ? (
        <div className="scenario-field">
          <span>Invalidation</span>
          <p>{invalidation}</p>
        </div>
      ) : null}

      {riskMap.length > 0 ? (
        <div className="scenario-risk-row">
          {riskMap.slice(0, 4).map((risk) => (
            <span className="pill warning" key={risk}>
              {cleanScenarioText(risk)}
            </span>
          ))}
        </div>
      ) : null}

      <details className="scenario-debug">
        <summary>Payload</summary>
        <JsonView value={scenario.payload} />
      </details>
    </article>
  );
}

function scenarioBandTone(value: string): 'constructive' | 'warning' | 'degraded' | 'primary' {
  const normalized = value.toLowerCase();
  if (normalized.includes('high')) {
    return 'constructive';
  }
  if (normalized.includes('medium') || normalized.includes('base')) {
    return 'warning';
  }
  if (normalized.includes('low')) {
    return 'degraded';
  }
  return 'primary';
}

function titleCaseBand(value: string): string {
  const clean = value.trim();
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)} probability` : 'Scenario';
}

function actionTone(value: string): 'constructive' | 'warning' | 'risk' | 'primary' {
  const normalized = value.toLowerCase();
  if (normalized.includes('exit') || normalized.includes('reduce') || normalized.includes('avoid')) {
    return 'risk';
  }
  if (normalized.includes('watch') || normalized.includes('monitor')) {
    return 'constructive';
  }
  if (normalized.includes('reassess') || normalized.includes('review')) {
    return 'warning';
  }
  return 'primary';
}

function splitAction(value: string): { label: string; detail: string } {
  const cleaned = cleanScenarioText(value);
  const match = cleaned.match(
    /^(watch|monitor|review|reassess|avoid|reduce|exit|stand aside|maintain|downgrade|upgrade|record|wait)\b[:,-]?\s*(.*)$/i,
  );
  if (!match) {
    return { label: 'Review', detail: cleaned };
  }
  const label = match[1].replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { label, detail: match[2]?.trim() ?? '' };
}

function cleanScenarioText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/\*\*/g, '')
    .replace(/^\s*(?:\u2192|->|=>)\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => cleanScenarioText(item))
    .filter(Boolean);
}

function ThesisFact({
  children,
  label,
  wide = false,
}: {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <div className={`thesis-fact${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <div className="thesis-fact-value">{children}</div>
    </div>
  );
}

function EvidenceAndContradictions({
  contradictingSignalIds,
  keyReasons,
  risks,
  supportingSignalIds,
}: {
  contradictingSignalIds: string[];
  keyReasons: string[];
  risks: string[];
  supportingSignalIds: string[];
}) {
  return (
    <div className="thesis-evidence-layout">
      <div className="thesis-evidence-main-column">
        <EvidenceNarrativeBlock
          title="Key reasons"
          tone="primary"
          values={keyReasons}
        />
        <div className="thesis-evidence-signal-grid">
          <EvidenceSignalRail
            title="Supporting signals"
            tone="constructive"
            values={supportingSignalIds}
          />
          <EvidenceSignalRail
            title="Contradicting signals"
            tone="risk"
            values={contradictingSignalIds}
          />
        </div>
      </div>
      <EvidenceNarrativeBlock
        title="Risks"
        tone="warning"
        values={risks}
      />
    </div>
  );
}

function EvidenceNarrativeBlock({
  title,
  tone,
  values,
}: {
  title: string;
  tone: 'primary' | 'warning';
  values: string[];
}) {
  const cleanedValues = values.map((value) => cleanScenarioText(value)).filter(Boolean);

  return (
    <section className={`thesis-evidence-card thesis-evidence-card-${tone}`}>
      <div className="thesis-evidence-card-header">
        <strong>{title}</strong>
        <span className={`badge ${tone}`}>{cleanedValues.length}</span>
      </div>
      {cleanedValues.length === 0 ? (
        <p className="thesis-evidence-empty">None reported.</p>
      ) : (
        <ol className="thesis-evidence-list">
          {cleanedValues.map((value, index) => (
            <li className={`thesis-evidence-item thesis-evidence-item-${tone}`} key={`${title}-${value}`}>
              <span className="thesis-evidence-index">{index + 1}</span>
              <p>{value}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EvidenceSignalRail({
  title,
  tone,
  values,
}: {
  title: string;
  tone: 'constructive' | 'risk';
  values: string[];
}) {
  return (
    <section className={`thesis-evidence-card thesis-evidence-card-rail thesis-evidence-card-${tone}`}>
      <div className="thesis-evidence-card-header">
        <strong>{title}</strong>
        <span className={`badge ${tone}`}>{values.length}</span>
      </div>
      {values.length === 0 ? (
        <p className="thesis-evidence-empty">No linked signal IDs.</p>
      ) : (
        <div className="thesis-evidence-signal-list">
          {values.map((value) => (
            <IdChip key={value} value={value} />
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceBlock({
  title,
  values,
  tone,
}: {
  title: string;
  values: string[];
  tone: 'primary' | 'constructive' | 'warning' | 'risk';
}) {
  return (
    <div className="state-card">
      <strong>{title}</strong>
      {values.length === 0 ? (
        <p className="small muted">None reported.</p>
      ) : (
        <div className="top-strip-meta">
          {values.map((value) => (
            <span className={`badge ${tone} mono`} key={value} title={value}>
              <span className="badge-label">{value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
