'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { AuthContextValue } from '@/auth/auth-types';
import { env } from '@/lib/env';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState(env.localUserId);
  const [workspaceId, setWorkspaceId] = useState(env.localWorkspaceId);

  const getApiToken = useCallback(async () => null, []);
  const getLocalHeaders = useCallback(
    () => ({
      'x-user-id': userId,
      'x-workspace-id': workspaceId,
    }),
    [userId, workspaceId],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      mode: env.authMode,
      userId,
      workspaceId,
      setLocalUserId: setUserId,
      setLocalWorkspaceId: setWorkspaceId,
      getApiToken,
      getLocalHeaders,
    }),
    [getApiToken, getLocalHeaders, userId, workspaceId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
