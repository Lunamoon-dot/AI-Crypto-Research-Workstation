import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  FileText,
  FlaskConical,
  History,
  Square,
} from 'lucide-react';
import { cancelJob, listResearchRuns } from '@/services/research-runs';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { IdChip, StatusBadge } from '@/components/research/badges';
import { BentoGrid } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { errorMessage } from '@/services/client';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  filterResearchRunsByHistoryFilters,
  lifecycleStatus,
} from '@/pages/research-history-filters';
import type { ResearchRunResponse } from '@/types';

export function ResearchHistoryPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const fixedWorkspaceSymbol = auth.fixedWorkspaceSymbol();
  const [startedDate, setStartedDate] = useState('');
  const [symbol, setSymbol] = useState('');
  const effectiveSymbolFilter = fixedWorkspaceSymbol ?? symbol;
  const query = useQuery({
    queryKey: queryKeys.researchRuns({
      limit: 100,
      symbol: fixedWorkspaceSymbol ?? undefined,
    }),
    queryFn: () =>
      listResearchRuns(
        { limit: 100, symbol: fixedWorkspaceSymbol ?? undefined },
        auth,
      ),
    refetchInterval: 5000,
  });
  const cancelQueuedMutation = useMutation({
    mutationFn: (runId: string) => cancelJob(runId, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.researchRunsRoot(),
      });
    },
  });

  const runs = useMemo(() => {
    return filterResearchRunsByHistoryFilters(query.data ?? [], {
      search: '',
      startedDate,
      status: '',
      symbol: effectiveSymbolFilter,
    });
  }, [effectiveSymbolFilter, query.data, startedDate]);

  const metrics = useMemo(() => summarizeRuns(query.data ?? []), [query.data]);
  const historyFilters = (
    <div className="scenario-filter-controls research-history-panel-filters">
      <label className="scenario-filter-label">
        Date
        <div className="history-date-filter-row">
          <input
            className="input"
            type="date"
            value={startedDate}
            onChange={(event) => setStartedDate(event.target.value)}
          />
          <button
            className="button ghost history-date-all-button"
            onClick={() => setStartedDate('')}
            type="button"
          >All</button>
        </div>
      </label>
      {!fixedWorkspaceSymbol ? (
        <label className="scenario-filter-label">
          Symbol
          <input
            className="input"
            placeholder="BTC, ETH, SOL"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </label>
      ) : (
        <div className="scenario-filter-label research-history-workspace-symbol-filter">
          Workspace symbol
          <span className="badge primary">{fixedWorkspaceSymbol}</span>
        </div>
      )}
    </div>
  );

  return (
    <main className="page">
      <PageHeader
        eyebrow="03 Research History"
        title="Research history"
        description="Manage research runs, persisted artifacts, thesis outputs, and failed or active jobs."
        action={
          <HeaderStats
            stats={[
              {
                icon: <History aria-hidden size={14} />,
                label: 'Runs',
                meta: 'Latest 100',
                tone: 'primary',
                value: query.isLoading ? '...' : metrics.total,
              },
              {
                icon: <Activity aria-hidden size={14} />,
                label: 'Active',
                meta: 'Queued or running',
                tone: 'warning',
                value: query.isLoading ? '...' : metrics.active,
              },
              {
                icon: <CheckCircle2 aria-hidden size={14} />,
                label: 'Completed',
                meta: 'Clean or degraded',
                tone: 'constructive',
                value: query.isLoading ? '...' : metrics.completed,
              },
              {
                icon: <AlertTriangle aria-hidden size={14} />,
                label: 'Attention',
                meta: 'Failed or degraded',
                tone: metrics.attention > 0 ? 'risk' : 'constructive',
                value: query.isLoading ? '...' : metrics.attention,
              },
            ]}
          />
        }
      />

      <BentoGrid>
        <Panel
          className="span-12 research-history-results-panel"
          title="Run results"
          description={`${runs.length} shown`}
          action={historyFilters}
        >
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState error={query.error} /> : null}
          {query.data?.length === 0 ? (
            <EmptyState label="No research runs found." />
          ) : null}
          {!query.isLoading && runs.length === 0 && (query.data?.length ?? 0) > 0 ? (
            <EmptyState label="No runs match the current filters." />
          ) : null}
          {runs.length > 0 ? (
            <div className="table-wrap">
              <table className="table research-history-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Result</th>
                    <th>Data quality</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const runId = run.run_id ?? run.id ?? '';
                    const cancelPending =
                      cancelQueuedMutation.isPending &&
                      cancelQueuedMutation.variables === runId;
                    const stopRequested = Boolean(
                      run.cancellation_requested_at,
                    );
                    const cancelError =
                      cancelQueuedMutation.isError &&
                      cancelQueuedMutation.variables === runId
                        ? errorMessage(cancelQueuedMutation.error)
                        : null;

                    return (
                      <tr key={run.id ?? run.run_id ?? `${run.symbol}-${run.started_at}`}>
                        <td>
                          <div className="stack small">
                            <Link to={routes.researchRun(runId)}>
                              <strong>{run.symbol}</strong>
                            </Link>
                            <span className="muted">
                              {run.market_type} | {run.timeframe ?? 'n/a'}
                            </span>
                            <IdChip value={runId} />
                          </div>
                        </td>
                        <td>
                          <StatusBadge value={lifecycleStatus(run.status)} />
                        </td>
                        <td>{formatDateTime(run.started_at)}</td>
                        <td>{formatDateTime(run.completed_at)}</td>
                        <td>
                          <div className="stack small">
                            <span>
                              Thesis <IdChip value={run.thesis_id} />
                            </span>
                            <span className="muted">
                              Signal <IdChip value={run.signal_snapshot_id} />
                            </span>
                          </div>
                        </td>
                        <td>
                          <QualitySummary run={run} />
                        </td>
                        <td>
                          <div className="top-strip-meta">
                            <Link className="button" to={routes.researchRun(runId)}>
                              <FlaskConical aria-hidden size={15} />
                              Open run
                            </Link>
                            {canCancelRun(run) ? (
                              <button
                                aria-label={`Cancel run ${runId}`}
                                className="button risk"
                                disabled={cancelPending || stopRequested}
                                onClick={() => cancelQueuedMutation.mutate(runId)}
                                type="button"
                              >
                                {run.status === 'running' ? (
                                  <Square aria-hidden size={15} />
                                ) : (
                                  <Ban aria-hidden size={15} />
                                )}
                                {cancelPending
                                  ? 'Stopping'
                                  : stopRequested
                                    ? 'Stop requested'
                                    : run.status === 'running'
                                      ? 'Stop run'
                                      : 'Cancel queued'}
                              </button>
                            ) : null}
                            {run.thesis_id ? (
                              <Link className="button" to={routes.thesis(run.thesis_id)}>
                                <FileText aria-hidden size={15} />
                                Thesis
                              </Link>
                            ) : null}
                            {cancelError ? (
                              <span className="badge risk">{cancelError}</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      </BentoGrid>
    </main>
  );
}

function QualitySummary({ run }: { run: ResearchRunResponse }) {
  const degraded = run.degradation_reasons.length;
  const missingCore = run.missing_core_data.length;
  const missingOptional = run.missing_optional_data.length;
  if (degraded === 0 && missingCore === 0 && missingOptional === 0) {
    return <span className="badge constructive">clean</span>;
  }
  return (
    <div className="stack small">
      {degraded > 0 ? (
        <span className="badge degraded">{degraded} degradation</span>
      ) : null}
      {missingCore > 0 ? (
        <span className="badge risk">{missingCore} core missing</span>
      ) : null}
      {missingOptional > 0 ? (
        <span className="badge warning">{missingOptional} optional missing</span>
      ) : null}
    </div>
  );
}

function summarizeRuns(runs: ResearchRunResponse[]) {
  return runs.reduce(
    (summary, run) => {
      summary.total += 1;
      const lifecycle = lifecycleStatus(run.status);
      if (isActiveRun(lifecycle)) {
        summary.active += 1;
      }
      if (lifecycle === 'completed') {
        summary.completed += 1;
      }
      if (
        run.status === 'completed_degraded' ||
        run.status === 'failed' ||
        run.status === 'timed_out' ||
        run.status === 'cancelled'
      ) {
        summary.attention += 1;
      }
      return summary;
    },
    { total: 0, active: 0, completed: 0, attention: 0 },
  );
}

function isActiveRun(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'created';
}

function canCancelRun(run: ResearchRunResponse): boolean {
  return (
    (run.status === 'queued' ||
      run.status === 'running' ||
      run.status === 'created' ||
      run.status === 'submitted') &&
    Boolean(run.run_id ?? run.id)
  );
}
