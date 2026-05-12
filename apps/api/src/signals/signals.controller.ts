import { Controller, Get, Headers, Query } from '@nestjs/common';
import { SignalsService } from './signals.service';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.list(symbol, Number(limit ?? 50), userId, workspaceId);
  }
}
