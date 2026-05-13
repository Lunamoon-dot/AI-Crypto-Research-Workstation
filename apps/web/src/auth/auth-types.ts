import { AuthMode } from '@/lib/env';

export type AuthContextValue = {
  mode: AuthMode;
  userId: string;
  workspaceId: string;
  setLocalUserId: (value: string) => void;
  setLocalWorkspaceId: (value: string) => void;
  getApiToken: () => Promise<string | null>;
  getLocalHeaders: () => Record<string, string>;
};
