# Deferred Workspace User Inputs Integration

Status: deferred
Last updated: 2026-05-31

## Context

The workspace user input layer was explored as a strong long-term direction:
each workspace should eventually let users configure trusted news, social,
manual, and custom research sources. That remains a valid product direction,
but it is not the next implementation priority.

The immediate focus is now LunaCrypto-provided input data: default market,
derivatives, on-chain, news, social, and provenance inputs controlled by the
product rather than user-configured source catalogs.

## Deferred Direction

When resumed, the user-configurable input layer should support:

- Workspace-scoped research input settings.
- System default source pack selection per workspace.
- Custom workspace sources for news, social, manual, and custom feeds.
- Reusable input profiles.
- Per-run resolved input snapshots for auditability.
- Later platform adapters for X/Twitter, Reddit, YouTube, Telegram, Discord,
  RSS, Substack, and other feeds.

## Why Deferred

User-configured sources are valuable, but they do not solve the current product
gap by themselves. LunaCrypto first needs stronger built-in data coverage. If
the default data layer remains thin, user configuration becomes a workaround
rather than an enhancement.

The current priority is therefore:

1. Improve LunaCrypto-provided default input data.
2. Normalize and score the evidence LunaCrypto already fetches.
3. Add missing default source packs and provider adapters.
4. Return to workspace user-configured sources after the internal data
   foundation is credible.

## Resume Criteria

Resume this direction after at least one of these is true:

- Default news and social packs exist and are flowing into analysts.
- Asset identity mapping exists for exchange symbols, project metadata, and
  official links.
- On-chain data is no longer mostly proxy-only.
- Research run snapshots can already record default data sources and freshness.

## Non-Goals While Deferred

- Do not build a full workspace source-management UI yet.
- Do not integrate platform-specific social APIs just for user-added accounts.
- Do not make research launch depend on input profiles.
- Do not store user-provided social/news credentials.

## Related Docs

- [Research Data Foundation](README.md)
- [Workspace Research Inputs Design](../../superpowers/specs/2026-05-31-workspace-research-inputs-design.md)
