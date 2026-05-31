# Workspace-Scoped Research Flows

Workspace-scoped research flows make the workspace the owner of research scope. A fixed-symbol workspace has one canonical research symbol, such as `BTC/USDT`, and new research runs in that workspace always use that symbol.

## Workspace Types

`fixed_symbol` workspaces are active research flows. They require a canonical `BASE/USDT` symbol and may carry metadata such as `market_type` and `default_timeframe`.

`legacy_mixed` workspaces preserve historical mixed-symbol data. The built-in `local` workspace is legacy mixed, has no fixed symbol, and remains readable for old runs and related artifacts.

## Run Creation

For fixed-symbol workspaces, the API treats workspace metadata as authoritative. If a client omits `symbol`, the API derives it from the workspace. If a client sends a matching symbol, the API accepts it for compatibility. If a client sends a different symbol, the API rejects the request.

Legacy mixed workspaces cannot create new research runs in V1. Users must create or switch to a fixed-symbol workspace before launching research.

## API Errors

`symbol_workspace_mismatch`

Returned with `400` when a fixed-symbol workspace receives a create-run request for a different symbol. The response includes `expected_symbol` and `received_symbol`.

`legacy_workspace_read_only`

Returned with `400` when a legacy mixed workspace attempts to create a new research run.

## V1 Limits

- Workspace symbols cannot be edited after creation.
- Hard delete is not available.
- Historical legacy data is not automatically split into fixed-symbol workspaces.
- `workspace.market_type: mixed` does not enforce run `market_type`; research runs still use the existing `spot | perp` contract.
