import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultWorkspaceNewsSourceScope } from '../src/pages/settings-news-source-scope.ts';

test('workspace configuration page exposes workspace news source management', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/WorkspaceConfigurationPage.tsx', import.meta.url),
    'utf8',
  );
  const settingsSource = readFileSync(
    new URL('../src/pages/SettingsPage.tsx', import.meta.url),
    'utf8',
  );
  const routesSource = readFileSync(
    new URL('../src/routes/index.tsx', import.meta.url),
    'utf8',
  );
  const navSource = readFileSync(
    new URL('../src/navigation/nav-groups.ts', import.meta.url),
    'utf8',
  );
  const serviceSource = readFileSync(
    new URL('../src/services/workspaces.ts', import.meta.url),
    'utf8',
  );
  const queryKeySource = readFileSync(
    new URL('../src/services/query-keys.ts', import.meta.url),
    'utf8',
  );
  const typeSource = readFileSync(
    new URL('../src/types/index.ts', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes('listWorkspaceNewsSources'), true);
  assert.equal(pageSource.includes('updateWorkspaceNewsSources'), true);
  assert.equal(pageSource.includes('Workspace analyst sources'), true);
  assert.equal(pageSource.includes('Target analyst'), true);
  assert.equal(pageSource.includes('ANALYST_TARGET_OPTIONS'), true);
  assert.equal(pageSource.includes("target_analysts: ['news']"), true);
  assert.equal(pageSource.includes("value: 'social'"), true);
  assert.equal(pageSource.includes("sourceTargetsAnalyst(source, 'news')"), true);
  assert.equal(pageSource.includes('WorkspaceSwitcher'), true);
  assert.equal(pageSource.includes('Source set'), true);
  assert.equal(pageSource.includes('Selected workspace'), true);
  assert.equal(pageSource.includes('Source scope'), true);
  assert.equal(pageSource.includes('emptyNewsSourceDraft(defaultScopeText)'), true);
  assert.equal(pageSource.includes("source.scopeText !== 'ALL'"), true);
  assert.equal(pageSource.includes('queryClient.setQueryData('), true);
  assert.equal(
    pageSource.includes('newsSourcesQuery.isError && newsSourceDrafts.length === 0'),
    true,
  );
  assert.equal(pageSource.includes('enabledSourcesForAnalyst'), true);
  assert.equal(pageSource.includes('News Analyst will use'), true);
  assert.equal(pageSource.includes('Disabled sources stay saved but are not injected.'), true);
  assert.equal(pageSource.includes('Scope</span>'), false);
  assert.equal(pageSource.includes('Add source'), true);
  assert.equal(pageSource.includes('Save sources'), true);
  assert.equal(pageSource.includes('enabled'), true);
  assert.equal(settingsSource.includes('listWorkspaceNewsSources'), false);
  assert.equal(settingsSource.includes('News Analyst sources'), false);
  assert.equal(routesSource.includes('WorkspaceConfigurationPage'), true);
  assert.equal(routesSource.includes("path: 'research/workspace'"), true);
  assert.equal(navSource.includes('Workspace Config'), true);
  assert.equal(navSource.includes('routes.researchWorkspace'), true);
  assert.equal(serviceSource.includes('/news-sources'), true);
  assert.equal(queryKeySource.includes('workspaceNewsSources'), true);
  assert.equal(typeSource.includes('WorkspaceNewsSource'), true);
  assert.equal(typeSource.includes('WorkspaceNewsSourceTargetAnalyst'), true);
  assert.equal(typeSource.includes('target_analysts'), true);
});

test('workspace news source default scope follows the workspace symbol', () => {
  assert.equal(defaultWorkspaceNewsSourceScope('BTC/USDT'), 'BTC');
  assert.equal(defaultWorkspaceNewsSourceScope(' eth '), 'ETH');
  assert.equal(defaultWorkspaceNewsSourceScope(null), null);
});
