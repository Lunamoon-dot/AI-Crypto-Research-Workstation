'use client';

import { useAuth } from '@/auth/auth-provider';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { env } from '@/lib/env';

export function SettingsPage() {
  const auth = useAuth();
  return (
    <main className="page">
      <PageHeader
        title="Settings"
        description="Current MVP is local-first and uses development header auth."
      />
      <div className="grid two">
        <Panel title="Local identity">
          <div className="stack">
            <label className="label">
              User ID
              <input
                className="input"
                value={auth.userId}
                onChange={(event) => auth.setLocalUserId(event.target.value)}
              />
            </label>
            <label className="label">
              Workspace ID
              <input
                className="input"
                value={auth.workspaceId}
                onChange={(event) => auth.setLocalWorkspaceId(event.target.value)}
              />
            </label>
            <p className="small muted">
              These values are sent as x-user-id and x-workspace-id only in local mode.
            </p>
          </div>
        </Panel>
        <Panel title="Runtime">
          <div className="stack small">
            <div className="row"><span>Auth mode</span><span>{auth.mode}</span></div>
            <div className="row"><span>API proxy</span><span>{env.apiBaseUrl}</span></div>
            <div className="row"><span>Default profile</span><span>default</span></div>
            <div className="badge warning">Not hosted-auth safe</div>
          </div>
        </Panel>
      </div>
    </main>
  );
}
