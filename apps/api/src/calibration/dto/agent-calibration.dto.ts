import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AgentCalibrationQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  symbol?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 14, 30])
  window_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([30, 60, 90])
  lookback_days?: number;
}
