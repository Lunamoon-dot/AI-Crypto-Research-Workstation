import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Radar } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BentoGrid } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { getScenarioMonitor } from '@/services/scenarios';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';
import { scenarioMonitorViewModel } from './scenario-view-model';
import type { ScenarioHorizon, ScenarioMonitorItemResponse } from '@/types';

type Tone = 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';
type ScenarioHorizonFilter = 'all' | ScenarioHorizon;

export function ScenarioMonitorPage() {
  const auth = useWorkspaceStore();
  const [symbol, setSymbol] = useState('');
  const [status, setStatus] = useState('');
  const [horizonFilter, setHorizonFilter] = useState<ScenarioHorizonFilter>('all');
  const filters = {
    symbol: symbol.trim() || undefined,
    status: status || undefined,
    limit: 100,
  };
  const monitor = useQuery({
    queryKey: queryKeys.scenarioMonitor(filters),
    queryFn: () => getScenarioMonitor(filters, auth),
  });
  const filteredItems = (monitor.data?.items ?? []).filter((item) => (
    horizonFilter === 'all' || item.scenario.horizon === horizonFilter
  ));
  const scenarioFilters = (
    <div className="scenario-filter-controls scenario-queue-filters">
      <label className="scenario-filter-label">
        Symbol
        <input
          className="input"
          onChange={(event) => setSymbol(event.target.value)}
          placeholder="SOL/USDT"
          value={symbol}
        />
      </label>
      <label className="scenario-filter-label">
        Horizon
        <select
          className="select"
          onChange={(event) => setHorizonFilter(event.target.value as ScenarioHorizonFilter)}
          value={horizonFilter}
        >
          <option value="all">All</option>
          <option value="short_term">Short-term</option>
          <option value="mid_term">Mid-term</option>
          <option value="long_term">Long-term</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
      <label className="scenario-filter-label">
        Status
        <select
          className="select"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">All</option>
          <option value="alerting">Alerting</option>
          <option value="triggered">Triggered</option>
          <option value="near_trigger">Near trigger</option>
          <option value="needs_review">Needs review</option>
          <option value="stale">Stale</option>
          <option value="action_required">Action required</option>
          <option value="high_attention">High attention</option>
          <option value="missing_price">Missing price</option>
          <option value="watching">Watching</option>
        </select>
      </label>
    </div>
  );

  return (
    <main className="page">
      <PageHeader
        eyebrow="Scenario Radar"
        title="Scenarios"
        description="Monitor saved thesis scenarios with price context, alert pressure, and required actions."
        action={
          <HeaderStats
            stats={[
              {
                icon: <Radar aria-hidden size={14} />,
                label: 'Scenarios',
                meta: monitor.data?.generated_at ? formatDateTime(monitor.data.generated_at) : 'loading',
                value: monitor.data?.total_scenarios ?? '...',
              },
              {
                label: 'Watching',
                tone: statusTone('watching'),
                value: monitor.data?.status_counts.watching ?? '...',
              },
              {
                label: 'Action Required',
                tone: statusTone('action_required'),
                value: monitor.data?.status_counts.action_required ?? '...',
              },
              {
                label: 'High Attention',
                tone: statusTone('high_attention'),
                value: monitor.data?.status_counts.high_attention ?? '...',
              },
            ]}
          />
        }
      />
      {monitor.isLoading ? <LoadingState /> : null}
      {monitor.isError ? <ErrorState error={monitor.error} /> : null}
      <BentoGrid>
        <Panel
          className="span-12 scenario-queue-panel"
          title="Scenario queue"
          action={scenarioFilters}
          description={
            monitor.data
              ? `${filteredItems.length} shown | generated ${formatDateTime(monitor.data.generated_at)}`
              : 'Loading monitored thesis scenarios'
          }
        >
          {monitor.data && filteredItems.length === 0 ? <EmptyState label="No scenarios match the filters." /> : null}
          <div className="scenario-monitor-list">
            {filteredItems.map((item) => (
              <ScenarioMonitorCard
                item={item}
                key={item.scenario.id ?? item.trigger_summary}
              />
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function ScenarioMonitorCard({ item }: { item: ScenarioMonitorItemResponse }) {
  const vm = scenarioMonitorViewModel(item.scenario);
  const condition = vm.condition;
  const actionToneValue = vm.actionTone;
  const expected = vm.expected;
  const statusReason = cleanScenarioText(vm.runtimeReason || item.status_reason || vm.statusReason);
  const probability = cleanScenarioText(item.scenario.probability_band) || 'n/a';
  const market = item.latest_market_snapshot;
  const alert = item.latest_alert;

  return (
    <article className={`scenario-card scenario-card-${statusTone(item.status)}`}>
      <div className="scenario-monitor-header">
        <div className="scenario-monitor-heading">
          <div className="scenario-monitor-title-row">
            <strong>{item.thesis.symbol}</strong>
            <span className="badge">{vm.horizonLabel}</span>
            <span className="badge">{probability} probability</span>
          </div>
          <div className="scenario-monitor-condition">
            <span>Trigger condition</span>
            <p className="scenario-condition">{condition}</p>
          </div>
        </div>
        <div className="scenario-monitor-status-row">
          <span className={statusBadgeClass(item.status)}>
            {statusLabel(item.status)}
          </span>
          {vm.runtimeAction ? (
            <span className="badge scenario-status-badge">{vm.runtimeAction}</span>
          ) : null}
          {vm.triggerStatus ? <span className="badge">{vm.triggerStatus}</span> : null}
          {vm.validityStatus ? <span className="badge">{vm.validityStatus}</span> : null}
          {item.thesis.id ? (
            <Link className="button ghost scenario-open-button" to={routes.thesis(item.thesis.id)}>
              <ExternalLink aria-hidden size={14} />
              Thesis
            </Link>
          ) : null}
        </div>
      </div>

      <div className={`scenario-action scenario-monitor-action scenario-action-${actionToneValue}`}>
        <span className={`badge ${actionToneValue}`}>
          {vm.actionLabel}
        </span>
        <span>{vm.actionDetail || 'Review scenario context.'}</span>
      </div>

      {expected ? (
        <div className="scenario-field">
          <span>Expected market behavior</span>
          <p>{expected}</p>
        </div>
      ) : null}

      <div className="scenario-monitor-facts">
        <div className="scenario-monitor-fact">
          <span>Runtime decision</span>
          <p>{vm.runtimeAction || vm.actionLabel}</p>
          <p className="small muted">{vm.runtimeSource || 'No runtime decision'}</p>
        </div>
        <div className="scenario-monitor-fact">
          <span>Market</span>
          <p>
            <strong>{formatNumber(market?.current_price)}</strong>
            <span className="muted"> from {market?.source ?? 'n/a'}</span>
          </p>
          <p className="small muted">
            {formatDateTime(market?.source_timestamp ?? market?.captured_at)}
          </p>
        </div>
        <div className="scenario-monitor-fact">
          <span>Pressure</span>
          <p>
            {item.risk_count} risk{item.risk_count === 1 ? '' : 's'} |{' '}
            {alert?.alert_type ?? 'no alert'}
          </p>
          {alert?.message ? (
            <p className="small muted">{cleanScenarioText(alert.message)}</p>
          ) : null}
        </div>
        <div className="scenario-monitor-fact">
          <span>Status reason</span>
          <p>{statusReason || 'Scenario is monitored with latest persisted market context.'}</p>
          {vm.blockingReasons.length ? (
            <p className="small muted">Blocked by {vm.blockingReasons.join(', ')}</p>
          ) : null}
          <p className="small muted">Distance {vm.distanceLabel}</p>
        </div>
      </div>
    </article>
  );
}

function statusBadgeClass(status: string): string {
  if (status === 'alerting' || status === 'action_required' || status === 'triggered') {
    return 'badge warning scenario-status-badge';
  }
  if (status === 'missing_price' || status === 'stale' || status === 'needs_review') {
    return 'badge degraded scenario-status-badge';
  }
  return 'badge primary scenario-status-badge';
}

function statusTone(status: string): Tone {
  if (status === 'alerting' || status === 'action_required' || status === 'triggered') {
    return 'warning';
  }
  if (status === 'near_trigger') {
    return 'constructive';
  }
  if (status === 'high_attention') {
    return 'risk';
  }
  if (status === 'missing_price' || status === 'stale' || status === 'needs_review') {
    return 'degraded';
  }
  return 'primary';
}

function statusLabel(status: string): string {
  return status
    .split('_')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ') || 'Unknown';
}

function cleanScenarioText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*(?:\u2192|->|=>)\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
