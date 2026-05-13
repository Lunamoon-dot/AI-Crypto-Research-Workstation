import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateResearchRunDto {
  @IsOptional()
  @IsString()
  run_id?: string;

  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'workspace_id must not be blank' })
  workspace_id: string;

  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'symbol must not be blank' })
  symbol: string;

  @IsOptional()
  @IsString()
  asset_class?: string;

  @IsOptional()
  @IsIn(['spot', 'perp'])
  market_type?: 'spot' | 'perp';

  @IsDateString()
  analysis_date: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(/\S/, { each: true, message: 'analysts must not contain blank values' })
  analysts: string[];

  @IsOptional()
  @IsString()
  config_profile?: string;
}
