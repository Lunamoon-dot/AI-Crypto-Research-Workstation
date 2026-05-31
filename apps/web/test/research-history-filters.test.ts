import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterResearchRunsByHistoryFilters,
  lifecycleStatus,
} from '../src/pages/research-history-filters.ts';
import { localIsoDate } from '../src/pages/thesis-library-filters.ts';

type TestRun = {
  completed_at: string | null;
  id: string | null;
  market_type: string;
  run_id: string | null;
  started_at: string | null;
  status: string;
  symbol: string;
  thesis_id: string | null;
  timeframe: string | null;
};

test('research history filters default to the selected local start date', () => {
  const selectedDate = localIsoDate(new Date(2026, 4, 31, 1, 15));
  const runs: TestRun[] = [
    {
      completed_at: null,
      id: 'today',
      market_type: 'spot',
      run_id: 'run_today',
      started_at: new Date(2026, 4, 31, 1, 15).toISOString(),
      status: 'completed',
      symbol: 'BTC/USDT',
      thesis_id: 'thesis_today',
      timeframe: '1h',
    },
    {
      completed_at: null,
      id: 'yesterday',
      market_type: 'spot',
      run_id: 'run_yesterday',
      started_at: new Date(2026, 4, 30, 23, 50).toISOString(),
      status: 'completed',
      symbol: 'ETH/USDT',
      thesis_id: 'thesis_yesterday',
      timeframe: '1h',
    },
  ];

  const visible = filterResearchRunsByHistoryFilters(runs, {
    startedDate: selectedDate,
    search: '',
    status: '',
    symbol: '',
  });

  assert.deepEqual(visible.map((run) => run.id), ['today']);
});

test('research history date filter can be cleared to show all dates', () => {
  const runs: TestRun[] = [
    {
      completed_at: null,
      id: 'today',
      market_type: 'spot',
      run_id: 'run_today',
      started_at: new Date(2026, 4, 31, 1, 15).toISOString(),
      status: 'completed',
      symbol: 'BTC/USDT',
      thesis_id: 'thesis_today',
      timeframe: '1h',
    },
    {
      completed_at: null,
      id: 'yesterday',
      market_type: 'spot',
      run_id: 'run_yesterday',
      started_at: new Date(2026, 4, 30, 23, 50).toISOString(),
      status: 'completed',
      symbol: 'ETH/USDT',
      thesis_id: 'thesis_yesterday',
      timeframe: '1h',
    },
  ];

  const visible = filterResearchRunsByHistoryFilters(runs, {
    startedDate: '',
    search: '',
    status: '',
    symbol: '',
  });

  assert.deepEqual(
    visible.map((run) => run.id),
    ['today', 'yesterday'],
  );
});

test('research history filters combine symbol status search and date', () => {
  const selectedDate = localIsoDate(new Date(2026, 4, 31, 9, 0));
  const runs: TestRun[] = [
    {
      completed_at: null,
      id: 'btc-degraded-today',
      market_type: 'spot',
      run_id: 'run_degraded',
      started_at: new Date(2026, 4, 31, 9, 0).toISOString(),
      status: 'completed_degraded',
      symbol: 'BTC/USDT',
      thesis_id: 'thesis_target',
      timeframe: '4h',
    },
    {
      completed_at: null,
      id: 'btc-running-today',
      market_type: 'spot',
      run_id: 'run_running',
      started_at: new Date(2026, 4, 31, 10, 0).toISOString(),
      status: 'running',
      symbol: 'BTC/USDT',
      thesis_id: 'thesis_target',
      timeframe: '4h',
    },
    {
      completed_at: null,
      id: 'eth-degraded-today',
      market_type: 'spot',
      run_id: 'run_eth',
      started_at: new Date(2026, 4, 31, 11, 0).toISOString(),
      status: 'completed_degraded',
      symbol: 'ETH/USDT',
      thesis_id: 'thesis_target',
      timeframe: '4h',
    },
  ];

  const visible = filterResearchRunsByHistoryFilters(runs, {
    startedDate: selectedDate,
    search: 'degraded',
    status: 'completed',
    symbol: 'btc',
  });

  assert.deepEqual(visible.map((run) => run.id), ['btc-degraded-today']);
  assert.equal(lifecycleStatus('completed_degraded'), 'completed');
});
