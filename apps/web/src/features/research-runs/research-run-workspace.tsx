'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  getJobStatus,
  getJournalRunWorkspace,
  getResearchRunWorkspace,
} from '@/api/research-runs';
import { queryKeys } from '@/api/query-keys';
import { useAuth } from '@/auth/auth-provider';
import {
  ConfidenceBadge,
  DirectionBadge,
  IdChip,
  StatusBadge,
} from '@/components/research/badges';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';

export function ResearchRunWorkspace({
  runId,
  journal = false,
}: {
  runId: string;
  journal?: boolean;
}) {
  const auth = useAuth();
  const query = useQuery({
    queryKey: queryKeys.researchRunWorkspace(runId),
    queryFn: () =>
      journal
        ? getJournalRunWorkspace(runId, auth)
        : getResearchRunWorkspace(runId, auth),
    refetchInterval: 5000,
    retry: false,
  });
  const jobQuery = useQuery({
    queryKey: queryKeys.jobStatus(runId),
    queryFn: () => getJobStatus(runId, auth),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 5000 : false;
    },
    retry: false,
  });

  if (query.isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading run workspace..." />
      </main>
    );
  }

  if (query.isError) {
    if (jobQuery.isLoading) {
      return (
        <main className="page">
          <LoadingState label="Checking run job status..." />
        </main>
      );
    }
    if (jobQuery.data) {
      return (
        <main className="page">
          <PageHeader
            title="Research run pending"
            description={`Run ${jobQuery.data.run_id}`}
            action={<StatusBadge value={jobQuery.data.status} />}
          />
          <div className="grid two">
            <Panel title="Job status">
              <div className="stack small">
                <div className="row"><span>Backend</span><span>{jobQuery.data.backend}</span></div>
                <div className="row"><span>Created</span><span>{formatDateTime(jobQuery.data.created_at)}</span></div>
                <div className="row"><span>Started</span><span>{formatDateTime(jobQuery.data.started_at)}</span></div>
                <div className="row"><span>Completed</span><span>{formatDateTime(jobQuery.data.completed_at)}</span></div>
                <div className="row"><span>Retries</span><span>{jobQuery.data.retry_count}</span></div>
              </div>
            </Panel>
            <Panel title="Artifacts">
              <EmptyState label="Run artifacts have not been persisted yet. This page will keep polling." />
              {jobQuery.data.error_message ? (
                <div className="badge risk">{jobQuery.data.error_message}</div>
              ) : null}
            </Panel>
          </div>
        </main>
      );
    }
    return (
      <main className="page">
        <ErrorState error={query.error} />
      </main>
    );
  }

  const workspace = query.data;
  if (!workspace) {
    return (
      <main className="page">
        <EmptyState label="Run workspace not found." />
      </main>
    );
  }

  const market = workspace.snapshots.market_snapshot;
  const signal = workspace.snapshots.signal_snapshot;

  return (
    <main className="page">
      <PageHeader
        title={`${workspace.run.symbol} research run`}
        description={`Run ${workspace.run.run_id ?? workspace.run.id ?? runId}`}
        action={<StatusBadge value={workspace.run.status} />}
      />

      <div className="grid two">
        <Panel title="Run metadata">
          <div className="stack small">
            <div className="row"><span>Status</span><StatusBadge value={workspace.run.status} /></div>
            <div className="row"><span>Market</span><span>{workspace.run.market_type}</span></div>
            <div className="row"><span>Started</span><span>{formatDateTime(workspace.run.started_at)}</span></div>
            <div className="row"><span>Completed</span><span>{formatDateTime(workspace.run.completed_at)}</span></div>
            <div className="row"><span>Thesis</span><IdChip value={workspace.run.thesis_id} /></div>
            <div className="row"><span>Market snapshot</span><IdChip value={workspace.run.market_snapshot_id} /></div>
            <div className="row"><span>Signal snapshot</span><IdChip value={workspace.run.signal_snapshot_id} /></div>
            {jobQuery.data ? (
              <div className="row"><span>Job</span><span>{jobQuery.data.status}</span></div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Data quality">
          <div className="stack">
            <div>
              <strong>Degradation reasons</strong>
              <p className="small muted">{workspace.run.degradation_reasons.join(', ') || 'None reported.'}</p>
            </div>
            <div>
              <strong>Missing core data</strong>
              <p className="small muted">{workspace.run.missing_core_data.join(', ') || 'None reported.'}</p>
            </div>
            <div>
              <strong>Missing optional data</strong>
              <p className="small muted">{workspace.run.missing_optional_data.join(', ') || 'None reported.'}</p>
            </div>
          </div>
        </Panel>

        <Panel title="Market snapshot" description="Price and source provenance">
          {market ? (
            <div className="stack small">
              <div className="row"><span>Current price</span><strong>{formatNumber(market.current_price)}</strong></div>
              <div className="row"><span>Source</span><span>{market.source || 'n/a'}</span></div>
              <div className="row"><span>Source time</span><span>{formatDateTime(market.source_timestamp)}</span></div>
              <div className="row"><span>Captured</span><span>{formatDateTime(market.captured_at)}</span></div>
              <JsonView value={market.payload} />
            </div>
          ) : (
            <EmptyState label="No market snapshot persisted yet." />
          )}
        </Panel>

        <Panel title="Signal snapshot" description="Aggregated deterministic evidence">
          {signal ? (
            <div className="stack small">
              <div className="row"><span>Total</span><strong>{signal.signal_count ?? 0}</strong></div>
              <div className="row"><span>Bullish</span><span>{signal.bullish_count ?? 0}</span></div>
              <div className="row"><span>Bearish</span><span>{signal.bearish_count ?? 0}</span></div>
              <div className="row"><span>Neutral</span><span>{signal.neutral_count ?? 0}</span></div>
              <div className="row"><span>Stale</span><span>{signal.stale_count ?? 0}</span></div>
              <JsonView value={signal.payload} />
            </div>
          ) : (
            <EmptyState label="No signal snapshot persisted yet." />
          )}
        </Panel>

        <Panel title="Agent debate" description="Consensus and disagreement">
          {workspace.debate.debate ? (
            <div className="stack">
              <div className="row">
                <DirectionBadge value={workspace.debate.debate.consensus_stance} />
                <span className="badge warning">{workspace.debate.debate.conflict_level}</span>
              </div>
              {workspace.debate.agent_opinions.map((opinion) => (
                <div className="list-row" key={opinion.id ?? opinion.agent_name}>
                  <div className="row">
                    <strong>{opinion.agent_name}</strong>
                    <ConfidenceBadge value={opinion.confidence} />
                  </div>
                  <div className="small muted">{opinion.agent_role} | {opinion.stance}</div>
                  <JsonView value={opinion.payload} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="No debate persisted yet." />
          )}
        </Panel>

        <Panel title="Thesis result">
          {workspace.thesis ? (
            <div className="stack">
              <div className="row">
                <strong>{workspace.thesis.symbol}</strong>
                <DirectionBadge value={workspace.thesis.direction} />
              </div>
              <p className="muted">{workspace.thesis.summary.action_summary || workspace.thesis.thesis_text}</p>
              <div className="row small">
                <span>Invalidation: {workspace.thesis.invalidation_level || 'n/a'}</span>
                <ConfidenceBadge value={workspace.thesis.confidence} />
              </div>
              <Link className="button primary" href={routes.thesis(workspace.thesis.id ?? '')}>
                Open thesis
              </Link>
            </div>
          ) : (
            <EmptyState label="No thesis generated yet." />
          )}
        </Panel>

        <Panel title="Timeline">
          {workspace.events.length === 0 ? <EmptyState label="No run events yet." /> : null}
          <div className="stack">
            {workspace.events.map((event) => (
              <div className="list-row" key={event.id ?? `${event.event_type}-${event.created_at}`}>
                <div className="row">
                  <strong>{event.event_type}</strong>
                  <span className="small muted">{formatDateTime(event.created_at)}</span>
                </div>
                <p className="small">{event.message}</p>
                <JsonView value={event.payload} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}
