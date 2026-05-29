import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bug, FileText, GitBranch, ShieldCheck } from 'lucide-react';
import {
  getResearchContinuityEntry,
  getResearchContinuityEntryDebug,
} from '@/services/research-continuity';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { JsonView } from '@/components/research/json-view';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { IdChip, StatusBadge } from '@/components/research/badges';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';

export function ResearchContinuityEntryDetailPage() {
  const { id = '' } = useParams();
  const auth = useWorkspaceStore();
  const entryQuery = useQuery({
    queryKey: queryKeys.researchContinuityEntry(id),
    queryFn: () => getResearchContinuityEntry(id, auth),
    enabled: Boolean(id),
    retry: false,
  });
  const debugMutation = useMutation({
    mutationKey: queryKeys.researchContinuityEntryDebug(id),
    mutationFn: () => getResearchContinuityEntryDebug(id, auth),
  });
  const detail = entryQuery.data ?? null;
  const thinSections = detail?.thin_report?.sections ?? [];
  const sourceRunRoute = useMemo(
    () => (detail ? routes.researchRun(detail.research_run_id) : routes.researchHistory),
    [detail],
  );

  return (
    <main className="page">
      <PageHeader
        eyebrow="Research Continuity"
        title="Continuity Entry"
        description={detail?.symbol ?? id}
        action={
          <div className="top-strip-meta">
            {detail ? (
              <Link className="button" to={sourceRunRoute}>
                Open source run
              </Link>
            ) : null}
            <Link className="button" to={routes.researchContinuity()}>
              Back to continuity
            </Link>
          </div>
        }
      />

      {entryQuery.isLoading ? <LoadingState label="Loading continuity entry..." /> : null}
      {entryQuery.isError ? <ErrorState error={entryQuery.error} /> : null}
      {!entryQuery.isLoading && !entryQuery.isError && !detail ? (
        <EmptyState label="Continuity entry not found." />
      ) : null}

      {detail ? (
        <BentoGrid className="research-continuity-detail-grid">
          <Panel className="span-12 research-continuity-panel" title="Summary">
            <div className="continuity-report">
              <div className="continuity-report-toolbar">
                <div className="continuity-report-status">
                  <span className="badge primary">{detail.entry_type}</span>
                  <StatusBadge value={detail.status} />
                </div>
                <span className="small muted">{formatDateTime(detail.generated_at)}</span>
              </div>
              <p>{detail.summary}</p>
              <div className="research-continuity-data-grid">
                <DataPair label="Entry" value={<IdChip value={detail.id} />} />
                <DataPair label="Run" value={<IdChip value={detail.research_run_id} />} />
                <DataPair label="Workspace" value={detail.workspace_id} />
              </div>
            </div>
          </Panel>

          <Panel className="span-8 research-continuity-panel" title="Readable Digest">
            {thinSections.length === 0 ? <EmptyState label="No digest sections." /> : null}
            <div className="continuity-report-sections">
              {thinSections.map((section) => (
                <section className="continuity-report-section" key={section.id}>
                  <h4>{section.title}</h4>
                  <ul>
                    {(section.items.length > 0 ? section.items : ['No changes reported.']).map(
                      (item, index) => (
                        <li key={`${section.id}-${index}`}>{item}</li>
                      ),
                    )}
                  </ul>
                </section>
              ))}
            </div>
          </Panel>

          <Panel className="span-4 research-continuity-panel" title="Quality">
            <div className="research-continuity-quality-grid detail">
              <MetricTile
                icon={<ShieldCheck aria-hidden size={15} />}
                label="Status"
                value={detail.quality_explanation.status}
                meta={scoreLabel(detail.quality_explanation.score)}
                tone={
                  detail.quality_explanation.status === 'clean'
                    ? 'constructive'
                    : 'warning'
                }
              />
              <MetricTile
                icon={<FileText aria-hidden size={15} />}
                label="Observed"
                value={formatCoverage(detail.quality_explanation.observed_evidence_coverage)}
                meta={detail.evidence_digest.health_line}
                tone="constructive"
              />
            </div>
            <ListBlock
              emptyLabel="No quality warnings."
              items={[
                ...detail.quality_explanation.warnings,
                ...detail.quality_explanation.reasons,
              ]}
            />
          </Panel>

          <Panel className="span-6 research-continuity-panel" title="Evidence Digest">
            <div className="research-continuity-data-grid">
              <DataPair label="Observed" value={countLabel(detail.evidence_digest.observed_count)} />
              <DataPair label="Reasoning" value={countLabel(detail.evidence_digest.reasoning_count)} />
              <DataPair label="Missing" value={countLabel(detail.evidence_digest.missing_count)} />
              <DataPair label="No evidence" value={countLabel(detail.evidence_digest.no_evidence_count)} />
              <DataPair label="Stale" value={countLabel(detail.evidence_digest.stale_count)} />
              <DataPair label="Coverage" value={formatCoverage(detail.evidence_digest.observed_coverage)} />
            </div>
            <p className="muted">{detail.evidence_digest.health_line}</p>
            <ListBlock
              emptyLabel="No missing or stale categories."
              items={[
                ...detail.evidence_digest.missing_categories.map(
                  (item) => `Missing: ${item}`,
                ),
                ...detail.evidence_digest.stale_categories.map(
                  (item) => `Stale: ${item}`,
                ),
              ]}
            />
          </Panel>

          <Panel className="span-6 research-continuity-panel" title="State Transition">
            <div className="research-continuity-data-grid">
              <DataPair label="Transition" value={detail.state_transition.transition} />
              <DataPair
                label="Previous"
                value={<IdChip value={detail.state_transition.previous_entry_id} />}
              />
              <DataPair
                label="Snapshot"
                value={<IdChip value={detail.state_transition.current_snapshot_id} />}
              />
              <DataPair
                label="Source runs"
                value={detail.state_transition.source_run_ids.length.toString()}
              />
            </div>
            <p className="muted">{detail.state_transition.reason}</p>
          </Panel>

          <Panel className="span-12 research-continuity-panel" title="Material Events">
            {detail.material_events_digest.length === 0 ? (
              <EmptyState label="No material events in this entry." />
            ) : null}
            <div className="continuity-material-events">
              {detail.material_events_digest.map((event, index) => (
                <article className="continuity-material-event" key={`${event.type}-${index}`}>
                  <div className="row">
                    <span className={`badge ${event.severity === 'info' ? '' : 'warning'}`}>
                      {event.severity}
                    </span>
                    <strong>{event.label}</strong>
                    {event.evidence_status ? (
                      <span className="badge">{event.evidence_status}</span>
                    ) : null}
                  </div>
                  <p>{event.summary}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel className="span-12 research-continuity-panel" title="Debug Access">
            <div className="continuity-debug-access">
              <div>
                <span className="badge">{detail.debug.reason.replaceAll('_', ' ')}</span>
                <p className="muted">
                  Requires {detail.debug.requires_permission}; debug traces are redacted.
                </p>
              </div>
              {detail.debug.available ? (
                <button
                  className="button"
                  disabled={debugMutation.isPending}
                  onClick={() => debugMutation.mutate()}
                  type="button"
                >
                  <Bug aria-hidden size={15} />
                  Debug trace
                </button>
              ) : null}
            </div>
            {debugMutation.isPending ? <LoadingState label="Loading debug trace..." /> : null}
            {debugMutation.isError ? <ErrorState error={debugMutation.error} /> : null}
            {debugMutation.data ? (
              <details className="continuity-debug-details">
                <summary className="button">
                  <GitBranch aria-hidden size={15} />
                  Redacted trace
                </summary>
                <JsonView value={debugMutation.data} />
              </details>
            ) : null}
          </Panel>
        </BentoGrid>
      ) : null}
    </main>
  );
}

function ListBlock({
  emptyLabel,
  items,
}: {
  emptyLabel: string;
  items: string[];
}) {
  if (items.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }
  return (
    <ul className="continuity-evidence-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function scoreLabel(value: number | null): string | null {
  return value === null ? null : `Score ${value}`;
}

function countLabel(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

function formatCoverage(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}
