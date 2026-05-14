import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  ClipboardList,
  FileText,
  FlaskConical,
  History,
  Radar,
  ScrollText,
  Settings,
  Signal,
} from 'lucide-react';
import { routes } from '@/lib/routes';

const navItems = [
  { href: routes.workbench, label: 'Workbench', icon: Radar },
  { href: routes.researchNew, label: 'Research', icon: FlaskConical },
  { href: routes.researchHistory, label: 'History', icon: History },
  { href: routes.theses, label: 'Theses', icon: ScrollText },
  { href: routes.signals, label: 'Signals', icon: Signal },
  { href: routes.alerts, label: 'Alerts', icon: Bell },
  { href: routes.watchlists, label: 'Watchlists', icon: ClipboardList },
  { href: routes.briefsDaily, label: 'Briefs', icon: FileText },
  { href: routes.operations, label: 'Operations', icon: Activity },
  { href: routes.settings, label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== routes.workbench && pathname.startsWith(href));
}

export function SidebarNav() {
  const { pathname } = useLocation();
  return (
    <aside className="sidebar">
      <h1 className="sidebar-title">LunaCrypto</h1>
      <p className="sidebar-subtitle">AI research workstation</p>
      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <NavLink
              className={`nav-link${active ? ' active' : ''}`}
              to={item.href}
              key={item.href}
            >
              <Icon aria-hidden size={16} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="badge degraded">local MVP</div>
        <div style={{ marginTop: 10 }} className="small muted">
          Research-only mode.
        </div>
      </div>
    </aside>
  );
}

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const mobileItems = [
    navItems[0],
    navItems[1],
    navItems[2],
    navItems[3],
    navItems[6],
  ];
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {mobileItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            aria-label={item.label}
            className={`mobile-nav-link${isActive(pathname, item.href) ? ' active' : ''}`}
            to={item.href}
            key={item.href}
          >
            <Icon aria-hidden size={18} />
          </NavLink>
        );
      })}
    </nav>
  );
}
