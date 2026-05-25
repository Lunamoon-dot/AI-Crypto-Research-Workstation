import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { shouldUseLocalPostgresFallback } from '../database/postgres-availability';

export type WorkspaceRole = 'viewer' | 'editor' | 'admin' | 'owner';

export type WorkspaceMembership = {
  user_id: string;
  workspace_id: string;
  role: WorkspaceRole;
};

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

@Injectable()
export class WorkspacesService implements OnModuleDestroy {
  private readonly databaseUrl?: string;
  private readonly pool?: Pool;
  private staticMemberships: WorkspaceMembership[] | undefined;

  constructor() {
    this.databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
    if (this.databaseUrl) {
      this.pool = new Pool({ connectionString: this.databaseUrl });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  resolveWorkspace(workspaceId?: string): string {
    const workspace = (workspaceId ?? '').trim();
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

  async assertAccess(
    userId: string,
    workspaceId: string,
    requiredRole: WorkspaceRole = 'viewer',
  ): Promise<WorkspaceMembership> {
    const workspace = this.resolveWorkspace(workspaceId);
    const user = userId.trim();
    if (!user) {
      throw new ForbiddenException('User identity is required.');
    }
    const membership = await this.findMembership(user, workspace);
    if (!membership) {
      throw new ForbiddenException(
        `User ${user} is not a member of workspace ${workspace}.`,
      );
    }
    if (ROLE_RANK[membership.role] < ROLE_RANK[requiredRole]) {
      throw new ForbiddenException(
        `Workspace role ${membership.role} cannot perform ${requiredRole} actions.`,
      );
    }
    return membership;
  }

  setMembershipsForTest(memberships: WorkspaceMembership[]): void {
    this.staticMemberships = memberships.map((membership) => ({
      user_id: membership.user_id.trim(),
      workspace_id: membership.workspace_id.trim(),
      role: normalizeRole(membership.role),
    }));
  }

  private async findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembership | null> {
    const staticMembership = this.findStaticMembership(userId, workspaceId);
    if (staticMembership) {
      return staticMembership;
    }
    if (this.pool) {
      try {
        const result = await this.pool.query(
          `
          SELECT user_id, workspace_id, role
          FROM workspace_memberships
          WHERE user_id = $1 AND workspace_id = $2
          LIMIT 1
          `,
          [userId, workspaceId],
        );
        const row = result.rows[0];
        return row ? membershipFromRow(row) : null;
      } catch (error) {
        const localMembership = findDefaultLocalMembership(
          userId,
          workspaceId,
          true,
        );
        if (
          localMembership &&
          shouldUseLocalPostgresFallback(this.databaseUrl, error)
        ) {
          return localMembership;
        }
        throw error;
      }
    }
    return null;
  }

  private findStaticMembership(
    userId: string,
    workspaceId: string,
  ): WorkspaceMembership | null {
    const memberships = this.staticMemberships ?? envMemberships();
    return (
      memberships.find(
        (membership) =>
          membership.user_id === userId &&
          membership.workspace_id === workspaceId,
      ) ?? null
    );
  }
}

function envMemberships(): WorkspaceMembership[] {
  const raw = process.env.WORKSPACE_MEMBERSHIPS;
  if (!raw?.trim()) {
    return defaultLocalMemberships();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => membershipFromRow(entry));
    }
  } catch {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [workspaceId, userId, role = 'viewer'] = entry.split(':');
        return {
          workspace_id: (workspaceId ?? '').trim(),
          user_id: (userId ?? '').trim(),
          role: normalizeRole(role),
        };
      });
  }
  return [];
}

function defaultLocalMemberships(): WorkspaceMembership[] {
  return buildDefaultLocalMemberships(false);
}

function findDefaultLocalMembership(
  userId: string,
  workspaceId: string,
  allowWithDatabaseUrl: boolean,
): WorkspaceMembership | null {
  return (
    buildDefaultLocalMemberships(allowWithDatabaseUrl).find(
      (membership) =>
        membership.user_id === userId &&
        membership.workspace_id === workspaceId,
    ) ?? null
  );
}

function buildDefaultLocalMemberships(
  allowWithDatabaseUrl: boolean,
): WorkspaceMembership[] {
  if (process.env.LOCAL_WORKSPACE_MEMBERSHIP === '0') {
    return [];
  }
  if (
    !allowWithDatabaseUrl &&
    process.env.DATABASE_URL &&
    process.env.LOCAL_WORKSPACE_MEMBERSHIP !== '1'
  ) {
    return [];
  }
  return [
    {
      user_id:
        process.env.LOCAL_USER_ID ?? process.env.VITE_LOCAL_USER_ID ?? 'local-user',
      workspace_id:
        process.env.LOCAL_WORKSPACE_ID ??
        process.env.VITE_LOCAL_WORKSPACE_ID ??
        'local',
      role: 'owner',
    },
  ];
}

function membershipFromRow(row: unknown): WorkspaceMembership {
  const record = row as Record<string, unknown>;
  return {
    user_id: String(record.user_id ?? record.userId ?? '').trim(),
    workspace_id: String(record.workspace_id ?? record.workspaceId ?? '').trim(),
    role: normalizeRole(record.role),
  };
}

function normalizeRole(role: unknown): WorkspaceRole {
  const normalized = String(role ?? 'viewer')
    .trim()
    .toLowerCase();
  if (normalized in ROLE_RANK) {
    return normalized as WorkspaceRole;
  }
  return 'viewer';
}
