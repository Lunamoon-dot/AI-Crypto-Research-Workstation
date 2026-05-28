import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  FileText,
  Layers,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  getResearchContinuityState,
  listResearchContinuityEntries,
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
import type {
  JsonRecord,
  ResearchContinuityEntryResponse,
  ResearchContinuityStateResponse,
} from '@/types';

const ITEM_TYPES = ['claim', 'risk', 'watchpoint', 'invalidation', 'level'] as const;

export function ResearchContinuityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSymbol = searchParams.get('symbol') ?? 'BTC/USDT';
  const [symbolInput, setSymbolInput] = useState(selectedSymbol);
  const symbol = useMemo(() => selectedSymbol.trim() || 'BTC/USDT', [selectedSymbol]);
  const auth = useWorkspaceStore();
  const stateQuery = useQuery({
    queryKey: queryKeys.researchContinuityState(symbol),
    queryFn: () => getResearchContinuityState(symbol, auth),
    enabled: Boolean(symbol),
    retry: false,
  });
  const entriesQuery = useQuery({
    queryKey: queryKeys.researchContinuityEntries({ symbol, limit: 10 }),
    queryFn: () => listResearchContinuityEntries(symbol, { limit: 10 }, auth),
    enabled: Boolean(symbol),
    retry: false,
  });

  function applySymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSymbol = symbolInput.trim();
    if (nextSymbol) {
      setSearchParams({ symbol: nextSymbol });
    }
  }

  const state = stateQuery.data?.state ?? null;
  const entries = entriesQuery.data?.entries ?? [];
  const latestEntry = stateQuery.data?.latest_entry ?? entries[0] ?? null;
  const quality = record(state?.data_quality ?? latestEntry?.snapshot_quality);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Luna Research"
        title="Research Continuity"
        description={symbol}
        action={
          <form className="top-strip-meta research-continuity-symbol-form" onSubmit={applySymbol}>
            <label className="research-continuity-symbol-field">
              <span>Symbol</span>
              <input
                className="input"
                list="research-continuity-symbols"
                onChange={(event) => setSymbolInput(event.target.value)}
                value={symbolInput}
              />
            </label>
            <datalist id="research-continuity-symbols">
              <option value="BTC/USDT" />
              <option value="ETH/USDT" />
              <option value="SOL/USDT" />
            </datalist>
            <button className="button" type="submit">
              <RefreshCw aria-hidden size={15} />
              Load
            </button>
          </form>
        }
      />

      {stateQuery.isError ? <ErrorState error={stateQuery.error} /> : null}
      {entriesQuery.isError ? <ErrorState error={entriesQuery.error} /> : null}

      <BentoGrid className="research-continuity-grid">
        <Panel
          className="span-4 emphasis research-continuity-panel"
          title="Current View"
          description="State carried into the next run"
        >
          {stateQuery.isLoading ? <LoadingState label="Loading continuity state..." /> : null}
          {!stateQuery.isLoading ? <CurrentView state={state} latestEntry={latestEntry} /> : null}
        </Panel>

        <Panel
          className="span-8 research-continuity-panel"
          title="Latest Delta"
          description="Newest continuity report"
        >
          <LatestReport entry={latestEntry} />
        </Panel>

        <Panel
          className="span-12 research-continuity-panel"
          title="Trust And Evidence"
          description="Snapshot health and evidence coverage"
        >
          <TrustQuality quality={quality} />
        </Panel>

        <Panel
          className="span-12 research-continuity-panel"
          title="Tracked Items"
          description="Claims, risks, watchpoints, invalidations, and levels"
        >
          <ActiveItems state={state} />
        </Panel>

        <Panel className="span-12" title="Recent Entries">
          {entriesQuery.isLoading ? <LoadingState label="Loading continuity entries..." /> : null}
          {!entriesQuery.isLoading && entries.length === 0 ? (
            <EmptyState label="No Daily Research Delta entries found." />
          ) : null}
          <div className="stack">
            {entries.map((entry) => (
              <ContinuityEntryRow entry={entry} key={entry.id ?? entry.research_run_id} />
            ))}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function CurrentView({
  state,
  latestEntry,
}: {
  state: ResearchContinuityStateResponse | null;
  latestEntry: ResearchContinuityEntryResponse | null;
}) {
  if (!state) {
    return <EmptyState label="No continuity state for this symbol yet." />;
  }
  const view = record(state.current_view);
  const directionalBias = stringValue(view.directional_bias);
  const riskPosture = stringValue(view.risk_posture);
  const conviction = stringValue(view.conviction);
  const timeContext = stringValue(view.time_context);
  return (
    <div className="continuity-current-view">
      <div className="continuity-current-focus">
        <span className="small muted">Current stance</span>
        <strong>{directionalBias}</strong>
        <p>
          {riskPosture} risk posture / {conviction} conviction / {timeContext}
        </p>
      </div>
      <div className="research-continuity-data-grid">
        <DataPair label="Latest run" value={<IdChip value={state.latest_run_id} />} />
        <DataPair label="Latest entry" value={<IdChip value={state.latest_entry_id} />} />
        <DataPair label="Time context" value={timeContext} />
      </div>
      <div className="row">
        <span className="badge primary">
          <Activity aria-hidden size={13} />
          {state.active_items.length} active
        </span>
        <StatusBadge value={latestEntry?.status ?? 'unknown'} />
        <span className="small muted">{formatDateTime(state.updated_at)}</span>
      </div>
    </div>
  );
}

function TrustQuality({ quality }: { quality: JsonRecord }) {
  const identityQuality = record(quality.identity_quality);
  const trackedCount = numberValue(quality.tracked_item_count);
  const stableCount = numberValue(identityQuality.stable_key_count);
  const stableCoverage = trackedCount > 0 ? stableCount / trackedCount : null;
  return (
    <div className="research-continuity-quality-grid">
      <MetricTile
        icon={<ShieldCheck aria-hidden size={15} />}
        label="Snapshot status"
        value={stringValue(quality.status, 'unknown')}
        meta={quality.score === undefined ? null : `Score ${String(quality.score)}`}
        tone={stringValue(quality.status) === 'clean' ? 'constructive' : 'warning'}
      />
      <MetricTile
        icon={<Layers aria-hidden size={15} />}
        label="Source coverage"
        value={formatCoverage(quality.source_coverage)}
        meta={`${numberValue(quality.sourced_item_count)} sourced`}
        tone="primary"
      />
      <MetricTile
        icon={<FileText aria-hidden size={15} />}
        label="Evidence coverage"
        value={formatCoverage(quality.evidence_coverage)}
        meta={`${numberValue(quality.evidence_attached_count)} evidence-backed`}
        tone="constructive"
      />
      <MetricTile
        icon={<FileText aria-hidden size={15} />}
        label="Observed evidence"
        value={formatCoverage(quality.observed_evidence_coverage)}
        meta={`${numberValue(quality.observed_evidence_count)} observed lines`}
        tone="constructive"
      />
      <MetricTile
        icon={<Activity aria-hidden size={15} />}
        label="Reasoning only"
        value={String(numberValue(quality.reasoning_only_item_count))}
        meta="active items"
        tone={numberValue(quality.reasoning_only_item_count) > 0 ? 'primary' : 'constructive'}
      />
      <MetricTile
        icon={<ShieldCheck aria-hidden size={15} />}
        label="Missing limited"
        value={String(numberValue(quality.missing_evidence_item_count))}
        meta={`${numberValue(quality.no_evidence_item_count)} no evidence`}
        tone={
          numberValue(quality.missing_evidence_item_count) > 0 ||
          numberValue(quality.no_evidence_item_count) > 0
            ? 'warning'
            : 'constructive'
        }
      />
      <MetricTile
        icon={<Activity aria-hidden size={15} />}
        label="Stable identity"
        value={formatCoverage(stableCoverage)}
        meta={`${numberValue(identityQuality.fallback_hash_count)} fallback`}
        tone={numberValue(identityQuality.fallback_hash_count) > 0 ? 'warning' : 'constructive'}
      />
    </div>
  );
}

function ActiveItems({ state }: { state: ResearchContinuityStateResponse | null }) {
  const items = records(state?.active_items);
  if (items.length === 0) {
    return <EmptyState label="No active tracked items." />;
  }
  return (
    <div className="continuity-active-items">
      {ITEM_TYPES.map((type) => {
        const group = items.filter((item) => item.type === type);
        if (group.length === 0) {
          return null;
        }
        const visibleItems = group.slice(0, 8);
        const hiddenItems = group.slice(8);
        return (
          <section className="continuity-item-group" key={type}>
            <div className="continuity-item-group-header">
              <div>
                <strong>{typeLabel(type)}</strong>
                <span>{typeDescription(type)}</span>
              </div>
              <span className="badge">{group.length}</span>
            </div>
            {visibleItems.map((item, index) => (
              <TrackedItemArticle
                item={item}
                key={String(item.item_key ?? `${type}-${index}`)}
              />
            ))}
            {hiddenItems.length > 0 ? (
              <details className="continuity-more-items">
                <summary className="button">
                  Show {hiddenItems.length} more {typeLabel(type).toLowerCase()}
                </summary>
                <div className="continuity-more-item-list">
                  {hiddenItems.map((item, index) => (
                    <TrackedItemArticle
                      item={item}
                      key={String(item.item_key ?? `${type}-hidden-${index}`)}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function TrackedItemArticle({
  item,
}: {
  item: JsonRecord;
}) {
  return (
    <article className="continuity-active-item">
      <div className="continuity-active-item-main">
        <div className="continuity-active-item-meta">
          <span className="badge">{stringValue(item.importance, 'medium')}</span>
          <TraceBadge value={stringValue(item.trace_quality, 'unsourced')} />
          <EvidenceQualityBadge value={stringValue(item.evidence_quality, 'none')} />
        </div>
        <p>{stringValue(item.current_text ?? item.text)}</p>
      </div>
      <div className="continuity-active-item-side">
        {item.source_artifact ? (
          <span className="badge">{stringValue(item.source_artifact)}</span>
        ) : null}
        <span className="small muted">{numberValue(item.occurrence_count) || 1} seen</span>
        <EvidenceLines value={item.evidence} />
      </div>
    </article>
  );
}

function LatestReport({ entry }: { entry: ResearchContinuityEntryResponse | null }) {
  if (!entry) {
    return <EmptyState label="No latest continuity report." />;
  }
  const sections = entry.sections.filter((section) => section.title.toLowerCase() !== 'summary');
  return (
    <div className="continuity-report">
      <div className="continuity-report-toolbar">
        <div className="continuity-report-status">
          <span className="badge primary">{entry.entry_type}</span>
          <StatusBadge value={entry.status} />
        </div>
        <div className="continuity-report-actions">
          <span className="small muted">{formatDateTime(entry.generated_at)}</span>
          <Link className="button" to={routes.researchRun(entry.research_run_id)}>
            Open full run
          </Link>
        </div>
      </div>
      <div className="continuity-report-summary">
        <strong>Delta summary</strong>
        <p>{entry.summary}</p>
      </div>
      <div className="continuity-report-sections">
        {sections.map((section) => {
          const preview = reportSectionPreview(section);
          return (
            <section className="continuity-report-section" key={section.title}>
              <h4>{section.title}</h4>
              <ul>
                {preview.items.map((item, index) => (
                  <li key={`${section.title}-${index}`}>{item}</li>
                ))}
                {preview.hiddenCount > 0 ? (
                  <li className="continuity-report-more">
                    {preview.hiddenCount} more in full run report.
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ContinuityEntryRow({
  entry,
}: {
  entry: ResearchContinuityEntryResponse;
}) {
  return (
    <div className="list-row">
      <div className="row">
        <span className="badge primary">{entry.entry_type}</span>
        <StatusBadge value={entry.status} />
        <span className="small muted">{formatDateTime(entry.generated_at)}</span>
      </div>
      <p className="muted">{entry.summary}</p>
      <div className="top-strip-meta">
        <Link className="button" to={routes.researchRun(entry.research_run_id)}>
          Open run
        </Link>
        <details>
          <summary className="button">Details</summary>
          <JsonView value={entry} />
        </details>
      </div>
    </div>
  );
}

function TraceBadge({ value }: { value: string }) {
  const tone =
    value === 'evidence_backed'
      ? 'constructive'
      : value === 'sourced'
        ? 'primary'
        : 'warning';
  return <span className={`badge ${tone}`}>{value.replaceAll('_', ' ')}</span>;
}

function EvidenceQualityBadge({ value }: { value: string }) {
  const tone =
    value === 'observed_backed'
      ? 'constructive'
      : value === 'reasoning_only'
        ? 'primary'
        : 'warning';
  return <span className={`badge ${tone}`}>{evidenceQualityLabel(value)}</span>;
}

function EvidenceLines({ value }: { value: unknown }) {
  const evidence = evidenceRecords(value);
  if (evidence.length === 0) {
    return null;
  }
  return (
    <details className="continuity-evidence-details">
      <summary className="button">Evidence lines</summary>
      <ul className="continuity-evidence-list">
        {evidence.map((item, index) => (
          <li key={`${stringValue(item.text)}-${index}`}>
            <span className="badge">{stringValue(item.evidence_kind, 'reasoning')}</span>{' '}
            <span className="badge">{stringValue(item.source_artifact, 'unknown')}</span>{' '}
            {stringValue(item.text)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function typeLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1) + 's';
}

function typeDescription(value: string): string {
  switch (value) {
    case 'claim':
      return 'Working thesis claims';
    case 'risk':
      return 'Open risk statements';
    case 'watchpoint':
      return 'Signals to monitor next';
    case 'invalidation':
      return 'Conditions that break the thesis';
    case 'level':
      return 'Key levels and boundaries';
    default:
      return 'Tracked continuity items';
  }
}

function evidenceQualityLabel(value: string): string {
  if (value === 'none') {
    return 'No evidence';
  }
  return value.replaceAll('_', ' ');
}

function reportSectionPreview(section: ResearchContinuityEntryResponse['sections'][number]): {
  hiddenCount: number;
  items: string[];
} {
  const items =
    section.items.length > 0
      ? section.items
      : [section.empty_state ? section.empty_state : 'No changes reported.'];
  return {
    hiddenCount: Math.max(0, items.length - 2),
    items: items.slice(0, 2),
  };
}

function formatCoverage(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : String(value);
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function evidenceRecords(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return item as JsonRecord;
      }
      const text = stringValue(item, '');
      return text
        ? {
            text,
            evidence_kind: 'reasoning',
            source_artifact: 'trade_thesis',
          }
        : null;
    })
    .filter((item): item is JsonRecord => item !== null);
}

function stringValue(value: unknown, fallback = 'n/a'): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

function numberValue(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
