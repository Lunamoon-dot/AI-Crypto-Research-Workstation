import {
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { JournalRepository, JsonRecord } from './journal.types';

export class PrismaJournalRepository
  implements JournalRepository, OnModuleDestroy
{
  private readonly client?: PrismaClient;

  constructor(client?: PrismaClient) {
    if (client) {
      this.client = client;
    } else if (process.env.DATABASE_URL) {
      this.client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  async getResearchRun(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const row = await this.prisma().researchRun.findFirst({
      where: { id, workspaceId },
    });
    return row ? mapResearchRun(row) : null;
  }

  async listRunEvents(runId: string, workspaceId: string): Promise<JsonRecord[]> {
    const rows = await this.prisma().runEvent.findMany({
      where: { researchRunId: runId, workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapRunEvent);
  }

  async getMarketSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const row = await this.prisma().marketSnapshot.findFirst({
      where: { id, workspaceId },
    });
    return row ? mapMarketSnapshot(row) : null;
  }

  async getSignalSnapshot(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord | null> {
    const row = await this.prisma().signalSnapshot.findFirst({
      where: { id, workspaceId },
    });
    return row ? mapSignalSnapshot(row) : null;
  }

  async getDebate(id: string, workspaceId: string): Promise<JsonRecord | null> {
    const row = await this.prisma().debate.findFirst({
      where: { id, workspaceId },
    });
    return row ? mapDebate(row) : null;
  }

  async listAgentOpinions(
    debateId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const rows = await this.prisma().agentOpinion.findMany({
      where: { debateId, workspaceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapAgentOpinion);
  }

  async listTheses(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    const rows = await this.prisma().tradeThesis.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapThesis);
  }

  async getThesis(id: string, workspaceId: string): Promise<JsonRecord | null> {
    const row = await this.prisma().tradeThesis.findFirst({
      where: { id, workspaceId },
    });
    return row ? mapThesis(row) : null;
  }

  async listScenarios(
    thesisId: string,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const rows = await this.prisma().scenario.findMany({
      where: { thesisId, workspaceId },
      orderBy: { id: 'asc' },
    });
    return rows.map(mapScenario);
  }

  async recordThesisDecision(
    thesisId: string,
    action: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    await this.assertThesisInWorkspace(thesisId, workspaceId);
    const id = `decision_${randomUUID().replaceAll('-', '')}`;
    const decidedAt = new Date();
    const payload = {
      id,
      workspace_id: workspaceId,
      thesis_id: thesisId,
      action,
      user_notes: notes,
      decided_at: decidedAt.toISOString(),
    };
    await this.prisma().userDecision.create({
      data: {
        id,
        thesisId,
        action,
        decidedAt,
        userNotes: notes,
        payloadJson: toInputJson(payload),
      },
    });
    return payload;
  }

  async recordThesisReview(
    thesisId: string,
    result: string,
    notes: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    await this.assertThesisInWorkspace(thesisId, workspaceId);
    const id = `outcome_${randomUUID().replaceAll('-', '')}`;
    const reviewedAt = new Date();
    const payload = {
      id,
      workspace_id: workspaceId,
      thesis_id: thesisId,
      result,
      lessons: notes,
      reviewed_at: reviewedAt.toISOString(),
      invalidated: result === 'invalidated',
    };
    await this.prisma().outcomeReview.create({
      data: {
        id,
        thesisId,
        result,
        reviewedAt,
        invalidated: payload.invalidated ? 1 : 0,
        payloadJson: toInputJson(payload),
      },
    });
    return payload;
  }

  async listSignals(
    symbol: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const rows = await this.prisma().signal.findMany({
      where: { workspaceId, ...(symbol ? { symbol } : {}) },
      orderBy: { observedAt: 'desc' },
      take: limit,
    });
    return rows.map(mapSignal);
  }

  async listWatchlists(limit: number, workspaceId: string): Promise<JsonRecord[]> {
    const rows = await this.prisma().watchlist.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapWatchlist);
  }

  async addWatchlistItem(
    watchlistId: string,
    item: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const watchlist = await this.prisma().watchlist.findFirst({
      where: { id: watchlistId, workspaceId },
    });
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${watchlistId} not found`);
    }
    const id = `watch_item_${randomUUID().replaceAll('-', '')}`;
    const createdAt = new Date();
    const payload = {
      id,
      workspace_id: workspaceId,
      watchlist_id: watchlistId,
      item_type: stringValue(item.item_type, 'symbol'),
      symbol: nullableString(item.symbol),
      thesis_id: nullableString(item.thesis_id),
      setup_type: nullableString(item.setup_type),
      enabled: true,
      created_at: createdAt.toISOString(),
    };
    await this.prisma().watchlistItem.create({
      data: {
        id,
        watchlistId,
        itemType: payload.item_type,
        symbol: payload.symbol,
        thesisId: payload.thesis_id,
        setupType: payload.setup_type,
        enabled: 1,
        createdAt,
        payloadJson: toInputJson(payload),
      },
    });
    return payload;
  }

  async listDailyBriefs(
    date: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const rows = await this.prisma().marketBrief.findMany({
      where: {
        workspaceId,
        ...(date ? { briefDate: new Date(`${date}T00:00:00.000Z`) } : {}),
      },
      orderBy: date
        ? { createdAt: 'desc' }
        : [{ briefDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return rows.map(mapMarketBrief);
  }

  async listAlerts(
    symbol: string | undefined,
    thesisId: string | undefined,
    unreadOnly: boolean,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const rows = await this.prisma().alert.findMany({
      where: {
        workspaceId,
        ...(symbol ? { symbol } : {}),
        ...(thesisId ? { thesisId } : {}),
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapAlert);
  }

  async markAlertRead(id: string, workspaceId: string): Promise<JsonRecord> {
    const alert = await this.prisma().alert.findFirst({
      where: { id, workspaceId },
    });
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    const readAt = alert.readAt ?? new Date();
    const payload = {
      ...asRecord(alert.payloadJson),
      read_at: readAt.toISOString(),
    };
    const updated = await this.prisma().alert.update({
      where: { id },
      data: {
        readAt,
        payloadJson: toInputJson(payload),
      },
    });
    return mapAlert(updated);
  }

  private async assertThesisInWorkspace(
    thesisId: string,
    workspaceId: string,
  ): Promise<void> {
    const thesis = await this.prisma().tradeThesis.findFirst({
      where: { id: thesisId, workspaceId },
    });
    if (!thesis) {
      throw new NotFoundException(`Thesis ${thesisId} not found`);
    }
  }

  private prisma(): PrismaClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'DATABASE_URL is required for Prisma journal reads and writes.',
      );
    }
    return this.client;
  }
}

function mapResearchRun(row: {
  id: string;
  workspaceId: string;
  symbol: string;
  assetClass: string;
  timeframe: string | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  marketSnapshotId: string | null;
  signalSnapshotId: string | null;
  debateId: string | null;
  thesisId: string | null;
  decisionId: string | null;
  userDecisionId: string | null;
  outcomeReviewId: string | null;
  degradationReasonsJson: unknown;
  missingCoreDataJson: unknown;
  missingOptionalDataJson: unknown;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    symbol: row.symbol,
    asset_class: row.assetClass,
    timeframe: row.timeframe,
    status: row.status,
    started_at: row.startedAt.toISOString(),
    completed_at: toIso(row.completedAt),
    market_snapshot_id: row.marketSnapshotId,
    signal_snapshot_id: row.signalSnapshotId,
    debate_id: row.debateId,
    thesis_id: row.thesisId,
    decision_id: row.decisionId,
    user_decision_id: row.userDecisionId,
    outcome_review_id: row.outcomeReviewId,
    degradation_reasons: row.degradationReasonsJson,
    missing_core_data: row.missingCoreDataJson,
    missing_optional_data: row.missingOptionalDataJson,
  });
}

function mapRunEvent(row: {
  id: string;
  workspaceId: string;
  researchRunId: string;
  thesisId: string | null;
  eventType: string;
  createdAt: Date;
  message: string;
  payloadJson: unknown;
}): JsonRecord {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    research_run_id: row.researchRunId,
    thesis_id: row.thesisId,
    event_type: row.eventType,
    created_at: row.createdAt.toISOString(),
    message: row.message,
    payload: asRecord(row.payloadJson),
  };
}

function mapMarketSnapshot(row: {
  id: string;
  workspaceId: string;
  researchRunId: string | null;
  symbol: string;
  capturedAt: Date;
  currentPrice: number | null;
  source: string;
  sourceTimestamp: Date | null;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    research_run_id: row.researchRunId,
    symbol: row.symbol,
    captured_at: row.capturedAt.toISOString(),
    current_price: row.currentPrice,
    source: row.source,
    source_timestamp: toIso(row.sourceTimestamp),
    payload: asRecord(row.payloadJson),
  });
}

function mapSignalSnapshot(row: {
  id: string;
  workspaceId: string;
  researchRunId: string;
  symbol: string;
  capturedAt: Date;
  compositeSignalId: string | null;
  signalCount: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  staleCount: number;
  unknownFreshnessCount: number;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    research_run_id: row.researchRunId,
    symbol: row.symbol,
    captured_at: row.capturedAt.toISOString(),
    composite_signal_id: row.compositeSignalId,
    signal_count: row.signalCount,
    bullish_count: row.bullishCount,
    bearish_count: row.bearishCount,
    neutral_count: row.neutralCount,
    stale_count: row.staleCount,
    unknown_freshness_count: row.unknownFreshnessCount,
    payload: asRecord(row.payloadJson),
  });
}

function mapDebate(row: {
  id: string;
  workspaceId: string;
  researchRunId: string | null;
  symbol: string;
  consensusStance: string;
  conflictLevel: string;
  createdAt: Date;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    research_run_id: row.researchRunId,
    symbol: row.symbol,
    consensus_stance: row.consensusStance,
    conflict_level: row.conflictLevel,
    created_at: row.createdAt.toISOString(),
    payload: asRecord(row.payloadJson),
  });
}

function mapAgentOpinion(row: {
  id: string;
  workspaceId: string;
  debateId: string | null;
  researchRunId: string | null;
  agentName: string;
  agentRole: string;
  stance: string;
  confidence: number | null;
  createdAt: Date;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    debate_id: row.debateId,
    research_run_id: row.researchRunId,
    agent_name: row.agentName,
    agent_role: row.agentRole,
    stance: row.stance,
    confidence: row.confidence,
    created_at: row.createdAt.toISOString(),
    payload: asRecord(row.payloadJson),
  });
}

function mapThesis(row: {
  id: string;
  workspaceId: string;
  researchRunId: string | null;
  symbol: string;
  direction: string;
  setupType: string;
  confidence: number | null;
  createdAt: Date;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    research_run_id: row.researchRunId,
    symbol: row.symbol,
    direction: row.direction,
    setup_type: row.setupType,
    confidence: row.confidence,
    created_at: row.createdAt.toISOString(),
  });
}

function mapScenario(row: {
  id: string;
  workspaceId: string;
  thesisId: string;
  probabilityBand: string;
  suggestedUserAction: string;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    thesis_id: row.thesisId,
    probability_band: row.probabilityBand,
    suggested_user_action: row.suggestedUserAction,
    payload: asRecord(row.payloadJson),
  });
}

function mapSignal(row: {
  id: string;
  workspaceId: string;
  symbol: string;
  signalType: string;
  direction: string;
  confidence: number | null;
  observedAt: Date;
  source: string;
  sourceTimestamp: Date | null;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    symbol: row.symbol,
    signal_type: row.signalType,
    direction: row.direction,
    confidence: row.confidence,
    observed_at: row.observedAt.toISOString(),
    source: row.source,
    source_timestamp: toIso(row.sourceTimestamp),
  });
}

function mapWatchlist(row: {
  id: string;
  workspaceId: string;
  name: string;
  enabled: number;
  createdAt: Date;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
  });
}

function mapMarketBrief(row: {
  id: string;
  workspaceId: string;
  briefDate: Date;
  watchlistName: string;
  title: string;
  createdAt: Date;
  previousBriefId: string | null;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    brief_date: row.briefDate.toISOString().slice(0, 10),
    watchlist_name: row.watchlistName,
    title: row.title,
    created_at: row.createdAt.toISOString(),
    previous_brief_id: row.previousBriefId,
  });
}

function mapAlert(row: {
  id: string;
  workspaceId: string;
  alertType: string;
  symbol: string;
  thesisId: string | null;
  watchlistItemId: string | null;
  triggerKey: string | null;
  createdAt: Date;
  readAt: Date | null;
  message: string;
  payloadJson: unknown;
}): JsonRecord {
  return mergePayload(row.payloadJson, {
    id: row.id,
    workspace_id: row.workspaceId,
    alert_type: row.alertType,
    symbol: row.symbol,
    thesis_id: row.thesisId,
    watchlist_item_id: row.watchlistItemId,
    trigger_key: row.triggerKey,
    created_at: row.createdAt.toISOString(),
    read_at: toIso(row.readAt),
    message: row.message,
    payload: asRecord(row.payloadJson),
  });
}

function mergePayload(payload: unknown, fields: JsonRecord): JsonRecord {
  return { ...asRecord(payload), ...fields };
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as JsonRecord) };
  }
  return {};
}

function toInputJson(value: JsonRecord): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
