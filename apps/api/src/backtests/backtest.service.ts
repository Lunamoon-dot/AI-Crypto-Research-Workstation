import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  MarketOhlcvCandleResponse,
  MarketOhlcvService,
} from '../market-data/market-ohlcv.service';
import {
  BacktestAssumptionSetResponse,
  BacktestRunResponse,
  BacktestTradeEventResponse,
} from './backtest.types';
import {
  toBacktestRunResponse,
  toBacktestTradeEventResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class BacktestService {
  private ohlcvForTest: MarketOhlcvCandleResponse[] | null = null;

  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly ohlcv: MarketOhlcvService,
  ) {}

  setOhlcvForTest(candles: MarketOhlcvCandleResponse[]): void {
    this.ohlcvForTest = candles;
  }

  async createBacktest(
    playbookId: string,
    assumptionsInput: Partial<BacktestAssumptionSetResponse>,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<BacktestRunResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    const rawPlaybook = await this.journal.getTradePlaybook(playbookId, workspaceId);
    if (!rawPlaybook) {
      throw new NotFoundException(`Playbook ${playbookId} not found`);
    }
    const playbook = toTradePlaybookResponse(rawPlaybook);
    const assumptions = normalizeAssumptions(assumptionsInput);
    const candles = await this.loadCandles({
      workspaceId,
      symbol: playbook.symbol,
      marketType: playbook.market_type,
      assumptions,
    });
    const warnings: string[] = [];
    const events: JsonRecord[] = [];
    let status: BacktestRunResponse['status'] = 'completed';
    let dataQuality: BacktestRunResponse['data_quality'] = 'complete';
    let result: BacktestRunResponse['result'] = {
      total_return_pct: null,
      max_drawdown_pct: null,
      trade_count: 0,
      win_rate: null,
      profit_factor: null,
    };

    if (candles.length === 0) {
      status = 'failed';
      dataQuality = 'insufficient';
      warnings.push('missing_ohlcv');
    } else {
      const simulation = simulate(playbook, candles, assumptions);
      result = simulation.result;
      events.push(...simulation.events);
      warnings.push(...simulation.warnings);
      if (simulation.warnings.length > 0) {
        status = 'partial';
        dataQuality = 'partial';
      }
    }

    const id = `backtest_${randomUUID().replaceAll('-', '')}`;
    const saved = await this.journal.saveBacktestRun(
      {
        version: 'backtest_run.v1',
        id,
        workspace_id: workspaceId,
        playbook_id: playbook.id,
        status,
        assumptions,
        result,
        warnings,
        data_quality: dataQuality,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
      workspaceId,
    );
    await this.journal.saveBacktestTradeEvents(id, events, workspaceId);
    const tradeEvents = await this.journal.listBacktestTradeEvents(id, workspaceId);
    return toBacktestRunResponse({ ...saved, trade_events: tradeEvents });
  }

  async listForPlaybook(
    playbookId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<BacktestRunResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    return (await optionalScenarioLifecycleRows(() =>
      this.journal.listBacktestRunsForPlaybook(playbookId, workspaceId),
    )).map(toBacktestRunResponse);
  }

  async getBacktest(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<BacktestRunResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    const backtest = await this.journal.getBacktestRun(id, workspaceId);
    if (!backtest) {
      throw new NotFoundException(`Backtest ${id} not found`);
    }
    const tradeEvents = await optionalScenarioLifecycleRows(() =>
      this.journal.listBacktestTradeEvents(id, workspaceId),
    );
    return toBacktestRunResponse({ ...backtest, trade_events: tradeEvents });
  }

  async listTradeEvents(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<BacktestTradeEventResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    const backtest = await this.journal.getBacktestRun(id, workspaceId);
    if (!backtest) {
      throw new NotFoundException(`Backtest ${id} not found`);
    }
    return (await optionalScenarioLifecycleRows(() =>
      this.journal.listBacktestTradeEvents(id, workspaceId),
    )).map(toBacktestTradeEventResponse);
  }

  private async loadCandles(input: {
    workspaceId: string;
    symbol: string;
    marketType: 'spot' | 'perp';
    assumptions: BacktestAssumptionSetResponse;
  }): Promise<MarketOhlcvCandleResponse[]> {
    if (this.ohlcvForTest) {
      return this.ohlcvForTest;
    }
    const response = await this.ohlcv.getOhlcv({
      workspaceId: input.workspaceId,
      symbol: input.symbol,
      marketType: input.marketType,
      interval: input.assumptions.timeframe,
      from: input.assumptions.start_at,
      to: input.assumptions.end_at,
      limit: '1000',
    });
    return response.candles;
  }

  private async resolveWorkspace(
    userId: string | undefined,
    workspaceHeader: string | undefined,
    role: 'viewer' | 'editor',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, role);
    return workspaceId;
  }
}

function normalizeAssumptions(
  input: Partial<BacktestAssumptionSetResponse>,
): BacktestAssumptionSetResponse {
  const feeBps = numberValue(input.fee_bps, 5);
  const slippageBps = numberValue(input.slippage_bps, 5);
  const startingEquity = numberValue(input.starting_equity, 10_000);
  const startAt = String(input.start_at ?? '2026-06-01T00:00:00.000Z');
  const endAt = String(input.end_at ?? '2026-07-01T00:00:00.000Z');
  if (feeBps < 0) throw new BadRequestException('fee_bps cannot be negative.');
  if (slippageBps < 0) throw new BadRequestException('slippage_bps cannot be negative.');
  if (startingEquity <= 0) {
    throw new BadRequestException('starting_equity must be positive.');
  }
  if (Date.parse(startAt) >= Date.parse(endAt)) {
    throw new BadRequestException('start_at must be before end_at.');
  }
  return {
    version: 'backtest_assumption_set.v1',
    fee_bps: feeBps,
    slippage_bps: slippageBps,
    fill_policy: fillPolicy(input.fill_policy),
    sizing_policy: sizingPolicy(input.sizing_policy),
    starting_equity: startingEquity,
    risk_fraction: nullableNumber(input.risk_fraction),
    timeframe: String(input.timeframe ?? '1d'),
    start_at: startAt,
    end_at: endAt,
  };
}

function simulate(
  playbook: ReturnType<typeof toTradePlaybookResponse>,
  candles: MarketOhlcvCandleResponse[],
  assumptions: BacktestAssumptionSetResponse,
): {
  result: BacktestRunResponse['result'];
  events: JsonRecord[];
  warnings: string[];
} {
  const trigger = entryTrigger(playbook.entry);
  const warnings: string[] = [];
  if (!trigger) {
    warnings.push('missing_numeric_entry');
    return {
      result: {
        total_return_pct: null,
        max_drawdown_pct: null,
        trade_count: 0,
        win_rate: null,
        profit_factor: null,
      },
      events: [],
      warnings,
    };
  }
  const entry = findEntry(candles, trigger, playbook.direction, assumptions.fill_policy);
  if (!entry) {
    return {
      result: {
        total_return_pct: 0,
        max_drawdown_pct: 0,
        trade_count: 0,
        win_rate: null,
        profit_factor: null,
      },
      events: [],
      warnings: ['entry_not_filled'],
    };
  }
  const entryIndex = entry.index;
  const entryCandle = candles[entryIndex]!;
  const exit = findExit(candles, entryIndex, playbook);
  warnings.push(...exit.warnings);
  const cost = (assumptions.fee_bps + assumptions.slippage_bps) / 10_000;
  const entryPrice = playbook.direction === 'short'
    ? entry.price * (1 - cost)
    : entry.price * (1 + cost);
  const exitPrice = playbook.direction === 'short'
    ? exit.price * (1 + cost)
    : exit.price * (1 - cost);
  const tradeReturnPct = playbook.direction === 'short'
    ? (entryPrice - exitPrice) / entryPrice
    : (exitPrice - entryPrice) / entryPrice;
  const exposure = exposureFraction(assumptions);
  const portfolioReturnPct = tradeReturnPct * exposure;
  const lows = candles.slice(entryIndex).map((candle) => candle.low);
  const tradeDrawdownPct = playbook.direction === 'short'
    ? Math.max(...candles.slice(entryIndex).map((candle) => (candle.high - entryPrice) / entryPrice))
    : Math.max(...lows.map((low) => (entryPrice - low) / entryPrice));
  const maxDrawdownPct = tradeDrawdownPct * exposure;
  return {
    result: {
      total_return_pct: roundPct(portfolioReturnPct),
      max_drawdown_pct: roundPct(maxDrawdownPct),
      trade_count: 1,
      win_rate: tradeReturnPct > 0 ? 1 : 0,
      profit_factor: tradeReturnPct > 0 ? Math.max(roundPct(tradeReturnPct), 0.0001) : 0,
    },
    events: [
      {
        id: `event_entry_${entryCandle.time}`,
        event_index: 1,
        event_type: 'entry',
        event_time: entry.time,
        price: entryPrice,
        fill_policy: assumptions.fill_policy,
        fill_reason: entry.reason,
        sizing_policy: assumptions.sizing_policy,
        exposure_fraction: exposure,
      },
      {
        id: `event_exit_${exit.time}`,
        event_index: 2,
        event_type: 'exit',
        event_time: exit.time,
        price: exitPrice,
        exit_reason: exit.reason,
      },
    ],
    warnings,
  };
}

function findExit(
  candles: MarketOhlcvCandleResponse[],
  entryIndex: number,
  playbook: ReturnType<typeof toTradePlaybookResponse>,
): { index: number; time: string; price: number; reason: string; warnings: string[] } {
  const warnings: string[] = [];
  const target = firstTargetLevel(playbook.targets);
  const invalidation = playbook.invalidation.level;
  if (target === null) {
    warnings.push('missing_numeric_target');
  }
  if (invalidation === null) {
    warnings.push('missing_numeric_invalidation');
  }

  for (let index = entryIndex + 1; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const hitInvalidation = invalidation !== null && (
      playbook.direction === 'short'
        ? candle.high >= invalidation
        : candle.low <= invalidation
    );
    const hitTarget = target !== null && (
      playbook.direction === 'short'
        ? candle.low <= target
        : candle.high >= target
    );
    if (hitInvalidation && hitTarget) {
      warnings.push('ambiguous_intrabar_exit_order');
      return { index, time: candle.time, price: invalidation, reason: 'invalidation', warnings };
    }
    if (hitInvalidation) {
      return { index, time: candle.time, price: invalidation, reason: 'invalidation', warnings };
    }
    if (hitTarget) {
      return { index, time: candle.time, price: target, reason: 'target', warnings };
    }
  }

  const finalIndex = candles.length - 1;
  const final = candles[finalIndex]!;
  return { index: finalIndex, time: final.time, price: final.close, reason: 'final_candle', warnings };
}

function firstTargetLevel(
  targets: ReturnType<typeof toTradePlaybookResponse>['targets'],
): number | null {
  for (const target of targets) {
    if (typeof target.level === 'number') {
      return target.level;
    }
  }
  return null;
}

function findEntry(
  candles: MarketOhlcvCandleResponse[],
  trigger: EntryTrigger,
  direction: 'long' | 'short' | 'avoid',
  fillPolicyValue: BacktestAssumptionSetResponse['fill_policy'],
): { index: number; time: string; price: number; reason: string } | null {
  if (direction === 'avoid') {
    return null;
  }

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const touch = touchEntry(candle, trigger, direction);
    if (fillPolicyValue === 'touch' && touch) {
      return { index, time: candle.time, price: touch.price, reason: touch.reason };
    }
    if (fillPolicyValue === 'touch' && gapsThrough(candle, trigger, direction)) {
      return { index, time: candle.time, price: candle.open, reason: 'gap_through_open' };
    }
    if (fillPolicyValue === 'close_confirmed' && closesThrough(candle, trigger, direction)) {
      return { index, time: candle.time, price: candle.close, reason: 'close_confirmed' };
    }
    if (fillPolicyValue === 'next_open' && closesThrough(candle, trigger, direction)) {
      const next = candles[index + 1];
      return next
        ? { index: index + 1, time: next.time, price: next.open, reason: 'next_open' }
        : null;
    }
  }
  return null;
}

type EntryTrigger =
  | { type: 'level'; level: number }
  | { type: 'zone'; low: number; high: number };

function entryTrigger(
  entry: ReturnType<typeof toTradePlaybookResponse>['entry'],
): EntryTrigger | null {
  if (typeof entry.level === 'number') {
    return { type: 'level', level: entry.level };
  }
  if (typeof entry.zone_low === 'number' && typeof entry.zone_high === 'number') {
    return {
      type: 'zone',
      low: Math.min(entry.zone_low, entry.zone_high),
      high: Math.max(entry.zone_low, entry.zone_high),
    };
  }
  return null;
}

function touchEntry(
  candle: MarketOhlcvCandleResponse,
  trigger: EntryTrigger,
  direction: 'long' | 'short',
): { price: number; reason: string } | null {
  if (trigger.type === 'level') {
    return candle.low <= trigger.level && candle.high >= trigger.level
      ? { price: trigger.level, reason: 'touch_level' }
      : null;
  }
  if (candle.low > trigger.high || candle.high < trigger.low) {
    return null;
  }
  if (candle.open >= trigger.low && candle.open <= trigger.high) {
    return { price: candle.open, reason: 'touch_zone_open' };
  }
  return {
    price: direction === 'short' ? trigger.low : trigger.high,
    reason: 'touch_zone',
  };
}

function gapsThrough(
  candle: MarketOhlcvCandleResponse,
  trigger: EntryTrigger,
  direction: 'long' | 'short',
): boolean {
  if (trigger.type === 'level') {
    return direction === 'short'
      ? candle.open < trigger.level && candle.high < trigger.level
      : candle.open > trigger.level && candle.low > trigger.level;
  }
  return direction === 'short'
    ? candle.open < trigger.low && candle.high < trigger.low
    : candle.open > trigger.high && candle.low > trigger.high;
}

function closesThrough(
  candle: MarketOhlcvCandleResponse,
  trigger: EntryTrigger,
  direction: 'long' | 'short',
): boolean {
  if (trigger.type === 'level') {
    return direction === 'short'
      ? candle.close <= trigger.level
      : candle.close >= trigger.level;
  }
  const closesInsideZone = candle.close >= trigger.low && candle.close <= trigger.high;
  return closesInsideZone || (
    direction === 'short'
      ? candle.close < trigger.low
      : candle.close > trigger.high
  );
}

function exposureFraction(assumptions: BacktestAssumptionSetResponse): number {
  if (assumptions.sizing_policy === 'fixed_fraction') {
    const riskFraction = assumptions.risk_fraction ?? 1;
    return Math.max(0, Math.min(1, riskFraction));
  }
  return 1;
}

function fillPolicy(value: unknown): BacktestAssumptionSetResponse['fill_policy'] {
  if (value === 'close_confirmed' || value === 'next_open') {
    return value;
  }
  return 'touch';
}

function sizingPolicy(value: unknown): BacktestAssumptionSetResponse['sizing_policy'] {
  return value === 'fixed_fraction' ? 'fixed_fraction' : 'fixed_notional';
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundPct(value: number): number {
  return Math.round(value * 10_000) / 100;
}
