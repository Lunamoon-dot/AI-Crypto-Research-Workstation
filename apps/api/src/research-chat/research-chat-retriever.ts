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
    symbol: string | null,
    workspaceId: string,
    options: { allowWorkspaceFallback?: boolean } = {},
  ): Promise<ResearchChatContextPackResponse> {
    const normalizedSymbol = symbol ? normalizeCryptoSymbol(symbol) : null;
    const isGlobalScope = !normalizedSymbol;
    const [theses, runs, recentWorkspaceRuns, workspaceAlerts] = await Promise.all([
      this.journal.listTheses(100, workspaceId),
      this.journal.listResearchRuns(
        normalizedSymbol
          ? { symbol: normalizedSymbol, status: 'completed', limit: 5 }
          : { status: 'completed', limit: 5 },
        workspaceId,
      ),
      this.journal.listResearchRuns({ limit: 20 }, workspaceId),
      this.journal.listAlerts(undefined, undefined, false, 20, workspaceId),
    ]);
    const latestWorkspaceTheses = latestRowsByTime(
      theses,
      ['created_at', 'updated_at'],
      8,
    );
    const recentRuns = latestRowsByTime(
      recentWorkspaceRuns,
      ['completed_at', 'started_at'],
      12,
    );
    const latestWorkspaceAlerts = latestRowsByTime(
      workspaceAlerts,
      ['created_at'],
      12,
    );
    const workspaceSymbols = collectSymbols([
      ...theses,
      ...recentWorkspaceRuns,
      ...workspaceAlerts,
    ]);

    const symbolThesis = latestByTime(
      normalizedSymbol
        ? theses.filter((thesis) => stringValue(thesis.symbol) === normalizedSymbol)
        : [],
      ['created_at', 'updated_at'],
    );
    const workspaceLatestThesis = options.allowWorkspaceFallback === false || isGlobalScope
      ? null
      : latestByTime(theses, ['created_at', 'updated_at']);
    const latestThesis = symbolThesis ?? workspaceLatestThesis;
    const latestRun =
      latestByTime(runs, ['completed_at', 'started_at']) ??
      (normalizedSymbol && options.allowWorkspaceFallback === false
        ? null
        : latestByTime(await this.journal.listResearchRuns({ status: 'completed', limit: 5 }, workspaceId), [
            'completed_at',
            'started_at',
          ]));
    const previousRun =
      runs.filter((run) => stringValue(run.id) !== stringValue(latestRun?.id))[0] ??
      null;
    const latestThesisId = nullableString(latestThesis?.id);
    const contextSymbol =
      normalizedSymbol ??
      nullableString(latestThesis?.symbol) ??
      nullableString(latestRun?.symbol);
    const [continuityState, entries, marketSnapshot]: [
      JsonRecord | null,
      JsonRecord[],
      JsonRecord | null,
    ] = contextSymbol
      ? await Promise.all([
          this.journal.getResearchContinuityState(contextSymbol, workspaceId),
          this.journal.listResearchContinuityEntriesBySymbol(
            contextSymbol,
            5,
            workspaceId,
          ),
          this.journal.getLatestMarketSnapshot(contextSymbol, workspaceId),
        ])
      : [null, [], null];
    const activeScenarios = latestThesisId
      ? await this.journal.listScenarios(latestThesisId, workspaceId)
      : [];
    const latestAlerts = await this.journal.listAlerts(
      contextSymbol ?? undefined,
      latestThesisId ?? undefined,
      false,
      10,
      workspaceId,
    );
    const signalSnapshotId = nullableString(latestRun?.signal_snapshot_id);
    const signalSnapshot = signalSnapshotId
      ? await this.journal.getSignalSnapshot(signalSnapshotId, workspaceId)
      : null;
    const globalScenarioGroups = isGlobalScope
      ? await Promise.all(
          latestWorkspaceTheses
            .slice(0, 8)
            .map((thesis) => nullableString(thesis.id))
            .filter((id): id is string => Boolean(id))
            .map((thesisId) => this.journal.listScenarios(thesisId, workspaceId)),
        )
      : [];
    const globalScenarios = latestRowsByTime(
      globalScenarioGroups.flat(),
      ['created_at', 'updated_at'],
      12,
    );
    const globalMarketSnapshots = isGlobalScope
      ? (
          await Promise.all(
            workspaceSymbols
              .slice(0, 8)
              .map((item) => this.journal.getLatestMarketSnapshot(item, workspaceId)),
          )
        ).filter((snapshot): snapshot is JsonRecord => Boolean(snapshot))
      : [];
    const signalSnapshotIds = uniqueStrings(
      recentRuns
        .map((run) => nullableString(run.signal_snapshot_id))
        .filter((id): id is string => Boolean(id)),
    ).slice(0, 8);
    const globalSignalSnapshots = isGlobalScope
      ? (
          await Promise.all(
            signalSnapshotIds.map((id) =>
              this.journal.getSignalSnapshot(id, workspaceId),
            ),
          )
        ).filter((snapshot): snapshot is JsonRecord => Boolean(snapshot))
      : [];

    return {
      symbol: isGlobalScope ? 'global' : normalizedSymbol,
      latest_thesis: latestThesis,
      latest_run: latestRun,
      previous_run: previousRun,
      continuity_state: continuityState,
      recent_continuity_entries: entries,
      active_scenarios: activeScenarios,
      latest_alerts: latestAlerts,
      market_snapshot: marketSnapshot,
      signal_snapshot: signalSnapshot,
      workspace_inventory: {
        symbols: workspaceSymbols,
        thesis_count: theses.length,
        run_count: recentWorkspaceRuns.length,
        completed_run_count: recentWorkspaceRuns.filter(
          (run) => stringValue(run.status) === 'completed',
        ).length,
        alert_count: workspaceAlerts.length,
        scenario_count: isGlobalScope ? globalScenarios.length : activeScenarios.length,
        market_snapshot_count: isGlobalScope
          ? globalMarketSnapshots.length
          : marketSnapshot
            ? 1
            : 0,
        signal_snapshot_count: isGlobalScope
          ? globalSignalSnapshots.length
          : signalSnapshot
            ? 1
            : 0,
      },
      global_artifacts: {
        latest_theses: isGlobalScope ? latestWorkspaceTheses : [],
        recent_runs: isGlobalScope ? recentRuns : [],
        latest_alerts: isGlobalScope ? latestWorkspaceAlerts : [],
        active_scenarios: isGlobalScope ? globalScenarios : [],
        market_snapshots: globalMarketSnapshots,
        signal_snapshots: globalSignalSnapshots,
      },
    };
  }
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function latestByTime(rows: JsonRecord[], fields: string[]): JsonRecord | null {
  return latestRowsByTime(rows, fields, 1)[0] ?? null;
}

function latestRowsByTime(
  rows: JsonRecord[],
  fields: string[],
  limit: number,
): JsonRecord[] {
  return [...rows]
    .sort((left, right) => {
      const leftTime = firstString(left, fields);
      const rightTime = firstString(right, fields);
      return (
        rightTime.localeCompare(leftTime) ||
        stringValue(right.id).localeCompare(stringValue(left.id))
      );
    })
    .slice(0, limit);
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

function collectSymbols(rows: JsonRecord[]): string[] {
  return uniqueStrings(
    rows
      .map((row) => nullableString(row.symbol))
      .filter((symbol): symbol is string => Boolean(symbol))
      .map((symbol) => normalizeCryptoSymbol(symbol)),
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
