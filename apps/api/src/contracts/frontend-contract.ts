import { JsonRecord } from '../database/journal.types';

export interface WorkspacePermissionDto {
  user_id: string;
  workspace_id: string;
  role: string;
}

export interface ResearchRunQueuedResponse {
  run_id: string;
  workspace_id: string;
  status: string;
  job_id: string;
  queue_backend: 'bullmq' | 'memory' | 'inline';
  permission: WorkspacePermissionDto;
  result?: JsonRecord;
}

export interface ResearchRunResponse {
  id: string | null;
  run_id: string | null;
  workspace_id: string;
  symbol: string;
  asset_class: string;
  timeframe: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  thesis_id: string | null;
  decision_id: string | null;
  signal_snapshot_id: string | null;
  market_snapshot_id: string | null;
  degradation_reasons: string[];
  missing_core_data: string[];
  missing_optional_data: string[];
}

export interface ResearchRunEventResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  thesis_id: string | null;
  event_type: string;
  created_at: string | null;
  message: string;
  payload: JsonRecord;
}

export interface ThesisSummaryResponse {
  rating: string;
  direction: string;
  confidence: number | null;
  action_summary: string;
  entry_zone: string;
  upside_catalyst: string;
  invalidation: string;
  target_zones: string[];
  key_reasons: string[];
  risks: string[];
  is_degraded: boolean;
  degradation_reasons: string[];
}

export interface ThesisResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string | null;
  symbol: string;
  direction: string;
  setup_type: string;
  confidence: number | null;
  created_at: string | null;
  entry_zone: string;
  invalidation_level: string;
  target_zones: string[];
  thesis_text: string;
  summary: ThesisSummaryResponse;
  supporting_signal_ids: string[];
  contradicting_signal_ids: string[];
  stale_or_missing_data: string[];
  monitor_next: string[];
}

export interface ThesisDecisionResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  action: string;
  user_notes: string;
  decided_at: string | null;
}

export interface ThesisReviewResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  result: string;
  lessons: string;
  reviewed_at: string | null;
  invalidated: boolean;
}

export interface SignalResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  signal_type: string;
  direction: string;
  confidence: number | null;
  observed_at: string | null;
  source: string;
  source_timestamp: string | null;
  summary: string;
}

export interface WatchlistResponse {
  id: string | null;
  workspace_id: string;
  name: string;
  enabled: boolean;
  created_at: string | null;
}

export interface WatchlistItemResponse {
  id: string | null;
  workspace_id: string;
  watchlist_id: string;
  item_type: string;
  symbol: string | null;
  thesis_id: string | null;
  setup_type: string | null;
  enabled: boolean;
  created_at: string | null;
}

export interface BriefResponse {
  id: string | null;
  workspace_id: string;
  brief_date: string | null;
  watchlist_name: string | null;
  title: string;
  created_at: string | null;
  previous_brief_id: string | null;
  summary: string;
  key_points: string[];
  thesis_ids: string[];
  signal_ids: string[];
}

export function toResearchRunResponse(run: JsonRecord): ResearchRunResponse {
  return {
    id: nullableString(run.id),
    run_id: nullableString(run.run_id ?? run.id),
    workspace_id: stringValue(run.workspace_id, 'local'),
    symbol: stringValue(run.symbol),
    asset_class: stringValue(run.asset_class, 'crypto'),
    timeframe: nullableString(run.timeframe),
    status: stringValue(run.status, 'unknown'),
    started_at: nullableString(run.started_at),
    completed_at: nullableString(run.completed_at),
    thesis_id: nullableString(run.thesis_id),
    decision_id: nullableString(run.decision_id),
    signal_snapshot_id: nullableString(run.signal_snapshot_id),
    market_snapshot_id: nullableString(run.market_snapshot_id),
    degradation_reasons: stringList(run.degradation_reasons),
    missing_core_data: stringList(run.missing_core_data),
    missing_optional_data: stringList(run.missing_optional_data),
  };
}

export function toResearchRunEventResponse(
  event: JsonRecord,
): ResearchRunEventResponse {
  return {
    id: nullableString(event.id),
    workspace_id: stringValue(event.workspace_id, 'local'),
    research_run_id: nullableString(event.research_run_id),
    thesis_id: nullableString(event.thesis_id),
    event_type: stringValue(event.event_type),
    created_at: nullableString(event.created_at),
    message: stringValue(event.message),
    payload: recordValue(event.payload ?? event.payload_json),
  };
}

export function toThesisResponse(thesis: JsonRecord): ThesisResponse {
  const summary = recordValue(thesis.structured_summary);
  const entryZone = firstString(thesis.entry_zone, summary.entry_zone);
  const invalidation = firstString(
    thesis.invalidation_level,
    thesis.invalidation,
    summary.invalidation,
  );
  const targets = firstStringList(thesis.target_zones, summary.target_zones);
  return {
    id: nullableString(thesis.id),
    workspace_id: stringValue(thesis.workspace_id, 'local'),
    research_run_id: nullableString(thesis.research_run_id),
    symbol: stringValue(thesis.symbol),
    direction: stringValue(thesis.direction, 'watch'),
    setup_type: stringValue(thesis.setup_type, 'unspecified'),
    confidence: nullableNumber(thesis.confidence),
    created_at: nullableString(thesis.created_at),
    entry_zone: entryZone,
    invalidation_level: invalidation,
    target_zones: targets,
    thesis_text: stringValue(thesis.thesis_text),
    summary: toThesisSummaryResponse(summary, entryZone, invalidation, targets),
    supporting_signal_ids: stringList(thesis.supporting_signal_ids),
    contradicting_signal_ids: stringList(thesis.contradicting_signal_ids),
    stale_or_missing_data: stringList(thesis.stale_or_missing_data),
    monitor_next: stringList(thesis.monitor_next),
  };
}

export function toThesisDecisionResponse(
  decision: JsonRecord,
): ThesisDecisionResponse {
  return {
    id: nullableString(decision.id),
    workspace_id: stringValue(decision.workspace_id, 'local'),
    thesis_id: stringValue(decision.thesis_id),
    action: stringValue(decision.action),
    user_notes: stringValue(decision.user_notes),
    decided_at: nullableString(decision.decided_at),
  };
}

export function toThesisReviewResponse(review: JsonRecord): ThesisReviewResponse {
  return {
    id: nullableString(review.id),
    workspace_id: stringValue(review.workspace_id, 'local'),
    thesis_id: stringValue(review.thesis_id),
    result: stringValue(review.result),
    lessons: stringValue(review.lessons),
    reviewed_at: nullableString(review.reviewed_at),
    invalidated: booleanValue(review.invalidated),
  };
}

export function toSignalResponse(signal: JsonRecord): SignalResponse {
  const provenance = recordValue(signal.provenance);
  return {
    id: nullableString(signal.id),
    workspace_id: stringValue(signal.workspace_id, 'local'),
    symbol: stringValue(signal.symbol),
    signal_type: stringValue(signal.signal_type),
    direction: stringValue(signal.direction),
    confidence: nullableNumber(signal.confidence),
    observed_at: nullableString(signal.observed_at),
    source: stringValue(signal.source ?? provenance.source),
    source_timestamp: nullableString(signal.source_timestamp),
    summary: stringValue(signal.summary),
  };
}

export function toWatchlistResponse(watchlist: JsonRecord): WatchlistResponse {
  return {
    id: nullableString(watchlist.id),
    workspace_id: stringValue(watchlist.workspace_id, 'local'),
    name: stringValue(watchlist.name),
    enabled: booleanValue(watchlist.enabled, true),
    created_at: nullableString(watchlist.created_at),
  };
}

export function toWatchlistItemResponse(
  item: JsonRecord,
): WatchlistItemResponse {
  return {
    id: nullableString(item.id),
    workspace_id: stringValue(item.workspace_id, 'local'),
    watchlist_id: stringValue(item.watchlist_id),
    item_type: stringValue(item.item_type, 'symbol'),
    symbol: nullableString(item.symbol),
    thesis_id: nullableString(item.thesis_id),
    setup_type: nullableString(item.setup_type),
    enabled: booleanValue(item.enabled, true),
    created_at: nullableString(item.created_at),
  };
}

export function toBriefResponse(brief: JsonRecord): BriefResponse {
  return {
    id: nullableString(brief.id),
    workspace_id: stringValue(brief.workspace_id, 'local'),
    brief_date: nullableString(brief.brief_date),
    watchlist_name: nullableString(brief.watchlist_name),
    title: stringValue(brief.title),
    created_at: nullableString(brief.created_at),
    previous_brief_id: nullableString(brief.previous_brief_id),
    summary: stringValue(brief.summary ?? brief.action_summary),
    key_points: stringList(brief.key_points),
    thesis_ids: stringList(brief.thesis_ids),
    signal_ids: stringList(brief.signal_ids),
  };
}

function toThesisSummaryResponse(
  summary: JsonRecord,
  entryZone: string,
  invalidation: string,
  targetZones: string[],
): ThesisSummaryResponse {
  return {
    rating: stringValue(summary.rating, 'Hold'),
    direction: stringValue(summary.direction, 'watch'),
    confidence: nullableNumber(summary.confidence),
    action_summary: stringValue(summary.action_summary),
    entry_zone: entryZone,
    upside_catalyst: stringValue(summary.upside_catalyst),
    invalidation,
    target_zones: targetZones,
    key_reasons: stringList(summary.key_reasons),
    risks: stringList(summary.risks),
    is_degraded: booleanValue(summary.is_degraded),
    degradation_reasons: stringList(summary.degradation_reasons),
  };
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

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
}
