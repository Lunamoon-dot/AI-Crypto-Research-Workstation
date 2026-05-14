import { z } from 'zod';

const analystSchema = z.enum(['market', 'news', 'social', 'onchain']);

export const researchRunRequestSchema = z.object({
  workspace_id: z.string().trim().min(1, 'Workspace is required.'),
  symbol: z.string().trim().min(1, 'Symbol is required.').transform(normalizeCryptoSymbol),
  asset_class: z.string().trim().min(1).default('crypto'),
  market_type: z.enum(['spot', 'perp']).default('spot'),
  analysis_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  analysts: z
    .array(z.string().trim().min(1))
    .transform(normalizeSelectedAnalysts)
    .pipe(z.array(analystSchema).min(1, 'Select at least one analyst.')),
  config_profile: z.string().trim().min(1).default('default'),
  exchange: z.string().trim().min(1).optional(),
  dry_run: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ResearchRunRequestInput = z.input<typeof researchRunRequestSchema>;

function normalizeCryptoSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
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

function mapCryptoQuote(quote: string): string {
  return quote === 'USD' ? 'USDT' : quote;
}

function normalizeSelectedAnalysts(
  values: string[],
): Array<z.infer<typeof analystSchema>> {
  const allowed = new Set(analystSchema.options);
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is z.infer<typeof analystSchema> =>
      allowed.has(value as z.infer<typeof analystSchema>),
    );
  return [...new Set(normalized)];
}
