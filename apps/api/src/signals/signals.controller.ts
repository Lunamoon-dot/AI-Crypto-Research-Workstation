import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { SignalsService } from './signals.service';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Get('count')
  count(
    @Query('symbol') symbol?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.count(symbol, userId, workspaceId);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.get(id, userId, workspaceId);
  }

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.list(
      symbol,
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      userId,
      workspaceId,
    );
  }
}
