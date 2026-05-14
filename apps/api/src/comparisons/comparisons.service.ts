import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { ComparisonResponse, DiffFieldResponse } from '../contracts/frontend-contract';
import { WorkspacesService } from '../workspaces/workspaces.service';

const MAJOR_FIELDS = new Set([
  'direction',
  'confidence',
  'invalidation_level',
  'supporting_signal_ids',
  'contradicting_signal_ids',
  'signal_ids',
  'status',
  'thesis',
]);

@Injectable()
export class ComparisonsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async theses(
    leftId: string,
    rightId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ComparisonResponse> {
    assertPair(leftId, rightId);
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const [left, right] = await Promise.all([
      this.journal.getThesis(leftId, workspaceId),
      this.journal.getThesis(rightId, workspaceId),
    ]);
    if (!left) {
      throw new NotFoundException(`Thesis ${leftId} not found`);
    }
    if (!right) {
      throw new NotFoundException(`Thesis ${rightId} not found`);
    }
    return buildThesisDiff(left, right, leftId, rightId);
  }

  async runs(
    leftId: string,
    rightId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ComparisonResponse> {
    assertPair(leftId, rightId);
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const [left, right] = await Promise.all([
      this.journal.getResearchRun(leftId, workspaceId),
      this.journal.getResearchRun(rightId, workspaceId),
    ]);
    if (!left) {
      throw new NotFoundException(`Research run ${leftId} not found`);
    }
    if (!right) {
      throw new NotFoundException(`Research run ${rightId} not found`);
    }
    const leftThesisId = nullableString(left.thesis_id);
    const rightThesisId = nullableString(right.thesis_id);
    const [leftThesis, rightThesis] = await Promise.all([
      leftThesisId ? this.journal.getThesis(leftThesisId, workspaceId) : null,
      rightThesisId ? this.journal.getThesis(rightThesisId, workspaceId) : null,
    ]);
    return buildRunDiff(left, right, leftId, rightId, leftThesis, rightThesis);
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return workspaceId;
  }
}

function buildThesisDiff(
  left: JsonRecord,
  right: JsonRecord,
  leftId: string,
  rightId: string,
): ComparisonResponse {
  const fields: Record<string, DiffFieldResponse> = {
    symbol: simpleField(left.symbol, right.symbol),
    direction: simpleField(left.direction, right.direction),
    confidence: simpleField(left.confidence, right.confidence),
    thesis_text: simpleField(left.thesis_text, right.thesis_text),
    invalidation_level: simpleField(
      firstString(left.invalidation_level, left.invalidation, recordValue(left.structured_summary).invalidation),
      firstString(right.invalidation_level, right.invalidation, recordValue(right.structured_summary).invalidation),
    ),
    supporting_signal_ids: listDelta(stringList(left.supporting_signal_ids), stringList(right.supporting_signal_ids)),
    contradicting_signal_ids: listDelta(stringList(left.contradicting_signal_ids), stringList(right.contradicting_signal_ids)),
    contradictions: listDelta(stringList(left.contradictions), stringList(right.contradictions)),
    risk_notes: listDelta(stringList(left.risk_notes), stringList(right.risk_notes)),
    evidence: evidenceDelta(recordValue(left.evidence), recordValue(right.evidence)),
  };
  return response('thesis_diff', leftId, rightId, fields, {
    cross_symbol: nullableString(left.symbol) !== nullableString(right.symbol),
    direction_flip: nullableString(left.direction) !== nullableString(right.direction),
  });
}

function buildRunDiff(
  left: JsonRecord,
  right: JsonRecord,
  leftId: string,
  rightId: string,
  leftThesis: JsonRecord | null,
  rightThesis: JsonRecord | null,
): ComparisonResponse {
  const fields: Record<string, DiffFieldResponse> = {
    symbol: simpleField(left.symbol, right.symbol),
    started_at: simpleField(left.started_at, right.started_at),
    completed_at: simpleField(left.completed_at, right.completed_at),
    status: simpleField(left.status, right.status),
    thesis_id: simpleField(left.thesis_id, right.thesis_id),
    debate_id: simpleField(left.debate_id, right.debate_id),
    signal_snapshot_id: simpleField(left.signal_snapshot_id, right.signal_snapshot_id),
    signal_ids: listDelta(runSignalIds(left), runSignalIds(right)),
  };
  const thesisDiff =
    leftThesis && rightThesis
      ? buildThesisDiff(leftThesis, rightThesis, nullableString(left.thesis_id) ?? leftId, nullableString(right.thesis_id) ?? rightId)
      : null;
  const diff = response('run_diff', leftId, rightId, fields, {
    direction_flip: Boolean(thesisDiff?.direction_flip),
  });
  if (thesisDiff?.changed_fields.length) {
    diff.changed_fields = [...diff.changed_fields, 'thesis'];
    diff.changed_count = diff.changed_fields.length;
    diff.change_severity = severity(diff.changed_fields);
    diff.severity_reasons = severityReasons(diff.changed_fields);
  }
  diff.thesis_diff = thesisDiff;
  return diff;
}

function response(
  kind: 'thesis_diff' | 'run_diff',
  leftId: string,
  rightId: string,
  fields: Record<string, DiffFieldResponse>,
  options: { cross_symbol?: boolean; direction_flip: boolean },
): ComparisonResponse {
  const changedFields = Object.entries(fields)
    .filter(([, value]) => value.changed)
    .map(([name]) => name);
  return {
    kind,
    id_a: leftId,
    id_b: rightId,
    cross_symbol: options.cross_symbol,
    direction_flip: options.direction_flip,
    changed_fields: changedFields,
    changed_count: changedFields.length,
    change_severity: severity(changedFields),
    severity_reasons: severityReasons(changedFields),
    fields,
  };
}

function simpleField(left: unknown, right: unknown): DiffFieldResponse {
  return { a: left ?? null, b: right ?? null, changed: !deepEqual(left, right) };
}

function listDelta(left: string[], right: string[]): DiffFieldResponse {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const common = [...leftSet].filter((item) => rightSet.has(item)).sort();
  const onlyA = [...leftSet].filter((item) => !rightSet.has(item)).sort();
  const onlyB = [...rightSet].filter((item) => !leftSet.has(item)).sort();
  return {
    common,
    only_a: onlyA,
    only_b: onlyB,
    changed: onlyA.length > 0 || onlyB.length > 0,
  };
}

function evidenceDelta(
  left: JsonRecord,
  right: JsonRecord,
): DiffFieldResponse {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const values: Record<string, DiffFieldResponse> = {};
  for (const key of keys) {
    values[key] = simpleField(left[key], right[key]);
  }
  return {
    keys,
    values,
    changed: Object.values(values).some((value) => value.changed),
  };
}

function severity(changedFields: string[]): string {
  if (changedFields.some((field) => MAJOR_FIELDS.has(field))) {
    return 'major';
  }
  return changedFields.length > 0 ? 'minor' : 'none';
}

function severityReasons(changedFields: string[]): string[] {
  const reasons: Record<string, string> = {
    direction: 'direction changed',
    confidence: 'confidence changed',
    invalidation_level: 'invalidation level changed',
    supporting_signal_ids: 'supporting signals changed',
    contradicting_signal_ids: 'contradicting signals changed',
    signal_ids: 'run signal set changed',
    status: 'run status changed',
    thesis: 'nested thesis diff has material changes',
  };
  const mapped = changedFields
    .map((field) => reasons[field])
    .filter((reason): reason is string => Boolean(reason));
  if (mapped.length > 0) {
    return mapped;
  }
  return changedFields.length > 0
    ? [`non-critical fields changed: ${changedFields.join(', ')}`]
    : ['no material changes'];
}

function runSignalIds(run: JsonRecord): string[] {
  const payload = recordValue(run.payload ?? run.payload_json);
  return firstStringList(run.signal_ids, payload.signal_ids, payload.supporting_signal_ids);
}

function assertPair(leftId: string | undefined, rightId: string | undefined): void {
  if (!leftId?.trim() || !rightId?.trim()) {
    throw new BadRequestException('Both left_id and right_id are required.');
  }
  if (leftId === rightId) {
    throw new BadRequestException('Choose two different IDs to compare.');
  }
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = nullableString(value);
    if (text) {
      return text;
    }
  }
  return '';
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
    const list = stringList(value);
    if (list.length > 0) {
      return list;
    }
  }
  return [];
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
