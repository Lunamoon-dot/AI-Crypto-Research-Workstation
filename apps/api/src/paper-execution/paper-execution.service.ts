import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
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
import { toTradePlaybookResponse } from '../contracts/frontend-contract';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import { tradePlaybookRequiresSequencedSetup } from '../scenarios/sequenced-setup-guard';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type {
  CloseSimulationRequest,
  CreateSimulationRequest,
  DecimalString,
  DiagnosisCode,
  ExecutionEventResponse,
  ExecutionEventType,
  MarketDataSnapshot,
  PaperOrderResponse,
  PaperPositionCloseReason,
  PaperPositionResponse,
  ReliabilitySampleKind,
  SimulationAssumptions,
  SimulationDetailResponse,
  SimulationMode,
  SimulationOutcomeResponse,
  SimulationRunResponse,
  SimulationRunStatus,
  SimulationSampleIdentity,
} from './paper-execution.types';

const DECIMAL_SCALE_DIGITS = 10;
const DECIMAL_SCALE = 10n ** BigInt(DECIMAL_SCALE_DIGITS);
const BASIS_POINTS = 10_000n;
const FLAT_MULTI_STAGE_PLAYBOOK_REJECTION =
  'Simulation requires a sequenced setup for this multi-stage playbook.';
const BASIS_POINTS_SCALE = BASIS_POINTS * DECIMAL_SCALE;

@Injectable()
export class PaperExecutionService {
  private ohlcvForTest: MarketOhlcvCandleResponse[] | null = null;
  private readonly simulationLocks = new Map<string, Promise<void>>();

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

  async createSimulation(
    playbookId: string,
    request: CreateSimulationRequest = {},
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SimulationDetailResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    const rawPlaybook = await this.journal.getTradePlaybook(playbookId, workspaceId);
    if (!rawPlaybook) {
      throw new NotFoundException(`Playbook ${playbookId} not found`);
    }
    const playbook = toTradePlaybookResponse(rawPlaybook);
    validateSimulationPlaybook(playbook);
    assertNoRiskFraction(request);

    const mode = simulationMode(request.mode);
    validateSimulationTiming(mode, request);
    const sampleKind = sampleKindValue(request.sample_kind, mode);
    validateSampleKindForMode(mode, sampleKind);
    const assumptions = normalizeAssumptions(request, playbook);
    const assumptionsHash = stableHash(assumptions);
    const existingActiveForward = mode === 'forward'
      ? await this.findActiveForwardRun(playbook.id, assumptionsHash, workspaceId)
      : null;
    if (existingActiveForward) {
      throw new ConflictException(
        'An active forward simulation already exists for this playbook and assumptions.',
      );
    }

    const now = new Date().toISOString();
    const id = `simulation_${randomUUID().replaceAll('-', '')}`;
    const sourceHashes = sourceHashesFromPlaybook(playbook);
    let marketDataSnapshot = buildMarketDataSnapshot(playbook, request);
    if (mode === 'replay') {
      const replayCandles = await this.assertReplayMarketDataAvailable(
        playbook,
        marketDataSnapshot,
        workspaceId,
      );
      marketDataSnapshot = withReplayDatasetSnapshot(
        marketDataSnapshot,
        replayCandles,
      );
    }
    const analysisSnapshot = await this.buildAnalysisSnapshot(
      playbook,
      sourceHashes,
      workspaceId,
    );
    if (tradePlaybookRequiresSequencedSetup(playbook, analysisSnapshot.decision_playbook)) {
      throw new BadRequestException(FLAT_MULTI_STAGE_PLAYBOOK_REJECTION);
    }
    const sampleIdentity = sampleIdentityFrom({
      sourceHashes,
      marketDataSnapshot,
      assumptionsHash,
      evaluationWindow: {
        starts_at: request.starts_at ?? marketDataSnapshot.starts_at,
        ends_at: request.ends_at ?? marketDataSnapshot.ends_at,
        horizon: playbook.horizon,
      },
    });
    const run: SimulationRunResponse = {
      version: 'simulation_run.v1',
      id,
      workspace_id: workspaceId,
      source_scenario_id: playbook.source_scenario_id,
      source_thesis_id: playbook.source_thesis_id,
      source_playbook_id: playbook.id,
      symbol: playbook.symbol,
      market_type: playbook.market_type,
      mode,
      sample_kind: sampleKind,
      status: 'waiting_for_trigger',
      status_reason: 'waiting_for_entry_trigger',
      aggregate_version: 0,
      started_at: now,
      completed_at: null,
      cancelled_at: null,
      failure_reason: null,
      market_time: null,
      last_processed_candle_id: null,
      assumptions_hash: assumptionsHash,
      setup_expiry_at: assumptions.setup_expiry_at,
      position_max_duration_minutes: assumptions.position_max_duration_minutes,
      evaluation_window: {
        starts_at: marketDataSnapshot.starts_at,
        ends_at: marketDataSnapshot.ends_at,
        horizon: playbook.horizon,
      },
      playbook_snapshot: playbook,
      analysis_snapshot: analysisSnapshot,
      assumptions,
      market_data_snapshot: marketDataSnapshot,
      sample_identity: sampleIdentity,
      source_integrity_status: 'verified',
      source_drift_after_start: false,
      source_hashes: sourceHashes,
    };

    const persisted = await this.withRepositorySimulationLock(id, workspaceId, async () => {
      await this.journal.saveSimulationRun(jsonRecord(run), workspaceId);
      await this.journal.appendExecutionEvents(
        id,
        jsonRecords([
          buildEvent(run, {
            event_type: 'simulation_started',
            sequence: 1,
            reason_code: 'simulation_created',
          }),
          buildEvent(run, {
            event_type: 'playbook_snapshot_frozen',
            sequence: 2,
            reason_code: 'playbook_snapshot_frozen',
            payload: { source_hashes: sourceHashes },
          }),
        ]),
        workspaceId,
      );
      return this.saveRun({ ...run, aggregate_version: 2 }, workspaceId);
    });
    if (mode === 'replay') {
      return this.refreshSimulation(persisted.id, userId, workspaceHeader);
    }
    return this.detailFromRun(persisted, workspaceId);
  }

  private async buildAnalysisSnapshot(
    playbook: TradePlaybookResponse,
    sourceHashes: SimulationRunResponse['source_hashes'],
    workspaceId: string,
  ): Promise<SimulationRunResponse['analysis_snapshot']> {
    const [sourceScenario, sourceThesis] = await Promise.all([
      this.journal.getScenario(playbook.source_scenario_id, workspaceId),
      this.journal.getThesis(playbook.source_thesis_id, workspaceId),
    ]);
    const scenario = cloneJsonRecord(
      sourceScenario ?? { id: playbook.source_scenario_id },
    );
    const thesis = cloneJsonRecord(
      sourceThesis ?? { id: playbook.source_thesis_id },
    );
    const scenarioPayload = recordValue(scenario.payload);

    return {
      scenario,
      thesis,
      scenario_recommendation: cloneJsonRecordOrNull(
        scenario.scenario_recommendation ?? scenarioPayload.scenario_recommendation,
      ),
      decision_playbook: cloneJsonRecordOrNull(
        scenario.decision_playbook ?? scenarioPayload.decision_playbook,
      ),
      chart_source_versions: {
        source_scenario_id: playbook.source_scenario_id,
        source_thesis_id: playbook.source_thesis_id,
        source_playbook_id: playbook.id,
        source_hashes: cloneJsonRecord(sourceHashes),
      },
    };
  }

  async listForPlaybook(
    playbookId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SimulationRunResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    return (await this.journal.listSimulationRunsForPlaybook(playbookId, workspaceId))
      .map(toSimulationRunResponse);
  }

  async getSimulation(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SimulationDetailResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    const run = await this.getRunOrThrow(id, workspaceId);
    return this.detailFromRun(run, workspaceId);
  }

  async refreshSimulation(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SimulationDetailResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    return this.withSimulationLock(id, () =>
      this.withRepositorySimulationLock(id, workspaceId, () =>
        this.refreshSimulationLocked(id, workspaceId)
          .catch((error: unknown) =>
            this.handleRefreshFailure(id, workspaceId, error))));
  }

  private async refreshSimulationLocked(
    id: string,
    workspaceId: string,
  ): Promise<SimulationDetailResponse> {
    const run = await this.getRunOrThrow(id, workspaceId);
    if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
      return this.detailFromRun(run, workspaceId);
    }

    const existingPosition = await this.journal.getPaperPositionForSimulation(id, workspaceId);
    if (existingPosition) {
      return this.refreshOpenPosition(run, existingPosition, workspaceId);
    }

    const candles = await this.loadCandles(run);
    if (candles.length === 0) {
      const failed = await this.failRun(run, 'missing_ohlcv', workspaceId);
      return this.detailFromRun(failed, workspaceId);
    }

    const trigger = entryTrigger(run.playbook_snapshot.entry);
    if (!trigger) {
      const failed = await this.failRun(run, 'missing_numeric_entry', workspaceId);
      return this.detailFromRun(failed, workspaceId);
    }
    const entryWindow = entryWindowForSetupExpiry(candles, run.assumptions.setup_expiry_at);
    const entry = findEntry(
      entryWindow.eligible,
      trigger,
      run.playbook_snapshot.direction,
      run.assumptions,
    );
    if (!entry) {
      const finalCandle = candles[candles.length - 1]!;
      if (entryWindow.expiryCandle) {
        const completed = await this.completeMissedRun(run, entryWindow.expiryCandle, workspaceId);
        return this.detailFromRun(completed, workspaceId);
      }
      if (run.mode === 'replay') {
        const completed = await this.completeNoEntryDataEndRun(run, finalCandle, workspaceId);
        return this.detailFromRun(completed, workspaceId);
      }
      const waiting = await this.saveRun(
        {
          ...run,
          market_time: finalCandle.time,
          last_processed_candle_id: candleId(finalCandle),
          status: 'waiting_for_trigger',
          status_reason: 'waiting_for_entry_trigger',
        },
        workspaceId,
      );
      return this.detailFromRun(waiting, workspaceId);
    }

    const entryOrder = buildEntryOrder(run, entry);
    const position = buildOpenPosition(run, entry, entryOrder);
    const afterEntry = candles.slice(entry.index + 1);
    const transitions = findPositionTransitions(
      afterEntry,
      run.playbook_snapshot,
      run.assumptions,
      entry.price,
      entry.candle.time,
      true,
    );
    const events = await this.nextEvents(run.id, workspaceId);
    const createdEvents: ExecutionEventResponse[] = [
      events.build({
        event_type: 'entry_zone_entered',
        market_time: entry.candle.time,
        price: decimal(entry.price),
        reason_code: entry.reason,
        source_candle_id: candleId(entry.candle),
      }),
      events.build({
        event_type: 'entry_condition_confirmed',
        market_time: entry.candle.time,
        price: decimal(entry.price),
        reason_code: entry.reason,
        source_candle_id: candleId(entry.candle),
      }),
      events.build({
        event_type: 'paper_order_created',
        order_id: entryOrder.id,
        market_time: entry.candle.time,
        price: entryOrder.requested_price,
        quantity: entryOrder.quantity,
        reason_code: 'entry_order_created',
        source_candle_id: candleId(entry.candle),
        payload: { fee: entryOrder.fee },
      }),
      events.build({
        event_type: 'paper_order_filled',
        order_id: entryOrder.id,
        market_time: entry.candle.time,
        price: entryOrder.filled_price,
        quantity: entryOrder.quantity,
        reason_code: 'entry_order_filled',
        source_candle_id: candleId(entry.candle),
        payload: { fee: entryOrder.fee },
      }),
      events.build({
        event_type: 'position_opened',
        order_id: entryOrder.id,
        position_id: position.id,
        market_time: entry.candle.time,
        price: position.average_entry_price,
        quantity: position.quantity_opened,
        reason_code: 'entry_filled',
        source_candle_id: candleId(entry.candle),
        payload: { fee: entryOrder.fee },
      }),
    ];

    await this.journal.savePaperOrder(jsonRecord(entryOrder), workspaceId);
    const applied = await this.applyPositionTransitions(
      run,
      position,
      transitions,
      events,
      createdEvents,
      workspaceId,
    );
    if (applied.finalExit) {
      const outcome = buildOutcome(run, applied.position, applied.finalExit);
      await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
      createdEvents.push(
        events.build({
          event_type: 'simulation_completed',
          market_time: applied.finalExit.candle.time,
          reason_code: applied.finalExit.reason,
          source_candle_id: candleId(applied.finalExit.candle),
        }),
        events.build({
          event_type: 'evaluation_completed',
          market_time: applied.finalExit.candle.time,
          reason_code: 'rule_based_execution_outcome',
          source_candle_id: candleId(applied.finalExit.candle),
          payload: { outcome_id: outcome.id },
        }),
      );
      await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
      const completed = await this.saveRun(
        {
          ...run,
          status: 'completed',
          status_reason: applied.finalExit.reason,
          aggregate_version: events.lastSequence(),
          market_time: applied.finalExit.candle.time,
          last_processed_candle_id: candleId(applied.finalExit.candle),
          completed_at: new Date().toISOString(),
        },
        workspaceId,
      );
      return this.detailFromRun(completed, workspaceId);
    }

    await this.journal.savePaperPosition(jsonRecord(applied.position), workspaceId);
    if (run.mode === 'replay') {
      const final = candles[candles.length - 1]!;
      const outcome = buildDataEndOutcome(run, applied.position);
      await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
      createdEvents.push(
        events.build({
          event_type: 'data_end_reached',
          position_id: applied.position.id,
          market_time: final.time,
          price: decimal(final.close),
          quantity: applied.position.quantity_remaining,
          reason_code: 'data_end_reached',
          source_candle_id: candleId(final),
        }),
        events.build({
          event_type: 'simulation_completed',
          position_id: applied.position.id,
          market_time: final.time,
          reason_code: 'data_end_reached',
          source_candle_id: candleId(final),
        }),
        events.build({
          event_type: 'evaluation_completed',
          position_id: applied.position.id,
          market_time: final.time,
          reason_code: 'insufficient_future_data',
          source_candle_id: candleId(final),
          payload: { outcome_id: outcome.id },
        }),
      );
      await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
      const completed = await this.saveRun(
        {
          ...run,
          status: 'completed',
          status_reason: 'data_end_reached',
          aggregate_version: events.lastSequence(),
          market_time: final.time,
          last_processed_candle_id: candleId(final),
          completed_at: new Date().toISOString(),
        },
        workspaceId,
      );
      return this.detailFromRun(completed, workspaceId);
    }

    await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
    const open = await this.saveRun(
      {
        ...run,
        status: 'position_open',
        status_reason: applied.position.status === 'partially_closed'
          ? 'partial_target_filled'
          : 'entry_filled',
        aggregate_version: events.lastSequence(),
        market_time: applied.lastMarketTime ?? entry.candle.time,
        last_processed_candle_id: applied.lastProcessedCandleId ?? candleId(entry.candle),
      },
      workspaceId,
    );
    return this.detailFromRun(open, workspaceId);
  }

  async cancelSimulation(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SimulationDetailResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    return this.withSimulationLock(id, () =>
      this.withRepositorySimulationLock(id, workspaceId, () =>
        this.cancelSimulationLocked(id, workspaceId)));
  }

  private async cancelSimulationLocked(
    id: string,
    workspaceId: string,
  ): Promise<SimulationDetailResponse> {
    const run = await this.getRunOrThrow(id, workspaceId);
    const position = await this.journal.getPaperPositionForSimulation(id, workspaceId);
    if (position && String(position.status) !== 'closed') {
      throw new BadRequestException(
        'Open paper positions require an explicit close policy before cancellation.',
      );
    }
    const events = await this.nextEvents(run.id, workspaceId);
    const event = events.build({
      event_type: 'simulation_cancelled',
      reason_code: 'manual_cancel',
    });
    await this.journal.appendExecutionEvents(run.id, jsonRecords([event]), workspaceId);
    const cancelled = await this.saveRun(
      {
        ...run,
        status: 'cancelled',
        status_reason: 'manual_cancel',
        aggregate_version: event.sequence,
        cancelled_at: new Date().toISOString(),
      },
      workspaceId,
    );
    return this.detailFromRun(cancelled, workspaceId);
  }

  async closeSimulation(
    id: string,
    request: CloseSimulationRequest,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SimulationDetailResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    return this.withSimulationLock(id, () =>
      this.withRepositorySimulationLock(id, workspaceId, () =>
        this.closeSimulationLocked(id, request, workspaceId)));
  }

  private async closeSimulationLocked(
    id: string,
    request: CloseSimulationRequest,
    workspaceId: string,
  ): Promise<SimulationDetailResponse> {
    const run = await this.getRunOrThrow(id, workspaceId);
    if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
      return this.detailFromRun(run, workspaceId);
    }
    const position = await this.journal.getPaperPositionForSimulation(id, workspaceId);
    if (!position || String(position.status) === 'closed') {
      throw new BadRequestException('Simulation has no open paper position to close.');
    }
    const policy = closePolicyValue(request);
    if (policy === 'abandon_inconclusive') {
      return this.abandonOpenPosition(run, request, workspaceId);
    }

    const openPosition = toPaperPositionResponse(position);
    const exit = await this.manualCloseExit(run, request);
    const events = await this.nextEvents(run.id, workspaceId);
    const exitOrder = buildExitOrder(run, openPosition, exit);
    const filledExit = exitFromOrder(exit, exitOrder);
    const closedPosition = closePosition(openPosition, filledExit, run.assumptions);
    await this.journal.savePaperOrder(jsonRecord(exitOrder), workspaceId);
    await this.journal.savePaperPosition(jsonRecord(closedPosition), workspaceId);
    const outcome = buildManualCloseOutcome(run, closedPosition);
    await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
    const createdEvents = [
      events.build({
        event_type: 'paper_order_created',
        order_id: exitOrder.id,
        position_id: closedPosition.id,
        market_time: exit.candle.time,
        price: exitOrder.requested_price,
        quantity: exitOrder.quantity,
        reason_code: 'manual_close_order_created',
        source_candle_id: candleId(exit.candle),
        payload: { reason: request.reason ?? null, fee: exitOrder.fee },
      }),
      events.build({
        event_type: 'paper_order_filled',
        order_id: exitOrder.id,
        position_id: closedPosition.id,
        market_time: exit.candle.time,
        price: exitOrder.filled_price,
        quantity: exitOrder.quantity,
        reason_code: 'manual_close_order_filled',
        source_candle_id: candleId(exit.candle),
        payload: { reason: request.reason ?? null, fee: exitOrder.fee },
      }),
      events.build({
        event_type: 'position_closed',
        order_id: exitOrder.id,
        position_id: closedPosition.id,
        market_time: exit.candle.time,
        price: exitOrder.filled_price,
        quantity: exitOrder.quantity,
        reason_code: 'manual_close',
        source_candle_id: candleId(exit.candle),
        payload: { reason: request.reason ?? null, fee: exitOrder.fee },
      }),
      events.build({
        event_type: 'simulation_completed',
        position_id: closedPosition.id,
        market_time: exit.candle.time,
        reason_code: 'manual_close',
        source_candle_id: candleId(exit.candle),
      }),
      events.build({
        event_type: 'evaluation_completed',
        position_id: closedPosition.id,
        market_time: exit.candle.time,
        reason_code: 'manual_close_not_reliability_eligible',
        source_candle_id: candleId(exit.candle),
        payload: { outcome_id: outcome.id },
      }),
    ];
    await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
    const completed = await this.saveRun(
      {
        ...run,
        status: 'completed',
        status_reason: 'manual_close',
        aggregate_version: events.lastSequence(),
        market_time: exit.candle.time,
        last_processed_candle_id: candleId(exit.candle),
        completed_at: new Date().toISOString(),
      },
      workspaceId,
    );
    return this.detailFromRun(completed, workspaceId);
  }

  async listEvents(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ExecutionEventResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    await this.getRunOrThrow(id, workspaceId);
    return (await this.journal.listExecutionEvents(id, workspaceId))
      .map(toExecutionEventResponse);
  }

  async listOrders(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PaperOrderResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    await this.getRunOrThrow(id, workspaceId);
    return (await this.journal.listPaperOrdersForSimulation(id, workspaceId))
      .map(toPaperOrderResponse);
  }

  async getPosition(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PaperPositionResponse | null> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    await this.getRunOrThrow(id, workspaceId);
    const position = await this.journal.getPaperPositionForSimulation(id, workspaceId);
    return position ? toPaperPositionResponse(position) : null;
  }

  async getOutcome(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SimulationOutcomeResponse | null> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    await this.getRunOrThrow(id, workspaceId);
    const outcome = await this.journal.getSimulationOutcome(id, workspaceId);
    return outcome ? toSimulationOutcomeResponse(outcome) : null;
  }

  private async refreshOpenPosition(
    run: SimulationRunResponse,
    rawPosition: JsonRecord,
    workspaceId: string,
  ): Promise<SimulationDetailResponse> {
    const position = toPaperPositionResponse(rawPosition);
    if (position.status === 'closed') {
      return this.detailFromRun(run, workspaceId);
    }
    const candles = candlesAfterWatermark(
      await this.loadCandles(run),
      run.last_processed_candle_id ?? position.opened_at_market_time,
    );
    const entryPrice = Number(position.average_entry_price ?? '0');
    const transitions = findPositionTransitions(
      candles,
      run.playbook_snapshot,
      run.assumptions,
      entryPrice,
      position.opened_at_market_time,
      position.status === 'open',
    );
    if (transitions.length === 0) {
      const final = candles[candles.length - 1];
      if (!final) {
        return this.detailFromRun(run, workspaceId);
      }
      const updated = await this.saveRun(
        {
          ...run,
          market_time: final.time,
          last_processed_candle_id: candleId(final),
        },
        workspaceId,
      );
      return this.detailFromRun(updated, workspaceId);
    }
    const events = await this.nextEvents(run.id, workspaceId);
    const createdEvents: ExecutionEventResponse[] = [];
    const applied = await this.applyPositionTransitions(
      run,
      position,
      transitions,
      events,
      createdEvents,
      workspaceId,
    );
    if (!applied.finalExit) {
      await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
      const updated = await this.saveRun(
        {
          ...run,
          status: 'position_open',
          status_reason: 'partial_target_filled',
          aggregate_version: events.lastSequence(),
          market_time: applied.lastMarketTime ?? run.market_time,
          last_processed_candle_id: applied.lastProcessedCandleId ?? run.last_processed_candle_id,
        },
        workspaceId,
      );
      return this.detailFromRun(updated, workspaceId);
    }
    const outcome = buildOutcome(run, applied.position, applied.finalExit);
    await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
    createdEvents.push(
      events.build({
        event_type: 'simulation_completed',
        market_time: applied.finalExit.candle.time,
        reason_code: applied.finalExit.reason,
        source_candle_id: candleId(applied.finalExit.candle),
      }),
      events.build({
        event_type: 'evaluation_completed',
        market_time: applied.finalExit.candle.time,
        reason_code: 'rule_based_execution_outcome',
        source_candle_id: candleId(applied.finalExit.candle),
        payload: { outcome_id: outcome.id },
      }),
    );
    await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
    const completed = await this.saveRun(
      {
        ...run,
        status: 'completed',
        status_reason: applied.finalExit.reason,
        aggregate_version: events.lastSequence(),
        market_time: applied.finalExit.candle.time,
        last_processed_candle_id: candleId(applied.finalExit.candle),
        completed_at: new Date().toISOString(),
      },
      workspaceId,
    );
    return this.detailFromRun(completed, workspaceId);
  }

  private async applyPositionTransitions(
    run: SimulationRunResponse,
    initialPosition: PaperPositionResponse,
    transitions: PositionTransition[],
    events: EventBuilder,
    createdEvents: ExecutionEventResponse[],
    workspaceId: string,
  ): Promise<{
    position: PaperPositionResponse;
    finalExit: SimulationExit | null;
    lastMarketTime: string | null;
    lastProcessedCandleId: string | null;
  }> {
    let position = initialPosition;
    let finalExit: SimulationExit | null = null;
    let lastMarketTime: string | null = null;
    let lastProcessedCandleId: string | null = null;
    for (const transition of transitions) {
      const isPartial = transition.kind === 'partial_close';
      const exit = isPartial
        ? {
            ...transition.exit,
            quantity: decimalMul(
              position.quantity_remaining ?? position.quantity_opened,
              transition.closePercent,
            ),
          }
        : {
            ...transition.exit,
            quantity: transition.exit.quantity ?? position.quantity_remaining,
      };
      const exitOrder = buildExitOrder(run, position, exit);
      const filledExit = exitFromOrder(exit, exitOrder);
      const nextPosition = isPartial
        ? reducePosition(position, filledExit, run.assumptions)
        : closePosition(position, filledExit, run.assumptions);
      await this.journal.savePaperOrder(jsonRecord(exitOrder), workspaceId);
      await this.journal.savePaperPosition(jsonRecord(nextPosition), workspaceId);
      const requestedPrice = decimal(exit.price);
      const filledPrice = exitOrder.filled_price;
      const eventQuantity = exit.quantity ?? exitOrder.quantity;
      createdEvents.push(
        events.build({
          event_type: exitEventType(exit),
          position_id: nextPosition.id,
          target_index: exit.target_index ?? null,
          market_time: exit.candle.time,
          price: requestedPrice,
          quantity: eventQuantity,
          reason_code: exit.ambiguous ? 'ambiguous_intrabar' : exit.reason,
          source_candle_id: candleId(exit.candle),
          payload: exit.ambiguous ? { diagnosis_codes: ['AMBIGUOUS_INTRABAR'] } : {},
        }),
        events.build({
          event_type: 'paper_order_created',
          order_id: exitOrder.id,
          position_id: nextPosition.id,
          target_index: exit.target_index ?? null,
          market_time: exit.candle.time,
          price: exitOrder.requested_price,
          quantity: exitOrder.quantity,
          reason_code: `${exit.reason}_order_created`,
          source_candle_id: candleId(exit.candle),
          payload: { fee: exitOrder.fee },
        }),
        events.build({
          event_type: 'paper_order_filled',
          order_id: exitOrder.id,
          position_id: nextPosition.id,
          target_index: exit.target_index ?? null,
          market_time: exit.candle.time,
          price: exitOrder.filled_price,
          quantity: exitOrder.quantity,
          reason_code: `${exit.reason}_order_filled`,
          source_candle_id: candleId(exit.candle),
          payload: { fee: exitOrder.fee },
        }),
        events.build({
          event_type: isPartial ? 'position_partially_closed' : 'position_closed',
          order_id: exitOrder.id,
          position_id: nextPosition.id,
          target_index: exit.target_index ?? null,
          market_time: exit.candle.time,
          price: filledPrice,
          quantity: eventQuantity,
          reason_code: exit.ambiguous ? 'ambiguous_intrabar' : exit.reason,
          source_candle_id: candleId(exit.candle),
          payload: isPartial
            ? { close_percent: transition.closePercent, fee: exitOrder.fee }
            : finalExitPayload(filledExit),
        }),
      );
      position = nextPosition;
      lastMarketTime = exit.candle.time;
      lastProcessedCandleId = candleId(exit.candle);
      if (!isPartial) {
        finalExit = filledExit;
        break;
      }
    }
    return { position, finalExit, lastMarketTime, lastProcessedCandleId };
  }

  private async abandonOpenPosition(
    run: SimulationRunResponse,
    request: CloseSimulationRequest,
    workspaceId: string,
  ): Promise<SimulationDetailResponse> {
    const events = await this.nextEvents(run.id, workspaceId);
    const outcome = buildAbandonedOutcome(run);
    await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
    const createdEvents = [
      events.build({
        event_type: 'simulation_completed',
        market_time: request.market_time ?? run.market_time,
        reason_code: 'manual_abandon_inconclusive',
        payload: { reason: request.reason ?? null },
      }),
      events.build({
        event_type: 'evaluation_completed',
        market_time: request.market_time ?? run.market_time,
        reason_code: 'manual_abandon_not_reliability_eligible',
        payload: { outcome_id: outcome.id },
      }),
    ];
    await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
    const completed = await this.saveRun(
      {
        ...run,
        status: 'completed',
        status_reason: 'manual_abandon_inconclusive',
        aggregate_version: events.lastSequence(),
        market_time: request.market_time ?? run.market_time,
        completed_at: new Date().toISOString(),
      },
      workspaceId,
    );
    return this.detailFromRun(completed, workspaceId);
  }

  private async manualCloseExit(
    run: SimulationRunResponse,
    request: CloseSimulationRequest,
  ): Promise<{
    candle: MarketOhlcvCandleResponse;
    price: number;
    reason: PaperPositionCloseReason;
  }> {
    if (request.price !== undefined && decimalNumber(request.price) === null) {
      throw new BadRequestException('Manual close price must be numeric when provided.');
    }
    const explicitPrice = decimalNumber(request.price);
    if (explicitPrice !== null) {
      const marketTime = request.market_time ?? run.market_time ?? new Date().toISOString();
      return {
        candle: {
          time: marketTime,
          open: explicitPrice,
          high: explicitPrice,
          low: explicitPrice,
          close: explicitPrice,
          volume: null,
        },
        price: explicitPrice,
        reason: 'manual_close',
      };
    }
    const candles = await this.loadCandles(run);
    const latest = candles[candles.length - 1];
    if (!latest) {
      throw new BadRequestException(
        'Manual close requires a numeric price when no market candle is available.',
      );
    }
    const marketTime = request.market_time ?? latest.time;
    return {
      candle: { ...latest, time: marketTime },
      price: latest.close,
      reason: 'manual_close',
    };
  }

  private async completeMissedRun(
    run: SimulationRunResponse,
    candle: MarketOhlcvCandleResponse,
    workspaceId: string,
  ): Promise<SimulationRunResponse> {
    const events = await this.nextEvents(run.id, workspaceId);
    const outcome = buildMissedOutcome(run);
    await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
    const createdEvents = [
      events.build({
        event_type: 'setup_expired',
        market_time: candle.time,
        price: decimal(candle.close),
        reason_code: 'entry_missed',
        source_candle_id: candleId(candle),
      }),
      events.build({
        event_type: 'simulation_completed',
        market_time: candle.time,
        reason_code: 'setup_expiry',
        source_candle_id: candleId(candle),
      }),
      events.build({
        event_type: 'evaluation_completed',
        market_time: candle.time,
        reason_code: 'entry_missed',
        source_candle_id: candleId(candle),
        payload: { outcome_id: outcome.id },
      }),
    ];
    await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
    return this.saveRun(
      {
        ...run,
        status: 'completed',
        status_reason: 'setup_expiry',
        aggregate_version: events.lastSequence(),
        market_time: candle.time,
        last_processed_candle_id: candleId(candle),
        completed_at: new Date().toISOString(),
      },
      workspaceId,
    );
  }

  private async completeNoEntryDataEndRun(
    run: SimulationRunResponse,
    candle: MarketOhlcvCandleResponse,
    workspaceId: string,
  ): Promise<SimulationRunResponse> {
    const events = await this.nextEvents(run.id, workspaceId);
    const outcome = buildNoEntryDataEndOutcome(run);
    await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
    const createdEvents = [
      events.build({
        event_type: 'data_end_reached',
        market_time: candle.time,
        price: decimal(candle.close),
        reason_code: 'data_end_reached',
        source_candle_id: candleId(candle),
      }),
      events.build({
        event_type: 'simulation_completed',
        market_time: candle.time,
        reason_code: 'data_end_reached',
        source_candle_id: candleId(candle),
      }),
      events.build({
        event_type: 'evaluation_completed',
        market_time: candle.time,
        reason_code: 'insufficient_future_data',
        source_candle_id: candleId(candle),
        payload: { outcome_id: outcome.id },
      }),
    ];
    await this.journal.appendExecutionEvents(run.id, jsonRecords(createdEvents), workspaceId);
    return this.saveRun(
      {
        ...run,
        status: 'completed',
        status_reason: 'data_end_reached',
        aggregate_version: events.lastSequence(),
        market_time: candle.time,
        last_processed_candle_id: candleId(candle),
        completed_at: new Date().toISOString(),
      },
      workspaceId,
    );
  }

  private async failRun(
    run: SimulationRunResponse,
    reason: string,
    workspaceId: string,
  ): Promise<SimulationRunResponse> {
    const events = await this.nextEvents(run.id, workspaceId);
    const event = events.build({
      event_type: 'simulation_failed',
      reason_code: reason,
      payload: { failure_reason: reason },
    });
    const outcome = buildFailureOutcome(run, reason);
    await this.journal.saveSimulationOutcome(jsonRecord(outcome), workspaceId);
    await this.journal.appendExecutionEvents(run.id, jsonRecords([event]), workspaceId);
    return this.saveRun(
      {
        ...run,
        status: 'failed',
        status_reason: reason,
        failure_reason: reason,
        aggregate_version: event.sequence,
        completed_at: new Date().toISOString(),
      },
      workspaceId,
    );
  }

  private async handleRefreshFailure(
    id: string,
    workspaceId: string,
    error: unknown,
  ): Promise<SimulationDetailResponse> {
    if (error instanceof NotFoundException) {
      throw error;
    }
    const rawRun = await this.journal.getSimulationRun(id, workspaceId);
    if (!rawRun) {
      throw error;
    }
    const run = toSimulationRunResponse(rawRun);
    if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
      return this.detailFromRun(run, workspaceId);
    }
    const failed = await this.failRun(run, 'engine_failure', workspaceId);
    return this.detailFromRun(failed, workspaceId);
  }

  private async detailFromRun(
    run: SimulationRunResponse,
    workspaceId: string,
  ): Promise<SimulationDetailResponse> {
    const [rawOrders, rawPosition, rawOutcome, rawEvents] = await Promise.all([
      this.journal.listPaperOrdersForSimulation(run.id, workspaceId),
      this.journal.getPaperPositionForSimulation(run.id, workspaceId),
      this.journal.getSimulationOutcome(run.id, workspaceId),
      this.journal.listExecutionEvents(run.id, workspaceId),
    ]);
    const events = rawEvents.map(toExecutionEventResponse);
    const persistedOrders = rawOrders.map(toPaperOrderResponse);
    const persistedPosition = rawPosition ? toPaperPositionResponse(rawPosition) : null;
    const persistedOutcome = rawOutcome ? toSimulationOutcomeResponse(rawOutcome) : null;
    const rebuilt = rebuildProjectionFromLedger(run, events);
    const orders = persistedOrders.length > 0 ? persistedOrders : rebuilt.orders;
    const position = persistedPosition ?? rebuilt.position;
    const outcome = persistedOutcome ?? rebuilt.outcome;

    if (persistedOrders.length === 0 && rebuilt.orders.length > 0) {
      await Promise.all(
        rebuilt.orders.map((order) =>
          this.journal.savePaperOrder(jsonRecord(order), workspaceId)),
      );
    }
    if (!persistedPosition && rebuilt.position) {
      await this.journal.savePaperPosition(jsonRecord(rebuilt.position), workspaceId);
    }
    if (!persistedOutcome && rebuilt.outcome) {
      await this.journal.saveSimulationOutcome(jsonRecord(rebuilt.outcome), workspaceId);
    }
    const sourceDriftAfterStart = await this.sourceDriftAfterStart(run, workspaceId);

    return {
      ...toSimulationRunResponse(run),
      source_drift_after_start: sourceDriftAfterStart,
      orders,
      position,
      outcome,
      events,
    };
  }

  private async getRunOrThrow(
    id: string,
    workspaceId: string,
  ): Promise<SimulationRunResponse> {
    const run = await this.journal.getSimulationRun(id, workspaceId);
    if (!run) {
      throw new NotFoundException(`Simulation ${id} not found`);
    }
    return toSimulationRunResponse(run);
  }

  private async saveRun(
    run: SimulationRunResponse,
    workspaceId: string,
  ): Promise<SimulationRunResponse> {
    return toSimulationRunResponse(
      await this.journal.saveSimulationRun(jsonRecord(run), workspaceId),
    );
  }

  private async sourceDriftAfterStart(
    run: SimulationRunResponse,
    workspaceId: string,
  ): Promise<boolean> {
    const rawPlaybook = await this.journal.getTradePlaybook(
      run.source_playbook_id,
      workspaceId,
    );
    if (!rawPlaybook) {
      return true;
    }
    const current = sourceHashesFromPlaybook(toTradePlaybookResponse(rawPlaybook));
    return !sameRecord(current, run.source_hashes);
  }

  private async assertReplayMarketDataAvailable(
    playbook: TradePlaybookResponse,
    marketDataSnapshot: MarketDataSnapshot,
    workspaceId: string,
  ): Promise<MarketOhlcvCandleResponse[]> {
    const candles = await this.loadCandlesForMarketData(
      workspaceId,
      playbook.symbol,
      playbook.market_type,
      marketDataSnapshot,
    );
    if (candles.length === 0) {
      throw new BadRequestException(
        'Replay simulation requires market-data candles for the requested window.',
      );
    }
    return candles;
  }

  private async findActiveForwardRun(
    playbookId: string,
    assumptionsHash: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const runs = await this.journal.listSimulationRunsForPlaybook(playbookId, workspaceId);
    return runs.find((run) =>
      run.mode === 'forward' &&
      run.assumptions_hash === assumptionsHash &&
      ACTIVE_FORWARD_STATUSES.has(String(run.status))
    ) ?? null;
  }

  private async nextEvents(
    runId: string,
    workspaceId: string,
  ): Promise<EventBuilder> {
    const existing = await this.journal.listExecutionEvents(runId, workspaceId);
    let sequence = existing.reduce(
      (max, event) => Math.max(max, Math.trunc(Number(event.sequence ?? 0))),
      0,
    );
    const run = await this.getRunOrThrow(runId, workspaceId);
    return {
      build: (input) => {
        sequence += 1;
        return buildEvent(run, { ...input, sequence });
      },
      lastSequence: () => sequence,
    };
  }

  private async loadCandles(
    run: SimulationRunResponse,
  ): Promise<MarketOhlcvCandleResponse[]> {
    return this.loadCandlesForMarketData(
      run.workspace_id,
      run.symbol,
      run.market_type,
      run.market_data_snapshot,
    );
  }

  private async loadCandlesForMarketData(
    workspaceId: string,
    symbol: string,
    marketType: SimulationRunResponse['market_type'],
    snapshot: MarketDataSnapshot,
  ): Promise<MarketOhlcvCandleResponse[]> {
    if (this.ohlcvForTest) {
      return this.ohlcvForTest;
    }
    const response = await this.ohlcv.getOhlcv({
      workspaceId,
      symbol,
      marketType,
      interval: snapshot.timeframe,
      from: snapshot.starts_at,
      to: snapshot.ends_at ?? undefined,
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

  private async withSimulationLock<T>(
    id: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.simulationLocks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => current, () => current);
    this.simulationLocks.set(id, next);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.simulationLocks.get(id) === next) {
        this.simulationLocks.delete(id);
      }
    }
  }

  private async withRepositorySimulationLock<T>(
    id: string,
    workspaceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.journal.withSimulationRunLock
      ? this.journal.withSimulationRunLock(id, workspaceId, action)
      : action();
  }
}

const ACTIVE_FORWARD_STATUSES = new Set([
  'created',
  'waiting_for_trigger',
  'entry_triggered',
  'order_pending',
  'position_open',
]);

type EventBuilder = {
  build(input: Partial<ExecutionEventResponse> & {
    event_type: ExecutionEventType;
    reason_code: string;
  }): ExecutionEventResponse;
  lastSequence(): number;
};

type PositionTransition =
  | { kind: 'partial_close'; exit: SimulationExit; closePercent: number }
  | { kind: 'final_close'; exit: SimulationExit };

function rebuildProjectionFromLedger(
  run: SimulationRunResponse,
  events: ExecutionEventResponse[],
): {
  orders: PaperOrderResponse[];
  position: PaperPositionResponse | null;
  outcome: SimulationOutcomeResponse | null;
} {
  const orderedEvents = [...events].sort((a, b) => a.sequence - b.sequence);
  const orders = rebuildOrdersFromLedger(run, orderedEvents);
  const position = rebuildPositionFromLedger(run, orderedEvents);
  const outcome = rebuildOutcomeFromLedger(run, orderedEvents, position);
  return { orders, position, outcome };
}

function rebuildOrdersFromLedger(
  run: SimulationRunResponse,
  events: ExecutionEventResponse[],
): PaperOrderResponse[] {
  const orders = new Map<string, PaperOrderResponse>();
  for (const event of events) {
    if (!event.order_id) continue;
    if (
      event.event_type !== 'paper_order_created' &&
      event.event_type !== 'paper_order_filled' &&
      event.event_type !== 'paper_order_cancelled' &&
      event.event_type !== 'paper_order_rejected' &&
      event.event_type !== 'paper_order_expired'
    ) {
      continue;
    }
    const shape = orderShapeFromLedgerEvent(run, event);
    const existing = orders.get(event.order_id);
    const next: PaperOrderResponse = {
      version: 'paper_order.v1',
      id: event.order_id,
      workspace_id: run.workspace_id,
      simulation_run_id: run.id,
      source_playbook_id: run.source_playbook_id,
      side: shape.side,
      intent: shape.intent,
      status: paperOrderStatusFromEvent(event.event_type),
      order_type: shape.orderType,
      trigger_condition: { reason: event.reason_code },
      requested_price: existing?.requested_price ?? event.price,
      filled_price: existing?.filled_price ?? null,
      quantity: event.quantity ?? existing?.quantity ?? '0',
      fee: decimalStringOrNull(event.payload.fee) ?? existing?.fee ?? '0',
      created_at_market_time: existing?.created_at_market_time ?? event.market_time,
      filled_at_market_time: existing?.filled_at_market_time ?? null,
      cancelled_at_market_time: existing?.cancelled_at_market_time ?? null,
      reason_code: event.reason_code,
    };
    if (event.event_type === 'paper_order_filled') {
      next.requested_price = existing?.requested_price ?? event.price;
      next.filled_price = event.price;
      next.filled_at_market_time = event.market_time;
      next.created_at_market_time = existing?.created_at_market_time ?? event.market_time;
    }
    if (event.event_type === 'paper_order_cancelled') {
      next.cancelled_at_market_time = event.market_time;
    }
    orders.set(event.order_id, next);
  }
  return [...orders.values()].sort((a, b) =>
    String(a.created_at_market_time ?? '').localeCompare(String(b.created_at_market_time ?? '')) ||
    a.id.localeCompare(b.id));
}

function rebuildPositionFromLedger(
  run: SimulationRunResponse,
  events: ExecutionEventResponse[],
): PaperPositionResponse | null {
  let position: PaperPositionResponse | null = null;
  for (const event of events) {
    if (event.event_type === 'position_opened' && event.position_id) {
      const entryPrice = decimalNumber(event.price) ?? 0;
      position = {
        version: 'paper_position.v1',
        id: event.position_id,
        workspace_id: run.workspace_id,
        simulation_run_id: run.id,
        source_playbook_id: run.source_playbook_id,
        symbol: run.symbol,
        market_type: run.market_type,
        direction: run.playbook_snapshot.direction === 'short' ? 'short' : 'long',
        status: 'open',
        quantity_opened: event.quantity ?? '0',
        quantity_remaining: event.quantity ?? '0',
        average_entry_price: decimal(entryPrice),
        realized_pnl: null,
        unrealized_pnl: null,
        realized_pnl_pct: null,
        unrealized_pnl_pct: null,
        opened_at_market_time: event.market_time,
        closed_at_market_time: null,
        close_reason: null,
      };
    }
    if (event.event_type === 'position_closed' && position) {
      const exitPrice = decimalNumber(event.price) ?? decimalNumber(position.average_entry_price) ?? 0;
      position = closePosition(position, {
        candle: candleFromEvent(event, exitPrice),
        price: exitPrice,
        reason: closeReasonFromEvent(event),
        quantity: event.quantity ?? position.quantity_remaining,
        fee: decimalStringOrNull(event.payload.fee) ?? '0',
      }, run.assumptions);
    }
    if (event.event_type === 'position_partially_closed' && position) {
      const exitPrice = decimalNumber(event.price) ?? decimalNumber(position.average_entry_price) ?? 0;
      position = reducePosition(position, {
        candle: candleFromEvent(event, exitPrice),
        price: exitPrice,
        reason: closeReasonFromEvent(event),
        target_index: event.target_index,
        quantity: event.quantity ?? '0',
        fee: decimalStringOrNull(event.payload.fee) ?? '0',
      }, run.assumptions);
    }
  }
  return position;
}

function rebuildOutcomeFromLedger(
  run: SimulationRunResponse,
  events: ExecutionEventResponse[],
  position: PaperPositionResponse | null,
): SimulationOutcomeResponse | null {
  const evaluation = [...events].reverse().find((event) => event.event_type === 'evaluation_completed');
  const outcomeId = typeof evaluation?.payload.outcome_id === 'string'
    ? evaluation.payload.outcome_id
    : `simulation_outcome_${run.id}_rebuilt`;
  const failure = [...events].reverse().find((event) => event.event_type === 'simulation_failed');
  if (failure) {
    return { ...buildFailureOutcome(run, failure.reason_code), id: outcomeId };
  }
  const setupExpired = events.find((event) => event.event_type === 'setup_expired');
  if (setupExpired) {
    return { ...buildMissedOutcome(run), id: outcomeId };
  }
  const abandoned = events.find((event) => event.reason_code === 'manual_abandon_inconclusive');
  if (abandoned) {
    return { ...buildAbandonedOutcome(run), id: outcomeId };
  }
  const dataEnd = events.find((event) => event.event_type === 'data_end_reached');
  if (dataEnd && position) {
    return { ...buildDataEndOutcome(run, position), id: outcomeId };
  }
  if (dataEnd) {
    return { ...buildNoEntryDataEndOutcome(run), id: outcomeId };
  }
  if (!position || position.status !== 'closed' || !position.close_reason) {
    return null;
  }
  if (position.close_reason === 'manual_close') {
    return { ...buildManualCloseOutcome(run, position), id: outcomeId };
  }
  const finalClosed = [...events].reverse().find((event) => event.event_type === 'position_closed');
  return {
    ...buildOutcome(run, position, {
      reason: position.close_reason,
      ambiguous: finalClosed?.reason_code === 'ambiguous_intrabar',
      max_favorable_excursion: decimalStringOrNull(finalClosed?.payload.max_favorable_excursion),
      max_adverse_excursion: decimalStringOrNull(finalClosed?.payload.max_adverse_excursion),
    }),
    id: outcomeId,
  };
}

function orderShapeFromLedgerEvent(
  run: SimulationRunResponse,
  event: ExecutionEventResponse,
): {
  side: PaperOrderResponse['side'];
  intent: PaperOrderResponse['intent'];
  orderType: PaperOrderResponse['order_type'];
} {
  const entrySide = run.playbook_snapshot.direction === 'short' ? 'sell' : 'buy';
  const exitSide = run.playbook_snapshot.direction === 'short' ? 'buy' : 'sell';
  if (event.reason_code.includes('entry')) {
    return { side: entrySide, intent: 'entry', orderType: 'limit' };
  }
  if (event.reason_code.includes('target')) {
    return { side: exitSide, intent: 'target', orderType: 'limit' };
  }
  if (event.reason_code.includes('manual_close')) {
    return { side: exitSide, intent: 'exit', orderType: 'market' };
  }
  if (event.reason_code.includes('data_end')) {
    return { side: exitSide, intent: 'exit', orderType: 'market' };
  }
  return { side: exitSide, intent: 'stop', orderType: 'stop' };
}

function paperOrderStatusFromEvent(
  eventType: ExecutionEventResponse['event_type'],
): PaperOrderResponse['status'] {
  if (eventType === 'paper_order_filled') return 'filled';
  if (eventType === 'paper_order_cancelled') return 'cancelled';
  if (eventType === 'paper_order_rejected') return 'rejected';
  if (eventType === 'paper_order_expired') return 'expired';
  return 'created';
}

function closeReasonFromEvent(event: ExecutionEventResponse): PaperPositionCloseReason {
  if (event.reason_code === 'target') return 'target';
  if (event.reason_code === 'manual_close') return 'manual_close';
  if (event.reason_code === 'data_end') return 'data_end';
  if (event.reason_code === 'position_timeout') return 'position_timeout';
  if (event.reason_code === 'thesis_invalidation') return 'thesis_invalidation';
  return 'stop';
}

function exitEventType(exit: Pick<SimulationExit, 'reason'>): ExecutionEventType {
  if (exit.reason === 'target') return 'target_hit';
  if (exit.reason === 'position_timeout') return 'position_timeout_hit';
  if (exit.reason === 'thesis_invalidation') return 'invalidation_hit';
  if (exit.reason === 'data_end') return 'data_end_reached';
  return 'stop_hit';
}

function candleFromEvent(
  event: ExecutionEventResponse,
  price: number,
): MarketOhlcvCandleResponse {
  return {
    time: event.market_time ?? new Date().toISOString(),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: null,
  };
}

function normalizeAssumptions(
  input: CreateSimulationRequest,
  playbook: TradePlaybookResponse,
): SimulationAssumptions {
  const positionSize = recordValue(input.position_size);
  if (positionSize.mode !== 'fixed_notional' && positionSize.mode !== 'fixed_quantity') {
    throw new BadRequestException(
      'Simulation requires position_size mode fixed_notional or fixed_quantity.',
    );
  }
  const mode = positionSize.mode;
  const notionalValue = mode === 'fixed_notional'
    ? decimalUnits(positionSize.notional)
    : null;
  const quantityValue = mode === 'fixed_quantity'
    ? decimalUnits(positionSize.quantity)
    : null;
  if (mode === 'fixed_notional' && (notionalValue === null || notionalValue <= 0n)) {
    throw new BadRequestException('Simulation requires positive fixed_notional sizing.');
  }
  if (mode === 'fixed_quantity' && (quantityValue === null || quantityValue <= 0n)) {
    throw new BadRequestException('Simulation requires positive fixed_quantity sizing.');
  }
  const notional = notionalValue === null ? null : decimalFromUnits(notionalValue);
  const quantity = quantityValue === null ? null : decimalFromUnits(quantityValue);
  const invalidationLevel = playbook.invalidation.level === null
    ? null
    : decimal(playbook.invalidation.level);
  return {
    version: 'simulation_assumptions.v1',
    fill_policy: input.fill_policy === 'next_open_after_trigger'
      ? 'next_open_after_trigger'
      : 'touch',
    gap_fill_policy: gapFillPolicy(input.gap_fill_policy),
    intrabar_policy: intrabarPolicy(input.intrabar_policy),
    slippage_bps: decimalFromUnknown(input.slippage_bps, '0'),
    fee_bps: decimalFromUnknown(input.fee_bps, '0'),
    position_size: { mode, notional, quantity },
    risk_exit: {
      type: 'hard_stop',
      level: invalidationLevel,
      condition: null,
    },
    thesis_invalidation: {
      level: invalidationLevel,
      condition: null,
    },
    partial_take_profit: partialTakeProfit(input.partial_take_profit),
    setup_expiry_at: input.setup_expiry_at ?? null,
    position_max_duration_minutes: integerOrNull(input.position_max_duration_minutes),
    force_close_at_data_end: Boolean(input.force_close_at_data_end),
  };
}

function assertNoRiskFraction(input: CreateSimulationRequest): void {
  const positionSize = recordValue(input.position_size);
  if (positionSize.mode === 'risk_fraction' || 'risk_fraction' in positionSize) {
    throw new BadRequestException('V8 paper execution does not support risk_fraction sizing.');
  }
}

function partialTakeProfit(value: unknown): SimulationAssumptions['partial_take_profit'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => recordValue(item))
    .map((item) => ({
      target_index: Math.max(0, Math.trunc(decimalNumber(item.target_index) ?? 0)),
      close_percent: decimalFromUnknown(item.close_percent, '0'),
    }))
    .filter((item) => {
      const closePercent = decimalNumber(item.close_percent) ?? 0;
      return closePercent > 0 && closePercent < 1;
    });
}

function validateSimulationPlaybook(playbook: TradePlaybookResponse): void {
  if (playbook.status !== 'current') {
    throw new BadRequestException('Simulation requires a current trade playbook.');
  }
  if (playbook.direction === 'avoid') {
    throw new BadRequestException('Simulation cannot run avoid-direction playbooks.');
  }
  if (!entryTrigger(playbook.entry)) {
    throw new BadRequestException('Simulation requires numeric entry level or zone.');
  }
  if (playbook.invalidation.level === null) {
    throw new BadRequestException('Simulation requires numeric invalidation for risk exit.');
  }
  if (firstTargetLevel(playbook.targets) === null) {
    throw new BadRequestException('Simulation requires at least one numeric target.');
  }
}

type EntryTrigger =
  | { type: 'level'; level: number }
  | { type: 'zone'; low: number; high: number };

type SimulationExit = {
  candle: MarketOhlcvCandleResponse;
  price: number;
  reason: PaperPositionCloseReason;
  ambiguous?: boolean;
  target_index?: number | null;
  quantity?: string;
  fee?: string;
  max_favorable_excursion?: DecimalString | null;
  max_adverse_excursion?: DecimalString | null;
};

function entryTrigger(entry: TradePlaybookResponse['entry']): EntryTrigger | null {
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

function firstTargetLevel(targets: TradePlaybookResponse['targets']): number | null {
  for (const target of targets) {
    if (typeof target.level === 'number') {
      return target.level;
    }
  }
  return null;
}

function targetLevels(
  targets: TradePlaybookResponse['targets'],
): Array<{ index: number; level: number }> {
  return targets
    .map((target, index) => ({ index, level: target.level }))
    .filter((target): target is { index: number; level: number } =>
      typeof target.level === 'number');
}

function targetHit(
  candle: MarketOhlcvCandleResponse,
  target: number,
  direction: 'long' | 'short' | 'avoid',
): boolean {
  return direction === 'short'
    ? candle.low <= target
    : candle.high >= target;
}

function partialTakeProfitByTarget(
  partials: SimulationAssumptions['partial_take_profit'],
): Map<number, number> {
  const byTarget = new Map<number, number>();
  for (const partial of partials) {
    const closePercent = decimalNumber(partial.close_percent) ?? 0;
    if (closePercent > 0 && closePercent < 1) {
      byTarget.set(partial.target_index, closePercent);
    }
  }
  return byTarget;
}

function findEntry(
  candles: MarketOhlcvCandleResponse[],
  trigger: EntryTrigger,
  direction: 'long' | 'short' | 'avoid',
  assumptions: SimulationAssumptions,
): { index: number; candle: MarketOhlcvCandleResponse; price: number; reason: string } | null {
  if (direction === 'avoid') return null;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const touch = touchEntry(candle, trigger, direction);
    if (assumptions.fill_policy === 'touch' && touch) {
      return { index, candle, price: touch.price, reason: touch.reason };
    }
    if (assumptions.fill_policy === 'touch' && gapsThrough(candle, trigger, direction)) {
      if (assumptions.gap_fill_policy === 'reject_if_skipped') {
        continue;
      }
      const price = assumptions.gap_fill_policy === 'first_tradable_price'
        ? candle.open
        : requestedBoundary(trigger, direction);
      return { index, candle, price, reason: `gap_${assumptions.gap_fill_policy}` };
    }
    if (assumptions.fill_policy === 'next_open_after_trigger' && closesThrough(candle, trigger, direction)) {
      const next = candles[index + 1];
      return next
        ? { index: index + 1, candle: next, price: next.open, reason: 'next_open_after_trigger' }
        : null;
    }
  }
  return null;
}

function entryWindowForSetupExpiry(
  candles: MarketOhlcvCandleResponse[],
  setupExpiryAt: string | null,
): {
  eligible: MarketOhlcvCandleResponse[];
  expiryCandle: MarketOhlcvCandleResponse | null;
} {
  if (!setupExpiryAt) {
    return { eligible: candles, expiryCandle: null };
  }
  const expiry = Date.parse(setupExpiryAt);
  if (!Number.isFinite(expiry)) {
    return { eligible: candles, expiryCandle: null };
  }
  const expiryIndex = candles.findIndex((candle) => candleTime(candle.time) > expiry);
  if (expiryIndex === -1) {
    return { eligible: candles, expiryCandle: null };
  }
  return {
    eligible: candles.slice(0, expiryIndex),
    expiryCandle: candles[expiryIndex] ?? null,
  };
}

function findPositionTransitions(
  candles: MarketOhlcvCandleResponse[],
  playbook: TradePlaybookResponse,
  assumptions: SimulationAssumptions,
  entryPrice: number,
  openedAt: string | null,
  allowPartialTargets: boolean,
): PositionTransition[] {
  const partials = allowPartialTargets
    ? partialTakeProfitByTarget(assumptions.partial_take_profit)
    : new Map<number, number>();
  if (partials.size === 0) {
    const exit = findExit(candles, playbook, assumptions, entryPrice, openedAt);
    return exit ? [{ kind: 'final_close', exit }] : [];
  }
  const transitions: PositionTransition[] = [];
  const targets = targetLevels(playbook.targets);
  const stop = decimalNumber(assumptions.risk_exit.level) ?? playbook.invalidation.level;
  const timeoutAt = positionTimeoutAt(openedAt, assumptions.position_max_duration_minutes);
  const consumedPartialTargets = new Set<number>();
  const observed: MarketOhlcvCandleResponse[] = [];
  const finalTransition = (exit: SimulationExit): PositionTransition[] => {
    transitions.push({
      kind: 'final_close',
      exit: withExcursionMetrics(exit, playbook.direction, entryPrice, observed),
    });
    return transitions;
  };
  for (const candle of candles) {
    observed.push(candle);
    const hitStop = stop !== null && (
      playbook.direction === 'short'
        ? candle.high >= stop
        : candle.low <= stop
    );
    const target = targets.find((candidate) =>
      !consumedPartialTargets.has(candidate.index) &&
      targetHit(candle, candidate.level, playbook.direction));
    if (hitStop && target) {
      if (assumptions.intrabar_policy === 'target_first') {
        return finalTransition({
          candle,
          price: target.level,
          reason: 'target',
          target_index: target.index,
        });
      }
      if (assumptions.intrabar_policy === 'ambiguous_warning') {
        return finalTransition({
          candle,
          price: stop,
          reason: 'stop',
          ambiguous: true,
        });
      }
      return finalTransition({ candle, price: stop, reason: 'stop' });
    }
    if (hitStop) {
      return finalTransition({ candle, price: stop, reason: 'stop' });
    }
    if (target) {
      const closePercent = partials.get(target.index);
      if (closePercent !== undefined && closePercent > 0 && closePercent < 1) {
        consumedPartialTargets.add(target.index);
        transitions.push({
          kind: 'partial_close',
          closePercent,
          exit: {
            candle,
            price: target.level,
            reason: 'target',
            target_index: target.index,
          },
        });
      } else {
        return finalTransition({
          candle,
          price: target.level,
          reason: 'target',
          target_index: target.index,
        });
      }
    }
    if (timeoutAt !== null && candleTime(candle.time) >= timeoutAt) {
      return finalTransition({ candle, price: candle.close || entryPrice, reason: 'position_timeout' });
    }
  }
  if (assumptions.force_close_at_data_end && candles.length > 0) {
    const final = candles[candles.length - 1]!;
    finalTransition({ candle: final, price: final.close || entryPrice, reason: 'data_end' });
  }
  return transitions;
}

function findExit(
  candles: MarketOhlcvCandleResponse[],
  playbook: TradePlaybookResponse,
  assumptions: SimulationAssumptions,
  entryPrice: number,
  openedAt: string | null,
): SimulationExit | null {
  const target = firstTargetLevel(playbook.targets);
  const stop = decimalNumber(assumptions.risk_exit.level) ?? playbook.invalidation.level;
  const timeoutAt = positionTimeoutAt(openedAt, assumptions.position_max_duration_minutes);
  const observed: MarketOhlcvCandleResponse[] = [];
  const finalExit = (exit: SimulationExit): SimulationExit =>
    withExcursionMetrics(exit, playbook.direction, entryPrice, observed);
  for (const candle of candles) {
    observed.push(candle);
    const hitStop = stop !== null && (
      playbook.direction === 'short'
        ? candle.high >= stop
        : candle.low <= stop
    );
    const hitTarget = target !== null && (
      playbook.direction === 'short'
        ? candle.low <= target
        : candle.high >= target
    );
    if (hitStop && hitTarget) {
      if (assumptions.intrabar_policy === 'target_first') {
        return finalExit({ candle, price: target!, reason: 'target' });
      }
      if (assumptions.intrabar_policy === 'ambiguous_warning') {
        return finalExit({ candle, price: stop, reason: 'stop', ambiguous: true });
      }
      return finalExit({ candle, price: stop, reason: 'stop' });
    }
    if (hitStop) return finalExit({ candle, price: stop, reason: 'stop' });
    if (hitTarget) return finalExit({ candle, price: target, reason: 'target' });
    if (timeoutAt !== null && candleTime(candle.time) >= timeoutAt) {
      return finalExit({ candle, price: candle.close || entryPrice, reason: 'position_timeout' });
    }
  }
  if (assumptions.force_close_at_data_end && candles.length > 0) {
    const final = candles[candles.length - 1]!;
    return finalExit({ candle: final, price: final.close || entryPrice, reason: 'data_end' });
  }
  return null;
}

function withExcursionMetrics(
  exit: SimulationExit,
  direction: 'long' | 'short' | 'avoid',
  entryPrice: number,
  candles: MarketOhlcvCandleResponse[],
): SimulationExit {
  const entry = decimalUnits(entryPrice) ?? 0n;
  if (direction === 'avoid' || entry <= 0n || candles.length === 0) {
    return {
      ...exit,
      max_favorable_excursion: null,
      max_adverse_excursion: null,
    };
  }
  const high = candles
    .map((candle) => decimalUnits(candle.high) ?? entry)
    .reduce((max, value) => maxUnits(max, value), entry);
  const low = candles
    .map((candle) => decimalUnits(candle.low) ?? entry)
    .reduce((min, value) => value < min ? value : min, entry);
  const favorable = direction === 'short'
    ? entry - low
    : high - entry;
  const adverse = direction === 'short'
    ? high - entry
    : entry - low;
  return {
    ...exit,
    max_favorable_excursion: decimalRatio(maxUnits(favorable, 0n), entry),
    max_adverse_excursion: decimalRatio(maxUnits(adverse, 0n), entry),
  };
}

function finalExitPayload(exit: SimulationExit): JsonRecord {
  return {
    ...(exit.ambiguous ? { diagnosis_codes: ['AMBIGUOUS_INTRABAR'] } : {}),
    fee: exit.fee ?? '0',
    max_favorable_excursion: exit.max_favorable_excursion ?? null,
    max_adverse_excursion: exit.max_adverse_excursion ?? null,
  };
}

function positionTimeoutAt(openedAt: string | null, minutes: number | null): number | null {
  if (!openedAt || minutes === null || minutes <= 0) {
    return null;
  }
  const opened = Date.parse(openedAt);
  return Number.isFinite(opened) ? opened + minutes * 60_000 : null;
}

function candleTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function candlesAfterWatermark(
  candles: MarketOhlcvCandleResponse[],
  watermark: string | null,
): MarketOhlcvCandleResponse[] {
  if (!watermark) {
    return candles;
  }
  const watermarkTime = Date.parse(watermark);
  return candles.filter((candle) => {
    const candleTime = Date.parse(candle.time);
    if (Number.isFinite(candleTime) && Number.isFinite(watermarkTime)) {
      return candleTime > watermarkTime;
    }
    return candle.time > watermark;
  });
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
    price: direction === 'short' ? trigger.high : trigger.low,
    reason: 'touch_zone_boundary',
  };
}

function gapsThrough(
  candle: MarketOhlcvCandleResponse,
  trigger: EntryTrigger,
  direction: 'long' | 'short',
): boolean {
  if (trigger.type === 'level') {
    return direction === 'short'
      ? candle.open > trigger.level && candle.low > trigger.level
      : candle.open < trigger.level && candle.high < trigger.level;
  }
  return direction === 'short'
    ? candle.open > trigger.high && candle.low > trigger.high
    : candle.open < trigger.low && candle.high < trigger.low;
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

function requestedBoundary(trigger: EntryTrigger, direction: 'long' | 'short'): number {
  if (trigger.type === 'level') return trigger.level;
  return direction === 'short' ? trigger.high : trigger.low;
}

function buildEntryOrder(
  run: SimulationRunResponse,
  entry: { candle: MarketOhlcvCandleResponse; price: number; reason: string },
): PaperOrderResponse {
  const filledPrice = fillPriceFor(
    entry.price,
    run.playbook_snapshot.direction === 'short' ? 'sell' : 'buy',
    run.assumptions,
  );
  const quantity = quantityFor(run.assumptions, filledPrice);
  return {
    version: 'paper_order.v1',
    id: `paper_order_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_playbook_id: run.source_playbook_id,
    side: run.playbook_snapshot.direction === 'short' ? 'sell' : 'buy',
    intent: 'entry',
    status: 'filled',
    order_type: 'limit',
    trigger_condition: { reason: entry.reason },
    requested_price: decimal(entry.price),
    filled_price: decimal(filledPrice),
    quantity,
    fee: feeFor(filledPrice, quantity, run.assumptions),
    created_at_market_time: entry.candle.time,
    filled_at_market_time: entry.candle.time,
    cancelled_at_market_time: null,
    reason_code: entry.reason,
  };
}

function buildExitOrder(
  run: SimulationRunResponse,
  position: PaperPositionResponse,
  exit: SimulationExit,
): PaperOrderResponse {
  const isManual = exit.reason === 'manual_close';
  const isTarget = exit.reason === 'target';
  const isDataEnd = exit.reason === 'data_end';
  const side = run.playbook_snapshot.direction === 'short' ? 'buy' : 'sell';
  const filledPrice = fillPriceFor(exit.price, side, run.assumptions);
  const quantity = exit.quantity ?? position.quantity_remaining;
  return {
    version: 'paper_order.v1',
    id: `paper_order_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_playbook_id: run.source_playbook_id,
    side,
    intent: isTarget ? 'target' : isManual || isDataEnd ? 'exit' : 'stop',
    status: 'filled',
    order_type: isTarget ? 'limit' : isManual || isDataEnd ? 'market' : 'stop',
    trigger_condition: { reason: exit.reason },
    requested_price: decimal(exit.price),
    filled_price: decimal(filledPrice),
    quantity,
    fee: feeFor(filledPrice, quantity, run.assumptions),
    created_at_market_time: exit.candle.time,
    filled_at_market_time: exit.candle.time,
    cancelled_at_market_time: null,
    reason_code: exit.reason,
  };
}

function buildOpenPosition(
  run: SimulationRunResponse,
  entry: { candle: MarketOhlcvCandleResponse; price: number },
  order: PaperOrderResponse,
): PaperPositionResponse {
  return {
    version: 'paper_position.v1',
    id: `paper_position_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_playbook_id: run.source_playbook_id,
    symbol: run.symbol,
    market_type: run.market_type,
    direction: run.playbook_snapshot.direction === 'short' ? 'short' : 'long',
    status: 'open',
    quantity_opened: order.quantity,
    quantity_remaining: order.quantity,
    average_entry_price: order.filled_price,
    realized_pnl: null,
    unrealized_pnl: null,
    realized_pnl_pct: null,
    unrealized_pnl_pct: null,
    opened_at_market_time: entry.candle.time,
    closed_at_market_time: null,
    close_reason: null,
  };
}

function closePosition(
  position: PaperPositionResponse,
  exit: SimulationExit,
  assumptions: SimulationAssumptions,
): PaperPositionResponse {
  const remaining = decimalUnits(position.quantity_remaining) ?? decimalUnits(position.quantity_opened) ?? 0n;
  const exitQuantity = decimalUnits(exit.quantity) ?? remaining;
  const quantity = clampUnits(exitQuantity, 0n, remaining);
  const realized = realizedPnlFor(position, exit.price, quantity, assumptions, exit.fee);
  const existingPnl = decimalUnits(position.realized_pnl) ?? 0n;
  const totalPnl = existingPnl + realized;
  return {
    ...position,
    status: 'closed',
    quantity_remaining: '0',
    realized_pnl: decimalFromUnits(totalPnl),
    unrealized_pnl: '0',
    realized_pnl_pct: realizedPnlPct(position, totalPnl),
    unrealized_pnl_pct: '0',
    closed_at_market_time: exit.candle.time,
    close_reason: exit.reason,
  };
}

function reducePosition(
  position: PaperPositionResponse,
  exit: SimulationExit,
  assumptions: SimulationAssumptions,
): PaperPositionResponse {
  const remaining = decimalUnits(position.quantity_remaining) ?? decimalUnits(position.quantity_opened) ?? 0n;
  const exitQuantity = decimalUnits(exit.quantity) ?? 0n;
  const quantity = clampUnits(exitQuantity, 0n, remaining);
  const quantityRemaining = remaining - quantity;
  const realized = realizedPnlFor(position, exit.price, quantity, assumptions, exit.fee);
  const existingPnl = decimalUnits(position.realized_pnl) ?? 0n;
  const totalPnl = existingPnl + realized;
  return {
    ...position,
    status: quantityRemaining > 0n ? 'partially_closed' : 'closed',
    quantity_remaining: decimalFromUnits(quantityRemaining),
    realized_pnl: decimalFromUnits(totalPnl),
    unrealized_pnl: null,
    realized_pnl_pct: realizedPnlPct(position, totalPnl),
    unrealized_pnl_pct: null,
    closed_at_market_time: quantityRemaining > 0n ? null : exit.candle.time,
    close_reason: quantityRemaining > 0n ? null : exit.reason,
  };
}

function realizedPnlFor(
  position: PaperPositionResponse,
  exitPrice: number,
  quantity: bigint,
  assumptions: SimulationAssumptions,
  exitFee: string | undefined,
): bigint {
  const entry = decimalUnits(position.average_entry_price) ?? decimalUnits(exitPrice) ?? 0n;
  const exit = decimalUnits(exitPrice) ?? entry;
  const priceDelta = position.direction === 'short'
    ? entry - exit
    : exit - entry;
  const gross = decimalMulUnits(priceDelta, quantity);
  const entryFee = entryFeeFor(position, quantity, assumptions);
  const parsedExitFee = decimalUnits(exitFee) ?? 0n;
  return gross - entryFee - parsedExitFee;
}

function fillPriceFor(
  requestedPrice: number,
  side: PaperOrderResponse['side'],
  assumptions: SimulationAssumptions,
): string {
  const price = decimalUnits(requestedPrice) ?? 0n;
  const slippageBps = maxUnits(decimalUnits(assumptions.slippage_bps) ?? 0n, 0n);
  const multiplier = side === 'buy'
    ? BASIS_POINTS_SCALE + slippageBps
    : BASIS_POINTS_SCALE - slippageBps;
  return decimalFromUnits(divRound(price * multiplier, BASIS_POINTS_SCALE));
}

function feeFor(
  filledPrice: string | number,
  quantity: string,
  assumptions: SimulationAssumptions,
): string {
  const price = decimalUnits(filledPrice) ?? 0n;
  const parsedQuantity = decimalUnits(quantity) ?? 0n;
  const notional = decimalMulUnits(price, parsedQuantity);
  const feeBps = maxUnits(decimalUnits(assumptions.fee_bps) ?? 0n, 0n);
  return decimalFromUnits(divRound(notional * feeBps, BASIS_POINTS_SCALE));
}

function entryFeeFor(
  position: PaperPositionResponse,
  closedQuantity: bigint,
  assumptions: SimulationAssumptions,
): bigint {
  const entryPrice = decimalUnits(position.average_entry_price) ?? 0n;
  const notional = decimalMulUnits(entryPrice, closedQuantity);
  const feeBps = maxUnits(decimalUnits(assumptions.fee_bps) ?? 0n, 0n);
  return divRound(notional * feeBps, BASIS_POINTS_SCALE);
}

function exitFromOrder(
  exit: SimulationExit,
  order: PaperOrderResponse,
): SimulationExit {
  return {
    ...exit,
    price: decimalNumber(order.filled_price) ?? exit.price,
    quantity: order.quantity,
    fee: order.fee,
  };
}

function realizedPnlPct(
  position: PaperPositionResponse,
  realizedPnl: bigint,
): string {
  const entry = decimalUnits(position.average_entry_price) ?? 0n;
  const opened = decimalUnits(position.quantity_opened) ?? 0n;
  const notional = decimalMulUnits(entry, opened);
  return decimalFromUnits(notional === 0n ? 0n : divRound(realizedPnl * DECIMAL_SCALE, notional));
}

function buildOutcome(
  run: SimulationRunResponse,
  position: PaperPositionResponse,
  exit: Pick<
    SimulationExit,
    'reason' | 'ambiguous' | 'max_favorable_excursion' | 'max_adverse_excursion'
  >,
): SimulationOutcomeResponse {
  const pnl = decimalUnits(position.realized_pnl) ?? 0n;
  const inconclusive = exit.ambiguous === true || exit.reason === 'data_end';
  const sourceIntegrityFailed = run.source_integrity_status === 'failed';
  const executionResult: SimulationOutcomeResponse['execution_result'] = inconclusive
    ? 'inconclusive'
    : pnl > 0n
      ? 'win'
      : pnl < 0n
        ? 'loss'
        : 'breakeven';
  const researchEvaluation = researchEvaluationForFinalExit({
    executionResult,
    ambiguous: exit.ambiguous === true,
    dataEnd: exit.reason === 'data_end',
    sourceIntegrityFailed,
  });
  const warnings = exit.ambiguous
    ? ['ambiguous_intrabar']
    : exit.reason === 'data_end'
      ? ['force_close_at_data_end']
      : [];
  if (sourceIntegrityFailed) {
    warnings.push('source_integrity_failed');
  }
  return {
    version: 'simulation_outcome.v1',
    id: `simulation_outcome_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_scenario_id: run.source_scenario_id,
    source_playbook_id: run.source_playbook_id,
    sample_kind: run.sample_kind,
    sample_identity: run.sample_identity,
    execution_result: executionResult,
    research_evaluation_status: researchEvaluation.research_evaluation_status,
    thesis_outcome: researchEvaluation.thesis_outcome,
    execution_quality: sourceIntegrityFailed
      ? 'invalid_experiment'
      : inconclusive
        ? 'insufficient_data'
        : 'rule_following',
    close_reason: exit.reason,
    realized_pnl: position.realized_pnl,
    realized_pnl_pct: position.realized_pnl_pct,
    max_favorable_excursion: exit.max_favorable_excursion ?? null,
    max_adverse_excursion: exit.max_adverse_excursion ?? null,
    reliability_eligible: !inconclusive && !sourceIntegrityFailed,
    diagnosis_codes: researchEvaluation.diagnosis_codes,
    diagnosis_summary: exit.ambiguous
      ? 'Stop and target were both touched in the same candle; result is ambiguous.'
      : sourceIntegrityFailed
        ? `Paper execution closed by ${exit.reason}, but source integrity failed.`
        : researchEvaluation.thesis_outcome
          ? `Paper execution closed by ${exit.reason}. Rule-based research outcome: ${researchEvaluation.thesis_outcome}.`
          : `Paper execution closed by ${exit.reason}.`,
    warnings,
    evaluated_at: new Date().toISOString(),
  };
}

function researchEvaluationForFinalExit(input: {
  executionResult: SimulationOutcomeResponse['execution_result'];
  ambiguous: boolean;
  dataEnd: boolean;
  sourceIntegrityFailed: boolean;
}): Pick<
  SimulationOutcomeResponse,
  'research_evaluation_status' | 'thesis_outcome' | 'diagnosis_codes'
> {
  const diagnosisCodes: DiagnosisCode[] = [];
  if (input.ambiguous) {
    diagnosisCodes.push('AMBIGUOUS_INTRABAR');
  }
  if (input.dataEnd) {
    diagnosisCodes.push('DATA_END_REACHED');
  }
  if (input.sourceIntegrityFailed) {
    diagnosisCodes.push('SOURCE_INTEGRITY_FAILED');
  }
  if (diagnosisCodes.length > 0 || input.executionResult === 'inconclusive') {
    return {
      research_evaluation_status: 'pending',
      thesis_outcome: null,
      diagnosis_codes: diagnosisCodes,
    };
  }
  if (input.executionResult === 'win') {
    return {
      research_evaluation_status: 'rule_based',
      thesis_outcome: 'supported',
      diagnosis_codes: ['THESIS_SUPPORTED'],
    };
  }
  if (input.executionResult === 'loss') {
    return {
      research_evaluation_status: 'rule_based',
      thesis_outcome: 'challenged',
      diagnosis_codes: ['THESIS_CHALLENGED'],
    };
  }
  return {
    research_evaluation_status: 'rule_based',
    thesis_outcome: 'inconclusive',
    diagnosis_codes: [],
  };
}

function buildManualCloseOutcome(
  run: SimulationRunResponse,
  position: PaperPositionResponse,
): SimulationOutcomeResponse {
  const pnl = decimalUnits(position.realized_pnl) ?? 0n;
  return {
    version: 'simulation_outcome.v1',
    id: `simulation_outcome_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_scenario_id: run.source_scenario_id,
    source_playbook_id: run.source_playbook_id,
    sample_kind: run.sample_kind,
    sample_identity: run.sample_identity,
    execution_result: pnl > 0n ? 'win' : pnl < 0n ? 'loss' : 'breakeven',
    research_evaluation_status: 'pending',
    thesis_outcome: null,
    execution_quality: 'invalid_experiment',
    close_reason: 'manual_close',
    realized_pnl: position.realized_pnl,
    realized_pnl_pct: position.realized_pnl_pct,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    reliability_eligible: false,
    diagnosis_codes: [],
    diagnosis_summary: 'Paper execution was closed manually and is not reliability-eligible.',
    warnings: ['manual_close'],
    evaluated_at: new Date().toISOString(),
  };
}

function buildAbandonedOutcome(run: SimulationRunResponse): SimulationOutcomeResponse {
  return {
    version: 'simulation_outcome.v1',
    id: `simulation_outcome_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_scenario_id: run.source_scenario_id,
    source_playbook_id: run.source_playbook_id,
    sample_kind: run.sample_kind,
    sample_identity: run.sample_identity,
    execution_result: 'inconclusive',
    research_evaluation_status: 'pending',
    thesis_outcome: null,
    execution_quality: 'invalid_experiment',
    close_reason: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    reliability_eligible: false,
    diagnosis_codes: [],
    diagnosis_summary: 'Open paper position was abandoned without synthetic PnL.',
    warnings: ['manual_abandon_inconclusive'],
    evaluated_at: new Date().toISOString(),
  };
}

function buildMissedOutcome(run: SimulationRunResponse): SimulationOutcomeResponse {
  return {
    version: 'simulation_outcome.v1',
    id: `simulation_outcome_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_scenario_id: run.source_scenario_id,
    source_playbook_id: run.source_playbook_id,
    sample_kind: run.sample_kind,
    sample_identity: run.sample_identity,
    execution_result: 'missed',
    research_evaluation_status: 'pending',
    thesis_outcome: null,
    execution_quality: 'missed_trigger',
    close_reason: 'setup_expiry',
    realized_pnl: null,
    realized_pnl_pct: null,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    reliability_eligible: false,
    diagnosis_codes: ['ENTRY_MISSED'],
    diagnosis_summary: 'Entry trigger did not occur before replay data ended.',
    warnings: [],
    evaluated_at: new Date().toISOString(),
  };
}

function buildDataEndOutcome(
  run: SimulationRunResponse,
  position: PaperPositionResponse,
): SimulationOutcomeResponse {
  return {
    version: 'simulation_outcome.v1',
    id: `simulation_outcome_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_scenario_id: run.source_scenario_id,
    source_playbook_id: run.source_playbook_id,
    sample_kind: run.sample_kind,
    sample_identity: run.sample_identity,
    execution_result: 'inconclusive',
    research_evaluation_status: 'pending',
    thesis_outcome: null,
    execution_quality: 'insufficient_data',
    close_reason: null,
    realized_pnl: position.realized_pnl,
    realized_pnl_pct: position.realized_pnl_pct,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    reliability_eligible: false,
    diagnosis_codes: ['DATA_END_REACHED', 'INSUFFICIENT_FUTURE_DATA'],
    diagnosis_summary: 'Replay data ended before a deterministic exit.',
    warnings: ['data_end_reached'],
    evaluated_at: new Date().toISOString(),
  };
}

function buildNoEntryDataEndOutcome(run: SimulationRunResponse): SimulationOutcomeResponse {
  return {
    version: 'simulation_outcome.v1',
    id: `simulation_outcome_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_scenario_id: run.source_scenario_id,
    source_playbook_id: run.source_playbook_id,
    sample_kind: run.sample_kind,
    sample_identity: run.sample_identity,
    execution_result: 'inconclusive',
    research_evaluation_status: 'pending',
    thesis_outcome: null,
    execution_quality: 'insufficient_data',
    close_reason: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    reliability_eligible: false,
    diagnosis_codes: ['DATA_END_REACHED', 'INSUFFICIENT_FUTURE_DATA'],
    diagnosis_summary: 'Replay data ended before entry could be determined.',
    warnings: ['data_end_reached'],
    evaluated_at: new Date().toISOString(),
  };
}

function buildFailureOutcome(
  run: SimulationRunResponse,
  reason: string,
): SimulationOutcomeResponse {
  return {
    version: 'simulation_outcome.v1',
    id: `simulation_outcome_${randomUUID().replaceAll('-', '')}`,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_scenario_id: run.source_scenario_id,
    source_playbook_id: run.source_playbook_id,
    sample_kind: run.sample_kind,
    sample_identity: run.sample_identity,
    execution_result: 'inconclusive',
    research_evaluation_status: 'pending',
    thesis_outcome: null,
    execution_quality: 'invalid_experiment',
    close_reason: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    reliability_eligible: false,
    diagnosis_codes: reason === 'missing_ohlcv'
      ? ['INSUFFICIENT_FUTURE_DATA']
      : ['ENGINE_FAILURE'],
    diagnosis_summary: `Simulation failed: ${reason}.`,
    warnings: [reason],
    evaluated_at: new Date().toISOString(),
  };
}

function buildEvent(
  run: SimulationRunResponse,
  input: Partial<ExecutionEventResponse> & {
    event_type: ExecutionEventType;
    sequence: number;
    reason_code: string;
  },
): ExecutionEventResponse {
  const id = `execution_event_${run.id}_${String(input.sequence).padStart(4, '0')}`;
  const occurrenceIndex = input.occurrence_index ?? 1;
  const idempotencyKey = [
    run.id,
    input.event_type,
    input.market_time ?? 'none',
    input.source_candle_id ?? 'none',
    input.order_id ?? 'none',
    input.position_id ?? 'none',
    input.target_index ?? 'none',
    occurrenceIndex,
    input.reason_code,
  ].join(':');
  return {
    version: 'execution_event.v1',
    id,
    workspace_id: run.workspace_id,
    simulation_run_id: run.id,
    source_playbook_id: run.source_playbook_id,
    source_scenario_id: run.source_scenario_id,
    event_type: input.event_type,
    sequence: input.sequence,
    aggregate_version: input.sequence,
    correlation_id: input.correlation_id ?? run.id,
    causation_event_id: input.causation_event_id ?? null,
    idempotency_key: input.idempotency_key ?? idempotencyKey,
    order_id: input.order_id ?? null,
    position_id: input.position_id ?? null,
    target_index: input.target_index ?? null,
    occurrence_index: occurrenceIndex,
    market_time: input.market_time ?? null,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
    price: input.price ?? null,
    quantity: input.quantity ?? null,
    reason_code: input.reason_code,
    source_candle_id: input.source_candle_id ?? null,
    payload: input.payload ?? {},
  };
}

function quantityFor(assumptions: SimulationAssumptions, price: string | number): string {
  if (assumptions.position_size.mode === 'fixed_quantity') {
    return assumptions.position_size.quantity ?? '1';
  }
  const notional = decimalUnits(assumptions.position_size.notional) ?? decimalUnits(1000) ?? 0n;
  const priceUnits = decimalUnits(price) ?? 0n;
  return decimalFromUnits(priceUnits === 0n ? 0n : divRound(notional * DECIMAL_SCALE, priceUnits));
}

function buildMarketDataSnapshot(
  playbook: TradePlaybookResponse,
  input: CreateSimulationRequest,
): MarketDataSnapshot {
  const startsAt = input.starts_at ?? new Date().toISOString();
  return {
    version: 'market_data_snapshot.v1',
    provider: 'workspace_ohlcv',
    canonical_symbol: playbook.symbol,
    provider_symbol: playbook.symbol,
    timeframe: input.timeframe ?? '15m',
    timezone: 'UTC',
    price_source: 'last',
    dataset_version: null,
    dataset_hash: null,
    candle_close_policy: 'finalized_only',
    starts_at: startsAt,
    ends_at: input.ends_at ?? null,
  };
}

function withReplayDatasetSnapshot(
  snapshot: MarketDataSnapshot,
  candles: MarketOhlcvCandleResponse[],
): MarketDataSnapshot {
  const first = candles[0]?.time ?? null;
  const last = candles[candles.length - 1]?.time ?? null;
  return {
    ...snapshot,
    dataset_version: [
      snapshot.provider,
      snapshot.canonical_symbol,
      snapshot.timeframe,
      first ?? 'empty',
      last ?? 'empty',
      candles.length,
    ].join(':'),
    dataset_hash: stableHash({
      provider: snapshot.provider,
      canonical_symbol: snapshot.canonical_symbol,
      provider_symbol: snapshot.provider_symbol,
      timeframe: snapshot.timeframe,
      starts_at: snapshot.starts_at,
      ends_at: snapshot.ends_at,
      candle_close_policy: snapshot.candle_close_policy,
      candles,
    }),
  };
}

function sampleIdentityFrom(input: {
  sourceHashes: SimulationRunResponse['source_hashes'];
  marketDataSnapshot: MarketDataSnapshot;
  assumptionsHash: string;
  evaluationWindow: SimulationRunResponse['evaluation_window'];
}): SimulationSampleIdentity {
  return {
    scenario_hash: input.sourceHashes.scenario,
    playbook_hash: input.sourceHashes.trade_playbook,
    market_data_hash: input.marketDataSnapshot.dataset_hash,
    evaluation_window_hash: stableHash(input.evaluationWindow),
    assumptions_hash: input.assumptionsHash,
  };
}

function sourceHashesFromPlaybook(
  playbook: TradePlaybookResponse,
): SimulationRunResponse['source_hashes'] {
  return {
    scenario: playbook.source_hashes.scenario,
    decision_playbook: playbook.source_hashes.decision_playbook,
    recommendation: playbook.source_hashes.recommendation,
    trade_playbook: stableHash(playbook),
  };
}

function toSimulationRunResponse(value: unknown): SimulationRunResponse {
  return value as unknown as SimulationRunResponse;
}

function toPaperOrderResponse(value: unknown): PaperOrderResponse {
  return value as unknown as PaperOrderResponse;
}

function toPaperPositionResponse(value: unknown): PaperPositionResponse {
  return value as unknown as PaperPositionResponse;
}

function toExecutionEventResponse(value: unknown): ExecutionEventResponse {
  return value as unknown as ExecutionEventResponse;
}

function toSimulationOutcomeResponse(value: unknown): SimulationOutcomeResponse {
  return value as unknown as SimulationOutcomeResponse;
}

function simulationMode(value: unknown): SimulationMode {
  return value === 'replay' ? 'replay' : 'forward';
}

function validateSimulationTiming(
  mode: SimulationMode,
  input: CreateSimulationRequest,
): void {
  const startsAt = timestampOrNull(input.starts_at);
  const endsAt = timestampOrNull(input.ends_at);
  if (mode === 'replay') {
    if (input.starts_at === undefined || input.ends_at === undefined || input.ends_at === null) {
      throw new BadRequestException('Replay simulation requires starts_at and ends_at.');
    }
    if (startsAt === null || endsAt === null || startsAt >= endsAt) {
      throw new BadRequestException('Replay simulation requires a valid evaluation window.');
    }
  }

  if (input.setup_expiry_at === null || input.setup_expiry_at === undefined) {
    return;
  }
  const setupExpiry = timestampOrNull(input.setup_expiry_at);
  if (setupExpiry === null) {
    throw new BadRequestException('Simulation setup_expiry_at must be a valid timestamp.');
  }
  if (startsAt !== null && setupExpiry <= startsAt) {
    throw new BadRequestException('Simulation setup_expiry_at must be after starts_at.');
  }
  if (mode === 'replay' && endsAt !== null && setupExpiry > endsAt) {
    throw new BadRequestException('Replay setup_expiry_at must be within the evaluation window.');
  }
}

function timestampOrNull(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sampleKindValue(value: unknown, mode: SimulationMode): ReliabilitySampleKind {
  if (
    value === 'forward_observation' ||
    value === 'out_of_sample_replay' ||
    value === 'in_sample_replay' ||
    value === 'manual_experiment'
  ) {
    return value;
  }
  return mode === 'forward' ? 'forward_observation' : 'manual_experiment';
}

function validateSampleKindForMode(
  mode: SimulationMode,
  sampleKind: ReliabilitySampleKind,
): void {
  if (mode === 'forward' && sampleKind !== 'forward_observation') {
    throw new BadRequestException(
      'Forward simulations require sample_kind forward_observation.',
    );
  }
  if (mode === 'replay' && sampleKind === 'forward_observation') {
    throw new BadRequestException(
      'Replay simulations require replay or manual sample_kind.',
    );
  }
}

function closePolicyValue(input: CloseSimulationRequest): CloseSimulationRequest['close_policy'] {
  if (
    input?.close_policy === 'manual_close' ||
    input?.close_policy === 'abandon_inconclusive'
  ) {
    return input.close_policy;
  }
  throw new BadRequestException(
    'Closing a paper position requires close_policy manual_close or abandon_inconclusive.',
  );
}

function gapFillPolicy(value: unknown): SimulationAssumptions['gap_fill_policy'] {
  if (value === 'first_tradable_price' || value === 'reject_if_skipped') {
    return value;
  }
  return 'requested_price';
}

function intrabarPolicy(value: unknown): SimulationAssumptions['intrabar_policy'] {
  if (value === 'target_first' || value === 'ambiguous_warning') {
    return value;
  }
  return 'stop_first';
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function cloneJsonRecord(value: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function cloneJsonRecordOrNull(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return cloneJsonRecord(value as JsonRecord);
}

function jsonRecord(value: object): JsonRecord {
  return value as unknown as JsonRecord;
}

function jsonRecords(values: object[]): JsonRecord[] {
  return values.map(jsonRecord);
}

function sameRecord(left: JsonRecord, right: JsonRecord): boolean {
  return stableHash(left) === stableHash(right);
}

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function decimalFromUnknown(value: unknown, fallback: string): string {
  const parsed = decimalUnits(value);
  return parsed === null ? fallback : decimalFromUnits(parsed);
}

function decimalStringOrNull(value: unknown): DecimalString | null {
  const parsed = decimalUnits(value);
  return parsed === null ? null : decimalFromUnits(parsed);
}

function decimalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimal(value: unknown): string {
  return decimalFromUnits(decimalUnits(value) ?? 0n);
}

function decimalMul(left: unknown, right: unknown): string {
  return decimalFromUnits(decimalMulUnits(
    decimalUnits(left) ?? 0n,
    decimalUnits(right) ?? 0n,
  ));
}

function decimalMulUnits(left: bigint, right: bigint): bigint {
  return divRound(left * right, DECIMAL_SCALE);
}

function decimalRatio(numerator: bigint, denominator: bigint): string {
  return decimalFromUnits(denominator === 0n ? 0n : divRound(numerator * DECIMAL_SCALE, denominator));
}

function decimalUnits(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const raw = typeof value === 'number'
    ? Number.isFinite(value)
      ? value.toFixed(DECIMAL_SCALE_DIGITS)
      : ''
    : String(value).trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return null;
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0') * DECIMAL_SCALE;
  const fractionRaw = match[3] ?? '';
  const padded = fractionRaw.padEnd(DECIMAL_SCALE_DIGITS + 1, '0');
  const kept = padded.slice(0, DECIMAL_SCALE_DIGITS);
  const roundDigit = Number(padded[DECIMAL_SCALE_DIGITS] ?? '0');
  const fraction = BigInt(kept || '0') + (roundDigit >= 5 ? 1n : 0n);
  return sign * (whole + fraction);
}

function decimalFromUnits(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = (absolute % DECIMAL_SCALE)
    .toString()
    .padStart(DECIMAL_SCALE_DIGITS, '0')
    .replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    return 0n;
  }
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
  return sign * rounded;
}

function clampUnits(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function maxUnits(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function stableHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortForHash(value)))
    .digest('hex');
}

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForHash);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortForHash(child)]),
    );
  }
  return value;
}

function candleId(candle: MarketOhlcvCandleResponse): string {
  return candle.time;
}
