import { useQuery } from '@tanstack/react-query';
import { Database, ServerCog, ShieldCheck, Sparkles } from 'lucide-react';
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
            <DataPair
              label="Repair mode"
              value={continuity?.scheduled_repair_mode.replaceAll('_', ' ') ?? 'disabled'}
            />
            <DataPair
              label="Scheduler due"
              value={
                <span className={continuity?.scheduled_repair_due ? 'badge warning' : 'badge constructive'}>
                  {continuity?.scheduled_repair_due ? 'due' : 'not due'}
                </span>
              }
            />
            <DataPair
              label="Next scheduled"
              value={formatDateTime(continuity?.next_scheduled_repair_due_at)}
            />
            <DataPair
              label="Last scheduled run"
              value={continuity?.last_scheduled_repair_run_id ?? 'none'}
            />
            <DataPair
              label="Worker enabled"
              value={
                <span className={continuity?.scheduled_repair_worker_enabled ? 'badge constructive' : 'badge'}>
                  {continuity?.scheduled_repair_worker_enabled ? 'enabled' : 'disabled'}
                </span>
              }
            />
            <DataPair
              label="Lease owner"
              value={continuity?.scheduled_repair_lease_owner ?? 'none'}
            />
            <DataPair
              label="Lease expires"
              value={formatDateTime(continuity?.scheduled_repair_lease_expires_at)}
            />
            <DataPair
              label="Last attempt"
              value={formatDateTime(continuity?.scheduled_repair_last_attempt_at)}
            />
            <DataPair
              label="Last success"
              value={formatDateTime(continuity?.scheduled_repair_last_success_at)}
            />
            <DataPair
              label="Next retry"
              value={formatDateTime(continuity?.scheduled_repair_next_retry_at)}
            />
            <DataPair
              label="Failures"
              value={continuity?.scheduled_repair_consecutive_failures ?? 0}
            />
            <DataPair
              label="Last error"
              value={continuity?.scheduled_repair_last_error ?? 'none'}
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
