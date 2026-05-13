import { SidebarNav } from '@/app/sidebar-nav';
import { TopCommandStrip } from '@/app/top-command-strip';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <SidebarNav />
      <div className="main-shell">
        <TopCommandStrip />
        {children}
      </div>
    </div>
  );
}
