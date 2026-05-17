import { Controller, Get, Headers, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { WorkbenchService } from './workbench.service';

@Controller('workbench')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  @Get('attention')
  attention(
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.workbench.attention(
      parseListLimit(limit, { defaultLimit: 10, maxLimit: 10 }),
      userId,
      workspaceId,
    );
  }
}
