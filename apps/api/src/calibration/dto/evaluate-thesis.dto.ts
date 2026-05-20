import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class EvaluateThesisDto {
  @IsString()
  @MinLength(1)
  thesis_id!: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 14, 30])
  window_days?: number;
}
