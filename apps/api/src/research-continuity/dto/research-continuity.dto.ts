import { IsBoolean, IsOptional } from 'class-validator';
import { JsonRecord } from '../../database/journal.types';

export class GenerateResearchContinuityDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export interface ContinuitySectionResponse {
  title: string;
  items: string[];
  empty_state: string;
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
