import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  ClipboardList,
  FileText,
  FlaskConical,
  Gauge,
  GitCompare,
  History,
  MessageSquareText,
  Newspaper,
  PieChart,
  Radar,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Signal,
  Sparkles,
  Users,
  Wallet,
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
        id: 'research-continuity',
        label: 'Continuity',
        title: 'Research Continuity',
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
        id: 'compare',
        label: 'Compare',
        href: routes.compare,
        icon: GitCompare,
      },
    ],
  },
  {
    id: 'monitoring',
    label: 'Luna Monitoring',
    icon: ClipboardList,
    items: [
      {
        id: 'watchlists',
        label: 'Watchlists',
        title: 'Watchlists and briefs',
        href: routes.watchlists,
        icon: ClipboardList,
        mobile: true,
      },
      {
        id: 'alerts',
        label: 'Alerts',
        href: routes.alerts,
        icon: Bell,
      },
      {
        id: 'briefs-daily',
        label: 'Briefs',
        title: 'Daily briefs archive',
        href: routes.briefsDaily,
        icon: FileText,
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
    id: 'intelligence',
    label: 'Luna Intelligence',
    icon: Search,
    items: [
      {
        id: 'market-radar',
        label: 'Market Radar',
        href: '/intelligence/radar',
        icon: Radar,
        status: 'planned',
      },
      {
        id: 'news-terminal',
        label: 'News Terminal',
        href: '/intelligence/news',
        icon: Newspaper,
        status: 'planned',
      },
      {
        id: 'token-lab',
        label: 'Token Lab',
        href: '/intelligence/token-lab',
        icon: FlaskConical,
        status: 'planned',
      },
      {
        id: 'narratives',
        label: 'Narratives',
        href: '/intelligence/narratives',
        icon: Sparkles,
        status: 'planned',
      },
      {
        id: 'onchain-hub',
        label: 'On-chain Hub',
        href: '/intelligence/onchain',
        icon: Search,
        status: 'planned',
      },
    ],
  },
  {
    id: 'social',
    label: 'Luna Social',
    icon: MessageSquareText,
    items: [
      {
        id: 'research-chat',
        label: 'Research Chat',
        href: '/social/chat',
        icon: Bot,
        status: 'planned',
      },
      {
        id: 'rooms',
        label: 'Rooms',
        href: '/social/rooms',
        icon: Users,
        status: 'planned',
      },
      {
        id: 'feed',
        label: 'Feed',
        href: '/social/feed',
        icon: MessageSquareText,
        status: 'planned',
      },
      {
        id: 'published-thesis',
        label: 'Published Thesis',
        href: '/social/published-thesis',
        icon: BookOpen,
        status: 'planned',
      },
    ],
  },
  {
    id: 'portfolio',
    label: 'Luna Portfolio',
    icon: Wallet,
    items: [
      {
        id: 'paper-portfolio',
        label: 'Paper Portfolio',
        href: '/portfolio/paper',
        icon: PieChart,
        status: 'planned',
      },
      {
        id: 'risk-board',
        label: 'Risk Board',
        href: '/portfolio/risk',
        icon: ShieldAlert,
        status: 'planned',
      },
      {
        id: 'decision-log',
        label: 'Decision Log',
        href: '/portfolio/decisions',
        icon: ScrollText,
        status: 'planned',
      },
    ],
  },
  {
    id: 'lab',
    label: 'Luna Lab',
    icon: FlaskConical,
    items: [
      {
        id: 'model-lab',
        label: 'Model Lab',
        href: '/lab/models',
        icon: Bot,
        status: 'planned',
      },
      {
        id: 'strategy-sandbox',
        label: 'Strategy Sandbox',
        href: '/lab/strategy',
        icon: Sparkles,
        status: 'planned',
      },
      {
        id: 'agent-arena',
        label: 'Agent Arena',
        href: '/lab/agents',
        icon: Users,
        status: 'planned',
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
