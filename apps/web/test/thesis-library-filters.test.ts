import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterThesesByLibraryFilters,
  localIsoDate,
} from '../src/pages/thesis-library-filters.ts';

type TestThesis = {
  created_at: string | null;
  direction: string;
  id: string;
  symbol: string;
};

test('thesis library filters default to the selected local date', () => {
  const selectedDate = localIsoDate(new Date(2026, 4, 31, 1, 15));
  const theses: TestThesis[] = [
    {
      created_at: new Date(2026, 4, 31, 1, 15).toISOString(),
      direction: 'bullish',
      id: 'today',
      symbol: 'BTC/USDT',
    },
    {
      created_at: new Date(2026, 4, 30, 23, 50).toISOString(),
      direction: 'watch',
      id: 'yesterday',
      symbol: 'ETH/USDT',
    },
  ];

  const visible = filterThesesByLibraryFilters(theses, {
    createdDate: selectedDate,
    direction: '',
    symbol: '',
  });

  assert.deepEqual(visible.map((thesis) => thesis.id), ['today']);
});

test('thesis library date filter can be cleared to show all dates', () => {
  const theses: TestThesis[] = [
    {
      created_at: new Date(2026, 4, 31, 1, 15).toISOString(),
      direction: 'bullish',
      id: 'today',
      symbol: 'BTC/USDT',
    },
    {
      created_at: new Date(2026, 4, 30, 23, 50).toISOString(),
      direction: 'watch',
      id: 'yesterday',
      symbol: 'ETH/USDT',
    },
  ];

  const visible = filterThesesByLibraryFilters(theses, {
    createdDate: '',
    direction: '',
    symbol: '',
  });

  assert.deepEqual(
    visible.map((thesis) => thesis.id),
    ['today', 'yesterday'],
  );
});

test('thesis library filters combine symbol direction and date', () => {
  const selectedDate = localIsoDate(new Date(2026, 4, 31, 9, 0));
  const theses: TestThesis[] = [
    {
      created_at: new Date(2026, 4, 31, 9, 0).toISOString(),
      direction: 'bullish',
      id: 'btc-bullish-today',
      symbol: 'BTC/USDT',
    },
    {
      created_at: new Date(2026, 4, 31, 10, 0).toISOString(),
      direction: 'watch',
      id: 'btc-watch-today',
      symbol: 'BTC/USDT',
    },
    {
      created_at: new Date(2026, 4, 31, 11, 0).toISOString(),
      direction: 'bullish',
      id: 'eth-bullish-today',
      symbol: 'ETH/USDT',
    },
  ];

  const visible = filterThesesByLibraryFilters(theses, {
    createdDate: selectedDate,
    direction: 'bullish',
    symbol: 'btc',
  });

  assert.deepEqual(visible.map((thesis) => thesis.id), ['btc-bullish-today']);
});
