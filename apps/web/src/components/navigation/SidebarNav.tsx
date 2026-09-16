import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, UserCircle } from 'lucide-react';
import { WorkspaceSwitcher } from '@/components/navigation/WorkspaceSwitcher';
import {
  isNavItemActive,
  mobileNavItems,
  visibleNavGroups,
  type NavigationItem,
} from '@/navigation/nav-groups';

const NAV_GROUP_STORAGE_KEY = 'lunacrypto.nav.expandedGroups';

function defaultExpandedGroups(): string[] {
  return visibleNavGroups.map((group) => group.id);
}

function initialExpandedGroups(): string[] {
  if (typeof window === 'undefined') {
    return defaultExpandedGroups();
  }

  const visibleGroupIds = new Set(defaultExpandedGroups());

  try {
    const stored = window.localStorage.getItem(NAV_GROUP_STORAGE_KEY);
    if (!stored) {
      return defaultExpandedGroups();
    }
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (id): id is string => typeof id === 'string' && visibleGroupIds.has(id),
      );
    }
  } catch {
    return defaultExpandedGroups();
  }

  return defaultExpandedGroups();
}

function NavItemLink({ item, pathname }: { item: NavigationItem; pathname: string }) {
  const Icon = item.icon;
  const active = isNavItemActive(pathname, item);

  if (item.status === 'planned') {
    return (
      <div className="nav-link nav-link-child nav-link-planned" aria-disabled="true">
        <span className="nav-link-dot" aria-hidden />
        <Icon aria-hidden size={15} />
        <span className="nav-link-label">{item.label}</span>
        <span className="nav-link-status">planned</span>
      </div>
    );
  }

  return (
    <NavLink className={`nav-link nav-link-child${active ? ' active' : ''}`} to={item.href}>
      <span className="nav-link-dot" aria-hidden />
      <Icon aria-hidden size={15} />
      <span className="nav-link-label">{item.label}</span>
    </NavLink>
  );
}

export function SidebarNav() {
  const { pathname } = useLocation();
  const [expandedGroupIds, setExpandedGroupIds] = useState(initialExpandedGroups);
  const expandedGroups = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify(expandedGroupIds));
    } catch {
      // Local storage is only a convenience for the app shell.
    }
  }, [expandedGroupIds]);

  function toggleGroup(groupId: string) {
    setExpandedGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  }

  return (
    <aside className="sidebar">
      <h1 className="sidebar-title">LunaCrypto</h1>
      <p className="sidebar-subtitle">AI research workstation</p>
      <nav className="nav-list" aria-label="Main navigation">
        {visibleNavGroups.map((group) => {
          const GroupIcon = group.icon;
          const groupActive = group.items.some((item) => isNavItemActive(pathname, item));
          const open = expandedGroups.has(group.id) || groupActive;
          return (
            <section className={`nav-group${groupActive ? ' active' : ''}`} key={group.id}>
              <button
                aria-expanded={open}
                className="nav-group-trigger"
                type="button"
                onClick={() => toggleGroup(group.id)}
              >
                <GroupIcon aria-hidden size={17} />
                <span>{group.label}</span>
                <ChevronDown
                  aria-hidden
                  className={`nav-group-chevron${open ? ' open' : ''}`}
                  size={15}
                />
              </button>
              {open ? (
                <div className="nav-group-items">
                  {group.items.map((item) => (
                    <NavItemLink item={item} pathname={pathname} key={item.id} />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-footer-actions">
          <WorkspaceSwitcher />
          <button className="button icon ghost" aria-label="Account" type="button">
            <UserCircle aria-hidden size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function MobileBottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {mobileNavItems.map((item) => {
        const Icon = item.icon;
        const active = isNavItemActive(pathname, item);
        return (
          <NavLink
            aria-label={item.label}
            className={`mobile-nav-link${active ? ' active' : ''}`}
            to={item.href}
            key={item.id}
          >
            <Icon aria-hidden size={18} />
          </NavLink>
        );
      })}
    </nav>
  );
}
