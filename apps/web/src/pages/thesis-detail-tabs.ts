export const THESIS_DETAIL_TABS = [
  {
    id: 'brief',
    label: 'Thesis brief',
    description: 'Summary, risk boundary, monitor next',
  },
  {
    id: 'evidence',
    label: 'Evidence and contradictions',
    description: 'Reasons, risks, linked signals',
  },
  {
    id: 'scenario',
    label: 'Scenario radar',
    description: 'Conditional outcomes',
  },
  {
    id: 'journal',
    label: 'Manual decision journal',
    description: 'AI source rail',
  },
] as const;

export type ThesisDetailTab = (typeof THESIS_DETAIL_TABS)[number]['id'];

export function normalizeThesisDetailTab(value: string | null): ThesisDetailTab {
  return THESIS_DETAIL_TABS.some((tab) => tab.id === value)
    ? (value as ThesisDetailTab)
    : 'brief';
}

export function setThesisDetailTabParam(
  params: URLSearchParams,
  tab: ThesisDetailTab,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('tab', tab);
  return next;
}
