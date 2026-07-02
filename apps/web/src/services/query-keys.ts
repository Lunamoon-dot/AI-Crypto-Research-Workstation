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
  workspacesRoot: () => scopedResource('workspaces'),
  workspace: (id: string) => ['workspace', queryIdentity(), id] as const,
  workspaceNewsSources: (id: string) =>
    ['workspace-news-sources', queryIdentity(), id] as const,
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
  calibrationRoot: () => scopedResource('calibration'),
  calibrationMaturedPreview: (filters: Record<string, unknown>) =>
    scopedFilters('calibration-matured-preview', filters),
  calibrationSymbol: (filters: Record<string, unknown>) =>
    scopedFilters('calibration-symbol', filters),
  calibrationAgents: (filters: Record<string, unknown>) =>
    scopedFilters('calibration-agents', filters),
  calibrationEvaluations: (filters: Record<string, unknown>) =>
    scopedFilters('calibration-evaluations', filters),
  calibrationEvaluation: (id: string) =>
    ['calibration-evaluation', queryIdentity(), id] as const,
  calibrationEvaluationReruns: (id: string) =>
    ['calibration-evaluation-reruns', queryIdentity(), id] as const,
  calibrationEvaluationVersionPolicy: (id: string) =>
    ['calibration-evaluation-version-policy', queryIdentity(), id] as const,
  researchRunWorkspace: (id: string) =>
    ['research-run-workspace', queryIdentity(), id] as const,
  researchRunContinuity: (id: string) =>
    ['research-run-continuity', queryIdentity(), id] as const,
  researchContinuityState: (symbol: string) =>
    ['research-continuity-state', queryIdentity(), symbol] as const,
  researchContinuityEntries: (filters: Record<string, unknown>) =>
    scopedFilters('research-continuity-entries', filters),
  researchContinuityTimeline: (filters: Record<string, unknown>) =>
    scopedFilters('research-continuity-timeline', filters),
  researchContinuityEntry: (id: string) =>
    ['research-continuity-entry', queryIdentity(), id] as const,
  researchContinuityEntryDebug: (id: string) =>
    ['research-continuity-entry-debug', queryIdentity(), id] as const,
  researchContinuitySettings: () =>
    scopedResource('research-continuity-settings'),
  researchContinuityScheduler: () =>
    scopedResource('research-continuity-scheduler'),
  researchContinuityRepairPreview: (filters: Record<string, unknown>) =>
    scopedFilters('research-continuity-repair-preview', filters),
  researchContinuityRepairRuns: (filters: Record<string, unknown>) =>
    scopedFilters('research-continuity-repair-runs', filters),
  researchContinuityRepairRun: (id: string) =>
    ['research-continuity-repair-run', queryIdentity(), id] as const,
  researchRunSnapshots: (id: string) =>
    ['research-run-snapshots', queryIdentity(), id] as const,
  jobStatus: (id: string) => ['job-status', queryIdentity(), id] as const,
  marketOhlcv: (
    symbol: string,
    marketType: string,
    provider: string,
    interval: string,
    rangeKey: string,
  ) =>
    [
      'market-ohlcv',
      queryIdentity(),
      symbol,
      marketType,
      provider,
      interval,
      rangeKey,
    ] as const,
  thesesRoot: () => scopedResource('theses'),
  theses: (filters: Record<string, unknown>) => scopedFilters('theses', filters),
  thesis: (id: string) => ['thesis', queryIdentity(), id] as const,
  thesisScenarios: (id: string) =>
    ['thesis-scenarios', queryIdentity(), id] as const,
  scenarioMonitor: (filters: Record<string, unknown>) =>
    scopedFilters('scenario-monitor', filters),
  scenarioChart: (id: string, interval: string) =>
    ['scenario-chart', queryIdentity(), id, interval] as const,
  scenarioDecisionWorkbench: () =>
    scopedResource('scenario-decision-workbench'),
  signalsRoot: () => scopedResource('signals'),
  signals: (filters: Record<string, unknown>) =>
    scopedFilters('signals', filters),
  signal: (id: string) => ['signal', queryIdentity(), id] as const,
  signalsCountRoot: () => scopedResource('signals-count'),
  signalsCount: (filters: Record<string, unknown>) =>
    scopedFilters('signals-count', filters),
  signalEvaluationReports: (filters: Record<string, unknown>) =>
    scopedFilters('signal-evaluation-reports', filters),
  signalModelMonitoringLatest: () =>
    scopedResource('signal-model-monitoring-latest'),
  alertsRoot: () => scopedResource('alerts'),
  alerts: (filters: Record<string, unknown>) => scopedFilters('alerts', filters),
  operationsHealth: (filters: Record<string, unknown>) =>
    scopedFilters('operations-health', filters),
};
