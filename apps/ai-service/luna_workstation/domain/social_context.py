"""Structured social context for market mood and retail attention."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class SocialMacroMood(BaseModel):
    fear_greed_value: int | None = None
    fear_greed_label: str = "unknown"
    risk_note: str = "Market-wide crypto mood unavailable."


class SocialAssetAttention(BaseModel):
    symbol: str
    trending_rank: int | None = None
    market_cap_rank: int | None = None
    social_score: float | None = None
    attention_label: str = "unknown"
    source: str = "coingecko_trending"


class SocialQuality(BaseModel):
    status: str = "insufficient_data"
    reason_codes: list[str] = Field(default_factory=list)

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value) -> str:
        normalized = str(value or "insufficient_data").strip().lower()
        if normalized in {"insufficient", "missing"}:
            return "insufficient_data"
        if normalized not in {"clean", "degraded", "insufficient_data"}:
            return "degraded"
        return normalized


class SocialContext(BaseModel):
    instrument: str
    macro_mood: SocialMacroMood | None = None
    asset_attention: SocialAssetAttention | None = None
    quality: SocialQuality = Field(default_factory=SocialQuality)

    def to_prompt_block(self) -> str:
        lines = [
            "===== PRE-COMPUTED SOCIAL CONTEXT =====",
            f"Instrument: {self.instrument}",
            f"Quality: {self.quality.status}",
            "",
            "Macro mood:",
        ]
        if self.macro_mood is None:
            lines.append("- Fear & Greed: unavailable")
        else:
            value = (
                "unknown"
                if self.macro_mood.fear_greed_value is None
                else str(self.macro_mood.fear_greed_value)
            )
            lines.extend(
                [
                    f"- Fear & Greed: {value} ({self.macro_mood.fear_greed_label})",
                    "- Scope: market-wide crypto mood, not coin-specific sentiment",
                    f"- Risk note: {self.macro_mood.risk_note}",
                ]
            )

        lines.extend(["", "Asset-specific retail attention:"])
        if self.asset_attention is None:
            lines.append("- Asset attention: unavailable")
        else:
            lines.extend(
                [
                    f"- Asset attention: {self.asset_attention.attention_label}",
                    f"- Source: {self.asset_attention.source}",
                    f"- Trending rank: {self.asset_attention.trending_rank}",
                    f"- Market-cap rank: {self.asset_attention.market_cap_rank}",
                    f"- Social score: {self.asset_attention.social_score}",
                ]
            )

        lines.extend(["", "Missing/degraded data:"])
        if not self.quality.reason_codes:
            lines.append("- none")
        else:
            for code in self.quality.reason_codes:
                lines.append(f"- {code}")

        lines.extend(
            [
                "",
                "Rules for analyst:",
                "- Treat Fear & Greed as macro context only.",
                "- Treat CoinGecko trending/social score as retail attention only.",
                (
                    "- Do not cite news, official posts, founder posts, KOL posts, "
                    "Telegram, Reddit, Discord, or YouTube evidence unless a future "
                    "social evidence feed explicitly provides it."
                ),
                "- Do not convert social attention alone into BUY/SELL instructions.",
                "- If asset-specific attention is unavailable, use missing_social_feed.",
                "===== END SOCIAL CONTEXT =====",
            ]
        )
        return "\n".join(lines)
