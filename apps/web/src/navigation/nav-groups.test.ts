import { routes } from '@/lib/routes';
import {
  findNavigationTitle,
  isNavItemActive,
  mobileNavItems,
  visibleNavGroups,
} from './nav-groups';

const visibleGroupLabels = visibleNavGroups.map((group) => group.label);

if (!visibleGroupLabels.includes('Luna Research')) {
  throw new Error('Luna Research group should be visible.');
}

if (!visibleGroupLabels.includes('Luna Monitoring')) {
  throw new Error('Luna Monitoring group should be visible.');
}

if (visibleGroupLabels.includes('Luna Intelligence')) {
  throw new Error('Future intelligence routes should stay hidden until implemented.');
}

const mobileHrefs = mobileNavItems.map((item) => item.href);

for (const href of [
  routes.workbench,
  routes.researchNew,
  routes.researchHistory,
  routes.theses,
  routes.watchlists,
]) {
  if (!mobileHrefs.includes(href)) {
    throw new Error(`Mobile navigation is missing ${href}.`);
  }
}

const thesesItem = visibleNavGroups
  .flatMap((group) => group.items)
  .find((item) => item.id === 'theses');

if (!thesesItem || !isNavItemActive('/theses/abc', thesesItem)) {
  throw new Error('Nested thesis routes should activate the Theses navigation item.');
}

if (findNavigationTitle('/calibration?mode=symbol') !== 'Calibration') {
  throw new Error('Top strip title should resolve from navigation metadata.');
}
