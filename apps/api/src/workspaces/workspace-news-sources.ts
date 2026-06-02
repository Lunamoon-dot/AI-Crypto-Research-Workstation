import { BadRequestException } from '@nestjs/common';
import { JsonRecord } from '../database/journal.types';

export type WorkspaceNewsSourceType = 'rss' | 'atom' | 'html';

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
  parser_mode?: 'html_list';
  selectors?: Record<string, string>;
}

export interface WorkspaceNewsSourcesResponse {
  workspace_id: string;
  sources: WorkspaceNewsSource[];
}

type WorkspaceNewsSourceValidationOptions = {
  defaultScope?: string | null;
};

const SOURCE_TYPES = new Set<WorkspaceNewsSourceType>(['rss', 'atom', 'html']);
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
    ...(source.parser_mode ? { parser_mode: source.parser_mode } : {}),
    ...(source.selectors ? { selectors: source.selectors } : {}),
  };
}

export function isWorkspaceNewsSourceTargetedTo(
  source: WorkspaceNewsSource,
  analyst: WorkspaceNewsSourceTargetAnalyst,
): boolean {
  return source.target_analysts.includes(analyst);
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
  const parserMode = normalizeParserMode(record.parser_mode, type);
  const selectors = normalizeSelectors(record.selectors, type);
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
    ...(parserMode ? { parser_mode: parserMode } : {}),
    ...(selectors ? { selectors } : {}),
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
    throw new BadRequestException('News source type must be rss, atom, or html.');
  }
  return normalized as WorkspaceNewsSourceType;
}

function normalizeParserMode(
  value: unknown,
  type: WorkspaceNewsSourceType,
): 'html_list' | undefined {
  if (type !== 'html') {
    return undefined;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized !== 'html_list') {
    throw new BadRequestException('HTML news source parser_mode must be html_list.');
  }
  return 'html_list';
}

function normalizeSelectors(
  value: unknown,
  type: WorkspaceNewsSourceType,
): Record<string, string> | undefined {
  if (type !== 'html') {
    return undefined;
  }
  const record = objectValue(value);
  return {
    item: requiredString(record.item, 'selectors.item'),
    title: requiredString(record.title, 'selectors.title'),
    link: requiredString(record.link, 'selectors.link'),
    date: requiredString(record.date, 'selectors.date'),
  };
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
