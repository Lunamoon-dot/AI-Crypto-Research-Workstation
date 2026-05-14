import { Controller, Get, Headers, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('outcomes')
  outcomes(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.performance.outcomes(
      {
        symbol,
        limit: parseListLimit(limit, { defaultLimit: 100, maxLimit: 500 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get('analytics')
  analytics(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.performance.analytics(
      {
        symbol,
        limit: parseListLimit(limit, { defaultLimit: 200, maxLimit: 500 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get('trend')
  trend(
    @Query('days') days?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.performance.trend(
      parseDays(days, 90),
      userId,
      workspaceId,
    );
  }

  @Get('health')
  health(
    @Query('recent_days') recentDays?: string,
    @Query('baseline_days') baselineDays?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.performance.health(
      {
        recentDays: parseDays(recentDays, 14),
        baselineDays: parseDays(baselineDays, 60),
      },
      userId,
      workspaceId,
    );
  }
}

function parseDays(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 365);
}
