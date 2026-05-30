import type { JsonRecord } from '../database/journal.types';
import type {
  ResearchContinuityRepairCaseType,
  ResearchContinuityScheduledRepairMode,
} from './dto/research-continuity.dto';

export interface ResearchContinuityWorkspaceSettingsUpsertInput {
  workspace_id: string;
  scheduled_repair_mode: ResearchContinuityScheduledRepairMode;
  scheduled_repair_case_types: ResearchContinuityRepairCaseType[];
  scheduled_repair_interval_hours: number;
  scheduled_repair_lookback_days: number;
  scheduled_repair_limit: number;
  next_scheduled_repair_due_at?: string | null;
  updated_by_user_id: string;
  updated_at?: string;
}

export interface ResearchContinuityMarkScheduledRepairRunInput {
  workspace_id: string;
  last_scheduled_repair_at?: string;
  last_scheduled_repair_run_id: string;
  next_scheduled_repair_due_at: string;
}

export interface ResearchContinuitySettingsRepository {
  getWorkspaceSettings(workspaceId: string): Promise<JsonRecord | null>;
  upsertWorkspaceSettings(
    input: ResearchContinuityWorkspaceSettingsUpsertInput,
  ): Promise<JsonRecord>;
  markScheduledRepairRun(
    input: ResearchContinuityMarkScheduledRepairRunInput,
  ): Promise<JsonRecord>;
}
