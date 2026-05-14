export function normalizeCryptoSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (upper.includes('/')) {
    return upper;
  }

  for (const delimiter of ['-', '_', ':']) {
    if (upper.includes(delimiter)) {
      const [base, quote] = upper.split(delimiter, 2);
      if (base && quote) {
        return `${base}/${mapCryptoQuote(quote)}`;
      }
    }
  }

  for (const quote of ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH']) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return `${upper.slice(0, -quote.length)}/${mapCryptoQuote(quote)}`;
    }
  }

  if (upper.endsWith('DT') && upper.length > 2) {
    return `${upper.slice(0, -2)}/USDT`;
  }

  return `${upper}/USDT`;
}

export function normalizeOptionalCryptoSymbol(
  symbol: string | undefined,
): string | undefined {
  const trimmed = symbol?.trim();
  return trimmed ? normalizeCryptoSymbol(trimmed) : undefined;
}

function mapCryptoQuote(quote: string): string {
  return quote === 'USD' ? 'USDT' : quote;
}
