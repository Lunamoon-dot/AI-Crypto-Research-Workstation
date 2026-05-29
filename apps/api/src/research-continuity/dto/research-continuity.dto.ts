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
  payload: JsonRecord;
}

export interface GenerateResearchContinuityResponse {
  created: boolean;
  entry: ResearchContinuityEntryResponse;
}

export interface ResearchContinuityStateEnvelopeResponse {
  symbol: string;
  state: ResearchContinuityStateResponse | null;
  latest_entry: ResearchContinuityEntryResponse | null;
}

export interface ResearchContinuityEntriesResponse {
  symbol: string;
  entries: ResearchContinuityEntryResponse[];
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
  dry_run: boolean;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  results: ResearchContinuityRepairRunResultResponse[];
}
