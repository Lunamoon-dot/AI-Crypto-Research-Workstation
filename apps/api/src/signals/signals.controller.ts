import { Controller, Get, Query } from '@nestjs/common';
import { SignalsService } from './signals.service';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Get()
  list(@Query('symbol') symbol?: string, @Query('limit') limit?: string) {
    return this.signals.list(symbol, Number(limit ?? 50));
  }
}
