import { IsOptional, IsString, MinLength } from 'class-validator';

export class ThesisReviewDto {
  @IsString()
  @MinLength(1)
  result: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
