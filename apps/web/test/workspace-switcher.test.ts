import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectWorkspaceActivationTarget } from '../src/components/navigation/workspace-switcher-model.ts';

const legacyWorkspace = {
  id: 'local',
  name: 'Legacy Mixed Workspace',
  scope_type: 'legacy_mixed',
  symbol: null,
  market_type: 'mixed',
  default_timeframe: null,
  archived: false,
  created_at: '1970-01-01T00:00:00.000Z',
  updated_at: '1970-01-01T00:00:00.000Z',
} as const;

const btcWorkspace = {
  id: 'workspace_btc',
  name: 'BTC Workspace',
  scope_type: 'fixed_symbol',
  symbol: 'BTC/USDT',
  market_type: 'perp',
  default_timeframe: null,
  archived: false,
  created_at: '2026-05-31T00:00:00.000Z',
  updated_at: '2026-05-31T00:00:00.000Z',
} as const;

test('fixed-only workspace selection does not reset an already active fixed workspace', () => {
  assert.equal(
    selectWorkspaceActivationTarget({
      currentWorkspace: btcWorkspace,
      fixedOnly: true,
      listedWorkspaces: [legacyWorkspace, btcWorkspace],
      workspaceId: btcWorkspace.id,
    }),
    null,
  );
});

test('fixed-only workspace selection moves legacy workspace to the first fixed workspace', () => {
  assert.deepEqual(
    selectWorkspaceActivationTarget({
      currentWorkspace: legacyWorkspace,
      fixedOnly: true,
      listedWorkspaces: [legacyWorkspace, btcWorkspace],
      workspaceId: legacyWorkspace.id,
    }),
    btcWorkspace,
  );
});

test('workspace switcher loads metadata and creates fixed-symbol workspaces', () => {
  const source = readFileSync(
    new URL('../src/components/navigation/WorkspaceSwitcher.tsx', import.meta.url),
    'utf8',
  );
  const modelSource = readFileSync(
    new URL('../src/components/navigation/workspace-switcher-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('listWorkspaces'), true);
  assert.equal(source.includes('createWorkspace'), true);
  assert.equal(source.includes('setWorkspace'), true);
  assert.equal(modelSource.includes('isAuthoritativeWorkspace'), true);
  assert.equal(source.includes('fixedOnly'), true);
  assert.equal(modelSource.includes('isFixedSymbolWorkspace'), true);
  assert.equal(source.includes('Fixed-symbol only'), true);
  assert.equal(source.includes('Legacy mixed'), true);
  assert.equal(source.includes('Create workspace'), true);
  assert.equal(source.includes('workspace-create-select'), false);
  assert.equal(source.includes('<option value="spot">'), false);
  assert.equal(source.includes('auth: '), false);
  assert.equal(source.includes('user: '), false);
});
