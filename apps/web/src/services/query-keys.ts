import { useWorkspaceStore } from '@/store/useWorkspaceStore';

function queryIdentity() {
  const { mode, userId, workspaceId } = useWorkspaceStore.getState();
  return { authMode: mode, userId, workspaceId } as const;
}

function scopedResource(resource: string) {
  return [resource, queryIdentity()] as const;
}

function scopedFilters(resource: string, filters: Record<string, unknown>) {
  return [...scopedResource(resource), filters] as const;
}

export const queryKeys = {
  workbench: () => scopedResource('workbench'),
  workbenchAttention: (filters: Record<string, unknown>) =>
    scopedFilters('workbench-attention', filters),
  researchRunsRoot: () => scopedResource('research-runs'),
  researchRuns: (filters: Record<string, unknown>) =>
    scopedFilters('research-runs', filters),
  performanceRoot: () => scopedResource('performance'),
  performanceAnalytics: (filters: Record<string, unknown>) =>
    scopedFilters('performance-analytics', filters),
  performanceOutcomes: (filters: Record<string, unknown>) =>
    scopedFilters('performance-outcomes', filters),
  performanceTrend: (filters: Record<string, unknown>) =>
    scopedFilters('performance-trend', filters),
  performanceHealth: (filters: Record<string, unknown>) =>
    scopedFilters('performance-health', filters),
  comparison: (filters: Record<string, unknown>) =>
    scopedFilters('comparison', filters),
  researchRunWorkspace: (id: string) =>
    ['research-run-workspace', queryIdentity(), id] as const,
  researchRunSnapshots: (id: string) =>
    ['research-run-snapshots', queryIdentity(), id] as const,
  jobStatus: (id: string) => ['job-status', queryIdentity(), id] as const,
  thesesRoot: () => scopedResource('theses'),
  theses: (filters: Record<string, unknown>) => scopedFilters('theses', filters),
  thesis: (id: string) => ['thesis', queryIdentity(), id] as const,
  thesisMonitorPlan: (id: string) =>
    ['thesis-monitor-plan', queryIdentity(), id] as const,
  thesisPulses: (id: string) =>
    ['thesis-pulses', queryIdentity(), id] as const,
  thesisPulseMemos: (id: string) =>
    ['thesis-pulse-memos', queryIdentity(), id] as const,
  thesisScheduler: (id: string) =>
    ['thesis-scheduler', queryIdentity(), id] as const,
  thesisScenarios: (id: string) =>
    ['thesis-scenarios', queryIdentity(), id] as const,
  scenarioMonitor: (filters: Record<string, unknown>) =>
    scopedFilters('scenario-monitor', filters),
  signalsRoot: () => scopedResource('signals'),
  signals: (filters: Record<string, unknown>) =>
    scopedFilters('signals', filters),
  signal: (id: string) => ['signal', queryIdentity(), id] as const,
  signalsCountRoot: () => scopedResource('signals-count'),
  signalsCount: (filters: Record<string, unknown>) =>
    scopedFilters('signals-count', filters),
  watchlistsRoot: () => scopedResource('watchlists'),
  watchlists: (filters: Record<string, unknown>) =>
    scopedFilters('watchlists', filters),
  watchlistItems: (id: string) =>
    ['watchlist-items', queryIdentity(), id] as const,
  dailyBriefsRoot: () => scopedResource('daily-briefs'),
  dailyBriefs: (filters: Record<string, unknown>) =>
    scopedFilters('daily-briefs', filters),
  alertsRoot: () => scopedResource('alerts'),
  alerts: (filters: Record<string, unknown>) => scopedFilters('alerts', filters),
  alertScheduler: () => scopedResource('alert-scheduler'),
  operationsHealth: (filters: Record<string, unknown>) =>
    scopedFilters('operations-health', filters),
};
