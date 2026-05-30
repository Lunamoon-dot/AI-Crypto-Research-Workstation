export const RESEARCH_CONTINUITY_TABS = [
  {
    id: 'general',
    label: 'General',
  },
  {
    id: 'lifecycle',
    label: 'Item Lifecycle',
  },
  {
    id: 'repair',
    label: 'Ledger Repair',
  },
] as const;

export type ResearchContinuityTab = (typeof RESEARCH_CONTINUITY_TABS)[number]['id'];

export function normalizeResearchContinuityTab(
  value: string | null,
): ResearchContinuityTab {
  return RESEARCH_CONTINUITY_TABS.some((tab) => tab.id === value)
    ? (value as ResearchContinuityTab)
    : 'general';
}

export function setResearchContinuityTabParam(
  params: URLSearchParams,
  tab: ResearchContinuityTab,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('tab', tab);
  return next;
}
