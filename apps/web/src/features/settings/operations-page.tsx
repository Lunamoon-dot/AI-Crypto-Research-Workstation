'use client';

import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState } from '@/components/ui/state';

export function OperationsPage() {
  return (
    <main className="page">
      <PageHeader
        title="Operations"
        description="Trust and runtime state for the local MVP."
      />
      <div className="grid two">
        <Panel title="Provider health">
          <EmptyState label="Provider health endpoints are not available yet." />
          <p className="small muted">
            This MVP does not fabricate provider, model, queue, or freshness status. Run pages expose persisted degradation and missing-data fields when research artifacts exist.
          </p>
        </Panel>
        <Panel title="Planned API endpoints">
          <div className="stack small mono">
            <span>GET /operations/provider-health</span>
            <span>GET /operations/llm-calls</span>
            <span>GET /operations/data-freshness</span>
            <span>GET /operations/queue</span>
            <span>GET /settings/config-health</span>
            <span>GET /settings/profiles</span>
          </div>
        </Panel>
      </div>
    </main>
  );
}
