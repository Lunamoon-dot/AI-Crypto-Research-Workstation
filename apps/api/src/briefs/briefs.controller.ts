import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { CreateDailyBriefDto } from './dto/create-daily-brief.dto';
import { BriefsService } from './briefs.service';
import { parseListLimit } from '../common/query-limit';

@Controller('briefs')
export class BriefsController {
  constructor(private readonly briefs: BriefsService) {}

  @Get('daily')
  daily(
    @Query('date') date?: string,
    @Query('limit') limit?: string,
    @Query('watchlist_id') watchlistId?: string,
    @Query('watchlist_name') watchlistName?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.briefs.daily(
      date,
      parseListLimit(limit, { defaultLimit: 20, maxLimit: 100 }),
      userId,
      workspaceId,
      watchlistId,
      watchlistName,
    );
  }

  @Post('daily')
  createDaily(
    @Body() dto: CreateDailyBriefDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.briefs.createDaily(dto, userId, workspaceId);
  }
}
