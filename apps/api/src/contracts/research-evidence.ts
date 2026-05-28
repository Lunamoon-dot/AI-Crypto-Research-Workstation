import { JsonRecord } from '../database/journal.types';

export type EvidenceKind = 'observed' | 'reasoning' | 'missing';

export type EvidenceQuality =
  | 'observed_backed'
  | 'reasoning_only'
  | 'missing_limited'
  | 'none';

export interface ResearchEvidenceItem extends JsonRecord {
  text: string;
  evidence_kind: EvidenceKind;
  source_artifact: string;
  source_id?: string;
  source_field?: string;
  evidence_type?: string;
  strength?: string;
}

export interface StructuredResearchItem extends JsonRecord {
  text: string;
  supporting_evidence: ResearchEvidenceItem[];
}

export interface EvidenceKindCounts {
  observed: number;
  reasoning: number;
  missing: number;
}

const TEXT_LIKE_FIELDS = ['text', 'summary', 'reason', 'description', 'message'];
const EVIDENCE_KINDS = new Set(['observed', 'reasoning', 'missing']);
const SOURCE_ARTIFACTS = new Set([
  'market_snapshot',
  'signal_snapshot',
  'trade_thesis',
  'agent_opinion',
  'research_debate',
  'research_run',
  'external_report',
  'unknown',
]);
const STRENGTHS = new Set(['low', 'medium', 'high', 'unknown']);

export function normalizeEvidenceItems(value: unknown): ResearchEvidenceItem[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return values
    .map((item) => normalizeEvidenceItem(item))
    .filter((item): item is ResearchEvidenceItem => item !== null);
}

export function normalizeResearchItems(value: unknown): StructuredResearchItem[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return values
    .map((item) => normalizeResearchItem(item))
    .filter((item): item is StructuredResearchItem => item !== null);
}

export function researchItemTextList(value: unknown): string[] {
  return normalizeResearchItems(value).map((item) => item.text);
}

export function evidenceKindCounts(value: unknown): EvidenceKindCounts {
  const counts: EvidenceKindCounts = { observed: 0, reasoning: 0, missing: 0 };
  for (const item of normalizeEvidenceItems(value)) {
    counts[item.evidence_kind] += 1;
  }
  return counts;
}

export function evidenceQualityFor(value: unknown): EvidenceQuality {
  const counts = evidenceKindCounts(value);
  if (counts.observed > 0) {
    return 'observed_backed';
  }
  if (counts.missing > 0) {
    return 'missing_limited';
  }
  if (counts.reasoning > 0) {
    return 'reasoning_only';
  }
  return 'none';
}

function normalizeEvidenceItem(value: unknown): ResearchEvidenceItem | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text
      ? {
          text,
          evidence_kind: 'reasoning',
          source_artifact: 'trade_thesis',
        }
      : null;
  }
  if (!isRecord(value)) {
    const text = nullableString(value);
    return text
      ? {
          text,
          evidence_kind: 'reasoning',
          source_artifact: 'trade_thesis',
        }
      : null;
  }
  const text = textLikeValue(value);
  if (!text) {
    return null;
  }
  const result: ResearchEvidenceItem = {
    ...value,
    text,
    evidence_kind: allowedValue(
      value.evidence_kind,
      EVIDENCE_KINDS,
      'reasoning',
    ) as EvidenceKind,
    source_artifact: allowedValue(
      value.source_artifact,
      SOURCE_ARTIFACTS,
      'unknown',
    ),
  };
  setOptionalString(result, 'source_id', value.source_id);
  setOptionalString(result, 'source_field', value.source_field);
  setOptionalString(result, 'evidence_type', value.evidence_type);
  if (
    value.strength !== undefined &&
    value.strength !== null &&
    value.strength !== ''
  ) {
    result.strength = allowedValue(value.strength, STRENGTHS, 'unknown');
  } else {
    delete result.strength;
  }
  return result;
}

function normalizeResearchItem(value: unknown): StructuredResearchItem | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? { text, supporting_evidence: [] } : null;
  }
  if (!isRecord(value)) {
    const text = nullableString(value);
    return text ? { text, supporting_evidence: [] } : null;
  }
  const text = textLikeValue(value);
  if (!text) {
    return null;
  }
  return {
    ...value,
    text,
    supporting_evidence: normalizeEvidenceItems(value.supporting_evidence),
  };
}

function textLikeValue(record: JsonRecord): string {
  for (const field of TEXT_LIKE_FIELDS) {
    const text = nullableString(record[field]);
    if (text) {
      return text;
    }
  }
  return '';
}

function setOptionalString(
  target: ResearchEvidenceItem,
  field: 'source_id' | 'source_field' | 'evidence_type',
  value: unknown,
): void {
  const text = nullableString(value);
  if (text) {
    target[field] = text;
  } else {
    delete target[field];
  }
}

function allowedValue(
  value: unknown,
  allowed: Set<string>,
  fallback: string,
): string {
  const normalized = nullableString(value)?.toLowerCase() ?? fallback;
  return allowed.has(normalized) ? normalized : fallback;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
