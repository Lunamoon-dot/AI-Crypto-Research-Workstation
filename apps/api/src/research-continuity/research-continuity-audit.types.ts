import { JsonRecord } from '../database/journal.types';
import {
  ResearchContinuityRepairRunResultResponse,
} from './dto/research-continuity.dto';

export type ResearchContinuityDebugAuditDecision = 'allowed' | 'denied';

export type ResearchContinuityDebugAuditReason =
  | 'allowed'
  | 'disabled_by_policy'
  | 'missing_user'
  | 'missing_workspace'
  | 'workspace_denied'
  | 'permission_required'
  | 'entry_not_found'
  | 'audit_unavailable';

export type ResearchContinuityRepairRunStatus =
  | 'started'
  | 'completed'
  | 'completed_with_failures'
  | 'failed';

export interface ResearchContinuityDebugAccessAuditInput {
  id?: string;
  workspace_id?: string | null;
  entry_id: string;
  research_run_id?: string | null;
  symbol?: string | null;
  requested_by_user_id?: string | null;
  decision: ResearchContinuityDebugAuditDecision;
  reason: ResearchContinuityDebugAuditReason;
  requested_at?: string;
  metadata?: JsonRecord;
}

export interface ResearchContinuityDebugAccessAuditFilters {
  limit: number;
  entry_id?: string;
  decision?: ResearchContinuityDebugAuditDecision;
  reason?: ResearchContinuityDebugAuditReason;
  requested_by_user_id?: string;
}

export interface ResearchContinuityRepairRunCreateInput {
  id?: string;
  workspace_id: string;
  requested_by_user_id: string;
  requested_at?: string;
  dry_run: boolean;
  idempotency_key?: string | null;
  filters: JsonRecord;
}

export interface ResearchContinuityRepairRunFinalizeInput {
  completed_at?: string;
  status: Exclude<ResearchContinuityRepairRunStatus, 'started'>;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  created_entry_ids: string[];
  results: ResearchContinuityRepairRunResultResponse[];
  error_message?: string | null;
}

export interface ResearchContinuityRepairRunFilters {
  limit: number;
  status?: ResearchContinuityRepairRunStatus;
  dry_run?: boolean;
}

export interface ResearchContinuityOperationsHealthOptions {
  lookbackDays: number;
}

export interface ResearchContinuityAuditRepository {
  recordDebugAccessAudit(
    input: ResearchContinuityDebugAccessAuditInput,
  ): Promise<JsonRecord>;
  listDebugAccessAudits(
    filters: ResearchContinuityDebugAccessAuditFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;

  createRepairRun(
    input: ResearchContinuityRepairRunCreateInput,
  ): Promise<JsonRecord>;
  finalizeRepairRun(
    id: string,
    workspaceId: string,
    result: ResearchContinuityRepairRunFinalizeInput,
  ): Promise<JsonRecord>;
  getRepairRun(id: string, workspaceId: string): Promise<JsonRecord | null>;
  listRepairRuns(
    filters: ResearchContinuityRepairRunFilters,
    workspaceId: string,
  ): Promise<JsonRecord[]>;

  getContinuityOperationsHealth(
    workspaceId: string,
    options: ResearchContinuityOperationsHealthOptions,
  ): Promise<JsonRecord>;
}
