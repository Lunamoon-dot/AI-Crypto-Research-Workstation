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

    const quality = snapshotQuality(input);
    if (quality.skipped) {
      return {
        snapshot: null,
        quality,
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
    const trackedItems = uniqueTrackedItems([
      ...riskItems(input.thesis, input.agentOpinions),
      ...watchpointItems(input.thesis),
      ...invalidationItems(input.thesis, input.agentOpinions),
      ...levelItems(input.thesis),
    ]);
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
        schema_version: 'research_snapshot.v1',
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

function riskItems(thesis: JsonRecord | null, opinions: JsonRecord[]): JsonRecord[] {
  const summary = recordValue(thesis?.summary);
  const risks = [
    ...stringList(thesis?.risks),
    ...stringList(summary.risks),
    ...opinions.flatMap((opinion) => stringList(recordValue(opinion.payload).risks)),
  ];
  return risks.map((risk) => trackedItem('risk', risk, 'medium'));
}

function watchpointItems(thesis: JsonRecord | null): JsonRecord[] {
  return [
    ...stringList(thesis?.monitor_next),
    ...stringList(recordValue(thesis?.summary).monitor_next),
  ].map((item) => trackedItem('watchpoint', item, 'medium'));
}

function invalidationItems(
  thesis: JsonRecord | null,
  opinions: JsonRecord[],
): JsonRecord[] {
  const invalidations = [
    nullableString(thesis?.invalidation_level),
    nullableString(recordValue(thesis?.summary).invalidation),
    ...opinions.map((opinion) => nullableString(recordValue(opinion.payload).invalidation)),
  ].filter((value): value is string => Boolean(value));
  return invalidations.map((item) => trackedItem('invalidation', item, 'high'));
}

function levelItems(thesis: JsonRecord | null): JsonRecord[] {
  return stringList(thesis?.target_zones ?? recordValue(thesis?.summary).target_zones).map(
    (item) => trackedItem('level', item, 'medium'),
  );
}

function trackedItem(
  type: 'claim' | 'risk' | 'watchpoint' | 'level' | 'invalidation',
  text: string,
  importance: 'low' | 'medium' | 'high',
): JsonRecord {
  return {
    item_key: `${type}:${hashKey(normalizedText(text))}`,
    type,
    status: 'active',
    text,
    importance,
    evidence: [],
    source_artifact: 'research_snapshot',
    source_id: null,
  };
}

function uniqueTrackedItems(items: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const result: JsonRecord[] = [];
  for (const item of items) {
    const key = stringValue(item.item_key);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
