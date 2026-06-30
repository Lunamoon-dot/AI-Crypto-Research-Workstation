import type { ScenarioResponse, ScenarioRuntimeDecision } from '@/types';

export type ScenarioTone = 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';

export interface ScenarioViewModel {
  title: string;
  condition: string;
  expected: string;
  evidence: string[];
  watchTriggers: string[];
  actionLabel: string;
  actionDetail: string;
  actionTone: 'constructive' | 'warning' | 'risk' | 'primary';
  impactOnThesis: string;
  riskMap: string[];
  asOf: string;
  timeframe: string;
  horizon: ScenarioResponse['horizon'];
  horizonLabel: string;
  timeframeLabel: string;
  source: string;
  status: string;
  statusReason: string;
  distanceLabel: string;
  runtimeAction: string;
  triggerStatus: string;
  validityStatus: string;
  runtimeReason: string;
  runtimeSource: string;
  recommendationSummary: string;
  blockingReasons: string[];
  hardGates: Array<{ label: string; status: string; reason: string }>;
  evaluationLabel: string;
  evaluationDetail: string;
  reliabilityLabel: string;
  reliabilityDetail: string;
  playbookLabel: string;
  backtestLabel: string;
  backtestEvents: string[];
}

export function scenarioMonitorViewModel(scenario: ScenarioResponse): ScenarioViewModel {
  return buildScenarioViewModel(scenario, 'Scenario');
}

export function scenarioDetailViewModel(scenario: ScenarioResponse, index: number): ScenarioViewModel {
  return buildScenarioViewModel(scenario, `Scenario ${index + 1}`);
}

function buildScenarioViewModel(scenario: ScenarioResponse, fallbackTitle: string): ScenarioViewModel {
  const action = splitAction(scenario.suggested_user_action || 'review');
  const runtimeDecision = scenarioRuntimeDecision(scenario.runtime_decision);
  const hasRuntimeDecision =
    runtimeDecision.playbook_source !== 'missing' &&
    !runtimeDecision.blocking_reasons.includes('runtime_decision_missing');
  const runtimeAction = hasRuntimeDecision
    ? actionLabel(runtimeDecision.recommended_action)
    : '';
  const recommendation = scenario.scenario_recommendation;
  const recommendationAction = recommendation
    ? actionLabel(recommendation.action)
    : '';
  const recommendationBlockers = recommendation
    ? cleanList(recommendation.blocking_reasons)
    : ['Scenario recommendation is missing.'];
  const runtimeBlockers = hasRuntimeDecision
    ? runtimeDecision.blocking_reasons.map(cleanText).filter(Boolean)
    : [];
  const latestEvaluation = scenario.latest_evaluation;
  const reliability = scenario.reliability_profile;
  const playbook = scenario.latest_playbook;
  const backtest = scenario.latest_backtest;
  return {
    title: cleanText(scenario.scenario_name) || cleanText(scenario.condition).slice(0, 90) || fallbackTitle,
    condition: cleanText(scenario.condition) || 'No trigger condition recorded.',
    expected: cleanText(scenario.expected_behavior),
    evidence: cleanList(scenario.evidence),
    watchTriggers: cleanList(scenario.watch_triggers),
    actionLabel: runtimeAction || recommendationAction || action.label || 'Review',
    actionDetail: action.detail,
    actionTone: actionTone(runtimeAction || recommendationAction || action.label),
    impactOnThesis: cleanText(scenario.impact_on_thesis),
    riskMap: cleanList(scenario.risk_map),
    asOf: cleanText(scenario.as_of) || 'not recorded',
    timeframe: cleanText(scenario.timeframe) || 'not recorded',
    horizon: scenarioHorizon(scenario),
    horizonLabel: scenarioHorizonLabel(scenarioHorizon(scenario)),
    timeframeLabel: cleanText(scenario.timeframe_label) || 'not recorded',
    source: cleanList(scenario.source).join(', ') || 'not recorded',
    status: cleanText(scenario.status) || 'watching',
    statusReason: cleanText(scenario.status_reason),
    distanceLabel:
      typeof scenario.distance_to_trigger === 'number'
        ? `${(scenario.distance_to_trigger * 100).toFixed(2)}%`
        : 'n/a',
    runtimeAction,
    triggerStatus: hasRuntimeDecision
      ? statusLabel(runtimeDecision.trigger_status)
      : '',
    validityStatus: hasRuntimeDecision
      ? statusLabel(runtimeDecision.validity_status)
      : '',
    runtimeReason: hasRuntimeDecision
      ? cleanText(runtimeDecision.status_reason)
      : '',
    runtimeSource: hasRuntimeDecision
      ? playbookSourceLabel(runtimeDecision.playbook_source)
      : '',
    recommendationSummary: cleanText(recommendation?.summary),
    blockingReasons: cleanList([...runtimeBlockers, ...recommendationBlockers]),
    hardGates: (recommendation?.hard_gates ?? [])
      .map((gate) => ({
        label: cleanText(gate.label || gate.id),
        status: statusLabel(gate.status),
        reason: cleanText(gate.reason),
      }))
      .filter((gate) => gate.label),
    evaluationLabel: scenarioEvaluationLabel(scenario),
    evaluationDetail: latestEvaluation
      ? [
          latestEvaluation.data_quality,
          latestEvaluation.trigger_hit === null
            ? ''
            : `trigger ${latestEvaluation.trigger_hit ? 'hit' : 'missed'}`,
          latestEvaluation.invalidation_hit === null
            ? ''
            : `invalidation ${latestEvaluation.invalidation_hit ? 'hit' : 'clear'}`,
        ].filter(Boolean).join(' | ')
      : evaluationLabel(
          scenario.evaluation_snapshot?.readiness ??
            recommendation?.evaluation_readiness ??
            'needs_review',
        ),
    reliabilityLabel: reliability
      ? reliability.hit_rate === null
        ? `${reliability.sample_size} samples`
        : `${formatPct(reliability.hit_rate)} hit rate`
      : 'No reliability profile',
    reliabilityDetail: reliability
      ? cleanList([
          ...reliability.data_quality_notes,
          ...reliability.recent_lessons,
        ]).slice(0, 2).join(' | ')
      : 'Evaluation history has not reached this scenario group yet.',
    playbookLabel: playbook
      ? `${actionLabel(playbook.direction)} playbook`
      : 'No playbook',
    backtestLabel: backtest
      ? `${statusLabel(backtest.status)} backtest | ${backtest.result.trade_count} trades`
      : 'No backtest',
    backtestEvents: backtest?.trade_events?.length
      ? backtest.trade_events.slice(0, 5).map(formatBacktestEvent)
      : [],
  };
}

export function scenarioHorizon(scenario: Pick<ScenarioResponse, 'horizon' | 'payload'>): ScenarioResponse['horizon'] {
  if (
    scenario.horizon === 'short_term' ||
    scenario.horizon === 'mid_term' ||
    scenario.horizon === 'long_term' ||
    scenario.horizon === 'unknown'
  ) {
    return scenario.horizon;
  }
  const payloadHorizon = scenario.payload?.horizon;
  if (
    payloadHorizon === 'short_term' ||
    payloadHorizon === 'mid_term' ||
    payloadHorizon === 'long_term'
  ) {
    return payloadHorizon;
  }
  return 'unknown';
}

function scenarioHorizonLabel(value: ScenarioResponse['horizon']): string {
  if (value === 'short_term') {
    return 'Short-term';
  }
  if (value === 'mid_term') {
    return 'Mid-term';
  }
  if (value === 'long_term') {
    return 'Long-term';
  }
  return 'Unknown horizon';
}

function scenarioRuntimeDecision(
  value: ScenarioResponse['runtime_decision'] | undefined,
): ScenarioRuntimeDecision {
  if (value?.version === 'scenario_runtime_decision.v1') {
    return {
      ...missingRuntimeDecision(),
      ...value,
      blocking_reasons: Array.isArray(value.blocking_reasons)
        ? value.blocking_reasons
        : [],
    };
  }
  return missingRuntimeDecision();
}

function missingRuntimeDecision(): ScenarioRuntimeDecision {
  return {
    version: 'scenario_runtime_decision.v1',
    evaluated_at: '',
    trigger_status: 'needs_review',
    validity_status: 'needs_review',
    recommended_action: 'review',
    confidence: 0,
    matched_conditions: [],
    failed_conditions: [],
    blocking_reasons: ['runtime_decision_missing'],
    risk_notes: [],
    evidence_refs: [],
    source: 'rule_engine_from_decision_playbook',
    playbook_source: 'missing',
    status_reason: 'Runtime decision has not been evaluated.',
    distance_to_trigger: null,
    llm_recommendation: null,
    final_decision: {
      action: 'review',
      reason: 'Runtime decision has not been evaluated.',
      overrides: ['runtime_decision_missing'],
    },
  };
}

function splitAction(value: string): { label: string; detail: string } {
  const cleaned = cleanText(value);
  const match = cleaned.match(
    /^(watch|monitor|review|reassess|avoid|reduce|exit|stand aside|maintain|downgrade|upgrade|record|wait|hold)\b[:,-]?\s*(.*)$/i,
  );
  if (!match) {
    return { label: 'Review', detail: cleaned };
  }
  return {
    label: match[1].replace(/\b\w/g, (letter) => letter.toUpperCase()),
    detail: match[2]?.trim() ?? '',
  };
}

function actionTone(value: string): 'constructive' | 'warning' | 'risk' | 'primary' {
  const normalized = value.toLowerCase();
  if (normalized.includes('exit') || normalized.includes('reduce') || normalized.includes('avoid')) {
    return 'risk';
  }
  if (normalized.includes('watch') || normalized.includes('monitor') || normalized.includes('hold')) {
    return 'constructive';
  }
  if (normalized.includes('reassess') || normalized.includes('wait')) {
    return 'warning';
  }
  return 'primary';
}

function cleanList(values: string[]): string[] {
  return [...new Set((values ?? []).map(cleanText).filter(Boolean))];
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\bSource,\s*timeframe,\s*and\s*as_of\s*:\s*.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function actionLabel(value: string): string {
  const label = value.replaceAll('_', ' ').trim();
  return label ? label[0].toUpperCase() + label.slice(1) : 'Review';
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function playbookSourceLabel(value: string): string {
  if (value === 'llm') {
    return 'Rule evaluator / LLM playbook';
  }
  if (value === 'derived_v1') {
    return 'Rule evaluator / derived playbook';
  }
  return 'No runtime playbook';
}

function evaluationLabel(value: string): string {
  if (value === 'ready') {
    return 'Ready for evaluation';
  }
  if (value === 'missing_trigger') {
    return 'Missing trigger';
  }
  if (value === 'missing_invalidation') {
    return 'Missing invalidation';
  }
  if (value === 'missing_time_window') {
    return 'Missing time window';
  }
  if (value === 'not_actionable') {
    return 'Not actionable';
  }
  return 'Needs review';
}

function scenarioEvaluationLabel(scenario: ScenarioResponse): string {
  if (scenario.latest_evaluation) {
    return statusLabel(scenario.latest_evaluation.result);
  }
  if (scenario.evaluation_state === 'due') {
    return 'Evaluation due';
  }
  if (scenario.evaluation_state === 'pending') {
    return 'Evaluation pending';
  }
  if (scenario.evaluation_state === 'not_ready') {
    return 'Not ready';
  }
  if (scenario.evaluation_state === 'inconclusive') {
    return 'Inconclusive';
  }
  return evaluationLabel(
    scenario.evaluation_snapshot?.readiness ??
      scenario.scenario_recommendation?.evaluation_readiness ??
      'needs_review',
  );
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatBacktestEvent(
  event: NonNullable<ScenarioResponse['latest_backtest']>['trade_events'][number],
): string {
  const price = typeof event.price === 'number'
    ? `@ ${event.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : '';
  const policy = cleanText(event.details.fill_policy);
  return [
    statusLabel(event.event_type),
    event.event_time,
    price,
    policy ? `fill ${policy}` : '',
  ].filter(Boolean).join(' | ');
}
