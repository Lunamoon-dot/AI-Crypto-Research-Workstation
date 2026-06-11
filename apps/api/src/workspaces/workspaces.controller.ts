import { Body, Controller, Delete, Get, Headers, Param, Post, Put } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceNewsSourcesDto } from './dto/update-workspace-news-sources.dto';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  list(@Headers('x-user-id') userId?: string) {
    const user = this.auth.resolveUser(userId);
    return this.workspaces.listMetadata(user);
  }

  @Post()
  create(
    @Body() dto: CreateWorkspaceDto,
    @Headers('x-user-id') userId?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    return this.workspaces.createMetadata(dto, user);
  }

  @Get(':id')
  get(@Param('id') id: string, @Headers('x-user-id') userId?: string) {
    const user = this.auth.resolveUser(userId);
    return this.workspaces.getMetadata(id, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Headers('x-user-id') userId?: string) {
    const user = this.auth.resolveUser(userId);
    return this.workspaces.archiveMetadata(id, user);
  }

  @Get(':id/news-sources')
  listNewsSources(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    return this.workspaces.listNewsSources(id, user);
  }

  @Put(':id/news-sources')
  updateNewsSources(
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceNewsSourcesDto,
    @Headers('x-user-id') userId?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    return this.workspaces.updateNewsSources(id, user, dto);
  }
}
