import { ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class WorkspacesService {
  assertAccess(userId: string, workspaceId: string) {
    const workspace = workspaceId.trim();
    if (!workspace) {
      throw new ForbiddenException('Workspace is required.');
    }
    return {
      user_id: userId,
      workspace_id: workspace,
      role: 'owner',
    };
  }
}
