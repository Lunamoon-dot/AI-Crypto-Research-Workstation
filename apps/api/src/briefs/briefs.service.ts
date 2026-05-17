import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { BriefResponse, toBriefResponse } from '../contracts/frontend-contract';
import { CreateDailyBriefDto } from './dto/create-daily-brief.dto';

const DEFAULT_BRIEF_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

@Injectable()
export class BriefsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async daily(
    date?: string,
    limit = 20,
    userId?: string,
    workspaceHeader?: string,
    watchlistId?: string,
    watchlistName?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    const scopedWatchlistName = await this.resolveWatchlistName(
      watchlistId,
      watchlistName,
      workspaceId,
    );
    const today = currentBriefDate();
    const briefDate = normalizeOptionalBriefDate(date, today);
    const briefs = await this.journal.listDailyBriefs(
      briefDate,
      normalizeLimit(limit),
      workspaceId,
      scopedWatchlistName,
      today,
    );
    return briefs.map(toBriefResponse);
  }

  async createDaily(
    dto: CreateDailyBriefDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<BriefResponse> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'editor');

    const briefDate = normalizeBriefDate(dto.date);
    const watchlist = await this.resolveWatchlist(dto, workspaceId);
    const watchlistId = stringValue(watchlist.id);
    const watchlistName = stringValue(watchlist.name, 'default');
    const items = await this.journal.listWatchlistItems(watchlistId, workspaceId);
    const activeItems = uniqueWatchlistItems(
      items.filter((item) => booleanValue(item.enabled, true)),
    );
    const thesisRows = await this.resolveThesisRows(activeItems, workspaceId);
    const thesisIds = thesisRows.map((row) => stringValue(row.thesis.id));
    const itemIds = new Set(
      activeItems.map((item) => nullableString(item.id)).filter(isString),
    );
    const previous = await this.journal.getLatestMarketBrief(
      watchlistName,
      briefDate,
      workspaceId,
    );
    const scopedSymbols = unique([
      ...activeItems
        .filter((item) => stringValue(item.item_type, 'symbol') === 'symbol')
        .map((item) => nullableString(item.symbol))
        .filter(isString),
      ...thesisRows.map((row) => stringValue(row.thesis.symbol)),
    ]);
    const symbols = scopedSymbols.length > 0 ? scopedSymbols : DEFAULT_BRIEF_SYMBOLS;
    const assetSummaries = await Promise.all(
      symbols.map((symbol) => this.assetSummary(symbol, previous, workspaceId)),
    );
    const alerts = await this.scopedAlerts(
      itemIds,
      new Set(thesisIds),
      normalizeLimit(dto.alerts_limit ?? 20),
      workspaceId,
    );
    const thesisUpdates = thesisRows.map((row) =>
      thesisUpdate(row.thesis, alerts),
    );
    const watchlistChanges = [
      `Watchlist '${watchlistName}' has ${activeItems.length} active item(s).`,
      `${thesisRows.length} thesis-backed watch(es), ${symbolOnlyCount(activeItems)} symbol-only watch(es).`,
    ];
    const topSetups = topSetupsFromTheses(thesisRows.map((row) => row.thesis));
    const topRisks = topRisksFromBrief(assetSummaries, thesisRows, alerts);
    const memoryNotes = memoryNotesFromPrevious(previous, assetSummaries);
    const signalIds = unique(
      thesisRows.flatMap((row) => [
        ...stringList(row.thesis.supporting_signal_ids),
        ...stringList(row.thesis.contradicting_signal_ids),
      ]),
    );
    const createdAt = new Date().toISOString();
    const brief: JsonRecord = {
      id: `brief_${randomUUID().replaceAll('-', '')}`,
      workspace_id: workspaceId,
      brief_date: briefDate,
      watchlist_name: watchlistName,
      title: `Market Brief - ${briefDate}`,
      created_at: createdAt,
      previous_brief_id: nullableString(previous?.id),
      summary: regimeSummary(assetSummaries, thesisRows.length, alerts.length),
      key_points: [...watchlistChanges, ...topSetups, ...topRisks].slice(0, 8),
      asset_summaries: assetSummaries,
      thesis_updates: thesisUpdates,
      watchlist_changes: watchlistChanges,
      top_setups: topSetups,
      top_risks: topRisks,
      memory_notes: memoryNotes,
      thesis_ids: thesisIds,
      signal_ids: signalIds,
      payload: {
        source: 'api_postgres',
        evaluated_from_snapshots: dto.evaluate_snapshots ?? true,
        watchlist_id: watchlistId,
        watchlist_item_count: activeItems.length,
        alert_count: alerts.length,
      },
    };
    const saved =
      dto.save === false
        ? brief
        : await this.journal.saveMarketBrief(brief, workspaceId);
    return toBriefResponse(saved);
  }

  private async resolveWatchlist(
    dto: CreateDailyBriefDto,
    workspaceId: string,
  ): Promise<JsonRecord> {
    if (dto.watchlist_id) {
      const watchlist = await this.journal.getWatchlist(
        dto.watchlist_id,
        workspaceId,
      );
      if (!watchlist) {
        throw new NotFoundException(`Watchlist ${dto.watchlist_id} not found`);
      }
      return watchlist;
    }
    const watchlistName = dto.watchlist_name?.trim() || 'default';
    const named = await this.journal.getWatchlistByName(
      watchlistName,
      workspaceId,
    );
    if (named) {
      return named;
    }
    const [first] = await this.journal.listWatchlists(1, workspaceId);
    if (first && !dto.watchlist_name) {
      return first;
    }
    throw new NotFoundException(`Watchlist ${watchlistName} not found`);
  }

  private async resolveWatchlistName(
    watchlistId: string | undefined,
    watchlistName: string | undefined,
    workspaceId: string,
  ): Promise<string | undefined> {
    if (watchlistId) {
      const watchlist = await this.journal.getWatchlist(watchlistId, workspaceId);
      if (!watchlist) {
        throw new NotFoundException(`Watchlist ${watchlistId} not found`);
      }
      return stringValue(watchlist.name, 'default');
    }
    const trimmed = watchlistName?.trim();
    return trimmed || undefined;
  }

  private async resolveThesisRows(
    items: JsonRecord[],
    workspaceId: string,
  ): Promise<Array<{ item: JsonRecord; thesis: JsonRecord }>> {
    const rows: Array<{ item: JsonRecord; thesis: JsonRecord }> = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (stringValue(item.item_type, 'symbol') !== 'thesis') {
        continue;
      }
      const thesisId = nullableString(item.thesis_id);
      if (!thesisId) {
        continue;
      }
      if (seen.has(thesisId)) {
        continue;
      }
      seen.add(thesisId);
      const thesis = await this.journal.getThesis(thesisId, workspaceId);
      if (thesis) {
        rows.push({ item, thesis });
      }
    }
    return rows;
  }

  private async assetSummary(
    symbol: string,
    previous: JsonRecord | null,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const snapshot = await this.journal.getLatestMarketSnapshot(
      symbol,
      workspaceId,
    );
    const previousAsset = previousAssetSummary(previous, symbol);
    if (!snapshot) {
      return {
        symbol,
        current_price: null,
        market_regime: 'unknown',
        trend_direction: 'unknown',
        volatility_regime: 'unknown',
        source: null,
        source_timestamp: null,
        summary: 'No persisted market snapshot yet. Run research to populate this asset.',
        change_from_previous: previousAsset
          ? `${symbol}: current brief has no persisted snapshot to compare.`
          : null,
      };
    }
    const payload = recordValue(snapshot.payload ?? snapshot.payload_json);
    const currentPrice = numberValue(snapshot.current_price);
    const marketRegime = stringValue(
      snapshot.market_regime ?? payload.market_regime,
      'unknown',
    );
    return {
      symbol,
      current_price: currentPrice,
      market_regime: marketRegime,
      trend_direction: stringValue(
        snapshot.trend_direction ?? payload.trend_direction,
        'unknown',
      ),
      volatility_regime: stringValue(
        snapshot.volatility_regime ?? payload.volatility_regime,
        'unknown',
      ),
      source: nullableString(snapshot.source),
      source_timestamp: nullableString(snapshot.source_timestamp),
      summary: stringValue(
        snapshot.summary ?? payload.summary,
        'Latest persisted market snapshot available.',
      ),
      change_from_previous: compareAsset(previousAsset, currentPrice, marketRegime),
    };
  }

  private async scopedAlerts(
    itemIds: Set<string>,
    thesisIds: Set<string>,
    limit: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const alerts = await this.journal.listAlerts(
      undefined,
      undefined,
      false,
      Math.max(limit, 50),
      workspaceId,
    );
    const scoped = alerts
      .filter((alert) => {
        const itemId = nullableString(alert.watchlist_item_id);
        const thesisId = nullableString(alert.thesis_id);
        return (
          (itemId !== null && itemIds.has(itemId)) ||
          (thesisId !== null && thesisIds.has(thesisId))
        );
      });
    return uniqueAlerts(scoped).slice(0, limit);
  }
}

function normalizeBriefDate(value: string | undefined): string {
  const today = currentBriefDate();
  if (!value) {
    return today;
  }
  return normalizeRequiredBriefDate(value, today);
}

function normalizeOptionalBriefDate(
  value: string | undefined,
  today: string,
): string | undefined {
  return value ? normalizeRequiredBriefDate(value, today) : undefined;
}

function normalizeRequiredBriefDate(value: string, today: string): string {
  const briefDate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(briefDate)) {
    throw new BadRequestException('date must be a valid ISO date');
  }
  const parsed = new Date(`${briefDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== briefDate
  ) {
    throw new BadRequestException('date must be a valid ISO date');
  }
  if (briefDate > today) {
    throw new BadRequestException(
      'Brief date cannot be in the future. Choose today or an earlier date.',
    );
  }
  return briefDate;
}

function currentBriefDate(): string {
  return localDateString(new Date());
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function isString(value: string | null): value is string {
  return value !== null;
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => nullableString(item))
      .filter((item): item is string => item !== null);
  }
  const text = nullableString(value);
  return text ? [text] : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function uniqueWatchlistItems(items: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const deduped: JsonRecord[] = [];
  for (const item of items) {
    const key = watchlistItemKey(item);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    deduped.push(item);
  }
  return deduped;
}

function watchlistItemKey(item: JsonRecord): string | null {
  const itemType = stringValue(item.item_type, 'symbol').trim();
  if (itemType === 'thesis') {
    const thesisId = nullableString(item.thesis_id);
    return thesisId ? `thesis:${thesisId}` : null;
  }
  if (itemType === 'symbol') {
    const symbol = nullableString(item.symbol)?.trim().toUpperCase();
    return symbol ? `symbol:${symbol}` : null;
  }
  if (itemType === 'setup_type') {
    const setupType = nullableString(item.setup_type)?.trim().toLowerCase();
    return setupType ? `setup_type:${setupType}` : null;
  }
  return null;
}

function uniqueAlerts(alerts: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const deduped: JsonRecord[] = [];
  for (const alert of alerts) {
    const key = alertKey(alert);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    deduped.push(alert);
  }
  return deduped;
}

function alertKey(alert: JsonRecord): string | null {
  const payload = recordValue(alert.payload ?? alert.payload_json);
  const triggerKey = nullableString(alert.trigger_key ?? payload.trigger_key);
  const alertType = nullableString(alert.alert_type);
  const thesisId = nullableString(alert.thesis_id);
  const symbol = nullableString(alert.symbol);
  const message = nullableString(alert.message);
  if (!alertType && !triggerKey && !thesisId && !symbol && !message) {
    return nullableString(alert.id);
  }
  return [
    alertType ?? '',
    triggerKey ?? '',
    thesisId ?? '',
    symbol ?? '',
    message ?? '',
  ].join(':');
}

function symbolOnlyCount(items: JsonRecord[]): number {
  return items.filter((item) => stringValue(item.item_type, 'symbol') === 'symbol')
    .length;
}

function thesisUpdate(thesis: JsonRecord, alerts: JsonRecord[]): JsonRecord {
  const thesisId = stringValue(thesis.id);
  const summary = recordValue(thesis.structured_summary);
  return {
    thesis_id: thesisId,
    symbol: stringValue(thesis.symbol),
    direction: stringValue(thesis.direction, 'watch'),
    setup_type: stringValue(thesis.setup_type, 'unspecified'),
    confidence: numberValue(thesis.confidence),
    status: alerts.some((alert) => alert.thesis_id === thesisId)
      ? 'review alerts'
      : 'review',
    update: stringValue(
      thesis.thesis_text ?? summary.action_summary,
      'Review the saved thesis context.',
    ),
    invalidation_level: nullableString(
      thesis.invalidation_level ?? thesis.invalidation ?? summary.invalidation,
    ),
    recent_alerts: alerts
      .filter((alert) => alert.thesis_id === thesisId)
      .map((alert) => stringValue(alert.message))
      .slice(0, 3),
  };
}

function topSetupsFromTheses(theses: JsonRecord[]): string[] {
  const setups = theses.slice(0, 5).map((thesis) => {
    const confidence = numberValue(thesis.confidence);
    const confidenceText =
      confidence === null ? 'unknown confidence' : `${Math.round(confidence * 100)}%`;
    return `${stringValue(thesis.symbol)}: ${stringValue(thesis.setup_type, 'setup')} (${stringValue(thesis.direction, 'watch')}, ${confidenceText})`;
  });
  return setups.length ? setups : ['No active thesis setups saved yet.'];
}

function topRisksFromBrief(
  assets: JsonRecord[],
  thesisRows: Array<{ item: JsonRecord; thesis: JsonRecord }>,
  alerts: JsonRecord[],
): string[] {
  const risks: string[] = [];
  const missing = assets
    .filter((asset) => !asset.source_timestamp)
    .map((asset) => stringValue(asset.symbol));
  if (missing.length) {
    risks.push(`Missing source timestamps or snapshots for: ${missing.join(', ')}`);
  }
  for (const row of thesisRows) {
    const summary = recordValue(row.thesis.structured_summary);
    const invalidation = nullableString(
      row.thesis.invalidation_level ??
        row.thesis.invalidation ??
        summary.invalidation,
    );
    if (invalidation) {
      risks.push(
        `${stringValue(row.thesis.symbol)}: invalidation to monitor: ${invalidation}`,
      );
    }
  }
  for (const alert of alerts.slice(0, 3)) {
    risks.push(
      `${stringValue(alert.symbol)}: recent ${stringValue(alert.alert_type)} alert needs review.`,
    );
  }
  return risks.length
    ? risks
    : ['No persisted risk alerts. Review freshness before relying on this brief.'];
}

function memoryNotesFromPrevious(
  previous: JsonRecord | null,
  assets: JsonRecord[],
): string[] {
  if (!previous) {
    return ['No previous market brief found for this watchlist.'];
  }
  const notes = [
    `Previous brief: ${stringValue(previous.id)} from ${stringValue(previous.brief_date)}.`,
  ];
  notes.push(
    ...assets
      .map((asset) => nullableString(asset.change_from_previous))
      .filter(isString),
  );
  return notes.slice(0, 8);
}

function previousAssetSummary(
  previous: JsonRecord | null,
  symbol: string,
): JsonRecord | null {
  if (!previous) {
    return null;
  }
  const payload = recordValue(previous.payload ?? previous.payload_json);
  const assets = arrayRecords(previous.asset_summaries ?? payload.asset_summaries);
  return assets.find((asset) => asset.symbol === symbol) ?? null;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

function compareAsset(
  previous: JsonRecord | null,
  currentPrice: number | null,
  currentRegime: string,
): string | null {
  if (!previous) {
    return null;
  }
  const previousPrice = numberValue(previous.current_price);
  const previousRegime = stringValue(previous.market_regime, 'unknown');
  const parts: string[] = [];
  if (previousPrice !== null && currentPrice !== null && previousPrice !== 0) {
    parts.push(
      `${stringValue(previous.symbol)}: price changed ${formatPercent((currentPrice - previousPrice) / previousPrice)} from previous brief.`,
    );
  }
  if (previousRegime !== currentRegime) {
    parts.push(
      `${stringValue(previous.symbol)}: regime changed from ${previousRegime} to ${currentRegime}.`,
    );
  }
  return parts.length
    ? parts.join(' ')
    : `${stringValue(previous.symbol)}: no major persisted change from previous brief.`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function regimeSummary(
  assets: JsonRecord[],
  thesisCount: number,
  alertCount: number,
): string {
  const known = assets.filter(
    (asset) => stringValue(asset.market_regime, 'unknown') !== 'unknown',
  );
  if (!known.length) {
    return 'No persisted market regime snapshots yet. Brief is limited to watchlist and thesis memory.';
  }
  const counts = new Map<string, number>();
  for (const asset of known) {
    const regime = stringValue(asset.market_regime, 'unknown');
    counts.set(regime, (counts.get(regime) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return `Persisted market context leans ${dominant ?? 'unknown'}. Tracking ${thesisCount} active thesis/theses and ${alertCount} recent alert(s).`;
}
