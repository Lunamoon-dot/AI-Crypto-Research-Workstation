import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class CreateDailyBriefDto {
  @IsOptional()
  @IsString()
  watchlist_id?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'watchlist_name must not be blank' })
  watchlist_name?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  alerts_limit?: number;

  @IsOptional()
  @IsBoolean()
  evaluate_snapshots?: boolean;

  @IsOptional()
  @IsBoolean()
  save?: boolean;
}
