import { Controller, Get, Headers, Query } from '@nestjs/common';
import { BriefsService } from './briefs.service';

@Controller('briefs')
export class BriefsController {
  constructor(private readonly briefs: BriefsService) {}

  @Get('daily')
  daily(
    @Query('date') date?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.briefs.daily(date, Number(limit ?? 20), userId, workspaceId);
  }
}
