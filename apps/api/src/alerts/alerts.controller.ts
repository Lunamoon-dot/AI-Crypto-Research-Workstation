import { Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('thesis_id') thesisId?: string,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.alerts.list(
      {
        symbol,
        thesisId,
        unreadOnly: unread === 'true' || unread === '1',
        limit: Number(limit ?? 50),
      },
      userId,
      workspaceId,
    );
  }

  @Post(':id/read')
  markRead(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.alerts.markRead(id, userId, workspaceId);
  }
}
