import { create } from 'zustand';
import { env, type AuthMode } from '@/lib/env';
import type { WorkspaceSummary } from '@/types';

export type WorkspaceRequestContext = {
  mode: AuthMode;
  userId: string;
  workspaceId: string;
  getApiToken: () => Promise<string | null>;
  getLocalHeaders: () => Record<string, string>;
};

type WorkspaceStore = WorkspaceRequestContext & {
  workspace: WorkspaceSummary | null;
  setLocalUserId: (userId: string) => void;
  setLocalWorkspaceId: (workspaceId: string) => void;
  setWorkspace: (workspace: WorkspaceSummary) => void;
  isLegacyMixedWorkspace: () => boolean;
  fixedWorkspaceSymbol: () => string | null;
  resetWorkspace: () => void;
};

export const legacyMixedWorkspace: WorkspaceSummary = {
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

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  mode: env.authMode,
  userId: env.localUserId,
  workspaceId: env.localWorkspaceId,
  workspace: legacyMixedWorkspace,
  getApiToken: async () => null,
  getLocalHeaders: () => ({
    'x-user-id': get().userId,
    'x-workspace-id': get().workspaceId,
  }),
  setLocalUserId: (userId) => set({ userId }),
  setLocalWorkspaceId: (workspaceId) =>
    set({
      workspaceId,
      workspace: workspaceId === legacyMixedWorkspace.id ? legacyMixedWorkspace : null,
    }),
  setWorkspace: (workspace) =>
    set({
      workspace,
      workspaceId: workspace.id,
    }),
  isLegacyMixedWorkspace: () =>
    get().workspace?.scope_type === 'legacy_mixed',
  fixedWorkspaceSymbol: () => {
    const workspace = get().workspace;
    return workspace?.scope_type === 'fixed_symbol' ? workspace.symbol : null;
  },
  resetWorkspace: () =>
    set({
      userId: env.localUserId,
      workspaceId: env.localWorkspaceId,
      workspace: legacyMixedWorkspace,
    }),
}));
