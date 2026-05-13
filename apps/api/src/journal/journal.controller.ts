import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ResearchRunsService } from '../research-runs/research-runs.service';

@Controller('journal')
export class JournalController {
  constructor(private readonly researchRuns: ResearchRunsService) {}

  @Get('runs/:id/workspace')
  runWorkspace(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.researchRuns.workspace(id, userId, workspaceId);
  }
}
