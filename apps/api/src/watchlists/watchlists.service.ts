import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { normalizeCryptoSymbol } from '../common/market-symbols';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  AlertResponse,
  toAlertResponse,
  toWatchlistItemResponse,
  toWatchlistResponse,
} from '../contracts/frontend-contract';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';
import { CheckWatchlistDto } from './dto/check-watchlist.dto';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { UpdateWatchlistDto } from './dto/update-watchlist.dto';
import {
  MarketPriceService,
  PriceResolution,
} from '../market-data/market-price.service';

export interface WatchlistCheckResponse {
  workspace_id: string;
  watchlist_id: string;
  checked_items: number;
  alerts_created: AlertResponse[];
  skipped_items: string[];
}

export interface WatchlistPollResponse {
  checked_watchlists: number;
  alerts_created: number;
  skipped_items: string[];
}

@Injectable()
export class WatchlistsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WatchlistsService.name);
  private alertPollTimer: ReturnType<typeof setInterval> | null = null;
  private alertPollRunning = false;

  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly marketPrices: MarketPriceService,
  ) {}

  onModuleInit(): void {
    if (!envFlag('WATCHLIST_ALERT_POLL_ENABLED', false)) {
      return;
    }
    const intervalMs = numberEnv('WATCHLIST_ALERT_POLL_INTERVAL_MS', 60_000);
    if (envFlag('WATCHLIST_ALERT_POLL_ON_START', true)) {
      void this.runAlertPoll();
    }
    this.alertPollTimer = setInterval(() => {
      void this.runAlertPoll();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.alertPollTimer) {
      clearInterval(this.alertPollTimer);
      this.alertPollTimer = null;
    }
  }

  async list(limit = 50, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const watchlists = await this.journal.listWatchlists(
      normalizeLimit(limit),
      workspaceId,
    );
    return watchlists.map(toWatchlistResponse);
  }

  async create(
    dto: CreateWatchlistDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const watchlist = await this.journal.createWatchlist(
      { name: dto.name.trim(), enabled: dto.enabled },
      workspaceId,
    );
    return toWatchlistResponse(watchlist);
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const watchlist = await this.journal.getWatchlist(id, workspaceId);
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    return toWatchlistResponse(watchlist);
  }

  async items(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'viewer',
    );
    const watchlist = await this.journal.getWatchlist(id, workspaceId);
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    const items = await this.journal.listWatchlistItems(id, workspaceId);
    return items.map(toWatchlistItemResponse);
  }

  async addItem(
    id: string,
    dto: AddWatchlistItemDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const itemInput = await this.normalizeItemInput(dto, workspaceId);
    const item = await this.journal.addWatchlistItem(id, itemInput, workspaceId);
    return toWatchlistItemResponse(item);
  }

  async update(
    id: string,
    dto: UpdateWatchlistDto,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const watchlist = await this.journal.updateWatchlist(
      id,
      {
        name: dto.name?.trim(),
        enabled: dto.enabled,
      },
      workspaceId,
    );
    return toWatchlistResponse(watchlist);
  }

  async removeItem(
    id: string,
    itemId: string,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    return this.journal.removeWatchlistItem(id, itemId, workspaceId);
  }

  async check(
    id: string,
    dto: CheckWatchlistDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<WatchlistCheckResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    return this.checkWorkspaceWatchlist(id, dto, workspaceId);
  }

  async pollAlerts(): Promise<WatchlistPollResponse> {
    const watchlists = await this.journal.listEnabledWatchlists(
      numberEnv('WATCHLIST_ALERT_POLL_LIMIT', 100),
    );
    const skipped: string[] = [];
    let checkedWatchlists = 0;
    let alertsCreated = 0;

    for (const watchlist of watchlists) {
      const id = nullableString(watchlist.id);
      const workspaceId = nullableString(watchlist.workspace_id);
      if (!id || !workspaceId) {
        skipped.push('watchlist: missing id or workspace');
        continue;
      }
      try {
        const result = await this.checkWorkspaceWatchlist(id, {}, workspaceId);
        checkedWatchlists += 1;
        alertsCreated += result.alerts_created.length;
        for (const item of result.skipped_items) {
          skipped.push(`${id}: ${item}`);
        }
      } catch (error) {
        skipped.push(`${id}: ${errorMessage(error)}`);
      }
    }

    return {
      checked_watchlists: checkedWatchlists,
      alerts_created: alertsCreated,
      skipped_items: skipped,
    };
  }

  async checkWorkspaceWatchlist(
    id: string,
    dto: CheckWatchlistDto,
    workspaceId: string,
  ): Promise<WatchlistCheckResponse> {
    const watchlist = await this.journal.getWatchlist(id, workspaceId);
    if (!watchlist) {
      throw new NotFoundException(`Watchlist ${id} not found`);
    }
    const prices = normalizePrices(dto.prices);
    const items = await this.journal.listWatchlistItems(id, workspaceId);
    const alerts: JsonRecord[] = [];
    const skipped: string[] = [];
    const priceCache = new Map<string, PriceResolution>();

    for (const item of items) {
      if (!booleanValue(item.enabled, true)) {
        skipped.push(`${stringValue(item.id, 'item')}: disabled`);
        continue;
      }
      const itemType = stringValue(item.item_type, 'symbol');
      if (itemType !== 'thesis') {
        if (itemType === 'symbol') {
          const symbol = stringValue(item.symbol);
          if (symbol) {
            const price = await this.resolveWatchlistPrice(
              symbol,
              workspaceId,
              prices,
              priceCache,
            );
            if (price.warning) {
              skipped.push(`${stringValue(item.id, 'item')}: ${price.warning}`);
            }
            if (price.price === null) {
              skipped.push(
                `${stringValue(item.id, 'item')}: no current price for ${symbol}`,
              );
            }
          }
        }
        skipped.push(`${stringValue(item.id, 'item')}: no thesis monitoring rule`);
        continue;
      }
      const thesisId = nullableString(item.thesis_id);
      if (!thesisId) {
        skipped.push(`${stringValue(item.id, 'item')}: missing thesis id`);
        continue;
      }
      const thesis = await this.journal.getThesis(thesisId, workspaceId);
      if (!thesis) {
        skipped.push(`${stringValue(item.id, 'item')}: thesis not found`);
        continue;
      }
      const symbol = stringValue(thesis.symbol ?? item.symbol);
      const price = await this.resolveWatchlistPrice(
        symbol,
        workspaceId,
        prices,
        priceCache,
      );
      if (price.warning) {
        skipped.push(`${stringValue(item.id, 'item')}: ${price.warning}`);
      }
      if (price.price === null) {
        skipped.push(`${stringValue(item.id, 'item')}: no current price for ${symbol}`);
        continue;
      }
      alerts.push(
        ...(await this.evaluateThesisItem(item, thesis, price.price, workspaceId)),
      );
    }

    return {
      workspace_id: workspaceId,
      watchlist_id: id,
      checked_items: items.length,
      alerts_created: alerts.map(toAlertResponse),
      skipped_items: skipped,
    };
  }

  private async runAlertPoll(): Promise<void> {
    if (this.alertPollRunning) {
      return;
    }
    this.alertPollRunning = true;
    try {
      const result = await this.pollAlerts();
      if (result.alerts_created > 0 || result.skipped_items.length > 0) {
        this.logger.log(
          `Watchlist alert poll checked ${result.checked_watchlists} watchlist(s), created ${result.alerts_created} alert(s), skipped ${result.skipped_items.length} item(s).`,
        );
      }
    } catch (error) {
      this.logger.warn(`Watchlist alert poll failed: ${errorMessage(error)}`);
    } finally {
      this.alertPollRunning = false;
    }
  }

  private async resolveWatchlistPrice(
    symbol: string,
    workspaceId: string,
    prices: Record<string, number>,
    priceCache: Map<string, PriceResolution>,
  ): Promise<PriceResolution> {
    const priceKey = symbol.trim().toUpperCase();
    const cached = priceCache.get(priceKey);
    if (cached) {
      return cached;
    }
    const price = await this.marketPrices.resolveFreshPrice(
      symbol,
      workspaceId,
      prices,
    );
    priceCache.set(priceKey, price);
    return price;
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
    requiredRole: 'viewer' | 'editor' = 'viewer',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }

  private async evaluateThesisItem(
    item: JsonRecord,
    thesis: JsonRecord,
    currentPrice: number,
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const alerts: JsonRecord[] = [];
    const direction = stringValue(thesis.direction, 'long').toLowerCase();
    const invalidation = firstLevel(
      firstString(
        thesis.invalidation_level,
        thesis.invalidation,
        recordValue(thesis.structured_summary).invalidation,
      ),
    );
    if (
      invalidation !== null &&
      isInvalidationTriggered(direction, currentPrice, invalidation)
    ) {
      const alert = await this.createAlertOnce({
        alertType: 'thesis_invalidated',
        item,
        thesis,
        currentPrice,
        triggerLevel: invalidation,
        triggerKey: `thesis_invalidated:${stringValue(thesis.id)}:${formatLevel(invalidation)}`,
        message: `${stringValue(thesis.symbol)} thesis update: invalidation level ${formatLevel(invalidation)} was reached at ${formatLevel(currentPrice)}. Review thesis ${stringValue(thesis.id)}.`,
        workspaceId,
      });
      if (alert) {
        alerts.push(alert);
      }
    }

    for (const target of targetLevels(thesis)) {
      if (!isTargetTriggered(direction, currentPrice, target)) {
        continue;
      }
      const alert = await this.createAlertOnce({
        alertType: 'target_zone_reached',
        item,
        thesis,
        currentPrice,
        triggerLevel: target,
        triggerKey: `target_zone_reached:${stringValue(thesis.id)}:${formatLevel(target)}`,
        message: `${stringValue(thesis.symbol)} thesis update: target zone ${formatLevel(target)} was reached at ${formatLevel(currentPrice)}. Review thesis ${stringValue(thesis.id)}.`,
        workspaceId,
      });
      if (alert) {
        alerts.push(alert);
      }
    }
    return alerts;
  }

  private async normalizeItemInput(
    dto: AddWatchlistItemDto,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const itemType = stringValue(dto.item_type, 'symbol').trim();

    if (itemType === 'symbol') {
      const symbol = stringValue(dto.symbol).trim();
      if (!symbol) {
        throw new BadRequestException('Choose a symbol to track.');
      }
      return {
        item_type: 'symbol',
        symbol: normalizeCryptoSymbol(symbol),
        thesis_id: null,
        setup_type: null,
      };
    }

    if (itemType === 'thesis') {
      const thesisId = stringValue(dto.thesis_id).trim();
      if (!thesisId) {
        throw new BadRequestException('Select a research thesis to track.');
      }
      const thesis = await this.journal.getThesis(thesisId, workspaceId);
      if (!thesis) {
        return this.throwFriendlyThesisError(thesisId, workspaceId);
      }
      return {
        item_type: 'thesis',
        symbol: stringValue(thesis.symbol ?? dto.symbol).trim() || null,
        thesis_id: thesisId,
        setup_type: null,
      };
    }

    if (itemType === 'setup_type') {
      const setupType = stringValue(dto.setup_type).trim();
      if (!setupType) {
        throw new BadRequestException('Choose a setup type to track.');
      }
      return {
        item_type: 'setup_type',
        symbol: null,
        thesis_id: null,
        setup_type: setupType,
      };
    }

    throw new BadRequestException(
      'Track must be one of: symbol, thesis, or setup_type.',
    );
  }

  private async throwFriendlyThesisError(
    pastedId: string,
    workspaceId: string,
  ): Promise<never> {
    const run = await this.journal.getResearchRun(pastedId, workspaceId);
    const runThesisId = nullableString(run?.thesis_id);
    if (runThesisId) {
      throw new BadRequestException(
        `No thesis found for this ID. You pasted a run ID. Use thesis ${runThesisId} instead.`,
      );
    }
    if (run) {
      throw new BadRequestException(
        'No thesis found for this ID. The research run exists, but it has no thesis result yet.',
      );
    }
    throw new NotFoundException(`No thesis found for this ID: ${pastedId}`);
  }

  private async createAlertOnce(input: {
    alertType: string;
    item: JsonRecord;
    thesis: JsonRecord;
    currentPrice: number;
    triggerLevel: number;
    triggerKey: string;
    message: string;
    workspaceId: string;
  }): Promise<JsonRecord | null> {
    const thesisId = nullableString(input.thesis.id);
    const itemId = nullableString(input.item.id);
    const existing = await this.journal.findAlert(
      input.alertType,
      thesisId ?? undefined,
      itemId ?? undefined,
      input.triggerKey,
      input.workspaceId,
    );
    if (existing) {
      return null;
    }
    const now = new Date().toISOString();
    const alert = {
      id: `alert_${randomUUID().replaceAll('-', '')}`,
      workspace_id: input.workspaceId,
      alert_type: input.alertType,
      symbol: stringValue(input.thesis.symbol),
      thesis_id: thesisId,
      watchlist_item_id: itemId,
      trigger_key: input.triggerKey,
      created_at: now,
      read_at: null,
      message: input.message,
      payload: {
        trigger_key: input.triggerKey,
        current_price: input.currentPrice,
        trigger_level: input.triggerLevel,
        direction: stringValue(input.thesis.direction, 'watch'),
        source: 'api_watchlist_check',
      },
    };
    return this.journal.createAlert(alert, input.workspaceId);
  }
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function normalizePrices(value: Record<string, number> | undefined): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const prices: Record<string, number> = {};
  for (const [symbol, raw] of Object.entries(value)) {
    const price = Number(raw);
    if (!symbol.trim()) {
      throw new BadRequestException('Price override symbols must not be blank');
    }
    if (!Number.isFinite(price)) {
      throw new BadRequestException(`Invalid price override for ${symbol}`);
    }
    prices[symbol.trim()] = price;
  }
  return prices;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const result = nullableString(value);
    if (result) {
      return result;
    }
  }
  return '';
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
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

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function firstStringList(...values: unknown[]): string[] {
  for (const value of values) {
    const result = stringList(value);
    if (result.length > 0) {
      return result;
    }
  }
  return [];
}

function firstLevel(value: string): number | null {
  return extractLevels([value])[0] ?? null;
}

function targetLevels(thesis: JsonRecord): number[] {
  const summary = recordValue(thesis.structured_summary);
  return extractLevels(
    firstStringList(thesis.target_zones, summary.target_zones),
  );
}

function extractLevels(values: string[]): number[] {
  const levels: number[] = [];
  for (const value of values) {
    for (const match of value.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g)) {
      const parsed = Number(match[0].replaceAll(',', ''));
      if (Number.isFinite(parsed)) {
        levels.push(parsed);
      }
    }
  }
  return levels;
}

function isInvalidationTriggered(
  direction: string,
  currentPrice: number,
  invalidationLevel: number,
): boolean {
  return direction === 'short'
    ? currentPrice >= invalidationLevel
    : currentPrice <= invalidationLevel;
}

function isTargetTriggered(
  direction: string,
  currentPrice: number,
  targetLevel: number,
): boolean {
  return direction === 'short'
    ? currentPrice <= targetLevel
    : currentPrice >= targetLevel;
}

function formatLevel(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}
