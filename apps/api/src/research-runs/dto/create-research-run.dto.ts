import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateResearchRunDto {
  @IsOptional()
  @IsString()
  run_id?: string;

  @IsString()
  @MinLength(1)
  workspace_id: string;

  @IsString()
  @MinLength(1)
  symbol: string;

  @IsOptional()
  @IsString()
  asset_class?: string;

  @IsDateString()
  analysis_date: string;

  @IsArray()
  @IsString({ each: true })
  analysts: string[];

  @IsOptional()
  @IsString()
  config_profile?: string;
}
