import type {
  ResearchContinuityEntrySummaryResponse,
  ResearchContinuityStateResponse,
  ResearchContinuityThinReport,
} from '../types';

export interface ContinuitySnapshotView {
  directionalBias: string;
  riskPosture: string;
  conviction: string;
  timeContext: string;
  latestRunId: string | null;
  latestEntryId: string | null;
  activeItemCount: number;
  activeScenarioCount: number;
  capturedItemCount: number;
  memoryKind: 'active' | 'captured' | 'empty';
  memoryLabel: string;
  updatedAt: string | null;
}

export interface ActiveScenarioBranchView {
  key: string;
  branchType: string;
  probabilityBand: string;
  condition: string;
  occurrenceCount: number;
}

export interface CapturedContinuityMemoryGroup {
  id: 'active_risks' | 'material_changes' | 'watchpoints';
  title: string;
  description: string;
  items: string[];
}

const CAPTURED_MEMORY_SECTIONS: CapturedContinuityMemoryGroup[] = [
  {
    id: 'active_risks',
    title: 'Active Risks',
    description: 'Captured risks and invalidations from the latest entry',
    items: [],
  },
  {
    id: 'watchpoints',
    title: 'Watchpoints',
    description: 'Captured signals, levels, and invalidation checks',
    items: [],
  },
  {
    id: 'material_changes',
    title: 'Material Changes',
    description: 'Captured continuity changes from the research run',
    items: [],
  },
];

export function buildContinuitySnapshotView({
  latestEntry,
  state,
}: {
  latestEntry: Pick<
    ResearchContinuityEntrySummaryResponse,
    'diff_summary' | 'generated_at' | 'id' | 'research_run_id' | 'thin_report'
  > | null;
  state: Pick<
    ResearchContinuityStateResponse,
    | 'active_items'
    | 'active_scenarios'
    | 'current_view'
    | 'latest_entry_id'
    | 'latest_run_id'
    | 'updated_at'
  > | null;
}): ContinuitySnapshotView | null {
  const fallbackView = currentViewFromThinReport(latestEntry?.thin_report ?? null);
  if (!state && Object.keys(fallbackView).length === 0) {
    return null;
  }
  const stateView = recordValue(state?.current_view);
  const activeItemCount = records(state?.active_items).length;
  const activeScenarioCount = records(state?.active_scenarios).length;
  const capturedItemCount =
    activeItemCount > 0 ? 0 : numberValue(latestEntry?.diff_summary.added_count);
  const memoryKind =
    activeItemCount + activeScenarioCount > 0
      ? 'active'
      : capturedItemCount > 0
        ? 'captured'
        : 'empty';
  const memoryLabel =
    memoryKind === 'active'
      ? `${activeItemCount + activeScenarioCount} active`
      : memoryKind === 'captured'
        ? `${capturedItemCount} captured`
        : '0 active';

  return {
    directionalBias: stringValue(
      stateView.directional_bias,
      fallbackView.directionalBias ?? 'n/a',
    ),
    riskPosture: stringValue(
      stateView.risk_posture,
      fallbackView.riskPosture ?? 'n/a',
    ),
    conviction: stringValue(stateView.conviction, fallbackView.conviction ?? 'n/a'),
    timeContext: stringValue(
      stateView.time_context,
      fallbackView.timeContext ?? 'n/a',
    ),
    latestRunId: state?.latest_run_id ?? latestEntry?.research_run_id ?? null,
    latestEntryId: state?.latest_entry_id ?? latestEntry?.id ?? null,
    activeItemCount,
    activeScenarioCount,
    capturedItemCount,
    memoryKind,
    memoryLabel,
    updatedAt: state?.updated_at ?? latestEntry?.generated_at ?? null,
  };
}

export function buildActiveScenarioBranchViews(
  state: Pick<ResearchContinuityStateResponse, 'active_scenarios'> | null,
): ActiveScenarioBranchView[] {
  return records(state?.active_scenarios)
    .map((scenario, index) => ({
      key: stringValue(scenario.scenario_key, `scenario-${index + 1}`),
      branchType: stringValue(scenario.branch_type, 'scenario'),
      probabilityBand: stringValue(scenario.probability_band, 'unknown'),
      condition: stringValue(scenario.condition, 'Scenario condition unavailable.'),
      occurrenceCount: numberValue(scenario.occurrence_count) || 1,
    }))
    .filter((scenario) => scenario.condition);
}

export function buildCapturedContinuityMemoryGroups(
  latestEntry: Pick<ResearchContinuityEntrySummaryResponse, 'thin_report'> | null,
): CapturedContinuityMemoryGroup[] {
  const sections = latestEntry?.thin_report?.sections ?? [];
  return CAPTURED_MEMORY_SECTIONS.map((definition) => {
    const section = sections.find((item) => item.id === definition.id);
    return {
      ...definition,
      title: section?.title ?? definition.title,
      items: cleanMemoryItems(section?.items ?? []),
    };
  }).filter((group) => group.items.length > 0);
}

function currentViewFromThinReport(
  report: Pick<ResearchContinuityThinReport, 'sections'> | null,
): Partial<
  Pick<
    ContinuitySnapshotView,
    'conviction' | 'directionalBias' | 'riskPosture' | 'timeContext'
  >
> {
  const section = report?.sections.find(
    (item) => item.id === 'current_view' || item.title === 'Current View',
  );
  const view: Partial<
    Pick<
      ContinuitySnapshotView,
      'conviction' | 'directionalBias' | 'riskPosture' | 'timeContext'
    >
  > = {};
  for (const item of section?.items ?? []) {
    const parsed = parseCurrentViewItem(item);
    if (!parsed) {
      continue;
    }
    view[parsed.key] = parsed.value;
  }
  return view;
}

function parseCurrentViewItem(
  item: string,
): {
  key: 'conviction' | 'directionalBias' | 'riskPosture' | 'timeContext';
  value: string;
} | null {
  const separatorIndex = item.indexOf(':');
  if (separatorIndex < 0) {
    return null;
  }
  const label = item.slice(0, separatorIndex).trim().toLowerCase();
  const value = normalizeSentenceValue(item.slice(separatorIndex + 1));
  if (!value) {
    return null;
  }
  switch (label) {
    case 'directional bias':
      return { key: 'directionalBias', value };
    case 'risk posture':
      return { key: 'riskPosture', value };
    case 'conviction':
      return { key: 'conviction', value };
    case 'time context':
      return { key: 'timeContext', value };
    default:
      return null;
  }
}

function normalizeSentenceValue(value: string): string {
  return value.trim().replace(/\.$/, '');
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function stringValue(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function cleanMemoryItems(items: string[]): string[] {
  return items
    .map((item) => item.trim())
    .filter((item) => item && !/^no\b/i.test(item));
}
