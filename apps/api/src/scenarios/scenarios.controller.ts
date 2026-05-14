import { Controller, Get, Headers, Query } from '@nestjs/common';
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
}
