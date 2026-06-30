import type { JsonRecord } from '../database/journal.types';
import {
  derivePriceConditionFromText,
  normalizeScenarioConditionText,
} from './scenario-text-conditions';
import type {
  ScenarioActionBias,
  ScenarioDecisionCondition,
  ScenarioDecisionPlaybook,
  ScenarioEvidenceRef,
  ScenarioRecommendedAction,
  ScenarioRuntimeDecision,
  ScenarioTriggerStatus,
  ScenarioValidityStatus,
} from './scenario-decision.types';

const DEFAULT_NEAR_TRIGGER_THRESHOLD_PCT = 2;
const DEFAULT_OVEREXTENDED_THRESHOLD_PCT = 2.5;
const ENTRY_NOW_CONFIDENCE_THRESHOLD = 0.7;
const MARKET_STALE_MINUTES = 90;
const MARKET_STALE_REASON = 'Market data is stale.';
const MISSING_PRICE_REASON = 'Market price is missing.';
const OVEREXTENDED_REASON = 'Price is overextended from trigger.';
const NON_ACTIONABLE_BIAS_REASON = 'Scenario action bias is not actionable.';
const LOW_CONFIDENCE_REASON = 'Recommendation confidence is below entry threshold.';

type TriggerTarget =
  | { kind: 'level'; level: number; direction: 'above' | 'below' }
  | { kind: 'zone'; zoneLow: number; zoneHigh: number }
  | null;

export function evaluateScenarioRuntimeDecision(
  scenario: JsonRecord,
  snapshot: JsonRecord | null,
  nowIso: string,
): ScenarioRuntimeDecision {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const playbook = normalizedPlaybook(scenario, payload, nowIso);
  const recommendation = recordValue(
    scenario.scenario_recommendation ?? payload.scenario_recommendation,
  );
  const recommendationConfidence = nullableNumber(recommendation.confidence);
  const effectiveConfidence =
    recommendationConfidence === null
      ? playbook.confidence
      : Math.min(playbook.confidence, recommendationConfidence);
  const currentPrice = nullableNumber(snapshot?.current_price);
  const staleMarketData = marketIsStale(snapshot, nowIso);
  const triggerTarget = primaryTriggerTarget(playbook);
  const triggerStatus = triggerStatusFor({
    currentPrice,
    nearThresholdPct: playbook.near_trigger_threshold_pct,
    staleMarketData,
    triggerTarget,
  });
  const distanceToTrigger = distanceToTarget(currentPrice, triggerTarget);
  const matchedConditions: string[] = [];
  const failedConditions: string[] = [];
  const blockingReasons: string[] = [];
  const overrides: string[] = [];
  const conditionBlockers: string[] = [];
  const invalidationText = firstScenarioString(
    scenario.invalidation,
    payload.invalidation,
    payload.invalidation_condition,
  );
  const hasInvalidation =
    playbook.invalidation_conditions.length > 0 || invalidationText.length > 0;

  for (const condition of playbook.entry_conditions) {
    const result = conditionResult(condition, currentPrice);
    const label = conditionLabel(condition);
    if (result === 'matched') {
      matchedConditions.push(label);
    }
    if (result === 'failed') {
      failedConditions.push(label);
      conditionBlockers.push(`failed_condition:${label}`);
    }
    if (result === 'unknown') {
      conditionBlockers.push(`unknown_condition:${condition.type}`);
    }
  }

  const overextended = isOverextended(playbook, currentPrice, triggerTarget);
  const validity = validityStatusFor(
    playbook,
    currentPrice,
    nowIso,
    staleMarketData,
    overextended,
  );

  if (validity.status !== 'valid') {
    blockingReasons.push(validity.reason);
    overrides.push(validity.reason);
  }
  if (staleMarketData) {
    blockingReasons.push(MARKET_STALE_REASON);
    overrides.push('stale_market_data');
  }
  if (currentPrice === null) {
    blockingReasons.push(MISSING_PRICE_REASON);
    overrides.push('missing_market_data');
  }
  if (!hasInvalidation) {
    blockingReasons.push('Recommendation is missing invalidation condition.');
    overrides.push('missing_invalidation');
  }
  if (playbook.evidence_refs.length === 0) {
    blockingReasons.push('Recommendation is missing evidence references.');
    overrides.push('missing_evidence_refs');
  }
  if (overextended) {
    blockingReasons.push(OVEREXTENDED_REASON);
    overrides.push('overextended');
  }
  if (playbook.action_bias === 'neutral' || playbook.action_bias === 'unknown') {
    blockingReasons.push(NON_ACTIONABLE_BIAS_REASON);
    overrides.push('non_actionable_bias');
  }
  if (
    isEntryAction(playbook.preferred_action_if_triggered) &&
    effectiveConfidence < ENTRY_NOW_CONFIDENCE_THRESHOLD
  ) {
    blockingReasons.push(LOW_CONFIDENCE_REASON);
    overrides.push('low_confidence');
  }
  if (
    isEntryAction(playbook.preferred_action_if_triggered) &&
    !entryActionMatchesBias(
      playbook.preferred_action_if_triggered,
      playbook.action_bias,
    )
  ) {
    blockingReasons.push('Scenario action bias does not match entry direction.');
    overrides.push('action_bias_mismatch');
  }
  const recommendationBlockers = recommendationBlockingReasons(recommendation);
  blockingReasons.push(...recommendationBlockers.reasons);
  overrides.push(...recommendationBlockers.overrides);
  if (triggerStatus === 'triggered') {
    blockingReasons.push(...conditionBlockers);
    overrides.push(...conditionBlockers);
  }

  const uniqueBlockers = uniqueStrings(blockingReasons);
  const uniqueOverrides = uniqueStrings(overrides);
  const recommendedAction = finalAction({
    actionBias: playbook.action_bias,
    blockingReasons: uniqueBlockers,
    confidence: effectiveConfidence,
    fallback: playbook.fallback_action,
    preferred: playbook.preferred_action_if_triggered,
    triggerStatus,
    validityStatus: validity.status,
  });
  const statusReason = statusReasonFor({
    blockers: uniqueBlockers,
    currentPrice,
    recommendedAction,
    triggerTarget,
    triggerStatus,
    validityStatus: validity.status,
  });

  return {
    version: 'scenario_runtime_decision.v1',
    evaluated_at: nowIso,
    trigger_status: triggerStatus,
    validity_status: validity.status,
    recommended_action: recommendedAction,
    confidence: confidenceAfterGates(effectiveConfidence, uniqueBlockers),
    matched_conditions: uniqueStrings(matchedConditions),
    failed_conditions: uniqueStrings(failedConditions),
    blocking_reasons: uniqueBlockers,
    risk_notes: playbook.risk_notes,
    evidence_refs: playbook.evidence_refs,
    source: 'rule_engine_from_decision_playbook',
    playbook_source: playbook.source,
    status_reason: statusReason,
    distance_to_trigger: distanceToTrigger,
    llm_recommendation: null,
    final_decision: {
      action: recommendedAction,
      reason: statusReason,
      overrides: uniqueOverrides,
    },
  };
}

function normalizedPlaybook(
  scenario: JsonRecord,
  payload: JsonRecord,
  nowIso: string,
): ScenarioDecisionPlaybook {
  const raw = recordValue(scenario.decision_playbook ?? payload.decision_playbook);
  if (raw.version === 'scenario_decision_playbook.v1') {
    return {
      version: 'scenario_decision_playbook.v1',
      source: stringValue(raw.source) === 'llm' ? 'llm' : 'derived_v1',
      generated_at: nullableString(raw.generated_at),
      generated_from_run_id: nullableString(raw.generated_from_run_id),
      action_bias: actionBiasValue(raw.action_bias),
      confidence: clampConfidence(raw.confidence),
      preferred_action_if_triggered: actionValue(
        raw.preferred_action_if_triggered,
        'review',
      ),
      fallback_action: actionValue(raw.fallback_action, 'wait'),
      near_trigger_threshold_pct: positiveNumber(
        raw.near_trigger_threshold_pct,
        DEFAULT_NEAR_TRIGGER_THRESHOLD_PCT,
      ),
      validity_window: {
        valid_from: nullableString(recordValue(raw.validity_window).valid_from),
        valid_until: nullableString(recordValue(raw.validity_window).valid_until),
        timeframe: stringValue(
          recordValue(raw.validity_window).timeframe,
          stringValue(scenario.timeframe, 'unknown'),
        ),
        rationale: stringValue(recordValue(raw.validity_window).rationale),
        refresh_policy:
          stringValue(recordValue(raw.validity_window).refresh_policy) ===
          'manual_review'
            ? 'manual_review'
            : 'refresh_on_next_research_run',
      },
      entry_conditions: conditionList(raw.entry_conditions),
      avoid_if: conditionList(raw.avoid_if),
      invalidation_conditions: conditionList(raw.invalidation_conditions),
      wait_for: stringList(raw.wait_for),
      risk_notes: stringList(raw.risk_notes),
      evidence_refs: evidenceRefList(raw.evidence_refs),
      rationale: stringValue(raw.rationale),
    };
  }

  return derivedPlaybook(scenario, payload, nowIso);
}

function derivedPlaybook(
  scenario: JsonRecord,
  payload: JsonRecord,
  nowIso: string,
): ScenarioDecisionPlaybook {
  const triggerSpec = recordValue(payload.trigger_spec ?? scenario.trigger_spec);
  const entryConditions = triggerSpec.type
    ? [conditionFromTriggerSpec(triggerSpec)]
    : [];
  const invalidation = firstScenarioString(
    scenario.invalidation,
    payload.invalidation,
    payload.invalidation_condition,
  );
  const invalidationConditions = invalidation
    ? parsePriceCondition(invalidation)
    : [];
  const actionBias = inferredActionBias(scenario, payload, entryConditions[0]);
  return {
    version: 'scenario_decision_playbook.v1',
    source: 'derived_v1',
    generated_at: nowIso,
    generated_from_run_id: nullableString(scenario.research_run_id),
    action_bias: actionBias,
    confidence: 0.55,
    preferred_action_if_triggered:
      actionBias === 'short'
        ? 'consider_short'
        : actionBias === 'long'
          ? 'consider_long'
          : 'wait',
    fallback_action: 'wait',
    near_trigger_threshold_pct: DEFAULT_NEAR_TRIGGER_THRESHOLD_PCT,
    validity_window: {
      valid_from: nullableString(scenario.as_of ?? payload.as_of),
      valid_until: nullableString(payload.valid_until),
      timeframe: stringValue(scenario.timeframe ?? payload.timeframe, 'unknown'),
      rationale:
        'Derived V1 playbook uses existing scenario fields and requires review for stronger actions.',
      refresh_policy: 'refresh_on_next_research_run',
    },
    entry_conditions: entryConditions,
    avoid_if: [
      {
        type: 'overextended_from_trigger',
        threshold_pct: DEFAULT_OVEREXTENDED_THRESHOLD_PCT,
      },
    ],
    invalidation_conditions: invalidationConditions,
    wait_for: stringList(
      scenario.watch_triggers ?? payload.watch_triggers ?? payload.watch,
    ),
    risk_notes: stringList(
      scenario.risk_map ?? payload.risk_map ?? payload.risk_factors,
    ),
    evidence_refs:
      entryConditions.length > 0
        ? [
            {
              type: 'scenario',
              id: nullableString(scenario.id),
              field: 'payload.trigger_spec',
              label: 'Scenario trigger spec',
              supports: 'Trigger spec exists for derived V1 playbook.',
            },
          ]
        : [],
    rationale: 'Derived conservatively without an LLM-authored decision playbook.',
  };
}

function finalAction(input: {
  triggerStatus: ScenarioTriggerStatus;
  validityStatus: ScenarioValidityStatus;
  preferred: ScenarioRecommendedAction;
  fallback: ScenarioRecommendedAction;
  actionBias: ScenarioActionBias;
  confidence: number;
  blockingReasons: string[];
}): ScenarioRecommendedAction {
  if (
    input.validityStatus === 'expired' ||
    input.validityStatus === 'invalidated'
  ) {
    return 'review';
  }
  if (input.actionBias === 'neutral' || input.actionBias === 'unknown') {
    return 'review';
  }
  if (
    input.blockingReasons.includes(MISSING_PRICE_REASON) ||
    input.blockingReasons.includes(MARKET_STALE_REASON)
  ) {
    return 'review';
  }
  if (input.triggerStatus === 'near_trigger') {
    if (input.blockingReasons.length > 0) {
      return safeBlockedAction(input.fallback);
    }
    if (
      input.validityStatus === 'valid' &&
      input.confidence >= ENTRY_NOW_CONFIDENCE_THRESHOLD
    ) {
      return directionalConsiderAction(input.actionBias);
    }
    return input.fallback;
  }
  if (input.triggerStatus !== 'triggered') {
    return input.fallback;
  }
  if (input.blockingReasons.length > 0) {
    return safeBlockedAction(input.fallback);
  }
  if (
    input.confidence >= ENTRY_NOW_CONFIDENCE_THRESHOLD &&
    isEntryAction(input.preferred) &&
    entryActionMatchesBias(input.preferred, input.actionBias)
  ) {
    return input.preferred;
  }
  return directionalConsiderAction(input.actionBias);
}

function safeBlockedAction(
  fallback: ScenarioRecommendedAction,
): ScenarioRecommendedAction {
  if (fallback === 'wait' || fallback === 'avoid' || fallback === 'review') {
    return fallback;
  }
  return 'review';
}

function directionalConsiderAction(
  actionBias: ScenarioActionBias,
): ScenarioRecommendedAction {
  if (actionBias === 'short') {
    return 'consider_short';
  }
  if (actionBias === 'long') {
    return 'consider_long';
  }
  return 'review';
}

function entryActionMatchesBias(
  action: ScenarioRecommendedAction,
  actionBias: ScenarioActionBias,
): boolean {
  return (
    (action === 'entry_long_now' && actionBias === 'long') ||
    (action === 'entry_short_now' && actionBias === 'short')
  );
}

function isEntryAction(action: ScenarioRecommendedAction): boolean {
  return action === 'entry_long_now' || action === 'entry_short_now';
}

function triggerStatusFor(input: {
  currentPrice: number | null;
  triggerTarget: TriggerTarget;
  nearThresholdPct: number;
  staleMarketData: boolean;
}): ScenarioTriggerStatus {
  if (input.currentPrice === null) {
    return 'missing_price';
  }
  if (input.staleMarketData) {
    return 'stale';
  }
  if (input.triggerTarget === null) {
    return 'needs_review';
  }
  if (input.triggerTarget.kind === 'zone') {
    const triggered =
      input.currentPrice >= input.triggerTarget.zoneLow &&
      input.currentPrice <= input.triggerTarget.zoneHigh;
    if (triggered) {
      return 'triggered';
    }
    const boundary =
      input.currentPrice < input.triggerTarget.zoneLow
        ? input.triggerTarget.zoneLow
        : input.triggerTarget.zoneHigh;
    const distancePct = (Math.abs(input.currentPrice - boundary) / boundary) * 100;
    return distancePct <= input.nearThresholdPct ? 'near_trigger' : 'watching';
  }
  const triggered =
    input.triggerTarget.direction === 'below'
      ? input.currentPrice <= input.triggerTarget.level
      : input.currentPrice >= input.triggerTarget.level;
  if (triggered) {
    return 'triggered';
  }
  const distancePct =
    (Math.abs(input.currentPrice - input.triggerTarget.level) /
      input.triggerTarget.level) *
    100;
  return distancePct <= input.nearThresholdPct ? 'near_trigger' : 'watching';
}

function validityStatusFor(
  playbook: ScenarioDecisionPlaybook,
  currentPrice: number | null,
  nowIso: string,
  staleMarketData: boolean,
  overextended: boolean,
): { status: ScenarioValidityStatus; reason: string } {
  const validUntil = playbook.validity_window.valid_until;
  if (validUntil && timestampForSort(validUntil) < timestampForSort(nowIso)) {
    return { status: 'expired', reason: 'expired' };
  }
  const invalidationHit = playbook.invalidation_conditions.some(
    (condition) => conditionResult(condition, currentPrice) === 'matched',
  );
  if (invalidationHit) {
    return { status: 'invalidated', reason: 'invalidation_hit' };
  }
  if (currentPrice === null) {
    return { status: 'needs_review', reason: MISSING_PRICE_REASON };
  }
  if (staleMarketData) {
    return { status: 'needs_review', reason: MARKET_STALE_REASON };
  }
  if (overextended) {
    return { status: 'overextended', reason: OVEREXTENDED_REASON };
  }
  return { status: 'valid', reason: 'valid' };
}

function isOverextended(
  playbook: ScenarioDecisionPlaybook,
  currentPrice: number | null,
  triggerTarget: TriggerTarget,
): boolean {
  if (
    currentPrice === null ||
    triggerTarget === null ||
    triggerTarget.kind !== 'level' ||
    triggerTarget.level <= 0
  ) {
    return false;
  }
  if (conditionResult(playbook.entry_conditions[0], currentPrice) !== 'matched') {
    return false;
  }
  const threshold =
    playbook.avoid_if
      .filter((condition) => condition.type === 'overextended_from_trigger')
      .map((condition) =>
        positiveNumber(
          condition.threshold_pct,
          DEFAULT_OVEREXTENDED_THRESHOLD_PCT,
        ),
      )[0] ?? DEFAULT_OVEREXTENDED_THRESHOLD_PCT;
  const distancePct =
    (Math.abs(currentPrice - triggerTarget.level) / triggerTarget.level) * 100;
  return distancePct > threshold;
}

function conditionResult(
  condition: ScenarioDecisionCondition | undefined,
  currentPrice: number | null,
): 'matched' | 'failed' | 'unknown' {
  if (!condition || currentPrice === null) {
    return 'unknown';
  }
  if (condition.type === 'price_above' || condition.type === 'price_reclaim_level') {
    return typeof condition.level === 'number'
      ? currentPrice >= condition.level
        ? 'matched'
        : 'failed'
      : 'unknown';
  }
  if (condition.type === 'price_below' || condition.type === 'price_reject_level') {
    return typeof condition.level === 'number'
      ? currentPrice <= condition.level
        ? 'matched'
        : 'failed'
      : 'unknown';
  }
  if (condition.type === 'price_in_zone') {
    return typeof condition.zone_low === 'number' &&
      typeof condition.zone_high === 'number'
      ? currentPrice >= condition.zone_low && currentPrice <= condition.zone_high
        ? 'matched'
        : 'failed'
      : 'unknown';
  }
  return 'unknown';
}

function conditionFromTriggerSpec(spec: JsonRecord): ScenarioDecisionCondition {
  return {
    type: conditionTypeValue(spec.type),
    level: nullableNumber(spec.level) ?? undefined,
    zone_low: nullableNumber(spec.zone_low) ?? undefined,
    zone_high: nullableNumber(spec.zone_high) ?? undefined,
    timeframe: stringValue(spec.timeframe) || undefined,
    candle_close_required: booleanValue(spec.candle_close_required),
    lookback_periods: nullableNumber(spec.lookback_periods) ?? undefined,
    multiplier: nullableNumber(spec.multiplier) ?? undefined,
    threshold_pct: nullableNumber(spec.threshold_pct) ?? undefined,
  };
}

function primaryTriggerTarget(playbook: ScenarioDecisionPlaybook): TriggerTarget {
  for (const condition of playbook.entry_conditions) {
    if (typeof condition.level === 'number' && condition.level > 0) {
      return {
        kind: 'level',
        level: condition.level,
        direction:
          condition.type === 'price_below' ||
          condition.type === 'price_reject_level'
            ? 'below'
            : 'above',
      };
    }
    if (
      condition.type === 'price_in_zone' &&
      typeof condition.zone_low === 'number' &&
      typeof condition.zone_high === 'number' &&
      condition.zone_low > 0 &&
      condition.zone_high > 0
    ) {
      return {
        kind: 'zone',
        zoneLow: Math.min(condition.zone_low, condition.zone_high),
        zoneHigh: Math.max(condition.zone_low, condition.zone_high),
      };
    }
  }
  return null;
}

function parsePriceCondition(value: string): ScenarioDecisionCondition[] {
  const condition = derivePriceConditionFromText(value);
  return condition ? [condition] : [];
}

function marketIsStale(snapshot: JsonRecord | null, nowIso: string): boolean {
  const capturedAt = nullableString(snapshot?.captured_at);
  if (!capturedAt) {
    return true;
  }
  const capturedMs = Date.parse(capturedAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(capturedMs) || !Number.isFinite(nowMs)) {
    return true;
  }
  return nowMs - capturedMs > MARKET_STALE_MINUTES * 60 * 1000;
}

function statusReasonFor(input: {
  recommendedAction: ScenarioRecommendedAction;
  triggerStatus: ScenarioTriggerStatus;
  validityStatus: ScenarioValidityStatus;
  triggerTarget: TriggerTarget;
  currentPrice: number | null;
  blockers: string[];
}): string {
  if (input.blockers.length > 0) {
    return `Action ${input.recommendedAction} because blockers are present: ${input.blockers.join(', ')}.`;
  }
  if (input.triggerStatus === 'triggered') {
    return `Trigger is active at latest price ${formatNumber(input.currentPrice)} against ${formatTriggerTarget(input.triggerTarget)}.`;
  }
  if (input.triggerStatus === 'near_trigger') {
    return 'Scenario is near trigger; wait for confirmation before entry.';
  }
  return `Scenario is ${input.triggerStatus} with validity ${input.validityStatus}.`;
}

function confidenceAfterGates(confidence: number, blockers: string[]): number {
  if (blockers.length === 0) {
    return confidence;
  }
  if (
    blockers.includes('Recommendation is missing evidence references.') ||
    blockers.includes('Recommendation is missing invalidation condition.')
  ) {
    return Math.min(confidence, 0.5);
  }
  return Math.min(confidence, 0.65);
}

function recommendationBlockingReasons(recommendation: JsonRecord): {
  reasons: string[];
  overrides: string[];
} {
  const reasons: string[] = [];
  const overrides: string[] = [];
  for (const reason of stringList(recommendation.blocking_reasons)) {
    reasons.push(reason);
    overrides.push('recommendation_blocking_reason');
  }
  const gates = Array.isArray(recommendation.hard_gates)
    ? recommendation.hard_gates
    : [];
  for (const item of gates) {
    const gate = recordValue(item);
    const status = stringValue(gate.status, 'unknown');
    const label = stringValue(gate.label, stringValue(gate.id, 'Unnamed gate'));
    if (status === 'passed') {
      continue;
    }
    if (status === 'failed') {
      reasons.push(`Hard gate failed: ${label}.`);
      overrides.push(`hard_gate_failed:${stringValue(gate.id, label)}`);
      continue;
    }
    reasons.push(`Hard gate not passed: ${label}.`);
    overrides.push(`hard_gate_not_passed:${stringValue(gate.id, label)}`);
  }
  return { reasons, overrides };
}

function conditionList(value: unknown): ScenarioDecisionCondition[] {
  return Array.isArray(value)
    ? value.map((item) => conditionFromTriggerSpec(recordValue(item)))
    : [];
}

function evidenceRefList(value: unknown): ScenarioEvidenceRef[] {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const record = recordValue(item);
          return {
            type: stringValue(record.type, 'unknown'),
            id: nullableString(record.id),
            field: stringValue(record.field),
            label: stringValue(record.label),
            supports: stringValue(record.supports),
          };
        })
        .filter((item) => item.field && item.supports)
    : [];
}

function actionValue(
  value: unknown,
  fallback: ScenarioRecommendedAction,
): ScenarioRecommendedAction {
  const action = stringValue(value);
  return [
    'wait',
    'entry_long_now',
    'entry_short_now',
    'consider_long',
    'consider_short',
    'avoid',
    'reduce',
    'exit',
    'review',
  ].includes(action)
    ? (action as ScenarioRecommendedAction)
    : fallback;
}

function actionBiasValue(value: unknown): ScenarioActionBias {
  const bias = stringValue(value);
  return bias === 'long' || bias === 'short' || bias === 'neutral'
    ? bias
    : 'unknown';
}

function inferredActionBias(
  scenario: JsonRecord,
  payload: JsonRecord,
  condition?: ScenarioDecisionCondition,
): ScenarioActionBias {
  if (condition?.type === 'price_below' || condition?.type === 'price_reject_level') {
    return 'short';
  }
  if (condition?.type === 'price_above' || condition?.type === 'price_reclaim_level') {
    return 'long';
  }
  const text = [
    scenario.direction,
    payload.direction,
    scenario.condition,
    payload.condition,
    scenario.expected_behavior,
    payload.expected_behavior,
  ]
    .map((item) => stringValue(item))
    .join(' ');
  const normalizedText = normalizeScenarioConditionText(text);
  if (/\b(short|bear|bearish|below|breakdown|reject|giam|pha vo)\b/.test(normalizedText)) {
    return 'short';
  }
  if (/\b(long|bull|bullish|above|breakout|reclaim|tang|phuc hoi)\b/.test(normalizedText)) {
    return 'long';
  }
  return 'unknown';
}

function conditionTypeValue(value: unknown): ScenarioDecisionCondition['type'] {
  const type = stringValue(value);
  if (
    type === 'price_above' ||
    type === 'price_below' ||
    type === 'price_in_zone' ||
    type === 'price_reclaim_level' ||
    type === 'price_reject_level' ||
    type === 'volume_above_average' ||
    type === 'overextended_from_trigger'
  ) {
    return type;
  }
  return 'price_above';
}

function conditionLabel(condition: ScenarioDecisionCondition): string {
  if (typeof condition.level === 'number') {
    return `${condition.type}:${condition.level}`;
  }
  if (
    typeof condition.zone_low === 'number' &&
    typeof condition.zone_high === 'number'
  ) {
    return `${condition.type}:${condition.zone_low}-${condition.zone_high}`;
  }
  return condition.type;
}

function distanceToTarget(
  currentPrice: number | null,
  triggerTarget: TriggerTarget,
): number | null {
  if (currentPrice === null || triggerTarget === null) {
    return null;
  }
  if (triggerTarget.kind === 'zone') {
    if (
      currentPrice >= triggerTarget.zoneLow &&
      currentPrice <= triggerTarget.zoneHigh
    ) {
      return 0;
    }
    const boundary =
      currentPrice < triggerTarget.zoneLow
        ? triggerTarget.zoneLow
        : triggerTarget.zoneHigh;
    return Number((Math.abs(currentPrice - boundary) / boundary).toFixed(4));
  }
  return Number(
    (Math.abs(currentPrice - triggerTarget.level) / triggerTarget.level).toFixed(4),
  );
}

function firstScenarioString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text && !['not recorded', 'n/a', 'none', 'unknown'].includes(text.toLowerCase())) {
      return text;
    }
  }
  return '';
}

function timestampForSort(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function formatNumber(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(4);
}

function formatTriggerTarget(target: TriggerTarget): string {
  if (target === null) {
    return 'n/a';
  }
  if (target.kind === 'zone') {
    return `zone ${formatNumber(target.zoneLow)}-${formatNumber(target.zoneHigh)}`;
  }
  return `level ${formatNumber(target.level)}`;
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

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = nullableNumber(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function clampConfidence(value: unknown): number {
  const parsed = nullableNumber(value);
  if (parsed === null) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
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

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return String(value).toLowerCase() === 'true';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
