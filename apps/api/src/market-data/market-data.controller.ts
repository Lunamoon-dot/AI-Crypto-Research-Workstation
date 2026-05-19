import { Controller, Get, Headers, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { MarketOhlcvService } from './market-ohlcv.service';

@Controller('market-data')
export class MarketDataController {
  constructor(
    private readonly ohlcv: MarketOhlcvService,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get('ohlcv')
  async getOhlcv(
    @Query('symbol') symbol?: string,
    @Query('market_type') marketType?: string,
    @Query('interval') interval?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceHeader?: string,
    @Query('provider') provider?: string,
    @Query('exchange') exchange?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return this.ohlcv.getOhlcv({
      workspaceId,
      symbol,
      marketType,
      interval,
      from,
      to,
      limit,
      provider,
      exchange,
    });
  }
}
