import { FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Filter,
  FileText,
  GitBranch,
  Layers,
  Play,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  getResearchContinuityRepairRun,
  getResearchContinuityScheduler,
  getResearchContinuitySettings,
  getResearchContinuityState,
  getResearchContinuityTimeline,
  listResearchContinuityEntries,
  listResearchContinuityRepairRuns,
  previewResearchContinuityRepair,
  runDueResearchContinuityScheduler,
  runResearchContinuityRepair,
  updateResearchContinuitySettings,
} from '@/services/research-continuity';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
import { JsonView } from '@/components/research/json-view';
import { Panel } from '@/components/research/panel';
import { IdChip, StatusBadge } from '@/components/research/badges';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  filterLifecycleTimelineEvents,
  lifecycleStatusFilterOptions,
  lifecycleStatusCounts,
  selectedLifecycleTimelineEvents,
  windowedLifecycleLabel,
} from './research-continuity-lifecycle';
import {
  buildActiveScenarioBranchViews,
  buildCapturedContinuityMemoryGroups,
  buildContinuitySnapshotView,
} from './research-continuity-current-view';
import {
  RESEARCH_CONTINUITY_TABS,
  normalizeResearchContinuityTab,
  setResearchContinuityTabParam,
  type ResearchContinuityTab,
} from './research-continuity-tabs';
import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import type {
  JsonRecord,
  ResearchContinuityLifecycleItemResponse,
  ResearchContinuityLifecycleItemType,
  ResearchContinuityLifecycleStatus,
  ResearchContinuityEntrySummaryResponse,
  ResearchContinuityRepairCaseType,
  ResearchContinuityRepairPreviewResponse,
  ResearchContinuityRepairRunDetailResponse,
  ResearchContinuityRepairRunResponse,
  ResearchContinuityRepairRunSummaryResponse,
  ResearchContinuityScheduledRepairMode,
  ResearchContinuitySchedulerRunDueResponse,
  ResearchContinuityWorkspaceSettingsResponse,
  ResearchContinuityStateResponse,
  ResearchContinuityThinReport,
  ResearchContinuityTimelineEventResponse,
  ResearchContinuityTimelineResponse,
  UpdateResearchContinuitySettingsRequest,
} from '@/types';

const ITEM_TYPES = ['claim', 'risk', 'watchpoint', 'invalidation', 'level'] as const;
const LIFECYCLE_ITEM_TYPE_OPTIONS: Array<
  ResearchContinuityLifecycleItemType | 'all'
> = ['all', 'claim', 'risk', 'watchpoint', 'level', 'invalidation', 'scenario'];
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
  const auth = useWorkspaceStore();
  const fixedWorkspaceSymbol = auth.fixedWorkspaceSymbol();
  const selectedSymbol = searchParams.get('symbol') ?? 'BTC/USDT';
  const effectiveSelectedSymbol = fixedWorkspaceSymbol ?? selectedSymbol;
  const activeTab = normalizeResearchContinuityTab(searchParams.get('tab'));
  const [lifecycleItemType, setLifecycleItemType] =
    useState<ResearchContinuityLifecycleItemType | 'all'>('all');
  const [lifecycleStatus, setLifecycleStatus] =
    useState<ResearchContinuityLifecycleStatus | 'all'>('all');
  const [includeLifecycleContext, setIncludeLifecycleContext] = useState(false);
  const [selectedLifecycleItemKey, setSelectedLifecycleItemKey] = useState<
    string | null
  >(null);
  const symbol = useMemo(
    () => (fixedWorkspaceSymbol ?? effectiveSelectedSymbol.trim()) || 'BTC/USDT',
    [effectiveSelectedSymbol, fixedWorkspaceSymbol],
  );
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
  const timelineQuery = useQuery({
    queryKey: queryKeys.researchContinuityTimeline({
      include_context: includeLifecycleContext,
      limit: 50,
      symbol,
    }),
    queryFn: () =>
      getResearchContinuityTimeline(
        symbol,
        { include_context: includeLifecycleContext, limit: 50 },
        auth,
      ),
    enabled: Boolean(symbol) && activeTab === 'lifecycle',
    retry: false,
  });

  useEffect(() => {
    setSelectedLifecycleItemKey(null);
  }, [symbol, lifecycleItemType, lifecycleStatus, includeLifecycleContext]);

  function selectTab(tab: ResearchContinuityTab) {
    setSearchParams(setResearchContinuityTabParam(searchParams, tab));
  }

  const state = stateQuery.data?.state ?? null;
  const entries = entriesQuery.data?.entries ?? [];
  const latestEntry = stateQuery.data?.latest_entry ?? entries[0] ?? null;
  const quality = record(state?.data_quality ?? latestEntry?.thin_report?.quality);
  const snapshotView = buildContinuitySnapshotView({ state, latestEntry });
  const activeItemCount = state?.active_items.length ?? 0;
  const tabMemoryLabel =
    snapshotView?.memoryKind === 'captured'
      ? snapshotView.memoryLabel
      : `${activeItemCount} memory`;
  const qualityStatus = stringValue(quality.status, 'unknown');

  function refreshContinuityQueries() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuityState(symbol),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuityEntries({ symbol, limit: 10 }),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuityTimeline({
        include_context: includeLifecycleContext,
        limit: 50,
        symbol,
      }),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuityRepairRuns({ limit: 5 }),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuitySettings(),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.researchContinuityScheduler(),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.operationsHealth({ limit: 50 }),
    });
  }

  return (
    <main className="page">
      {stateQuery.isError ? <ErrorState error={stateQuery.error} /> : null}
      {entriesQuery.isError ? <ErrorState error={entriesQuery.error} /> : null}
      {activeTab === 'lifecycle' && timelineQuery.isError ? (
        <ErrorState error={timelineQuery.error} />
      ) : null}

      <ResearchContinuityTabs
        activeTab={activeTab}
        entriesCount={entries.length}
        evidenceStatus={qualityStatus}
        memoryLabel={tabMemoryLabel}
        onSelect={selectTab}
      />

      {activeTab === 'general' ? (
        <BentoGrid className="research-continuity-grid">
          <Panel
            className="span-4 emphasis research-continuity-panel"
            title="Continuity snapshot"
            description="State carried into the next research run"
          >
            {stateQuery.isLoading ? <LoadingState label="Loading continuity state..." /> : null}
            {!stateQuery.isLoading ? <CurrentView state={state} latestEntry={latestEntry} /> : null}
          </Panel>

          <Panel
            className="span-8 research-continuity-panel"
            title="Latest research delta"
            description="Newest transition from the research ledger"
          >
            <LatestReport entry={latestEntry} />
          </Panel>

          <Panel
            className="span-12 research-continuity-panel"
            title="Active research memory"
            description="Claims, risks, monitored signals, invalidations, and levels"
          >
            <ActiveItems latestEntry={latestEntry} state={state} />
          </Panel>

          <Panel
            className="span-12 research-continuity-panel"
            title="Evidence health"
            description="Snapshot quality and source coverage"
          >
            <TrustQuality quality={quality} />
          </Panel>

          <Panel className="span-12" title="Continuity entries">
            {entriesQuery.isLoading ? <LoadingState label="Loading continuity entries..." /> : null}
            {!entriesQuery.isLoading && entries.length === 0 ? (
              <EmptyState label="No continuity entries found." />
            ) : null}
            <div className="stack">
              {entries.map((entry) => (
                <ContinuityEntryRow entry={entry} key={entry.id ?? entry.research_run_id} />
              ))}
            </div>
          </Panel>
        </BentoGrid>
      ) : null}

      {activeTab === 'lifecycle' ? (
        <BentoGrid className="research-continuity-grid">
          <Panel
            className="span-12 research-continuity-panel"
            title="Item Lifecycle"
            description="Timeline rollups for claims, risks, watchpoints, levels, and invalidations"
          >
            <ItemLifecycleSection
              includeContext={includeLifecycleContext}
              isLoading={timelineQuery.isLoading}
              itemType={lifecycleItemType}
              onIncludeContextChange={setIncludeLifecycleContext}
              onItemTypeChange={setLifecycleItemType}
              onSelectedItemChange={setSelectedLifecycleItemKey}
              onStatusChange={setLifecycleStatus}
              selectedItemKey={selectedLifecycleItemKey}
              status={lifecycleStatus}
              timeline={timelineQuery.data ?? null}
            />
          </Panel>
        </BentoGrid>
      ) : null}

      {activeTab === 'repair' ? (
        <BentoGrid className="research-continuity-grid">
          <Panel
            className="span-12 research-continuity-panel"
            title="Ledger repair"
            description="Manual continuity ledger control"
          >
            <ResearchContinuityMaintenancePanel
              auth={auth}
              onExecuted={refreshContinuityQueries}
              symbol={symbol}
            />
          </Panel>
        </BentoGrid>
      ) : null}
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

function ResearchContinuityTabs({
  activeTab,
  entriesCount,
  evidenceStatus,
  memoryLabel,
  onSelect,
}: {
  activeTab: ResearchContinuityTab;
  entriesCount: number;
  evidenceStatus: string;
  memoryLabel: string;
  onSelect: (tab: ResearchContinuityTab) => void;
}) {
  return (
    <nav className="research-continuity-tabs" aria-label="Research continuity sections">
      <div className="research-continuity-tab-list" role="tablist">
        {RESEARCH_CONTINUITY_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              aria-selected={isActive}
              className={isActive ? 'research-continuity-tab active' : 'research-continuity-tab'}
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              role="tab"
              type="button"
            >
              <span className="research-continuity-tab-icon">
                {researchContinuityTabIcon(tab.id)}
              </span>
              <span className="research-continuity-tab-copy">
                <strong>{tab.label}</strong>
                <span>
                  {researchContinuityTabMeta({
                    entriesCount,
                    evidenceStatus,
                    memoryLabel,
                    tab: tab.id,
                  })}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function researchContinuityTabIcon(tab: ResearchContinuityTab): ReactNode {
  switch (tab) {
    case 'lifecycle':
      return <GitBranch aria-hidden size={16} />;
    case 'repair':
      return <Wrench aria-hidden size={16} />;
    default:
      return <FileText aria-hidden size={16} />;
  }
}

function researchContinuityTabMeta({
  entriesCount,
  evidenceStatus,
  memoryLabel,
  tab,
}: {
  entriesCount: number;
  evidenceStatus: string;
  memoryLabel: string;
  tab: ResearchContinuityTab;
}): string {
  switch (tab) {
    case 'lifecycle':
      return 'Tracked item history and state changes';
    case 'repair':
      return 'Scheduler controls and repair runs';
    default:
      return `${memoryLabel} / ${entriesCount} entries / ${evidenceStatus} evidence`;
  }
}

function ItemLifecycleSection({
  includeContext,
  isLoading,
  itemType,
  onIncludeContextChange,
  onItemTypeChange,
  onSelectedItemChange,
  onStatusChange,
  selectedItemKey,
  status,
  timeline,
}: {
  includeContext: boolean;
  isLoading: boolean;
  itemType: ResearchContinuityLifecycleItemType | 'all';
  onIncludeContextChange: (value: boolean) => void;
  onItemTypeChange: (value: ResearchContinuityLifecycleItemType | 'all') => void;
  onSelectedItemChange: (value: string | null) => void;
  onStatusChange: (value: ResearchContinuityLifecycleStatus | 'all') => void;
  selectedItemKey: string | null;
  status: ResearchContinuityLifecycleStatus | 'all';
  timeline: ResearchContinuityTimelineResponse | null;
}) {
  if (isLoading) {
    return <LoadingState label="Loading item lifecycle..." />;
  }
  if (!timeline || timeline.lifecycle_items.length === 0) {
    return <EmptyState label="No lifecycle items found in the loaded window." />;
  }
  const counts = lifecycleStatusCounts(timeline);
  const windowLabel = windowedLifecycleLabel(timeline);
  const filteredItems = timeline.lifecycle_items.filter(
    (item) =>
      (itemType === 'all' || item.item_type === itemType) &&
      (status === 'all' || item.status === status),
  );
  const selectedItem =
    filteredItems.find((item) => item.stable_item_key === selectedItemKey) ??
    filteredItems[0] ??
    null;
  const selectedEvents = selectedLifecycleTimelineEvents(
    timeline,
    selectedItem?.stable_item_key ?? null,
  );
  const visibleSelectedEvents = filterLifecycleTimelineEvents(selectedEvents, {
    itemType,
    status,
  });

  return (
    <div className="research-continuity-lifecycle">
      <div className="lifecycle-toolbar">
        <label className="lifecycle-filter-field">
          <span>Item type</span>
          <select
            className="input lifecycle-select"
            onChange={(event) =>
              onItemTypeChange(
                event.target.value as ResearchContinuityLifecycleItemType | 'all',
              )
            }
            value={itemType}
          >
            {LIFECYCLE_ITEM_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {lifecycleOptionLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <div className="lifecycle-filter-field lifecycle-status-field">
          <span>Status</span>
          <div className="lifecycle-status-buttons" role="group" aria-label="Status">
            {lifecycleStatusFilterOptions().map((option) => {
              const isActive = option.value === status;
              return (
                <button
                  aria-pressed={isActive}
                  className={
                    isActive
                      ? 'lifecycle-status-button active'
                      : 'lifecycle-status-button'
                  }
                  key={option.value}
                  onClick={() => onStatusChange(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="lifecycle-filter-summary" aria-label="Lifecycle filters">
          <Filter aria-hidden size={14} />
          <span>{filteredItems.length} items shown</span>
        </div>
        <label className="checkbox-row lifecycle-context-toggle">
          <input
            checked={includeContext}
            onChange={(event) => onIncludeContextChange(event.target.checked)}
            type="checkbox"
          />
          <span>Context</span>
        </label>
      </div>

      <div className="lifecycle-counts">
        {Object.entries(counts).map(([key, value]) => (
          <span className={lifecycleBadgeClass(key)} key={key}>
            {lifecycleStatusLabel(key)} {value}
          </span>
        ))}
        <span className="badge mono">{timeline.event_count} events</span>
        <span className="badge mono">{timeline.entry_count} entries</span>
      </div>

      {windowLabel ? <div className="lifecycle-window-warning">{windowLabel}</div> : null}
      {timeline.warnings.length > 0 ? (
        <div className="lifecycle-warning-list">
          <span className="badge warning">{lifecycleWarningSummary(timeline)}</span>
        </div>
      ) : null}

      <div className="lifecycle-layout">
        <div className="lifecycle-item-list">
          <div className="lifecycle-list-header">
            <strong>Items</strong>
            <span className="small muted">{filteredItems.length} shown</span>
          </div>
          {filteredItems.length === 0 ? (
            <EmptyState label="No lifecycle items match these filters." />
          ) : null}
          {filteredItems.map((item) => (
            <LifecycleItemButton
              item={item}
              isSelected={item.stable_item_key === selectedItem?.stable_item_key}
              key={item.stable_item_key}
              onSelect={() => onSelectedItemChange(item.stable_item_key)}
            />
          ))}
        </div>

        <div className="lifecycle-event-history">
          <div className="row">
            <div className="row start">
              <GitBranch aria-hidden size={15} />
              <span className="small muted">Selected lifecycle item</span>
            </div>
            {selectedItem ? <StatusBadge value={selectedItem.status} /> : null}
          </div>
          {selectedItem ? (
            <div className="lifecycle-detail-header">
              <strong>{selectedItem.title}</strong>
              <div className="lifecycle-selected-meta">
                <LifecycleMetric
                  label="First seen"
                  value={formatDateTime(selectedItem.first_seen_at)}
                />
                <LifecycleMetric
                  label="Last seen"
                  value={formatDateTime(selectedItem.last_seen_at)}
                />
                <LifecycleMetric
                  label="Occurrences"
                  value={selectedItem.occurrence_count}
                />
                <LifecycleMetric
                  label="Latest entry"
                  value={<IdChip value={selectedItem.latest_entry_id} />}
                />
              </div>
            </div>
          ) : null}
          {!selectedItem ? <EmptyState label="Select an item to inspect its events." /> : null}
          {selectedItem && visibleSelectedEvents.length === 0 ? (
            <EmptyState label="No selected item events match these filters." />
          ) : null}
          {visibleSelectedEvents.map((event) => (
            <LifecycleEventRow event={event} key={event.id} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LifecycleItemButton({
  item,
  isSelected,
  onSelect,
}: {
  item: ResearchContinuityLifecycleItemResponse;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={isSelected ? 'lifecycle-item-row selected' : 'lifecycle-item-row'}
      onClick={onSelect}
      type="button"
    >
      <div className="row">
        <span className={lifecycleBadgeClass(item.status)}>
          {lifecycleStatusLabel(item.status)}
        </span>
        <span className="lifecycle-item-type">{lifecycleOptionLabel(item.item_type)}</span>
        <span className="small muted">{formatDateTime(item.last_seen_at)}</span>
      </div>
      <strong>{item.title}</strong>
      <div className="lifecycle-item-meta">
        <span>{item.occurrence_count} seen</span>
        <span>{item.entry_count} entries</span>
        <span>{item.source_artifacts.slice(0, 2).join(' / ') || 'No source'}</span>
      </div>
    </button>
  );
}

function LifecycleMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="lifecycle-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LifecycleEventRow({
  event,
}: {
  event: ResearchContinuityTimelineEventResponse;
}) {
  const before = nonDuplicateTimelineText(event.before, event.title);
  const after = nonDuplicateTimelineText(event.after, event.title);
  const reason = nonDuplicateTimelineText(event.reason, event.title);
  return (
    <article className="lifecycle-event-row">
      <div className="lifecycle-event-date">
        <span>{formatDateTime(event.observed_at ?? event.recorded_at)}</span>
        <span className="badge">{event.event_type.replaceAll('_', ' ')}</span>
      </div>
      <div className="lifecycle-event-body">
        <div className="row start">
          <span className={lifecycleBadgeClass(event.status)}>
            {lifecycleStatusLabel(event.status)}
          </span>
          <span className={eventSeverityBadgeClass(event.severity)}>
            {event.severity}
          </span>
          <span className={diffQualityBadgeClass(event.diff_quality)}>
            {event.diff_quality}
          </span>
          {event.is_repair ? <span className="badge primary">repair</span> : null}
          {event.evidence_status ? (
            <span className="badge">{event.evidence_status.replaceAll('_', ' ')}</span>
          ) : null}
        </div>
        <p className="lifecycle-event-title">{event.title}</p>
        {reason || before || after ? (
          <div className="lifecycle-event-diff">
            {reason ? (
              <div className="lifecycle-diff-line">
                <span>Reason</span>
                <strong>{reason}</strong>
              </div>
            ) : null}
            {before ? (
              <div className="lifecycle-diff-line">
                <span>Before</span>
                <strong>{before}</strong>
              </div>
            ) : null}
            {after ? (
              <div className="lifecycle-diff-line">
                <span>After</span>
                <strong>{after}</strong>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="lifecycle-event-source">
          <Link to={routes.researchContinuityEntry(event.entry_id)}>Entry</Link>
          {event.research_run_id ? (
            <Link to={routes.researchRun(event.research_run_id)}>Run</Link>
          ) : null}
          {event.source_run_id ? (
            <Link to={routes.researchRun(event.source_run_id)}>Source run</Link>
          ) : null}
          {event.source_entry_id ? (
            <Link to={routes.researchContinuityEntry(event.source_entry_id)}>
              Source entry
            </Link>
          ) : null}
          <span>
            {[event.source_artifact, event.source_id, event.source_field]
              .filter(Boolean)
              .join(' / ') || 'No source line'}
          </span>
        </div>
      </div>
    </article>
  );
}

function nonDuplicateTimelineText(value: string | null, title: string): string | null {
  if (!value) {
    return null;
  }
  return value.trim() === title.trim() ? null : value;
}

function lifecycleWarningSummary(
  timeline: Pick<ResearchContinuityTimelineResponse, 'warnings'>,
): string {
  const partialCount = timeline.warnings.filter((warning) =>
    warning.includes('partial diff quality'),
  ).length;
  const unavailableCount = timeline.warnings.filter((warning) =>
    warning.includes('unavailable diff quality'),
  ).length;
  const labels = [
    partialCount > 0 ? `${partialCount} partial` : null,
    unavailableCount > 0 ? `${unavailableCount} unavailable` : null,
  ].filter(Boolean);
  return labels.length > 0
    ? `Diff quality warnings: ${labels.join(', ')}`
    : timeline.warnings[0] ?? 'Timeline warnings available';
}

function CurrentView({
  state,
  latestEntry,
}: {
  state: ResearchContinuityStateResponse | null;
  latestEntry: ResearchContinuityEntrySummaryResponse | null;
}) {
  const snapshot = buildContinuitySnapshotView({ state, latestEntry });
  if (!snapshot) {
    return <EmptyState label="No continuity state for this symbol yet." />;
  }
  return (
    <div className="continuity-current-view">
      <div className="continuity-current-focus">
        <span className="small muted">Current stance</span>
        <strong>{snapshot.directionalBias}</strong>
        <p>
          {snapshot.riskPosture} risk posture / {snapshot.conviction} conviction /{' '}
          {snapshot.timeContext}
        </p>
      </div>
      <div className="research-continuity-data-grid">
        <DataPair label="Latest run" value={<IdChip value={snapshot.latestRunId} />} />
        <DataPair label="Latest entry" value={<IdChip value={snapshot.latestEntryId} />} />
        <DataPair label="Time context" value={snapshot.timeContext} />
      </div>
      <div className="row">
        <span className={`badge ${snapshot.memoryKind === 'captured' ? 'warning' : 'primary'}`}>
          <Activity aria-hidden size={13} />
          {snapshot.memoryLabel}
        </span>
        <StatusBadge value={latestEntry?.status ?? 'unknown'} />
        <span className="small muted">{formatDateTime(snapshot.updatedAt)}</span>
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
        meta={quality.score === undefined ? null : `Quality score ${String(quality.score)}`}
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
        meta={`${numberValue(quality.evidence_attached_count)} evidence attached`}
        tone="constructive"
      />
      <MetricTile
        icon={<FileText aria-hidden size={15} />}
        label="Observed item coverage"
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

function ActiveItems({
  latestEntry,
  state,
}: {
  latestEntry: ResearchContinuityEntrySummaryResponse | null;
  state: ResearchContinuityStateResponse | null;
}) {
  const items = records(state?.active_items);
  const scenarios = buildActiveScenarioBranchViews(state);
  if (items.length === 0 && scenarios.length === 0) {
    const snapshot = buildContinuitySnapshotView({ state, latestEntry });
    const capturedGroups = buildCapturedContinuityMemoryGroups(latestEntry);
    if (snapshot?.memoryKind === 'captured' && capturedGroups.length > 0) {
      return (
        <div className="continuity-active-items">
          {capturedGroups.map((group) => (
            <section className="continuity-item-group" key={group.id}>
              <div className="continuity-item-group-header">
                <div>
                  <strong>{group.title}</strong>
                  <span>{group.description}</span>
                </div>
                <span className="badge warning">{group.items.length}</span>
              </div>
              {group.items.map((item, index) => (
                <article className="continuity-active-item" key={`${group.id}-${index}`}>
                  <div className="continuity-active-item-main">
                    <div className="continuity-active-item-meta">
                      <span className="badge warning">captured</span>
                      <StatusBadge value={latestEntry?.status ?? 'degraded'} />
                    </div>
                    <p>{item}</p>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      );
    }
    if (snapshot?.memoryKind === 'captured') {
      const noun = snapshot.capturedItemCount === 1 ? 'item was' : 'items were';
      return (
        <EmptyState
          label={`${snapshot.capturedItemCount} captured ${noun} saved in the latest degraded entry but not promoted to active memory.`}
        />
      );
    }
    return <EmptyState label="No active tracked items." />;
  }
  return (
    <div className="continuity-active-items">
      {scenarios.length > 0 ? (
        <section className="continuity-item-group">
          <div className="continuity-item-group-header">
            <div>
              <strong>Scenario branches</strong>
              <span>Conditional thesis paths carried in continuity</span>
            </div>
            <span className="badge">{scenarios.length}</span>
          </div>
          {scenarios.slice(0, 6).map((scenario) => (
            <article className="continuity-active-item" key={scenario.key}>
              <div className="continuity-active-item-main">
                <div className="continuity-active-item-meta">
                  <span className="badge">{scenario.horizon}</span>
                  <span className="badge">{scenario.timeframeLabel}</span>
                  <span className="badge primary">{scenario.probabilityBand}</span>
                  <span className="badge">{scenario.branchType}</span>
                </div>
                <p>{scenario.condition}</p>
              </div>
              <div className="continuity-active-item-side">
                <span className="small muted">{scenario.occurrenceCount} seen</span>
              </div>
            </article>
          ))}
        </section>
      ) : null}
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

function ResearchContinuityMaintenancePanel({
  auth,
  onExecuted,
  symbol,
}: {
  auth: WorkspaceRequestContext;
  onExecuted: () => void;
  symbol: string;
}) {
  return (
    <div className="research-continuity-maintenance">
      <SchedulerControlsPanel auth={auth} onExecuted={onExecuted} />
      {ENABLE_RESEARCH_CONTINUITY_REPAIR ? (
        <RepairBackfillPanel
          auth={auth}
          onExecuted={onExecuted}
          symbol={symbol}
        />
      ) : (
        <RecentRepairRunsPanel auth={auth} />
      )}
    </div>
  );
}

function SchedulerControlsPanel({
  auth,
  onExecuted,
}: {
  auth: WorkspaceRequestContext;
  onExecuted: () => void;
}) {
  const [mode, setMode] =
    useState<ResearchContinuityScheduledRepairMode>('disabled');
  const [caseTypes, setCaseTypes] =
    useState<ResearchContinuityRepairCaseType[]>([
      'missing_continuity',
      'legacy_evidence',
    ]);
  const [intervalHours, setIntervalHours] = useState(24);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [limit, setLimit] = useState(25);
  const settingsQuery = useQuery({
    queryKey: queryKeys.researchContinuitySettings(),
    queryFn: () => getResearchContinuitySettings(auth),
    retry: false,
  });
  const schedulerQuery = useQuery({
    queryKey: queryKeys.researchContinuityScheduler(),
    queryFn: () => getResearchContinuityScheduler(auth),
    retry: false,
  });
  const saveMutation = useMutation<
    ResearchContinuityWorkspaceSettingsResponse,
    Error,
    UpdateResearchContinuitySettingsRequest
  >({
    mutationFn: (request) => updateResearchContinuitySettings(request, auth),
    onSuccess: () => {
      onExecuted();
    },
  });
  const runDueMutation = useMutation<ResearchContinuitySchedulerRunDueResponse>({
    mutationFn: () => runDueResearchContinuityScheduler(auth),
    onSuccess: () => {
      onExecuted();
    },
  });
  const settings = settingsQuery.data;
  const scheduler = schedulerQuery.data;
  const schedulerSettings = scheduler?.settings ?? settings;
  const activeMode = settings?.scheduled_repair_mode ?? mode;
  const due = scheduler?.due ?? false;
  const disabledSkippedCase = mode === 'enabled';

  useEffect(() => {
    if (!settings) {
      return;
    }
    setMode(settings.scheduled_repair_mode);
    setCaseTypes(settings.scheduled_repair_case_types);
    setIntervalHours(settings.scheduled_repair_interval_hours);
    setLookbackDays(settings.scheduled_repair_lookback_days);
    setLimit(settings.scheduled_repair_limit);
  }, [settings]);

  function changeMode(nextMode: ResearchContinuityScheduledRepairMode) {
    setMode(nextMode);
    if (nextMode === 'enabled') {
      setCaseTypes((current) =>
        current.filter((caseType) => caseType !== 'skipped_or_degraded'),
      );
    }
  }

  function toggleCaseType(caseType: ResearchContinuityRepairCaseType) {
    if (caseType === 'skipped_or_degraded' && mode === 'enabled') {
      return;
    }
    setCaseTypes((current) =>
      current.includes(caseType)
        ? current.filter((item) => item !== caseType)
        : [...current, caseType],
    );
  }

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMutation.mutate({
      scheduled_repair_mode: mode,
      scheduled_repair_case_types: caseTypes,
      scheduled_repair_interval_hours: intervalHours,
      scheduled_repair_lookback_days: lookbackDays,
      scheduled_repair_limit: limit,
    });
  }

  return (
    <section className="scheduler-controls-panel">
      <div className="scheduler-controls-header">
        <div>
          <span className="small muted">Scheduled repair</span>
          <strong>{schedulerModeLabel(activeMode)}</strong>
        </div>
        <span className={due ? 'badge warning' : 'badge constructive'}>
          {due ? 'due' : 'not due'}
        </span>
      </div>
      {settingsQuery.isLoading || schedulerQuery.isLoading ? (
        <LoadingState label="Loading scheduler controls..." />
      ) : null}
      {settingsQuery.isError ? <ErrorState error={settingsQuery.error} /> : null}
      {schedulerQuery.isError ? <ErrorState error={schedulerQuery.error} /> : null}

      <div className="scheduler-status-grid">
        <DataPair label="Workspace" value={settings?.workspace_id ?? auth.workspaceId} />
        <DataPair label="Next due" value={formatDateTime(scheduler?.next_scheduled_repair_due_at)} />
        <DataPair label="Last scheduled" value={formatDateTime(scheduler?.last_scheduled_repair_at)} />
        <DataPair label="Last run" value={<IdChip value={scheduler?.last_scheduled_repair_run_id} />} />
        <DataPair label="Last status" value={scheduler?.last_scheduled_repair_status ?? 'none'} />
        <DataPair
          label="Worker enabled"
          value={
            <span className={scheduler?.worker_enabled ? 'badge constructive' : 'badge'}>
              {scheduler?.worker_enabled ? 'enabled' : 'disabled'}
            </span>
          }
        />
        <DataPair
          label="Lease owner"
          value={schedulerSettings?.scheduler_lease_owner ?? 'none'}
        />
        <DataPair
          label="Lease expires"
          value={formatDateTime(schedulerSettings?.scheduler_lease_expires_at)}
        />
        <DataPair
          label="Last attempt"
          value={formatDateTime(schedulerSettings?.last_scheduler_attempt_at)}
        />
        <DataPair
          label="Last success"
          value={formatDateTime(schedulerSettings?.last_scheduler_success_at)}
        />
        <DataPair
          label="Next retry"
          value={formatDateTime(schedulerSettings?.next_scheduler_retry_at)}
        />
        <DataPair
          label="Failures"
          value={schedulerSettings?.consecutive_scheduler_failures ?? 0}
        />
        <DataPair
          label="Last error"
          value={schedulerSettings?.last_scheduler_error ?? 'none'}
        />
      </div>

      <form className="scheduler-settings-form" onSubmit={submitSettings}>
        <div className="scheduler-mode-control" role="group">
          {(['disabled', 'dry_run', 'enabled'] as const).map((item) => (
            <button
              className={mode === item ? 'button primary' : 'button'}
              key={item}
              onClick={() => changeMode(item)}
              type="button"
            >
              {schedulerModeLabel(item)}
            </button>
          ))}
        </div>
        <div className="scheduler-case-list" role="group">
          {REPAIR_CASE_TYPES.map((caseType) => (
            <label className="checkbox-row" key={caseType}>
              <input
                checked={caseTypes.includes(caseType)}
                disabled={caseType === 'skipped_or_degraded' && disabledSkippedCase}
                onChange={() => toggleCaseType(caseType)}
                type="checkbox"
              />
              <span>{repairCaseLabel(caseType)}</span>
              <small>{caseTypeDescription(caseType)}</small>
            </label>
          ))}
        </div>
        {mode === 'enabled' ? (
          <p className="small muted">
            Enabled runs exclude skipped or degraded repair because that path is limited to dry-run review.
          </p>
        ) : null}
        <div className="scheduler-number-grid">
          <label>
            <span>Interval hours</span>
            <input
              className="input"
              max={168}
              min={1}
              onChange={(event) => setIntervalHours(clampRange(event.target.value, 1, 168, 24))}
              type="number"
              value={intervalHours}
            />
          </label>
          <label>
            <span>Lookback days</span>
            <input
              className="input"
              max={365}
              min={1}
              onChange={(event) => setLookbackDays(clampRange(event.target.value, 1, 365, 30))}
              type="number"
              value={lookbackDays}
            />
          </label>
          <label>
            <span>Limit</span>
            <input
              className="input"
              max={100}
              min={1}
              onChange={(event) => setLimit(clampRange(event.target.value, 1, 100, 25))}
              type="number"
              value={limit}
            />
          </label>
        </div>
        <div className="scheduler-action-row">
          <button
            className="button"
            disabled={saveMutation.isPending || caseTypes.length === 0}
            type="submit"
          >
            <Save aria-hidden size={15} />
            {saveMutation.isPending ? 'Saving' : 'Save settings'}
          </button>
          <button
            className="button primary"
            disabled={runDueMutation.isPending || !due}
            onClick={() => runDueMutation.mutate()}
            type="button"
          >
            <Settings2 aria-hidden size={15} />
            {runDueMutation.isPending ? 'Running' : 'Run due repair'}
          </button>
        </div>
      </form>
      {saveMutation.isError ? <ErrorState error={saveMutation.error} /> : null}
      {runDueMutation.isError ? <ErrorState error={runDueMutation.error} /> : null}
      {runDueMutation.data ? <SchedulerRunDueResult result={runDueMutation.data} /> : null}
    </section>
  );
}

function SchedulerRunDueResult({
  result,
}: {
  result: ResearchContinuitySchedulerRunDueResponse;
}) {
  return (
    <div className="scheduler-run-result">
      <span className={result.skipped_reason ? 'badge warning' : 'badge constructive'}>
        {result.skipped_reason ?? 'repair run recorded'}
      </span>
      <DataPair label="Audit run" value={<IdChip value={result.audit_run_id} />} />
      <DataPair label="Next due" value={formatDateTime(result.next_scheduled_repair_due_at)} />
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
    onSuccess: () => {
      onExecuted();
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
      <RecentRepairRunsPanel auth={auth} />
    </div>
  );
}

function RecentRepairRunsPanel({
  auth,
}: {
  auth: WorkspaceRequestContext;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const repairRunsQuery = useQuery({
    queryKey: queryKeys.researchContinuityRepairRuns({ limit: 5 }),
    queryFn: () => listResearchContinuityRepairRuns({ limit: 5 }, auth),
    retry: false,
  });
  const detailQuery = useQuery({
    queryKey: selectedRunId
      ? queryKeys.researchContinuityRepairRun(selectedRunId)
      : queryKeys.researchContinuityRepairRun('none'),
    queryFn: () => getResearchContinuityRepairRun(String(selectedRunId), auth),
    enabled: Boolean(selectedRunId),
    retry: false,
  });
  return (
    <>
      <RecentRepairRuns
        error={repairRunsQuery.error}
        isError={repairRunsQuery.isError}
        isLoading={repairRunsQuery.isLoading}
        onSelectRun={setSelectedRunId}
        runs={repairRunsQuery.data?.runs ?? []}
        selectedRunId={selectedRunId}
      />
      {selectedRunId ? (
        <RepairRunDetail
          detail={detailQuery.data ?? null}
          error={detailQuery.error}
          isError={detailQuery.isError}
          isLoading={detailQuery.isLoading}
        />
      ) : null}
    </>
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
        <span className="badge mono">{results.audit_run_id}</span>
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

function RecentRepairRuns({
  error,
  isError,
  isLoading,
  onSelectRun,
  runs,
  selectedRunId,
}: {
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  onSelectRun: (id: string) => void;
  runs: ResearchContinuityRepairRunSummaryResponse[];
  selectedRunId: string | null;
}) {
  return (
    <div className="research-continuity-repair-history">
      <div className="row">
        <strong>Recent Repair Runs</strong>
        <span className="small muted">{runs.length} shown</span>
      </div>
      {isLoading ? <LoadingState label="Loading repair history..." /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {!isLoading && runs.length === 0 ? (
        <EmptyState label="No repair runs recorded." />
      ) : null}
      <div className="stack">
        {runs.map((run) => (
          <div className="list-row" key={run.id}>
            <div className="row">
              <div className="row start">
                <span className={run.dry_run ? 'badge primary' : 'badge constructive'}>
                  {run.dry_run ? 'dry run' : 'executed'}
                </span>
                <span className={run.failed_count > 0 ? 'badge warning' : 'badge'}>
                  {run.status.replaceAll('_', ' ')}
                </span>
              </div>
              <span className="small muted">{formatDateTime(run.requested_at)}</span>
            </div>
            <div className="grid two">
              <DataPair label="Audit run" value={<IdChip value={run.id} />} />
              <DataPair label="Requested" value={run.requested_count} />
              <DataPair label="Repaired" value={run.repaired_count} />
              <DataPair label="Failed" value={run.failed_count} />
            </div>
            <button
              className={selectedRunId === run.id ? 'button primary' : 'button'}
              onClick={() => onSelectRun(run.id)}
              type="button"
            >
              Inspect run
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RepairRunDetail({
  detail,
  error,
  isError,
  isLoading,
}: {
  detail: ResearchContinuityRepairRunDetailResponse | null;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingState label="Loading repair run detail..." />;
  }
  if (isError) {
    return <ErrorState error={error} />;
  }
  if (!detail) {
    return null;
  }
  return (
    <section className="repair-run-detail">
      <div className="row">
        <strong>Repair run detail</strong>
        <span className={detail.dry_run ? 'badge primary' : 'badge constructive'}>
          {detail.dry_run ? 'dry run' : 'executed'}
        </span>
        <StatusBadge value={detail.status} />
      </div>
      <div className="grid two">
        <DataPair label="Audit run" value={<IdChip value={detail.id} />} />
        <DataPair label="Requested" value={formatDateTime(detail.requested_at)} />
        <DataPair label="Completed" value={formatDateTime(detail.completed_at)} />
        <DataPair label="Error" value={detail.error_message ?? 'none'} />
      </div>
      <div className="grid two">
        <DataPair
          label="Created entries"
          value={
            detail.created_entry_ids.length
              ? detail.created_entry_ids.map((id) => <IdChip key={id} value={id} />)
              : 'none'
          }
        />
        <DataPair label="Filters" value={<JsonView value={detail.filters} />} />
      </div>
      {detail.results.length === 0 ? <EmptyState label="No candidate results." /> : null}
      {detail.results.length > 0 ? (
        <div className="table-scroll">
          <table className="table research-continuity-repair-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Case</th>
                <th>Action</th>
                <th>Entry</th>
                <th>State</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {detail.results.map((result) => (
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
    </section>
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
          <DiffSummaryBadges summary={entry.diff_summary} />
        </div>
        <div className="continuity-report-actions">
          <span className="small muted">{formatDateTime(entry.generated_at)}</span>
          <Link className="button" to={routes.researchRun(entry.research_run_id)}>
            Open source run
          </Link>
          {entry.id ? (
            <Link className="button" to={routes.researchContinuityEntry(entry.id)}>
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
        <DiffSummaryBadges summary={entry.diff_summary} />
        <span className="small muted">{formatDateTime(entry.generated_at)}</span>
      </div>
      <p className="muted">{entry.summary}</p>
      <div className="top-strip-meta">
        <Link className="button" to={routes.researchRun(entry.research_run_id)}>
          Open source run
        </Link>
        {entry.id ? (
          <Link className="button" to={routes.researchContinuityEntry(entry.id)}>
            Details
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function DiffSummaryBadges({
  summary,
}: {
  summary: ResearchContinuityEntrySummaryResponse['diff_summary'];
}) {
  return (
    <>
      {summary.badges.map((badge) => (
        <span className={diffSummaryBadgeClass(badge)} key={badge}>
          {badge}
        </span>
      ))}
    </>
  );
}

function diffSummaryBadgeClass(badge: string): string {
  if (
    badge === 'degraded' ||
    badge === 'skipped' ||
    badge.includes('weakened')
  ) {
    return 'badge warning';
  }
  if (
    badge.includes('added') ||
    badge.includes('resolved') ||
    badge === 'repair'
  ) {
    return 'badge constructive';
  }
  if (badge.includes('updated')) {
    return 'badge primary';
  }
  return 'badge';
}

function lifecycleOptionLabel(value: string): string {
  return value === 'all' ? 'All' : typeLabel(value);
}

function lifecycleStatusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function lifecycleBadgeClass(value: string): string {
  if (value === 'active' || value === 'resolved') {
    return 'badge constructive';
  }
  if (value === 'updated') {
    return 'badge primary';
  }
  if (value === 'weakened' || value === 'invalidated') {
    return 'badge warning';
  }
  return 'badge';
}

function eventSeverityBadgeClass(value: string): string {
  if (value === 'critical' || value === 'warning') {
    return 'badge warning';
  }
  return 'badge';
}

function diffQualityBadgeClass(value: string): string {
  if (value === 'complete') {
    return 'badge constructive';
  }
  if (value === 'partial') {
    return 'badge warning';
  }
  return 'badge warning';
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
  if (value === 'scenario') {
    return 'Scenarios';
  }
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
    case 'scenario':
      return 'Conditional thesis branches';
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

function caseTypeDescription(value: ResearchContinuityRepairCaseType): string {
  switch (value) {
    case 'missing_continuity':
      return 'Backfill completed runs without a ledger entry.';
    case 'skipped_or_degraded':
      return 'Review entries that may improve with current artifacts.';
    case 'legacy_evidence':
      return 'Refresh older entries missing evidence metadata.';
    default:
      return value;
  }
}

function schedulerModeLabel(value: ResearchContinuityScheduledRepairMode): string {
  switch (value) {
    case 'dry_run':
      return 'Dry run';
    case 'enabled':
      return 'Enabled';
    default:
      return 'Disabled';
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

function clampRange(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
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
