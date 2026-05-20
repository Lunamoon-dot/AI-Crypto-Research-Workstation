import { IsOptional, IsString } from 'class-validator';

export class CalibrationOutcomeReviewDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
