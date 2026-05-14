import { create } from 'zustand';
import { env, type AuthMode } from '@/lib/env';

export type WorkspaceRequestContext = {
  mode: AuthMode;
  userId: string;
  workspaceId: string;
  getApiToken: () => Promise<string | null>;
  getLocalHeaders: () => Record<string, string>;
};

type WorkspaceStore = WorkspaceRequestContext & {
  setLocalUserId: (userId: string) => void;
  setLocalWorkspaceId: (workspaceId: string) => void;
  resetWorkspace: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  mode: env.authMode,
  userId: env.localUserId,
  workspaceId: env.localWorkspaceId,
  getApiToken: async () => null,
  getLocalHeaders: () => ({
    'x-user-id': get().userId,
    'x-workspace-id': get().workspaceId,
  }),
  setLocalUserId: (userId) => set({ userId }),
  setLocalWorkspaceId: (workspaceId) => set({ workspaceId }),
  resetWorkspace: () =>
    set({
      userId: env.localUserId,
      workspaceId: env.localWorkspaceId,
    }),
}));
