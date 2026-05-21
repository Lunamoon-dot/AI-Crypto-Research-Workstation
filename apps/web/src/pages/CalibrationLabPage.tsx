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
  ThesisResponse,
} from '@/types';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';

const WINDOW_PRESETS = [7, 14, 30] as const;

export function CalibrationLabPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const queryThesisId = searchParams.get('thesis_id') ?? '';
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
  const selectedThesis =
    thesesQuery.data?.find((thesis) => thesis.id === selectedThesisId) ?? null;

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
    </main>
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
