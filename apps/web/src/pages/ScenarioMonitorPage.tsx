import { useQuery } from '@tanstack/react-query';
import { Radar } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { getScenarioMonitor } from '@/services/scenarios';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';

export function ScenarioMonitorPage() {
  const auth = useWorkspaceStore();
  const [symbol, setSymbol] = useState('');
  const [status, setStatus] = useState('');
  const filters = {
    symbol: symbol.trim() || undefined,
    status: status || undefined,
    limit: 100,
  };
  const monitor = useQuery({
    queryKey: queryKeys.scenarioMonitor(filters),
    queryFn: () => getScenarioMonitor(filters, auth),
  });

  return (
    <main className="page">
      <PageHeader
        eyebrow="Scenario Radar"
        title="Scenarios"
        description="Monitor saved thesis scenarios with price context, alert pressure, and required actions."
      />
      <Panel title="Filters">
        <div className="form-grid">
          <label className="label">
            Symbol
            <input
              className="input"
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="SOL/USDT"
              value={symbol}
            />
          </label>
          <label className="label">
            Status
            <select
              className="select"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="">All</option>
              <option value="alerting">Alerting</option>
              <option value="action_required">Action required</option>
              <option value="high_attention">High attention</option>
              <option value="missing_price">Missing price</option>
              <option value="watching">Watching</option>
            </select>
          </label>
        </div>
      </Panel>

      <div style={{ height: 14 }} />
      {monitor.isLoading ? <LoadingState /> : null}
      {monitor.isError ? <ErrorState error={monitor.error} /> : null}
      <BentoGrid>
        <MetricTile
          className="span-3"
          icon={<Radar size={18} />}
          label="Scenarios"
          value={monitor.data?.total_scenarios ?? '...'}
          meta={monitor.data ? formatDateTime(monitor.data.generated_at) : 'loading'}
        />
        {Object.entries(monitor.data?.status_counts ?? {}).slice(0, 3).map(([key, value]) => (
          <MetricTile
            className="span-3"
            key={key}
            label={key}
            tone={key === 'alerting' || key === 'action_required' ? 'warning' : 'primary'}
            value={value}
          />
        ))}
        <Panel className="span-12" title="Monitor Queue">
          {monitor.data?.items.length === 0 ? <EmptyState label="No scenarios match the filters." /> : null}
          <div className="stack">
            {monitor.data?.items.map((item) => (
              <div className="list-row" key={item.scenario.id ?? item.trigger_summary}>
                <div className="row">
                  <div>
                    <strong>{item.thesis.symbol}</strong>
                    <div className="small muted">{item.scenario.condition || item.trigger_summary}</div>
                  </div>
                  <span className={statusBadgeClass(item.status)}>{item.status}</span>
                </div>
                <div className="grid three">
                  <div className="state-card">
                    <DataPair label="Action" value={item.scenario.suggested_user_action || 'review'} />
                    <DataPair label="Probability" value={item.scenario.probability_band || 'n/a'} />
                  </div>
                  <div className="state-card">
                    <DataPair label="Latest price" value={formatNumber(item.latest_market_snapshot?.current_price)} />
                    <DataPair label="Source" value={item.latest_market_snapshot?.source ?? 'n/a'} />
                  </div>
                  <div className="state-card">
                    <DataPair label="Risks" value={item.risk_count} />
                    <DataPair label="Alert" value={item.latest_alert?.alert_type ?? 'none'} />
                  </div>
                </div>
                <div className="small muted">{item.status_reason}</div>
                {item.thesis.id ? (
                  <Link className="button ghost" to={routes.thesis(item.thesis.id)}>
                    Open thesis
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function statusBadgeClass(status: string): string {
  if (status === 'alerting' || status === 'action_required') {
    return 'badge warning';
  }
  if (status === 'missing_price') {
    return 'badge degraded';
  }
  return 'badge primary';
}
