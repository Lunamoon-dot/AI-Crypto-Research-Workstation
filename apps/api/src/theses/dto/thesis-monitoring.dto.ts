import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
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
  @Min(30)
  @Max(1440)
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
  @Min(1)
  @Max(60)
  price_interval_minutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(240)
  signal_interval_minutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(1440)
  memo_interval_minutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  watch_distance_pct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(10)
  review_distance_pct?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  consecutive_review_to_rerun?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
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

export class RunThesisSchedulerDto {
  @IsOptional()
  @IsISO8601()
  observed_at?: string;
}
