import type {
  MarketChartInterval,
  MarketOhlcvCandleResponse,
} from '../market-data/market-ohlcv.service';
import type {
  ScenarioDecisionCondition,
  ScenarioDecisionPlaybook,
} from './scenario-decision.types';

export type ScenarioConditionStatus = 'passed' | 'failed' | 'pending' | 'unknown';

export type ScenarioConditionEvaluationContext = {
  currentPrice: number | null;
  evaluatedAt: string;
  marketSnapshotId: string | null;
  closedCandlesByInterval: Partial<
    Record<MarketChartInterval, MarketOhlcvCandleResponse[]>
  >;
};

export type ScenarioConditionEvaluation = {
  status: ScenarioConditionStatus;
  reason: string;
  blocksStrongAction: boolean;
};

export function evaluateScenarioCondition(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  if (condition.type === 'price_reclaim_level') {
    return evaluateReclaim(condition, context);
  }
  if (condition.type === 'price_reject_level') {
    return evaluateReject(condition, context);
  }
  if (condition.type === 'volume_above_average') {
    return evaluateVolume(condition, context);
  }
  return evaluateLatestPrice(condition, context);
}

export function conditionIntervalsForPlaybook(
  playbook: ScenarioDecisionPlaybook | null,
): MarketChartInterval[] {
  if (!playbook) {
    return [];
  }
  const intervals = new Set<MarketChartInterval>();
  for (const condition of [
    ...playbook.entry_conditions,
    ...playbook.invalidation_conditions,
    ...playbook.avoid_if,
  ]) {
    if (!conditionNeedsClosedCandles(condition)) {
      continue;
    }
    intervals.add(conditionIntervalValue(condition.timeframe) ?? '1d');
  }
  return [...intervals];
}

function evaluateReclaim(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  if (typeof condition.level !== 'number') {
    return unknown('Reclaim level is missing.', condition);
  }
  const candles = candlesFor(condition, context);
  if (candles.length < 2) {
    return unknown('Reclaim requires at least two closed candles.', condition);
  }
  const previous = candles[candles.length - 2]!;
  const current = candles[candles.length - 1]!;
  const passed = previous.close < condition.level && current.close >= condition.level;
  return passed
    ? pass('Closed candle reclaimed the level.')
    : fail('Closed candle has not reclaimed the level.', condition);
}

function evaluateReject(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  if (typeof condition.level !== 'number') {
    return unknown('Reject level is missing.', condition);
  }
  const candles = candlesFor(condition, context);
  if (candles.length < 1) {
    return unknown('Reject requires a closed candle.', condition);
  }
  const current = candles[candles.length - 1]!;
  const passed = current.high >= condition.level && current.close < condition.level;
  return passed
    ? pass('Closed candle rejected the level.')
    : fail('Closed candle has not rejected the level.', condition);
}

function evaluateVolume(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  const lookback = Math.max(2, Math.floor(condition.lookback_periods ?? 20));
  const multiplier = condition.multiplier ?? 1.5;
  const candles = candlesFor(condition, context).filter(
    (candle) => typeof candle.volume === 'number',
  );
  if (candles.length < lookback + 1) {
    return unknown(
      'Volume confirmation requires enough closed candles.',
      condition,
    );
  }
  const current = candles[candles.length - 1]!;
  const history = candles.slice(candles.length - lookback - 1, candles.length - 1);
  const average =
    history.reduce((sum, candle) => sum + (candle.volume ?? 0), 0) /
    history.length;
  return (current.volume ?? 0) >= average * multiplier
    ? pass('Volume is above lookback average.')
    : fail('Volume is not above lookback average.', condition);
}

function evaluateLatestPrice(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  const currentPrice = condition.candle_close_required
    ? latestClosedCandlePrice(condition, context)
    : context.currentPrice;
  if (currentPrice === null) {
    return unknown(
      condition.candle_close_required
        ? 'Closed candle is required.'
        : 'Current price is missing.',
      condition,
    );
  }
  if (condition.type === 'price_above' && typeof condition.level === 'number') {
    return currentPrice >= condition.level
      ? pass('Price is above level.')
      : fail('Price is below level.', condition);
  }
  if (condition.type === 'price_below' && typeof condition.level === 'number') {
    return currentPrice <= condition.level
      ? pass('Price is below level.')
      : fail('Price is above level.', condition);
  }
  if (
    condition.type === 'price_in_zone' &&
    typeof condition.zone_low === 'number' &&
    typeof condition.zone_high === 'number'
  ) {
    return currentPrice >= Math.min(condition.zone_low, condition.zone_high) &&
      currentPrice <= Math.max(condition.zone_low, condition.zone_high)
      ? pass('Price is inside zone.')
      : fail('Price is outside zone.', condition);
  }
  return unknown('Condition cannot be evaluated from latest price.', condition);
}

function candlesFor(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): MarketOhlcvCandleResponse[] {
  const interval = conditionIntervalValue(condition.timeframe) ?? '1d';
  return context.closedCandlesByInterval[interval] ?? [];
}

function latestClosedCandlePrice(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): number | null {
  const candles = candlesFor(condition, context);
  const latest = candles[candles.length - 1];
  return latest ? latest.close : null;
}

function conditionNeedsClosedCandles(
  condition: ScenarioDecisionCondition,
): boolean {
  return (
    condition.candle_close_required === true ||
    condition.type === 'price_reclaim_level' ||
    condition.type === 'price_reject_level' ||
    condition.type === 'volume_above_average'
  );
}

function pass(reason: string): ScenarioConditionEvaluation {
  return { status: 'passed', reason, blocksStrongAction: false };
}

function fail(
  reason: string,
  condition: ScenarioDecisionCondition,
): ScenarioConditionEvaluation {
  return {
    status: 'failed',
    reason,
    blocksStrongAction: condition.role === 'confirmation',
  };
}

function unknown(
  reason: string,
  condition: ScenarioDecisionCondition,
): ScenarioConditionEvaluation {
  return {
    status: 'unknown',
    reason,
    blocksStrongAction: condition.role === 'confirmation',
  };
}

function conditionIntervalValue(value: unknown): MarketChartInterval | null {
  if (
    value === '1m' ||
    value === '5m' ||
    value === '15m' ||
    value === '1h' ||
    value === '4h' ||
    value === '1d'
  ) {
    return value;
  }
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (normalized === '1d' || normalized === '1day' || normalized === 'daily') {
    return '1d';
  }
  if (normalized === '4h' || normalized === '4hr') {
    return '4h';
  }
  if (normalized === '1h' || normalized === '1hr' || normalized === 'hourly') {
    return '1h';
  }
  return null;
}
