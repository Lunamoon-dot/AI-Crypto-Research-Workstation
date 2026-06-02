# Onchain Analyst Input Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current proxy-heavy Onchain Analyst into a strict evidence analyst that receives a precomputed on-chain context bundle before writing its report.

**Architecture:** Add a built-in asset identity registry, typed on-chain context models, free/default provider adapters, deterministic coverage scoring, and a graph precompute boundary. The Onchain Analyst consumes the normalized bundle as primary evidence; existing tools remain fallback/proxy only.

**Tech Stack:** Python, Pydantic, PyYAML, existing provider routing, LangGraph state, pytest, SQLite run events/journal metadata.

---

## Scope

This plan targets the research runtime path for the Onchain Analyst. It does not rename `fundamentals_report`, add workspace user source configuration, build a chain indexer, require paid data vendors, or add a dedicated `onchain_snapshots` table.

V1 uses:

- Built-in asset identity registry.
- DeFiLlama for free/default protocol, chain, stablecoin, fee, revenue, and TVL style data where available.
- CoinGecko for supply/FDV proxy data.
- Etherscan-compatible adapter only when an API key and EVM contract identity exist.
- Premium-provider-ready data contracts, with Glassnode/CryptoQuant/Nansen-like adapters added near production readiness.

V1 does not fake exchange flows, whale movement, entity labels, or wallet-level behavior from market proxy metrics.

## Decisions Locked By Grill

- Onchain is a core analyst and must be strict.
- Current CoinGecko/CCXT metrics are proxy metrics, not real wallet-level evidence.
- Asset identity is the gate. If identity cannot be resolved, real on-chain fetches do not run.
- Coverage is tiered by asset type: native L1, ERC-20/token, protocol token, stablecoin, long-tail/meme.
- `OnchainContext` is precomputed before analyst execution and injected into the analyst prompt.
- Data quality is deterministic from metric coverage, not LLM self-scored.
- Missing on-chain data must propagate to `AgentOpinion` and thesis confidence caps.
- `fundamentals_report` remains the graph key in this slice for compatibility.
- Paid providers are out of V1 implementation and are connected after production-readiness planning.

## Compatibility Decision

The graph state key remains `fundamentals_report` in this slice because it is wired through CLI streaming, reporting, graph protocols, propagation, opinions, and report writer. This implementation changes Onchain Analyst data semantics and injects `onchain_context`, but does not rename report keys.

Deferred rename work:

- `fundamentals_report` -> `onchain_report`
- update CLI/reporting/graph/tests
- keep backward compatibility for old run artifacts

## File Structure

Create:

- `apps/ai-service/luna_workstation/domain/asset_identity.py`
  - Asset identity Pydantic models.
- `apps/ai-service/luna_workstation/data/asset_registry.yaml`
  - LunaCrypto-provided curated V1 asset identity registry.
- `apps/ai-service/luna_workstation/dataflows/asset_registry.py`
  - Registry loader and resolver.
- `apps/ai-service/luna_workstation/domain/onchain_context.py`
  - Onchain context models, scoring, reason codes, and prompt rendering.
- `apps/ai-service/luna_workstation/dataflows/onchain_context_provider.py`
  - Provider orchestration and normalized context builder.
- `apps/ai-service/luna_workstation/dataflows/defillama_provider.py`
  - DeFiLlama free/default adapter.
- `apps/ai-service/luna_workstation/dataflows/etherscan_provider.py`
  - Etherscan-compatible optional adapter.
- `apps/ai-service/luna_workstation/graph/onchain_context.py`
  - Research-run precompute boundary.
- `apps/ai-service/tests/test_asset_registry.py`
- `apps/ai-service/tests/test_onchain_context_models.py`
- `apps/ai-service/tests/test_onchain_context_provider.py`
- `apps/ai-service/tests/test_onchain_context_injection.py`

Modify:

- `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
  - Add `onchain_context` injection support.
- `apps/ai-service/luna_workstation/agents/analysts/onchain_analyst.py`
  - Consume precomputed bundle and treat current tools as fallback/proxy.
- `apps/ai-service/luna_workstation/agents/utils/agent_states.py`
  - Add `onchain_context` state key.
- `apps/ai-service/luna_workstation/graph/protocols.py`
  - Add `onchain_context` to research graph state typing.
- `apps/ai-service/luna_workstation/graph/run_context.py`
  - Store `onchain_context_result`.
- `apps/ai-service/luna_workstation/graph/research_agents_graph.py`
  - Add `_precompute_onchain_context`.
- `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
  - Compute and inject onchain context before graph invocation.
- `apps/ai-service/luna_workstation/graph/opinions.py`
  - Map onchain context markers to structured opinion quality/reason codes.
- `apps/ai-service/luna_workstation/default_config.py`
  - Add default `onchain_context` policy.
- `apps/ai-service/config/default.toml`
  - Add matching `onchain_context` policy.
- `apps/ai-service/luna_workstation/config/providers.py`
  - Add data-provider env metadata for optional Etherscan-style providers.
- `docs/features/research-data-foundation/README.md`
  - Update On-chain gap row after implementation.

## Data Contract

The rendered prompt block must use this shape:

```text
===== PRE-COMPUTED ONCHAIN CONTEXT =====
Instrument: AAVE/USDT
Base asset: AAVE
Asset type: protocol_token
Tier: 2
Observed at: 2026-05-31T00:00:00Z
Timestamp semantics: latest
Quality: degraded (0.67)

Asset identity:
- CoinGecko id: aave
- DeFiLlama protocol slug: aave
- Chain ethereum contract 0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9

Coverage:
- asset_identity: clean
- protocol_fundamentals: clean
- supply_unlock_risk: proxy
- holder_distribution: missing
- network_activity: missing
- exchange_flows: missing
- whale_activity: missing
- stablecoin_liquidity: unsupported

Real on-chain evidence:
- protocol_fundamentals.tvl_usd: 1000000000 source defillama observed_at 2026-05-31T00:00:00Z
- protocol_fundamentals.fees_24h_usd: 100000 source defillama observed_at 2026-05-31T00:00:00Z

Proxy context:
- supply.fdv_to_market_cap: 1.2 source coingecko

Missing/degraded data:
- missing_holder_distribution
- missing_exchange_flows
- missing_whale_activity

Rules for analyst:
- Treat proxy metrics as proxy only.
- Do not infer exchange flows, whale movement, accumulation, distribution, or institutional activity from proxy metrics.
- Do not treat latest data as point-in-time evidence for historical replay dates.
===== END ONCHAIN CONTEXT =====
```

## Task 1: Asset Identity Registry

**Files:**
- Create: `apps/ai-service/luna_workstation/domain/asset_identity.py`
- Create: `apps/ai-service/luna_workstation/dataflows/asset_registry.py`
- Create: `apps/ai-service/luna_workstation/data/asset_registry.yaml`
- Test: `apps/ai-service/tests/test_asset_registry.py`

- [ ] **Step 1: Write failing registry tests**

Create `apps/ai-service/tests/test_asset_registry.py`:

```python
from pathlib import Path

from luna_workstation.dataflows.asset_registry import AssetRegistry


def test_registry_resolves_symbol_pair_and_alias(tmp_path):
    registry_path = tmp_path / "assets.yaml"
    registry_path.write_text(
        """
assets:
  - symbol: AAVE
    aliases: ["AAVE/USDT"]
    canonical_pair: AAVE/USDT
    asset_type: protocol_token
    tier: 2
    coingecko_id: aave
    defillama_protocol_slug: aave
    chains:
      - chain: ethereum
        chain_id: 1
        contract: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"
""",
        encoding="utf-8",
    )

    registry = AssetRegistry.from_yaml(registry_path)

    identity = registry.resolve("aave/usdt")

    assert identity is not None
    assert identity.symbol == "AAVE"
    assert identity.asset_type == "protocol_token"
    assert identity.defillama_protocol_slug == "aave"
    assert identity.primary_contract == "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"


def test_registry_returns_none_for_unknown_asset(tmp_path):
    registry_path = tmp_path / "assets.yaml"
    registry_path.write_text("assets: []\n", encoding="utf-8")

    registry = AssetRegistry.from_yaml(registry_path)

    assert registry.resolve("UNKNOWN/USDT") is None
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_asset_registry.py -q
```

Expected: fails with `ModuleNotFoundError` for `luna_workstation.dataflows.asset_registry`.

- [ ] **Step 3: Implement asset identity models**

Create `apps/ai-service/luna_workstation/domain/asset_identity.py`:

```python
from __future__ import annotations

from pydantic import BaseModel, Field


class ChainIdentity(BaseModel):
    chain: str
    chain_id: int | None = None
    contract: str | None = None
    native: bool = False


class AssetIdentity(BaseModel):
    symbol: str
    aliases: list[str] = Field(default_factory=list)
    canonical_pair: str | None = None
    asset_type: str
    tier: int
    coingecko_id: str | None = None
    defillama_protocol_slug: str | None = None
    chains: list[ChainIdentity] = Field(default_factory=list)

    @property
    def base_symbol(self) -> str:
        return self.symbol.upper()

    @property
    def primary_contract(self) -> str | None:
        for chain in self.chains:
            if chain.contract:
                return chain.contract
        return None

    @property
    def has_contract_identity(self) -> bool:
        return self.primary_contract is not None
```

- [ ] **Step 4: Implement registry loader**

Create `apps/ai-service/luna_workstation/dataflows/asset_registry.py`:

```python
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from luna_workstation.domain.asset_identity import AssetIdentity


DEFAULT_REGISTRY_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "asset_registry.yaml"
)


class AssetRegistry:
    def __init__(self, assets: list[AssetIdentity]):
        self._assets = assets
        self._index: dict[str, AssetIdentity] = {}
        for asset in assets:
            keys = {asset.symbol, asset.base_symbol}
            if asset.canonical_pair:
                keys.add(asset.canonical_pair)
            keys.update(asset.aliases)
            for key in keys:
                normalized = normalize_asset_key(key)
                if normalized:
                    self._index[normalized] = asset

    @property
    def assets(self) -> list[AssetIdentity]:
        return list(self._assets)

    @classmethod
    def from_yaml(cls, path: str | Path) -> "AssetRegistry":
        payload = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        raw_assets = payload.get("assets") or []
        assets = [AssetIdentity.model_validate(item) for item in raw_assets]
        return cls(assets)

    def resolve(self, symbol_or_pair: str) -> AssetIdentity | None:
        return self._index.get(normalize_asset_key(symbol_or_pair))


def normalize_asset_key(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    if "/" in text:
        return text
    return text.split("-")[0].strip()


@lru_cache(maxsize=1)
def get_default_asset_registry() -> AssetRegistry:
    return AssetRegistry.from_yaml(DEFAULT_REGISTRY_PATH)
```

- [ ] **Step 5: Add first production registry seed**

Create `apps/ai-service/luna_workstation/data/asset_registry.yaml`:

```yaml
version: asset_registry:v1:2026-05-31
assets:
  - symbol: BTC
    aliases: ["BTC/USDT", "XBT"]
    canonical_pair: BTC/USDT
    asset_type: native_l1
    tier: 1
    coingecko_id: bitcoin
    chains:
      - chain: bitcoin
        native: true
  - symbol: ETH
    aliases: ["ETH/USDT"]
    canonical_pair: ETH/USDT
    asset_type: native_l1
    tier: 1
    coingecko_id: ethereum
    defillama_protocol_slug: ethereum
    chains:
      - chain: ethereum
        chain_id: 1
        native: true
  - symbol: SOL
    aliases: ["SOL/USDT"]
    canonical_pair: SOL/USDT
    asset_type: native_l1
    tier: 1
    coingecko_id: solana
    defillama_protocol_slug: solana
    chains:
      - chain: solana
        native: true
  - symbol: AAVE
    aliases: ["AAVE/USDT"]
    canonical_pair: AAVE/USDT
    asset_type: protocol_token
    tier: 2
    coingecko_id: aave
    defillama_protocol_slug: aave
    chains:
      - chain: ethereum
        chain_id: 1
        contract: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"
  - symbol: UNI
    aliases: ["UNI/USDT"]
    canonical_pair: UNI/USDT
    asset_type: protocol_token
    tier: 2
    coingecko_id: uniswap
    defillama_protocol_slug: uniswap
    chains:
      - chain: ethereum
        chain_id: 1
        contract: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
  - symbol: LINK
    aliases: ["LINK/USDT"]
    canonical_pair: LINK/USDT
    asset_type: token
    tier: 2
    coingecko_id: chainlink
    chains:
      - chain: ethereum
        chain_id: 1
        contract: "0x514910771AF9Ca656af840dff83E8264EcF986CA"
  - symbol: USDC
    aliases: ["USDC/USDT"]
    canonical_pair: USDC/USDT
    asset_type: stablecoin
    tier: 1
    coingecko_id: usd-coin
    chains:
      - chain: ethereum
        chain_id: 1
        contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  - symbol: USDT
    aliases: ["USDT/USDT"]
    canonical_pair: USDT/USDT
    asset_type: stablecoin
    tier: 1
    coingecko_id: tether
    chains:
      - chain: ethereum
        chain_id: 1
        contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
```

- [ ] **Step 6: Run tests and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_asset_registry.py -q
```

Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/luna_workstation/domain/asset_identity.py apps/ai-service/luna_workstation/dataflows/asset_registry.py apps/ai-service/luna_workstation/data/asset_registry.yaml apps/ai-service/tests/test_asset_registry.py
git commit -m "Add onchain asset identity registry"
```

## Task 1B: Curated V1 Registry Coverage

**Files:**
- Modify: `apps/ai-service/luna_workstation/data/asset_registry.yaml`
- Modify: `apps/ai-service/tests/test_asset_registry.py`

- [ ] **Step 1: Add failing coverage test for the V1 universe**

Append to `apps/ai-service/tests/test_asset_registry.py`:

```python
from luna_workstation.dataflows.asset_registry import get_default_asset_registry


def test_default_registry_has_curated_v1_asset_coverage():
    registry = get_default_asset_registry()
    required_symbols = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "ADA",
        "AVAX",
        "DOT",
        "NEAR",
        "SUI",
        "APT",
        "TON",
        "TRX",
        "ARB",
        "OP",
        "MATIC",
        "UNI",
        "AAVE",
        "MKR",
        "LDO",
        "CRV",
        "COMP",
        "SNX",
        "GMX",
        "PENDLE",
        "ENA",
        "LINK",
        "FIL",
        "HBAR",
        "RNDR",
        "USDT",
        "USDC",
        "DAI",
        "DOGE",
        "SHIB",
        "PEPE",
        "WIF",
        "BONK",
    ]

    assert len(registry.assets) >= 30
    for symbol in required_symbols:
        assert registry.resolve(symbol) is not None, symbol
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_asset_registry.py::test_default_registry_has_curated_v1_asset_coverage -q
```

Expected: fails because the seed registry does not yet contain every required symbol.

- [ ] **Step 3: Expand the production registry**

Modify `apps/ai-service/luna_workstation/data/asset_registry.yaml` so the default registry includes at least the symbols in `required_symbols`.

Rules for each entry:

- `symbol`, `canonical_pair`, `asset_type`, `tier`, and `coingecko_id` must be present when a CoinGecko id is known.
- Native assets use `chains: [{ chain: "<chain>", native: true }]`.
- EVM token assets include `chain`, `chain_id`, and `contract` when the contract is known with high confidence.
- Protocol tokens include `defillama_protocol_slug` when DeFiLlama has a protocol page for the project.
- If a symbol has ambiguous migration naming, keep the exchange-supported symbol in `symbol` and add the newer name as an alias.

The registry must support these categories:

```yaml
native_major:
  - BTC
  - ETH
  - SOL
  - BNB
  - XRP
  - ADA
  - AVAX
  - DOT
  - NEAR
  - SUI
  - APT
  - TON
  - TRX
l2_ecosystem:
  - ARB
  - OP
  - MATIC
defi_protocol:
  - UNI
  - AAVE
  - MKR
  - LDO
  - CRV
  - COMP
  - SNX
  - GMX
  - PENDLE
  - ENA
oracle_infra:
  - LINK
  - FIL
  - HBAR
  - RNDR
stablecoins:
  - USDT
  - USDC
  - DAI
high_liquidity_memes:
  - DOGE
  - SHIB
  - PEPE
  - WIF
  - BONK
```

- [ ] **Step 4: Run coverage test and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_asset_registry.py::test_default_registry_has_curated_v1_asset_coverage -q
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/data/asset_registry.yaml apps/ai-service/tests/test_asset_registry.py
git commit -m "Expand onchain asset registry coverage"
```

## Task 2: Onchain Context Domain Contract

**Files:**
- Create: `apps/ai-service/luna_workstation/domain/onchain_context.py`
- Test: `apps/ai-service/tests/test_onchain_context_models.py`

- [ ] **Step 1: Write failing context model tests**

Create `apps/ai-service/tests/test_onchain_context_models.py`:

```python
from luna_workstation.domain.onchain_context import (
    MetricGroup,
    OnchainContext,
    OnchainMetric,
    OnchainQuality,
)


def test_onchain_context_scores_proxy_and_missing_groups():
    quality = OnchainQuality.from_groups(
        {
            "asset_identity": "clean",
            "protocol_fundamentals": "clean",
            "supply_unlock_risk": "proxy",
            "holder_distribution": "missing",
            "exchange_flows": "missing",
        },
        asset_type="protocol_token",
    )

    assert quality.label == "degraded"
    assert quality.score == 0.67
    assert "missing_holder_distribution" in quality.reason_codes
    assert "missing_exchange_flows" in quality.reason_codes
    assert "proxy_supply_unlock_risk" in quality.reason_codes


def test_onchain_context_renders_strict_prompt_block():
    context = OnchainContext(
        symbol="AAVE/USDT",
        base_asset="AAVE",
        asset_type="protocol_token",
        tier=2,
        observed_at="2026-05-31T00:00:00Z",
        timestamp_semantics="latest",
        identity_lines=[
            "CoinGecko id: aave",
            "DeFiLlama protocol slug: aave",
        ],
        groups=[
            MetricGroup(
                name="protocol_fundamentals",
                status="clean",
                metrics=[
                    OnchainMetric(
                        name="tvl_usd",
                        value=1000000000.0,
                        source="defillama",
                        observed_at="2026-05-31T00:00:00Z",
                        evidence_type="real_onchain",
                    )
                ],
            )
        ],
        quality=OnchainQuality(
            score=0.67,
            label="degraded",
            reason_codes=["missing_exchange_flows"],
        ),
    )

    rendered = context.to_prompt_block()

    assert "PRE-COMPUTED ONCHAIN CONTEXT" in rendered
    assert "Quality: degraded (0.67)" in rendered
    assert "Real on-chain evidence:" in rendered
    assert "protocol_fundamentals.tvl_usd" in rendered
    assert "Do not infer exchange flows" in rendered
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_models.py -q
```

Expected: fails with `ModuleNotFoundError` for `luna_workstation.domain.onchain_context`.

- [ ] **Step 3: Implement domain contract**

Create `apps/ai-service/luna_workstation/domain/onchain_context.py`:

```python
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

_STATUS_SCORE = {
    "clean": 1.0,
    "proxy": 0.35,
    "stale": 0.25,
    "missing": 0.0,
    "error": 0.0,
    "unsupported": 0.0,
}

_GROUP_WEIGHTS = {
    "native_l1": {
        "network_activity": 0.30,
        "fees_revenue": 0.20,
        "exchange_flows": 0.25,
        "stablecoin_liquidity": 0.15,
        "supply_unlock_risk": 0.10,
    },
    "protocol_token": {
        "protocol_fundamentals": 0.35,
        "supply_unlock_risk": 0.20,
        "holder_distribution": 0.15,
        "exchange_flows": 0.20,
        "whale_activity": 0.10,
    },
    "token": {
        "holder_distribution": 0.30,
        "supply_unlock_risk": 0.25,
        "exchange_flows": 0.25,
        "whale_activity": 0.20,
    },
    "stablecoin": {
        "stablecoin_liquidity": 0.35,
        "supply_unlock_risk": 0.25,
        "exchange_flows": 0.25,
        "holder_distribution": 0.15,
    },
}


class OnchainMetric(BaseModel):
    name: str
    value: Any = None
    source: str
    observed_at: str | None = None
    timestamp_semantics: str = "latest"
    evidence_type: str = "real_onchain"


class MetricGroup(BaseModel):
    name: str
    status: str
    metrics: list[OnchainMetric] = Field(default_factory=list)
    error: str | None = None


class OnchainQuality(BaseModel):
    score: float
    label: str
    reason_codes: list[str] = Field(default_factory=list)

    @classmethod
    def from_groups(cls, groups: dict[str, str], *, asset_type: str) -> "OnchainQuality":
        weights = _GROUP_WEIGHTS.get(asset_type, _GROUP_WEIGHTS["token"])
        weighted_total = 0.0
        weight_seen = 0.0
        reason_codes: list[str] = []

        for group_name, weight in weights.items():
            status = groups.get(group_name, "missing")
            weighted_total += weight * _STATUS_SCORE.get(status, 0.0)
            weight_seen += weight
            if status in {"missing", "error", "stale", "proxy"}:
                reason_codes.append(f"{status}_{group_name}")

        if groups.get("asset_identity") == "missing":
            return cls(
                score=0.0,
                label="insufficient_data",
                reason_codes=["missing_asset_identity"],
            )

        score = round(weighted_total / weight_seen, 2) if weight_seen else 0.0
        if score < 0.35:
            label = "insufficient_data"
        elif score < 0.75:
            label = "degraded"
        else:
            label = "clean"
        return cls(score=score, label=label, reason_codes=_dedupe(reason_codes))


class OnchainContext(BaseModel):
    symbol: str
    base_asset: str
    asset_type: str
    tier: int | None = None
    observed_at: str
    timestamp_semantics: str = "latest"
    identity_lines: list[str] = Field(default_factory=list)
    groups: list[MetricGroup] = Field(default_factory=list)
    quality: OnchainQuality

    def to_prompt_block(self) -> str:
        lines = [
            "===== PRE-COMPUTED ONCHAIN CONTEXT =====",
            f"Instrument: {self.symbol}",
            f"Base asset: {self.base_asset}",
            f"Asset type: {self.asset_type}",
            f"Tier: {self.tier if self.tier is not None else 'unknown'}",
            f"Observed at: {self.observed_at}",
            f"Timestamp semantics: {self.timestamp_semantics}",
            f"Quality: {self.quality.label} ({self.quality.score:.2f})",
            "",
            "Asset identity:",
        ]
        lines.extend([f"- {line}" for line in self.identity_lines] or ["- missing"])

        lines.extend(["", "Coverage:"])
        for group in self.groups:
            lines.append(f"- {group.name}: {group.status}")

        real_metrics = [
            (group.name, metric)
            for group in self.groups
            for metric in group.metrics
            if metric.evidence_type == "real_onchain"
        ]
        proxy_metrics = [
            (group.name, metric)
            for group in self.groups
            for metric in group.metrics
            if metric.evidence_type == "proxy"
        ]

        lines.extend(["", "Real on-chain evidence:"])
        if real_metrics:
            for group_name, metric in real_metrics:
                lines.append(
                    f"- {group_name}.{metric.name}: {metric.value} "
                    f"source {metric.source} observed_at {metric.observed_at}"
                )
        else:
            lines.append("- none")

        lines.extend(["", "Proxy context:"])
        if proxy_metrics:
            for group_name, metric in proxy_metrics:
                lines.append(f"- {group_name}.{metric.name}: {metric.value} source {metric.source}")
        else:
            lines.append("- none")

        lines.extend(["", "Missing/degraded data:"])
        lines.extend([f"- {code}" for code in self.quality.reason_codes] or ["- none"])

        lines.extend(
            [
                "",
                "Rules for analyst:",
                "- Treat proxy metrics as proxy only.",
                "- Do not infer exchange flows, whale movement, accumulation, distribution, or institutional activity from proxy metrics.",
                "- Do not treat latest data as point-in-time evidence for historical replay dates.",
                "===== END ONCHAIN CONTEXT =====",
            ]
        )
        return "\n".join(lines)


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item for item in items if item))
```

- [ ] **Step 4: Run tests and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_models.py -q
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/domain/onchain_context.py apps/ai-service/tests/test_onchain_context_models.py
git commit -m "Add onchain context domain contract"
```

## Task 3: Free Provider Adapters And Context Builder

**Files:**
- Create: `apps/ai-service/luna_workstation/dataflows/defillama_provider.py`
- Create: `apps/ai-service/luna_workstation/dataflows/etherscan_provider.py`
- Create: `apps/ai-service/luna_workstation/dataflows/onchain_context_provider.py`
- Modify: `apps/ai-service/luna_workstation/config/providers.py`
- Test: `apps/ai-service/tests/test_onchain_context_provider.py`

- [ ] **Step 1: Write failing provider builder tests**

Create `apps/ai-service/tests/test_onchain_context_provider.py`:

```python
from luna_workstation.dataflows.onchain_context_provider import build_onchain_context
from luna_workstation.domain.asset_identity import AssetIdentity, ChainIdentity


def test_build_onchain_context_gates_unknown_identity():
    context = build_onchain_context(
        symbol="UNKNOWN/USDT",
        identity=None,
        config={"strict_identity": True},
        observed_at="2026-05-31T00:00:00Z",
        provider_fetchers={},
    )

    assert context.quality.label == "insufficient_data"
    assert context.quality.reason_codes == ["missing_asset_identity"]
    assert "missing_asset_identity" in context.to_prompt_block()


def test_build_onchain_context_marks_missing_paid_flow_groups():
    identity = AssetIdentity(
        symbol="AAVE",
        canonical_pair="AAVE/USDT",
        asset_type="protocol_token",
        tier=2,
        coingecko_id="aave",
        defillama_protocol_slug="aave",
        chains=[
            ChainIdentity(
                chain="ethereum",
                chain_id=1,
                contract="0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
            )
        ],
    )

    def fake_defillama(asset):
        return {
            "metrics": [
                {
                    "name": "tvl_usd",
                    "value": 1000000000.0,
                    "source": "defillama",
                    "observed_at": "2026-05-31T00:00:00Z",
                    "evidence_type": "real_onchain",
                }
            ]
        }

    def fake_coingecko(asset):
        return {
            "metrics": [
                {
                    "name": "fdv_to_market_cap",
                    "value": 1.2,
                    "source": "coingecko",
                    "observed_at": "2026-05-31T00:00:00Z",
                    "evidence_type": "proxy",
                }
            ]
        }

    context = build_onchain_context(
        symbol="AAVE/USDT",
        identity=identity,
        config={"enabled_groups": ["protocol_fundamentals", "supply_unlock_risk"]},
        observed_at="2026-05-31T00:00:00Z",
        provider_fetchers={
            "protocol_fundamentals": fake_defillama,
            "supply_unlock_risk": fake_coingecko,
        },
    )

    groups = {group.name: group.status for group in context.groups}
    assert groups["asset_identity"] == "clean"
    assert groups["protocol_fundamentals"] == "clean"
    assert groups["supply_unlock_risk"] == "proxy"
    assert groups["exchange_flows"] == "missing"
    assert "missing_exchange_flows" in context.quality.reason_codes
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_provider.py -q
```

Expected: fails with `ModuleNotFoundError` for `luna_workstation.dataflows.onchain_context_provider`.

- [ ] **Step 3: Implement context builder**

Create `apps/ai-service/luna_workstation/dataflows/onchain_context_provider.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

from luna_workstation.domain.asset_identity import AssetIdentity
from luna_workstation.domain.onchain_context import (
    MetricGroup,
    OnchainContext,
    OnchainMetric,
    OnchainQuality,
)

ProviderFetcher = Callable[[AssetIdentity], dict]

_ALL_GROUPS = [
    "asset_identity",
    "protocol_fundamentals",
    "supply_unlock_risk",
    "holder_distribution",
    "network_activity",
    "exchange_flows",
    "whale_activity",
    "stablecoin_liquidity",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_onchain_context(
    *,
    symbol: str,
    identity: AssetIdentity | None,
    config: dict,
    observed_at: str | None = None,
    provider_fetchers: dict[str, ProviderFetcher] | None = None,
) -> OnchainContext:
    observed_at = observed_at or utc_now_iso()
    if identity is None:
        quality = OnchainQuality(
            score=0.0,
            label="insufficient_data",
            reason_codes=["missing_asset_identity"],
        )
        return OnchainContext(
            symbol=symbol,
            base_asset=_base_symbol(symbol),
            asset_type="unknown",
            tier=None,
            observed_at=observed_at,
            identity_lines=[],
            groups=[MetricGroup(name="asset_identity", status="missing")],
            quality=quality,
        )

    provider_fetchers = provider_fetchers or {}
    groups: list[MetricGroup] = [
        MetricGroup(name="asset_identity", status="clean", metrics=[])
    ]
    status_by_group = {"asset_identity": "clean"}

    for group_name in _ALL_GROUPS:
        if group_name == "asset_identity":
            continue
        fetcher = provider_fetchers.get(group_name)
        if fetcher is None:
            status = "unsupported" if group_name == "stablecoin_liquidity" and identity.asset_type != "stablecoin" else "missing"
            groups.append(MetricGroup(name=group_name, status=status))
            status_by_group[group_name] = status
            continue
        try:
            payload = fetcher(identity)
            metrics = [
                OnchainMetric.model_validate(item)
                for item in payload.get("metrics", [])
            ]
            status = "clean"
            if metrics and all(metric.evidence_type == "proxy" for metric in metrics):
                status = "proxy"
            if not metrics:
                status = "missing"
            groups.append(MetricGroup(name=group_name, status=status, metrics=metrics))
            status_by_group[group_name] = status
        except Exception as exc:
            groups.append(MetricGroup(name=group_name, status="error", error=str(exc)[:200]))
            status_by_group[group_name] = "error"

    quality = OnchainQuality.from_groups(status_by_group, asset_type=identity.asset_type)
    return OnchainContext(
        symbol=symbol,
        base_asset=identity.symbol,
        asset_type=identity.asset_type,
        tier=identity.tier,
        observed_at=observed_at,
        identity_lines=_identity_lines(identity),
        groups=groups,
        quality=quality,
    )


def _identity_lines(identity: AssetIdentity) -> list[str]:
    lines = []
    if identity.coingecko_id:
        lines.append(f"CoinGecko id: {identity.coingecko_id}")
    if identity.defillama_protocol_slug:
        lines.append(f"DeFiLlama protocol slug: {identity.defillama_protocol_slug}")
    for chain in identity.chains:
        if chain.native:
            lines.append(f"Chain {chain.chain} native asset")
        elif chain.contract:
            lines.append(f"Chain {chain.chain} contract {chain.contract}")
    return lines


def _base_symbol(symbol: str) -> str:
    return symbol.split("/")[0].strip().upper()
```

- [ ] **Step 4: Add provider adapter shells with concrete free calls**

Create `apps/ai-service/luna_workstation/dataflows/defillama_provider.py`:

```python
from __future__ import annotations

from luna_workstation.domain.asset_identity import AssetIdentity
from luna_workstation.dataflows.http_utils import fetch_json_with_retry


def fetch_protocol_fundamentals(identity: AssetIdentity) -> dict:
    if not identity.defillama_protocol_slug:
        return {"metrics": []}
    data = fetch_json_with_retry(
        f"https://api.llama.fi/protocol/{identity.defillama_protocol_slug}"
    )
    metrics = []
    tvl = data.get("tvl")
    if tvl is not None:
        metrics.append(
            {
                "name": "tvl_usd",
                "value": float(tvl),
                "source": "defillama",
                "observed_at": None,
                "evidence_type": "real_onchain",
            }
        )
    return {"metrics": metrics}


def fetch_stablecoin_liquidity(identity: AssetIdentity) -> dict:
    if identity.asset_type != "stablecoin":
        return {"metrics": []}
    data = fetch_json_with_retry("https://stablecoins.llama.fi/stablecoins?includePrices=true")
    target = identity.coingecko_id or identity.symbol.lower()
    metrics = []
    for item in data.get("peggedAssets", []):
        ids = {str(item.get("gecko_id", "")).lower(), str(item.get("symbol", "")).lower()}
        if target.lower() in ids:
            circulating = item.get("circulating", {}).get("peggedUSD")
            if circulating is not None:
                metrics.append(
                    {
                        "name": "stablecoin_supply_usd",
                        "value": float(circulating),
                        "source": "defillama",
                        "observed_at": None,
                        "evidence_type": "real_onchain",
                    }
                )
    return {"metrics": metrics}
```

Create `apps/ai-service/luna_workstation/dataflows/etherscan_provider.py`:

```python
from __future__ import annotations

import os

from luna_workstation.domain.asset_identity import AssetIdentity
from luna_workstation.dataflows.http_utils import fetch_json_with_retry


def fetch_holder_distribution(identity: AssetIdentity) -> dict:
    api_key = os.getenv("ETHERSCAN_API_KEY")
    contract = identity.primary_contract
    if not api_key or not contract:
        return {"metrics": []}
    data = fetch_json_with_retry(
        "https://api.etherscan.io/api"
        f"?module=token&action=tokenholdercount&contractaddress={contract}&apikey={api_key}"
    )
    result = data.get("result")
    if result is None:
        return {"metrics": []}
    return {
        "metrics": [
            {
                "name": "holder_count",
                "value": int(result),
                "source": "etherscan",
                "observed_at": None,
                "evidence_type": "real_onchain",
            }
        ]
    }
```

Modify `DATA_PROVIDER_ENV_VARS` in `apps/ai-service/luna_workstation/config/providers.py`:

```python
DATA_PROVIDER_ENV_VARS: dict[str, list[str]] = {
    "cryptopanic": ["CRYPTOPANIC_API_TOKEN"],
    "coingecko": ["COINGECKO_API_KEY"],
    "etherscan": ["ETHERSCAN_API_KEY"],
}
```

- [ ] **Step 5: Run tests and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_provider.py -q
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/luna_workstation/dataflows/defillama_provider.py apps/ai-service/luna_workstation/dataflows/etherscan_provider.py apps/ai-service/luna_workstation/dataflows/onchain_context_provider.py apps/ai-service/luna_workstation/config/providers.py apps/ai-service/tests/test_onchain_context_provider.py
git commit -m "Build onchain context from normalized provider groups"
```

## Task 4: Graph Precompute Boundary And Config

**Files:**
- Create: `apps/ai-service/luna_workstation/graph/onchain_context.py`
- Modify: `apps/ai-service/luna_workstation/default_config.py`
- Modify: `apps/ai-service/config/default.toml`
- Test: `apps/ai-service/tests/test_onchain_context_graph.py`

- [ ] **Step 1: Write failing graph precompute test**

Create `apps/ai-service/tests/test_onchain_context_graph.py`:

```python
from luna_workstation.graph.onchain_context import precompute_onchain_context


def test_precompute_onchain_context_resolves_identity_and_renders(monkeypatch):
    calls = {}

    class FakeRegistry:
        def resolve(self, symbol):
            calls["symbol"] = symbol
            return object()

    class FakeContext:
        quality = type("Quality", (), {"label": "degraded", "reason_codes": ["missing_exchange_flows"]})()

        def to_prompt_block(self):
            return "ONCHAIN CONTEXT BLOCK"

        def model_dump(self, mode="python"):
            return {"quality": {"label": "degraded"}}

    monkeypatch.setattr(
        "luna_workstation.graph.onchain_context.get_default_asset_registry",
        lambda: FakeRegistry(),
    )
    monkeypatch.setattr(
        "luna_workstation.graph.onchain_context.build_onchain_context",
        lambda **kwargs: FakeContext(),
    )

    prompt, result = precompute_onchain_context(
        {"onchain_context": {"enabled": True}},
        "AAVE/USDT",
        "2026-05-31",
    )

    assert prompt == "ONCHAIN CONTEXT BLOCK"
    assert result.quality.label == "degraded"
    assert calls["symbol"] == "AAVE/USDT"
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_graph.py -q
```

Expected: fails with `ModuleNotFoundError` for `luna_workstation.graph.onchain_context`.

- [ ] **Step 3: Implement graph precompute boundary**

Create `apps/ai-service/luna_workstation/graph/onchain_context.py`:

```python
from __future__ import annotations

import logging

from luna_workstation.dataflows.asset_registry import get_default_asset_registry
from luna_workstation.dataflows.defillama_provider import (
    fetch_protocol_fundamentals,
    fetch_stablecoin_liquidity,
)
from luna_workstation.dataflows.etherscan_provider import fetch_holder_distribution
from luna_workstation.dataflows.onchain_context_provider import build_onchain_context

logger = logging.getLogger(__name__)


def precompute_onchain_context(config: dict, symbol: str, trade_date: str):
    policy = dict(config.get("onchain_context", {}))
    if policy.get("enabled") is False:
        return "", None

    identity = get_default_asset_registry().resolve(symbol)
    provider_fetchers = {
        "protocol_fundamentals": fetch_protocol_fundamentals,
        "stablecoin_liquidity": fetch_stablecoin_liquidity,
        "holder_distribution": fetch_holder_distribution,
    }
    context = build_onchain_context(
        symbol=symbol,
        identity=identity,
        config=policy,
        provider_fetchers=provider_fetchers,
    )
    if context.timestamp_semantics == "latest" and trade_date:
        logger.debug("Onchain context for %s uses latest timestamp semantics", symbol)
    return context.to_prompt_block(), context
```

- [ ] **Step 4: Add config defaults**

Modify `DEFAULT_CONFIG` in `apps/ai-service/luna_workstation/default_config.py`:

```python
"onchain_context": {
    "enabled": True,
    "strict_identity": True,
    "timestamp_semantics": "latest",
    "providers": ["defillama", "coingecko", "etherscan"],
    "premium_providers": [],
},
```

Modify `apps/ai-service/config/default.toml`:

```toml
[onchain_context]
enabled = true
strict_identity = true
timestamp_semantics = "latest"
providers = ["defillama", "coingecko", "etherscan"]
premium_providers = []
```

- [ ] **Step 5: Run test and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_graph.py -q
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/luna_workstation/graph/onchain_context.py apps/ai-service/luna_workstation/default_config.py apps/ai-service/config/default.toml apps/ai-service/tests/test_onchain_context_graph.py
git commit -m "Add onchain context precompute boundary"
```

## Task 5: Onchain Analyst Injection And Prompt Contract

**Files:**
- Modify: `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
- Modify: `apps/ai-service/luna_workstation/agents/analysts/onchain_analyst.py`
- Modify: `apps/ai-service/luna_workstation/agents/utils/agent_states.py`
- Modify: `apps/ai-service/luna_workstation/graph/protocols.py`
- Test: `apps/ai-service/tests/test_onchain_context_injection.py`

- [ ] **Step 1: Write failing injection test**

Create `apps/ai-service/tests/test_onchain_context_injection.py`:

```python
from unittest.mock import MagicMock

from luna_workstation.agents.analysts.onchain_analyst import create_onchain_analyst


class FakeBoundLLM:
    def invoke(self, _messages):
        return MagicMock(content="onchain report")


class FakeLLM:
    def bind_tools(self, _tools):
        return FakeBoundLLM()


def test_onchain_analyst_injects_onchain_context(monkeypatch):
    captured = {}

    class FakePrompt:
        @classmethod
        def from_messages(cls, _messages):
            return cls()

        def partial(self, **kwargs):
            captured.update(kwargs)
            return self

        def __or__(self, _other):
            return FakeBoundLLM()

    monkeypatch.setattr(
        "luna_workstation.agents.utils.agent_utils.ChatPromptTemplate",
        FakePrompt,
    )

    analyst = create_onchain_analyst(FakeLLM(), config={"output_language": "English"})
    result = analyst(
        {
            "company_of_interest": "AAVE/USDT",
            "trade_date": "2026-05-31",
            "messages": [],
            "quant_signal": "QUANT BLOCK",
            "onchain_context": "ONCHAIN CONTEXT BLOCK",
        }
    )

    assert result["fundamentals_report"] == "onchain report"
    assert "ONCHAIN CONTEXT BLOCK" in captured["system_message"]
    assert "Real on-chain evidence" in captured["system_message"]
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_injection.py -q
```

Expected: fails because `onchain_context` is not injected.

- [ ] **Step 3: Add generic onchain context injection**

Modify `run_analyst_chain` in `apps/ai-service/luna_workstation/agents/utils/agent_utils.py` to add parameters:

```python
    inject_onchain_context: bool = False,
    onchain_context_label: str | None = None,
```

After the quant signal injection block, add:

```python
    if inject_onchain_context:
        onchain_block = state.get("onchain_context", "")
        if onchain_block:
            label = onchain_context_label or "PRE-COMPUTED ONCHAIN CONTEXT"
            system_content += (
                f"\n\n===== {label} =====\n"
                f"{guard_untrusted_context(label, onchain_block)}"
                f"===== END ONCHAIN CONTEXT =====\n"
            )
```

Modify `create_analyst` signature and nested call to thread the same two parameters.

- [ ] **Step 4: Update Onchain Analyst prompt**

Modify `apps/ai-service/luna_workstation/agents/analysts/onchain_analyst.py`:

```python
_ONCHAIN_SYSTEM_CONTENT = (
    "You are a strict crypto on-chain evidence analyst. A pre-computed "
    "ONCHAIN CONTEXT block is provided below and is your primary evidence. "
    "Separate real on-chain evidence from proxy context. Do not infer exchange "
    "flows, whale movement, accumulation, distribution, institutional activity, "
    "active-address growth, or protocol usage unless the ONCHAIN CONTEXT block "
    "explicitly provides that metric.\n\n"
    "Report contract: include Asset Identity, Coverage & Data Quality, Real "
    "On-chain Evidence, Proxy Context, Thesis Implication, and Missing Data / "
    "Invalidations. If the bundle quality is insufficient_data, write that real "
    "on-chain evidence is insufficient and keep the stance uncertain. Existing "
    "tools are fallback/proxy only and must not override missing data declared "
    "by the bundle.\n\n"
    "The quantitative signal engine has already computed funding rates, open "
    "interest trends, and liquidation data. Do not re-fetch funding/OI/liquidation "
    "data. Reference the pre-computed signal for those metrics."
    " Make sure to append a Markdown table at the end of the report to organize "
    "key points in the report, organized and easy to read."
)
```

Modify `create_onchain_analyst`:

```python
        inject_quant_signal=True,
        quant_signal_label="PRE-COMPUTED QUANT SIGNAL (contains funding, OI, liquidation data)",
        inject_onchain_context=True,
        onchain_context_label="PRE-COMPUTED ONCHAIN CONTEXT",
```

- [ ] **Step 5: Extend state typings**

Add to `AgentState` in `apps/ai-service/luna_workstation/agents/utils/agent_states.py`:

```python
    onchain_context: Annotated[
        str, "Pre-computed on-chain identity, coverage, metric, and quality context"
    ]
```

Add to `ResearchGraphState` in `apps/ai-service/luna_workstation/graph/protocols.py`:

```python
    onchain_context: str
```

- [ ] **Step 6: Run test and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_onchain_context_injection.py -q
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/luna_workstation/agents/utils/agent_utils.py apps/ai-service/luna_workstation/agents/analysts/onchain_analyst.py apps/ai-service/luna_workstation/agents/utils/agent_states.py apps/ai-service/luna_workstation/graph/protocols.py apps/ai-service/tests/test_onchain_context_injection.py
git commit -m "Inject onchain context into Onchain Analyst"
```

## Task 6: Research Run Integration And Snapshot Event

**Files:**
- Modify: `apps/ai-service/luna_workstation/graph/run_context.py`
- Modify: `apps/ai-service/luna_workstation/graph/research_agents_graph.py`
- Modify: `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
- Test: `apps/ai-service/tests/test_run_orchestrator.py`

- [ ] **Step 1: Add orchestrator test**

Add this test to `apps/ai-service/tests/test_run_orchestrator.py`:

```python
def test_run_orchestrator_adds_onchain_context_to_initial_state(monkeypatch):
    from luna_workstation.graph.run_orchestrator import ResearchRunOrchestrator

    class Host:
        config = {
            "asset_class": "crypto",
            "market_type": "spot",
            "llm_provider": "test",
            "checkpoint_enabled": False,
            "data_vendors": {},
        }
        graph = None
        debug = False
        callbacks = []
        propagator = None
        current_research_run = None
        current_trade_thesis = None
        current_signals = []
        current_agent_opinions = []
        current_debate = None
        curr_state = None

        def _start_journal_run(self):
            pass

        def _precompute_quant_signal(self, symbol, trade_date):
            return "QUANT"

        def _precompute_onchain_context(self, symbol, trade_date):
            return "ONCHAIN"

        def _save_journal_quant_signals(self):
            pass

        def _save_journal_agent_research(self, final_state):
            pass

        def _complete_journal_run(self):
            pass

        def _log_state(self, trade_date, final_state):
            pass

    captured = {}

    class Propagator:
        def create_initial_state(self, company_name, trade_date, past_context, market_type):
            return {
                "company_of_interest": company_name,
                "trade_date": trade_date,
                "past_context": past_context,
                "market_type": market_type,
                "messages": [],
            }

        def get_graph_args(self, callbacks=None):
            return {}

    class Graph:
        def invoke(self, init_state, **_args):
            captured.update(init_state)
            return {
                **init_state,
                "market_report": "",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "ok",
                "investment_debate_state": {},
                "risk_debate_state": {},
            }

    host = Host()
    host.graph = Graph()
    host.propagator = Propagator()

    monkeypatch.setattr(
        "luna_workstation.graph.run_orchestrator.compute_config_hash",
        lambda _config: "hash",
    )

    ResearchRunOrchestrator().run_graph(host, "AAVE/USDT", "2026-05-31")

    assert captured["quant_signal"] == "QUANT"
    assert captured["onchain_context"] == "ONCHAIN"
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_run_orchestrator.py::test_run_orchestrator_adds_onchain_context_to_initial_state -q
```

Expected: fails because `onchain_context` is not in initial state.

- [ ] **Step 3: Add run context storage**

Add to `GraphRunContext` in `apps/ai-service/luna_workstation/graph/run_context.py`:

```python
    onchain_context_result: Any = None
```

Add property accessors to `GraphRunContextMixin`:

```python
    @property
    def onchain_context_result(self) -> Any:
        return self._ensure_run_context().onchain_context_result

    @onchain_context_result.setter
    def onchain_context_result(self, value: Any) -> None:
        self._ensure_run_context().onchain_context_result = value
```

- [ ] **Step 4: Add host precompute method**

Modify `apps/ai-service/luna_workstation/graph/research_agents_graph.py`:

```python
from .onchain_context import precompute_onchain_context
```

Add method near `_precompute_quant_signal`:

```python
    def _precompute_onchain_context(self, symbol: str, trade_date: str) -> str:
        """Build Onchain Analyst context before graph execution."""
        onchain_prompt, result = precompute_onchain_context(self.config, symbol, trade_date)
        self.onchain_context_result = result
        return onchain_prompt
```

- [ ] **Step 5: Add orchestrator state injection**

Modify `apps/ai-service/luna_workstation/graph/run_orchestrator.py` after quant precompute:

```python
        onchain_context_text = ""
        if hasattr(host, "_precompute_onchain_context"):
            onchain_context_text = host._precompute_onchain_context(company_name, trade_date)
```

After `init_agent_state["quant_signal"] = quant_signal_text`, add:

```python
        init_agent_state["onchain_context"] = onchain_context_text
```

- [ ] **Step 6: Run test and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_run_orchestrator.py::test_run_orchestrator_adds_onchain_context_to_initial_state -q
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/luna_workstation/graph/run_context.py apps/ai-service/luna_workstation/graph/research_agents_graph.py apps/ai-service/luna_workstation/graph/run_orchestrator.py apps/ai-service/tests/test_run_orchestrator.py
git commit -m "Precompute onchain context for research runs"
```

## Task 7: Thesis Quality Integration

**Files:**
- Modify: `apps/ai-service/luna_workstation/graph/opinions.py`
- Test: `apps/ai-service/tests/test_thesis_explainability.py`

- [ ] **Step 1: Add failing quality propagation test**

Add to `apps/ai-service/tests/test_thesis_explainability.py`:

```python
def test_onchain_context_missing_identity_caps_quality_to_insufficient():
    from luna_workstation.graph.opinions import opinion_from_text

    report = """
    Asset Identity: missing
    Coverage & Data Quality: insufficient_data
    Reason Codes:
    - missing_asset_identity
    - missing_exchange_flows
    """

    opinion = opinion_from_text(
        "Onchain Analyst",
        report,
        role="onchain_analyst",
        source_report_type="onchain",
    )

    assert opinion is not None
    assert opinion.data_quality_label == "insufficient_data"
    assert opinion.data_quality <= 0.34
    assert "missing_asset_identity" in opinion.reason_codes
```

- [ ] **Step 2: Run test and verify red**

```bash
cd apps/ai-service
python -m pytest tests/test_thesis_explainability.py::test_onchain_context_missing_identity_caps_quality_to_insufficient -q
```

Expected: fails because `missing_asset_identity` is not yet mapped.

- [ ] **Step 3: Extend reason-code extraction**

Modify `_reason_codes_from_text` in `apps/ai-service/luna_workstation/graph/opinions.py`:

```python
    onchain_codes = [
        "missing_asset_identity",
        "missing_real_onchain_metrics",
        "missing_exchange_flows",
        "missing_holder_distribution",
        "missing_protocol_fundamentals",
        "proxy_only_onchain",
        "onchain_provider_not_point_in_time",
    ]
    for code in onchain_codes:
        if code in lowered:
            codes.append(code)
```

Modify `_text_opinion` or the current quality adjustment branch so onchain identity failures cap quality:

```python
    if "missing_asset_identity" in reason_codes:
        data_quality = min(data_quality, 0.0)
        stance_override = AgentStance.UNCERTAIN
    elif any(
        code in reason_codes
        for code in [
            "missing_real_onchain_metrics",
            "missing_exchange_flows",
            "missing_holder_distribution",
            "missing_protocol_fundamentals",
            "proxy_only_onchain",
            "onchain_provider_not_point_in_time",
        ]
    ):
        data_quality = min(data_quality, 0.6)
```

- [ ] **Step 4: Run test and verify green**

```bash
cd apps/ai-service
python -m pytest tests/test_thesis_explainability.py::test_onchain_context_missing_identity_caps_quality_to_insufficient -q
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/graph/opinions.py apps/ai-service/tests/test_thesis_explainability.py
git commit -m "Propagate onchain context quality to analyst opinions"
```

## Task 8: Documentation And Verification

**Files:**
- Modify: `docs/features/research-data-foundation/README.md`

- [ ] **Step 1: Update On-chain gap row**

Modify the On-chain row in `docs/features/research-data-foundation/README.md`:

```markdown
| P1 | On-chain | Onchain Analyst now has a precomputed context path with asset identity, typed metric-group coverage, free/default DeFiLlama and CoinGecko inputs, optional Etherscan-compatible holder coverage, and strict missing-data quality labels. Paid exchange-flow, whale/entity-label, and full wallet-flow providers remain outside V1. | The system must not overstate proxy metrics as wallet-level evidence. | Treat Onchain V1 as strict evidence coverage; add premium flow providers only after production-readiness planning. |
```

- [ ] **Step 2: Run focused tests**

```bash
cd apps/ai-service
python -m pytest tests/test_asset_registry.py tests/test_onchain_context_models.py tests/test_onchain_context_provider.py tests/test_onchain_context_graph.py tests/test_onchain_context_injection.py tests/test_run_orchestrator.py::test_run_orchestrator_adds_onchain_context_to_initial_state tests/test_thesis_explainability.py::test_onchain_context_missing_identity_caps_quality_to_insufficient -q
```

Expected: all selected tests pass.

- [ ] **Step 3: Run lint for touched package**

```bash
cd apps/ai-service
python -m ruff check luna_workstation tests/test_asset_registry.py tests/test_onchain_context_models.py tests/test_onchain_context_provider.py tests/test_onchain_context_graph.py tests/test_onchain_context_injection.py
```

Expected: no ruff errors.

- [ ] **Step 4: Commit**

```bash
git add docs/features/research-data-foundation/README.md
git commit -m "Document Onchain Analyst input coverage"
```

## Release Readiness Notes

Task 1B enforces the V1 registry universe. Before calling Onchain V1 production-grade, review the same registry for current symbol migrations and contract accuracy:

- Native/major: BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOT, NEAR, SUI, APT, TON, TRX
- L2/ecosystem: ARB, OP, POL or MATIC depending on current supported exchange symbol
- DeFi/protocol: UNI, AAVE, MKR or SKY depending on current supported exchange symbol, LDO, CRV, COMP, SNX, GMX, PENDLE, ENA
- Oracle/infra: LINK, FIL, HBAR, RENDER or RNDR depending on current supported exchange symbol
- Stablecoins: USDT, USDC, DAI
- High-liquidity memes: DOGE, SHIB, PEPE, WIF, BONK

Each registry entry must keep the best available identity fields for its asset type. If an entry has no contract or protocol slug, the missing group remains explicit in `OnchainContext` and thesis quality degrades according to the scoring contract.

## Self-Review

Spec coverage:

- Real on-chain evidence analyst: covered by Tasks 2, 3, 5, and 7.
- Asset identity gate: covered by Task 1, Task 1B, and Task 3.
- Precomputed bundle before analyst run: covered by Tasks 4, 5, and 6.
- Free/default providers first: covered by Task 3.
- Paid provider injection after production readiness: documented in Scope and Release Readiness Notes.
- Strict quality/degradation and confidence impact: covered by Tasks 2 and 7.
- `fundamentals_report` compatibility: documented in Compatibility Decision.
- Historical/latest semantics: included in the context contract and analyst rules.

Placeholder scan:

- No unresolved implementation gaps are intentionally left in this plan.
- All new files, public functions, state keys, test commands, and expected outcomes are named explicitly.

Type consistency:

- State key is consistently named `onchain_context`.
- Runtime result is consistently named `onchain_context_result`.
- Prompt label is consistently `PRE-COMPUTED ONCHAIN CONTEXT`.

## Execution Handoff

Plan complete and saved to `docs/analysts_refrac/2026-05-31-onchain-analyst-input-bundle-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session with checkpoints.
