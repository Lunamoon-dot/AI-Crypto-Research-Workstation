import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  FileText,
  History,
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
          <form className="top-strip-meta" onSubmit={applySymbol}>
            <label className="field">
              <span>Symbol</span>
              <input
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

      <BentoGrid>
        <Panel className="span-4 emphasis" title="Current View">
          {stateQuery.isLoading ? <LoadingState label="Loading continuity state..." /> : null}
          {!stateQuery.isLoading ? <CurrentView state={state} latestEntry={latestEntry} /> : null}
        </Panel>

        <Panel className="span-8" title="Trust And Quality">
          <TrustQuality quality={quality} />
        </Panel>

        <Panel className="span-7" title="Active Items">
          <ActiveItems state={state} />
        </Panel>

        <Panel className="span-5" title="Latest Delta Report">
          <LatestReport entry={latestEntry} />
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
  return (
    <div className="stack">
      <div className="bento-grid compact">
        <DataPair label="Directional bias" value={stringValue(view.directional_bias)} />
        <DataPair label="Risk posture" value={stringValue(view.risk_posture)} />
        <DataPair label="Conviction" value={stringValue(view.conviction)} />
        <DataPair label="Time context" value={stringValue(view.time_context)} />
        <DataPair label="Latest run" value={<IdChip value={state.latest_run_id} />} />
        <DataPair label="Latest entry" value={<IdChip value={state.latest_entry_id} />} />
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
    <div className="bento-grid compact">
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
    <div className="stack">
      {ITEM_TYPES.map((type) => {
        const group = items.filter((item) => item.type === type);
        if (group.length === 0) {
          return null;
        }
        return (
          <section className="stack small" key={type}>
            <div className="row">
              <strong>{typeLabel(type)}</strong>
              <span className="badge">{group.length}</span>
            </div>
            {group.map((item, index) => (
              <div className="list-row" key={String(item.item_key ?? `${type}-${index}`)}>
                <div className="row">
                  <span className="badge">{stringValue(item.importance, 'medium')}</span>
                  <TraceBadge value={stringValue(item.trace_quality, 'unsourced')} />
                  <span className="small muted">
                    {numberValue(item.occurrence_count) || 1} seen
                  </span>
                </div>
                <p className="small muted">{stringValue(item.current_text ?? item.text)}</p>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function LatestReport({ entry }: { entry: ResearchContinuityEntryResponse | null }) {
  if (!entry) {
    return <EmptyState label="No latest continuity report." />;
  }
  return (
    <div className="stack">
      <div className="row">
        <span className="badge primary">{entry.entry_type}</span>
        <StatusBadge value={entry.status} />
        <span className="small muted">{formatDateTime(entry.generated_at)}</span>
      </div>
      <p className="muted">{entry.summary}</p>
      <div className="stack small">
        {entry.sections.map((section) => (
          <details key={section.title}>
            <summary className="button">{section.title}</summary>
            <ul className="stack small">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ))}
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

function typeLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1) + 's';
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
