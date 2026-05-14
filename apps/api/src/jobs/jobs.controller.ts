import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceHeader?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    const status = await this.jobs.getJobStatus(id);
    if (status.workspace_id !== workspaceId) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return status;
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceHeader?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'editor');
    const status = await this.jobs.cancelJob(id);
    if (status.workspace_id !== workspaceId) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return status;
  }
}
