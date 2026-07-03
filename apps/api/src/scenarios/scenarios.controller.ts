import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { ScenariosService } from './scenarios.service';

@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get('monitor')
  monitor(
    @Query('symbol') symbol?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.scenarios.monitor(
      {
        symbol,
        status,
        limit: parseListLimit(limit, { defaultLimit: 100, maxLimit: 300 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get(':id/live')
  live(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.scenarios.getLiveState(id, userId, workspaceId);
  }

  @Post(':id/live/refresh')
  refreshLive(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.scenarios.refreshLiveState(id, userId, workspaceId);
  }

  @Get(':id/events')
  events(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.scenarios.listScenarioEvents(
      id,
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
      userId,
      workspaceId,
    );
  }

  @Get(':id/chart')
  chart(
    @Param('id') id: string,
    @Query('interval') interval?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.scenarios.getChartProjection(
      { scenarioId: id, interval, limit },
      userId,
      workspaceId,
    );
  }

  @Get(':id/chart-summary')
  chartSummary(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.scenarios.getChartSummary(id, userId, workspaceId);
  }

  @Post('chart-summaries')
  chartSummaries(
    @Body() dto: { scenario_ids?: string[] },
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.scenarios.getChartSummaries(
      Array.isArray(dto?.scenario_ids) ? dto.scenario_ids : [],
      userId,
      workspaceId,
    );
  }
}
