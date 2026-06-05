import { normalizeCryptoSymbol } from '../common/market-symbols';

const SYMBOL_ALIASES: Record<string, string> = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  ether: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
  bnb: 'BNB',
  binancecoin: 'BNB',
  ripple: 'XRP',
  xrp: 'XRP',
  cardano: 'ADA',
  ada: 'ADA',
  dogecoin: 'DOGE',
  doge: 'DOGE',
  avalanche: 'AVAX',
  avax: 'AVAX',
  chainlink: 'LINK',
  link: 'LINK',
  polkadot: 'DOT',
  dot: 'DOT',
  polygon: 'POL',
  matic: 'POL',
  pol: 'POL',
  ton: 'TON',
  tron: 'TRX',
  trx: 'TRX',
  litecoin: 'LTC',
  ltc: 'LTC',
  bitcoin_cash: 'BCH',
  bch: 'BCH',
  uniswap: 'UNI',
  uni: 'UNI',
  aave: 'AAVE',
  optimism: 'OP',
  op: 'OP',
  arbitrum: 'ARB',
  arb: 'ARB',
  sui: 'SUI',
  sei: 'SEI',
  near: 'NEAR',
  injective: 'INJ',
  inj: 'INJ',
  atom: 'ATOM',
  cosmos: 'ATOM',
  aptos: 'APT',
  apt: 'APT',
  pepe: 'PEPE',
  tao: 'TAO',
  icp: 'ICP',
  render: 'RENDER',
  rndr: 'RENDER',
  ens: 'ENS',
  pendle: 'PENDLE',
  jupiter: 'JUP',
  jup: 'JUP',
  celestia: 'TIA',
  tia: 'TIA',
};

const QUOTES = ['USDT', 'USDC', 'USD', 'BUSD', 'BTC', 'ETH'];

export interface ResearchChatSymbolScope {
  symbol: string | null;
  explicitSymbol: boolean;
}

export function resolveResearchChatSymbol(
  message: string,
  requestedSymbol?: string,
): ResearchChatSymbolScope {
  const messageSymbol = extractSymbolFromMessage(message);
  const trimmedRequestedSymbol = requestedSymbol?.trim();
  return {
    symbol:
      messageSymbol || trimmedRequestedSymbol
        ? normalizeCryptoSymbol(messageSymbol ?? trimmedRequestedSymbol ?? '')
        : null,
    explicitSymbol: Boolean(messageSymbol || trimmedRequestedSymbol),
  };
}

export function extractSymbolFromMessage(message: string): string | null {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  const pairMatch = new RegExp(
    `\\b([A-Z0-9]{2,12})\\s*[\\/_:-]\\s*(${QUOTES.join('|')})\\b`,
    'i',
  ).exec(normalized);
  if (pairMatch) {
    return `${pairMatch[1]}/${pairMatch[2]}`;
  }

  const compactPairMatch = new RegExp(
    `\\b([A-Z0-9]{2,12})(${QUOTES.join('|')})\\b`,
    'i',
  ).exec(normalized);
  if (compactPairMatch) {
    return `${compactPairMatch[1]}/${compactPairMatch[2]}`;
  }

  const words = normalized
    .toLowerCase()
    .replace(/bitcoin cash/g, 'bitcoin_cash')
    .match(/[a-z0-9_]+/g);
  if (!words) {
    return null;
  }

  for (const word of words) {
    const alias = SYMBOL_ALIASES[word];
    if (alias) {
      return alias;
    }
  }

  return null;
}
