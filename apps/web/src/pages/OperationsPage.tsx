import { Activity, Database, ServerCog, Sparkles } from 'lucide-react';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState } from '@/components/ui/state';

export function OperationsPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="07 Operations & Settings"
        title="Operations"
        description="Trust and runtime state for the local MVP. Unavailable telemetry is shown honestly as planned, not fabricated."
      />
      <BentoGrid>
        <MetricTile
          className="span-3"
          icon={<ServerCog size={18} />}
          label="Providers"
          meta="Endpoint not available"
          tone="warning"
          value="Planned"
        />
        <MetricTile
          className="span-3"
          icon={<Sparkles size={18} />}
          label="LLM calls"
          meta="No telemetry API"
          value="n/a"
        />
        <MetricTile
          className="span-3"
          icon={<Database size={18} />}
          label="Freshness"
          meta="Shown on run pages"
          tone="primary"
          value="Run-level"
        />
        <MetricTile
          className="span-3"
          icon={<Activity size={18} />}
          label="Queue"
          meta="Job status endpoint only"
          value="Partial"
        />

        <Panel className="span-7 emphasis" title="Provider health">
          <EmptyState label="Provider health endpoints are not available yet." />
          <div className="stack">
            <ProviderRow name="Market data" endpoint="GET /operations/provider-health" />
            <ProviderRow name="News and social" endpoint="GET /operations/provider-health" />
            <ProviderRow name="Onchain providers" endpoint="GET /operations/provider-health" tone="warning" />
          </div>
        </Panel>

        <Panel className="span-5" title="LLM calls">
          <div className="row start">
            <div className="circular-meter"><span>n/a</span></div>
            <div className="stack small">
              <DataPair label="Endpoint" value="GET /operations/llm-calls" />
              <DataPair label="Status" value={<span className="badge warning">planned</span>} />
              <DataPair label="Policy" value="No fabricated usage metrics" />
            </div>
          </div>
        </Panel>

        <Panel className="span-12" title="Data freshness">
          <div className="grid three">
            <div className="state-card">
              <strong>Run artifacts</strong>
              <span className="small muted">Freshness, degradation, and missing-data fields are exposed on research run pages.</span>
            </div>
            <div className="state-card">
              <strong>Signals</strong>
              <span className="small muted">Source timestamps are visible in the signal explorer and signal snapshots.</span>
            </div>
            <div className="state-card">
              <strong>Briefs</strong>
              <span className="small muted">Brief date and creation time are shown in the archive and workbench.</span>
            </div>
          </div>
        </Panel>

        <Panel className="span-12" title="Planned API endpoints">
          <div className="grid three small mono">
            <span className="state-card">GET /operations/provider-health</span>
            <span className="state-card">GET /operations/llm-calls</span>
            <span className="state-card">GET /operations/data-freshness</span>
            <span className="state-card">GET /operations/queue</span>
            <span className="state-card">GET /settings/config-health</span>
            <span className="state-card">GET /settings/profiles</span>
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function ProviderRow({
  name,
  endpoint,
  tone = 'primary',
}: {
  name: string;
  endpoint: string;
  tone?: 'primary' | 'warning';
}) {
  return (
    <div className="list-row">
      <div className="row">
        <strong>{name}</strong>
        <span className={`badge ${tone}`}>planned</span>
      </div>
      <div className="small muted">{endpoint}</div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: tone === 'warning' ? '34%' : '62%' }} />
      </div>
    </div>
  );
}
