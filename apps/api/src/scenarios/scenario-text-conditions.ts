import type { JsonRecord } from '../database/journal.types';
import type { ScenarioDecisionCondition } from './scenario-decision.types';

const PRICE_PATTERN = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[\.,]\d+)?)(k|m)?`;

export function derivePriceConditionFromText(
  value: unknown,
): ScenarioDecisionCondition | null {
  const text = normalizeScenarioConditionText(value);
  if (!text) {
    return null;
  }
  const zone = matchPriceZone(text);
  if (zone) {
    return zone;
  }
  const supportBreak = matchSupportBreak(text);
  if (supportBreak !== null) {
    return { type: 'price_below', level: supportBreak };
  }
  const resistanceBreak = matchResistanceBreak(text);
  if (resistanceBreak !== null) {
    return { type: 'price_above', level: resistanceBreak };
  }
  const above = matchPriceCondition(text, [
    'above',
    'over',
    'reclaim',
    'reclaims',
    'reach',
    'reaches',
    'hit',
    'hits',
    'touch',
    'touches',
    'price action at',
    'at',
    'tren',
    'vuot',
    'dong cua tren',
    'dong cua ngay tren',
    'close above',
  ]);
  if (above) {
    return { type: 'price_above', level: above };
  }
  const below = matchPriceCondition(text, [
    'below',
    'under',
    'break below',
    'breaks below',
    'duoi',
    'mat',
    'lose',
    'loses',
    'pha vo',
    'dong cua duoi',
    'dong cua ngay duoi',
    'close below',
  ]);
  if (below) {
    return { type: 'price_below', level: below };
  }
  return null;
}

export function derivePriceConditionFromTexts(
  values: unknown[],
): ScenarioDecisionCondition | null {
  for (const value of values) {
    const condition = derivePriceConditionFromText(value);
    if (condition) {
      return condition;
    }
  }
  return null;
}

export function priceTriggerSpecFromText(values: unknown[]): JsonRecord | null {
  const condition = derivePriceConditionFromTexts(values);
  return condition ? { ...condition } : null;
}

export function firstPriceLevelFromText(value: unknown): number | null {
  const text = normalizeScenarioConditionText(value);
  if (!text) {
    return null;
  }
  const currencyMatch = text.match(new RegExp(`\\$${PRICE_PATTERN}\\b`, 'i'));
  if (currencyMatch) {
    return parsePriceLevel(currencyMatch[1], currencyMatch[2]);
  }
  const pattern = new RegExp(`\\b${PRICE_PATTERN}\\b`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const level = parsePriceLevel(match[1], match[2]);
    if (level !== null && (match[2] || level >= 10)) {
      return level;
    }
  }
  return null;
}

export function decisionConditionFromRecord(
  value: unknown,
): ScenarioDecisionCondition | null {
  const record = recordValue(value);
  const type = decisionConditionType(record.type);
  if (!type) {
    return null;
  }
  const level = numberValue(record.level);
  const zoneLow = numberValue(record.zone_low);
  const zoneHigh = numberValue(record.zone_high);
  const condition: ScenarioDecisionCondition = { type };
  if (level !== null) condition.level = level;
  if (zoneLow !== null) condition.zone_low = zoneLow;
  if (zoneHigh !== null) condition.zone_high = zoneHigh;
  const timeframe = stringValue(record.timeframe);
  if (timeframe) condition.timeframe = timeframe;
  const candleCloseRequired = booleanValue(record.candle_close_required);
  if (candleCloseRequired !== null) {
    condition.candle_close_required = candleCloseRequired;
  }
  const lookbackPeriods = numberValue(record.lookback_periods);
  if (lookbackPeriods !== null) condition.lookback_periods = lookbackPeriods;
  const multiplier = numberValue(record.multiplier);
  if (multiplier !== null) condition.multiplier = multiplier;
  const thresholdPct = numberValue(record.threshold_pct);
  if (thresholdPct !== null) condition.threshold_pct = thresholdPct;
  return condition;
}

export function normalizeScenarioConditionText(value: unknown): string {
  return stringValue(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchPriceCondition(
  normalizedText: string,
  phrases: string[],
): number | null {
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\s+(\\$?)${PRICE_PATTERN}\\b`, 'i');
    const match = normalizedText.match(pattern);
    if (!match) {
      continue;
    }
    const matchIndex = match.index ?? 0;
    const hasCurrency = match[1] === '$';
    const hasExplicitPriceContext = nearbyPriceContext(
      normalizedText,
      matchIndex,
    );
    if (isNegatedPricePhrase(normalizedText, matchIndex)) {
      continue;
    }
    if (
      !hasCurrency &&
      hasIndicatorContext(normalizedText, matchIndex) &&
      !hasExplicitPriceContext
    ) {
      continue;
    }
    if (!hasCurrency && !hasPriceContext(normalizedText, matchIndex, phrase)) {
      continue;
    }
    const level = parsePriceLevel(match[2], match[3]);
    if (level !== null) {
      return level;
    }
  }
  return null;
}

function matchSupportBreak(normalizedText: string): number | null {
  return firstDirectionalLevel(normalizedText, [
    new RegExp(
      `\\b(?:price\\s+)?breaks?\\s+(?:below\\s+)?support\\s+(?:at|near)?\\s*(\\$?)${PRICE_PATTERN}\\b`,
      'i',
    ),
    new RegExp(
      `\\b(?:gia\\s+)?pha\\s+vo\\s+(?:duoi\\s+)?(?:ho\\s+tro\\s+)?(?:tai|o|muc|vung)?\\s*(\\$?)${PRICE_PATTERN}\\b`,
      'i',
    ),
    new RegExp(
      `\\bsupport\\s+(?:at|near)?\\s*(\\$?)${PRICE_PATTERN}\\b.{0,48}\\bbreaks?\\b`,
      'i',
    ),
    new RegExp(
      `\\bho\\s+tro\\s+(?:tai|o|muc|vung)?\\s*(\\$?)${PRICE_PATTERN}\\b.{0,48}\\b(?:bi\\s+)?pha\\s+vo\\b`,
      'i',
    ),
  ]);
}

function matchResistanceBreak(normalizedText: string): number | null {
  return firstDirectionalLevel(normalizedText, [
    new RegExp(
      `\\b(?:price\\s+)?breaks?\\s+(?:above\\s+)?resistance\\s+(?:at|near)?\\s*(\\$?)${PRICE_PATTERN}\\b`,
      'i',
    ),
    new RegExp(
      `\\b(?:gia\\s+)?pha\\s+vo\\s+(?:tren\\s+)?(?:khang\\s+cu\\s+)?(?:tai|o|muc|vung)?\\s*(\\$?)${PRICE_PATTERN}\\b`,
      'i',
    ),
    new RegExp(
      `\\bresistance\\s+(?:at|near)?\\s*(\\$?)${PRICE_PATTERN}\\b.{0,48}\\bbreaks?\\b`,
      'i',
    ),
    new RegExp(
      `\\bkhang\\s+cu\\s+(?:tai|o|muc|vung)?\\s*(\\$?)${PRICE_PATTERN}\\b.{0,48}\\b(?:bi\\s+)?pha\\s+vo\\b`,
      'i',
    ),
  ]);
}

function firstDirectionalLevel(
  normalizedText: string,
  patterns: RegExp[],
): number | null {
  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (!match) {
      continue;
    }
    const level = parsePriceLevel(match[2], match[3]);
    if (level !== null) {
      return level;
    }
  }
  return null;
}

function matchPriceZone(normalizedText: string): ScenarioDecisionCondition | null {
  const pattern = new RegExp(
    `\\b(?:gia\\s+)?(?:cham|vao|ve|retest|test|near|vung|zone)\\s+\\$?${PRICE_PATTERN}\\s*[-–—]\\s*\\$?${PRICE_PATTERN}\\b`,
    'i',
  );
  const match = normalizedText.match(pattern);
  if (!match) {
    return null;
  }
  const first = parsePriceLevel(match[1], match[2]);
  const second = parsePriceLevel(match[3], match[4]);
  if (first === null || second === null) {
    return null;
  }
  return {
    type: 'price_in_zone',
    zone_low: Math.min(first, second),
    zone_high: Math.max(first, second),
  };
}

function hasPriceContext(
  normalizedText: string,
  matchIndex: number,
  phrase: string,
): boolean {
  if (
    [
      'above',
      'over',
      'below',
      'under',
      'break below',
      'breaks below',
      'reclaim',
      'reclaims',
      'reach',
      'reaches',
      'hit',
      'hits',
      'touch',
      'touches',
      'price action at',
      'lose',
      'loses',
      'close above',
      'close below',
      'dong cua tren',
      'dong cua ngay tren',
      'dong cua duoi',
      'dong cua ngay duoi',
    ].includes(phrase)
  ) {
    return true;
  }
  const start = Math.max(0, matchIndex - 32);
  const end = Math.min(normalizedText.length, matchIndex + 32);
  const nearby = normalizedText.slice(start, end);
  return /\b(price|gia|close|dong cua|support|resistance|khang cu|ho tro|level|muc|zone|vung)\b/.test(nearby);
}

function hasIndicatorContext(normalizedText: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 24);
  const nearby = normalizedText.slice(start, matchIndex);
  return /\b(rsi|volume|funding|oi|long\/short|l\/s|ratio|atr)\b/.test(nearby);
}

function nearbyPriceContext(normalizedText: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 32);
  const end = Math.min(normalizedText.length, matchIndex + 32);
  const nearby = normalizedText.slice(start, end);
  return /\b(price|gia|close|dong cua|support|resistance|khang cu|ho tro|level|muc|zone|vung)\b/.test(nearby);
}

function isNegatedPricePhrase(normalizedText: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 16);
  const nearby = normalizedText.slice(start, matchIndex);
  return /\b(khong|not|never|chua)\s*$/.test(nearby);
}

function parsePriceLevel(raw: string | undefined, suffix: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const normalized = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)
    ? raw.replaceAll(',', '')
    : raw.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (suffix === 'm') {
    return parsed * 1_000_000;
  }
  if (suffix === 'k') {
    return parsed * 1_000;
  }
  return parsed;
}

function decisionConditionType(value: unknown): ScenarioDecisionCondition['type'] | null {
  const type = stringValue(value);
  if (
    type === 'price_above' ||
    type === 'price_below' ||
    type === 'price_in_zone' ||
    type === 'price_reclaim_level' ||
    type === 'price_reject_level' ||
    type === 'volume_above_average' ||
    type === 'overextended_from_trigger'
  ) {
    return type;
  }
  return null;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return null;
}
