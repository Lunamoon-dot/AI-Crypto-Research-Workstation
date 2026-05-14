import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock3, Database, FileJson, ShieldAlert } from 'lucide-react';
import { getSignal } from '@/services/signals';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { ConfidenceBadge, DirectionBadge, IdChip } from '@/components/research/badges';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';
import type { JsonRecord } from '@/types';

export function SignalDetailPage() {
  const { id } = useParams();
  const auth = useWorkspaceStore();
  const signalId = id ?? '';
  const query = useQuery({
    queryKey: queryKeys.signal(signalId),
    queryFn: () => getSignal(signalId, auth),
    enabled: Boolean(signalId),
  });

  if (query.isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading signal..." />
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="page">
        <ErrorState error={query.error} />
      </main>
    );
  }

  const signal = query.data;
  if (!signal) {
    return (
      <main className="page">
        <EmptyState label="Signal not found." />
      </main>
    );
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="05 Signal Detail"
        title={`${signal.symbol} ${signal.signal_type}`}
        description="Trace source data, freshness, evidence fields, and linked research artifacts."
        action={<DirectionBadge value={signal.direction} />}
      />

      <BentoGrid>
        <MetricTile
          className="span-3"
          icon={<Activity size={18} />}
          label="Confidence"
          tone="constructive"
          value={<ConfidenceBadge value={signal.confidence} />}
        />
        <MetricTile
          className="span-3"
          icon={<ShieldAlert size={18} />}
          label="Freshness"
          meta={signal.staleness_reason || 'Source freshness status'}
          tone={signal.is_stale ? 'warning' : 'primary'}
          value={signal.freshness_status || 'unknown'}
        />
        <MetricTile
          className="span-3"
          icon={<Database size={18} />}
          label="Source"
          meta={formatDateTime(signal.source_timestamp)}
          value={signal.source || 'n/a'}
        />
        <MetricTile
          className="span-3"
          icon={<Clock3 size={18} />}
          label="Observed"
          meta={formatAge(signal.age_seconds)}
          value={formatDateTime(signal.observed_at)}
        />

        <Panel className="span-4 emphasis" title="Provenance rail">
          <div className="stack small">
            <DataPair label="Signal ID" value={<IdChip value={signal.id} />} />
            <DataPair label="Evidence lane" value={signal.evidence_lane || 'n/a'} />
            <DataPair label="Category" value={signal.evidence_category || 'n/a'} />
            <DataPair label="Strength" value={formatNumber(signal.strength)} />
            <DataPair label="Confidence version" value={signal.confidence_version} />
            <DataPair label="Expires" value={formatDateTime(signal.expires_at)} />
            <DataPair label="Research run" value={<RunLink id={signal.research_run_id} />} />
            <DataPair label="Signal snapshot" value={<IdChip value={signal.signal_snapshot_id} />} />
          </div>
        </Panel>

        <Panel className="span-8" title="Source payload" description="Normalized provenance object">
          {hasEntries(signal.provenance) ? (
            <JsonView value={signal.provenance} />
          ) : (
            <EmptyState label="No provenance payload persisted for this signal." />
          )}
        </Panel>

        <Panel className="span-6" title="Evidence details">
          {hasEntries(signal.evidence) ? (
            <JsonView value={signal.evidence} />
          ) : (
            <EmptyState label="No structured evidence payload persisted." />
          )}
        </Panel>

        <Panel className="span-6" title="Watch conditions">
          {hasEntries(signal.watch_conditions) ? (
            <JsonView value={signal.watch_conditions} />
          ) : (
            <EmptyState label="No watch conditions persisted." />
          )}
        </Panel>

        <Panel className="span-12" title="Raw signal JSON" description="Full API response for audit/export parity">
          <div className="stack small">
            <div className="top-strip-meta">
              <span className="badge">
                <FileJson aria-hidden size={14} />
                API detail
              </span>
              <span className={signal.is_stale ? 'badge warning' : 'badge primary'}>
                {signal.is_stale ? 'stale' : 'current or unknown'}
              </span>
            </div>
            <JsonView value={signal.payload} />
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function RunLink({ id }: { id: string | null }) {
  if (!id) {
    return <IdChip value={id} />;
  }
  return (
    <Link className="badge primary" to={routes.researchRun(id)}>
      {id}
    </Link>
  );
}

function hasEntries(value: JsonRecord): boolean {
  return Object.keys(value).length > 0;
}

function formatAge(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'age n/a';
  }
  if (value < 60) {
    return `${Math.round(value)}s old`;
  }
  if (value < 3600) {
    return `${Math.round(value / 60)}m old`;
  }
  return `${(value / 3600).toFixed(1)}h old`;
}
