import { useQuery } from '@tanstack/react-query';
import { Activity, Database, ServerCog, ShieldCheck, Sparkles } from 'lucide-react';
import { BentoGrid, DataPair } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { getOperationsHealth } from '@/services/operations';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { formatConfidence, formatDateTime, formatNumber } from '@/lib/format';

export function OperationsPage() {
  const auth = useWorkspaceStore();
  const health = useQuery({
    queryKey: queryKeys.operationsHealth({ limit: 50 }),
    queryFn: () => getOperationsHealth({ limit: 50 }, auth),
    refetchInterval: 30_000,
  });
  const data = health.data;
  const continuity = data?.continuity;
  const providerIssues = data?.providers.filter((row) => !healthyStatus(row.status)).length ?? 0;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Operations Health"
        title="Operations"
        description="Provider, model, queue, and freshness telemetry from the API runtime and persisted health tables."
        action={
          <HeaderStats
            stats={[
              {
                icon: <ServerCog aria-hidden size={14} />,
                label: 'Providers',
                meta: providerIssues > 0 ? `${providerIssues} need config` : 'configured',
                tone: providerIssues > 0 ? 'warning' : 'constructive',
                value: data ? data.providers.length : '...',
              },
              {
                icon: <Sparkles aria-hidden size={14} />,
                label: 'LLM success',
                meta: `${data?.llm.total_calls ?? 0} calls`,
                tone: (data?.llm.success_rate ?? 1) < 0.9 ? 'warning' : 'constructive',
                value: formatConfidence(data?.llm.success_rate),
              },
              {
                icon: <Database aria-hidden size={14} />,
                label: 'Stale checks',
                meta: `${data?.freshness.total_checks ?? 0} rows`,
                tone: (data?.freshness.stale_checks ?? 0) > 0 ? 'warning' : 'constructive',
                value: data?.freshness.stale_checks ?? '...',
              },
              {
                icon: <Activity aria-hidden size={14} />,
                label: 'Monitor jobs',
                meta: `${data?.monitoring_queue.running ?? 0} running`,
                tone: (data?.monitoring_queue.dead_letter ?? 0) > 0 ? 'risk' : 'primary',
                value: data?.monitoring_queue.queued ?? '...',
              },
              {
                icon: <ShieldCheck aria-hidden size={14} />,
                label: 'Workspace',
                meta: continuity?.audit_available === false ? 'audit unavailable' : 'active',
                tone: continuity?.audit_available === false ? 'warning' : 'primary',
                value: continuity?.workspace_id ?? auth.workspaceId,
              },
            ]}
          />
        }
      />
      {health.isLoading ? <LoadingState /> : null}
      {health.isError ? <ErrorState error={health.error} /> : null}
      <BentoGrid>
        <Panel className="span-7 emphasis" title="Provider Health">
          {data?.providers.length === 0 ? <EmptyState label="No provider rows." /> : null}
          <div className="stack">
            {data?.providers.map((provider) => (
              <div className="list-row" key={`${provider.provider}-${provider.component}`}>
                <div className="row">
                  <div>
                    <strong>{provider.provider}</strong>
                    <div className="small muted">{provider.component ?? 'runtime'}</div>
                  </div>
                  <span className={healthyStatus(provider.status) ? 'badge constructive' : 'badge warning'}>
                    {provider.status}
                  </span>
                </div>
                <div className="grid three">
                  <DataPair label="Checked" value={formatDateTime(provider.checked_at)} />
                  <DataPair label="Latency" value={formatNumber(provider.latency_ms)} />
                  <DataPair label="Error" value={provider.error_type ?? 'none'} />
                </div>
                {provider.error_message ? (
                  <div className="callout warning">{provider.error_message}</div>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="span-5" title="LLM Calls">
          <div className="stack">
            <DataPair label="Total calls" value={data?.llm.total_calls ?? 0} />
            <DataPair label="Total tokens" value={formatNumber(data?.llm.total_tokens)} />
            <DataPair label="Avg latency" value={formatNumber(data?.llm.average_latency_ms)} />
            <DataPair label="Recent errors" value={data?.llm.recent_errors ?? 0} />
            <JsonView value={data?.llm.by_provider ?? {}} />
          </div>
        </Panel>

        <Panel className="span-6" title="Monitoring Queue">
          <div className="grid two">
            <DataPair label="Queued" value={data?.monitoring_queue.queued ?? 0} />
            <DataPair label="Running" value={data?.monitoring_queue.running ?? 0} />
            <DataPair label="Failed" value={data?.monitoring_queue.failed ?? 0} />
            <DataPair label="Dead letter" value={data?.monitoring_queue.dead_letter ?? 0} />
            <DataPair
              label="Oldest queued"
              value={formatDateTime(data?.monitoring_queue.oldest_queued_at)}
            />
            <DataPair label="Backend" value={data?.queue.backend ?? 'memory'} />
          </div>
        </Panel>

        <Panel className="span-6" title="Monitoring Scheduler">
          <div className="grid two">
            <DataPair label="Enabled plans" value={data?.monitoring_scheduler.enabled_plans ?? 0} />
            <DataPair label="Due plans" value={data?.monitoring_scheduler.due_plans ?? 0} />
            <DataPair
              label="Last enqueue"
              value={formatDateTime(data?.monitoring_scheduler.last_enqueue_at)}
            />
            <DataPair
              label="Last error"
              value={data?.monitoring_scheduler.last_enqueue_error ?? 'none'}
            />
          </div>
        </Panel>

        <Panel className="span-6" title="Monitoring Workers">
          <div className="grid two">
            <DataPair label="Active workers" value={data?.monitoring_workers.active_workers ?? 0} />
            <DataPair
              label="Last success"
              value={formatDateTime(data?.monitoring_workers.last_success_at)}
            />
            <DataPair
              label="Last error"
              value={formatDateTime(data?.monitoring_workers.last_error_at)}
            />
            <DataPair
              label="Error types"
              value={data?.monitoring_workers.recent_error_types.join(', ') || 'none'}
            />
          </div>
        </Panel>

        <Panel className="span-6" title="Monitoring Retention">
          <div className="grid two">
            <DataPair
              label="Last run"
              value={formatDateTime(data?.monitoring_retention.last_run_at)}
            />
            <DataPair
              label="Pulses"
              value={data?.monitoring_retention.last_deleted_counts.deleted_pulses ?? 0}
            />
            <DataPair
              label="Memos"
              value={data?.monitoring_retention.last_deleted_counts.deleted_memos ?? 0}
            />
            <DataPair
              label="Jobs"
              value={data?.monitoring_retention.last_deleted_counts.deleted_jobs ?? 0}
            />
            <DataPair
              label="Dry run"
              value={data?.monitoring_retention.last_deleted_counts.dry_run ? 'yes' : 'no'}
            />
            <DataPair
              label="LLM memo failures"
              value={formatConfidence(data?.llm_memo_health.failure_rate)}
            />
          </div>
        </Panel>

        <Panel className="span-6" title="Continuity Health">
          <div className="grid two">
            <DataPair label="Workspace" value={continuity?.workspace_id ?? auth.workspaceId} />
            <DataPair
              label="Audit"
              value={
                <span className={continuity?.audit_available === false ? 'badge warning' : 'badge constructive'}>
                  {continuity?.audit_available === false ? 'unavailable' : 'available'}
                </span>
              }
            />
            <DataPair label="Missing recent" value={continuity?.missing_entries_recent ?? 0} />
            <DataPair label="Degraded recent" value={continuity?.degraded_entries_recent ?? 0} />
            <DataPair label="Stale symbols" value={continuity?.stale_symbols ?? 0} />
            <DataPair
              label="Last repair"
              value={formatDateTime(continuity?.last_repair_run_at)}
            />
            <DataPair
              label="Repair status"
              value={continuity?.last_repair_status ?? 'none'}
            />
            <DataPair
              label="Repair failures"
              value={continuity?.repair_failures_24h ?? 0}
            />
            <DataPair
              label="Debug allowed"
              value={continuity?.debug_access_24h ?? 0}
            />
            <DataPair
              label="Debug denied"
              value={continuity?.debug_denied_24h ?? 0}
            />
          </div>
        </Panel>

        <Panel className="span-12" title="Data Freshness">
          {data?.freshness.rows.length === 0 ? <EmptyState label="No freshness checks recorded." /> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th>Age</th>
                  <th>Threshold</th>
                  <th>Observed</th>
                </tr>
              </thead>
              <tbody>
                {data?.freshness.rows.map((row) => (
                  <tr key={row.id ?? `${row.source}-${row.observed_timestamp}`}>
                    <td>{row.source}</td>
                    <td>{row.symbol ?? 'n/a'}</td>
                    <td>
                      <span className={healthyStatus(row.status) ? 'badge constructive' : 'badge warning'}>
                        {row.status}
                      </span>
                    </td>
                    <td>{formatNumber(row.age_seconds)}</td>
                    <td>{formatNumber(row.threshold_seconds)}</td>
                    <td>{formatDateTime(row.observed_timestamp)}</td>
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

function healthyStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return ['healthy', 'ok', 'success', 'configured', 'fresh'].includes(normalized);
}
