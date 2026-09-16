import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { JsonRecord } from '../../database/journal.types';

export class CreateResearchRunDto {
  @IsOptional()
  @IsString()
  run_id?: string;

  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'workspace_id must not be blank' })
  workspace_id: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'symbol must not be blank' })
  symbol?: string;

  @IsOptional()
  @IsString()
  asset_class?: string;

  @IsOptional()
  @IsIn(['perp'])
  market_type?: 'perp';

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

  @IsOptional()
  @IsString()
  exchange?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'output_language must not be blank' })
  output_language?: string;

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: JsonRecord;
}
