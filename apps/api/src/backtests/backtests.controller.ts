import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { BacktestAssumptionSetResponse } from './backtest.types';
import { BacktestService } from './backtest.service';

@Controller()
export class BacktestsController {
  constructor(private readonly backtests: BacktestService) {}

  @Post('playbooks/:id/backtests')
  createBacktest(
    @Param('id') id: string,
    @Body() assumptions: Partial<BacktestAssumptionSetResponse> = {},
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.backtests.createBacktest(id, assumptions, userId, workspaceId);
  }

  @Get('playbooks/:id/backtests')
  listForPlaybook(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.backtests.listForPlaybook(id, userId, workspaceId);
  }

  @Get('backtests/:id')
  getBacktest(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.backtests.getBacktest(id, userId, workspaceId);
  }

  @Get('backtests/:id/events')
  listTradeEvents(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.backtests.listTradeEvents(id, userId, workspaceId);
  }
}
