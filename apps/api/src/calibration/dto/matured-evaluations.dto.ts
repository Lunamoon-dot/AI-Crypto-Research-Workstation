import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class PreviewMaturedEvaluationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 14, 30])
  window_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  scan_limit?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  symbol?: string;
}

export class ApplyMaturedEvaluationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 14, 30])
  window_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  max_batch?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  symbol?: string;
}
