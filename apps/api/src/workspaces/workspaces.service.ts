import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { shouldUseLocalPostgresFallback } from '../database/postgres-availability';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import {
  validateWorkspaceMetadata,
  WorkspaceMarketType,
  WorkspaceMetadata,
} from './workspace-metadata';

type WorkspacePool = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
};

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
  private readonly pool?: WorkspacePool;
  private readonly ownsPool: boolean;
  private readonly metadata = new Map<string, WorkspaceMetadata>();
  private readonly runtimeMemberships: WorkspaceMembership[] = [];
  private postgresSchemaReady = false;
  private staticMemberships: WorkspaceMembership[] | undefined;

  constructor(@Optional() @Inject('WORKSPACE_POOL') pool?: WorkspacePool) {
    this.databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
    if (pool) {
      this.pool = pool;
      this.ownsPool = false;
    } else if (this.databaseUrl) {
      this.pool = new Pool({ connectionString: this.databaseUrl });
      this.ownsPool = true;
    } else {
      this.ownsPool = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ownsPool) {
      await this.pool?.end();
    }
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

  async listMetadata(userId: string): Promise<WorkspaceMetadata[]> {
    const user = normalizeUserId(userId);
    const accessible = new Map<string, WorkspaceMetadata>();
    const localWorkspace = legacyMixedWorkspaceMetadata();

    if (await this.findMembership(user, localWorkspace.id)) {
      accessible.set(localWorkspace.id, localWorkspace);
    }

    for (const workspace of this.metadata.values()) {
      if (workspace.archived) {
        continue;
      }
      const membership = await this.findMembership(user, workspace.id);
      if (membership) {
        accessible.set(workspace.id, workspace);
      }
    }

    for (const workspace of await this.listPostgresMetadata(user)) {
      if (!workspace.archived) {
        accessible.set(workspace.id, workspace);
      }
    }

    return [...accessible.values()];
  }

  async createMetadata(
    dto: CreateWorkspaceDto,
    userId: string,
  ): Promise<WorkspaceMetadata> {
    const user = normalizeUserId(userId);
    const now = new Date().toISOString();
    const workspace = validateWorkspaceMetadata({
      id: `workspace_${randomUUID().replaceAll('-', '')}`,
      name: normalizeWorkspaceName(dto.name),
      scope_type: 'fixed_symbol',
      symbol: dto.symbol,
      market_type: normalizeMarketType(dto.market_type),
      default_timeframe: normalizeNullableString(dto.default_timeframe),
      archived: false,
      created_at: now,
      updated_at: now,
    });

    await this.savePostgresMetadata(workspace, user);
    this.rememberWorkspace(workspace, {
      user_id: user,
      workspace_id: workspace.id,
      role: 'owner',
    });
    return workspace;
  }

  async getMetadata(id: string, userId: string): Promise<WorkspaceMetadata> {
    const user = normalizeUserId(userId);
    const workspaceId = this.resolveWorkspace(id);
    await this.assertAccess(user, workspaceId, 'viewer');
    const workspace = await this.getMetadataById(workspaceId);
    if (!workspace || workspace.archived) {
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    }
    return workspace;
  }

  async getMetadataById(workspaceId: string): Promise<WorkspaceMetadata | null> {
    const workspace = this.resolveWorkspace(workspaceId);
    if (workspace === 'local') {
      return legacyMixedWorkspaceMetadata();
    }
    return (
      this.metadata.get(workspace) ??
      (await this.getPostgresMetadataById(workspace))
    );
  }

  setMembershipsForTest(memberships: WorkspaceMembership[]): void {
    this.staticMemberships = memberships.map((membership) => ({
      user_id: membership.user_id.trim(),
      workspace_id: membership.workspace_id.trim(),
      role: normalizeRole(membership.role),
    }));
  }

  setWorkspaceMetadataForTest(workspaces: WorkspaceMetadata[]): void {
    this.metadata.clear();
    for (const workspace of workspaces) {
      const validated = validateWorkspaceMetadata(workspace);
      this.metadata.set(validated.id, validated);
    }
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
        await this.ensurePostgresWorkspaceSchema();
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
    const runtimeMembership = this.runtimeMemberships.find(
      (membership) =>
        membership.user_id === userId && membership.workspace_id === workspaceId,
    );
    if (runtimeMembership) {
      return runtimeMembership;
    }
    const memberships = this.staticMemberships ?? envMemberships();
    return (
      memberships.find(
        (membership) =>
          membership.user_id === userId &&
          membership.workspace_id === workspaceId,
      ) ?? null
    );
  }

  private grantRuntimeMembership(membership: WorkspaceMembership): void {
    const normalized = {
      user_id: membership.user_id.trim(),
      workspace_id: membership.workspace_id.trim(),
      role: normalizeRole(membership.role),
    };
    const existingIndex = this.runtimeMemberships.findIndex(
      (candidate) =>
        candidate.user_id === normalized.user_id &&
        candidate.workspace_id === normalized.workspace_id,
    );
    if (existingIndex >= 0) {
      this.runtimeMemberships[existingIndex] = normalized;
      return;
    }
    this.runtimeMemberships.push(normalized);
  }

  private rememberWorkspace(
    workspace: WorkspaceMetadata,
    membership: WorkspaceMembership,
  ): void {
    this.metadata.set(workspace.id, workspace);
    this.grantRuntimeMembership(membership);
  }

  private async listPostgresMetadata(
    userId: string,
  ): Promise<WorkspaceMetadata[]> {
    if (!this.pool) {
      return [];
    }

    try {
      await this.ensurePostgresWorkspaceSchema();
      const result = await this.pool.query(
        `
        SELECT
          w.id,
          w.name,
          w.scope_type,
          w.symbol,
          w.market_type,
          w.default_timeframe,
          w.archived,
          w.created_at,
          w.updated_at
        FROM workspaces w
        JOIN workspace_memberships wm ON wm.workspace_id = w.id
        WHERE wm.user_id = $1 AND w.archived = false
        ORDER BY w.created_at ASC
        `,
        [userId],
      );
      return result.rows.map(workspaceMetadataFromRow);
    } catch (error) {
      if (shouldUseLocalPostgresFallback(this.databaseUrl, error)) {
        return [];
      }
      throw error;
    }
  }

  private async getPostgresMetadataById(
    workspaceId: string,
  ): Promise<WorkspaceMetadata | null> {
    if (!this.pool) {
      return null;
    }

    try {
      await this.ensurePostgresWorkspaceSchema();
      const result = await this.pool.query(
        `
        SELECT
          id,
          name,
          scope_type,
          symbol,
          market_type,
          default_timeframe,
          archived,
          created_at,
          updated_at
        FROM workspaces
        WHERE id = $1
        LIMIT 1
        `,
        [workspaceId],
      );
      const row = result.rows[0];
      return row ? workspaceMetadataFromRow(row) : null;
    } catch (error) {
      if (shouldUseLocalPostgresFallback(this.databaseUrl, error)) {
        return null;
      }
      throw error;
    }
  }

  private async savePostgresMetadata(
    workspace: WorkspaceMetadata,
    userId: string,
  ): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.ensurePostgresWorkspaceSchema();
      await this.pool.query('BEGIN');
      await this.pool.query(
        'INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
        [userId],
      );
      await this.pool.query(
        `
        INSERT INTO workspaces (
          id,
          name,
          scope_type,
          symbol,
          market_type,
          default_timeframe,
          archived,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          scope_type = EXCLUDED.scope_type,
          symbol = EXCLUDED.symbol,
          market_type = EXCLUDED.market_type,
          default_timeframe = EXCLUDED.default_timeframe,
          archived = EXCLUDED.archived,
          updated_at = EXCLUDED.updated_at
        `,
        [
          workspace.id,
          workspace.name,
          workspace.scope_type,
          workspace.symbol,
          workspace.market_type,
          workspace.default_timeframe,
          workspace.archived,
          workspace.created_at,
          workspace.updated_at,
        ],
      );
      await this.pool.query(
        `
        INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `,
        [
          `membership_${randomUUID().replaceAll('-', '')}`,
          workspace.id,
          userId,
          'owner',
        ],
      );
      await this.pool.query('COMMIT');
    } catch (error) {
      await this.rollbackPostgresWorkspaceTransaction();
      if (shouldUseLocalPostgresFallback(this.databaseUrl, error)) {
        return;
      }
      throw error;
    }
  }

  private async rollbackPostgresWorkspaceTransaction(): Promise<void> {
    try {
      await this.pool?.query('ROLLBACK');
    } catch {
      // Ignore rollback failures so the original database error is preserved.
    }
  }

  private async ensurePostgresWorkspaceSchema(): Promise<void> {
    if (!this.pool || this.postgresSchemaReady) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        display_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'legacy_mixed';
      ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS symbol TEXT;
      ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'mixed';
      ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS default_timeframe TEXT;
      ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

      CREATE TABLE IF NOT EXISTS workspace_memberships (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin', 'owner')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_user
        ON workspace_memberships(workspace_id, user_id);

      CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_workspace
        ON workspace_memberships(user_id, workspace_id);
    `);
    this.postgresSchemaReady = true;
  }
}

function legacyMixedWorkspaceMetadata(): WorkspaceMetadata {
  return {
    id: 'local',
    name: 'Legacy Mixed Workspace',
    scope_type: 'legacy_mixed',
    symbol: null,
    market_type: 'mixed',
    default_timeframe: null,
    archived: false,
    created_at: '1970-01-01T00:00:00.000Z',
    updated_at: '1970-01-01T00:00:00.000Z',
  };
}

function workspaceMetadataFromRow(row: unknown): WorkspaceMetadata {
  const record = row as Record<string, unknown>;
  return validateWorkspaceMetadata({
    id: String(record.id ?? '').trim(),
    name: String(record.name ?? '').trim(),
    scope_type:
      record.scope_type === 'fixed_symbol' ? 'fixed_symbol' : 'legacy_mixed',
    symbol: nullableRowString(record.symbol),
    market_type: normalizeMarketType(
      record.market_type as WorkspaceMarketType | undefined,
    ),
    default_timeframe: nullableRowString(record.default_timeframe),
    archived: booleanValue(record.archived),
    created_at: timestampString(record.created_at),
    updated_at: timestampString(record.updated_at ?? record.created_at),
  });
}

function nullableRowString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return Boolean(value);
}

function timestampString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const normalized = String(value ?? '').trim();
  return normalized || new Date(0).toISOString();
}

function normalizeUserId(userId: string): string {
  const user = userId.trim();
  if (!user) {
    throw new ForbiddenException('User identity is required.');
  }
  return user;
}

function normalizeWorkspaceName(name: string): string {
  const value = name.trim();
  if (!value) {
    throw new BadRequestException('Workspace name is required.');
  }
  return value;
}

function normalizeMarketType(
  marketType: WorkspaceMarketType | undefined,
): WorkspaceMarketType {
  const normalized = marketType ?? 'mixed';
  if (normalized !== 'mixed' && normalized !== 'spot' && normalized !== 'perp') {
    throw new BadRequestException('Unsupported workspace market type.');
  }
  return normalized;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
