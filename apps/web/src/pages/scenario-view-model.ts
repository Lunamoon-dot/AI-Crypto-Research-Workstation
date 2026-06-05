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
}

export function scenarioMonitorViewModel(scenario: ScenarioResponse): ScenarioViewModel {
  return buildScenarioViewModel(scenario, 'Scenario');
}

export function scenarioDetailViewModel(scenario: ScenarioResponse, index: number): ScenarioViewModel {
  return buildScenarioViewModel(scenario, `Scenario ${index + 1}`);
}

function buildScenarioViewModel(scenario: ScenarioResponse, fallbackTitle: string): ScenarioViewModel {
  const action = splitAction(scenario.suggested_user_action || 'review');
  return {
    title: cleanText(scenario.scenario_name) || cleanText(scenario.condition).slice(0, 90) || fallbackTitle,
    condition: cleanText(scenario.condition) || 'No trigger condition recorded.',
    expected: cleanText(scenario.expected_behavior),
    evidence: cleanList(scenario.evidence),
    watchTriggers: cleanList(scenario.watch_triggers),
    actionLabel: action.label,
    actionDetail: action.detail,
    actionTone: actionTone(action.label),
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
