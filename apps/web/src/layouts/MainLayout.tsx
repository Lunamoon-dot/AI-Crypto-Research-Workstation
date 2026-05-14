import { Outlet } from 'react-router-dom';
import { MobileBottomNav, SidebarNav } from '@/components/navigation/SidebarNav';
import { TopCommandStrip } from '@/components/navigation/TopCommandStrip';

export function MainLayout() {
  return (
    <div className="app-shell">
      <SidebarNav />
      <div className="main-shell">
        <TopCommandStrip />
        <Outlet />
      </div>
      <MobileBottomNav />
    </div>
  );
}
