import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class WorkspacesService {
  resolveWorkspace(workspaceId?: string): string {
    const workspace = (workspaceId ?? process.env.LOCAL_WORKSPACE_ID ?? 'local').trim();
    if (!workspace) {
      throw new ForbiddenException('Workspace is required.');
    }
    return workspace;
  }

  assertRequestWorkspace(bodyWorkspaceId: string, headerWorkspaceId?: string): string {
    const bodyWorkspace = this.resolveWorkspace(bodyWorkspaceId);
    const headerWorkspace = headerWorkspaceId
      ? this.resolveWorkspace(headerWorkspaceId)
      : undefined;
    if (headerWorkspace && headerWorkspace !== bodyWorkspace) {
      throw new BadRequestException(
        'x-workspace-id must match request workspace_id.',
      );
    }
    return bodyWorkspace;
  }

  assertAccess(userId: string, workspaceId: string) {
    const workspace = this.resolveWorkspace(workspaceId);
    return {
      user_id: userId,
      workspace_id: workspace,
      role: 'owner',
    };
  }
}
