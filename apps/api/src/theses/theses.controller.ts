import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ThesisDecisionDto } from './dto/thesis-decision.dto';
import { ThesisReviewDto } from './dto/thesis-review.dto';
import { ThesesService } from './theses.service';

@Controller('theses')
export class ThesesController {
  constructor(private readonly theses: ThesesService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.theses.list(Number(limit ?? 50));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.theses.get(id);
  }

  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: ThesisDecisionDto) {
    return this.theses.decide(id, dto.action, dto.notes ?? '');
  }

  @Post(':id/review')
  review(@Param('id') id: string, @Body() dto: ThesisReviewDto) {
    return this.theses.review(id, dto.result, dto.notes ?? '');
  }
}
