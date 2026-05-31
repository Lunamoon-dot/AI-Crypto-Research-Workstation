import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  FlaskConical,
  History,
} from 'lucide-react';
import { listResearchRuns } from '@/services/research-runs';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { IdChip, StatusBadge } from '@/components/research/badges';
import { BentoGrid } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  filterResearchRunsByHistoryFilters,
  lifecycleStatus,
} from '@/pages/research-history-filters';
import type { ResearchRunResponse } from '@/types';

const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'timed_out', label: 'Timed out' },
];

export function ResearchHistoryPage() {
  const auth = useWorkspaceStore();
  const fixedWorkspaceSymbol = auth.fixedWorkspaceSymbol();
  const [startedDate, setStartedDate] = useState('');
  const [symbol, setSymbol] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
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

  const runs = useMemo(() => {
    return filterResearchRunsByHistoryFilters(query.data ?? [], {
      search,
      startedDate,
      status,
      symbol: effectiveSymbolFilter,
    });
  }, [effectiveSymbolFilter, query.data, search, startedDate, status]);

  const metrics = useMemo(() => summarizeRuns(query.data ?? []), [query.data]);

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
        <Panel className="span-12" title="Filters">
          <div className="form-grid research-history-filter-grid">
            <label className="label">
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
              <label className="label">
                Symbol
                <input
                  className="input"
                  placeholder="BTC, ETH, SOL"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                />
              </label>
            ) : (
              <div className="label">
                Workspace symbol
                <span className="badge primary">{fixedWorkspaceSymbol}</span>
              </div>
            )}
            <label className="label">
              Status
              <select
                className="select"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {statusOptions.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Search
              <input
                className="input"
                placeholder="Run id, thesis id, timeframe"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="label">
              Quick view
              <div className="top-strip-meta">
                <button className="button ghost" type="button" onClick={() => setStatus('running')}>
                  Running
                </button>
                <button className="button ghost" type="button" onClick={() => setSearch('degraded')}>
                  Degraded
                </button>
                <button className="button ghost" type="button" onClick={clearFilters}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          className="span-12"
          title="Run results"
          description={`${runs.length} shown`}
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
                  {runs.map((run) => (
                    <tr key={run.id ?? run.run_id ?? `${run.symbol}-${run.started_at}`}>
                      <td>
                        <div className="stack small">
                          <Link to={routes.researchRun(run.run_id ?? run.id ?? '')}>
                            <strong>{run.symbol}</strong>
                          </Link>
                          <span className="muted">
                            {run.market_type} | {run.timeframe ?? 'n/a'}
                          </span>
                          <IdChip value={run.run_id ?? run.id} />
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
                          <Link className="button" to={routes.researchRun(run.run_id ?? run.id ?? '')}>
                            <FlaskConical aria-hidden size={15} />
                            Open run
                          </Link>
                          {run.thesis_id ? (
                            <Link className="button" to={routes.thesis(run.thesis_id)}>
                              <FileText aria-hidden size={15} />
                              Thesis
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      </BentoGrid>
    </main>
  );

  function clearFilters() {
    setStartedDate('');
    setSymbol('');
    setStatus('');
    setSearch('');
  }
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
