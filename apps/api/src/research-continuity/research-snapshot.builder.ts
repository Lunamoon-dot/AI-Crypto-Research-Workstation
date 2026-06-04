import { createHash } from 'node:crypto';
import { JsonRecord } from '../database/journal.types';
import {
  evidenceKindCounts,
  evidenceQualityFor,
  normalizeEvidenceItems,
  normalizeResearchItems,
  ResearchEvidenceItem,
} from '../contracts/research-evidence';

export interface ResearchSnapshotBuildInput {
  run: JsonRecord;
  debate: JsonRecord | null;
  agentOpinions: JsonRecord[];
  thesis: JsonRecord | null;
  scenarios: JsonRecord[];
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
  evidence?: ResearchEvidenceItem[];
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

const AGENT_OPINION_DIRECT_RISK_TERMS = [
  /\bdownside\s+(?:risk|pressure|break|breakdown)\b/,
  /\brisk\s+of\s+(?:further\s+)?downside\b/,
  /\bfurther\s+downside\b/,
  /\belevated\b/,
  /\bcrowded\b/,
  /\boverheat(?:ed|ing)?\b/,
  /\bfade\b/,
  /\btighten(?:ed|ing)?\b/,
  /\bliquidation(s)?\b/,
  /\bvolatility\b/,
  /\bdrawdown\b/,
  /\bbreak(?:s|ing)?(?:\s+back)?\s+below\b/,
  /\blost\s+support\b/,
  /\bbreakdown\b/,
  /\breject(?:s|ed|ion)?\b/,
  /\binvalidat(?:e|es|ed|ion)\b/,
  /\bmissing\b/,
  /\bunavailable\b/,
  /\bstale\b/,
];

const AGENT_OPINION_CONTEXTUAL_RISK_TERMS = [
  /\brisk(s)?\b/,
  /\bfunding\b/,
  /\bsupport\b/,
  /\bresistance\b/,
  /\bopen\s+interest\b/,
  /\boi\b/,
  /\bmacro\b/,
  /\bliquidity\b/,
];

const AGENT_OPINION_ADVERSE_RISK_TERMS = [
  /\bcould\b/,
  /\bmay\b/,
  /\bmight\b/,
  /\bwould\b/,
  /\bcan\b/,
  /\bif\b/,
  /\bunless\b/,
  /\bfail(?:s|ed|ure)?\b/,
  /\bpressure\b/,
  /\bstress\b/,
  /\bweak(?:en|ness)?\b/,
  ...AGENT_OPINION_DIRECT_RISK_TERMS,
];

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
    const scenarioBranches = buildScenarioBranches(input.scenarios, input.thesis);
    const trackedItems = dedupeTrackedItems(
      [
        ...riskItems(input.thesis, input.agentOpinions),
        ...watchpointItems(input.thesis),
        ...invalidationItems(input.thesis, input.agentOpinions),
        ...levelItems(input.thesis),
        ...claimItems(input.thesis),
        ...scenarioTrackedItems(scenarioBranches),
      ].map((seed) => trackedItem(seed, evidence)),
    );
    const quality = snapshotQualityWithTrackedItems(baseQuality, trackedItems);
    const sourceArtifacts = {
      debate_id: nullableString(input.debate?.id ?? input.run.debate_id),
      agent_opinion_ids: input.agentOpinions
        .map((opinion) => nullableString(opinion.id))
        .filter((id): id is string => Boolean(id)),
      thesis_id: nullableString(input.thesis?.id ?? input.run.thesis_id),
      scenario_ids: scenarioBranches
        .map((scenario) => nullableString(scenario.scenario_id))
        .filter((id): id is string => Boolean(id)),
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
      scenario_branches: scenarioBranches,
      tracked_items: trackedItems,
      data_quality: quality,
      source_artifacts: sourceArtifacts,
      payload: {
        schema_version: 'research_snapshot.v1.2',
        evidence_contract_version: 'research_evidence.v1.2',
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

function buildScenarioBranches(
  scenarios: JsonRecord[],
  thesis: JsonRecord | null,
): JsonRecord[] {
  return scenarios
    .map((scenario) => scenarioBranch(scenario, thesis))
    .filter((scenario) => stringValue(scenario.condition) || stringValue(scenario.expected_behavior));
}

function scenarioBranch(scenario: JsonRecord, thesis: JsonRecord | null): JsonRecord {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const thesisId = nullableString(scenario.thesis_id ?? thesis?.id);
  const scenarioId = nullableString(scenario.id);
  const branchType = scenarioBranchType(scenario);
  const condition = firstOptionalString(
    scenario.condition,
    payload.condition,
    payload.trigger,
  );
  const expectedBehavior = firstOptionalString(
    scenario.expected_behavior,
    payload.expected_behavior,
    payload.expected_market_behavior,
  );
  const probabilityBand = normalizeProbabilityBand(
    scenario.probability_band ?? payload.probability_band,
  );
  const invalidation = firstOptionalString(
    scenario.invalidation,
    payload.invalidation,
    payload.invalidation_condition,
  );
  const riskFactors = uniqueStrings([
    ...stringList(scenario.risk_map),
    ...stringList(payload.risk_map),
    ...stringList(payload.risk_factors),
  ]);
  const suggestedAction = firstOptionalString(
    scenario.suggested_user_action,
    payload.suggested_user_action,
    payload.suggested_action,
  );
  return {
    scenario_key: stableScenarioKey({
      thesisId,
      branchType,
      condition,
      scenarioId,
    }),
    thesis_id: thesisId,
    scenario_id: scenarioId,
    branch_type: branchType,
    condition,
    expected_behavior: expectedBehavior,
    probability_band: probabilityBand,
    invalidation,
    risk_factors: riskFactors,
    suggested_action: suggestedAction,
    source_artifact: 'scenario',
    source_id: scenarioId,
  };
}

function scenarioTrackedItems(branches: JsonRecord[]): TrackedItemSeed[] {
  return branches.flatMap((branch) => {
    const metadata = {
      scenario_key: stringValue(branch.scenario_key),
      branch_type: stringValue(branch.branch_type),
      thesis_id: nullableString(branch.thesis_id),
    };
    const scenarioId = nullableString(branch.scenario_id);
    const seeds: TrackedItemSeed[] = [];
    for (const condition of singleString(branch.condition, (text) =>
      seedItem(
        'watchpoint',
        text,
        'medium',
        'scenario',
        scenarioId,
        'condition',
      ),
    )) {
      seeds.push({ ...condition, attributes: metadata });
    }
    for (const invalidation of singleString(branch.invalidation, (text) =>
      seedItem(
        'invalidation',
        text,
        'high',
        'scenario',
        scenarioId,
        'invalidation',
      ),
    )) {
      seeds.push({ ...invalidation, attributes: metadata });
    }
    for (const risk of indexedStrings(branch.risk_factors, (text, index) =>
      seedItem(
        'risk',
        text,
        'medium',
        'scenario',
        scenarioId,
        `risk_factors[${index}]`,
      ),
    )) {
      seeds.push({ ...risk, attributes: metadata });
    }
    for (const claim of singleString(branch.expected_behavior, (text) =>
      seedItem(
        'claim',
        text,
        'medium',
        'scenario',
        scenarioId,
        'expected_behavior',
      ),
    )) {
      seeds.push({ ...claim, attributes: metadata });
    }
    return seeds;
  });
}

function stableScenarioKey(input: {
  thesisId: string | null;
  branchType: string;
  condition: string;
  scenarioId: string | null;
}): string {
  if (input.scenarioId) {
    return `scenario:${input.scenarioId}`;
  }
  const conditionSlug = slugValue(input.condition);
  if (input.thesisId && conditionSlug) {
    return `${input.thesisId}:${input.branchType}:${conditionSlug}`;
  }
  return `scenario:${input.branchType}:${hashKey(input.condition || input.branchType)}`;
}

function scenarioBranchType(scenario: JsonRecord): string {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const normalized = normalizedText(
    stringValue(
      scenario.branch_type ??
        payload.branch_type ??
        payload.scenario_type ??
        payload.direction ??
        'branch',
    ),
  ).replace(/[^a-z0-9_]+/g, '_');
  return normalized || 'branch';
}

function normalizeProbabilityBand(
  value: unknown,
): 'low' | 'medium' | 'high' | 'watch' | 'unknown' {
  const normalized = normalizedText(stringValue(value));
  if (['low', 'medium', 'high', 'watch'].includes(normalized)) {
    return normalized as 'low' | 'medium' | 'high' | 'watch';
  }
  if (['med', 'mid', 'moderate'].includes(normalized)) {
    return 'medium';
  }
  if (['elevated', 'likely', 'strong'].includes(normalized)) {
    return 'high';
  }
  if (['unlikely', 'weak'].includes(normalized)) {
    return 'low';
  }
  return 'unknown';
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
    (item) => normalizeEvidenceItems(item.evidence).length > 0,
  ).length;
  const observedBackedItemCount = items.filter(
    (item) => stringValue(item.evidence_quality) === 'observed_backed',
  ).length;
  const reasoningOnlyItemCount = items.filter(
    (item) => stringValue(item.evidence_quality) === 'reasoning_only',
  ).length;
  const missingEvidenceItemCount = items.filter(
    (item) => stringValue(item.evidence_quality) === 'missing_limited',
  ).length;
  const noEvidenceItemCount = items.filter(
    (item) => stringValue(item.evidence_quality) === 'none',
  ).length;
  const evidenceCounts = items.reduce<{
    observed: number;
    reasoning: number;
    missing: number;
  }>(
    (counts, item) => {
      counts.observed += numberValue(item.observed_evidence_count);
      counts.reasoning += numberValue(item.reasoning_evidence_count);
      counts.missing += numberValue(item.missing_evidence_count);
      return counts;
    },
    { observed: 0, reasoning: 0, missing: 0 },
  );
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
    observed_evidence_count: evidenceCounts.observed,
    reasoning_evidence_count: evidenceCounts.reasoning,
    missing_evidence_count: evidenceCounts.missing,
    observed_evidence_coverage: ratio(observedBackedItemCount, trackedItemCount),
    reasoning_only_item_count: reasoningOnlyItemCount,
    missing_evidence_item_count: missingEvidenceItemCount,
    no_evidence_item_count: noEvidenceItemCount,
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
  const thesisSummary = recordValue(input.thesis?.summary);
  return normalizeDirectionalBias(
    firstNonEmptyString(
      thesisSummary.direction,
      input.thesis?.direction,
      thesisSummary.rating,
      input.debate?.consensus_stance,
      signalBias(input.signalSnapshot),
    ),
  );
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text.length > 0) {
      return text;
    }
  }
  return 'unclear';
}

function firstOptionalString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text.length > 0) {
      return text;
    }
  }
  return '';
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
  const summary = summaryValue(thesis);
  const summaryPrefix = summarySourcePrefix(thesis);
  const payloadSummary = recordValue(recordValue(thesis?.payload).structured_summary);
  return [
    ...indexedResearchItems(summary.key_reasons, (item, index) =>
      seedItem(
        'claim',
        item.text,
        'medium',
        'thesis',
        thesisId,
        `${summaryPrefix}.key_reasons[${index}]`,
        item.supporting_evidence,
      ),
    ),
    ...singleString(summary.why_this_thesis, (text) =>
      seedItem('claim', text, 'medium', 'thesis', thesisId, `${summaryPrefix}.why_this_thesis`),
    ),
    ...singleString(thesis?.why_this_thesis, (text) =>
      seedItem('claim', text, 'medium', 'thesis', thesisId, 'why_this_thesis'),
    ),
    ...indexedResearchItems(payloadSummary.key_reasons, (item, index) =>
      seedItem(
        'claim',
        item.text,
        'medium',
        'thesis',
        thesisId,
        `payload.structured_summary.key_reasons[${index}]`,
        item.supporting_evidence,
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
  const summary = summaryValue(thesis);
  const summaryPrefix = summarySourcePrefix(thesis);
  const payloadSummary = recordValue(recordValue(thesis?.payload).structured_summary);
  return [
    ...indexedResearchItems(summary.risks, (item, index) =>
      seedItem(
        'risk',
        item.text,
        'medium',
        'thesis',
        thesisId,
        `${summaryPrefix}.risks[${index}]`,
        item.supporting_evidence,
      ),
    ),
    ...indexedStrings(thesis?.risks, (text, index) =>
      seedItem('risk', text, 'medium', 'thesis', thesisId, `risks[${index}]`),
    ),
    ...indexedResearchItems(payloadSummary.risks, (item, index) =>
      seedItem(
        'risk',
        item.text,
        'medium',
        'thesis',
        thesisId,
        `payload.structured_summary.risks[${index}]`,
        item.supporting_evidence,
      ),
    ),
    ...opinions.flatMap(agentOpinionRiskItems),
  ];
}

function agentOpinionRiskItems(opinion: JsonRecord): TrackedItemSeed[] {
  const payload = recordValue(opinion.payload);
  return normalizeResearchItems(payload.risks).flatMap((item, index) => {
    if (!isPromotableAgentOpinionRisk(item)) {
      return [];
    }
    return [
      seedItem(
        'risk',
        item.text,
        'medium',
        'agent_opinion',
        nullableString(opinion.id),
        `payload.risks[${index}]`,
        item.supporting_evidence,
      ),
    ];
  });
}

function isPromotableAgentOpinionRisk(item: {
  text: string;
  supporting_evidence: ResearchEvidenceItem[];
}): boolean {
  const normalized = normalizedText(item.text);
  if (!normalized || normalized.endsWith('?')) {
    return false;
  }
  if (/^(you|your)\b/.test(normalized)) {
    return false;
  }
  if (item.supporting_evidence.length > 0) {
    return true;
  }
  if (AGENT_OPINION_DIRECT_RISK_TERMS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return (
    AGENT_OPINION_CONTEXTUAL_RISK_TERMS.some((pattern) =>
      pattern.test(normalized),
    ) &&
    AGENT_OPINION_ADVERSE_RISK_TERMS.some((pattern) =>
      pattern.test(normalized),
    )
  );
}

function watchpointItems(thesis: JsonRecord | null): TrackedItemSeed[] {
  const thesisId = nullableString(thesis?.id);
  const summary = summaryValue(thesis);
  const summaryPrefix = summarySourcePrefix(thesis);
  const payloadSummary = recordValue(recordValue(thesis?.payload).structured_summary);
  return [
    ...indexedResearchItems(thesis?.monitor_next, (item, index) =>
      seedItem(
        'watchpoint',
        item.text,
        'medium',
        'thesis',
        thesisId,
        `monitor_next[${index}]`,
        item.supporting_evidence,
      ),
    ),
    ...singleString(thesis?.confirmation_condition, (text) =>
      seedItem(
        'watchpoint',
        text,
        'medium',
        'thesis',
        thesisId,
        'confirmation_condition',
      ),
    ),
    ...singleString(summary.confirmation_condition, (text) =>
      seedItem(
        'watchpoint',
        text,
        'medium',
        'thesis',
        thesisId,
        `${summaryPrefix}.confirmation_condition`,
      ),
    ),
    ...indexedResearchItems(summary.monitor_next, (item, index) =>
      seedItem(
        'watchpoint',
        item.text,
        'medium',
        'thesis',
        thesisId,
        `${summaryPrefix}.monitor_next[${index}]`,
        item.supporting_evidence,
      ),
    ),
    ...indexedResearchItems(payloadSummary.monitor_next, (item, index) =>
      seedItem(
        'watchpoint',
        item.text,
        'medium',
        'thesis',
        thesisId,
        `payload.structured_summary.monitor_next[${index}]`,
        item.supporting_evidence,
      ),
    ),
    ...singleString(payloadSummary.confirmation_condition, (text) =>
      seedItem(
        'watchpoint',
        text,
        'medium',
        'thesis',
        thesisId,
        'payload.structured_summary.confirmation_condition',
      ),
    ),
  ];
}

function invalidationItems(
  thesis: JsonRecord | null,
  opinions: JsonRecord[],
): TrackedItemSeed[] {
  const thesisId = nullableString(thesis?.id);
  const summary = summaryValue(thesis);
  const summaryPrefix = summarySourcePrefix(thesis);
  return [
    ...singleString(thesis?.invalidation_level, (text) =>
      seedItem('invalidation', text, 'high', 'thesis', thesisId, 'invalidation_level'),
    ),
    ...singleString(summary.invalidation, (text) =>
      seedItem('invalidation', text, 'high', 'thesis', thesisId, `${summaryPrefix}.invalidation`),
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
  const summary = summaryValue(thesis);
  const summaryPrefix = summarySourcePrefix(thesis);
  const source = thesis?.target_zones ?? summary.target_zones;
  const sourceField = thesis?.target_zones ? 'target_zones' : `${summaryPrefix}.target_zones`;
  return indexedStrings(source, (text, index) =>
    seedItem('level', text, 'medium', 'thesis', thesisId, `${sourceField}[${index}]`),
  );
}

function evidenceItems(input: ResearchSnapshotBuildInput): ResearchEvidenceItem[] {
  const thesis = input.thesis;
  const summary = summaryValue(thesis);
  const payloadSummary = recordValue(recordValue(thesis?.payload).structured_summary);
  return uniqueEvidence([
    ...normalizeEvidenceItems(summary.supporting_evidence),
    ...normalizeEvidenceItems(thesis?.supporting_evidence),
    ...normalizeEvidenceItems(payloadSummary.supporting_evidence),
    ...input.agentOpinions.flatMap((opinion) => {
      const payload = recordValue(opinion.payload);
      return [
        ...normalizeEvidenceItems(payload.evidence),
        ...normalizeEvidenceItems(payload.supporting_evidence),
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
  evidence: ResearchEvidenceItem[] = [],
): TrackedItemSeed {
  return {
    type,
    text,
    importance,
    source_artifact: sourceArtifact,
    source_id: sourceId,
    source_field: sourceField,
    evidence,
  };
}

function trackedItem(
  seed: TrackedItemSeed,
  globalEvidence: ResearchEvidenceItem[],
): JsonRecord {
  const canonical = canonicalText(seed.text);
  const identityTerms = identityTermsFor(seed.text);
  const hasSource = Boolean(seed.source_artifact || seed.source_id || seed.source_field);
  const identityConfidence = identityConfidenceFor(canonical, identityTerms, hasSource);
  const topic = identityTerms[0] ?? 'text';
  const identitySeed =
    identityTerms.length > 0 ? identityTerms.join('|') : canonical || normalizedText(seed.text);
  const stableKeyPart = identityTerms.length > 0 ? topic : 'text';
  const itemEvidence =
    seed.evidence && seed.evidence.length > 0 ? seed.evidence : globalEvidence;
  const counts = evidenceKindCounts(itemEvidence);
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
    evidence_quality: evidenceQualityFor(itemEvidence),
    observed_evidence_count: counts.observed,
    reasoning_evidence_count: counts.reasoning,
    missing_evidence_count: counts.missing,
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

function slugValue(value: string): string {
  return normalizedText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_');
}

function summaryValue(thesis: JsonRecord | null): JsonRecord {
  const structuredSummary = recordValue(thesis?.structured_summary);
  if (Object.keys(structuredSummary).length > 0) {
    return structuredSummary;
  }
  return recordValue(thesis?.summary);
}

function summarySourcePrefix(thesis: JsonRecord | null): string {
  return Object.keys(recordValue(thesis?.structured_summary)).length > 0
    ? 'structured_summary'
    : 'summary';
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

function indexedResearchItems(
  value: unknown,
  mapper: (item: { text: string; supporting_evidence: ResearchEvidenceItem[] }, index: number) => TrackedItemSeed,
): TrackedItemSeed[] {
  return normalizeResearchItems(value).map((item, index) => mapper(item, index));
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

function uniqueEvidence(values: ResearchEvidenceItem[]): ResearchEvidenceItem[] {
  const seen = new Set<string>();
  const result: ResearchEvidenceItem[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
