import { createHash } from 'node:crypto';
import { JsonRecord } from '../database/journal.types';

export interface ResearchSnapshotBuildInput {
  run: JsonRecord;
  debate: JsonRecord | null;
  agentOpinions: JsonRecord[];
  thesis: JsonRecord | null;
  marketSnapshot: JsonRecord | null;
  signalSnapshot: JsonRecord | null;
}

export interface ResearchSnapshotBuildResult {
  snapshot: JsonRecord | null;
  quality: JsonRecord;
  skippedReason: string | null;
}

type TrackedItemType = 'claim' | 'risk' | 'watchpoint' | 'level' | 'invalidation';
type Importance = 'low' | 'medium' | 'high';

interface TrackedItemSeed {
  type: TrackedItemType;
  text: string;
  importance: Importance;
  source_artifact: string | null;
  source_id: string | null;
  source_field: string | null;
  attributes?: JsonRecord;
}

const TYPE_PRIORITY: Record<TrackedItemType, number> = {
  invalidation: 5,
  risk: 4,
  watchpoint: 3,
  level: 2,
  claim: 1,
};

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

export class ResearchSnapshotBuilder {
  build(input: ResearchSnapshotBuildInput): ResearchSnapshotBuildResult {
    const runId = stringValue(input.run.id ?? input.run.run_id);
    const workspaceId = stringValue(input.run.workspace_id, 'local');
    const symbol = stringValue(
      input.run.symbol ??
        input.thesis?.symbol ??
        input.debate?.symbol ??
        input.marketSnapshot?.symbol ??
        input.signalSnapshot?.symbol,
    );
    if (!runId || !symbol) {
      return {
        snapshot: null,
        quality: {
          score: 0,
          status: 'skipped',
          reasons: ['missing_run_or_symbol'],
          can_update_top_level_view: false,
        },
        skippedReason: 'missing_run_or_symbol',
      };
    }

    const baseQuality = snapshotQuality(input);
    if (baseQuality.skipped) {
      return {
        snapshot: null,
        quality: baseQuality,
        skippedReason: 'insufficient_structured_data',
      };
    }

    const capturedAt = stringValue(
      input.run.completed_at ??
        input.run.started_at ??
        input.thesis?.created_at ??
        input.debate?.created_at ??
        input.marketSnapshot?.captured_at ??
        input.signalSnapshot?.captured_at,
      new Date().toISOString(),
    );
    const timeContext = timeContextValue(input.run, input.thesis);
    const symbolView = {
      directional_bias: directionalBias(input),
      risk_posture: riskPosture(input),
      conviction: conviction(input),
      time_context: timeContext,
    };
    const evidence = evidenceItems(input);
    const trackedItems = dedupeTrackedItems(
      [
        ...riskItems(input.thesis, input.agentOpinions),
        ...watchpointItems(input.thesis),
        ...invalidationItems(input.thesis, input.agentOpinions),
        ...levelItems(input.thesis),
        ...claimItems(input.thesis),
      ].map((seed) => trackedItem(seed, evidence)),
    );
    const quality = snapshotQualityWithTrackedItems(baseQuality, trackedItems);
    const sourceArtifacts = {
      debate_id: nullableString(input.debate?.id ?? input.run.debate_id),
      agent_opinion_ids: input.agentOpinions
        .map((opinion) => nullableString(opinion.id))
        .filter((id): id is string => Boolean(id)),
      thesis_id: nullableString(input.thesis?.id ?? input.run.thesis_id),
      market_snapshot_id: nullableString(
        input.marketSnapshot?.id ?? input.run.market_snapshot_id,
      ),
      signal_snapshot_id: nullableString(
        input.signalSnapshot?.id ?? input.run.signal_snapshot_id,
      ),
    };
    const snapshot = {
      id: `snapshot_${safeId(runId)}`,
      workspace_id: workspaceId,
      research_run_id: runId,
      symbol,
      captured_at: capturedAt,
      time_context: timeContext,
      symbol_view: symbolView,
      tracked_items: trackedItems,
      data_quality: quality,
      source_artifacts: sourceArtifacts,
      payload: {
        schema_version: 'research_snapshot.v1.1',
        run_status: stringValue(input.run.status, 'unknown'),
        market: input.marketSnapshot
          ? {
              current_price: nullableNumber(input.marketSnapshot.current_price),
              source: nullableString(input.marketSnapshot.source),
            }
          : null,
        signal: input.signalSnapshot
          ? {
              signal_count: nullableNumber(input.signalSnapshot.signal_count),
              bullish_count: nullableNumber(input.signalSnapshot.bullish_count),
              bearish_count: nullableNumber(input.signalSnapshot.bearish_count),
              neutral_count: nullableNumber(input.signalSnapshot.neutral_count),
            }
          : null,
      },
    };
    return { snapshot, quality, skippedReason: null };
  }
}

function snapshotQuality(input: ResearchSnapshotBuildInput): JsonRecord {
  const reasons: string[] = [];
  let score = 0;
  let artifactCount = 0;
  if (input.debate) {
    score += 0.25;
    artifactCount += 1;
  }
  if (input.thesis) {
    score += 0.3;
    artifactCount += 1;
  }
  if (input.marketSnapshot) {
    score += 0.15;
    artifactCount += 1;
  }
  if (input.signalSnapshot) {
    score += 0.15;
    artifactCount += 1;
  }
  if (input.agentOpinions.length > 0) {
    score += 0.15;
    artifactCount += 1;
  }
  const missing = [
    ...stringList(input.run.missing_core_data),
    ...stringList(input.run.missing_optional_data),
    ...stringList(input.run.degradation_reasons),
  ];
  if (missing.length > 0) {
    reasons.push(...missing);
  }
  if (stringValue(input.run.status) === 'completed_degraded') {
    reasons.push('run_completed_degraded');
  }
  const roundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  const skipped = artifactCount === 0 || roundedScore < 0.25;
  const degraded =
    !skipped &&
    (stringValue(input.run.status) === 'completed_degraded' || roundedScore < 0.65);
  return {
    score: roundedScore,
    status: skipped ? 'skipped' : degraded ? 'degraded' : 'clean',
    reasons: uniqueStrings(reasons),
    artifact_count: artifactCount,
    skipped,
    can_update_top_level_view: !skipped && roundedScore >= 0.65,
  };
}

function snapshotQualityWithTrackedItems(
  baseQuality: JsonRecord,
  items: JsonRecord[],
): JsonRecord {
  const trackedItemCount = items.length;
  const counts = {
    claim_count: countItems(items, 'claim'),
    risk_count: countItems(items, 'risk'),
    watchpoint_count: countItems(items, 'watchpoint'),
    level_count: countItems(items, 'level'),
    invalidation_count: countItems(items, 'invalidation'),
  };
  const sourcedItemCount = items.filter(
    (item) => stringValue(item.trace_quality) !== 'unsourced',
  ).length;
  const unsourcedItemCount = trackedItemCount - sourcedItemCount;
  const evidenceAttachedCount = items.filter(
    (item) => stringList(item.evidence).length > 0,
  ).length;
  const fallbackHashCount = items.filter(
    (item) => stringValue(item.identity_confidence) !== 'high',
  ).length;
  const highConfidenceIdentityCount = items.filter(
    (item) => stringValue(item.identity_confidence) === 'high',
  ).length;
  const provenanceReasons = [
    unsourcedItemCount > 0
      ? `${unsourcedItemCount} tracked items missing source provenance`
      : '',
    fallbackHashCount > 0
      ? `${fallbackHashCount} tracked items use fallback text identity`
      : '',
  ].filter(Boolean);

  return {
    ...baseQuality,
    tracked_item_count: trackedItemCount,
    ...counts,
    sourced_item_count: sourcedItemCount,
    unsourced_item_count: unsourcedItemCount,
    source_coverage: ratio(sourcedItemCount, trackedItemCount),
    evidence_attached_count: evidenceAttachedCount,
    evidence_coverage: ratio(evidenceAttachedCount, trackedItemCount),
    identity_quality: {
      stable_key_count: trackedItemCount - fallbackHashCount,
      fallback_hash_count: fallbackHashCount,
      fallback_hash_ratio: ratio(fallbackHashCount, trackedItemCount),
      high_confidence_identity_count: highConfidenceIdentityCount,
    },
    provenance_status: provenanceReasons.length === 0 ? 'clean' : 'partial',
    provenance_reasons: provenanceReasons,
  };
}

function directionalBias(input: ResearchSnapshotBuildInput): string {
  return normalizeDirectionalBias(
    input.debate?.consensus_stance ??
      recordValue(input.thesis?.summary).direction ??
      input.thesis?.direction ??
      signalBias(input.signalSnapshot),
  );
}

function signalBias(signal: JsonRecord | null): string {
  if (!signal) {
    return 'unclear';
  }
  const bullish = nullableNumber(signal.bullish_count) ?? 0;
  const bearish = nullableNumber(signal.bearish_count) ?? 0;
  if (bullish > bearish) {
    return 'cautious_bullish';
  }
  if (bearish > bullish) {
    return 'cautious_bearish';
  }
  return 'neutral';
}

function normalizeDirectionalBias(value: unknown): string {
  const normalized = stringValue(value, 'unclear').trim().toLowerCase();
  if (
    [
      'bearish',
      'cautious_bearish',
      'neutral',
      'mixed',
      'cautious_bullish',
      'bullish',
      'unclear',
    ].includes(normalized)
  ) {
    return normalized;
  }
  if (['long', 'buy', 'overweight'].includes(normalized)) {
    return 'bullish';
  }
  if (['short', 'sell', 'underweight'].includes(normalized)) {
    return 'bearish';
  }
  if (['hold', 'watch'].includes(normalized)) {
    return 'neutral';
  }
  return 'unclear';
}

function riskPosture(input: ResearchSnapshotBuildInput): string {
  const conflict = stringValue(input.debate?.conflict_level).toLowerCase();
  if (
    stringValue(input.run.status) === 'completed_degraded' ||
    stringList(input.run.missing_core_data).length > 0
  ) {
    return 'defensive';
  }
  if (conflict === 'high') {
    return 'defensive';
  }
  if (conflict === 'medium') {
    return 'cautious';
  }
  const bias = directionalBias(input);
  if (bias === 'bullish') {
    return 'opportunistic';
  }
  if (bias === 'bearish') {
    return 'defensive';
  }
  return 'balanced';
}

function conviction(input: ResearchSnapshotBuildInput): string {
  const values = [
    nullableNumber(input.thesis?.confidence),
    nullableNumber(recordValue(input.thesis?.summary).confidence),
    ...input.agentOpinions.map((opinion) => nullableNumber(opinion.confidence)),
  ].filter((value): value is number => value !== null);
  if (values.length === 0) {
    return 'unclear';
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (average >= 0.75) {
    return 'high';
  }
  if (average >= 0.45) {
    return 'medium';
  }
  return 'low';
}

function claimItems(thesis: JsonRecord | null): TrackedItemSeed[] {
  const thesisId = nullableString(thesis?.id);
  const summary = recordValue(thesis?.summary);
  const payloadSummary = recordValue(recordValue(thesis?.payload).structured_summary);
  return [
    ...indexedStrings(summary.key_reasons, (text, index) =>
      seedItem('claim', text, 'medium', 'thesis', thesisId, `summary.key_reasons[${index}]`),
    ),
    ...singleString(summary.why_this_thesis, (text) =>
      seedItem('claim', text, 'medium', 'thesis', thesisId, 'summary.why_this_thesis'),
    ),
    ...singleString(thesis?.why_this_thesis, (text) =>
      seedItem('claim', text, 'medium', 'thesis', thesisId, 'why_this_thesis'),
    ),
    ...indexedStrings(payloadSummary.key_reasons, (text, index) =>
      seedItem(
        'claim',
        text,
        'medium',
        'thesis',
        thesisId,
        `payload.structured_summary.key_reasons[${index}]`,
      ),
    ),
    ...singleString(payloadSummary.why_this_thesis, (text) =>
      seedItem(
        'claim',
        text,
        'medium',
        'thesis',
        thesisId,
        'payload.structured_summary.why_this_thesis',
      ),
    ),
  ];
}

function riskItems(thesis: JsonRecord | null, opinions: JsonRecord[]): TrackedItemSeed[] {
  const thesisId = nullableString(thesis?.id);
  const summary = recordValue(thesis?.summary);
  return [
    ...indexedStrings(summary.risks, (text, index) =>
      seedItem('risk', text, 'medium', 'thesis', thesisId, `summary.risks[${index}]`),
    ),
    ...indexedStrings(thesis?.risks, (text, index) =>
      seedItem('risk', text, 'medium', 'thesis', thesisId, `risks[${index}]`),
    ),
    ...opinions.flatMap((opinion) => {
      const payload = recordValue(opinion.payload);
      return indexedStrings(payload.risks, (text, index) =>
        seedItem(
          'risk',
          text,
          'medium',
          'agent_opinion',
          nullableString(opinion.id),
          `payload.risks[${index}]`,
        ),
      );
    }),
  ];
}

function watchpointItems(thesis: JsonRecord | null): TrackedItemSeed[] {
  const thesisId = nullableString(thesis?.id);
  const summary = recordValue(thesis?.summary);
  return [
    ...indexedStrings(thesis?.monitor_next, (text, index) =>
      seedItem('watchpoint', text, 'medium', 'thesis', thesisId, `monitor_next[${index}]`),
    ),
    ...indexedStrings(summary.monitor_next, (text, index) =>
      seedItem(
        'watchpoint',
        text,
        'medium',
        'thesis',
        thesisId,
        `summary.monitor_next[${index}]`,
      ),
    ),
  ];
}

function invalidationItems(
  thesis: JsonRecord | null,
  opinions: JsonRecord[],
): TrackedItemSeed[] {
  const thesisId = nullableString(thesis?.id);
  const summary = recordValue(thesis?.summary);
  return [
    ...singleString(thesis?.invalidation_level, (text) =>
      seedItem('invalidation', text, 'high', 'thesis', thesisId, 'invalidation_level'),
    ),
    ...singleString(summary.invalidation, (text) =>
      seedItem('invalidation', text, 'high', 'thesis', thesisId, 'summary.invalidation'),
    ),
    ...opinions.flatMap((opinion) =>
      singleString(recordValue(opinion.payload).invalidation, (text) =>
        seedItem(
          'invalidation',
          text,
          'high',
          'agent_opinion',
          nullableString(opinion.id),
          'payload.invalidation',
        ),
      ),
    ),
  ];
}

function levelItems(thesis: JsonRecord | null): TrackedItemSeed[] {
  const thesisId = nullableString(thesis?.id);
  const summary = recordValue(thesis?.summary);
  const source = thesis?.target_zones ?? summary.target_zones;
  const sourceField = thesis?.target_zones ? 'target_zones' : 'summary.target_zones';
  return indexedStrings(source, (text, index) =>
    seedItem('level', text, 'medium', 'thesis', thesisId, `${sourceField}[${index}]`),
  );
}

function evidenceItems(input: ResearchSnapshotBuildInput): string[] {
  const thesis = input.thesis;
  const summary = recordValue(thesis?.summary);
  const payloadSummary = recordValue(recordValue(thesis?.payload).structured_summary);
  return uniqueStrings([
    ...stringList(summary.supporting_evidence),
    ...stringList(thesis?.supporting_evidence),
    ...stringList(payloadSummary.supporting_evidence),
    ...input.agentOpinions.flatMap((opinion) => {
      const payload = recordValue(opinion.payload);
      return [
        ...stringList(payload.evidence),
        ...stringList(payload.supporting_evidence),
      ];
    }),
  ]);
}

function seedItem(
  type: TrackedItemType,
  text: string,
  importance: Importance,
  sourceArtifact: string | null,
  sourceId: string | null,
  sourceField: string | null,
): TrackedItemSeed {
  return {
    type,
    text,
    importance,
    source_artifact: sourceArtifact,
    source_id: sourceId,
    source_field: sourceField,
  };
}

function trackedItem(seed: TrackedItemSeed, evidence: string[]): JsonRecord {
  const canonical = canonicalText(seed.text);
  const identityTerms = identityTermsFor(seed.text);
  const hasSource = Boolean(seed.source_artifact || seed.source_id || seed.source_field);
  const identityConfidence = identityConfidenceFor(canonical, identityTerms, hasSource);
  const topic = identityTerms[0] ?? 'text';
  const identitySeed =
    identityTerms.length > 0 ? identityTerms.join('|') : canonical || normalizedText(seed.text);
  const stableKeyPart = identityTerms.length > 0 ? topic : 'text';
  const itemEvidence = evidence.length > 0 ? evidence : [];
  return {
    item_key: `${seed.type}:${stableKeyPart}:${hashKey(identitySeed)}`,
    legacy_item_key: legacyItemKey(seed.type, seed.text),
    item_key_version: 'v1.1',
    type: seed.type,
    topic,
    status: 'active',
    text: seed.text,
    canonical_text: canonical,
    identity_terms: identityTerms,
    identity_confidence: identityConfidence,
    trace_quality: traceQuality(hasSource, itemEvidence.length > 0),
    importance: seed.importance,
    attributes: seed.attributes ?? {},
    evidence: itemEvidence,
    source_artifact: seed.source_artifact,
    source_id: seed.source_id,
    source_field: seed.source_field,
  };
}

function dedupeTrackedItems(items: JsonRecord[]): JsonRecord[] {
  const byIdentity = new Map<string, JsonRecord>();
  for (const item of items) {
    const key = dedupeKey(item);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, item);
      continue;
    }
    if (typePriority(item) > typePriority(existing)) {
      byIdentity.set(key, item);
    }
  }
  return [...byIdentity.values()];
}

function dedupeKey(item: JsonRecord): string {
  const terms = stringList(item.identity_terms);
  if (terms.length > 0) {
    return `terms:${terms.join('|')}`;
  }
  return `text:${stringValue(item.canonical_text)}`;
}

function typePriority(item: JsonRecord): number {
  const type = stringValue(item.type) as TrackedItemType;
  return TYPE_PRIORITY[type] ?? 0;
}

function canonicalText(value: string): string {
  return normalizedText(value)
    .replace(/[$€£]?\d[\d,.]*(?:\.\d+)?%?/g, '<number>')
    .replace(/[^a-z0-9_<>\s]/g, ' ')
    .split(/\s+/)
    .filter((part) => part && !STOPWORDS.has(part))
    .join(' ');
}

function identityTermsFor(value: string): string[] {
  const normalized = normalizedText(value);
  const terms: string[] = [];
  if (/\bmarket\s+structure\b/.test(normalized)) {
    terms.push('market_structure');
  }
  if (/\b(perp\s+)?funding(\s+rates?)?\b/.test(normalized)) {
    terms.push('funding');
  }
  if (/\b(late\s+longs?|long\s+entries|chasing\s+longs?)\b/.test(normalized)) {
    terms.push('long_entry');
  }
  if (/\b(break(?:\s+back)?\s+below|lost\s+support|breakdown)\b/.test(normalized)) {
    terms.push('break_below');
  }
  if (/\b(spot\s+bid|spot\s+demand)\b/.test(normalized)) {
    terms.push('spot_demand');
  }
  if (/\b(open\s+interest|oi)\b/.test(normalized)) {
    terms.push('open_interest');
  }
  return uniqueStrings(terms);
}

function identityConfidenceFor(
  canonical: string,
  identityTerms: string[],
  hasSource: boolean,
): 'high' | 'medium' | 'low' {
  if (identityTerms.length > 0) {
    return 'high';
  }
  if (hasSource && canonical.length >= 16) {
    return 'medium';
  }
  return 'low';
}

function traceQuality(
  hasSource: boolean,
  hasEvidence: boolean,
): 'evidence_backed' | 'sourced' | 'unsourced' {
  if (hasSource && hasEvidence) {
    return 'evidence_backed';
  }
  if (hasSource) {
    return 'sourced';
  }
  return 'unsourced';
}

function timeContextValue(run: JsonRecord, thesis: JsonRecord | null): string {
  const raw = stringValue(
    run.time_context ?? recordValue(thesis?.summary).time_context ?? thesis?.time_context,
    'daily_context',
  ).toLowerCase();
  if (['unspecified', 'daily_context', 'swing_context', 'long_context', 'multi'].includes(raw)) {
    return raw;
  }
  return 'daily_context';
}

function hashKey(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function legacyItemKey(type: TrackedItemType, text: string): string {
  return `${type}:${hashKey(normalizedText(text))}`;
}

function normalizedText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_');
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'object') {
    const record = recordValue(value);
    return nullableString(
      record.text ??
        record.summary ??
        record.reason ??
        record.description ??
        JSON.stringify(value),
    );
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => nullableString(item))
      .filter((item): item is string => Boolean(item));
  }
  const text = nullableString(value);
  return text ? [text] : [];
}

function indexedStrings(
  value: unknown,
  mapper: (text: string, index: number) => TrackedItemSeed,
): TrackedItemSeed[] {
  return stringList(value).map((text, index) => mapper(text, index));
}

function singleString(
  value: unknown,
  mapper: (text: string) => TrackedItemSeed,
): TrackedItemSeed[] {
  const text = nullableString(value);
  return text ? [mapper(text)] : [];
}

function countItems(items: JsonRecord[], type: TrackedItemType): number {
  return items.filter((item) => stringValue(item.type) === type).length;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(2));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
