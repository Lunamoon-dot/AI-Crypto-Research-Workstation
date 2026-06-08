import { JsonRecord } from '../database/journal.types';
import type {
  ResearchContinuityDiffQuality,
  ResearchContinuityDiffSeverity,
  ResearchContinuityLifecycleItemResponse,
  ResearchContinuityLifecycleItemType,
  ResearchContinuityLifecycleStatus,
  ResearchContinuityTimelineEventResponse,
  ResearchContinuityTimelineResponse,
} from './dto/research-continuity.dto';

export interface ResearchContinuityTimelineFilters {
  itemType?: ResearchContinuityLifecycleItemType;
  status?: ResearchContinuityLifecycleStatus;
}

export interface BuildContinuityTimelineInput {
  entries: JsonRecord[];
  entryLimit: number;
  fetchedEntryCount: number;
  filters?: ResearchContinuityTimelineFilters;
  generatedAt?: string;
  includeContext?: boolean;
  runs?: Map<string, JsonRecord>;
  symbol: string;
  workspaceId: string;
}

const EVENT_STATUSES: Record<string, ResearchContinuityLifecycleStatus> = {
  claim_added: 'active',
  risk_added: 'active',
  watchpoint_added: 'active',
  level_added: 'active',
  invalidation_added: 'active',
  claim_updated: 'updated',
  risk_updated: 'updated',
  watchpoint_updated: 'updated',
  level_updated: 'updated',
  invalidation_updated: 'invalidated',
  scenario_added: 'active',
  scenario_probability_changed: 'updated',
  scenario_invalidated: 'invalidated',
  scenario_carried: 'context',
  view_changed: 'updated',
  risk_resolved: 'resolved',
  watchpoint_resolved: 'resolved',
  claim_weakened: 'weakened',
  level_invalidated: 'invalidated',
  data_quality_changed: 'quality',
  claim_reinforced: 'context',
  risk_reinforced: 'context',
  watchpoint_carried: 'context',
  view_observed: 'context',
  baseline_initialized: 'context',
};

const MATERIAL_STATUSES = new Set<ResearchContinuityLifecycleStatus>([
  'active',
  'updated',
  'resolved',
  'weakened',
  'invalidated',
]);

const OCCURRENCE_EVENT_TYPES = new Set([
  'claim_added',
  'risk_added',
  'watchpoint_added',
  'level_added',
  'invalidation_added',
  'claim_updated',
  'risk_updated',
  'watchpoint_updated',
  'level_updated',
  'invalidation_updated',
  'scenario_added',
  'scenario_probability_changed',
  'scenario_carried',
  'claim_reinforced',
  'risk_reinforced',
  'watchpoint_carried',
]);

const STATUS_PRIORITY: Record<ResearchContinuityLifecycleStatus, number> = {
  active: 0,
  updated: 1,
  weakened: 2,
  invalidated: 3,
  resolved: 4,
  quality: 5,
  context: 6,
};

export function buildContinuityTimeline(
  input: BuildContinuityTimelineInput,
): ResearchContinuityTimelineResponse {
  const entryLimit = normalizeEntryLimit(input.entryLimit);
  const entries = input.entries.slice(0, entryLimit);
  const includeContext =
    Boolean(input.includeContext) || input.filters?.status === 'context';
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const warnings: string[] = [];
  const timelineEvents = entries.flatMap((entry, entryIndex) =>
    timelineEventsForEntry(entry, entryIndex, input.runs ?? new Map()),
  );
  const filteredEvents = timelineEvents.filter((event) => {
    if (!includeContext && event.status === 'context') {
      return false;
    }
    if (input.filters?.itemType && event.item_type !== input.filters.itemType) {
      return false;
    }
    if (input.filters?.status && event.status !== input.filters.status) {
      return false;
    }
    return true;
  });

  if (input.fetchedEntryCount > entryLimit) {
    warnings.push(
      'Timeline is windowed; lifecycle counts and first-seen values apply only inside the loaded entry window.',
    );
  }
  for (const event of filteredEvents) {
    if (event.diff_quality === 'partial') {
      warnings.push(`Entry ${event.entry_id} has partial diff quality.`);
    }
    if (event.diff_quality === 'unavailable') {
      warnings.push(`Entry ${event.entry_id} has unavailable diff quality.`);
    }
  }

  const sortedEvents = sortEventsNewestFirst(filteredEvents);
  return {
    symbol: input.symbol,
    workspace_id: input.workspaceId,
    generated_at: generatedAt,
    window: {
      entry_limit: entryLimit,
      truncated: input.fetchedEntryCount > entryLimit,
      coverage: input.fetchedEntryCount > entryLimit ? 'windowed' : 'complete',
    },
    entry_count: entries.length,
    event_count: sortedEvents.length,
    lifecycle_items: buildLifecycleItems(sortedEvents),
    timeline_events: sortedEvents,
    warnings: uniqueStrings(warnings),
  };
}

function timelineEventsForEntry(
  entry: JsonRecord,
  entryIndex: number,
  runs: Map<string, JsonRecord>,
): ResearchContinuityTimelineEventResponse[] {
  const payload = continuityEntryPayload(entry);
  const repair = recordValue(payload.repair);
  const isRepair = booleanValue(repair.is_repair, false);
  const diffQuality = diffQualityForEntry(entry, payload);
  const events = arrayRecords(entry.events);
  const normalizedEvents = events
    .map((event, eventIndex) =>
      timelineEventFor(entry, event, eventIndex, entryIndex, {
        diffQuality,
        isRepair,
        repair,
        runs,
      }),
    )
    .filter(
      (event): event is ResearchContinuityTimelineEventResponse =>
        event !== null,
    );

  if (
    normalizedEvents.length === 0 &&
    !isSkipped(entry) &&
    hasLegacyFallback(entry, payload)
  ) {
    return legacyTimelineEventsForEntry(entry, payload, entryIndex, {
      diffQuality,
      isRepair,
      repair,
      runs,
    });
  }

  if (
    normalizedEvents.some((event) => event.status === 'quality') ||
    (!isSkipped(entry) && !isDegraded(entry, payload))
  ) {
    return normalizedEvents;
  }

  return [
    ...normalizedEvents,
    qualityTimelineEvent(entry, normalizedEvents.length, entryIndex, {
      diffQuality,
      isRepair,
      repair,
      runs,
    }),
  ];
}

function timelineEventFor(
  entry: JsonRecord,
  event: JsonRecord,
  eventIndex: number,
  entryIndex: number,
  context: {
    diffQuality: ResearchContinuityDiffQuality;
    isRepair: boolean;
    repair: JsonRecord;
    runs: Map<string, JsonRecord>;
  },
): ResearchContinuityTimelineEventResponse | null {
  const eventType = stringValue(event.event_type ?? event.type);
  const status = EVENT_STATUSES[eventType];
  if (!status) {
    return null;
  }
  const stableItemKey = stableKeyFor(event);
  const itemType = itemTypeFor(event, eventType);
  const before = beforeText(event, status);
  const after = afterText(event, status);
  const title = titleFor(event, before, after, eventType);
  const reason = nullableString(event.reason);
  const evidence = evidenceFor(event);
  const repairSourceRunId = nullableString(context.repair.source_run_id);
  const repairSourceEntryId = nullableString(context.repair.source_entry_id);
  const entryRunId = nullableString(entry.research_run_id);
  const observedRunId = context.isRepair ? repairSourceRunId ?? entryRunId : entryRunId;
  return {
    id: timelineEventId(entry, eventType, stableItemKey, eventIndex, entryIndex),
    entry_id: stringValue(entry.id, `entry_${entryIndex + 1}`),
    research_run_id: entryRunId,
    observed_at:
      runTimestamp(observedRunId, context.runs) ??
      nullableString(entry.generated_at),
    recorded_at: nullableString(entry.generated_at),
    event_type: eventType,
    stable_item_key: stableItemKey,
    item_type: itemType,
    status,
    title,
    reason,
    before,
    after,
    severity: severityFor(event, eventType),
    diff_quality: context.diffQuality,
    entry_type: stringValue(entry.entry_type),
    entry_status: stringValue(entry.status),
    is_repair: context.isRepair,
    repair_case_type: context.isRepair
      ? nullableString(context.repair.case_type)
      : null,
    source_entry_id: context.isRepair ? repairSourceEntryId : null,
    source_run_id: context.isRepair ? repairSourceRunId : null,
    evidence_status: evidence.status,
    source_artifact: evidence.source_artifact,
    source_id: evidence.source_id,
    source_field: evidence.source_field,
  };
}

function qualityTimelineEvent(
  entry: JsonRecord,
  eventIndex: number,
  entryIndex: number,
  context: {
    diffQuality: ResearchContinuityDiffQuality;
    isRepair: boolean;
    repair: JsonRecord;
    runs: Map<string, JsonRecord>;
  },
): ResearchContinuityTimelineEventResponse {
  const payload = continuityEntryPayload(entry);
  const quality = qualityFromEntry(entry, payload);
  const reason = isSkipped(entry)
    ? `Continuity skipped: ${skippedReason(entry, payload)}.`
    : 'Continuity data quality is degraded.';
  return timelineEventFor(
    entry,
    {
      event_type: 'data_quality_changed',
      severity: 'medium',
      item_key: null,
      from: null,
      to: quality,
      reason,
    },
    eventIndex,
    entryIndex,
    context,
  ) as ResearchContinuityTimelineEventResponse;
}

function legacyTimelineEventsForEntry(
  entry: JsonRecord,
  payload: JsonRecord,
  entryIndex: number,
  context: {
    diffQuality: ResearchContinuityDiffQuality;
    isRepair: boolean;
    repair: JsonRecord;
    runs: Map<string, JsonRecord>;
  },
): ResearchContinuityTimelineEventResponse[] {
  const rows: ResearchContinuityTimelineEventResponse[] = [];
  const sections = [
    ...arrayRecords(recordValue(recordValue(payload.report_views).thin).sections),
    ...arrayRecords(entry.sections),
  ];
  for (const section of sections) {
    const status = legacyStatusForSection(section);
    if (!status) {
      continue;
    }
    for (const item of stringList(section.items)) {
      if (isEmptyFallbackLine(item)) {
        continue;
      }
      rows.push(
        legacyTimelineEventFor(entry, item, status, rows.length, entryIndex, context),
      );
    }
  }
  return rows;
}

function legacyTimelineEventFor(
  entry: JsonRecord,
  title: string,
  status: ResearchContinuityLifecycleStatus,
  eventIndex: number,
  entryIndex: number,
  context: {
    diffQuality: ResearchContinuityDiffQuality;
    isRepair: boolean;
    repair: JsonRecord;
    runs: Map<string, JsonRecord>;
  },
): ResearchContinuityTimelineEventResponse {
  const repairSourceRunId = nullableString(context.repair.source_run_id);
  const repairSourceEntryId = nullableString(context.repair.source_entry_id);
  const entryRunId = nullableString(entry.research_run_id);
  const observedRunId = context.isRepair ? repairSourceRunId ?? entryRunId : entryRunId;
  return {
    id: timelineEventId(entry, 'legacy_section_item', null, eventIndex, entryIndex),
    entry_id: stringValue(entry.id, `entry_${entryIndex + 1}`),
    research_run_id: entryRunId,
    observed_at:
      runTimestamp(observedRunId, context.runs) ??
      nullableString(entry.generated_at),
    recorded_at: nullableString(entry.generated_at),
    event_type: 'legacy_section_item',
    stable_item_key: null,
    item_type: legacyItemTypeForTitle(title, status),
    status,
    title,
    reason: null,
    before: null,
    after:
      status === 'resolved' || status === 'weakened' || status === 'invalidated'
        ? null
        : title,
    severity: status === 'quality' ? 'warning' : 'info',
    diff_quality: context.diffQuality,
    entry_type: stringValue(entry.entry_type),
    entry_status: stringValue(entry.status),
    is_repair: context.isRepair,
    repair_case_type: context.isRepair
      ? nullableString(context.repair.case_type)
      : null,
    source_entry_id: context.isRepair ? repairSourceEntryId : null,
    source_run_id: context.isRepair ? repairSourceRunId : null,
    evidence_status: null,
    source_artifact: null,
    source_id: null,
    source_field: null,
  };
}

function buildLifecycleItems(
  events: ResearchContinuityTimelineEventResponse[],
): ResearchContinuityLifecycleItemResponse[] {
  const byKey = new Map<string, ResearchContinuityTimelineEventResponse[]>();
  for (const event of events) {
    if (!event.stable_item_key) {
      continue;
    }
    byKey.set(event.stable_item_key, [
      ...(byKey.get(event.stable_item_key) ?? []),
      event,
    ]);
  }

  return [...byKey.entries()]
    .map(([stableItemKey, itemEvents]) =>
      lifecycleItemFor(stableItemKey, sortEventsOldestFirst(itemEvents)),
    )
    .sort(
      (left, right) =>
        STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status] ||
        timestampForSort(right.last_seen_at).localeCompare(
          timestampForSort(left.last_seen_at),
        ) ||
        left.stable_item_key.localeCompare(right.stable_item_key),
    );
}

function lifecycleItemFor(
  stableItemKey: string,
  events: ResearchContinuityTimelineEventResponse[],
): ResearchContinuityLifecycleItemResponse {
  const latestMaterial = [...events]
    .reverse()
    .find((event) => MATERIAL_STATUSES.has(event.status));
  const latestEvent = events.at(-1) as ResearchContinuityTimelineEventResponse;
  const status = latestMaterial?.status ?? latestEvent.status;
  const title = latestMaterial?.title ?? latestEvent.title;
  const firstSeen =
    events.find((event) => event.status === 'active' || event.status === 'updated') ??
    events[0];
  const occurrenceEntryIds = new Set(
    events
      .filter((event) => OCCURRENCE_EVENT_TYPES.has(event.event_type))
      .map((event) => event.entry_id),
  );
  return {
    stable_item_key: stableItemKey,
    item_type: latestMaterial?.item_type ?? latestEvent.item_type,
    status,
    title,
    first_seen_at: firstSeen?.observed_at ?? firstSeen?.recorded_at ?? null,
    last_seen_at: latestEvent.observed_at ?? latestEvent.recorded_at ?? null,
    first_seen_run_id: firstSeen?.research_run_id ?? null,
    last_seen_run_id: latestEvent.research_run_id,
    occurrence_count: occurrenceEntryIds.size,
    entry_count: new Set(events.map((event) => event.entry_id)).size,
    latest_entry_id: latestEvent.entry_id,
    latest_event_type: latestEvent.event_type,
    source_artifacts: uniqueStrings(
      events
        .map((event) => event.source_artifact)
        .filter((value): value is string => Boolean(value)),
    ).sort(),
    timeline_event_ids: events.map((event) => event.id),
  };
}

function stableKeyFor(event: JsonRecord): string | null {
  const from = recordValue(event.from);
  const to = recordValue(event.to);
  return (
    nullableString(event.item_key) ??
    nullableString(to.item_key) ??
    nullableString(from.item_key) ??
    nullableString(to.legacy_item_key) ??
    nullableString(from.legacy_item_key)
  );
}

function itemTypeFor(
  event: JsonRecord,
  eventType: string,
): ResearchContinuityLifecycleItemType {
  if (eventType === 'view_changed' || eventType === 'view_observed') {
    return 'view';
  }
  if (eventType === 'baseline_initialized') {
    return 'view';
  }
  if (eventType === 'data_quality_changed') {
    return 'quality';
  }
  if (eventType.startsWith('scenario_')) {
    return 'scenario';
  }
  const from = recordValue(event.from);
  const to = recordValue(event.to);
  const explicit = stringValue(to.type ?? from.type);
  if (isLifecycleItemType(explicit)) {
    return explicit;
  }
  const prefix = eventType.split('_')[0] ?? '';
  return isLifecycleItemType(prefix) ? prefix : 'unknown';
}

function beforeText(
  event: JsonRecord,
  status: ResearchContinuityLifecycleStatus,
): string | null {
  if (status === 'active' || status === 'context' || status === 'quality') {
    return null;
  }
  return nullableString(event.previous_text) ?? textValue(event.from);
}

function afterText(
  event: JsonRecord,
  status: ResearchContinuityLifecycleStatus,
): string | null {
  if (status === 'resolved' || status === 'weakened') {
    return null;
  }
  if (status === 'invalidated' && stringValue(event.event_type) === 'level_invalidated') {
    return null;
  }
  return nullableString(event.current_text) ?? textValue(event.to);
}

function titleFor(
  event: JsonRecord,
  before: string | null,
  after: string | null,
  eventType: string,
): string {
  return (
    nullableString(event.summary) ??
    nullableString(event.reason) ??
    after ??
    before ??
    eventType.replaceAll('_', ' ')
  );
}

function evidenceFor(event: JsonRecord): {
  source_artifact: string | null;
  source_field: string | null;
  source_id: string | null;
  status: string | null;
} {
  const source = recordValue(event.source);
  const from = recordValue(event.from);
  const to = recordValue(event.to);
  return {
    status:
      nullableString(event.evidence_status) ??
      nullableString(source.status) ??
      nullableString(source.evidence_quality) ??
      nullableString(to.evidence_quality) ??
      nullableString(from.evidence_quality),
    source_artifact:
      nullableString(source.source_artifact) ??
      nullableString(to.source_artifact) ??
      nullableString(from.source_artifact),
    source_id:
      nullableString(source.source_id) ??
      nullableString(to.source_id) ??
      nullableString(from.source_id),
    source_field:
      nullableString(source.source_field) ??
      nullableString(to.source_field) ??
      nullableString(from.source_field),
  };
}

function diffQualityForEntry(
  entry: JsonRecord,
  payload: JsonRecord,
): ResearchContinuityDiffQuality {
  if (isSkipped(entry)) {
    return 'unavailable';
  }
  if (isDegraded(entry, payload) || hasLegacyFallback(entry, payload)) {
    return 'partial';
  }
  if (arrayRecords(entry.events).length === 0) {
    return 'unavailable';
  }
  return 'complete';
}

function severityFor(
  event: JsonRecord,
  eventType: string,
): ResearchContinuityDiffSeverity {
  let severity = severityValue(event.severity);
  if (
    eventType.startsWith('risk_') ||
    eventType.startsWith('invalidation_') ||
    eventType === 'level_invalidated' ||
    eventType === 'scenario_probability_changed' ||
    eventType === 'scenario_invalidated' ||
    eventType === 'data_quality_changed'
  ) {
    severity = severity === 'critical' ? 'critical' : 'warning';
  }
  if (eventType === 'claim_weakened' && hasMissingEvidence(event)) {
    severity = severity === 'critical' ? 'critical' : 'warning';
  }
  return severity;
}

function hasMissingEvidence(event: JsonRecord): boolean {
  const evidence = evidenceFor(event);
  const status = stringValue(evidence.status).toLowerCase();
  return (
    !evidence.source_artifact ||
    !status ||
    ['none', 'missing', 'no_evidence', 'unsourced'].includes(status)
  );
}

function runTimestamp(
  runId: string | null,
  runs: Map<string, JsonRecord>,
): string | null {
  if (!runId) {
    return null;
  }
  const run = runs.get(runId);
  return nullableString(
    run?.completed_at ?? run?.captured_at ?? run?.started_at ?? run?.created_at,
  );
}

function sortEventsNewestFirst(
  events: ResearchContinuityTimelineEventResponse[],
): ResearchContinuityTimelineEventResponse[] {
  return [...events].sort(
    (left, right) =>
      timestampForSort(right.observed_at ?? right.recorded_at).localeCompare(
        timestampForSort(left.observed_at ?? left.recorded_at),
      ) ||
      right.entry_id.localeCompare(left.entry_id) ||
      right.id.localeCompare(left.id),
  );
}

function sortEventsOldestFirst(
  events: ResearchContinuityTimelineEventResponse[],
): ResearchContinuityTimelineEventResponse[] {
  return [...events].sort(
    (left, right) =>
      timestampForSort(left.observed_at ?? left.recorded_at).localeCompare(
        timestampForSort(right.observed_at ?? right.recorded_at),
      ) ||
      left.entry_id.localeCompare(right.entry_id) ||
      left.id.localeCompare(right.id),
  );
}

function timestampForSort(value: string | null): string {
  return value ?? '';
}

function timelineEventId(
  entry: JsonRecord,
  eventType: string,
  stableItemKey: string | null,
  eventIndex: number,
  entryIndex: number,
): string {
  const entryId = stringValue(entry.id, `entry_${entryIndex + 1}`);
  const itemKey = stableItemKey ?? 'unkeyed';
  return `${entryId}:${eventType}:${itemKey}:${eventIndex + 1}`;
}

function textValue(value: unknown): string | null {
  const record = recordValue(value);
  if (Object.keys(record).length > 0) {
    return (
      nullableString(record.current_text) ??
      nullableString(record.text) ??
      nullableString(record.reason) ??
      nullableString(record.summary) ??
      nullableString(record.title) ??
      qualitySummary(record) ??
      compactJson(record)
    );
  }
  return nullableString(value);
}

function qualityFromEntry(entry: JsonRecord, payload: JsonRecord): JsonRecord {
  const snapshotQuality = recordValue(entry.snapshot_quality);
  if (Object.keys(snapshotQuality).length > 0) {
    return snapshotQuality;
  }
  return recordValue(recordValue(recordValue(payload.report_views).thin).quality);
}

function qualitySummary(quality: JsonRecord): string | null {
  const status = nullableString(quality.status);
  if (!status) {
    return null;
  }
  const score = nullableString(quality.score);
  return score ? `${status} (${score})` : status;
}

function compactJson(value: JsonRecord): string {
  const text = JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function hasLegacyFallback(entry: JsonRecord, payload: JsonRecord): boolean {
  if (arrayRecords(entry.events).length > 0) {
    return false;
  }
  const sections = [
    ...arrayRecords(recordValue(recordValue(payload.report_views).thin).sections),
    ...arrayRecords(entry.sections),
  ];
  return sections.some((section) => {
    if (!legacyStatusForSection(section)) {
      return false;
    }
    return stringList(section.items).some((item) => !isEmptyFallbackLine(item));
  });
}

function legacyStatusForSection(
  section: JsonRecord,
): ResearchContinuityLifecycleStatus | null {
  const id = stringValue(section.id).toLowerCase();
  const title = stringValue(section.title).toLowerCase();
  if (id === 'material_changes' || title.includes('material changes')) {
    return 'updated';
  }
  if (id === 'resolved_or_weakened' || title.includes('resolved')) {
    return title.includes('weaken') ? 'weakened' : 'resolved';
  }
  if (id === 'quality' || title.includes('quality')) {
    return 'quality';
  }
  if (
    id === 'current_view' ||
    id === 'active_risks' ||
    id === 'watchpoints' ||
    id === 'evidence_health' ||
    title.includes('current view') ||
    title.includes('risk') ||
    title.includes('watchpoint') ||
    title.includes('evidence')
  ) {
    return 'context';
  }
  return null;
}

function legacyItemTypeForTitle(
  title: string,
  status: ResearchContinuityLifecycleStatus,
): ResearchContinuityLifecycleItemType {
  if (status === 'quality') {
    return 'quality';
  }
  const normalized = title.toLowerCase();
  if (normalized.includes('risk')) {
    return 'risk';
  }
  if (normalized.includes('watchpoint')) {
    return 'watchpoint';
  }
  if (normalized.includes('level')) {
    return 'level';
  }
  if (normalized.includes('invalidation')) {
    return 'invalidation';
  }
  if (normalized.includes('scenario')) {
    return 'scenario';
  }
  if (normalized.includes('claim')) {
    return 'claim';
  }
  return 'unknown';
}

function isEmptyFallbackLine(value: string): boolean {
  return /^no .* (reported|detected|available|found)\.?$/i.test(value.trim());
}

function continuityEntryPayload(entry: JsonRecord): JsonRecord {
  const payload = recordValue(entry.payload ?? entry.payload_json);
  const nestedPayload = recordValue(payload.payload);
  return hasContinuityEntryMetadata(nestedPayload) ? nestedPayload : payload;
}

function hasContinuityEntryMetadata(payload: JsonRecord): boolean {
  return (
    payload.schema_version !== undefined ||
    payload.evidence_contract_version !== undefined ||
    payload.repair !== undefined ||
    payload.skip_reason !== undefined ||
    payload.report_views !== undefined
  );
}

function skippedReason(entry: JsonRecord, payload: JsonRecord): string {
  return (
    nullableString(payload.skip_reason) ??
    nullableString(entry.skip_reason) ??
    'insufficient_structured_data'
  );
}

function isSkipped(entry: JsonRecord): boolean {
  return stringValue(entry.entry_type) === 'skipped' || stringValue(entry.status) === 'skipped';
}

function isDegraded(entry: JsonRecord, payload: JsonRecord): boolean {
  const quality = qualityFromEntry(entry, payload);
  return (
    stringValue(entry.entry_type) === 'degraded' ||
    stringValue(entry.status) === 'degraded' ||
    stringValue(quality.status) === 'degraded'
  );
}

function isLifecycleItemType(
  value: string,
): value is ResearchContinuityLifecycleItemType {
  return [
    'claim',
    'risk',
    'watchpoint',
    'level',
    'invalidation',
    'scenario',
    'view',
    'quality',
    'unknown',
  ].includes(value);
}

function normalizeEntryLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

function severityValue(value: unknown): ResearchContinuityDiffSeverity {
  const severity = stringValue(value).toLowerCase();
  if (severity === 'critical' || severity === 'high') {
    return 'critical';
  }
  if (severity === 'warning' || severity === 'medium') {
    return 'warning';
  }
  return 'info';
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const text = nullableString(value);
    return text ? [text] : [];
  }
  return value
    .map((item) => nullableString(item))
    .filter((item): item is string => Boolean(item));
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
