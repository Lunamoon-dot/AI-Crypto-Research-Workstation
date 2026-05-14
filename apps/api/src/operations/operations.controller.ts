import { Controller, Get, Headers, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { OperationsService } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('health')
  health(
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.operations.health(
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
      userId,
      workspaceId,
    );
  }

  @Get('provider-health')
  providerHealth(@Query('limit') limit?: string) {
    return this.operations.providerHealth(
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
    );
  }

  @Get('llm-calls')
  llmCalls(
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.operations.llmCalls(
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
      userId,
      workspaceId,
    );
  }

  @Get('data-freshness')
  dataFreshness(
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.operations.dataFreshness(
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
      userId,
      workspaceId,
    );
  }
}
