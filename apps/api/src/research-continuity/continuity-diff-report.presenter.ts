import { JsonRecord } from '../database/journal.types';
import type {
  ResearchContinuityChangedItemEvidenceResponse,
  ResearchContinuityChangedItemResponse,
  ResearchContinuityChangeGroupResponse,
  ResearchContinuityDiffGroup,
  ResearchContinuityDiffItemType,
  ResearchContinuityDiffQuality,
  ResearchContinuityDiffReportResponse,
  ResearchContinuityDiffSeverity,
  ResearchContinuityDiffSummaryResponse,
} from './dto/research-continuity.dto';

const DIFF_REPORT_VERSION = 'research_continuity_diff.v1' as const;

const GROUP_ORDER: ResearchContinuityDiffGroup[] = [
  'added',
  'updated',
  'removed_resolved',
  'weakened',
  'quality',
  'context',
];

const GROUP_TITLES: Record<ResearchContinuityDiffGroup, string> = {
  added: 'Added',
  updated: 'Updated',
  removed_resolved: 'Removed Or Resolved',
  weakened: 'Weakened',
  quality: 'Quality',
  context: 'Important Context',
};

const EVENT_GROUPS: Record<string, ResearchContinuityDiffGroup> = {
  claim_added: 'added',
  risk_added: 'added',
  watchpoint_added: 'added',
  level_added: 'added',
  invalidation_added: 'added',
  claim_updated: 'updated',
  risk_updated: 'updated',
  watchpoint_updated: 'updated',
  level_updated: 'updated',
  invalidation_updated: 'updated',
  scenario_added: 'added',
  scenario_probability_changed: 'updated',
  scenario_invalidated: 'removed_resolved',
  scenario_carried: 'context',
  view_changed: 'updated',
  risk_resolved: 'removed_resolved',
  watchpoint_resolved: 'removed_resolved',
  level_invalidated: 'removed_resolved',
  claim_weakened: 'weakened',
  data_quality_changed: 'quality',
  claim_reinforced: 'context',
  risk_reinforced: 'context',
  watchpoint_carried: 'context',
  view_observed: 'context',
  baseline_initialized: 'context',
};

const MATERIAL_GROUPS = new Set<ResearchContinuityDiffGroup>([
  'added',
  'updated',
  'removed_resolved',
  'weakened',
]);

export function buildDiffSummary(
  entry: JsonRecord,
): ResearchContinuityDiffSummaryResponse {
  return buildDiffReport(entry).summary;
}

export function buildDiffReport(
  entry: JsonRecord,
): ResearchContinuityDiffReportResponse {
  const payload = continuityEntryPayload(entry);
  const repair = recordValue(payload.repair);
  const isRepair = booleanValue(repair.is_repair, false);
  const isSkipped = entryType(entry) === 'skipped' || entryStatus(entry) === 'skipped';
  const isDegraded =
    entryType(entry) === 'degraded' ||
    entryStatus(entry) === 'degraded' ||
    stringValue(qualityFromEntry(entry, payload).status) === 'degraded';

  let changedItems = isSkipped
    ? []
    : eventItems(arrayRecords(entry.events));
  let usedFallback = false;
  if (!isSkipped && changedItems.length === 0) {
    const fallbackItems = legacySectionItems(entry, payload);
    if (fallbackItems.length > 0) {
      changedItems = fallbackItems;
      usedFallback = true;
    }
  }
  if (isDegraded && !hasMaterialRows(changedItems) && !hasGroup(changedItems, 'quality')) {
    changedItems.push(degradedQualityItem(entry, payload, changedItems.length));
  }
  if (isRepair) {
    changedItems.push(repairContextItem(repair, changedItems.length));
  }

  const diffQuality = diffQualityFor({
    changedItems,
    entry,
    isDegraded,
    isRepair,
    isSkipped,
    payload,
    usedFallback,
  });
  const warnings = warningLines({
    diffQuality,
    entry,
    isDegraded,
    isSkipped,
    payload,
    usedFallback,
  });
  const summary = summarize(entry, changedItems, {
    diffQuality,
    isDegraded,
    isRepair,
    warnings,
  });
  const changeGroups = groupItems(changedItems);
  return {
    version: DIFF_REPORT_VERSION,
    summary,
    change_groups: changeGroups,
    changed_items: changedItems,
  };
}

function eventItems(events: JsonRecord[]): ResearchContinuityChangedItemResponse[] {
  return events
    .map((event, index) => eventItem(event, index))
    .filter(
      (item): item is ResearchContinuityChangedItemResponse => item !== null,
    );
}

function eventItem(
  event: JsonRecord,
  index: number,
): ResearchContinuityChangedItemResponse | null {
  const eventType = stringValue(event.event_type ?? event.type);
  const group = EVENT_GROUPS[eventType];
  if (!group) {
    return null;
  }
  const itemType = itemTypeFor(event, eventType);
  const before = beforeText(event, group);
  const after = afterText(event, group);
  const title = itemTitle(event, before, after, eventType);
  return {
    id: itemId(event, group, index),
    group,
    event_type: eventType,
    item_type: itemType,
    title,
    before,
    after,
    severity: severityFor(event, eventType),
    evidence: evidenceFor(event),
  };
}

function beforeText(
  event: JsonRecord,
  group: ResearchContinuityDiffGroup,
): string | null {
  if (group === 'added' || group === 'context') {
    return null;
  }
  return nullableString(event.previous_text) ?? textValue(event.from);
}

function afterText(
  event: JsonRecord,
  group: ResearchContinuityDiffGroup,
): string | null {
  if (group === 'removed_resolved' || group === 'weakened') {
    return null;
  }
  return nullableString(event.current_text) ?? textValue(event.to);
}

function itemTitle(
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

function itemId(
  event: JsonRecord,
  group: ResearchContinuityDiffGroup,
  index: number,
): string {
  return (
    nullableString(event.item_key) ??
    nullableString(event.id) ??
    `${group}_${index + 1}`
  );
}

function itemTypeFor(
  event: JsonRecord,
  eventType: string,
): ResearchContinuityDiffItemType {
  if (eventType === 'view_changed' || eventType === 'view_observed') {
    return 'view';
  }
  if (eventType === 'data_quality_changed') {
    return 'quality';
  }
  if (eventType.startsWith('scenario_')) {
    return 'scenario';
  }
  const explicitType = stringValue(
    recordValue(event.to).type ?? recordValue(event.from).type,
  );
  if (isDiffItemType(explicitType)) {
    return explicitType;
  }
  const prefix = eventType.split('_')[0] ?? '';
  return isDiffItemType(prefix) ? prefix : 'unknown';
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
    severity = atLeastWarning(severity);
  }
  if (eventType === 'claim_weakened') {
    severity = hasMissingEvidence(event) ? 'warning' : severity;
  }
  return severity;
}

function evidenceFor(
  event: JsonRecord,
): ResearchContinuityChangedItemEvidenceResponse {
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

function legacySectionItems(
  entry: JsonRecord,
  payload: JsonRecord,
): ResearchContinuityChangedItemResponse[] {
  const sections = [
    ...arrayRecords(recordValue(recordValue(payload.report_views).thin).sections),
    ...arrayRecords(entry.sections),
  ];
  const items: ResearchContinuityChangedItemResponse[] = [];
  for (const section of sections) {
    const sectionGroup = groupForLegacySection(section);
    if (!sectionGroup) {
      continue;
    }
    for (const item of stringList(section.items)) {
      if (isEmptyFallbackLine(item)) {
        continue;
      }
      const group =
        sectionGroup === 'removed_resolved' && item.toLowerCase().includes('weaken')
          ? 'weakened'
          : sectionGroup;
      items.push({
        id: `legacy_${group}_${items.length + 1}`,
        group,
        event_type: 'legacy_section_item',
        item_type: group === 'quality' ? 'quality' : 'unknown',
        title: item,
        before: null,
        after: item,
        severity: group === 'quality' ? 'warning' : 'info',
        evidence: emptyEvidence(),
      });
    }
  }
  return dedupeItems(items);
}

function groupForLegacySection(
  section: JsonRecord,
): ResearchContinuityDiffGroup | null {
  const id = stringValue(section.id).toLowerCase();
  const title = stringValue(section.title).toLowerCase();
  if (id === 'material_changes' || title.includes('material changes')) {
    return 'updated';
  }
  if (id === 'resolved_or_weakened' || title.includes('resolved')) {
    return 'removed_resolved';
  }
  if (id === 'quality' || title.includes('quality')) {
    return 'quality';
  }
  if (
    id === 'current_view' ||
    id === 'claims' ||
    id === 'active_risks' ||
    id === 'scenarios' ||
    id === 'watchpoints' ||
    id === 'evidence_health' ||
    title.includes('current view') ||
    title.includes('claim') ||
    title.includes('risk') ||
    title.includes('scenario') ||
    title.includes('watchpoint') ||
    title.includes('evidence')
  ) {
    return 'context';
  }
  return null;
}

function degradedQualityItem(
  entry: JsonRecord,
  payload: JsonRecord,
  index: number,
): ResearchContinuityChangedItemResponse {
  const quality = qualityFromEntry(entry, payload);
  const status = stringValue(quality.status, 'degraded');
  return {
    id: `quality_${index + 1}`,
    group: 'quality',
    event_type: 'data_quality_changed',
    item_type: 'quality',
    title: 'Continuity data quality is degraded.',
    before: null,
    after: qualitySummary(quality) ?? status,
    severity: 'warning',
    evidence: emptyEvidence(),
  };
}

function repairContextItem(
  repair: JsonRecord,
  index: number,
): ResearchContinuityChangedItemResponse {
  const parts = [
    `Case type: ${stringValue(repair.case_type, 'unknown')}.`,
    nullableString(repair.source_run_id)
      ? `Source run: ${String(repair.source_run_id)}.`
      : '',
    nullableString(repair.source_entry_id)
      ? `Source entry: ${String(repair.source_entry_id)}.`
      : '',
    nullableString(repair.reason) ? `Reason: ${String(repair.reason)}` : '',
  ].filter(Boolean);
  return {
    id: `repair_context_${index + 1}`,
    group: 'context',
    event_type: 'repair_context',
    item_type: 'view',
    title: 'Repair context',
    before: null,
    after: parts.join(' '),
    severity: 'info',
    evidence: emptyEvidence(),
  };
}

function summarize(
  entry: JsonRecord,
  items: ResearchContinuityChangedItemResponse[],
  options: {
    diffQuality: ResearchContinuityDiffQuality;
    isDegraded: boolean;
    isRepair: boolean;
    warnings: string[];
  },
): ResearchContinuityDiffSummaryResponse {
  const added = countGroup(items, 'added');
  const updated = countGroup(items, 'updated');
  const removedResolved = countGroup(items, 'removed_resolved');
  const weakened = countGroup(items, 'weakened');
  const quality = countGroup(items, 'quality');
  const hasMaterialChanges =
    added + updated + removedResolved + weakened > 0;
  const isSkipped = entryType(entry) === 'skipped' || entryStatus(entry) === 'skipped';
  const badges = [
    added > 0 ? `+${added} added` : '',
    updated > 0 ? `${updated} updated` : '',
    removedResolved > 0 ? `${removedResolved} resolved` : '',
    weakened > 0 ? `${weakened} weakened` : '',
    options.isDegraded && !isSkipped ? 'degraded' : '',
    isSkipped ? 'skipped' : '',
    options.isRepair ? 'repair' : '',
    !hasMaterialChanges && !isSkipped ? 'no material change' : '',
  ].filter(Boolean);
  return {
    added_count: added,
    updated_count: updated,
    removed_resolved_count: removedResolved,
    weakened_count: weakened,
    quality_count: quality,
    has_material_changes: hasMaterialChanges,
    has_comparison: hasComparison(entry),
    diff_quality: options.diffQuality,
    is_repair: options.isRepair,
    badges,
    warnings: options.warnings,
  };
}

function groupItems(
  items: ResearchContinuityChangedItemResponse[],
): ResearchContinuityChangeGroupResponse[] {
  return GROUP_ORDER.map((group) => {
    const groupItems = items.filter((item) => item.group === group);
    return groupItems.length > 0
      ? {
          group,
          title: GROUP_TITLES[group],
          count: groupItems.length,
          items: groupItems,
        }
      : null;
  }).filter(
    (group): group is ResearchContinuityChangeGroupResponse => group !== null,
  );
}

function diffQualityFor(input: {
  changedItems: ResearchContinuityChangedItemResponse[];
  entry: JsonRecord;
  isDegraded: boolean;
  isRepair: boolean;
  isSkipped: boolean;
  payload: JsonRecord;
  usedFallback: boolean;
}): ResearchContinuityDiffQuality {
  if (input.isSkipped) {
    return 'unavailable';
  }
  if (input.isDegraded || input.usedFallback) {
    return 'partial';
  }
  if (
    input.changedItems.length === 0 &&
    arrayRecords(input.entry.events).length === 0 &&
    hasQualityMetadata(qualityFromEntry(input.entry, input.payload)) &&
    !input.isRepair
  ) {
    return 'unavailable';
  }
  return 'complete';
}

function warningLines(input: {
  diffQuality: ResearchContinuityDiffQuality;
  entry: JsonRecord;
  isDegraded: boolean;
  isSkipped: boolean;
  payload: JsonRecord;
  usedFallback: boolean;
}): string[] {
  const warnings: string[] = [];
  const quality = qualityFromEntry(input.entry, input.payload);
  const skipReason = skippedReason(input.entry, input.payload);
  if (input.isSkipped) {
    warnings.push(`Continuity skipped: ${skipReason}. Diff unavailable.`);
  }
  if (input.isDegraded) {
    warnings.push('Complete diff unavailable because continuity data is degraded.');
  }
  if (input.usedFallback) {
    warnings.push('Structured continuity events unavailable; showing partial text fallback.');
  }
  if (
    input.diffQuality === 'unavailable' &&
    !input.isSkipped &&
    !input.isDegraded
  ) {
    warnings.push('Structured continuity events unavailable; diff report cannot be computed.');
  }
  warnings.push(...stringList(quality.warnings), ...stringList(quality.reasons));
  return uniqueStrings(warnings);
}

function qualityFromEntry(entry: JsonRecord, payload: JsonRecord): JsonRecord {
  const snapshotQuality = recordValue(entry.snapshot_quality);
  if (Object.keys(snapshotQuality).length > 0) {
    return snapshotQuality;
  }
  return recordValue(recordValue(recordValue(payload.report_views).thin).quality);
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

function hasComparison(entry: JsonRecord): boolean {
  return entryType(entry) !== 'baseline' && nullableString(entry.previous_entry_id) !== null;
}

function hasMaterialRows(items: ResearchContinuityChangedItemResponse[]): boolean {
  return items.some((item) => MATERIAL_GROUPS.has(item.group));
}

function hasGroup(
  items: ResearchContinuityChangedItemResponse[],
  group: ResearchContinuityDiffGroup,
): boolean {
  return items.some((item) => item.group === group);
}

function countGroup(
  items: ResearchContinuityChangedItemResponse[],
  group: ResearchContinuityDiffGroup,
): number {
  return items.filter((item) => item.group === group).length;
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
  const text = nullableString(value);
  if (text) {
    return text;
  }
  return null;
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

function atLeastWarning(
  severity: ResearchContinuityDiffSeverity,
): ResearchContinuityDiffSeverity {
  return severity === 'critical' ? 'critical' : 'warning';
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

function hasQualityMetadata(quality: JsonRecord): boolean {
  return Object.keys(quality).length > 0;
}

function isDiffItemType(value: string): value is ResearchContinuityDiffItemType {
  return [
    'claim',
    'risk',
    'watchpoint',
    'level',
    'invalidation',
    'view',
    'quality',
    'unknown',
  ].includes(value);
}

function emptyEvidence(): ResearchContinuityChangedItemEvidenceResponse {
  return {
    status: null,
    source_artifact: null,
    source_id: null,
    source_field: null,
  };
}

function dedupeItems(
  items: ResearchContinuityChangedItemResponse[],
): ResearchContinuityChangedItemResponse[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.group}:${item.title}:${item.after ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isEmptyFallbackLine(value: string): boolean {
  return /^no .* (reported|detected|available|found)\.?$/i.test(value.trim());
}

function entryType(entry: JsonRecord): string {
  return stringValue(entry.entry_type);
}

function entryStatus(entry: JsonRecord): string {
  return stringValue(entry.status);
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
