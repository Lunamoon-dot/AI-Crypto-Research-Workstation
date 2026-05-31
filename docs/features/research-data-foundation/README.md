# Research Data Foundation

Status: draft
Last updated: 2026-05-31

## Purpose

LunaCrypto has completed the core research workflow. The next product risk is
data quality and data coverage. The system can already produce structured
theses, debates, continuity entries, calibration views, and audit trails, but a
research OS is only as trustworthy as the data it can ingest, qualify, and
attribute.

This document tracks the current research data gaps and the order in which they
should be resolved. It is intentionally direct: many current sources are useful
for a local MVP, but too thin for a serious data-centered product.

## Product Principle

The immediate data priority is LunaCrypto-provided default inputs. Core features
are already in place; the next product risk is that the default research data is
too thin in several categories.

Workspace-specific user inputs remain a strong long-term advantage, but they are
deferred. LunaCrypto first needs credible built-in market, derivatives,
on-chain, news, social, and provenance inputs. User configuration should enhance
that foundation later, not compensate for missing default data.

## Current Coverage

| Area | Current state | Assessment |
| --- | --- | --- |
| Market | CCXT/Binance OHLCV, indicators, market-data guard, API charting with Binance and partial Bitget support. | Good enough for the core loop, but not enough for market microstructure. |
| Derivatives | Funding, open interest, liquidation, and long/short paths through CCXT. | Useful, but exchange support varies and multi-exchange normalization is weak. |
| On-chain | Mostly CoinGecko/CCXT proxies: market cap, volume, supply, turnover, liquidity proxy. | The label overstates the data. This is not wallet-level on-chain evidence. |
| News | Optional CryptoPanic via `CRYPTOPANIC_API_TOKEN`; otherwise explicit missing-data fallback. | Too thin. News evidence is not robust without configurable feeds and source packs. |
| Social | Fear & Greed, CoinGecko trending, and keyword headline sentiment. | Very thin. It lacks accounts, communities, narrative clustering, and platform-specific context. |
| Provenance | Freshness, provider logging, run events, snapshots, and degradation language exist. | Good foundation, but no workspace-level source catalog or resolved source snapshot per run. |

## Gap Ledger

| Priority | Area | Gap | Why it matters | Initial resolution direction |
| --- | --- | --- | --- | --- |
| P0 | News | News is mostly one optional CryptoPanic feed. No RSS packs, official project feeds, macro/regulatory/security feeds, or exchange announcements. | News analyst can miss the actual catalyst or invent confidence from incomplete context. | Add LunaCrypto-provided default source packs and RSS/custom feed ingestion before chasing paid APIs. |
| P0 | Social | Social analyst has no real LunaCrypto-provided social source layer: no default account lists, Reddit sources, YouTube channels, narrative clustering, or platform-specific context. | Social output cannot represent asset-specific crowd pressure or market narratives. | Add default social packs and normalized social/narrative evidence before user-configurable social sources. |
| P0 | Provenance for default data | Default provider calls are logged, but there is no consistent resolved input snapshot showing which built-in data sources were used by each run. | Better data is not enough if the user cannot audit freshness, source, and missing inputs. | Add run-level default data source snapshots before workspace user-source snapshots. |
| P1 | On-chain | Current "on-chain" data is mostly market proxy data, not wallet or protocol activity. | The system risks overstating evidence quality and producing false on-chain claims. | Rename/report limitations clearly, then add real on-chain/provider adapters by category. |
| P1 | Derivatives | Funding/OI/liquidation data is exchange-dependent and not normalized across venues. | A single exchange can misrepresent broader perp positioning and liquidation pressure. | Define normalized derivative snapshots and multi-exchange aggregation rules. |
| P1 | Market | No order book depth, trades/tape, spread, or cross-exchange market quality layer. | Breakout/liquidity theses need microstructure context, especially for smaller assets. | Add spot/perp order book and recent trades snapshots with freshness and venue metadata. |
| P1 | Entity mapping | Symbol-to-project mappings are hand-coded in places, especially CoinGecko id resolution. | Data routing breaks for long-tail assets and new projects. | Add asset identity registry: symbol, chain, contract, CoinGecko id, exchange pairs, official links. |
| P2 | Data quality scoring | Freshness and missing data exist, but source-specific quality scoring is not consistent across all input categories. | Agent confidence needs to degrade predictably when sources are stale, thin, or low-trust. | Create a common data evidence score: freshness, coverage, source trust, sample size, and conflicts. |

## Resolution Order

1. **LunaCrypto-provided news and social source packs**
   - Add general crypto news, macro/regulatory, official project, security, and
     exchange announcement packs.
   - Add source normalization and deduplication before feeding analysts.

2. **Default data provenance snapshot**
   - Record which built-in sources, providers, timestamps, and freshness states
     were used for each research run.
   - Make missing default data visible as degradation evidence, not hidden
     analyst context.

3. **Asset identity registry**
   - Resolve exchange symbols, CoinGecko ids, project official links, chain ids,
     and contract addresses.
   - This becomes the join key for market, on-chain, news, and social evidence.

4. **True on-chain data**
   - Add provider adapters for active addresses, exchange flows, whale movement,
     TVL, fees/revenue, stablecoin flows, holder distribution, and unlock data.
   - Keep proxy metrics clearly labeled until these adapters exist.

5. **Derivative and market microstructure normalization**
   - Build multi-exchange derivative snapshots and order-book/trade snapshots.
   - Preserve venue, timestamp, pair format, market type, and freshness.

6. **Evidence scoring**
   - Score each analyst input bundle by freshness, coverage, source trust,
     sample size, and conflict level.
   - Feed the score into thesis confidence and degradation reasons.

## First Issue To Resolve

The first issue is LunaCrypto-provided default data for news and social. These
are currently the thinnest analyst inputs and can create the largest gap between
the product's thesis quality and the actual evidence available to the system.

The first implementation slice should not try to integrate every platform. It
should define a default source pack catalog, implement RSS/custom feed ingestion
for product-owned default sources, normalize articles/posts into a common input
bundle, dedupe by URL/title/time, and pass the bundle to news/social analysts
with source and freshness metadata.

## Decision Log

- 2026-05-31: Research inputs should be scoped to workspace, not globally to
  user accounts.
- 2026-05-31: Default data is necessary for onboarding, but LunaCrypto's
  durable advantage should be user-configured research inputs.
- 2026-05-31: Store the first run-level resolved input snapshot in
  `research_run.metadata.research_inputs`; promote to a dedicated table only
  when query/reporting requirements need it.
- 2026-05-31: Workspace user-configurable inputs are deferred. The next priority
  is LunaCrypto-provided default data coverage.

## Related Docs

- [Workspace Research Inputs Design](../../superpowers/specs/2026-05-31-workspace-research-inputs-design.md)
- [Deferred Workspace User Inputs Integration](deferred-workspace-user-inputs.md)
- [Project Roadmap](../../project-roadmap.md)
- [Known Issues](../../known-issues.md)
