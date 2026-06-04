import { Outlet } from 'react-router-dom';
import { MobileBottomNav, SidebarNav } from '@/components/navigation/SidebarNav';

export function MainLayout() {
  return (
    <div className="app-shell">
      <SidebarNav />
      <div className="main-shell">
        <Outlet />
      </div>
      <MobileBottomNav />
    </div>
  );
}
