'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Bell,
  ClipboardList,
  FileText,
  Radar,
  ScrollText,
  Search,
  Settings,
  Signal,
} from 'lucide-react';
import { routes } from '@/lib/routes';

const navItems = [
  { href: routes.workbench, label: 'Workbench', icon: Radar },
  { href: routes.researchNew, label: 'Research', icon: Search },
  { href: routes.theses, label: 'Theses', icon: ScrollText },
  { href: routes.signals, label: 'Signals', icon: Signal },
  { href: routes.alerts, label: 'Alerts', icon: Bell },
  { href: routes.watchlists, label: 'Watchlists', icon: ClipboardList },
  { href: routes.briefsDaily, label: 'Briefs', icon: FileText },
  { href: routes.operations, label: 'Operations', icon: Activity },
  { href: routes.settings, label: 'Settings', icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <h1 className="sidebar-title">LunaCrypto</h1>
      <p className="sidebar-subtitle">Research Workstation</p>
      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== routes.workbench && pathname.startsWith(item.href));
          return (
            <Link
              className={`nav-link${active ? ' active' : ''}`}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div style={{ marginTop: 22 }} className="badge degraded">
        local MVP
      </div>
      <div style={{ marginTop: 10 }} className="small muted">
        No execution, no orders, no auto-trading.
      </div>
    </aside>
  );
}
