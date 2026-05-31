import type { WorkspaceSummary } from '@/types';

type WorkspaceActivationInput = {
  currentWorkspace: WorkspaceSummary | null;
  fixedOnly: boolean;
  legacyWorkspace?: WorkspaceSummary;
  listedWorkspaces: WorkspaceSummary[];
  workspaceId: string;
};

export function selectWorkspaceActivationTarget({
  currentWorkspace,
  fixedOnly,
  legacyWorkspace,
  listedWorkspaces,
  workspaceId,
}: WorkspaceActivationInput): WorkspaceSummary | null {
  const selectableWorkspaces = fixedOnly
    ? listedWorkspaces.filter(isFixedSymbolWorkspace)
    : listedWorkspaces;
  const activeWorkspace = selectableWorkspaces.find(
    (workspace) => workspace.id === workspaceId,
  );

  if (activeWorkspace) {
    return currentWorkspace?.id === activeWorkspace.id ? null : activeWorkspace;
  }

  if (fixedOnly) {
    return selectableWorkspaces[0] ?? null;
  }

  if (!isAuthoritativeWorkspace(currentWorkspace, listedWorkspaces)) {
    return (
      listedWorkspaces.find((workspace) => workspace.id === legacyWorkspace?.id) ??
      listedWorkspaces[0] ??
      legacyWorkspace ??
      null
    );
  }

  return null;
}

export function isFixedSymbolWorkspace(workspace: WorkspaceSummary): boolean {
  return workspace.scope_type === 'fixed_symbol';
}

export function isAuthoritativeWorkspace(
  workspace: WorkspaceSummary | null,
  workspaces: WorkspaceSummary[],
): boolean {
  return Boolean(
    workspace && workspaces.some((candidate) => candidate.id === workspace.id),
  );
}
