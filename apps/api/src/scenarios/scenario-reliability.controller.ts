import { Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { ScenarioReliabilityService } from './scenario-reliability.service';

@Controller('scenario-reliability')
export class ScenarioReliabilityController {
  constructor(private readonly reliability: ScenarioReliabilityService) {}

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('market_type') marketType?: string,
    @Query('horizon') horizon?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.reliability.profile(
      {
        symbol,
        market_type: marketType,
        horizon,
        limit: parseListLimit(limit, { defaultLimit: 100, maxLimit: 500 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get(':symbol')
  listForSymbol(
    @Param('symbol') symbol: string,
    @Query('market_type') marketType?: string,
    @Query('horizon') horizon?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.reliability.profile(
      {
        symbol,
        market_type: marketType,
        horizon,
        limit: parseListLimit(limit, { defaultLimit: 100, maxLimit: 500 }),
      },
      userId,
      workspaceId,
    );
  }

  @Post('rebuild')
  rebuild(
    @Query('symbol') symbol?: string,
    @Query('market_type') marketType?: string,
    @Query('horizon') horizon?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.reliability.rebuild(
      {
        symbol,
        market_type: marketType,
        horizon,
        limit: parseListLimit(limit, { defaultLimit: 100, maxLimit: 500 }),
      },
      userId,
      workspaceId,
    );
  }
}
