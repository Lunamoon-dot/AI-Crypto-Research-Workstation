import { IsObject, IsOptional } from 'class-validator';

export class CheckWatchlistDto {
  @IsOptional()
  @IsObject()
  prices?: Record<string, number>;
}
