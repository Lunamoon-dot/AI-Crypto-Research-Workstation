import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
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
}
