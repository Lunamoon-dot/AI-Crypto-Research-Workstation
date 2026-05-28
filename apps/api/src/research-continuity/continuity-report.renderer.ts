import { JsonRecord } from '../database/journal.types';

export const CONTINUITY_SECTION_TITLES = [
  'Summary',
  'Current View',
  'Material Changes',
  'Reinforced And Updated Claims',
  'Risks And Invalidations',
  'Watchpoints And Levels',
  'Resolved Or Weakened Items',
  'Source And Evidence Trace',
  'Data Quality',
] as const;

export class ContinuityReportRenderer {
  render(input: {
    entryType: string;
    snapshot: JsonRecord | null;
    previousState: JsonRecord | null;
    events: JsonRecord[];
    skippedReason?: string | null;
  }): { summary: string; sections: JsonRecord[]; writerMetadata: JsonRecord } {
    const summary = summaryText(input);
    const sections = [
      section('Summary', [summary], 'No continuity summary available.'),
      section(
        'Current View',
        currentViewItems(input.snapshot, input.previousState, input.events),
        'No current symbol view available.',
      ),
      section(
        'Material Changes',
        eventLines(input.events, [
          'view_changed',
          'claim_added',
          'claim_updated',
          'risk_added',
          'risk_updated',
          'watchpoint_added',
          'watchpoint_updated',
          'level_added',
          'level_updated',
          'invalidation_added',
          'invalidation_updated',
          'data_quality_changed',
          'agent_conflict_changed',
        ]),
        'No material changes detected.',
      ),
      section(
        'Reinforced And Updated Claims',
        eventLines(input.events, ['claim_reinforced', 'claim_updated']),
        'No reinforced or updated claims detected.',
      ),
      section(
        'Risks And Invalidations',
        eventLines(input.events, [
          'risk_added',
          'risk_reinforced',
          'risk_updated',
          'invalidation_added',
          'invalidation_updated',
        ]),
        'No risk or invalidation changes detected.',
      ),
      section(
        'Watchpoints And Levels',
        eventLines(input.events, [
          'watchpoint_added',
          'watchpoint_carried',
          'watchpoint_updated',
          'level_added',
          'level_updated',
        ]),
        'No watchpoint or level changes detected.',
      ),
      section(
        'Resolved Or Weakened Items',
        eventLines(input.events, [
          'claim_weakened',
          'risk_resolved',
          'watchpoint_resolved',
          'level_invalidated',
        ]),
        'No resolved or weakened items in this run.',
      ),
      section(
        'Source And Evidence Trace',
        traceItems(input.snapshot, input.previousState),
        'No source or evidence trace available.',
      ),
      section(
        'Data Quality',
        dataQualityItems(input.snapshot, input.skippedReason),
        'No new limitations reported.',
      ),
    ];
    return {
      summary,
      sections,
      writerMetadata: {
        writer_source: 'deterministic_renderer',
        report_version: 'research_continuity.v1.1',
      },
    };
  }
}

function summaryText(input: {
  entryType: string;
  snapshot: JsonRecord | null;
  events: JsonRecord[];
  skippedReason?: string | null;
}): string {
  if (input.entryType === 'skipped') {
    return `Continuity skipped: ${input.skippedReason ?? 'insufficient_structured_data'}.`;
  }
  if (input.entryType === 'baseline') {
    return 'Baseline continuity state initialized for this symbol.';
  }
  if (input.entryType === 'degraded') {
    return 'Continuity entry saved with degraded snapshot quality; state updates were constrained.';
  }
  const changed = input.events.filter((event) =>
    [
      'view_changed',
      'claim_added',
      'claim_updated',
      'risk_added',
      'risk_updated',
      'watchpoint_added',
      'watchpoint_updated',
    ].includes(stringValue(event.event_type)),
  ).length;
  return changed > 0
    ? `Daily Research Delta recorded ${changed} material continuity changes.`
    : 'Daily Research Delta found no material continuity changes.';
}

function section(title: string, items: string[], emptyState: string): JsonRecord {
  return {
    title,
    items: items.length > 0 ? uniqueStrings(items) : [emptyState],
    empty_state: emptyState,
  };
}

function currentViewItems(
  snapshot: JsonRecord | null,
  previousState: JsonRecord | null,
  events: JsonRecord[],
): string[] {
  const view = recordValue(snapshot?.symbol_view ?? previousState?.current_view);
  const viewItems = [
    ['Directional bias', view.directional_bias],
    ['Risk posture', view.risk_posture],
    ['Conviction', view.conviction],
    ['Time context', view.time_context],
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `${label}: ${String(value)}.`);
  return [...viewItems, ...eventLines(events, ['view_changed'])];
}

function eventLines(events: JsonRecord[], eventTypes: string[]): string[] {
  return events
    .filter((event) => eventTypes.includes(stringValue(event.event_type)))
    .map(formatEventLine)
    .filter(Boolean);
}

function formatEventLine(event: JsonRecord): string {
  const eventType = stringValue(event.event_type);
  if (eventType.endsWith('_updated')) {
    const previousText = stringValue(event.previous_text);
    const currentText = stringValue(event.current_text);
    if (previousText && currentText && previousText !== currentText) {
      return `${eventType}: "${previousText}" -> "${currentText}".`;
    }
  }
  return stringValue(event.reason);
}

function traceItems(
  snapshot: JsonRecord | null,
  previousState: JsonRecord | null,
): string[] {
  const quality = recordValue(snapshot?.data_quality);
  const identityQuality = recordValue(quality.identity_quality);
  const items = arrayRecords(snapshot?.tracked_items);
  const legacyStateItemCount = arrayRecords(previousState?.active_items).filter(
    (item) => !item.item_key_version || !item.trace_quality,
  ).length;
  const lowTraceItems = items
    .filter((item) =>
      ['unsourced', 'sourced'].includes(stringValue(item.trace_quality)),
    )
    .slice(0, 5)
    .map((item) => `${stringValue(item.type, 'item')}: ${stringValue(item.text)}`);
  return [
    coverageLine('Source coverage', quality.source_coverage),
    coverageLine('Evidence coverage', quality.evidence_coverage),
    `Fallback identity count: ${numberText(identityQuality.fallback_hash_count)}.`,
    legacyStateItemCount > 0
      ? `Legacy state items without V1.1 trace fields: ${legacyStateItemCount}.`
      : '',
    ...lowTraceItems.map((item) => `Low-trace item: ${item}`),
  ].filter(Boolean);
}

function dataQualityItems(
  snapshot: JsonRecord | null,
  skippedReason?: string | null,
): string[] {
  if (skippedReason) {
    return [skippedReason];
  }
  const quality = recordValue(snapshot?.data_quality);
  const status = stringValue(quality.status);
  const score = quality.score;
  const reasons = stringList(quality.reasons);
  const provenanceStatus = stringValue(quality.provenance_status);
  const provenanceReasons = stringList(quality.provenance_reasons);
  return [
    status ? `Snapshot quality: ${status}${score === undefined ? '' : ` (${score})`}.` : '',
    provenanceStatus ? `Provenance status: ${provenanceStatus}.` : '',
    ...reasons,
    ...provenanceReasons,
  ].filter(Boolean);
}

function coverageLine(label: string, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `${label}: ${String(value)}.`;
  }
  return `${label}: ${Math.round(numeric * 100)}%.`;
}

function numberText(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : '0';
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
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function stringValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
