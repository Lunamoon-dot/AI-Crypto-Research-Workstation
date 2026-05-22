import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, History, Play, RefreshCcw, Search, ShieldAlert, Target } from 'lucide-react';
import { BentoGrid, DataPair } from '@/components/research/bento';
import { IdChip } from '@/components/research/badges';
import { HeaderStats } from '@/components/research/header-stats';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import {
  applyMaturedEvaluations,
  createCalibrationEvaluationRerun,
  evaluateThesis,
  getAgentCalibrationReport,
  getCalibrationEvaluationVersionPolicy,
  getSymbolCalibrationReport,
  listCalibrationEvaluationReruns,
  listCalibrationEvaluations,
  promoteCalibrationEvaluationRerun,
  previewMaturedEvaluations,
  recordCalibrationOutcomeReview,
  resetCalibrationEvaluationVersionPolicy,
} from '@/services/calibration';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { listTheses } from '@/services/theses';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type {
  AgentCalibrationAgentResponse,
  AgentCalibrationReportResponse,
  AgentCalibrationRowResponse,
  CalibrationEvaluationResponse,
  CalibrationEvaluationPromotionResponse,
  CalibrationEvaluationRerunReason,
  CalibrationEvaluationRerunResponse,
  CalibrationEvaluationVersionPolicyResponse,
  CalibrationRecordReviewBlocker,
  CreateCalibrationEvaluationRerunResponse,
  MaturedEvaluationApplyRowResponse,
  MaturedEvaluationPreviewRowResponse,
  PromoteCalibrationEvaluationResponse,
  SymbolCalibrationReportResponse,
  SymbolCalibrationRowResponse,
  ThesisResponse,
} from '@/types';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';

const WINDOW_PRESETS = [7, 14, 30] as const;
const LOOKBACK_PRESETS = [30, 60, 90] as const;
const RERUN_REASON_OPTIONS: CalibrationEvaluationRerunReason[] = [
  'manual_check',
  'engine_rule_change',
  'market_data_fix',
  'bug_fix_verification',
  'suspected_drift',
  'other',
];
type CalibrationMode = 'single' | 'batch' | 'symbol' | 'agents';

export function CalibrationLabPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryThesisId = searchParams.get('thesis_id') ?? '';
  const queryMode = searchParams.get('mode');
  const activeMode: CalibrationMode = queryThesisId
    ? 'single'
    : queryMode === 'batch' || queryMode === 'symbol' || queryMode === 'agents'
      ? queryMode
      : 'single';
  const [selectedThesisId, setSelectedThesisId] = useState(queryThesisId);
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_PRESETS)[number]>(14);
  const [activeEvaluation, setActiveEvaluation] =
    useState<CalibrationEvaluationResponse | null>(null);
  const [createdState, setCreatedState] = useState<boolean | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rerunReason, setRerunReason] =
    useState<CalibrationEvaluationRerunReason>('manual_check');
  const [rerunNotes, setRerunNotes] = useState('');
  const [armedPromotionRerunId, setArmedPromotionRerunId] = useState<string | null>(
    null,
  );
  const [resetPolicyArmed, setResetPolicyArmed] = useState(false);
  const [batchWindowDays, setBatchWindowDays] =
    useState<(typeof WINDOW_PRESETS)[number]>(14);
  const [batchSymbol, setBatchSymbol] = useState('');
  const [batchApplyArmed, setBatchApplyArmed] = useState(false);
  const [symbolCalibrationSymbol, setSymbolCalibrationSymbol] = useState(
    searchParams.get('symbol') ?? 'BTC/USDT',
  );
  const [symbolWindowDays, setSymbolWindowDays] = useState<
    (typeof WINDOW_PRESETS)[number]
  >(() => parseWindowPreset(searchParams.get('window_days'), 7));
  const [symbolLookbackDays, setSymbolLookbackDays] = useState<
    (typeof LOOKBACK_PRESETS)[number]
  >(() => parseLookbackPreset(searchParams.get('lookback_days'), 30));
  const [agentCalibrationSymbol, setAgentCalibrationSymbol] = useState(
    searchParams.get('symbol') ?? '',
  );
  const [agentWindowDays, setAgentWindowDays] = useState<
    (typeof WINDOW_PRESETS)[number]
  >(() => parseWindowPreset(searchParams.get('window_days'), 7));
  const [agentLookbackDays, setAgentLookbackDays] = useState<
    (typeof LOOKBACK_PRESETS)[number]
  >(() => parseLookbackPreset(searchParams.get('lookback_days'), 30));

  useEffect(() => {
    setSelectedThesisId(queryThesisId);
    setActiveEvaluation(null);
    setCreatedState(null);
    setReviewNotes('');
    setRerunNotes('');
  }, [queryThesisId]);

  useEffect(() => {
    setRerunReason('manual_check');
    setRerunNotes('');
    setArmedPromotionRerunId(null);
    setResetPolicyArmed(false);
  }, [activeEvaluation?.id]);

  const thesesQuery = useQuery({
    queryKey: queryKeys.theses({ limit: 100 }),
    queryFn: () => listTheses({ limit: 100 }, auth),
  });
  const historyFilters = useMemo(
    () => ({ thesis_id: selectedThesisId || undefined, limit: 50 }),
    [selectedThesisId],
  );
  const historyQuery = useQuery({
    queryKey: queryKeys.calibrationEvaluations(historyFilters),
    queryFn: () => listCalibrationEvaluations(historyFilters, auth),
  });
  const activeEvaluationId = activeEvaluation?.id ?? '';
  const rerunHistoryQuery = useQuery({
    queryKey: queryKeys.calibrationEvaluationReruns(activeEvaluationId),
    queryFn: () =>
      listCalibrationEvaluationReruns(activeEvaluationId, { limit: 20 }, auth),
    enabled: Boolean(activeEvaluationId),
  });
  const versionPolicyQuery = useQuery({
    queryKey: queryKeys.calibrationEvaluationVersionPolicy(activeEvaluationId),
    queryFn: () =>
      getCalibrationEvaluationVersionPolicy(activeEvaluationId, auth),
    enabled: Boolean(activeEvaluationId),
  });
  const batchFilters = useMemo(
    () => ({
      window_days: batchWindowDays,
      scan_limit: 100,
      symbol: batchSymbol.trim() || undefined,
    }),
    [batchSymbol, batchWindowDays],
  );
  const batchPreviewQuery = useQuery({
    queryKey: queryKeys.calibrationMaturedPreview(batchFilters),
    queryFn: () => previewMaturedEvaluations(batchFilters, auth),
    enabled: false,
  });
  const symbolFilters = useMemo(
    () => ({
      symbol: symbolCalibrationSymbol.trim(),
      window_days: symbolWindowDays,
      lookback_days: symbolLookbackDays,
    }),
    [symbolCalibrationSymbol, symbolWindowDays, symbolLookbackDays],
  );
  const symbolReportQuery = useQuery({
    queryKey: queryKeys.calibrationSymbol(symbolFilters),
    queryFn: () => getSymbolCalibrationReport(symbolFilters, auth),
    enabled: false,
  });
  const agentFilters = useMemo(
    () => ({
      symbol: agentCalibrationSymbol.trim() || undefined,
      window_days: agentWindowDays,
      lookback_days: agentLookbackDays,
    }),
    [agentCalibrationSymbol, agentWindowDays, agentLookbackDays],
  );
  const agentReportQuery = useQuery({
    queryKey: queryKeys.calibrationAgents(agentFilters),
    queryFn: () => getAgentCalibrationReport(agentFilters, auth),
    enabled: false,
  });
  const selectedThesis =
    thesesQuery.data?.find((thesis) => thesis.id === selectedThesisId) ?? null;
  const quickSymbols = useMemo(
    () =>
      [
        ...new Set(
          (thesesQuery.data ?? [])
            .map((thesis) => thesis.symbol)
            .filter((symbol): symbol is string => Boolean(symbol)),
        ),
      ].slice(0, 12),
    [thesesQuery.data],
  );

  const evaluateMutation = useMutation({
    mutationFn: () =>
      evaluateThesis(
        {
          thesis_id: selectedThesisId,
          window_days: windowDays,
        },
        auth,
      ),
    onSuccess: (response) => {
      setActiveEvaluation(response.evaluation);
      setCreatedState(response.created);
      setReviewNotes(defaultReviewNote(response.evaluation));
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calibrationRoot(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calibrationEvaluations(historyFilters),
      });
    },
  });

  const recordMutation = useMutation({
    mutationFn: () => {
      if (!activeEvaluation?.id) {
        throw new Error('Select an evaluation first.');
      }
      return recordCalibrationOutcomeReview(
        activeEvaluation.id,
        { notes: reviewNotes },
        auth,
      );
    },
    onSuccess: (response) => {
      setActiveEvaluation(response.evaluation);
      setCreatedState(false);
      if (response.outcome_review) {
        setReviewNotes(response.outcome_review.lessons);
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calibrationRoot(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calibrationEvaluations(historyFilters),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calibrationEvaluationVersionPolicy(response.evaluation.id ?? ''),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.performanceRoot(),
      });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: ({ idempotencyKey }: { idempotencyKey: string }) => {
      if (!activeEvaluation?.id) {
        throw new Error('Select an evaluation first.');
      }
      return createCalibrationEvaluationRerun(
        activeEvaluation.id,
        {
          reason: rerunReason,
          notes: rerunNotes.trim() || undefined,
          idempotency_key: idempotencyKey,
        },
        auth,
      );
    },
    onSettled: () => {
      if (activeEvaluation?.id) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.calibrationEvaluationReruns(activeEvaluation.id),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.calibrationEvaluationVersionPolicy(activeEvaluation.id),
        });
      }
    },
  });

  const promoteMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      rerunId,
    }: {
      idempotencyKey: string;
      rerunId: string;
    }) => {
      if (!activeEvaluation?.id) {
        throw new Error('Select an evaluation first.');
      }
      return promoteCalibrationEvaluationRerun(
        activeEvaluation.id,
        rerunId,
        {
          reason: rerunReason,
          notes: rerunNotes.trim() || undefined,
          idempotency_key: idempotencyKey,
        },
        auth,
      );
    },
    onSuccess: (response) => {
      setActiveEvaluation(response.policy.active_evaluation);
      setCreatedState(false);
      setArmedPromotionRerunId(null);
      setResetPolicyArmed(false);
    },
    onSettled: () => {
      if (activeEvaluation?.id) {
        invalidateCalibrationPolicyQueries(activeEvaluation.id);
      }
    },
  });

  const resetPolicyMutation = useMutation({
    mutationFn: ({ idempotencyKey }: { idempotencyKey: string }) => {
      if (!activeEvaluation?.id) {
        throw new Error('Select an evaluation first.');
      }
      return resetCalibrationEvaluationVersionPolicy(
        activeEvaluation.id,
        {
          reason: rerunReason,
          notes: rerunNotes.trim() || undefined,
          idempotency_key: idempotencyKey,
        },
        auth,
      );
    },
    onSuccess: (response) => {
      setActiveEvaluation(response.policy.active_evaluation);
      setCreatedState(false);
      setArmedPromotionRerunId(null);
      setResetPolicyArmed(false);
    },
    onSettled: () => {
      if (activeEvaluation?.id) {
        invalidateCalibrationPolicyQueries(activeEvaluation.id);
      }
    },
  });

  const batchApplyMutation = useMutation({
    mutationFn: () =>
      applyMaturedEvaluations(
        {
          window_days: batchWindowDays,
          max_batch: 10,
          symbol: batchSymbol.trim() || undefined,
        },
        auth,
      ),
    onSuccess: () => {
      setBatchApplyArmed(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calibrationRoot(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calibrationEvaluations(historyFilters),
      });
      void batchPreviewQuery.refetch();
    },
  });

  function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedThesisId) {
      return;
    }
    evaluateMutation.mutate();
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    recordMutation.mutate();
  }

  function submitRerun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeEvaluation?.id) {
      return;
    }
    rerunMutation.mutate({ idempotencyKey: createClientIdempotencyKey() });
  }

  function invalidateCalibrationPolicyQueries(evaluationId: string) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.calibrationRoot(),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.calibrationEvaluations(historyFilters),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.calibrationEvaluation(evaluationId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.calibrationEvaluationVersionPolicy(evaluationId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.calibrationSymbol(symbolFilters),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.calibrationAgents(agentFilters),
    });
  }

  function submitPromotion(rerunId: string | null) {
    if (!activeEvaluation?.id || !rerunId) {
      return;
    }
    if (armedPromotionRerunId !== rerunId) {
      setArmedPromotionRerunId(rerunId);
      setResetPolicyArmed(false);
      promoteMutation.reset();
      return;
    }
    promoteMutation.mutate({
      rerunId,
      idempotencyKey: createClientIdempotencyKey(),
    });
  }

  function submitVersionPolicyReset() {
    if (!activeEvaluation?.id) {
      return;
    }
    if (!resetPolicyArmed) {
      setResetPolicyArmed(true);
      setArmedPromotionRerunId(null);
      resetPolicyMutation.reset();
      return;
    }
    resetPolicyMutation.mutate({
      idempotencyKey: createClientIdempotencyKey(),
    });
  }

  function inspectEvaluation(evaluation: CalibrationEvaluationResponse) {
    setActiveEvaluation(evaluation);
    setCreatedState(null);
    setReviewNotes(defaultReviewNote(evaluation));
  }

  function updateBatchWindow(preset: (typeof WINDOW_PRESETS)[number]) {
    setBatchWindowDays(preset);
    setBatchApplyArmed(false);
    batchApplyMutation.reset();
  }

  function updateBatchSymbol(value: string) {
    setBatchSymbol(value);
    setBatchApplyArmed(false);
    batchApplyMutation.reset();
  }

  function previewBatch() {
    setBatchApplyArmed(false);
    batchApplyMutation.reset();
    void batchPreviewQuery.refetch();
  }

  function applyBatch() {
    if (!batchPreviewQuery.data?.summary.candidate) {
      return;
    }
    if (!batchApplyArmed) {
      setBatchApplyArmed(true);
      return;
    }
    batchApplyMutation.mutate();
  }

  function selectMode(mode: CalibrationMode) {
    const next = new URLSearchParams(searchParams);
    next.set('mode', mode);
    if (mode !== 'single') {
      next.delete('thesis_id');
    }
    setSearchParams(next);
  }

  function loadSymbolReport() {
    if (!symbolCalibrationSymbol.trim()) {
      return;
    }
    void symbolReportQuery.refetch();
  }

  function loadAgentReport() {
    void agentReportQuery.refetch();
  }

  function prepareBatchFromSymbol(report: SymbolCalibrationReportResponse) {
    const windowPreset = parseWindowPreset(String(report.window_days), 7);
    const filters = {
      window_days: windowPreset,
      scan_limit: 100,
      symbol: report.symbol,
    };
    setBatchSymbol(report.symbol);
    setBatchWindowDays(windowPreset);
    setBatchApplyArmed(false);
    batchApplyMutation.reset();
    const next = new URLSearchParams(searchParams);
    next.set('mode', 'batch');
    next.delete('thesis_id');
    setSearchParams(next);
    void queryClient.fetchQuery({
      queryKey: queryKeys.calibrationMaturedPreview(filters),
      queryFn: () => previewMaturedEvaluations(filters, auth),
    });
  }

  const batchCandidateCount = batchPreviewQuery.data?.summary.candidate ?? 0;
  const batchRows =
    batchApplyMutation.data?.rows ?? batchPreviewQuery.data?.rows ?? [];

  return (
    <main className="page">
      <PageHeader
        eyebrow="Calibration"
        title="Calibration Lab"
        description="Evaluate saved thesis quality over a fixed forward window before recording an outcome review."
        action={
          <HeaderStats
            stats={[
              {
                icon: <FlaskConical aria-hidden size={14} />,
                label: 'Window',
                meta: 'default 14d',
                value: `${windowDays}d`,
              },
              {
                icon: <History aria-hidden size={14} />,
                label: 'History',
                meta: selectedThesisId ? 'selected thesis' : 'recent global',
                value: historyQuery.data?.length ?? '...',
              },
              {
                icon: <Target aria-hidden size={14} />,
                label: 'Result',
                tone: resultTone(activeEvaluation?.result),
                value: activeEvaluation?.result ?? 'n/a',
              },
              {
                icon: <ShieldAlert aria-hidden size={14} />,
                label: 'Review',
                tone: activeEvaluation?.can_record_review ? 'constructive' : 'warning',
                value:
                  activeEvaluation?.outcome_review_id
                    ? 'Recorded'
                    : activeEvaluation?.can_record_review
                      ? 'Ready'
                      : 'Blocked',
              },
            ]}
          />
        }
      />

      <div
        className="segmented-control"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
      >
        <button
          className={`segment-button${activeMode === 'single' ? ' active' : ''}`}
          onClick={() => selectMode('single')}
          type="button"
        >
          Single Thesis
        </button>
        <button
          className={`segment-button${activeMode === 'batch' ? ' active' : ''}`}
          onClick={() => selectMode('batch')}
          type="button"
        >
          Batch Matured
        </button>
        <button
          className={`segment-button${activeMode === 'symbol' ? ' active' : ''}`}
          onClick={() => selectMode('symbol')}
          type="button"
        >
          Symbol Calibration
        </button>
        <button
          className={`segment-button${activeMode === 'agents' ? ' active' : ''}`}
          onClick={() => selectMode('agents')}
          type="button"
        >
          Agent Calibration
        </button>
      </div>

      {activeMode === 'batch' ? (
      <Panel className="calibration-batch-panel" title="Batch Matured Evaluations">
        <div className="stack">
          <div className="grid three">
            <div className="segmented-control" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {WINDOW_PRESETS.map((preset) => (
                <button
                  className={`segment-button${batchWindowDays === preset ? ' active' : ''}`}
                  key={preset}
                  onClick={() => updateBatchWindow(preset)}
                  type="button"
                >
                  {preset}d
                </button>
              ))}
            </div>
            <label className="label">
              Symbol
              <input
                className="input"
                onChange={(event) => updateBatchSymbol(event.target.value)}
                placeholder="BTC/USDT"
                value={batchSymbol}
              />
            </label>
            <div className="top-strip-meta">
              <button
                className="button"
                disabled={batchPreviewQuery.isFetching}
                onClick={previewBatch}
                type="button"
              >
                <Search aria-hidden size={16} />
                {batchPreviewQuery.isFetching ? 'Previewing' : 'Preview'}
              </button>
              <button
                className={`button ${batchApplyArmed ? 'primary' : ''}`}
                disabled={
                  batchCandidateCount === 0 ||
                  batchApplyMutation.isPending ||
                  batchPreviewQuery.isFetching
                }
                onClick={applyBatch}
                type="button"
              >
                <Play aria-hidden size={16} />
                {batchApplyMutation.isPending
                  ? 'Applying'
                  : batchApplyArmed
                    ? 'Confirm apply'
                    : 'Apply'}
              </button>
            </div>
          </div>

          {batchPreviewQuery.isError ? (
            <span className="badge risk">{errorMessage(batchPreviewQuery.error)}</span>
          ) : null}
          {batchApplyMutation.isError ? (
            <span className="badge risk">{errorMessage(batchApplyMutation.error)}</span>
          ) : null}
          {batchApplyArmed ? (
            <span className="badge warning">
              Confirm apply up to 10 of {batchCandidateCount} candidate row(s)
            </span>
          ) : null}

          <BatchSummaryChips
            applySummary={batchApplyMutation.data?.summary}
            previewSummary={batchPreviewQuery.data?.summary}
          />
          <BatchRowsTable rows={batchRows} />
        </div>
      </Panel>
      ) : null}

      {activeMode === 'symbol' ? (
        <SymbolCalibrationView
          lookbackDays={symbolLookbackDays}
          onLoad={loadSymbolReport}
          onPrepareBatch={prepareBatchFromSymbol}
          onSetLookbackDays={setSymbolLookbackDays}
          onSetSymbol={setSymbolCalibrationSymbol}
          onSetWindowDays={setSymbolWindowDays}
          query={symbolReportQuery}
          quickSymbols={quickSymbols}
          symbol={symbolCalibrationSymbol}
          windowDays={symbolWindowDays}
        />
      ) : null}

      {activeMode === 'agents' ? (
        <AgentCalibrationView
          lookbackDays={agentLookbackDays}
          onLoad={loadAgentReport}
          onSetLookbackDays={setAgentLookbackDays}
          onSetSymbol={setAgentCalibrationSymbol}
          onSetWindowDays={setAgentWindowDays}
          query={agentReportQuery}
          quickSymbols={quickSymbols}
          symbol={agentCalibrationSymbol}
          windowDays={agentWindowDays}
        />
      ) : null}

      {activeMode === 'single' ? (
      <BentoGrid>
        <Panel className="span-5" title="Evaluate Thesis">
          <form className="stack" onSubmit={submitEvaluation}>
            <label className="label">
              Thesis
              <select
                className="select"
                onChange={(event) => {
                  setSelectedThesisId(event.target.value);
                  setActiveEvaluation(null);
                  setCreatedState(null);
                  setReviewNotes('');
                }}
                value={selectedThesisId}
              >
                <option value="">Select a thesis</option>
                {thesesQuery.data?.map((thesis) => (
                  <option key={thesis.id ?? thesis.symbol} value={thesis.id ?? ''}>
                    {thesis.symbol} - {thesis.setup_type || thesis.id}
                  </option>
                ))}
              </select>
            </label>

            <div className="segmented-control" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {WINDOW_PRESETS.map((preset) => (
                <button
                  className={`segment-button${windowDays === preset ? ' active' : ''}`}
                  key={preset}
                  onClick={() => setWindowDays(preset)}
                  type="button"
                >
                  {preset}d
                </button>
              ))}
            </div>

            {selectedThesis ? <SelectedThesisSummary thesis={selectedThesis} /> : null}
            {evaluateMutation.isError ? (
              <span className="badge risk">{errorMessage(evaluateMutation.error)}</span>
            ) : null}
            {createdState !== null ? (
              <span className={`badge ${createdState ? 'constructive' : 'primary'}`}>
                {createdState ? 'New evaluation' : 'Existing evaluation'}
              </span>
            ) : null}
            <button
              className="button primary"
              disabled={!selectedThesisId || evaluateMutation.isPending}
              type="submit"
            >
              <FlaskConical aria-hidden size={16} />
              {evaluateMutation.isPending ? 'Evaluating' : 'Evaluate'}
            </button>
          </form>
        </Panel>

        <Panel className="span-7" title="Evaluation Detail">
          {!activeEvaluation ? <EmptyState label="No evaluation selected." /> : null}
          {activeEvaluation ? (
            <EvaluationDetail evaluation={activeEvaluation} />
          ) : null}
        </Panel>

        <Panel className="span-5" title="Outcome Review">
          {!activeEvaluation ? <EmptyState label="Run or select an evaluation." /> : null}
          {activeEvaluation ? (
            <form className="stack" onSubmit={submitReview}>
              <div className="top-strip-meta">
                <span className={`badge ${resultTone(activeEvaluation.result)}`}>
                  {activeEvaluation.result}
                </span>
                {activeEvaluation.outcome_review_id ? (
                  <span className="badge constructive">
                    <CheckCircle2 aria-hidden size={14} />
                    Review recorded
                  </span>
                ) : null}
              </div>
              <label className="label">
                Notes
                <textarea
                  className="textarea"
                  onChange={(event) => setReviewNotes(event.target.value)}
                  value={reviewNotes}
                />
              </label>
              {activeEvaluation.record_review_blockers.length > 0 ? (
                <BlockerBadges blockers={activeEvaluation.record_review_blockers} />
              ) : null}
              {recordMutation.isError ? (
                <span className="badge risk">{errorMessage(recordMutation.error)}</span>
              ) : null}
              {recordMutation.data?.warnings.length ? (
                <BlockerBadges blockers={recordMutation.data.warnings as CalibrationRecordReviewBlocker[]} />
              ) : null}
              <div className="top-strip-meta">
                <button
                  className="button primary"
                  disabled={
                    !activeEvaluation.can_record_review ||
                    Boolean(activeEvaluation.outcome_review_id) ||
                    recordMutation.isPending
                  }
                  type="submit"
                >
                  Record outcome review
                </button>
                {activeEvaluation.outcome_review_id ? (
                  <Link className="button" to={routes.performance}>
                    Open performance
                  </Link>
                ) : null}
              </div>
            </form>
          ) : null}
        </Panel>

        <Panel className="span-7" title="Rerun Audit">
          {!activeEvaluation ? <EmptyState label="Run or select an evaluation." /> : null}
          {activeEvaluation ? (
            <RerunAuditSection
              armedPromotionRerunId={armedPromotionRerunId}
              evaluation={activeEvaluation}
              mutation={{
                data: rerunMutation.data,
                error: rerunMutation.error,
                isError: rerunMutation.isError,
                isPending: rerunMutation.isPending,
              }}
              notes={rerunNotes}
              onNotesChange={setRerunNotes}
              onPromoteRerun={submitPromotion}
              onReasonChange={setRerunReason}
              onResetPolicy={submitVersionPolicyReset}
              onSubmit={submitRerun}
              policyMutation={{
                promoteData: promoteMutation.data,
                promoteError: promoteMutation.error,
                promoteIsError: promoteMutation.isError,
                promoteIsPending: promoteMutation.isPending,
                resetData: resetPolicyMutation.data,
                resetError: resetPolicyMutation.error,
                resetIsError: resetPolicyMutation.isError,
                resetIsPending: resetPolicyMutation.isPending,
              }}
              query={{
                data: rerunHistoryQuery.data,
                error: rerunHistoryQuery.error,
                isError: rerunHistoryQuery.isError,
                isLoading: rerunHistoryQuery.isLoading,
              }}
              reason={rerunReason}
              resetPolicyArmed={resetPolicyArmed}
              versionPolicy={{
                data: versionPolicyQuery.data,
                error: versionPolicyQuery.error,
                isError: versionPolicyQuery.isError,
                isLoading: versionPolicyQuery.isLoading,
              }}
            />
          ) : null}
        </Panel>

        <Panel className="span-12" title={selectedThesisId ? 'Thesis Evaluation History' : 'Recent Evaluations'}>
          {historyQuery.isLoading ? <LoadingState /> : null}
          {historyQuery.isError ? <ErrorState error={historyQuery.error} /> : null}
          {historyQuery.data?.length === 0 ? (
            <EmptyState label="No calibration evaluations yet." />
          ) : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Evaluation</th>
                  <th>Symbol</th>
                  <th>Window</th>
                  <th>Result</th>
                  <th>Reviewed</th>
                  <th>Evaluated</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.data?.map((evaluation) => (
                  <tr key={evaluation.id ?? `${evaluation.thesis_id}-${evaluation.window_days}`}>
                    <td>{evaluation.id ? <IdChip value={evaluation.id} /> : 'n/a'}</td>
                    <td>{evaluation.symbol}</td>
                    <td>{evaluation.window_days}d</td>
                    <td>
                      <span className={`badge ${resultTone(evaluation.result)}`}>
                        {evaluation.result}
                      </span>
                    </td>
                    <td>{evaluation.outcome_review_id ? 'yes' : 'no'}</td>
                    <td>{formatDate(evaluation.evaluated_at)}</td>
                    <td>
                      <button
                        className="button ghost"
                        onClick={() => inspectEvaluation(evaluation)}
                        type="button"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </BentoGrid>
      ) : null}
    </main>
  );
}

function RerunAuditSection({
  armedPromotionRerunId,
  evaluation,
  reason,
  notes,
  query,
  mutation,
  policyMutation,
  resetPolicyArmed,
  versionPolicy,
  onPromoteRerun,
  onReasonChange,
  onNotesChange,
  onResetPolicy,
  onSubmit,
}: {
  armedPromotionRerunId: string | null;
  evaluation: CalibrationEvaluationResponse;
  reason: CalibrationEvaluationRerunReason;
  notes: string;
  query: {
    data?: CalibrationEvaluationRerunResponse[];
    error: unknown;
    isError: boolean;
    isLoading: boolean;
  };
  mutation: {
    data?: CreateCalibrationEvaluationRerunResponse;
    error: unknown;
    isError: boolean;
    isPending: boolean;
  };
  policyMutation: {
    promoteData?: PromoteCalibrationEvaluationResponse;
    promoteError: unknown;
    promoteIsError: boolean;
    promoteIsPending: boolean;
    resetData?: PromoteCalibrationEvaluationResponse;
    resetError: unknown;
    resetIsError: boolean;
    resetIsPending: boolean;
  };
  resetPolicyArmed: boolean;
  versionPolicy: {
    data?: CalibrationEvaluationVersionPolicyResponse;
    error: unknown;
    isError: boolean;
    isLoading: boolean;
  };
  onPromoteRerun: (rerunId: string | null) => void;
  onReasonChange: (value: CalibrationEvaluationRerunReason) => void;
  onNotesChange: (value: string) => void;
  onResetPolicy: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const rows = query.data ?? [];
  const policy = versionPolicy.data;
  const mutationPending =
    mutation.isPending ||
    policyMutation.promoteIsPending ||
    policyMutation.resetIsPending;
  return (
    <div className="stack">
      <VersionPolicySummary
        evaluation={evaluation}
        isLoading={versionPolicy.isLoading}
        mutation={policyMutation}
        onResetPolicy={onResetPolicy}
        policy={policy}
        resetPolicyArmed={resetPolicyArmed}
      />
      {versionPolicy.isError ? <ErrorState error={versionPolicy.error} /> : null}
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid two">
          <label className="label">
            Reason
            <select
              className="select"
              onChange={(event) =>
                onReasonChange(event.target.value as CalibrationEvaluationRerunReason)
              }
              value={reason}
            >
              {RERUN_REASON_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {labelize(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Notes
            <textarea
              className="textarea"
              onChange={(event) => onNotesChange(event.target.value)}
              value={notes}
            />
          </label>
        </div>
        <div className="top-strip-meta">
          <span className={`badge ${resultTone(evaluation.result)}`}>
            canonical {evaluation.result}
          </span>
          <span className="badge primary">{evaluation.window_days}d</span>
          <button
            className="button primary"
            disabled={mutationPending}
            type="submit"
          >
            <Play aria-hidden size={16} />
            {mutation.isPending ? 'Running' : 'Run audit rerun'}
          </button>
        </div>
        {mutation.isError ? (
          <span className="badge risk">{errorMessage(mutation.error)}</span>
        ) : null}
        {mutation.data && !mutation.data.created ? (
          <span className="badge primary">{mutation.data.warnings.join(', ')}</span>
        ) : null}
        {policyMutation.promoteIsError ? (
          <span className="badge risk">{errorMessage(policyMutation.promoteError)}</span>
        ) : null}
        {policyMutation.resetIsError ? (
          <span className="badge risk">{errorMessage(policyMutation.resetError)}</span>
        ) : null}
        {policyMutation.promoteData && !policyMutation.promoteData.created ? (
          <span className="badge primary">
            {policyMutation.promoteData.warnings.join(', ')}
          </span>
        ) : null}
        {policyMutation.resetData && !policyMutation.resetData.created ? (
          <span className="badge primary">
            {policyMutation.resetData.warnings.join(', ')}
          </span>
        ) : null}
      </form>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState error={query.error} /> : null}
      {!query.isLoading && rows.length === 0 ? (
        <EmptyState label="No rerun audit history yet." />
      ) : null}
      {rows.length > 0 ? (
        <RerunHistoryTable
          armedPromotionRerunId={armedPromotionRerunId}
          evaluation={evaluation}
          mutationPending={mutationPending}
          onPromoteRerun={onPromoteRerun}
          policy={policy}
          rows={rows}
        />
      ) : null}
      {policy ? <VersionPolicyHistory events={policy.events} /> : null}
    </div>
  );
}

function VersionPolicySummary({
  evaluation,
  isLoading,
  mutation,
  onResetPolicy,
  policy,
  resetPolicyArmed,
}: {
  evaluation: CalibrationEvaluationResponse;
  isLoading: boolean;
  mutation: {
    resetIsPending: boolean;
  };
  onResetPolicy: () => void;
  policy?: CalibrationEvaluationVersionPolicyResponse;
  resetPolicyArmed: boolean;
}) {
  const activeSource = policy?.active_source ?? evaluation.active_source;
  const reviewed = Boolean(evaluation.outcome_review_id);
  const canReset = activeSource === 'promoted_rerun' && !reviewed;
  return (
    <div className="top-strip">
      <div>
        <div className="top-strip-meta">
          <span className={`badge ${activeSourceTone(activeSource)}`}>
            {sourceLabel(activeSource)}
          </span>
          {policy?.active_rerun_id ? (
            <IdChip value={policy.active_rerun_id} />
          ) : null}
          {policy?.active_promotion_id ? (
            <span className="muted">
              policy {shortId(policy.active_promotion_id)}
            </span>
          ) : null}
          {isLoading ? <span className="badge">Loading policy</span> : null}
        </div>
        <p className="muted">
          Promotion changes Calibration Lab reports for this evaluation. It does
          not rewrite the base evaluation, rerun audit history, or outcome reviews.
        </p>
      </div>
      <button
        className="button"
        disabled={!canReset || mutation.resetIsPending}
        onClick={onResetPolicy}
        type="button"
      >
        <RefreshCcw aria-hidden size={16} />
        {resetPolicyArmed ? 'Confirm reset' : 'Reset to base evaluation'}
      </button>
    </div>
  );
}

function VersionPolicyHistory({
  events,
}: {
  events: CalibrationEvaluationPromotionResponse[];
}) {
  if (events.length === 0) {
    return null;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Policy event</th>
            <th>Action</th>
            <th>Source</th>
            <th>Reason</th>
            <th>By</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id ?? `${event.action}-${event.promoted_at}`}>
              <td>{formatDateTime(event.promoted_at)}</td>
              <td>
                <span className={`badge ${promotionActionTone(event.action)}`}>
                  {labelize(event.action)}
                </span>
              </td>
              <td>
                {event.promoted_rerun_id ? (
                  <IdChip value={event.promoted_rerun_id} />
                ) : (
                  'Base canonical'
                )}
              </td>
              <td>{labelize(event.reason)}</td>
              <td>{event.promoted_by_user_id ?? 'n/a'}</td>
              <td>{event.notes ?? 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RerunHistoryTable({
  armedPromotionRerunId,
  evaluation,
  mutationPending,
  onPromoteRerun,
  policy,
  rows,
}: {
  armedPromotionRerunId: string | null;
  evaluation: CalibrationEvaluationResponse;
  mutationPending: boolean;
  onPromoteRerun: (rerunId: string | null) => void;
  policy?: CalibrationEvaluationVersionPolicyResponse;
  rows: CalibrationEvaluationRerunResponse[];
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Requested</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Result</th>
            <th>MFE delta</th>
            <th>MAE delta</th>
            <th>Change</th>
            <th>Warnings</th>
            <th>Error</th>
            <th>Active</th>
            <th>Promote</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const changed = rerunChanged(row);
            const isActive = policy?.active_rerun_id === row.id;
            const reviewed = Boolean(evaluation.outcome_review_id);
            const canPromote =
              row.status === 'completed' &&
              !reviewed &&
              !isActive &&
              !mutationPending;
            return (
              <tr key={row.id ?? `${row.requested_at}-${row.reason}`}>
                <td>{formatDateTime(row.requested_at)}</td>
                <td>{labelize(row.reason)}</td>
                <td>
                  <span className={`badge ${row.status === 'completed' ? 'constructive' : 'risk'}`}>
                    {row.status}
                  </span>
                </td>
                <td>
                  {row.status === 'completed' ? (
                    <span>
                      {row.diff.canonical_result ?? 'n/a'} -&gt;{' '}
                      {row.diff.rerun_result ?? row.result ?? 'n/a'}
                    </span>
                  ) : (
                    'n/a'
                  )}
                </td>
                <td>{formatSignedPercent(row.diff.mfe_delta ?? null)}</td>
                <td>{formatSignedPercent(row.diff.mae_delta ?? null)}</td>
                <td>
                  <span className={`badge ${changed ? 'warning' : 'constructive'}`}>
                    {changed ? 'changed' : 'unchanged'}
                  </span>
                </td>
                <td>
                  <RerunWarningDelta row={row} />
                </td>
                <td>{row.error_message ?? 'n/a'}</td>
                <td>
                  {isActive ? (
                    <span className="badge constructive">active</span>
                  ) : (
                    <span className="muted">not active</span>
                  )}
                </td>
                <td>
                  <button
                    className="button ghost"
                    disabled={!canPromote}
                    onClick={() => onPromoteRerun(row.id)}
                    type="button"
                  >
                    <CheckCircle2 aria-hidden size={16} />
                    {armedPromotionRerunId === row.id
                      ? 'Confirm promote'
                      : 'Promote'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RerunWarningDelta({
  row,
}: {
  row: CalibrationEvaluationRerunResponse;
}) {
  const added = row.diff.warnings_added ?? [];
  const removed = row.diff.warnings_removed ?? [];
  if (added.length === 0 && removed.length === 0) {
    return <span className="muted">none</span>;
  }
  return (
    <div className="top-strip-meta">
      {added.map((warning) => (
        <span className="badge warning" key={`added-${warning}`}>
          + {warning}
        </span>
      ))}
      {removed.map((warning) => (
        <span className="badge degraded" key={`removed-${warning}`}>
          - {warning}
        </span>
      ))}
    </div>
  );
}

function SymbolCalibrationView({
  symbol,
  windowDays,
  lookbackDays,
  quickSymbols,
  query,
  onSetSymbol,
  onSetWindowDays,
  onSetLookbackDays,
  onLoad,
  onPrepareBatch,
}: {
  symbol: string;
  windowDays: (typeof WINDOW_PRESETS)[number];
  lookbackDays: (typeof LOOKBACK_PRESETS)[number];
  quickSymbols: string[];
  query: {
    data?: SymbolCalibrationReportResponse;
    error: unknown;
    isError: boolean;
    isFetching: boolean;
    isLoading: boolean;
  };
  onSetSymbol: (value: string) => void;
  onSetWindowDays: (value: (typeof WINDOW_PRESETS)[number]) => void;
  onSetLookbackDays: (value: (typeof LOOKBACK_PRESETS)[number]) => void;
  onLoad: () => void;
  onPrepareBatch: (report: SymbolCalibrationReportResponse) => void;
}) {
  const report = query.data;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLoad();
  }

  return (
    <BentoGrid>
      <Panel className="span-12" title="Symbol Calibration">
        <form className="stack" onSubmit={submit}>
          <div className="grid three">
            <label className="label">
              Symbol
              <input
                className="input"
                list="symbol-calibration-symbols"
                onChange={(event) => onSetSymbol(event.target.value)}
                placeholder="BTC/USDT"
                value={symbol}
              />
              <datalist id="symbol-calibration-symbols">
                {quickSymbols.map((quickSymbol) => (
                  <option key={quickSymbol} value={quickSymbol} />
                ))}
              </datalist>
            </label>
            <div className="segmented-control" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {WINDOW_PRESETS.map((preset) => (
                <button
                  className={`segment-button${windowDays === preset ? ' active' : ''}`}
                  key={preset}
                  onClick={() => onSetWindowDays(preset)}
                  type="button"
                >
                  {preset}d
                </button>
              ))}
            </div>
            <div className="segmented-control" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {LOOKBACK_PRESETS.map((preset) => (
                <button
                  className={`segment-button${lookbackDays === preset ? ' active' : ''}`}
                  key={preset}
                  onClick={() => onSetLookbackDays(preset)}
                  type="button"
                >
                  {preset}d
                </button>
              ))}
            </div>
          </div>
          {quickSymbols.length > 0 ? (
            <div className="symbol-chip-row">
              {quickSymbols.map((quickSymbol) => (
                <button
                  className={`symbol-chip${quickSymbol === symbol ? ' active' : ''}`}
                  key={quickSymbol}
                  onClick={() => onSetSymbol(quickSymbol)}
                  type="button"
                >
                  {quickSymbol}
                </button>
              ))}
            </div>
          ) : null}
          <div className="top-strip-meta">
            <button
              className="button primary"
              disabled={!symbol.trim() || query.isFetching}
              type="submit"
            >
              <Search aria-hidden size={16} />
              {query.isFetching ? 'Loading' : 'Load report'}
            </button>
            {report && report.coverage.missing_evaluation_count > 0 ? (
              <button
                className="button"
                onClick={() => onPrepareBatch(report)}
                type="button"
              >
                <Play aria-hidden size={16} />
                Prepare batch evaluation
              </button>
            ) : null}
          </div>
          {query.isError ? (
            <span className="badge risk">{errorMessage(query.error)}</span>
          ) : null}
        </form>
      </Panel>

      {query.isLoading && !report ? <LoadingState /> : null}
      {!report && !query.isFetching && !query.isError ? (
        <Panel className="span-12" title="Report">
          <EmptyState label="No symbol calibration report loaded." />
        </Panel>
      ) : null}
      {report ? (
        <>
          <Panel className="span-4" title="Coverage">
            <div className="stack">
              <DataPair label="Period" value={`${formatDate(report.period_start)} to ${formatDate(report.period_end)}`} />
              <DataPair label="Matured" value={report.coverage.matured_thesis_count} />
              <DataPair label="Evaluated" value={report.coverage.evaluated_count} />
              <DataPair label="Missing" value={report.coverage.missing_evaluation_count} />
              <DataPair label="Coverage" value={formatPercent(report.coverage.coverage_pct)} />
            </div>
          </Panel>
          <Panel className="span-4" title="Stance">
            <div className="stack">
              <DataPair
                label="Consensus"
                value={
                  <span className={`badge ${stanceTone(report.stance.consensus_stance)}`}>
                    {report.stance.consensus_stance}
                  </span>
                }
              />
              <DataPair label="Conflict" value={formatPercent(report.stance.conflict_rate)} />
              <div className="top-strip-meta">
                {Object.entries(report.stance.stance_counts).map(([stance, count]) => (
                  <span className={`badge ${stanceTone(stance)}`} key={stance}>
                    {stance} {count}
                  </span>
                ))}
              </div>
            </div>
          </Panel>
          <Panel className="span-4" title="Outcome">
            <div className="stack">
              <DataPair
                label="Verdict"
                value={
                  <span className={`badge ${verdictTone(report.outcome.verdict)}`}>
                    {report.outcome.verdict}
                  </span>
                }
              />
              <DataPair label="Hit rate" value={formatPercent(report.outcome.hit_rate)} />
              <DataPair label="Invalidation" value={formatPercent(report.outcome.invalidation_rate)} />
              <DataPair label="Representative return" value={formatPercent(report.outcome.representative_return)} />
              <DataPair label="Avg MFE" value={formatPercent(report.outcome.avg_mfe)} />
              <DataPair label="Avg MAE" value={formatPercent(report.outcome.avg_mae)} />
            </div>
          </Panel>
          <Panel className="span-12" title="Supporting Rows">
            <SymbolCalibrationRowsTable rows={report.rows} />
          </Panel>
        </>
      ) : null}
    </BentoGrid>
  );
}

function AgentCalibrationView({
  symbol,
  windowDays,
  lookbackDays,
  quickSymbols,
  query,
  onSetSymbol,
  onSetWindowDays,
  onSetLookbackDays,
  onLoad,
}: {
  symbol: string;
  windowDays: (typeof WINDOW_PRESETS)[number];
  lookbackDays: (typeof LOOKBACK_PRESETS)[number];
  quickSymbols: string[];
  query: {
    data?: AgentCalibrationReportResponse;
    error: unknown;
    isError: boolean;
    isFetching: boolean;
    isLoading: boolean;
  };
  onSetSymbol: (value: string) => void;
  onSetWindowDays: (value: (typeof WINDOW_PRESETS)[number]) => void;
  onSetLookbackDays: (value: (typeof LOOKBACK_PRESETS)[number]) => void;
  onLoad: () => void;
}) {
  const report = query.data;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLoad();
  }

  return (
    <BentoGrid>
      <Panel className="span-12" title="Agent Alignment Proxy">
        <form className="stack" onSubmit={submit}>
          <div className="grid three">
            <label className="label">
              Symbol
              <input
                className="input"
                list="agent-calibration-symbols"
                onChange={(event) => onSetSymbol(event.target.value)}
                placeholder="BTC/USDT"
                value={symbol}
              />
              <datalist id="agent-calibration-symbols">
                {quickSymbols.map((quickSymbol) => (
                  <option key={quickSymbol} value={quickSymbol} />
                ))}
              </datalist>
            </label>
            <div className="segmented-control" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {WINDOW_PRESETS.map((preset) => (
                <button
                  className={`segment-button${windowDays === preset ? ' active' : ''}`}
                  key={preset}
                  onClick={() => onSetWindowDays(preset)}
                  type="button"
                >
                  {preset}d
                </button>
              ))}
            </div>
            <div className="segmented-control" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {LOOKBACK_PRESETS.map((preset) => (
                <button
                  className={`segment-button${lookbackDays === preset ? ' active' : ''}`}
                  key={preset}
                  onClick={() => onSetLookbackDays(preset)}
                  type="button"
                >
                  {preset}d
                </button>
              ))}
            </div>
          </div>
          {quickSymbols.length > 0 ? (
            <div className="symbol-chip-row">
              {quickSymbols.map((quickSymbol) => (
                <button
                  className={`symbol-chip${quickSymbol === symbol ? ' active' : ''}`}
                  key={quickSymbol}
                  onClick={() => onSetSymbol(quickSymbol)}
                  type="button"
                >
                  {quickSymbol}
                </button>
              ))}
            </div>
          ) : null}
          <div className="top-strip-meta">
            <button
              className="button primary"
              disabled={query.isFetching}
              type="submit"
            >
              <Search aria-hidden size={16} />
              {query.isFetching ? 'Loading' : 'Load report'}
            </button>
            {report ? (
              <span className="badge primary">
                Contribution signal, not broker PnL
              </span>
            ) : null}
          </div>
          {query.isError ? (
            <span className="badge risk">{errorMessage(query.error)}</span>
          ) : null}
        </form>
      </Panel>

      {query.isLoading && !report ? <LoadingState /> : null}
      {!report && !query.isFetching && !query.isError ? (
        <Panel className="span-12" title="Report">
          <EmptyState label="No agent calibration report loaded." />
        </Panel>
      ) : null}
      {report ? (
        <>
          <Panel className="span-4" title="Coverage">
            <div className="stack">
              <DataPair label="Period" value={`${formatDate(report.period_start)} to ${formatDate(report.period_end)}`} />
              <DataPair label="Opinions" value={report.coverage.opinion_count} />
              <DataPair label="Eligible" value={report.coverage.eligible_opinion_count} />
              <DataPair label="Scored" value={report.coverage.scored_opinion_count} />
              <DataPair label="Missing evaluation" value={report.coverage.missing_evaluation_count} />
              <DataPair label="Unlinked" value={report.coverage.unlinked_opinion_count} />
              <DataPair label="Coverage" value={formatPercent(report.coverage.coverage_pct)} />
            </div>
          </Panel>
          <Panel className="span-8" title="Contribution Signal">
            <AgentCalibrationAgentsTable agents={report.agents} />
          </Panel>
          <Panel className="span-12" title="Supporting Rows">
            <AgentCalibrationRowsTable rows={report.rows} />
          </Panel>
        </>
      ) : null}
    </BentoGrid>
  );
}

function SelectedThesisSummary({ thesis }: { thesis: ThesisResponse }) {
  return (
    <div className="state-card">
      <strong>{thesis.symbol}</strong>
      <span>{thesis.summary.action_summary || thesis.thesis_text || 'No summary.'}</span>
      <div className="top-strip-meta">
        <span className="badge">{thesis.setup_type || 'setup'}</span>
        <span className="badge primary">{thesis.direction || 'watch'}</span>
        {thesis.id ? <IdChip value={thesis.id} /> : null}
      </div>
    </div>
  );
}

function BatchSummaryChips({
  previewSummary,
  applySummary,
}: {
  previewSummary?: {
    candidate: number;
    existing: number;
    not_mature: number;
    invalid_thesis: number;
  };
  applySummary?: {
    created: number;
    existing: number;
    skipped: number;
    failed: number;
  };
}) {
  if (!previewSummary && !applySummary) {
    return null;
  }
  return (
    <div className="top-strip-meta">
      {previewSummary ? (
        <>
          <span className="badge constructive">candidate {previewSummary.candidate}</span>
          <span className="badge primary">existing {previewSummary.existing}</span>
          <span className="badge warning">not mature {previewSummary.not_mature}</span>
          <span className="badge risk">invalid {previewSummary.invalid_thesis}</span>
        </>
      ) : null}
      {applySummary ? (
        <>
          <span className="badge constructive">created {applySummary.created}</span>
          <span className="badge primary">existing {applySummary.existing}</span>
          <span className="badge warning">skipped {applySummary.skipped}</span>
          <span className="badge risk">failed {applySummary.failed}</span>
        </>
      ) : null}
    </div>
  );
}

function BatchRowsTable({
  rows,
}: {
  rows: Array<
    MaturedEvaluationPreviewRowResponse | MaturedEvaluationApplyRowResponse
  >;
}) {
  if (rows.length === 0) {
    return <EmptyState label="No batch preview yet." />;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Thesis</th>
            <th>Symbol</th>
            <th>Window</th>
            <th>Status</th>
            <th>Reason</th>
            <th>Evaluation</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.thesis_id}-${row.window_days}-${row.status}`}>
              <td>{row.thesis_id ? <IdChip value={row.thesis_id} /> : 'n/a'}</td>
              <td>{row.symbol || 'n/a'}</td>
              <td>
                {row.window_days}d
                <br />
                <span className="muted">
                  {formatDate(row.evaluation_start)} to {formatDate(row.evaluation_end)}
                </span>
              </td>
              <td>
                <span className={`badge ${batchStatusTone(row.status)}`}>
                  {row.status.replaceAll('_', ' ')}
                </span>
              </td>
              <td>{row.reason ? row.reason.replaceAll('_', ' ') : 'n/a'}</td>
              <td>{row.evaluation_id ? <IdChip value={row.evaluation_id} /> : 'n/a'}</td>
              <td>{batchRowMessage(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SymbolCalibrationRowsTable({
  rows,
}: {
  rows: SymbolCalibrationRowResponse[];
}) {
  if (rows.length === 0) {
    return <EmptyState label="No supporting rows in this report." />;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Thesis</th>
            <th>Symbol</th>
            <th>Stance</th>
            <th>Direction</th>
            <th>Confidence</th>
            <th>Status</th>
            <th>Evaluation</th>
            <th>Source</th>
            <th>Result</th>
            <th>MFE</th>
            <th>MAE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.thesis_id}-${row.status}`}>
              <td>{formatDateTime(row.created_at)}</td>
              <td>{row.thesis_id ? <IdChip value={row.thesis_id} /> : 'n/a'}</td>
              <td>{row.symbol}</td>
              <td>
                <span className={`badge ${stanceTone(row.stance)}`}>
                  {row.stance}
                </span>
              </td>
              <td>{row.direction || 'n/a'}</td>
              <td>{formatPercent(row.confidence)}</td>
              <td>
                <span className={`badge ${symbolStatusTone(row.status)}`}>
                  {row.status.replaceAll('_', ' ')}
                </span>
              </td>
              <td>{row.evaluation_id ? <IdChip value={row.evaluation_id} /> : 'n/a'}</td>
              <td>
                {row.active_source ? (
                  <span className={`badge ${activeSourceTone(row.active_source)}`}>
                    {sourceLabel(row.active_source)}
                  </span>
                ) : (
                  'n/a'
                )}
              </td>
              <td>
                {row.result ? (
                  <span className={`badge ${resultTone(row.result)}`}>
                    {row.result}
                  </span>
                ) : (
                  'n/a'
                )}
              </td>
              <td>{formatPercent(row.max_favorable_excursion)}</td>
              <td>{formatPercent(row.max_adverse_excursion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentCalibrationAgentsTable({
  agents,
}: {
  agents: AgentCalibrationAgentResponse[];
}) {
  if (agents.length === 0) {
    return <EmptyState label="Insufficient data for agent-role metrics." />;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Agent role</th>
            <th>Display name</th>
            <th>Eligible</th>
            <th>Coverage</th>
            <th>Supports</th>
            <th>Opposes</th>
            <th>Alignment success</th>
            <th>Contrarian success</th>
            <th>Avg confidence</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.agent_role}>
              <td>{agent.agent_role}</td>
              <td>
                {agent.display_name}
                {agent.agent_names.length > 1 ? (
                  <span className="muted"> +{agent.agent_names.length - 1}</span>
                ) : null}
              </td>
              <td>{agent.eligible_opinion_count}</td>
              <td>{formatPercent(agent.coverage_pct)}</td>
              <td>{agent.supports_final_count}</td>
              <td>{agent.opposes_final_count}</td>
              <td>{formatPercent(agent.alignment_success_rate)}</td>
              <td>{formatPercent(agent.contrarian_success_rate)}</td>
              <td>{formatPercent(agent.avg_confidence)}</td>
              <td>
                <span className={`badge ${agentVerdictTone(agent.verdict)}`}>
                  {labelize(agent.verdict)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentCalibrationRowsTable({
  rows,
}: {
  rows: AgentCalibrationRowResponse[];
}) {
  if (rows.length === 0) {
    return <EmptyState label="No supporting rows in this report." />;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Run</th>
            <th>Thesis</th>
            <th>Symbol</th>
            <th>Agent stance</th>
            <th>Final direction</th>
            <th>Relation</th>
            <th>Evaluation result</th>
            <th>Source</th>
            <th>Outcome bucket</th>
            <th>Confidence</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.research_run_id ?? 'run'}-${row.agent_role}-${row.thesis_id ?? 'unlinked'}-${row.created_at ?? ''}`}
            >
              <td>
                {row.agent_name}
                <br />
                <span className="muted">{row.agent_role}</span>
              </td>
              <td>{row.research_run_id ? <IdChip value={row.research_run_id} /> : 'n/a'}</td>
              <td>{row.thesis_id ? <IdChip value={row.thesis_id} /> : 'n/a'}</td>
              <td>{row.symbol ?? 'n/a'}</td>
              <td>
                <span className={`badge ${stanceTone(row.agent_stance)}`}>
                  {row.agent_stance}
                </span>
              </td>
              <td>
                <span className={`badge ${stanceTone(row.thesis_direction)}`}>
                  {row.thesis_direction}
                </span>
              </td>
              <td>
                <span className={`badge ${relationTone(row.relation_to_final)}`}>
                  {labelize(row.relation_to_final)}
                </span>
              </td>
              <td>
                {row.evaluation_result ? (
                  <span className={`badge ${resultTone(row.evaluation_result)}`}>
                    {row.evaluation_result}
                  </span>
                ) : (
                  'n/a'
                )}
              </td>
              <td>
                {row.active_source ? (
                  <span className={`badge ${activeSourceTone(row.active_source)}`}>
                    {sourceLabel(row.active_source)}
                  </span>
                ) : (
                  'n/a'
                )}
              </td>
              <td>
                <span className={`badge ${outcomeBucketTone(row.outcome_bucket)}`}>
                  {labelize(row.outcome_bucket)}
                </span>
              </td>
              <td>{formatPercent(row.confidence)}</td>
              <td>{formatDateTime(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvaluationDetail({
  evaluation,
}: {
  evaluation: CalibrationEvaluationResponse;
}) {
  return (
    <div className="stack">
      <div className="top-strip-meta">
        <span className={`badge ${resultTone(evaluation.result)}`}>
          {evaluation.result}
        </span>
        <span className={evaluation.calendar_mature ? 'badge constructive' : 'badge warning'}>
          {evaluation.calendar_mature ? 'Mature window' : 'Incomplete window'}
        </span>
        {evaluation.warnings.map((warning) => (
          <span className="badge warning" key={warning}>
            {warning}
          </span>
        ))}
      </div>
      <div className="grid two">
        <DataPair label="Thesis" value={<IdChip value={evaluation.thesis_id} />} />
        <DataPair label="Window" value={`${evaluation.window_days}d`} />
        <DataPair label="Start" value={formatDate(evaluation.evaluation_start)} />
        <DataPair label="End" value={formatDate(evaluation.evaluation_end)} />
        <DataPair label="MFE" value={formatPercent(evaluation.max_favorable_excursion)} />
        <DataPair label="MAE" value={formatPercent(evaluation.max_adverse_excursion)} />
      </div>
      <div className="grid three">
        {Object.entries(evaluation.evidence).slice(0, 9).map(([key, value]) => (
          <div className="state-card" key={key}>
            <strong>{labelize(key)}</strong>
            <span>{formatEvidenceValue(value)}</span>
          </div>
        ))}
      </div>
      <details className="scenario-debug">
        <summary>Raw JSON</summary>
        <JsonView value={evaluation} />
      </details>
    </div>
  );
}

function BlockerBadges({
  blockers,
}: {
  blockers: CalibrationRecordReviewBlocker[];
}) {
  return (
    <div className="top-strip-meta">
      {blockers.map((blocker) => (
        <span className="badge warning" key={blocker}>
          {blocker.replaceAll('_', ' ')}
        </span>
      ))}
    </div>
  );
}

function defaultReviewNote(evaluation: CalibrationEvaluationResponse): string {
  return `Auto-recorded from Calibration Lab evaluation ${evaluation.id ?? 'unknown'} over ${evaluation.window_days} day(s). Result: ${evaluation.result}. MFE: ${formatPercent(evaluation.max_favorable_excursion)}. MAE: ${formatPercent(evaluation.max_adverse_excursion)}.`;
}

function createClientIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `rerun-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rerunChanged(row: CalibrationEvaluationRerunResponse): boolean {
  const diff = row.diff;
  return Boolean(
    diff.result_changed ||
      diff.invalidated_changed ||
      nonZero(diff.mfe_delta) ||
      nonZero(diff.mae_delta) ||
      nonZero(diff.start_price_delta) ||
      nonZero(diff.end_price_delta) ||
      diff.warnings_added?.length ||
      diff.warnings_removed?.length,
  );
}

function nonZero(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Math.abs(value) > 0;
}

function formatSignedPercent(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatPercent(value)}`;
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatEvidenceValue(value: unknown): string {
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'string') {
    return value.includes('T') ? formatDateTime(value) : value;
  }
  return JSON.stringify(value);
}

function labelize(value: string): string {
  return value.replaceAll('_', ' ');
}

function parseWindowPreset(
  value: string | null,
  fallback: (typeof WINDOW_PRESETS)[number],
): (typeof WINDOW_PRESETS)[number] {
  const parsed = Number(value);
  return WINDOW_PRESETS.includes(parsed as (typeof WINDOW_PRESETS)[number])
    ? (parsed as (typeof WINDOW_PRESETS)[number])
    : fallback;
}

function parseLookbackPreset(
  value: string | null,
  fallback: (typeof LOOKBACK_PRESETS)[number],
): (typeof LOOKBACK_PRESETS)[number] {
  const parsed = Number(value);
  return LOOKBACK_PRESETS.includes(parsed as (typeof LOOKBACK_PRESETS)[number])
    ? (parsed as (typeof LOOKBACK_PRESETS)[number])
    : fallback;
}

function stanceTone(
  stance: string | null | undefined,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (stance === 'bullish') {
    return 'constructive';
  }
  if (stance === 'bearish') {
    return 'risk';
  }
  if (stance === 'defensive') {
    return 'warning';
  }
  if (stance === 'unknown' || stance === 'mixed') {
    return 'degraded';
  }
  return 'primary';
}

function verdictTone(
  verdict: string | null | undefined,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (verdict === 'correct') {
    return 'constructive';
  }
  if (verdict === 'incorrect') {
    return 'risk';
  }
  if (verdict === 'inconclusive') {
    return 'degraded';
  }
  return 'primary';
}

function agentVerdictTone(
  verdict: string | null | undefined,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (verdict === 'strong_aligned' || verdict === 'promising') {
    return 'constructive';
  }
  if (verdict === 'contrarian_signal') {
    return 'warning';
  }
  if (verdict === 'insufficient_data') {
    return 'degraded';
  }
  return 'primary';
}

function relationTone(
  relation: string,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (relation === 'supports_final') {
    return 'constructive';
  }
  if (relation === 'opposes_final') {
    return 'warning';
  }
  return 'degraded';
}

function outcomeBucketTone(
  bucket: string,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (bucket === 'supported_success' || bucket === 'contrarian_success') {
    return 'constructive';
  }
  if (bucket === 'supported_failure' || bucket === 'contrarian_failure') {
    return 'risk';
  }
  return 'degraded';
}

function symbolStatusTone(
  status: string,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (status === 'evaluated') {
    return 'constructive';
  }
  if (status === 'missing_evaluation') {
    return 'warning';
  }
  if (status === 'invalid_thesis') {
    return 'risk';
  }
  return 'primary';
}

function activeSourceTone(
  source: string | null | undefined,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  return source === 'promoted_rerun' ? 'warning' : 'primary';
}

function promotionActionTone(
  action: string,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  return action === 'promote_rerun' ? 'warning' : 'primary';
}

function sourceLabel(source: string | null | undefined): string {
  if (source === 'promoted_rerun') {
    return 'promoted rerun';
  }
  return 'base canonical';
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

function resultTone(
  result: string | null | undefined,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (result === 'hit_target') {
    return 'constructive';
  }
  if (result === 'invalidated') {
    return 'risk';
  }
  if (result === 'mixed' || result === 'expired') {
    return 'warning';
  }
  if (result === 'unknown') {
    return 'degraded';
  }
  return 'primary';
}

function batchStatusTone(
  status: string,
): 'constructive' | 'risk' | 'warning' | 'degraded' | 'primary' {
  if (status === 'candidate' || status === 'created') {
    return 'constructive';
  }
  if (status === 'failed' || status === 'invalid_thesis') {
    return 'risk';
  }
  if (status === 'not_mature' || status === 'skipped') {
    return 'warning';
  }
  return 'primary';
}

function batchRowMessage(
  row: MaturedEvaluationPreviewRowResponse | MaturedEvaluationApplyRowResponse,
): string {
  if (!('message' in row)) {
    return formatDate(row.created_at);
  }
  return row.message || row.result || formatDate(row.created_at);
}
