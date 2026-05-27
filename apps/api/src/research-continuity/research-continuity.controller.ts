import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { ResearchContinuityService } from './research-continuity.service';

@Controller('research-continuity')
export class ResearchContinuityController {
  constructor(private readonly continuity: ResearchContinuityService) {}

  @Get('symbols/:symbol/state')
  getSymbolState(
    @Param('symbol') symbol: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getSymbolState(symbol, userId, workspaceId);
  }

  @Get('symbols/:symbol/entries')
  listSymbolEntries(
    @Param('symbol') symbol: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.listSymbolEntries(
      symbol,
      { limit: parseListLimit(limit, { defaultLimit: 20, maxLimit: 100 }) },
      userId,
      workspaceId,
    );
  }

  @Get('entries/:id')
  getEntry(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getEntry(id, userId, workspaceId);
  }
}
