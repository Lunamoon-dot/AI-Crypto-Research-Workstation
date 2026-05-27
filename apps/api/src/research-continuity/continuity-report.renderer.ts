import { JsonRecord } from '../database/journal.types';

export const CONTINUITY_SECTION_TITLES = [
  'Summary',
  'View Change',
  'What Changed',
  'What Stayed Valid',
  'What Became Invalid / Less Useful',
  'New Risks',
  'Resolved or Reduced Risks',
  'Watch Next',
  'Data Quality / Limitations',
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
        'View Change',
        eventReasons(input.events, ['view_changed', 'view_observed', 'baseline_initialized']),
        'No material view change detected.',
      ),
      section(
        'What Changed',
        eventReasons(input.events, [
          'claim_added',
          'claim_weakened',
          'risk_added',
          'watchpoint_added',
          'level_added',
          'invalidation_added',
          'data_quality_changed',
          'agent_conflict_changed',
        ]),
        'No material changes detected.',
      ),
      section(
        'What Stayed Valid',
        eventReasons(input.events, [
          'claim_reinforced',
          'risk_reinforced',
          'watchpoint_carried',
        ]),
        'No carried-forward items detected.',
      ),
      section(
        'What Became Invalid / Less Useful',
        eventReasons(input.events, ['claim_weakened', 'level_invalidated']),
        'No invalidated or weakened items in this run.',
      ),
      section(
        'New Risks',
        eventReasons(input.events, ['risk_added']),
        'No new risks identified.',
      ),
      section(
        'Resolved or Reduced Risks',
        eventReasons(input.events, ['risk_resolved']),
        'No resolved risks in this run.',
      ),
      section(
        'Watch Next',
        watchNext(input.snapshot, input.events),
        'No new watchpoints from this run.',
      ),
      section(
        'Data Quality / Limitations',
        dataQualityItems(input.snapshot, input.skippedReason),
        'No new limitations reported.',
      ),
    ];
    return {
      summary,
      sections,
      writerMetadata: {
        writer_source: 'deterministic_renderer',
        report_version: 'research_continuity.v1',
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
    ['view_changed', 'claim_added', 'risk_added', 'watchpoint_added'].includes(
      stringValue(event.event_type),
    ),
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

function eventReasons(events: JsonRecord[], eventTypes: string[]): string[] {
  return events
    .filter((event) => eventTypes.includes(stringValue(event.event_type)))
    .map((event) => stringValue(event.reason))
    .filter(Boolean);
}

function watchNext(snapshot: JsonRecord | null, events: JsonRecord[]): string[] {
  const eventItems = eventReasons(events, ['watchpoint_added', 'watchpoint_carried']);
  const snapshotItems = arrayRecords(snapshot?.tracked_items)
    .filter((item) => stringValue(item.type) === 'watchpoint')
    .map((item) => stringValue(item.text))
    .filter(Boolean);
  return [...eventItems, ...snapshotItems];
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
  return [
    status ? `Snapshot quality: ${status}${score === undefined ? '' : ` (${score})`}.` : '',
    ...reasons,
  ].filter(Boolean);
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

function stringValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return String(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
