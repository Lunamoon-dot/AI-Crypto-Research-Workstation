import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ComparisonsService } from './comparisons.service';

@Controller('comparisons')
export class ComparisonsController {
  constructor(private readonly comparisons: ComparisonsService) {}

  @Get('theses')
  theses(
    @Query('left_id') leftId: string,
    @Query('right_id') rightId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.comparisons.theses(leftId, rightId, userId, workspaceId);
  }

  @Get('runs')
  runs(
    @Query('left_id') leftId: string,
    @Query('right_id') rightId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.comparisons.runs(leftId, rightId, userId, workspaceId);
  }
}
