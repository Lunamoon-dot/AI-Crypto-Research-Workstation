import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class RunThesisPulseDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsISO8601()
  observed_at?: string;
}

export class RunThesisPulseMemoDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsNumber()
  window_minutes?: number;

  @IsOptional()
  @IsISO8601()
  observed_at?: string;
}

export class PatchThesisMonitorPlanDto {
  @IsOptional()
  @IsIn(['draft', 'active', 'paused', 'invalid'])
  status?: string;

  @IsOptional()
  @IsNumber()
  baseline_price?: number | null;

  @IsOptional()
  @IsString()
  baseline_price_source?: string;

  @IsOptional()
  @IsISO8601()
  baseline_observed_at?: string | null;

  @IsOptional()
  @IsNumber()
  entry_low?: number | null;

  @IsOptional()
  @IsNumber()
  entry_high?: number | null;

  @IsOptional()
  @IsNumber()
  invalidation_level?: number | null;

  @IsOptional()
  @IsIn(['below', 'above'])
  invalidation_direction?: 'below' | 'above' | null;

  @IsOptional()
  @IsArray()
  targets?: Array<{ label?: string; price: number } | number | string>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scenario_triggers?: string[];

  @IsOptional()
  @IsNumber()
  price_interval_minutes?: number;

  @IsOptional()
  @IsNumber()
  signal_interval_minutes?: number;

  @IsOptional()
  @IsNumber()
  memo_interval_minutes?: number;

  @IsOptional()
  @IsNumber()
  watch_distance_pct?: number;

  @IsOptional()
  @IsNumber()
  review_distance_pct?: number;

  @IsOptional()
  @IsNumber()
  consecutive_review_to_rerun?: number;

  @IsOptional()
  @IsNumber()
  consecutive_invalidation_to_rerun?: number;

  @IsOptional()
  @IsBoolean()
  run_memo_on_review?: boolean;

  @IsOptional()
  @IsBoolean()
  run_memo_on_rerun_full?: boolean;

  @IsOptional()
  @IsBoolean()
  skip_memo_if_no_new_pulses?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabled_signal_factors?: string[];

  @IsOptional()
  @IsBoolean()
  scheduler_enabled?: boolean;
}
