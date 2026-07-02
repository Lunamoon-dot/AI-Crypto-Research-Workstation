import { JsonRecord } from '../database/journal.types';

export function latestValidScenarioEvaluation(
  evaluations: JsonRecord[],
): JsonRecord | null {
  return evaluations.find(isValidScenarioEvaluation) ?? null;
}

export function latestUsableBacktestRun(backtests: JsonRecord[]): JsonRecord | null {
  return backtests.find(isUsableBacktestRun) ?? null;
}

function isValidScenarioEvaluation(evaluation: JsonRecord): boolean {
  const window = recordValue(evaluation.evaluation_window);
  return Boolean(window.starts_at && window.ends_at);
}

function isUsableBacktestRun(backtest: JsonRecord): boolean {
  const warnings = stringList(backtest.warnings);
  return !warnings.includes('missing_numeric_target');
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item))
    : [];
}
