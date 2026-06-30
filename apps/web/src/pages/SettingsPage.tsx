import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ServerCog, Trash2, UserRound } from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid, DataPair } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { env } from '@/lib/env';
import { errorMessage } from '@/services/client';
import { deleteWorkspaceResearchRunData } from '@/services/research-runs';

export function SettingsPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const resetRunDataMutation = useMutation({
    mutationFn: () => deleteWorkspaceResearchRunData(auth),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
  const resetRunDataStatus = resetRunDataMutation.data
    ? resetRunDataMutation.data.deleted_count > 0
      ? `${resetRunDataMutation.data.deleted_count} runs deleted`
      : resetRunDataMutation.data.removed
        ? 'Run data cleared'
        : 'No run data'
    : null;

  function updateLocalUserId(userId: string) {
    auth.setLocalUserId(userId);
    queryClient.clear();
  }

  function updateLocalWorkspaceId(workspaceId: string) {
    auth.setLocalWorkspaceId(workspaceId);
    queryClient.clear();
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="07 Settings"
        title="Settings"
        description="Local-first identity and runtime configuration for the current MVP."
        action={
          <HeaderStats
            stats={[
              {
                icon: <KeyRound aria-hidden size={14} />,
                label: 'Auth mode',
                tone: 'primary',
                value: auth.mode,
              },
              {
                icon: <UserRound aria-hidden size={14} />,
                label: 'User',
                meta: auth.userId,
                value: auth.userId.slice(0, 10),
              },
              {
                icon: <ServerCog aria-hidden size={14} />,
                label: 'Runtime',
                meta: env.apiBaseUrl,
                tone: 'warning',
                value: 'Local',
              },
            ]}
          />
        }
      />
      <BentoGrid>
        <Panel className="span-6 emphasis" title="Local identity">
          <div className="stack">
            <label className="label">
              User ID
              <input
                className="input"
                value={auth.userId}
                onChange={(event) => updateLocalUserId(event.target.value)}
              />
            </label>
            <label className="label">
              Workspace ID
              <input
                className="input"
                value={auth.workspaceId}
                onChange={(event) => updateLocalWorkspaceId(event.target.value)}
              />
            </label>
            <p className="small muted">
              These values are sent as x-user-id and x-workspace-id only in local mode.
            </p>
          </div>
        </Panel>
        <Panel className="span-6" title="Runtime">
          <div className="stack small">
            <DataPair label="Auth mode" value={auth.mode} />
            <DataPair label="API proxy" value={env.apiBaseUrl} />
            <DataPair label="Default profile" value="default" />
            <span className="badge warning">Not hosted-auth safe</span>
          </div>
        </Panel>
        <Panel
          className="span-12"
          title="Run data"
          description="Deletes research runs and linked artifacts for the current workspace. Workspace identity and configuration stay in place."
        >
          <div className="top-strip-meta">
            <DataPair label="Workspace" value={auth.workspaceId} />
            <button
              className="button risk"
              disabled={resetRunDataMutation.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Clear all research run data for workspace ${auth.workspaceId}?`,
                  )
                ) {
                  resetRunDataMutation.mutate();
                }
              }}
              type="button"
            >
              <Trash2 aria-hidden size={15} />
              {resetRunDataMutation.isPending ? 'Clearing' : 'Clear run data'}
            </button>
            {resetRunDataMutation.isSuccess && resetRunDataStatus ? (
              <span className="badge constructive">
                {resetRunDataStatus}
              </span>
            ) : null}
            {resetRunDataMutation.isError ? (
              <span className="badge risk">
                {errorMessage(resetRunDataMutation.error)}
              </span>
            ) : null}
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}
