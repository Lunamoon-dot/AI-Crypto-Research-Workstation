import { BadRequestException } from '@nestjs/common';

export type WorkspaceScopeType = 'fixed_symbol' | 'legacy_mixed';
export type WorkspaceMarketType = 'mixed' | 'spot' | 'perp';

export interface WorkspaceMetadata {
  id: string;
  name: string;
  scope_type: WorkspaceScopeType;
  symbol: string | null;
  market_type: WorkspaceMarketType;
  default_timeframe: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export function normalizeWorkspaceSymbol(input: string): string {
  const value = input.trim().toUpperCase();
  if (!value) {
    throw new BadRequestException('Workspace symbol is required.');
  }

  const [base, quote] = splitWorkspaceSymbol(value);
  if (!base || quote !== 'USDT' || !/^[A-Z0-9]+$/.test(base)) {
    throw new BadRequestException(
      'Workspace symbol must use the BASE/USDT format.',
    );
  }
  return `${base}/USDT`;
}

export function validateWorkspaceMetadata(
  workspace: WorkspaceMetadata,
): WorkspaceMetadata {
  if (workspace.scope_type === 'fixed_symbol') {
    if (!workspace.symbol) {
      throw new BadRequestException(
        'Fixed-symbol workspaces must have a symbol.',
      );
    }
    return {
      ...workspace,
      symbol: normalizeWorkspaceSymbol(workspace.symbol),
    };
  }

  if (workspace.scope_type === 'legacy_mixed') {
    if (workspace.symbol !== null) {
      throw new BadRequestException(
        'Legacy mixed workspaces cannot have a fixed symbol.',
      );
    }
    return workspace;
  }

  throw new BadRequestException('Unsupported workspace scope type.');
}

function splitWorkspaceSymbol(value: string): [string, string] {
  if (value.includes('/')) {
    const parts = value.split('/');
    if (parts.length !== 2) {
      return ['', ''];
    }
    return [parts[0] ?? '', parts[1] ?? ''];
  }

  if (value.endsWith('USDT') && value.length > 'USDT'.length) {
    return [value.slice(0, -'USDT'.length), 'USDT'];
  }

  return [value, 'USDT'];
}
