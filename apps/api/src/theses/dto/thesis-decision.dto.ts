import { IsOptional, IsString, MinLength } from 'class-validator';

export class ThesisDecisionDto {
  @IsString()
  @MinLength(1)
  action: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  entry?: string;

  @IsOptional()
  @IsString()
  stop_loss?: string;

  @IsOptional()
  @IsString()
  take_profit?: string;

  @IsOptional()
  @IsString()
  position_intent?: string;
}
