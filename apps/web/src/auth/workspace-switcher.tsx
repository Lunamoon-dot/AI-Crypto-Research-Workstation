'use client';

import { useAuth } from '@/auth/auth-provider';

export function WorkspaceSwitcher() {
  const auth = useAuth();
  return (
    <div className="top-strip-meta">
      <span className="badge">auth: {auth.mode}</span>
      <span className="badge">user: {auth.userId}</span>
      <span className="badge">workspace: {auth.workspaceId}</span>
    </div>
  );
}
