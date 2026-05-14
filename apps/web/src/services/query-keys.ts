export const queryKeys = {
  workbench: ['workbench'] as const,
  researchRuns: (filters: Record<string, unknown>) =>
    ['research-runs', filters] as const,
  researchRunWorkspace: (id: string) => ['research-run-workspace', id] as const,
  jobStatus: (id: string) => ['job-status', id] as const,
  theses: (filters: Record<string, unknown>) => ['theses', filters] as const,
  thesis: (id: string) => ['thesis', id] as const,
  thesisScenarios: (id: string) => ['thesis-scenarios', id] as const,
  signals: (filters: Record<string, unknown>) => ['signals', filters] as const,
  watchlists: (filters: Record<string, unknown>) =>
    ['watchlists', filters] as const,
  watchlistItems: (id: string) => ['watchlist-items', id] as const,
  dailyBriefs: (filters: Record<string, unknown>) =>
    ['daily-briefs', filters] as const,
  alerts: (filters: Record<string, unknown>) => ['alerts', filters] as const,
};
