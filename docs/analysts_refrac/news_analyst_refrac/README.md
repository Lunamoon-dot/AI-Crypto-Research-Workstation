# News Analyst Refrac

News Analyst Refrac turns the news lane into a source-grounded ingestion,
quality, and materiality pipeline. The goal is to separate source/data health
from whether material news was found for the asset.

## Documents

- [Source context design](2026-05-31-news-analyst-source-context-design.md)
- [V1 implementation plan](v1/implementation-plan.md)
- [News source catalog and packs plan](2026-06-03-news-source-catalog-packs-plan.md)

## Version Scope

- V1: RSS/Atom diagnostics, HTML allowlist ingestion, source health snapshots,
  `no_material_news_found`, and thesis quality propagation.
- V2: system-maintained source catalog, default source packs, background article
  cache, and BTC/ETH/BNB seed coverage. Source management UI is deferred.

## V2 Runtime Notes

- Fixed-symbol research runs resolve system catalog source packs automatically
  for BTC, ETH, and BNB and inject resolved catalog sources into engine metadata.
- News Analyst can build `NewsContext` from cached catalog articles when
  `news_context.use_article_cache` is enabled; the live RSS/Atom path remains as
  a migration fallback.
