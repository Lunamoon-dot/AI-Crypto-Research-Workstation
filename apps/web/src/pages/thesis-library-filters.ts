export type ThesisLibraryFilters = {
  createdDate: string;
  direction: string;
  symbol: string;
};

type FilterableThesis = {
  created_at: string | null | undefined;
  direction: string;
  symbol: string;
};

export function filterThesesByLibraryFilters<T extends FilterableThesis>(
  theses: readonly T[],
  filters: ThesisLibraryFilters,
): T[] {
  const symbol = filters.symbol.trim().toLowerCase();

  return theses.filter((thesis) => {
    const symbolOk = symbol
      ? thesis.symbol.toLowerCase().includes(symbol)
      : true;
    const directionOk = filters.direction
      ? thesis.direction === filters.direction
      : true;
    const createdDateOk = filters.createdDate
      ? localIsoDate(thesis.created_at) === filters.createdDate
      : true;

    return symbolOk && directionOk && createdDateOk;
  });
}

export function localIsoDate(value: Date | string | null | undefined): string {
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
