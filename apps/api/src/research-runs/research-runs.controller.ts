import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { GenerateResearchContinuityDto } from '../research-continuity/dto/research-continuity.dto';
import { ResearchContinuityService } from '../research-continuity/research-continuity.service';
import { CreateResearchRunDto } from './dto/create-research-run.dto';
import { ResearchRunsService } from './research-runs.service';

@Controller('research-runs')
export class ResearchRunsController {
  constructor(
    private readonly researchRuns: ResearchRunsService,
    private readonly continuity: ResearchContinuityService,
  ) {}

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.list(
      {
        symbol,
        status,
        limit: parseListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      },
      userId,
      workspaceId,
    );
  }

  @Post()
  create(
    @Body() dto: CreateResearchRunDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.create(dto, userId, workspaceId);
  }

  @Delete()
  removeWorkspaceData(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.removeWorkspaceData(userId, workspaceId);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.get(id, userId, workspaceId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.remove(id, userId, workspaceId);
  }

  @Get(':id/events')
  events(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.events(id, userId, workspaceId);
  }

  @Get(':id/snapshots')
  snapshots(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.snapshots(id, userId, workspaceId);
  }

  @Get(':id/debate')
  debate(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.debate(id, userId, workspaceId);
  }

  @Get(':id/workspace')
  workspace(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.workspace(id, userId, workspaceId);
  }

  @Get(':id/evidence-bundle')
  evidenceBundle(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.evidenceBundle(id, userId, workspaceId);
  }

  @Get(':id/continuity')
  continuityEntry(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getRunContinuity(id, userId, workspaceId);
  }

  @Post(':id/continuity')
  generateContinuity(
    @Param('id') id: string,
    @Body() dto: GenerateResearchContinuityDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.generateForRun(id, dto, userId, workspaceId);
  }
}
