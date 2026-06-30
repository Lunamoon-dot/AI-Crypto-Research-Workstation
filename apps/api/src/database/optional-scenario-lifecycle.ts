const OPTIONAL_SCENARIO_LIFECYCLE_IDENTIFIERS = [
  'scenario_evaluations',
  'scenarioevaluation',
  'trade_playbooks',
  'tradeplaybook',
  'backtest_runs',
  'backtestrun',
  'backtest_trade_events',
  'backtesttradeevent',
  'scenario_decision_item_states',
  'scenariodecisionitemstate',
];

export async function optionalScenarioLifecycleRows<T>(
  read: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    if (isMissingScenarioLifecycleTableError(error)) {
      return [];
    }
    throw error;
  }
}

export function isMissingScenarioLifecycleTableError(error: unknown): boolean {
  const code = errorCode(error);
  if (code !== '42P01' && code !== 'P2021') {
    return false;
  }
  const haystack = `${errorMessage(error)} ${errorMeta(error)}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '');
  return OPTIONAL_SCENARIO_LIFECYCLE_IDENTIFIERS.some((identifier) =>
    haystack.includes(identifier),
  );
}

function errorCode(error: unknown): string {
  if (!isRecord(error)) {
    return '';
  }
  const code = error.code;
  return code === null || code === undefined ? '' : String(code);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (!isRecord(error)) {
    return String(error);
  }
  const message = error.message;
  return message === null || message === undefined ? '' : String(message);
}

function errorMeta(error: unknown): string {
  if (!isRecord(error) || !isRecord(error.meta)) {
    return '';
  }
  return Object.values(error.meta)
    .map((value) => (value === null || value === undefined ? '' : String(value)))
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
