import { Controller, Get, Query } from '@nestjs/common';
import { BriefsService } from './briefs.service';

@Controller('briefs')
export class BriefsController {
  constructor(private readonly briefs: BriefsService) {}

  @Get('daily')
  daily(@Query('date') date?: string, @Query('limit') limit?: string) {
    return this.briefs.daily(date, Number(limit ?? 20));
  }
}
