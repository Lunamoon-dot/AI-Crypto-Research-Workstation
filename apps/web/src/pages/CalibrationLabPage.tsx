import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, History, Play, Search, ShieldAlert, Target } from 'lucide-react';
import { BentoGrid, DataPair } from '@/components/research/bento';
import { IdChip } from '@/components/research/badges';
import { HeaderStats } from '@/components/research/header-stats';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import {
  applyMaturedEvaluations,
  evaluateThesis,
  getSymbolCalibrationReport,
  listCalibrationEvaluations,
  previewMaturedEvaluations,
  recordCalibrationOutcomeReview,
} from '@/services/calibration';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { listTheses } from '@/services/theses';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type {
  CalibrationEvaluationResponse,
  CalibrationRecordReviewBlocker,
  MaturedEvaluationApplyRowResponse,
  MaturedEvaluationPreviewRowResponse,
  SymbolCalibrationReportResponse,
  SymbolCalibrationRowResponse,
  ThesisResponse,
} from '@/types';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';

const WINDOW_PRESETS = [7, 14, 30] as const;
const LOOKBACK_PRESETS = [30, 60, 90] as const;
type CalibrationMode = 'single' | 'batch' | 'symbol';

export function CalibrationLabPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryThesisId = searchParams.get('thesis_id') ?? '';
  const queryMode = searchParams.get('mode');
  const activeMode: CalibrationMode = queryThesisId
    ? 'single'
    : queryMode === 'batch' || queryMode === 'symbol'
      ? queryMode
      : 'single';
  const [selectedThesisId, setSelectedThesisId] = useState(queryThesisId);
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_PRESETS)[number]>(14);
  const [activeEvaluation, setActiveEvaluation] =
    useState<CalibrationEvaluationResponse | null>(null);
  const [createdState, setCreatedState] = useState<boolean | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
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

  useEffect(() => {
    setSelectedThesisId(queryThesisId);
    setActiveEvaluation(null);
    setCreatedState(null);
    setReviewNotes('');
  }, [queryThesisId]);

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
        queryKey: queryKeys.performanceRoot(),
      });
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
        style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
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

        <Panel className="span-7" title={selectedThesisId ? 'Thesis Evaluation History' : 'Recent Evaluations'}>
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
