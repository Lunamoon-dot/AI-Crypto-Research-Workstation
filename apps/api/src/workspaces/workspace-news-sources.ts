import { BadRequestException } from '@nestjs/common';
import { JsonRecord } from '../database/journal.types';

export type WorkspaceNewsSourceType = 'rss' | 'atom';

export type WorkspaceNewsSourceTargetAnalyst = 'news' | 'social';

export type WorkspaceNewsSourceTrustTier =
  | 'high'
  | 'user_trusted'
  | 'medium'
  | 'low'
  | 'aggregator';

export interface WorkspaceNewsSource {
  id: string;
  name: string;
  type: WorkspaceNewsSourceType;
  url: string;
  category: string;
  trust_tier: WorkspaceNewsSourceTrustTier;
  target_analysts: WorkspaceNewsSourceTargetAnalyst[];
  scope: string[];
  official: boolean;
  enabled: boolean;
}

export interface WorkspaceNewsSourcesResponse {
  workspace_id: string;
  sources: WorkspaceNewsSource[];
}

export interface ResolvedWorkspaceNewsCatalog {
  resolved_source_packs: string[];
  sources: JsonRecord[];
}

type WorkspaceNewsSourceValidationOptions = {
  defaultScope?: string | null;
};

const SOURCE_TYPES = new Set<WorkspaceNewsSourceType>(['rss', 'atom']);
const TARGET_ANALYSTS = new Set<WorkspaceNewsSourceTargetAnalyst>([
  'news',
  'social',
]);
const TRUST_TIERS = new Set<WorkspaceNewsSourceTrustTier>([
  'high',
  'user_trusted',
  'medium',
  'low',
  'aggregator',
]);

const SYSTEM_CATALOG_SOURCES: JsonRecord[] = [
  {
    id: 'binance_announcements',
    name: 'Binance Announcements',
    type: 'rss',
    url: 'https://www.binance.com/en/support/announcement/rss',
    category: 'exchange_announcements',
    trust_tier: 'high',
    target_analysts: ['news'],
    scope: ['ALL'],
    official: true,
    source_origin: 'system_catalog',
  },
  {
    id: 'coinbase_blog',
    name: 'Coinbase Blog',
    type: 'rss',
    url: 'https://www.coinbase.com/blog/rss.xml',
    category: 'exchange_announcements',
    trust_tier: 'high',
    target_analysts: ['news'],
    scope: ['ALL'],
    official: true,
    source_origin: 'system_catalog',
  },
  {
    id: 'sec_press_releases',
    name: 'SEC Press Releases',
    type: 'rss',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    category: 'regulatory',
    trust_tier: 'high',
    target_analysts: ['news'],
    scope: ['ALL'],
    official: true,
    source_origin: 'system_catalog',
  },
  {
    id: 'coindesk',
    name: 'CoinDesk',
    type: 'rss',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    category: 'crypto_media',
    trust_tier: 'medium',
    target_analysts: ['news'],
    scope: ['ALL'],
    official: false,
    source_origin: 'system_catalog',
  },
  {
    id: 'bitcoin_core_blog',
    name: 'Bitcoin Core Blog',
    type: 'rss',
    url: 'https://bitcoincore.org/en/rss.xml',
    category: 'official_project',
    trust_tier: 'high',
    target_analysts: ['news'],
    scope: ['BTC'],
    official: true,
    source_origin: 'system_catalog',
  },
  {
    id: 'ethereum_blog',
    name: 'Ethereum Foundation Blog',
    type: 'rss',
    url: 'https://blog.ethereum.org/feed.xml',
    category: 'official_project',
    trust_tier: 'high',
    target_analysts: ['news'],
    scope: ['ETH'],
    official: true,
    source_origin: 'system_catalog',
  },
  {
    id: 'bnb_chain_blog',
    name: 'BNB Chain Blog',
    type: 'rss',
    url: 'https://www.bnbchain.org/en/blog/rss.xml',
    category: 'official_project',
    trust_tier: 'high',
    target_analysts: ['news'],
    scope: ['BNB'],
    official: true,
    source_origin: 'system_catalog',
  },
];

const SYSTEM_SOURCE_PACKS: Record<string, { source_ids: string[] }> = {
  pack_exchange_announcements: {
    source_ids: ['binance_announcements', 'coinbase_blog'],
  },
  pack_regulatory_us: {
    source_ids: ['sec_press_releases'],
  },
  pack_core_crypto_media: {
    source_ids: ['coindesk'],
  },
  pack_btc_official: {
    source_ids: ['bitcoin_core_blog'],
  },
  pack_eth_official: {
    source_ids: ['ethereum_blog'],
  },
  pack_bnb_official: {
    source_ids: ['bnb_chain_blog'],
  },
};

const DEFAULT_PACK_IDS_BY_SYMBOL: Record<string, string[]> = {
  BTC: ['pack_exchange_announcements', 'pack_regulatory_us', 'pack_btc_official'],
  ETH: ['pack_exchange_announcements', 'pack_regulatory_us', 'pack_eth_official'],
  BNB: ['pack_exchange_announcements', 'pack_regulatory_us', 'pack_bnb_official'],
};

const DEFAULT_SHARED_PACK_IDS = ['pack_exchange_announcements', 'pack_regulatory_us'];

export function validateWorkspaceNewsSources(
  input: unknown,
  options: WorkspaceNewsSourceValidationOptions = {},
): WorkspaceNewsSource[] {
  const record = objectValue(input);
  const rawSources = Array.isArray(record.sources) ? record.sources : [];
  if (rawSources.length > 25) {
    throw new BadRequestException('At most 25 workspace news sources are allowed.');
  }
  const sources = rawSources.map((source, index) =>
    validateWorkspaceNewsSource(source, index, options),
  );
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) {
      throw new BadRequestException(`Duplicate workspace news source id: ${source.id}`);
    }
    ids.add(source.id);
  }
  return sources;
}

export function toEngineNewsSource(source: WorkspaceNewsSource): JsonRecord {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    category: source.category,
    trust_tier: source.trust_tier,
    target_analysts: source.target_analysts,
    scope: source.scope,
    official: source.official,
  };
}

export function isWorkspaceNewsSourceTargetedTo(
  source: WorkspaceNewsSource,
  analyst: WorkspaceNewsSourceTargetAnalyst,
): boolean {
  return source.target_analysts.includes(analyst);
}

export function resolveSystemCatalogNewsSourcesForSymbol(
  symbol: string | null | undefined,
): ResolvedWorkspaceNewsCatalog {
  const baseSymbol = normalizeScopeItem(symbol);
  if (!baseSymbol) {
    return { resolved_source_packs: [], sources: [] };
  }
  const resolvedPackIds =
    DEFAULT_PACK_IDS_BY_SYMBOL[baseSymbol] ?? DEFAULT_SHARED_PACK_IDS;
  const catalogById = new Map(
    SYSTEM_CATALOG_SOURCES.map((source) => [String(source.id), source]),
  );
  const sources: JsonRecord[] = [];
  const seen = new Set<string>();
  for (const packId of resolvedPackIds) {
    const pack = SYSTEM_SOURCE_PACKS[packId];
    if (!pack) {
      continue;
    }
    for (const sourceId of pack.source_ids) {
      if (seen.has(sourceId)) {
        continue;
      }
      const source = catalogById.get(sourceId);
      if (!source || !sourceAppliesToSymbol(source, baseSymbol)) {
        continue;
      }
      seen.add(sourceId);
      sources.push({ ...source });
    }
  }
  return {
    resolved_source_packs: [...resolvedPackIds],
    sources,
  };
}

function validateWorkspaceNewsSource(
  input: unknown,
  index: number,
  options: WorkspaceNewsSourceValidationOptions,
): WorkspaceNewsSource {
  const record = objectValue(input);
  const name = requiredString(record.name, `sources[${index}].name`);
  const url = normalizeUrl(record.url, `sources[${index}].url`);
  const id = normalizeSourceId(record.id, name || url);
  const type = normalizeSourceType(record.type);
  const category = requiredString(record.category, `sources[${index}].category`);
  const trustTier = normalizeTrustTier(record.trust_tier);
  const targetAnalysts = normalizeTargetAnalysts(record.target_analysts);
  const scope = normalizeScope(record.scope, options.defaultScope);
  return {
    id,
    name,
    type,
    url,
    category,
    trust_tier: trustTier,
    target_analysts: targetAnalysts,
    scope,
    official: Boolean(record.official),
    enabled: record.enabled === undefined ? true : Boolean(record.enabled),
  };
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function requiredString(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new BadRequestException(`${field} must not be blank.`);
  }
  return normalized;
}

function normalizeUrl(value: unknown, field: string): string {
  const url = requiredString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException(`${field} must be a valid URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException(`${field} must use http or https.`);
  }
  return parsed.toString();
}

function normalizeSourceId(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim() ? value : fallback;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!slug) {
    throw new BadRequestException('News source id must not be blank.');
  }
  return slug;
}

function normalizeSourceType(value: unknown): WorkspaceNewsSourceType {
  const normalized = String(value ?? 'rss').trim().toLowerCase();
  if (!SOURCE_TYPES.has(normalized as WorkspaceNewsSourceType)) {
    throw new BadRequestException('News source type must be rss or atom.');
  }
  return normalized as WorkspaceNewsSourceType;
}

function normalizeTrustTier(value: unknown): WorkspaceNewsSourceTrustTier {
  const normalized = String(value ?? 'medium').trim().toLowerCase();
  if (!TRUST_TIERS.has(normalized as WorkspaceNewsSourceTrustTier)) {
    throw new BadRequestException('Unsupported news source trust tier.');
  }
  return normalized as WorkspaceNewsSourceTrustTier;
}

function normalizeTargetAnalysts(value: unknown): WorkspaceNewsSourceTargetAnalyst[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : ['news'];
  const normalized: WorkspaceNewsSourceTargetAnalyst[] = [];
  for (const value of values) {
    const analyst = String(value).trim().toLowerCase();
    if (!analyst) {
      continue;
    }
    if (!TARGET_ANALYSTS.has(analyst as WorkspaceNewsSourceTargetAnalyst)) {
      throw new BadRequestException(
        'News source target_analysts must include only news or social.',
      );
    }
    normalized.push(analyst as WorkspaceNewsSourceTargetAnalyst);
  }
  const unique = [...new Set(normalized)];
  if (unique.length === 0) {
    throw new BadRequestException(
      'News source target_analysts must include news or social.',
    );
  }
  return unique;
}

function normalizeScope(value: unknown, defaultScope?: string | null): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const normalized = rawValues
    .map((item) => normalizeScopeItem(item))
    .filter((item): item is string => Boolean(item));
  const unique = [...new Set(normalized)];
  if (unique.length > 0) {
    return unique;
  }
  const workspaceDefault = normalizeScopeItem(defaultScope);
  if (workspaceDefault) {
    return [workspaceDefault];
  }
  throw new BadRequestException(
    'News source scope requires the workspace symbol.',
  );
}

function sourceAppliesToSymbol(source: JsonRecord, symbol: string): boolean {
  const scope = Array.isArray(source.scope)
    ? source.scope.map((item) => normalizeScopeItem(item)).filter(Boolean)
    : [];
  return scope.includes('ALL') || scope.includes(symbol);
}

function normalizeScopeItem(value: unknown): string | null {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) {
    return null;
  }
  if (text === 'ALL') {
    return 'ALL';
  }
  return text.split('/')[0]?.split(':')[0]?.replace(/[^A-Z0-9]/g, '') || null;
}
