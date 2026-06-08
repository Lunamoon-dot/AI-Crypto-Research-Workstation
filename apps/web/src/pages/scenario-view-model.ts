import type { ScenarioResponse } from '@/types';

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
  source: string;
  status: string;
  statusReason: string;
  distanceLabel: string;
  runtimeAction: string;
  triggerStatus: string;
  validityStatus: string;
  runtimeReason: string;
  runtimeSource: string;
  blockingReasons: string[];
}

export function scenarioMonitorViewModel(scenario: ScenarioResponse): ScenarioViewModel {
  return buildScenarioViewModel(scenario, 'Scenario');
}

export function scenarioDetailViewModel(scenario: ScenarioResponse, index: number): ScenarioViewModel {
  return buildScenarioViewModel(scenario, `Scenario ${index + 1}`);
}

function buildScenarioViewModel(scenario: ScenarioResponse, fallbackTitle: string): ScenarioViewModel {
  const action = splitAction(scenario.suggested_user_action || 'review');
  const hasRuntimeDecision =
    scenario.runtime_decision.playbook_source !== 'missing' &&
    !scenario.runtime_decision.blocking_reasons.includes('runtime_decision_missing');
  const runtimeAction = hasRuntimeDecision
    ? actionLabel(scenario.runtime_decision.recommended_action)
    : '';
  return {
    title: cleanText(scenario.scenario_name) || cleanText(scenario.condition).slice(0, 90) || fallbackTitle,
    condition: cleanText(scenario.condition) || 'No trigger condition recorded.',
    expected: cleanText(scenario.expected_behavior),
    evidence: cleanList(scenario.evidence),
    watchTriggers: cleanList(scenario.watch_triggers),
    actionLabel: runtimeAction || action.label,
    actionDetail: action.detail,
    actionTone: actionTone(runtimeAction || action.label),
    impactOnThesis: cleanText(scenario.impact_on_thesis),
    riskMap: cleanList(scenario.risk_map),
    asOf: cleanText(scenario.as_of) || 'not recorded',
    timeframe: cleanText(scenario.timeframe) || 'not recorded',
    source: cleanList(scenario.source).join(', ') || 'not recorded',
    status: cleanText(scenario.status) || 'watching',
    statusReason: cleanText(scenario.status_reason),
    distanceLabel:
      typeof scenario.distance_to_trigger === 'number'
        ? `${(scenario.distance_to_trigger * 100).toFixed(2)}%`
        : 'n/a',
    runtimeAction,
    triggerStatus: hasRuntimeDecision
      ? statusLabel(scenario.runtime_decision.trigger_status)
      : '',
    validityStatus: hasRuntimeDecision
      ? statusLabel(scenario.runtime_decision.validity_status)
      : '',
    runtimeReason: hasRuntimeDecision
      ? cleanText(scenario.runtime_decision.status_reason)
      : '',
    runtimeSource: hasRuntimeDecision
      ? playbookSourceLabel(scenario.runtime_decision.playbook_source)
      : '',
    blockingReasons: hasRuntimeDecision
      ? scenario.runtime_decision.blocking_reasons.map(cleanText).filter(Boolean)
      : [],
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
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
