import { Bell, Search, UserCircle } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { WorkspaceSwitcher } from '@/components/navigation/WorkspaceSwitcher';
import { routes } from '@/lib/routes';

const titles: Array<[string, string]> = [
  [routes.workbench, 'Daily operating view'],
  [routes.researchNew, 'Research launcher'],
  ['/research/runs', 'Research workspace'],
  [routes.theses, 'Thesis library'],
  [routes.signals, 'Signal explorer'],
  [routes.watchlists, 'Watchlists and briefs'],
  [routes.briefsDaily, 'Daily briefs archive'],
  [routes.operations, 'Operations'],
  [routes.settings, 'Settings'],
];

export function TopCommandStrip() {
  const { pathname } = useLocation();
  const title =
    titles.find(([href]) => pathname === href || pathname.startsWith(href))?.[1] ??
    'Evidence-first crypto research';

  return (
    <header className="top-strip">
      <div>
        <p className="top-strip-title">{title}</p>
        <div className="small muted">Local research mode | API-backed workstation</div>
      </div>
      <label className="search-box" aria-label="Workspace search">
        <Search aria-hidden size={16} />
        <input placeholder="Search thesis, signal, run..." />
      </label>
      <div className="top-strip-actions">
        <WorkspaceSwitcher />
        <button className="button icon ghost" aria-label="Notifications" type="button">
          <Bell aria-hidden size={16} />
        </button>
        <button className="button icon ghost" aria-label="Account" type="button">
          <UserCircle aria-hidden size={16} />
        </button>
      </div>
    </header>
  );
}
