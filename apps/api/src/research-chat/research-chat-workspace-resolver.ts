import { WorkspacesService } from '../workspaces/workspaces.service';

export async function resolveResearchChatWorkspace(
  workspaces: WorkspacesService,
  userId: string,
  currentWorkspaceId: string,
  symbol: string | null,
): Promise<string> {
  if (!symbol) {
    return currentWorkspaceId;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const currentWorkspace = await workspaces.getMetadataById(currentWorkspaceId);
  if (
    currentWorkspace?.scope_type === 'fixed_symbol' &&
    currentWorkspace.symbol?.toUpperCase() === normalizedSymbol
  ) {
    return currentWorkspaceId;
  }

  const accessibleWorkspaces = await workspaces.listMetadata(userId);
  const symbolWorkspace = accessibleWorkspaces.find(
    (workspace) =>
      workspace.scope_type === 'fixed_symbol' &&
      workspace.symbol?.toUpperCase() === normalizedSymbol,
  );

  return symbolWorkspace?.id ?? currentWorkspaceId;
}
