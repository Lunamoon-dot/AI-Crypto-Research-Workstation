import { JsonRecord } from '../database/journal.types';
import {
  ResearchContinuityThinReport,
  ResearchContinuityThinSection,
  ResearchContinuityThinSectionId,
} from './dto/research-continuity.dto';

export const RESEARCH_CONTINUITY_THIN_REPORT_VERSION =
  'research_continuity_thin.v1';

interface ContinuityReportRenderInput {
  entryType: string;
  snapshot: JsonRecord | null;
  previousState: JsonRecord | null;
  events: JsonRecord[];
  skippedReason?: string | null;
  repairContext?: JsonRecord | null;
  generatedAt?: string | null;
}

interface CandidateThinItem {
  text: string;
  canonicalText?: string | null;
}

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
  render(input: ContinuityReportRenderInput): {
    summary: string;
    sections: JsonRecord[];
    thinReport: ResearchContinuityThinReport;
    writerMetadata: JsonRecord;
  } {
    const summary = summaryText(input);
    const sections = [
      section('Summary', [summary], 'No continuity summary available.'),
      ...(input.repairContext
        ? [
            section(
              'Repair Context',
              repairContextItems(input.repairContext),
              'No repair context available.',
            ),
          ]
        : []),
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
    const writerMetadata: JsonRecord = {
      writer_source: 'deterministic_renderer',
      report_version: 'research_continuity.v1.1',
      evidence_contract_version: 'research_evidence.v1.2',
    };
    if (input.repairContext) {
      writerMetadata.repair_context = input.repairContext;
    }
    return {
      summary,
      sections,
      thinReport: buildThinReport(input),
      writerMetadata,
    };
  }
}

export function buildLegacyThinReport(input: {
  generatedAt?: string | null;
  sections: JsonRecord[];
  snapshotQuality: JsonRecord | null;
}): ResearchContinuityThinReport {
  const quality = recordValue(input.snapshotQuality);
  const sectionItems = sectionItemMap(input.sections);
  return assembleThinReport({
    generatedAt: input.generatedAt ?? null,
    quality,
    qualityItems: [
      ...qualityWarningItems(quality, null),
      ...itemsForTitles(sectionItems, ['Data Quality']),
    ],
    currentViewItems: itemsForTitles(sectionItems, ['Current View']),
    materialChangeItems: itemsForTitles(sectionItems, [
      'Material Changes',
      'Reinforced And Updated Claims',
    ]),
    activeRiskItems: itemsForTitles(sectionItems, ['Risks And Invalidations']),
    watchpointItems: itemsForTitles(sectionItems, ['Watchpoints And Levels']),
    resolvedItems: itemsForTitles(sectionItems, ['Resolved Or Weakened Items']),
    evidenceHealthItems: evidenceHealthItems(quality),
  });
}

function buildThinReport(
  input: ContinuityReportRenderInput,
): ResearchContinuityThinReport {
  const quality = recordValue(input.snapshot?.data_quality);
  const degraded = stringValue(quality.status) === 'degraded';
  const currentItems = currentViewItems(
    input.snapshot,
    input.previousState,
    input.events,
  ).map((item) =>
    degraded && item.toLowerCase().startsWith('directional bias:')
      ? `${item.replace(/\.$/, '')} (draft; low-confidence snapshot).`
      : item,
  );
  return assembleThinReport({
    generatedAt: input.generatedAt ?? null,
    quality,
    qualityItems: qualityWarningItems(quality, input.skippedReason),
    currentViewItems: currentItems,
    materialChangeItems: thinEventItems(input.events, [
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
      'scenario_added',
      'scenario_probability_changed',
      'scenario_invalidated',
      'data_quality_changed',
      'agent_conflict_changed',
    ]),
    activeRiskItems: [
      ...thinEventItems(input.events, [
        'risk_added',
        'risk_reinforced',
        'risk_updated',
        'invalidation_added',
        'invalidation_updated',
      ]),
      ...snapshotThinItems(input.snapshot, ['risk', 'invalidation']),
    ],
    watchpointItems: [
      ...thinEventItems(input.events, [
        'watchpoint_added',
        'watchpoint_carried',
        'watchpoint_updated',
        'level_added',
        'level_updated',
      ]),
      ...snapshotThinItems(input.snapshot, ['watchpoint', 'level']),
    ],
    resolvedItems: thinEventItems(input.events, [
      'claim_weakened',
      'risk_resolved',
      'watchpoint_resolved',
      'level_invalidated',
      'scenario_invalidated',
    ]),
    evidenceHealthItems: evidenceHealthItems(quality),
  });
}

function assembleThinReport(input: {
  generatedAt: string | null;
  quality: JsonRecord;
  qualityItems: Array<string | CandidateThinItem>;
  currentViewItems: Array<string | CandidateThinItem>;
  materialChangeItems: Array<string | CandidateThinItem>;
  activeRiskItems: Array<string | CandidateThinItem>;
  watchpointItems: Array<string | CandidateThinItem>;
  resolvedItems: Array<string | CandidateThinItem>;
  evidenceHealthItems: Array<string | CandidateThinItem>;
}): ResearchContinuityThinReport {
  const quality = thinQuality(input.quality);
  const qualitySectionItems =
    selectThinItems(input.qualityItems, 2, true).length > 0
      ? selectThinItems(input.qualityItems, 2, true)
      : qualitySummaryItems(input.quality);
  const currentViewItems =
    selectThinItems(input.currentViewItems, 4, true).length > 0
      ? selectThinItems(input.currentViewItems, 4, true)
      : ['Current view unavailable.'];
  const sections = [
    thinSection('quality', 'Data Quality', qualitySectionItems, 2, true),
    thinSection('current_view', 'Current View', currentViewItems, 4, true),
    thinSection(
      'material_changes',
      'Material Changes',
      input.materialChangeItems,
      5,
    ),
    thinSection('active_risks', 'Active Risks', input.activeRiskItems, 5),
    thinSection('watchpoints', 'Watchpoints', input.watchpointItems, 5),
    thinSection(
      'resolved_or_weakened',
      'Resolved Or Weakened',
      input.resolvedItems,
      3,
    ),
    thinSection(
      'evidence_health',
      'Evidence Health',
      input.evidenceHealthItems,
      1,
    ),
  ].filter((section): section is ResearchContinuityThinSection => Boolean(section));
  return {
    version: RESEARCH_CONTINUITY_THIN_REPORT_VERSION,
    generated_at: input.generatedAt,
    debug_available: true,
    debug_requires_role: 'editor',
    quality,
    sections,
  };
}

function thinQuality(quality: JsonRecord): ResearchContinuityThinReport['quality'] {
  return {
    status: stringValue(quality.status, 'unknown'),
    score: numberOrNull(quality.score),
    observed_evidence_coverage: numberOrNull(quality.observed_evidence_coverage),
    evidence_coverage: numberOrNull(quality.evidence_coverage),
    provenance_status: nullableString(quality.provenance_status),
    warnings: selectThinItems(qualityWarningItems(quality, null), 2, true),
  };
}

function thinSection(
  id: ResearchContinuityThinSectionId,
  title: string,
  items: Array<string | CandidateThinItem>,
  cap: number,
  required = false,
): ResearchContinuityThinSection | null {
  const selected = selectThinItems(items, cap, required);
  if (selected.length === 0 && !required) {
    return null;
  }
  return {
    id,
    title,
    items: selected,
  };
}

function repairContextItems(context: JsonRecord): string[] {
  return [
    `Case type: ${stringValue(context.case_type, 'unknown')}.`,
    `Source run: ${stringValue(context.source_run_id, 'unknown')}.`,
    `Source entry: ${stringValue(context.source_entry_id, 'none')}.`,
    `Previous context entry: ${stringValue(context.previous_context_entry_id, 'none')}.`,
    `Reason: ${stringValue(context.reason, 'unspecified')}.`,
    `Repair version: ${stringValue(context.repair_version, 'unknown')}.`,
    `State updated: ${Boolean(context.state_updated) ? 'yes' : 'no'}.`,
  ];
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
      'scenario_added',
      'scenario_probability_changed',
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
    coverageLine('Observed evidence coverage', quality.observed_evidence_coverage),
    `Reasoning-only items: ${numberText(quality.reasoning_only_item_count)}.`,
    `Missing-limited items: ${numberText(quality.missing_evidence_item_count)}.`,
    `No-evidence items: ${numberText(quality.no_evidence_item_count)}.`,
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
    `Observed evidence count: ${numberText(quality.observed_evidence_count)}.`,
    `Reasoning evidence count: ${numberText(quality.reasoning_evidence_count)}.`,
    `Missing evidence count: ${numberText(quality.missing_evidence_count)}.`,
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

function qualityWarningItems(
  quality: JsonRecord,
  skippedReason?: string | null,
): string[] {
  if (skippedReason) {
    return [`Continuity skipped: ${skippedReason}.`];
  }
  const status = stringValue(quality.status);
  const observedCoverage = numberOrNull(quality.observed_evidence_coverage);
  const warnings = [
    status === 'degraded'
      ? `Snapshot degraded${
          observedCoverage === null
            ? '.'
            : `: observed evidence coverage ${formatPercent(observedCoverage)}.`
        }`
      : '',
    status === 'skipped' ? 'Snapshot skipped: insufficient continuity data.' : '',
    missingReasonsLine(stringList(quality.reasons)),
    stringValue(quality.provenance_status) === 'partial'
      ? 'Evidence provenance is partial.'
      : '',
  ].filter(Boolean);
  return warnings;
}

function qualitySummaryItems(quality: JsonRecord): string[] {
  const status = stringValue(quality.status, 'unknown');
  const score = numberOrNull(quality.score);
  const evidenceCoverage = numberOrNull(quality.evidence_coverage);
  return [
    `Snapshot quality: ${status}${score === null ? '' : ` (score ${score})`}.`,
    evidenceCoverage === null
      ? ''
      : `Evidence coverage: ${formatPercent(evidenceCoverage)}.`,
  ].filter(Boolean);
}

function evidenceHealthItems(quality: JsonRecord): string[] {
  const observed = numberValue(quality.observed_evidence_count);
  const reasoning = numberValue(quality.reasoning_evidence_count);
  const missing = numberValue(quality.missing_evidence_count);
  const observedCoverage = numberOrNull(quality.observed_evidence_coverage);
  if (
    observed === 0 &&
    reasoning === 0 &&
    missing === 0 &&
    observedCoverage === null
  ) {
    return [];
  }
  return [
    `Evidence: ${observed} observed, ${reasoning} reasoning-only, ${missing} missing${
      observedCoverage === null
        ? '.'
        : `. Observed coverage ${formatPercent(observedCoverage)}.`
    }`,
  ];
}

function missingReasonsLine(reasons: string[]): string {
  const missing = reasons
    .filter((reason) => reason.toLowerCase().includes('missing'))
    .map(readableReason)
    .filter(Boolean);
  if (missing.length === 0) {
    return '';
  }
  return `Missing ${joinList(uniqueStrings(missing))}.`;
}

function readableReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/^missing_/, '')
    .replace(/^the_/, '')
    .replace(/_tool_returned_a_/g, '_')
    .replace(/_status$/g, '')
    .replace(/_/g, ' ')
    .replace(/\bnews feed\b/g, 'reliable news feed')
    .trim();
}

function joinList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function thinEventItems(
  events: JsonRecord[],
  eventTypes: string[],
): CandidateThinItem[] {
  return events
    .filter((event) => eventTypes.includes(stringValue(event.event_type)))
    .map((event) => {
      const previousText = stringValue(event.previous_text);
      const currentText = stringValue(event.current_text);
      if (
        previousText &&
        currentText &&
        thinKey(previousText) === thinKey(currentText)
      ) {
        return null;
      }
      const text = formatEventLine(event);
      return text
        ? {
            text,
            canonicalText: nullableString(event.canonical_text),
          }
        : null;
    })
    .filter(
      (item): item is { text: string; canonicalText: string | null } =>
        item !== null,
    );
}

function snapshotThinItems(
  snapshot: JsonRecord | null,
  types: string[],
): CandidateThinItem[] {
  return arrayRecords(snapshot?.tracked_items)
    .filter((item) => types.includes(stringValue(item.type)))
    .map((item) => ({
      text: stringValue(item.current_text ?? item.text),
      canonicalText: nullableString(item.canonical_text),
    }));
}

function sectionItemMap(sections: JsonRecord[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const section of sections) {
    map.set(stringValue(section.title).toLowerCase(), stringList(section.items));
  }
  return map;
}

function itemsForTitles(map: Map<string, string[]>, titles: string[]): string[] {
  return titles.flatMap((title) => map.get(title.toLowerCase()) ?? []);
}

function selectThinItems(
  values: Array<string | CandidateThinItem>,
  cap: number,
  allowFallback = false,
): string[] {
  return dedupeThinItems(
    values
      .map((value) =>
        typeof value === 'string'
          ? { text: value, canonicalText: null }
          : value,
      )
      .map((item) => ({
        text: sanitizeThinText(item.text),
        canonicalText: item.canonicalText,
      }))
      .filter((item) => isDisplayableThinText(item.text, allowFallback)),
  ).slice(0, cap);
}

function dedupeThinItems(items: CandidateThinItem[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.canonicalText
      ? thinKey(item.canonicalText)
      : thinKey(item.text);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item.text);
  }
  return result;
}

function sanitizeThinText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/^[>\s]+/g, '')
    .replace(/[#*_`]+/g, '')
    .replace(/[{}\[\]]/g, '')
    .replace(/[\u26A0\uFE0F\u2757\u{1F6A8}\u2705]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"',:;.-]+/g, '')
    .replace(/[\s"',:;.-]+$/g, '.')
    .trim();
}

function isDisplayableThinText(value: string, allowFallback: boolean): boolean {
  if (!value || isHeadingOnlyThinText(value)) {
    return false;
  }
  if (/^(you|your|i|we|let me|now|that's|that is|but)\b/i.test(value)) {
    return false;
  }
  return allowFallback || hasThinSignal(value);
}

function isHeadingOnlyThinText(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return new Set([
    'risks',
    'key risk factors',
    'summary',
    'synthesis',
    'liquidations',
    'on the risk/reward',
  ]).has(normalized);
}

function hasThinSignal(value: string): boolean {
  return (
    /[0-9]/.test(value) ||
    /\b[A-Z]{2,}(?:\/[A-Z]{2,})?\b/.test(value) ||
    /\b(bias|bullish|bearish|neutral|conviction|risk|posture|defensive|cautious|support|resistance|funding|liquidation|break(?:down)?|invalidat|watch|level|price|target|missing|unavailable|stale|evidence|coverage|observed|reasoning|source|provenance|degraded|clean|skipped|changed|added|updated|resolved|weakened|open interest|oi|macro|liquidity|pressure|weakness)\b/i.test(
      value,
    )
  );
}

function thinKey(value: string): string {
  return sanitizeThinText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/.\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function numberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberValue(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value);
  return text ? text : null;
}
