import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PlaybookCompilerService } from './playbook-compiler.service';

@Controller()
export class PlaybooksController {
  constructor(private readonly playbooks: PlaybookCompilerService) {}

  @Post('scenarios/:id/playbook')
  compileScenario(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.playbooks.compileScenarioById(id, userId, workspaceId);
  }

  @Get('scenarios/:id/playbook')
  listForScenario(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.playbooks.listForScenario(id, userId, workspaceId);
  }

  @Get('playbooks/:id')
  getPlaybook(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.playbooks.getPlaybook(id, userId, workspaceId);
  }
}
