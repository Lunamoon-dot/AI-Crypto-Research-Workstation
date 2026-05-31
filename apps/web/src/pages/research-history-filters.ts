export type ResearchHistoryFilters = {
  search: string;
  startedDate: string;
  status: string;
  symbol: string;
};

type FilterableResearchRun = {
  id: string | null;
  market_type: string;
  run_id: string | null;
  started_at: string | null;
  status: string;
  symbol: string;
  thesis_id: string | null;
  timeframe: string | null;
};

export function filterResearchRunsByHistoryFilters<T extends FilterableResearchRun>(
  runs: readonly T[],
  filters: ResearchHistoryFilters,
): T[] {
  const symbol = filters.symbol.trim().toLowerCase();
  const search = filters.search.trim().toLowerCase();

  return runs.filter((run) => {
    const symbolOk = symbol ? run.symbol.toLowerCase().includes(symbol) : true;
    const statusOk = filters.status
      ? lifecycleStatus(run.status) === filters.status
      : true;
    const startedDateOk = filters.startedDate
      ? localIsoDate(run.started_at) === filters.startedDate
      : true;
    const haystack = [
      run.id,
      run.run_id,
      run.symbol,
      run.status,
      run.market_type,
      run.thesis_id,
      run.timeframe,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const searchOk = search ? haystack.includes(search) : true;

    return symbolOk && statusOk && startedDateOk && searchOk;
  });
}

export function lifecycleStatus(status: string | null | undefined): string {
  return status === 'completed_degraded' ? 'completed' : status || 'unknown';
}

function localIsoDate(value: Date | string | null | undefined): string {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
