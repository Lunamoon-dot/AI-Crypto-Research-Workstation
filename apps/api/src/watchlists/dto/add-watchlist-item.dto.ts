import { IsOptional, IsString } from 'class-validator';

export class AddWatchlistItemDto {
  @IsOptional()
  @IsString()
  item_type?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  thesis_id?: string;

  @IsOptional()
  @IsString()
  setup_type?: string;
}
