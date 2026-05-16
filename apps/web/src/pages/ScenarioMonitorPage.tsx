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
import type { ScenarioMonitorItemResponse } from '@/types';

type Tone = 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';

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
              ? `${monitor.data.items.length} shown | generated ${formatDateTime(monitor.data.generated_at)}`
              : 'Loading monitored thesis scenarios'
          }
        >
          {monitor.data?.items.length === 0 ? <EmptyState label="No scenarios match the filters." /> : null}
          <div className="scenario-monitor-list">
            {monitor.data?.items.map((item) => (
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
  const condition =
    cleanScenarioText(item.scenario.condition || item.trigger_summary) ||
    'No trigger condition recorded.';
  const actionParts = splitAction(item.scenario.suggested_user_action || 'review');
  const actionToneValue = actionTone(actionParts.label);
  const expected = cleanScenarioText(item.scenario.expected_behavior);
  const statusReason = cleanScenarioText(item.status_reason);
  const probability = cleanScenarioText(item.scenario.probability_band) || 'n/a';
  const market = item.latest_market_snapshot;
  const alert = item.latest_alert;

  return (
    <article className={`scenario-card scenario-card-${statusTone(item.status)}`}>
      <div className="scenario-monitor-header">
        <div className="scenario-monitor-heading">
          <div className="scenario-monitor-title-row">
            <strong>{item.thesis.symbol}</strong>
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
          {actionParts.label}
        </span>
        <span>{actionParts.detail || 'Review scenario context.'}</span>
      </div>

      {expected ? (
        <div className="scenario-field">
          <span>Expected market behavior</span>
          <p>{expected}</p>
        </div>
      ) : null}

      <div className="scenario-monitor-facts">
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
        </div>
      </div>
    </article>
  );
}

function statusBadgeClass(status: string): string {
  if (status === 'alerting' || status === 'action_required') {
    return 'badge warning scenario-status-badge';
  }
  if (status === 'missing_price') {
    return 'badge degraded scenario-status-badge';
  }
  return 'badge primary scenario-status-badge';
}

function statusTone(status: string): Tone {
  if (status === 'alerting' || status === 'action_required') {
    return 'warning';
  }
  if (status === 'high_attention') {
    return 'risk';
  }
  if (status === 'missing_price') {
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

function actionTone(value: string): 'constructive' | 'warning' | 'risk' | 'primary' {
  const normalized = value.toLowerCase();
  if (normalized.includes('exit') || normalized.includes('reduce') || normalized.includes('avoid')) {
    return 'risk';
  }
  if (normalized.includes('watch') || normalized.includes('monitor') || normalized.includes('hold')) {
    return 'constructive';
  }
  if (normalized.includes('reassess') || normalized.includes('wait')) {
    return 'warning';
  }
  return 'primary';
}

function splitAction(value: string): { label: string; detail: string } {
  const cleaned = cleanScenarioText(value);
  const match = cleaned.match(
    /^(watch|monitor|review|reassess|avoid|reduce|exit|stand aside|maintain|downgrade|upgrade|record|wait|hold)\b[:,-]?\s*(.*)$/i,
  );
  if (!match) {
    return { label: 'Review', detail: cleaned };
  }
  const label = match[1].replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { label, detail: match[2]?.trim() ?? '' };
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
