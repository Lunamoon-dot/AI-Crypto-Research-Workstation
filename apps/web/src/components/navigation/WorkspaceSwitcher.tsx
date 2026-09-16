import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { createWorkspace, listWorkspaces } from '@/services/workspaces';
import { legacyMixedWorkspace, useWorkspaceStore } from '@/store/useWorkspaceStore';
import {
  isFixedSymbolWorkspace,
  selectWorkspaceActivationTarget,
} from './workspace-switcher-model';
import type { WorkspaceMarketType, WorkspaceSummary } from '@/types';

type WorkspaceSwitcherProps = {
  fixedOnly?: boolean;
};

export function WorkspaceSwitcher({ fixedOnly = false }: WorkspaceSwitcherProps) {
  const auth = useWorkspaceStore();
  const { setWorkspace, workspace, workspaceId } = auth;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const marketType: WorkspaceMarketType = 'perp';

  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspacesRoot(),
    queryFn: () => listWorkspaces(auth),
    staleTime: 60_000,
  });

  useEffect(() => {
    const listedWorkspaces = workspacesQuery.data;
    if (!listedWorkspaces) {
      return;
    }

    const activationTarget = selectWorkspaceActivationTarget({
      currentWorkspace: workspace,
      fixedOnly,
      legacyWorkspace: legacyMixedWorkspace,
      listedWorkspaces,
      workspaceId,
    });

    if (activationTarget) {
      setWorkspace(activationTarget);
    }
  }, [fixedOnly, setWorkspace, workspace, workspaceId, workspacesQuery.data]);

  const fallbackActiveWorkspace = workspace ?? legacyMixedWorkspace;
  const workspaces = useMemo(() => {
    const listed = workspacesQuery.data ?? [];
    const selectableWorkspaces = fixedOnly
      ? listed.filter(isFixedSymbolWorkspace)
      : listed;

    if (fixedOnly) {
      return selectableWorkspaces;
    }

    return selectableWorkspaces.some(
      (workspace) => workspace.id === fallbackActiveWorkspace.id,
    )
      ? selectableWorkspaces
      : [fallbackActiveWorkspace, ...selectableWorkspaces];
  }, [fallbackActiveWorkspace, fixedOnly, workspacesQuery.data]);
  const activeWorkspace = fixedOnly
    ? workspaces.find((candidate) => candidate.id === workspaceId) ??
      workspaces[0] ??
      null
    : fallbackActiveWorkspace;
  const activeWorkspaceContext = activeWorkspace
    ? workspaceContext(activeWorkspace)
    : 'Fixed-symbol only';

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspace(
        {
          name: name.trim(),
          symbol: symbol.trim(),
          market_type: marketType,
        },
        auth,
      ),
    onSuccess: async (workspace) => {
      setWorkspace(workspace);
      setName('');
      setSymbol('');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspacesRoot() });
    },
  });

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() && symbol.trim()) {
      createMutation.mutate();
    }
  }

  return (
    <div className="workspace-switcher">
      <button
        aria-expanded={open}
        className="workspace-switcher-trigger"
        title={
          activeWorkspace
            ? `Current workspace: ${activeWorkspace.name}`
            : 'Select fixed-symbol workspace'
        }
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-switcher-copy">
          <span>{activeWorkspace?.name ?? 'Select workspace'}</span>
          <strong>{activeWorkspaceContext}</strong>
        </span>
        <ChevronDown aria-hidden className={open ? 'open' : undefined} size={15} />
      </button>

      {open ? (
        <div className="workspace-switcher-menu" role="dialog" aria-label="Workspace selector">
          <div className="workspace-switcher-list">
            {workspaces.map((workspace) => (
              <button
                className={
                  workspace.id === activeWorkspace?.id
                    ? 'workspace-switcher-option active'
                    : 'workspace-switcher-option'
                }
                key={workspace.id}
                type="button"
                onClick={() => {
                  setWorkspace(workspace);
                  setOpen(false);
                }}
              >
                <span>
                  <strong>{workspace.name}</strong>
                  <small>{workspaceContext(workspace)}</small>
                </span>
                {workspace.id === activeWorkspace?.id ? <Check aria-hidden size={15} /> : null}
              </button>
            ))}
            {workspacesQuery.isError ? (
              <span className="workspace-switcher-error">Workspace list unavailable.</span>
            ) : null}
          </div>

          <form className="workspace-create-form" onSubmit={submitCreate}>
            <strong>Create workspace</strong>
            <input
              aria-label="Workspace name"
              className="top-command-input workspace-create-input"
              placeholder="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              aria-label="Workspace symbol"
              className="top-command-input workspace-create-input"
              placeholder="BTC"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            />
            <button
              className="button primary workspace-create-button"
              disabled={createMutation.isPending || !name.trim() || !symbol.trim()}
              type="submit"
            >
              <Plus aria-hidden size={15} />
              <span>{createMutation.isPending ? 'Creating' : 'Create'}</span>
            </button>
            {createMutation.error ? (
              <span className="workspace-switcher-error">
                {errorMessage(createMutation.error)}
              </span>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}

function workspaceContext(workspace: WorkspaceSummary): string {
  if (workspace.scope_type === 'legacy_mixed') {
    return 'Legacy mixed';
  }
  return workspace.symbol ?? 'Fixed symbol';
}
