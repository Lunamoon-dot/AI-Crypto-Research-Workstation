import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class ThesisReviewDto {
  @IsString()
  @MinLength(1)
  result: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  max_favorable_excursion?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  max_adverse_excursion?: number;
}
