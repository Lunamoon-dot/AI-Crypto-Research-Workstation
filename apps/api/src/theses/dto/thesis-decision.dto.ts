import { IsOptional, IsString, MinLength } from 'class-validator';

export class ThesisDecisionDto {
  @IsString()
  @MinLength(1)
  action: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
