import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { JsonRecord } from '../../database/journal.types';
import type {
  ResearchContinuityDebugAuditDecision,
  ResearchContinuityDebugAuditReason,
  ResearchContinuityRepairRunStatus,
} from '../research-continuity-audit.types';

export class GenerateResearchContinuityDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export const RESEARCH_CONTINUITY_REPAIR_VERSION = 'research-continuity-v1.3';

export const RESEARCH_CONTINUITY_REPAIR_CASE_TYPES = [
  'missing_continuity',
  'skipped_or_degraded',
  'legacy_evidence',
] as const;

export type ResearchContinuityRepairCaseType =
  (typeof RESEARCH_CONTINUITY_REPAIR_CASE_TYPES)[number];

export const RESEARCH_CONTINUITY_SCHEDULED_REPAIR_MODES = [
  'disabled',
  'dry_run',
  'enabled',
] as const;

export type ResearchContinuityScheduledRepairMode =
  (typeof RESEARCH_CONTINUITY_SCHEDULED_REPAIR_MODES)[number];

export type ResearchContinuityRepairPredictedAction =
  | 'create_repair_entry'
  | 'already_repaired'
  | 'already_has_continuity'
  | 'not_eligible'
  | 'not_improved';

export type ResearchContinuityRepairRunAction =
  | 'created_repair_entry'
  | 'already_repaired'
  | 'already_has_continuity'
  | 'dry_run'
  | 'not_eligible'
  | 'not_improved'
  | 'failed';

export interface ResearchContinuityRepairPreviewFilters {
  symbol?: string;
  from?: string;
  to?: string;
  case_types?: string | ResearchContinuityRepairCaseType[];
  limit?: number | string;
}

export class RunResearchContinuityRepairDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsArray()
  @IsIn(RESEARCH_CONTINUITY_REPAIR_CASE_TYPES, { each: true })
  case_types!: ResearchContinuityRepairCaseType[];

  @IsInt()
  @Min(1)
  @Max(100)
  limit!: number;

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  @IsOptional()
  @IsString()
  idempotency_key?: string;
}

export class UpdateResearchContinuitySettingsDto {
  @IsOptional()
  @IsIn(RESEARCH_CONTINUITY_SCHEDULED_REPAIR_MODES)
  scheduled_repair_mode?: ResearchContinuityScheduledRepairMode;

  @IsOptional()
  @IsArray()
  @IsIn(RESEARCH_CONTINUITY_REPAIR_CASE_TYPES, { each: true })
  scheduled_repair_case_types?: ResearchContinuityRepairCaseType[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  scheduled_repair_interval_hours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  scheduled_repair_lookback_days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  scheduled_repair_limit?: number;
}

export interface ResearchContinuityWorkspaceSettingsResponse {
  workspace_id: string;
  scheduled_repair_mode: ResearchContinuityScheduledRepairMode;
  scheduled_repair_case_types: ResearchContinuityRepairCaseType[];
  scheduled_repair_interval_hours: number;
  scheduled_repair_lookback_days: number;
  scheduled_repair_limit: number;
  next_scheduled_repair_due_at: string | null;
  last_scheduled_repair_at: string | null;
  last_scheduled_repair_run_id: string | null;
  scheduler_lease_owner: string | null;
  scheduler_lease_expires_at: string | null;
  last_scheduler_attempt_at: string | null;
  last_scheduler_success_at: string | null;
  last_scheduler_error: string | null;
  consecutive_scheduler_failures: number;
  next_scheduler_retry_at: string | null;
  updated_by_user_id: string | null;
  updated_at: string | null;
}

export interface ResearchContinuitySchedulerStatusResponse {
  workspace_id: string;
  settings: ResearchContinuityWorkspaceSettingsResponse;
  due: boolean;
  disabled: boolean;
  dry_run: boolean;
  worker_enabled: boolean;
  next_scheduled_repair_due_at: string | null;
  last_scheduled_repair_at: string | null;
  last_scheduled_repair_run_id: string | null;
  last_scheduled_repair_status: string | null;
}

export interface ResearchContinuitySchedulerRunDueResponse {
  workspace_id: string;
  due: boolean;
  skipped_reason:
    | null
    | 'scheduler_disabled'
    | 'not_due'
    | 'no_case_types'
    | 'worker_lease_active'
    | 'settings_unavailable';
  dry_run: boolean;
  audit_run_id: string | null;
  repair_run: ResearchContinuityRepairRunResponse | null;
  next_scheduled_repair_due_at: string | null;
}

export interface ContinuitySectionResponse {
  title: string;
  items: string[];
  empty_state: string;
}

export type ResearchContinuityThinSectionId =
  | 'quality'
  | 'current_view'
  | 'material_changes'
  | 'active_risks'
  | 'watchpoints'
  | 'resolved_or_weakened'
  | 'evidence_health';

export interface ResearchContinuityThinSection {
  id: ResearchContinuityThinSectionId;
  title: string;
  items: string[];
}

export interface ResearchContinuityThinReport {
  version: 'research_continuity_thin.v1';
  generated_at: string | null;
  debug_available: boolean;
  debug_requires_role: 'editor';
  quality: {
    status: string;
    score: number | null;
    observed_evidence_coverage: number | null;
    evidence_coverage: number | null;
    provenance_status: string | null;
    warnings: string[];
  };
  sections: ResearchContinuityThinSection[];
}

export const RESEARCH_CONTINUITY_DEBUG_PERMISSION = 'view_debug_trace' as const;

export interface ResearchContinuityDebugAccessResponse {
  available: boolean;
  reason:
    | 'available'
    | 'disabled_by_policy'
    | 'permission_required'
    | 'not_available';
  requires_permission: typeof RESEARCH_CONTINUITY_DEBUG_PERMISSION;
  url: string | null;
  redacted: true;
}

export interface ResearchContinuityMarkdownArtifactResponse {
  kind: 'continuity_report';
  label: string;
  path: string | null;
  exists: boolean;
  size_bytes: number | null;
  modified_at: string | null;
}

export type ResearchContinuityDiffGroup =
  | 'added'
  | 'updated'
  | 'removed_resolved'
  | 'weakened'
  | 'context'
  | 'quality';

export type ResearchContinuityDiffQuality =
  | 'complete'
  | 'partial'
  | 'unavailable';

export type ResearchContinuityDiffSeverity =
  | 'info'
  | 'warning'
  | 'critical';

export type ResearchContinuityDiffItemType =
  | 'claim'
  | 'risk'
  | 'watchpoint'
  | 'level'
  | 'invalidation'
  | 'view'
  | 'quality'
  | 'unknown';

export interface ResearchContinuityDiffSummaryResponse {
  added_count: number;
  updated_count: number;
  removed_resolved_count: number;
  weakened_count: number;
  quality_count: number;
  has_material_changes: boolean;
  has_comparison: boolean;
  diff_quality: ResearchContinuityDiffQuality;
  is_repair: boolean;
  badges: string[];
  warnings: string[];
}

export interface ResearchContinuityChangedItemEvidenceResponse {
  status: string | null;
  source_artifact: string | null;
  source_id: string | null;
  source_field: string | null;
}

export interface ResearchContinuityChangedItemResponse {
  id: string;
  group: ResearchContinuityDiffGroup;
  event_type: string;
  item_type: ResearchContinuityDiffItemType;
  title: string;
  before: string | null;
  after: string | null;
  severity: ResearchContinuityDiffSeverity;
  evidence: ResearchContinuityChangedItemEvidenceResponse;
}

export interface ResearchContinuityChangeGroupResponse {
  group: ResearchContinuityDiffGroup;
  title: string;
  count: number;
  items: ResearchContinuityChangedItemResponse[];
}

export interface ResearchContinuityDiffReportResponse {
  version: 'research_continuity_diff.v1';
  summary: ResearchContinuityDiffSummaryResponse;
  change_groups: ResearchContinuityChangeGroupResponse[];
  changed_items: ResearchContinuityChangedItemResponse[];
}

export interface ResearchContinuityEntrySummaryResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  entry_type: 'baseline' | 'delta' | 'degraded' | 'skipped';
  status: 'completed' | 'degraded' | 'skipped' | 'failed';
  generated_at: string | null;
  summary: string;
  thin_report: ResearchContinuityThinReport | null;
  markdown_artifact: ResearchContinuityMarkdownArtifactResponse;
  diff_summary: ResearchContinuityDiffSummaryResponse;
  debug: ResearchContinuityDebugAccessResponse;
}

export interface ResearchContinuityQualityExplanationResponse {
  status: string;
  score: number | null;
  observed_evidence_coverage: number | null;
  evidence_coverage: number | null;
  provenance_status: string | null;
  warnings: string[];
  reasons: string[];
}

export interface ResearchContinuityEvidenceDigestResponse {
  observed_count: number | null;
  reasoning_count: number | null;
  missing_count: number | null;
  no_evidence_count: number | null;
  stale_count: number | null;
  observed_coverage: number | null;
  missing_categories: string[];
  stale_categories: string[];
  health_line: string;
}

export interface ResearchContinuityMaterialEventDigestResponse {
  type: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  evidence_status: string | null;
}

export interface ResearchContinuityStateTransitionDigestResponse {
  previous_entry_id: string | null;
  current_snapshot_id: string | null;
  source_run_ids: string[];
  transition: 'baseline' | 'delta' | 'degraded' | 'skipped';
  reason: string;
}

export interface ResearchContinuityEntryDetailResponse
  extends ResearchContinuityEntrySummaryResponse {
  diff_report: ResearchContinuityDiffReportResponse;
  quality_explanation: ResearchContinuityQualityExplanationResponse;
  evidence_digest: ResearchContinuityEvidenceDigestResponse;
  material_events_digest: ResearchContinuityMaterialEventDigestResponse[];
  state_transition: ResearchContinuityStateTransitionDigestResponse;
}

export interface ResearchContinuityEntryDebugResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  generated_at: string | null;
  debug_view: 'redacted';
  redacted: true;
  requested_by_user_id: string;
  returned_at: string;
  entry: {
    sections: ContinuitySectionResponse[];
    events: JsonRecord[];
    snapshot_quality: JsonRecord;
    source_run_ids: string[];
    writer_metadata: JsonRecord;
    payload: JsonRecord;
  };
}

export interface ResearchSnapshotResponse {
  id: string | null;
  workspace_id: string;
  research_run_id: string;
  symbol: string;
  captured_at: string | null;
  time_context: string;
  symbol_view: JsonRecord;
  tracked_items: JsonRecord[];
  data_quality: JsonRecord;
  source_artifacts: JsonRecord;
  payload: JsonRecord;
}

export interface ResearchContinuityEntryResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  current_snapshot_id: string | null;
  previous_entry_id: string | null;
  entry_type: 'baseline' | 'delta' | 'degraded' | 'skipped';
  status: 'completed' | 'degraded' | 'skipped' | 'failed';
  generated_at: string | null;
  summary: string;
  sections: ContinuitySectionResponse[];
  events: JsonRecord[];
  snapshot_quality: JsonRecord;
  source_run_ids: string[];
  writer_metadata: JsonRecord;
  payload: JsonRecord;
  thin_report?: ResearchContinuityThinReport | null;
  markdown_artifact?: ResearchContinuityMarkdownArtifactResponse;
}

export interface ResearchContinuityStateResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  current_snapshot_id: string | null;
  latest_entry_id: string | null;
  latest_run_id: string | null;
  current_view: JsonRecord;
  active_items: JsonRecord[];
  recent_resolved_items: JsonRecord[];
  recent_invalidated_items: JsonRecord[];
  data_quality: JsonRecord;
  updated_at: string | null;
}

export interface GenerateResearchContinuityResponse {
  created: boolean;
  entry: ResearchContinuityEntryDetailResponse;
}

export interface ResearchContinuityStateEnvelopeResponse {
  symbol: string;
  state: ResearchContinuityStateResponse | null;
  latest_entry: ResearchContinuityEntrySummaryResponse | null;
}

export interface ResearchContinuityEntriesResponse {
  symbol: string;
  entries: ResearchContinuityEntrySummaryResponse[];
}

export type ResearchContinuityLifecycleItemType =
  | 'claim'
  | 'risk'
  | 'watchpoint'
  | 'level'
  | 'invalidation'
  | 'view'
  | 'quality'
  | 'unknown';

export type ResearchContinuityLifecycleStatus =
  | 'active'
  | 'updated'
  | 'resolved'
  | 'weakened'
  | 'invalidated'
  | 'context'
  | 'quality';

export interface ResearchContinuityTimelineWindowResponse {
  entry_limit: number;
  truncated: boolean;
  coverage: 'complete' | 'windowed';
}

export interface ResearchContinuityTimelineEventResponse {
  id: string;
  entry_id: string;
  research_run_id: string | null;
  observed_at: string | null;
  recorded_at: string | null;
  event_type: string;
  stable_item_key: string | null;
  item_type: ResearchContinuityLifecycleItemType;
  status: ResearchContinuityLifecycleStatus;
  title: string;
  before: string | null;
  after: string | null;
  severity: ResearchContinuityDiffSeverity;
  diff_quality: ResearchContinuityDiffQuality;
  entry_type: string;
  entry_status: string;
  is_repair: boolean;
  repair_case_type: string | null;
  source_entry_id: string | null;
  source_run_id: string | null;
  evidence_status: string | null;
  source_artifact: string | null;
  source_id: string | null;
  source_field: string | null;
}

export interface ResearchContinuityLifecycleItemResponse {
  stable_item_key: string;
  item_type: ResearchContinuityLifecycleItemType;
  status: ResearchContinuityLifecycleStatus;
  title: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  first_seen_run_id: string | null;
  last_seen_run_id: string | null;
  occurrence_count: number;
  entry_count: number;
  latest_entry_id: string | null;
  latest_event_type: string | null;
  source_artifacts: string[];
  timeline_event_ids: string[];
}

export interface ResearchContinuityTimelineResponse {
  symbol: string;
  workspace_id: string;
  generated_at: string;
  window: ResearchContinuityTimelineWindowResponse;
  entry_count: number;
  event_count: number;
  lifecycle_items: ResearchContinuityLifecycleItemResponse[];
  timeline_events: ResearchContinuityTimelineEventResponse[];
  warnings: string[];
}

export interface ResearchContinuityRepairCandidateResponse {
  candidate_id: string;
  run_id: string;
  symbol: string;
  run_completed_at: string | null;
  case_type: ResearchContinuityRepairCaseType;
  current_entry_id: string | null;
  current_entry_status: string | null;
  current_entry_type: string | null;
  eligible: boolean;
  reason: string;
  blocked_reason?: string | null;
  predicted_action: ResearchContinuityRepairPredictedAction;
  repair_version: typeof RESEARCH_CONTINUITY_REPAIR_VERSION;
}

export interface ResearchContinuityRepairPreviewResponse {
  dry_run: true;
  candidate_count: number;
  candidates: ResearchContinuityRepairCandidateResponse[];
}

export interface ResearchContinuityRepairRunResultResponse {
  candidate_id: string;
  run_id: string;
  symbol: string;
  case_type: ResearchContinuityRepairCaseType;
  action: ResearchContinuityRepairRunAction;
  previous_entry_id: string | null;
  new_entry_id: string | null;
  state_updated: boolean;
  reason: string;
  error?: string | null;
}

export interface ResearchContinuityRepairRunResponse {
  audit_run_id: string;
  dry_run: boolean;
  status: ResearchContinuityRepairRunStatus;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  results: ResearchContinuityRepairRunResultResponse[];
}

export interface ResearchContinuityDebugAccessAuditResponse {
  id: string | null;
  workspace_id: string | null;
  entry_id: string;
  research_run_id: string | null;
  symbol: string | null;
  requested_by_user_id: string | null;
  decision: ResearchContinuityDebugAuditDecision;
  reason: ResearchContinuityDebugAuditReason;
  requested_at: string | null;
  metadata: JsonRecord;
}

export interface ResearchContinuityDebugAccessAuditsResponse {
  audits: ResearchContinuityDebugAccessAuditResponse[];
}

export interface ResearchContinuityRepairRunSummaryResponse {
  id: string;
  workspace_id: string;
  requested_by_user_id: string;
  requested_at: string | null;
  completed_at: string | null;
  dry_run: boolean;
  status: ResearchContinuityRepairRunStatus;
  idempotency_key: string | null;
  filters: JsonRecord;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  created_entry_ids: string[];
  error_message: string | null;
}

export interface ResearchContinuityRepairRunDetailResponse
  extends ResearchContinuityRepairRunSummaryResponse {
  results: ResearchContinuityRepairRunResultResponse[];
}

export interface ResearchContinuityRepairRunsResponse {
  runs: ResearchContinuityRepairRunSummaryResponse[];
}
