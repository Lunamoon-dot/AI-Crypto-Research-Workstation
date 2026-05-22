import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const EVALUATION_RERUN_REASONS = [
  'manual_check',
  'engine_rule_change',
  'market_data_fix',
  'bug_fix_verification',
  'suspected_drift',
  'other',
] as const;

export type EvaluationRerunReason = (typeof EVALUATION_RERUN_REASONS)[number];

export class CreateEvaluationRerunDto {
  @IsString()
  @IsIn(EVALUATION_RERUN_REASONS)
  reason!: EvaluationRerunReason;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  idempotency_key?: string;
}
