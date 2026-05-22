import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import {
  EVALUATION_RERUN_REASONS,
  EvaluationRerunReason,
} from './evaluation-rerun.dto';

export class EvaluationVersionPolicyActionDto {
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
