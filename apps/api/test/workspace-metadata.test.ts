import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeWorkspaceSymbol,
  validateWorkspaceMetadata,
  type WorkspaceMetadata,
} from '../src/workspaces/workspace-metadata';

test('normalizeWorkspaceSymbol converts common USDT crypto inputs', () => {
  assert.equal(normalizeWorkspaceSymbol('btc'), 'BTC/USDT');
  assert.equal(normalizeWorkspaceSymbol('BTCUSDT'), 'BTC/USDT');
  assert.equal(normalizeWorkspaceSymbol('BTC/USDT'), 'BTC/USDT');
});

test('normalizeWorkspaceSymbol rejects invalid workspace symbols', () => {
  assert.throws(() => normalizeWorkspaceSymbol(''));
  assert.throws(() => normalizeWorkspaceSymbol('ETH/BTC'));
  assert.throws(() => normalizeWorkspaceSymbol('BTC/USDC'));
});

test('validateWorkspaceMetadata requires fixed-symbol workspaces to have a symbol', () => {
  assert.throws(() =>
    validateWorkspaceMetadata({
      ...workspaceFixture(),
      scope_type: 'fixed_symbol',
      symbol: null,
    }),
  );
});

test('validateWorkspaceMetadata rejects symbols on legacy mixed workspaces', () => {
  assert.throws(() =>
    validateWorkspaceMetadata({
      ...workspaceFixture(),
      scope_type: 'legacy_mixed',
      symbol: 'BTC/USDT',
    }),
  );
});

test('validateWorkspaceMetadata normalizes fixed workspace symbols', () => {
  const workspace = validateWorkspaceMetadata({
    ...workspaceFixture(),
    symbol: 'eth',
  });

  assert.equal(workspace.symbol, 'ETH/USDT');
});

function workspaceFixture(): WorkspaceMetadata {
  return {
    id: 'workspace_btc',
    name: 'BTC Main',
    scope_type: 'fixed_symbol',
    symbol: 'BTC/USDT',
    market_type: 'mixed',
    default_timeframe: null,
    archived: false,
    created_at: '2026-05-31T00:00:00.000Z',
    updated_at: '2026-05-31T00:00:00.000Z',
  };
}
