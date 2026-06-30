import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  ClipboardList,
  FlaskConical,
  Gauge,
  History,
  Radar,
  ScrollText,
  Settings,
  Signal,
} from 'lucide-react';
import { routes } from '@/lib/routes';

export type NavigationStatus = 'active' | 'planned' | 'hidden';

export type NavigationItem = {
  id: string;
  label: string;
  title?: string;
  href: string;
  icon: LucideIcon;
  status?: NavigationStatus;
  mobile?: boolean;
  matchPaths?: string[];
};

export type NavigationGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  status?: NavigationStatus;
  items: NavigationItem[];
};

export const navGroups: NavigationGroup[] = [
  {
    id: 'research',
    label: 'Luna Research',
    icon: Radar,
    items: [
      {
        id: 'workbench',
        label: 'Workbench',
        title: 'Daily operating view',
        href: routes.workbench,
        icon: Radar,
        mobile: true,
      },
      {
        id: 'research-chat',
        label: 'RAG Chat',
        title: 'Structured research chat',
        href: routes.researchChat,
        icon: Bot,
        mobile: true,
      },
      {
        id: 'research-new',
        label: 'New Research',
        title: 'Research launcher',
        href: routes.researchNew,
        icon: FlaskConical,
        mobile: true,
      },
      {
        id: 'research-history',
        label: 'History',
        href: routes.researchHistory,
        icon: History,
        mobile: true,
      },
      {
        id: 'research-workspace',
        label: 'Workspace Config',
        title: 'Workspace configuration',
        href: routes.researchWorkspace,
        icon: Settings,
      },
      {
        id: 'research-continuity',
        label: 'Continuity',
        title: 'Research continuity ledger',
        href: routes.researchContinuity(),
        icon: Activity,
        mobile: true,
      },
      {
        id: 'theses',
        label: 'Theses',
        title: 'Thesis library',
        href: routes.theses,
        icon: ScrollText,
        mobile: true,
        matchPaths: ['/theses/'],
      },
      {
        id: 'signals',
        label: 'Signals',
        title: 'Signal explorer',
        href: routes.signals,
        icon: Signal,
        matchPaths: ['/signals/'],
      },
      {
        id: 'scenarios',
        label: 'Scenarios',
        href: routes.scenarios,
        icon: Radar,
      },
      {
        id: 'scenario-decision',
        label: 'Decision Queue',
        title: 'Scenario decision workbench',
        href: routes.scenarioDecision,
        icon: ClipboardList,
      },
    ],
  },
  {
    id: 'monitoring',
    label: 'Luna Monitoring',
    icon: ClipboardList,
    items: [
      {
        id: 'alerts',
        label: 'Alerts',
        href: routes.alerts,
        icon: Bell,
      },
      {
        id: 'performance',
        label: 'Reliability',
        title: 'Thesis reliability',
        href: routes.performance,
        icon: BarChart3,
      },
      {
        id: 'calibration',
        label: 'Calibration',
        href: routes.calibration,
        icon: Gauge,
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings,
    items: [
      {
        id: 'operations',
        label: 'Operations',
        href: routes.operations,
        icon: Activity,
      },
      {
        id: 'settings',
        label: 'Settings',
        href: routes.settings,
        icon: Settings,
      },
    ],
  },
];

export const visibleNavGroups = navGroups
  .filter((group) => group.status !== 'hidden')
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => item.status !== 'hidden'),
  }))
  .filter((group) => group.items.length > 0);

export const mobileNavItems = visibleNavGroups.flatMap((group) =>
  group.items.filter((item) => item.mobile && item.status !== 'planned'),
);

const auxiliaryTitles: Array<[string, string]> = [
  ['/research/runs', 'Research workspace'],
  ['/journal/runs', 'Journal workspace'],
];

export function isNavItemActive(pathname: string, item: NavigationItem): boolean {
  if (item.status === 'planned') {
    return false;
  }

  const normalizedPath = stripQuery(pathname);
  if (normalizedPath === item.href) {
    return true;
  }
  return item.matchPaths?.some((path) => normalizedPath.startsWith(path)) ?? false;
}

export function findNavigationTitle(pathname: string): string {
  const normalizedPath = stripQuery(pathname);
  const matchedItem = visibleNavGroups
    .flatMap((group) => group.items)
    .find((item) => isNavItemActive(normalizedPath, item));

  if (matchedItem) {
    return matchedItem.title ?? matchedItem.label;
  }

  return (
    auxiliaryTitles.find(([href]) => normalizedPath.startsWith(href))?.[1] ??
    'Evidence-first crypto research'
  );
}

function stripQuery(pathname: string): string {
  return pathname.split(/[?#]/, 1)[0] || '/';
}
