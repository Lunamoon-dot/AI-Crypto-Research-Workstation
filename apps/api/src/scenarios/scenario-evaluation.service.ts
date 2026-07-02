import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
  ScenarioEvaluationResponse,
} from './scenario-evaluation.types';
import {
  toScenarioEvaluationResponse,
  toScenarioResponse,
} from '../contracts/frontend-contract';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { WorkspacesService } from '../workspaces/workspaces.service';

type ScenarioWithThesis = {
  scenario: JsonRecord;
  thesis: JsonRecord;
};
type ResolvedEvaluationWindow = {
  starts_at: string | null;
  ends_at: string | null;
  horizon: string;
  metric_hint: string | null;
};

@Injectable()
export class ScenarioEvaluationService {
  private ohlcvForTest: MarketOhlcvCandleResponse[] | null = null;

  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly ohlcv: MarketOhlcvService,
  ) {}

  get journalForTest(): JournalRepository {
    return this.journal;
  }

  setOhlcvForTest(candles: MarketOhlcvCandleResponse[]): void {
    this.ohlcvForTest = candles;
  }

  async evaluateScenario(
    scenarioId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioEvaluationResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    const { scenario, thesis } = await this.findScenario(scenarioId, workspaceId);
    const response = toScenarioResponse(scenario, thesis);
    const recommendation = response.scenario_recommendation;
    const window = resolveEvaluationWindow(response, scenario, thesis);
    const trigger = firstCondition(
      recommendation?.required_conditions,
      response.decision_playbook?.entry_conditions,
      response.trigger_spec ? [response.trigger_spec] : [],
    );
    const invalidation = firstCondition(
      recommendation?.invalidation_conditions,
      response.decision_playbook?.invalidation_conditions,
    );
    const warnings: string[] = [];
    const windowEnd = nullableString(window.ends_at);
    if (windowEnd) {
      const windowEndMs = Date.parse(windowEnd);
      if (Number.isFinite(windowEndMs) && windowEndMs > Date.now()) {
        throw new BadRequestException('Scenario evaluation window has not matured.');
      }
    }
    if (!window.starts_at || !window.ends_at) {
      warnings.push('missing_evaluation_window');
      return this.persistEvaluation({
        workspaceId,
        scenarioId,
        thesis,
        response,
        evaluationWindow: window,
        result: 'inconclusive',
        dataQuality: 'insufficient',
        warnings,
        triggerHit: null,
        invalidationHit: null,
        targetHit: null,
        candles: [],
        evidence: withReliabilityMetadata(
          { reason: 'missing_evaluation_window' },
          response,
          thesis,
        ),
      });
    }

    if (!trigger || !invalidation) {
      if (!trigger) warnings.push('missing_trigger');
      if (!invalidation) warnings.push('missing_invalidation');
      return this.persistEvaluation({
        workspaceId,
        scenarioId,
        thesis,
        response,
        evaluationWindow: window,
        result: 'inconclusive',
        dataQuality: 'insufficient',
        warnings,
        triggerHit: null,
        invalidationHit: null,
        targetHit: null,
        candles: [],
        evidence: withReliabilityMetadata(
          { reason: 'missing_evaluation_structure' },
          response,
          thesis,
        ),
      });
    }

    const candles = await this.loadCandles({
      workspaceId,
      symbol: responseSymbol(response, thesis),
      marketType: marketType(thesis.market_type ?? response.payload.market_type),
      from: window.starts_at,
      to: window.ends_at,
    });

    if (candles.length === 0) {
      warnings.push('missing_ohlcv');
      return this.persistEvaluation({
        workspaceId,
        scenarioId,
        thesis,
        response,
        evaluationWindow: window,
        result: 'inconclusive',
        dataQuality: 'insufficient',
        warnings,
        triggerHit: null,
        invalidationHit: null,
        targetHit: null,
        candles,
        evidence: withReliabilityMetadata({ reason: 'missing_ohlcv' }, response, thesis),
      });
    }

    const triggerHit = firstConditionHit(candles, trigger);
    const invalidationHit = firstConditionHit(candles, invalidation);
    const result = evaluationResult(triggerHit?.timeMs ?? null, invalidationHit?.timeMs ?? null);
    return this.persistEvaluation({
      workspaceId,
      scenarioId,
      thesis,
      response,
      evaluationWindow: window,
      result,
      dataQuality: 'complete',
      warnings,
      triggerHit: Boolean(triggerHit),
      invalidationHit: Boolean(invalidationHit),
      targetHit: null,
      candles,
      evidence: withReliabilityMetadata(
        {
          trigger_condition: trigger,
          invalidation_condition: invalidation,
          trigger_hit_at: triggerHit?.time ?? null,
          invalidation_hit_at: invalidationHit?.time ?? null,
        },
        response,
        thesis,
      ),
    });
  }

  async listForScenario(
    scenarioId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioEvaluationResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    return (await optionalScenarioLifecycleRows(() =>
      this.journal.listScenarioEvaluations(scenarioId, workspaceId),
    )).map(toScenarioEvaluationResponse);
  }

  async getEvaluation(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioEvaluationResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    const evaluation = await this.journal.getScenarioEvaluation(id, workspaceId);
    if (!evaluation) {
      throw new NotFoundException(`Scenario evaluation ${id} not found`);
    }
    return toScenarioEvaluationResponse(evaluation);
  }

  private async persistEvaluation(input: {
    workspaceId: string;
    scenarioId: string;
    thesis: JsonRecord;
    response: ReturnType<typeof toScenarioResponse>;
    evaluationWindow: ResolvedEvaluationWindow;
    result: ScenarioEvaluationResponse['result'];
    dataQuality: ScenarioEvaluationResponse['data_quality'];
    warnings: string[];
    triggerHit: boolean | null;
    invalidationHit: boolean | null;
    targetHit: boolean | null;
    candles: MarketOhlcvCandleResponse[];
    evidence: JsonRecord;
  }): Promise<ScenarioEvaluationResponse> {
    const prices = candleStats(input.candles);
    const id = deterministicScenarioEvaluationId(input);
    const saved = await this.journal.saveScenarioEvaluation(
      {
        version: 'scenario_evaluation.v1',
        id,
        workspace_id: input.workspaceId,
        scenario_id: input.scenarioId,
        thesis_id: input.response.thesis_id,
        research_run_id: nullableString(input.thesis.research_run_id),
        symbol: responseSymbol(input.response, input.thesis),
        market_type: marketType(input.thesis.market_type ?? input.response.payload.market_type),
        horizon: input.response.horizon,
        evaluated_at: new Date().toISOString(),
        evaluation_window: {
          starts_at: input.evaluationWindow.starts_at,
          ends_at: input.evaluationWindow.ends_at,
        },
        result: input.result,
        trigger_hit: input.triggerHit,
        invalidation_hit: input.invalidationHit,
        target_hit: input.targetHit,
        start_price: prices.start,
        end_price: prices.end,
        max_favorable_excursion: prices.mfe,
        max_adverse_excursion: prices.mae,
        data_quality: input.dataQuality,
        warnings: input.warnings,
        evidence: input.evidence,
      },
      input.workspaceId,
    );
    return toScenarioEvaluationResponse(saved);
  }

  private async loadCandles(input: {
    workspaceId: string;
    symbol: string;
    marketType: 'spot' | 'perp';
    from: string | null;
    to: string | null;
  }): Promise<MarketOhlcvCandleResponse[]> {
    if (this.ohlcvForTest) {
      return this.ohlcvForTest;
    }
    const response = await this.ohlcv.getOhlcv({
      workspaceId: input.workspaceId,
      symbol: input.symbol,
      marketType: input.marketType,
      interval: '1d',
      from: input.from ?? undefined,
      to: input.to ?? undefined,
      limit: '1000',
    });
    return response.candles;
  }

  private async findScenario(
    scenarioId: string,
    workspaceId: string,
  ): Promise<ScenarioWithThesis> {
    const direct = await this.journal.getScenario(scenarioId, workspaceId);
    if (direct) {
      const thesis = await this.journal.getThesis(String(direct.thesis_id ?? ''), workspaceId);
      if (thesis) {
        return { scenario: direct, thesis };
      }
    }
    const theses = await this.journal.listTheses(1000, workspaceId);
    for (const thesis of theses) {
      const thesisId = nullableString(thesis.id);
      if (!thesisId) continue;
      const scenarios = await this.journal.listScenarios(thesisId, workspaceId);
      const scenario = scenarios.find((item) => item.id === scenarioId);
      if (scenario) {
        return { scenario, thesis };
      }
    }
    throw new NotFoundException(`Scenario ${scenarioId} not found`);
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

function firstCondition(...groups: Array<unknown[] | undefined>): JsonRecord | null {
  for (const group of groups) {
    for (const item of group ?? []) {
      const record = recordValue(item);
      if (record.type) {
        return record;
      }
    }
  }
  return null;
}

function firstConditionHit(
  candles: MarketOhlcvCandleResponse[],
  condition: JsonRecord,
): { time: string; timeMs: number } | null {
  for (const candle of candles) {
    if (conditionMatches(candle, condition)) {
      return { time: candle.time, timeMs: Date.parse(candle.time) };
    }
  }
  return null;
}

function conditionMatches(
  candle: MarketOhlcvCandleResponse,
  condition: JsonRecord,
): boolean {
  const type = String(condition.type ?? '');
  const level = numberOrNull(condition.level);
  if ((type === 'price_above' || type === 'price_reclaim_level') && level !== null) {
    return candle.high >= level;
  }
  if ((type === 'price_below' || type === 'price_reject_level') && level !== null) {
    return candle.low <= level;
  }
  if (type === 'price_in_zone') {
    const zoneLow = numberOrNull(condition.zone_low);
    const zoneHigh = numberOrNull(condition.zone_high);
    return zoneLow !== null && zoneHigh !== null && candle.high >= zoneLow && candle.low <= zoneHigh;
  }
  return false;
}

function evaluationResult(
  triggerMs: number | null,
  invalidationMs: number | null,
): ScenarioEvaluationResponse['result'] {
  if (invalidationMs !== null && (triggerMs === null || invalidationMs < triggerMs)) {
    return 'invalidated';
  }
  if (triggerMs !== null && invalidationMs !== null && invalidationMs > triggerMs) {
    return 'mixed';
  }
  if (triggerMs !== null) {
    return 'hit';
  }
  return 'missed';
}

function candleStats(candles: MarketOhlcvCandleResponse[]): {
  start: number | null;
  end: number | null;
  mfe: number | null;
  mae: number | null;
} {
  if (candles.length === 0) {
    return { start: null, end: null, mfe: null, mae: null };
  }
  const start = candles[0]?.open ?? null;
  const end = candles.at(-1)?.close ?? null;
  if (start === null || start === 0) {
    return { start, end, mfe: null, mae: null };
  }
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  return {
    start,
    end,
    mfe: roundRatio((high - start) / start),
    mae: roundRatio((start - low) / start),
  };
}

function responseSymbol(
  scenario: ReturnType<typeof toScenarioResponse>,
  thesis: JsonRecord,
): string {
  return String(thesis.symbol ?? scenario.payload.symbol ?? 'BTC/USDT');
}

function marketType(value: unknown): 'spot' | 'perp' {
  return value === 'perp' ? 'perp' : 'spot';
}

function withReliabilityMetadata(
  evidence: JsonRecord,
  response: ReturnType<typeof toScenarioResponse>,
  thesis: JsonRecord,
): JsonRecord {
  return {
    ...evidence,
    relation_to_thesis: response.relation_to_thesis,
    action_bias: response.scenario_recommendation?.action_bias ?? 'unknown',
    setup_type: nullableString(thesis.setup_type ?? response.payload.setup_type),
  };
}

function deterministicScenarioEvaluationId(input: {
  workspaceId: string;
  scenarioId: string;
  response: ReturnType<typeof toScenarioResponse>;
  evaluationWindow: ResolvedEvaluationWindow;
}): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      workspace_id: input.workspaceId,
      scenario_id: input.scenarioId,
      starts_at: input.evaluationWindow.starts_at,
      ends_at: input.evaluationWindow.ends_at,
      horizon: input.evaluationWindow.horizon,
      metric_hint: input.evaluationWindow.metric_hint,
    }))
    .digest('hex')
    .slice(0, 32);
  return `scenario_eval_${hash}`;
}

function resolveEvaluationWindow(
  response: ReturnType<typeof toScenarioResponse>,
  scenario: JsonRecord,
  thesis: JsonRecord,
): ResolvedEvaluationWindow {
  const rawWindow = response.scenario_recommendation?.evaluation_window;
  const horizon = nullableString(rawWindow?.horizon) ?? response.horizon;
  const startsAt =
    isoStringOrNull(rawWindow?.starts_at) ??
    isoStringOrNull(scenario.created_at) ??
    isoStringOrNull(thesis.created_at) ??
    isoStringOrNull(response.scenario_recommendation?.generated_at);
  const endsAt =
    isoStringOrNull(rawWindow?.ends_at) ??
    addDurationIso(startsAt, evaluationWindowDurationMs(horizon));
  return {
    starts_at: startsAt,
    ends_at: endsAt,
    horizon,
    metric_hint: nullableString(rawWindow?.metric_hint),
  };
}

function evaluationWindowDurationMs(horizon: string): number {
  if (horizon === 'mid_term') {
    return 14 * 24 * 60 * 60_000;
  }
  if (horizon === 'long_term') {
    return 30 * 24 * 60 * 60_000;
  }
  if (horizon === 'short_term') {
    return 3 * 24 * 60 * 60_000;
  }
  return 7 * 24 * 60 * 60_000;
}

function addDurationIso(value: string | null, durationMs: number): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed + durationMs).toISOString()
    : null;
}

function isoStringOrNull(value: unknown): string | null {
  const raw = nullableString(value);
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
