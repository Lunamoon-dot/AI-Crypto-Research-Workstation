import { Inject, Injectable } from '@nestjs/common';
import { normalizeCryptoSymbol } from '../common/market-symbols';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import type {
  ResearchChatContextPackResponse,
  ResearchChatIntent,
} from './dto/research-chat.dto';

@Injectable()
export class ResearchChatRetriever {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  detectIntent(message: string): ResearchChatIntent {
    const normalized = message.toLowerCase();
    if (
      includesAny(normalized, [
        'khác',
        'diff',
        'difference',
        'hôm qua',
        'run trước',
        'previous',
        'changed',
      ])
    ) {
      return 'diff';
    }
    if (includesAny(normalized, ['scenario', 'kịch bản'])) {
      return 'scenario';
    }
    if (includesAny(normalized, ['risk', 'rủi ro', 'rui ro'])) {
      return 'risk';
    }
    if (
      includesAny(normalized, [
        'bias',
        'conviction',
        'chuyển bias',
        'vì sao',
        'why',
      ])
    ) {
      return 'bias';
    }
    if (includesAny(normalized, ['thesis', 'luận điểm', 'luan diem'])) {
      return 'thesis';
    }
    return 'general';
  }

  async retrieveLatest(
    symbol: string,
    workspaceId: string,
  ): Promise<ResearchChatContextPackResponse> {
    const normalizedSymbol = normalizeCryptoSymbol(symbol);
    const [theses, runs, continuityState, entries, marketSnapshot] =
      await Promise.all([
        this.journal.listTheses(100, workspaceId),
        this.journal.listResearchRuns(
          { symbol: normalizedSymbol, status: 'completed', limit: 5 },
          workspaceId,
        ),
        this.journal.getResearchContinuityState(normalizedSymbol, workspaceId),
        this.journal.listResearchContinuityEntriesBySymbol(
          normalizedSymbol,
          5,
          workspaceId,
        ),
        this.journal.getLatestMarketSnapshot(normalizedSymbol, workspaceId),
      ]);

    const symbolThesis = latestByTime(
      theses.filter((thesis) => stringValue(thesis.symbol) === normalizedSymbol),
      ['created_at', 'updated_at'],
    );
    const workspaceLatestThesis = latestByTime(theses, ['created_at', 'updated_at']);
    const latestThesis = symbolThesis ?? workspaceLatestThesis;
    const latestRun =
      latestByTime(runs, ['completed_at', 'started_at']) ??
      latestByTime(await this.journal.listResearchRuns({ status: 'completed', limit: 5 }, workspaceId), [
        'completed_at',
        'started_at',
      ]);
    const previousRun =
      runs.filter((run) => stringValue(run.id) !== stringValue(latestRun?.id))[0] ??
      null;
    const latestThesisId = nullableString(latestThesis?.id);
    const activeScenarios = latestThesisId
      ? await this.journal.listScenarios(latestThesisId, workspaceId)
      : [];
    const latestAlerts = await this.journal.listAlerts(
      normalizedSymbol,
      latestThesisId ?? undefined,
      false,
      10,
      workspaceId,
    );
    const signalSnapshotId = nullableString(latestRun?.signal_snapshot_id);
    const signalSnapshot = signalSnapshotId
      ? await this.journal.getSignalSnapshot(signalSnapshotId, workspaceId)
      : null;

    return {
      symbol:
        nullableString(latestThesis?.symbol) ??
        nullableString(latestRun?.symbol) ??
        normalizedSymbol,
      latest_thesis: latestThesis,
      latest_run: latestRun,
      previous_run: previousRun,
      continuity_state: continuityState,
      recent_continuity_entries: entries,
      active_scenarios: activeScenarios,
      latest_alerts: latestAlerts,
      market_snapshot: marketSnapshot,
      signal_snapshot: signalSnapshot,
    };
  }
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function latestByTime(rows: JsonRecord[], fields: string[]): JsonRecord | null {
  return (
    [...rows].sort((left, right) => {
      const leftTime = firstString(left, fields);
      const rightTime = firstString(right, fields);
      return (
        rightTime.localeCompare(leftTime) ||
        stringValue(right.id).localeCompare(stringValue(left.id))
      );
    })[0] ?? null
  );
}

function firstString(row: JsonRecord, fields: string[]): string {
  for (const field of fields) {
    const value = nullableString(row[field]);
    if (value) {
      return value;
    }
  }
  return '';
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown): string {
  return nullableString(value) ?? '';
}
