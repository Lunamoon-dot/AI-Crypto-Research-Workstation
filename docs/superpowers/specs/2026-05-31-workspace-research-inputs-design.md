# Workspace Research Inputs Design

Date: 2026-05-31

## Summary

LunaCrypto should support configurable research input sources at the workspace
level. Market and on-chain analysts can continue to rely on system-provided
provider data by default, while news and social analysts need a general default
source set plus user-configured sources that reflect the workspace owner's
research process.

The design is workspace-owned source configuration with reusable input profiles
and immutable run-level snapshots. This keeps each workspace's news and social
context independent, auditable, and safe to change without rewriting historical
research runs.

## Goals

- Let each workspace define the news, social, manual, and custom sources used by
  research runs.
- Provide system default source packs so a new workspace works without manual
  configuration.
- Let users add trusted people, publications, feeds, or manual context that
  should influence news and social analysts.
- Preserve an audit trail showing which input configuration produced each
  research run.
- Avoid coupling the product model to one social platform API.

## Non-Goals

- Do not implement platform-specific ingestion in the first pass.
- Do not make source configuration global per user.
- Do not store provider credentials in frontend state.
- Do not make news or social sources mandatory for market/on-chain-only runs.

## Ownership Model

Research inputs are scoped to workspaces. A user may belong to multiple
workspaces, and each workspace can carry different symbols, market lens, and
source preferences. Workspace-scoped configuration also matches the existing
workspace access model, where editor/admin roles can control workspace behavior.

System default packs are global and read-only. Workspace settings select which
default packs are enabled and which workspace profile is the default.

## Data Model

Add a workspace input settings record:

```text
workspace_input_settings
- workspace_id
- enabled_default_packs_json
- default_profile_id
- updated_by_user_id
- updated_at
```

Add custom workspace sources:

```text
workspace_input_sources
- id
- workspace_id
- source_type: news | social | manual | custom
- platform: rss | x | youtube | substack | telegram | discord | custom
- label
- locator
- enabled
- trust_weight
- freshness_hours
- symbols_json
- topics_json
- analyst_scope_json
- metadata_json
- created_by_user_id
- created_at
- updated_at
```

Add reusable input profiles:

```text
workspace_input_profiles
- id
- workspace_id
- name
- enabled_default_packs_json
- custom_source_ids_json
- analyst_overrides_json
- created_by_user_id
- created_at
- updated_at
```

Each research run should snapshot the resolved input configuration in
`research_run.metadata.research_inputs` for the first implementation slice:

```text
research_run.metadata.research_inputs
- run_id
- workspace_id
- profile_id
- resolved_default_packs_json
- resolved_sources_json
- manual_context_json
- created_at
```

A dedicated `research_input_snapshots` table is intentionally deferred until the
UI needs queryable source history across runs.

## Source Packs

System source packs provide a sensible default:

- General crypto news
- Macro and liquidity news
- Protocol official channels
- General crypto social discourse
- Security and exchange alerts

The source pack catalog should be code or migration seeded data, not user-owned
workspace data. Workspaces store only the selected pack ids.

## Runtime Flow

When a user launches a research run:

1. Resolve the workspace.
2. Resolve the selected input profile, or use the workspace default profile.
3. Expand enabled source packs.
4. Merge enabled custom sources from the profile.
5. Apply per-run manual context or source overrides.
6. Snapshot the resolved config.
7. Pass the resolved source bundle to news and social analysts.

Market and on-chain analysts continue to receive the existing provider-backed
market and on-chain data in this feature.

## API Surface

Initial endpoints should stay workspace-scoped:

```text
GET    /workspaces/:id/research-inputs/settings
PATCH  /workspaces/:id/research-inputs/settings
GET    /workspaces/:id/research-inputs/sources
POST   /workspaces/:id/research-inputs/sources
PATCH  /workspaces/:id/research-inputs/sources/:sourceId
DELETE /workspaces/:id/research-inputs/sources/:sourceId
GET    /workspaces/:id/research-inputs/profiles
POST   /workspaces/:id/research-inputs/profiles
PATCH  /workspaces/:id/research-inputs/profiles/:profileId
DELETE /workspaces/:id/research-inputs/profiles/:profileId
```

Research run creation can accept an optional `research_input_profile_id` and
optional manual context metadata. If omitted, it uses the workspace default.

## UI Surface

Add a Research Inputs settings area for the current workspace:

- Default source pack toggles.
- Custom source list with enabled/disabled state.
- Source editor for label, platform, locator, trust weight, freshness window,
  topics, symbols, and analyst scope.
- Profile manager for reusable bundles.

The research launch form should expose a compact profile picker and optional
manual context field. It should not expose the full source editor inline.

## Error Handling

- Reject source records without a non-empty label and locator, except manual
  sources that can store structured context.
- Clamp `trust_weight` to a documented range, such as `0.0` to `1.0`.
- Reject invalid freshness windows.
- Treat disabled or unreachable sources as degraded optional data, not as a hard
  run failure, unless the selected profile explicitly requires them.
- Preserve skipped source reasons in the run input snapshot.

## Security and Privacy

Workspace role checks must protect all read/write routes. Viewer can read
settings; editor or higher can mutate settings. Any future source requiring
credentials must store credentials server-side only and reference them by a
workspace-scoped credential id.

Source locators can reveal private research process. They should be treated as
workspace data and never included in cross-workspace summaries.

## Testing

Backend tests should cover:

- Workspace access checks for all settings/source/profile routes.
- Default settings creation or fallback for new workspaces.
- Source validation and normalization.
- Profile resolution and disabled source filtering.
- Research run snapshot creation from default profile and explicit profile.

Frontend tests should cover:

- Rendering default packs and custom sources.
- Creating and disabling a custom source.
- Selecting an input profile from the research launch form.
- Displaying validation errors from the API.

## Implementation Order

1. Add schema and API contracts for workspace input settings, sources, and
   profiles.
2. Build backend service methods with tests and default pack resolution.
3. Add workspace settings UI for source packs and custom sources.
4. Add profile selection to research run creation.
5. Snapshot resolved input config on run creation.
6. Wire resolved source bundles into news and social analyst prompts or adapter
   inputs.

## Storage Decision

The first implementation stores resolved run input snapshots in
`research_run.metadata.research_inputs`. This keeps the first slice small and
preserves auditability. A dedicated snapshot table should be introduced only
when reporting needs to query source usage independently from research runs.
