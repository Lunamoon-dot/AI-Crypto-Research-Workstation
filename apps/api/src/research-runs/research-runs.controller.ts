import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { CreateResearchRunDto } from './dto/create-research-run.dto';
import { ResearchRunsService } from './research-runs.service';

@Controller('research-runs')
export class ResearchRunsController {
  constructor(private readonly researchRuns: ResearchRunsService) {}

  @Post()
  create(
    @Body() dto: CreateResearchRunDto,
    @Headers('x-user-id') userId?: string,
  ) {
    return this.researchRuns.create(dto, userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.researchRuns.get(id);
  }

  @Get(':id/events')
  events(@Param('id') id: string) {
    return this.researchRuns.events(id);
  }
}
