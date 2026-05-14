import { useQuery } from '@tanstack/react-query';
import { Activity, Database, ServerCog, Sparkles } from 'lucide-react';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
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
  const providerIssues = data?.providers.filter((row) => !healthyStatus(row.status)).length ?? 0;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Operations Health"
        title="Operations"
        description="Provider, model, queue, and freshness telemetry from the API runtime and persisted health tables."
      />
      {health.isLoading ? <LoadingState /> : null}
      {health.isError ? <ErrorState error={health.error} /> : null}
      <BentoGrid>
        <MetricTile
          className="span-3"
          icon={<ServerCog size={18} />}
          label="Providers"
          tone={providerIssues > 0 ? 'warning' : 'constructive'}
          value={data ? data.providers.length : '...'}
          meta={providerIssues > 0 ? `${providerIssues} need config` : 'configured or healthy'}
        />
        <MetricTile
          className="span-3"
          icon={<Sparkles size={18} />}
          label="LLM success"
          tone={(data?.llm.success_rate ?? 1) < 0.9 ? 'warning' : 'constructive'}
          value={formatConfidence(data?.llm.success_rate)}
          meta={`${data?.llm.total_calls ?? 0} recent call(s)`}
        />
        <MetricTile
          className="span-3"
          icon={<Database size={18} />}
          label="Stale checks"
          tone={(data?.freshness.stale_checks ?? 0) > 0 ? 'warning' : 'constructive'}
          value={data?.freshness.stale_checks ?? '...'}
          meta={`${data?.freshness.total_checks ?? 0} freshness row(s)`}
        />
        <MetricTile
          className="span-3"
          icon={<Activity size={18} />}
          label="Queue"
          tone={data?.queue.backend === 'bullmq' && !data.queue.redis_configured ? 'warning' : 'primary'}
          value={data?.queue.backend ?? '...'}
          meta={data?.queue.redis_configured ? 'Redis configured' : 'No Redis URL'}
        />

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
