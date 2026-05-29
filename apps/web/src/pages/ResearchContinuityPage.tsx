import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  FileText,
  Layers,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  getResearchContinuityState,
  listResearchContinuityEntries,
  previewResearchContinuityRepair,
  runResearchContinuityRepair,
} from '@/services/research-continuity';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { IdChip, StatusBadge } from '@/components/research/badges';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import type {
  JsonRecord,
  ResearchContinuityEntrySummaryResponse,
  ResearchContinuityRepairCaseType,
  ResearchContinuityRepairPreviewResponse,
  ResearchContinuityRepairRunResponse,
  ResearchContinuityStateResponse,
  ResearchContinuityThinReport,
} from '@/types';

const ITEM_TYPES = ['claim', 'risk', 'watchpoint', 'invalidation', 'level'] as const;
const REPAIR_CASE_TYPES: ResearchContinuityRepairCaseType[] = [
  'missing_continuity',
  'skipped_or_degraded',
  'legacy_evidence',
];
const ENABLE_RESEARCH_CONTINUITY_REPAIR = booleanViteEnv(
  'VITE_ENABLE_RESEARCH_CONTINUITY_REPAIR',
  false,
);

type DisplayReportSection = ResearchContinuityThinReport['sections'][number];

export function ResearchContinuityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSymbol = searchParams.get('symbol') ?? 'BTC/USDT';
  const [symbolInput, setSymbolInput] = useState(selectedSymbol);
  const symbol = useMemo(() => selectedSymbol.trim() || 'BTC/USDT', [selectedSymbol]);
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
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
  const quality = record(state?.data_quality ?? latestEntry?.thin_report?.quality);

  function refreshContinuityQueries() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuityState(symbol),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuityEntries({ symbol, limit: 10 }),
    });
  }

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

        {ENABLE_RESEARCH_CONTINUITY_REPAIR ? (
          <Panel
            className="span-12 research-continuity-panel"
            title="Repair & Backfill"
            description="Manual V1.3 continuity ledger control"
          >
            <RepairBackfillPanel
              auth={auth}
              onExecuted={refreshContinuityQueries}
              symbol={symbol}
            />
          </Panel>
        ) : null}

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

function booleanViteEnv(key: string, fallback: boolean): boolean {
  const value = import.meta.env[key];
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function CurrentView({
  state,
  latestEntry,
}: {
  state: ResearchContinuityStateResponse | null;
  latestEntry: ResearchContinuityEntrySummaryResponse | null;
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

function RepairBackfillPanel({
  auth,
  onExecuted,
  symbol,
}: {
  auth: WorkspaceRequestContext;
  onExecuted: () => void;
  symbol: string;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(25);
  const [caseTypes, setCaseTypes] =
    useState<ResearchContinuityRepairCaseType[]>(REPAIR_CASE_TYPES);
  const previewMutation = useMutation<ResearchContinuityRepairPreviewResponse>({
    mutationFn: () =>
      previewResearchContinuityRepair(
        {
          symbol,
          from: from || undefined,
          to: to || undefined,
          case_types: caseTypes,
          limit,
        },
        auth,
      ),
  });
  const runMutation = useMutation<ResearchContinuityRepairRunResponse, Error, boolean>({
    mutationFn: (dryRun) =>
      runResearchContinuityRepair(
        {
          symbol,
          from: from || undefined,
          to: to || undefined,
          case_types: caseTypes,
          limit,
          dry_run: dryRun,
        },
        auth,
      ),
    onSuccess: (result) => {
      if (!result.dry_run && result.repaired_count > 0) {
        onExecuted();
      }
    },
  });
  const preview = previewMutation.data;
  const results = runMutation.data;
  const busy = previewMutation.isPending || runMutation.isPending;
  const canRun = Boolean(preview) && caseTypes.length > 0 && !busy;

  function toggleCaseType(caseType: ResearchContinuityRepairCaseType) {
    setCaseTypes((current) =>
      current.includes(caseType)
        ? current.filter((item) => item !== caseType)
        : [...current, caseType],
    );
  }

  function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    previewMutation.mutate();
  }

  return (
    <div className="research-continuity-repair">
      <form className="research-continuity-repair-form" onSubmit={submitPreview}>
        <label>
          <span>From</span>
          <input
            className="input"
            onChange={(event) => setFrom(event.target.value)}
            type="datetime-local"
            value={from}
          />
        </label>
        <label>
          <span>To</span>
          <input
            className="input"
            onChange={(event) => setTo(event.target.value)}
            type="datetime-local"
            value={to}
          />
        </label>
        <label>
          <span>Limit</span>
          <input
            className="input"
            max={100}
            min={1}
            onChange={(event) => setLimit(clampLimit(event.target.value))}
            type="number"
            value={limit}
          />
        </label>
        <div className="research-continuity-repair-cases" role="group">
          {REPAIR_CASE_TYPES.map((caseType) => (
            <label className="checkbox-row" key={caseType}>
              <input
                checked={caseTypes.includes(caseType)}
                onChange={() => toggleCaseType(caseType)}
                type="checkbox"
              />
              <span>{repairCaseLabel(caseType)}</span>
            </label>
          ))}
        </div>
        <div className="research-continuity-repair-actions">
          <button className="button" disabled={busy || caseTypes.length === 0} type="submit">
            <Search aria-hidden size={15} />
            Preview
          </button>
          <button
            className="button"
            disabled={!canRun}
            onClick={() => runMutation.mutate(true)}
            type="button"
          >
            <Wrench aria-hidden size={15} />
            Dry run
          </button>
          <button
            className="button primary"
            disabled={!canRun}
            onClick={() => runMutation.mutate(false)}
            type="button"
          >
            <Play aria-hidden size={15} />
            Execute repair
          </button>
        </div>
      </form>

      {previewMutation.isError ? <ErrorState error={previewMutation.error} /> : null}
      {runMutation.isError ? <ErrorState error={runMutation.error} /> : null}
      {previewMutation.isPending || runMutation.isPending ? (
        <LoadingState label="Running continuity repair check..." />
      ) : null}

      {preview ? <RepairCandidateTable preview={preview} /> : null}
      {results ? <RepairRunResults results={results} /> : null}
    </div>
  );
}

function RepairCandidateTable({
  preview,
}: {
  preview: ResearchContinuityRepairPreviewResponse;
}) {
  if (preview.candidates.length === 0) {
    return <EmptyState label="No repair candidates found." />;
  }
  return (
    <div className="table-scroll">
      <table className="table research-continuity-repair-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Completed</th>
            <th>Case</th>
            <th>Status</th>
            <th>Eligible</th>
            <th>Action</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {preview.candidates.map((candidate) => (
            <tr key={candidate.candidate_id}>
              <td>
                <IdChip value={candidate.run_id} />
              </td>
              <td>{formatDateTime(candidate.run_completed_at)}</td>
              <td>{repairCaseLabel(candidate.case_type)}</td>
              <td>
                {candidate.current_entry_status ? (
                  <StatusBadge value={candidate.current_entry_status} />
                ) : (
                  <span className="badge">none</span>
                )}
              </td>
              <td>
                <span className={`badge ${candidate.eligible ? 'constructive' : 'warning'}`}>
                  {candidate.eligible ? 'yes' : 'no'}
                </span>
              </td>
              <td>{repairActionLabel(candidate.predicted_action)}</td>
              <td>{candidate.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepairRunResults({
  results,
}: {
  results: ResearchContinuityRepairRunResponse;
}) {
  return (
    <div className="research-continuity-repair-results">
      <div className="research-continuity-repair-summary">
        <span className="badge primary">{results.dry_run ? 'dry run' : 'executed'}</span>
        <span className="badge constructive">{results.repaired_count} repaired</span>
        <span className="badge">{results.skipped_count} skipped</span>
        <span className={results.failed_count > 0 ? 'badge warning' : 'badge'}>
          {results.failed_count} failed
        </span>
      </div>
      {results.results.length === 0 ? <EmptyState label="No repair results." /> : null}
      {results.results.length > 0 ? (
        <div className="table-scroll">
          <table className="table research-continuity-repair-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Case</th>
                <th>Action</th>
                <th>New entry</th>
                <th>State</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((result) => (
                <tr key={`${result.candidate_id}-${result.action}`}>
                  <td>
                    <IdChip value={result.run_id} />
                  </td>
                  <td>{repairCaseLabel(result.case_type)}</td>
                  <td>{repairActionLabel(result.action)}</td>
                  <td>
                    <IdChip value={result.new_entry_id} />
                  </td>
                  <td>{result.state_updated ? 'updated' : 'unchanged'}</td>
                  <td>{result.error ?? result.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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

function LatestReport({ entry }: { entry: ResearchContinuityEntrySummaryResponse | null }) {
  if (!entry) {
    return <EmptyState label="No latest continuity report." />;
  }
  const sections = entry.thin_report?.sections ?? [];
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
            Open source run
          </Link>
          {entry.id ? (
            <Link className="button" to={`/research-continuity/entries/${entry.id}`}>
              Details
            </Link>
          ) : null}
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
            <section className="continuity-report-section" key={reportSectionKey(section)}>
              <h4>{section.title}</h4>
              <ul>
                {preview.items.map((item, index) => (
                  <li key={`${reportSectionKey(section)}-${index}`}>{item}</li>
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
  entry: ResearchContinuityEntrySummaryResponse;
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
          Open source run
        </Link>
        {entry.id ? (
          <Link className="button" to={`/research-continuity/entries/${entry.id}`}>
            Details
          </Link>
        ) : null}
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

function reportSectionPreview(
  section: DisplayReportSection,
): {
  hiddenCount: number;
  items: string[];
} {
  const items = section.items.length > 0 ? section.items : ['No changes reported.'];
  return {
    hiddenCount: 0,
    items,
  };
}

function reportSectionKey(section: DisplayReportSection): string {
  return section.id;
}

function repairCaseLabel(value: ResearchContinuityRepairCaseType): string {
  switch (value) {
    case 'missing_continuity':
      return 'Missing continuity';
    case 'skipped_or_degraded':
      return 'Skipped or degraded';
    case 'legacy_evidence':
      return 'Legacy evidence';
    default:
      return value;
  }
}

function repairActionLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function clampLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 25;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
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
