import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ScenarioDecisionWorkbenchService } from './scenario-decision-workbench.service';

@Controller('scenario-decision')
export class ScenarioDecisionController {
  constructor(private readonly workbenchService: ScenarioDecisionWorkbenchService) {}

  @Get('workbench')
  workbench(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.workbenchService.workbench(userId, workspaceId);
  }

  @Post('items/:id/resolve')
  resolve(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.workbenchService.resolveItem(id, userId, workspaceId);
  }

  @Post('items/:id/snooze')
  snooze(
    @Param('id') id: string,
    @Body() body: { due_at?: string },
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.workbenchService.snoozeItem(
      id,
      body?.due_at ?? null,
      userId,
      workspaceId,
    );
  }
}
