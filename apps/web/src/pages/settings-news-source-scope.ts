export function defaultWorkspaceNewsSourceScope(
  symbol: string | null | undefined,
): string | null {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const baseSymbol = normalized.split(/[/:]/)[0]?.replace(/[^A-Z0-9]/g, '');
  return baseSymbol || null;
}
