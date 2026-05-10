"""Phase 5 template registry — centralized lookup and heuristic detection."""

from __future__ import annotations

from typing import Any

from tradingagents.domain.template import SetupTemplate
from tradingagents.templates.definitions import ALL_TEMPLATES


class TemplateRegistry:
    """Central registry of setup templates with lookup and heuristic detection."""

    _templates: dict[str, SetupTemplate] = {}
    _initialized: bool = False

    @classmethod
    def _ensure_initialized(cls) -> None:
        if cls._initialized:
            return
        for template in ALL_TEMPLATES:
            cls._templates[template.name] = template
        cls._initialized = True

    @classmethod
    def register(cls, template: SetupTemplate) -> None:
        """Register a custom or programmatically-built template."""
        cls._ensure_initialized()
        cls._templates[template.name] = template

    @classmethod
    def get(cls, name: str) -> SetupTemplate | None:
        """Look up a template by name. Returns None if not found."""
        cls._ensure_initialized()
        return cls._templates.get(name)

    @classmethod
    def get_or_default(cls, name: str | None) -> SetupTemplate:
        """Get the named template, or a generic fallback if the name is missing/unknown."""
        if name:
            tmpl = cls.get(name)
            if tmpl is not None:
                return tmpl
        return cls._generic_template()

    @classmethod
    def list_all(cls) -> list[str]:
        """Return sorted list of registered template names."""
        cls._ensure_initialized()
        return sorted(cls._templates.keys())

    @classmethod
    def list_templates(cls) -> list[SetupTemplate]:
        """Return all registered template instances."""
        cls._ensure_initialized()
        return list(cls._templates.values())

    # ------------------------------------------------------------------
    # Heuristic detection — maps market conditions to the best template
    # ------------------------------------------------------------------

    @classmethod
    def detect(cls, context: dict[str, Any]) -> str:
        """Detect the best-matching template name from market context.

        *context* is a flat dict of string keys to string-ish values. The
        function scores each registered template by how many of its
        required-field names appear in the context keys, then returns the
        highest-scoring template name (or ``"agent_debate"`` as a fallback).
        """
        cls._ensure_initialized()
        best_name = "agent_debate"
        best_score = 0

        ctx_keys_lower = {k.lower(): k for k in context.keys()}

        for name, template in cls._templates.items():
            score = 0
            for field in template.required_fields:
                if field.name.lower() in ctx_keys_lower:
                    score += 2  # required field match is strongly indicative
            for field in template.optional_fields:
                if field.name.lower() in ctx_keys_lower:
                    score += 1  # optional field match is mildly indicative
            # Bonus: keyword match in any string value
            ctx_values = " ".join(
                str(v) for v in context.values() if isinstance(v, str)
            ).lower()
            if name.lower() in ctx_values:
                score += 3
            if score > best_score:
                best_score = score
                best_name = name

        return best_name

    # ------------------------------------------------------------------
    # Generic fallback
    # ------------------------------------------------------------------

    @classmethod
    def _generic_template(cls) -> SetupTemplate:
        """Return a minimal generic template for unrecognized setups."""
        return SetupTemplate(
            name="agent_debate",
            description="Generic agent-debate-driven scenario (no specific template matched)",
            required_fields=[],
            optional_fields=[],
            condition_template="If the thesis direction confirms with supporting evidence, the scenario activates.",
            expected_behavior_template="Market behaves in line with the directional thesis, subject to invalidation conditions.",
            invalidation_template="Invalid if contradictory evidence accumulates or the thesis risk level is breached.",
            risk_map_defaults=["Manual review required before acting on this scenario."],
        )
