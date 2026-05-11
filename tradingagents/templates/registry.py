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
    # Template field validation — pre-LLM gate (Phase 5 enforcement)
    # ------------------------------------------------------------------

    @classmethod
    def validate_template_context(
        cls,
        setup_type: str | None,
        context_values: dict[str, Any],
        *,
        required_coverage_threshold: float = 0.5,
    ) -> dict[str, Any]:
        """Validate that *context_values* has enough required fields for *setup_type*.

        Returns a dict with:
        - ``effective_setup_type``: the setup_type to use (may be degraded)
        - ``is_degraded``: True if we fell back to ``agent_debate``
        - ``missing_fields``: list of required field names missing from context
        - ``degrade_reason``: human-readable explanation (empty if not degraded)
        - ``available_fields``: list of required fields that ARE present
        - ``requested_setup_type``: the original setup_type requested

        Degradation triggers when:
        - The template has required fields AND fewer than *required_coverage_threshold*
          of them are present in *context_values* (or the template is unknown).
        - If *setup_type* is None, returns ``agent_debate`` with is_degraded=False
          (no template was requested, so no degradation).
        """
        result: dict[str, Any] = {
            "effective_setup_type": setup_type or "agent_debate",
            "is_degraded": False,
            "missing_fields": [],
            "degrade_reason": "",
            "available_fields": [],
            "requested_setup_type": setup_type,
        }

        if not setup_type or setup_type == "agent_debate":
            return result

        cls._ensure_initialized()
        template = cls._templates.get(setup_type)
        if template is None:
            result["effective_setup_type"] = "agent_debate"
            result["is_degraded"] = True
            result["degrade_reason"] = (
                f"Unknown setup_type '{setup_type}' — falling back to agent_debate."
            )
            return result

        if not template.required_fields:
            return result

        # Build a lookup of context values
        ctx_lower = {k.lower(): v for k, v in context_values.items()}

        missing = []
        available = []
        for field in template.required_fields:
            val = ctx_lower.get(field.name.lower())
            if val is not None and val != "" and val != "N/A":
                available.append(field.name)
            else:
                missing.append(field.name)

        total_required = len(template.required_fields)
        coverage = len(available) / total_required if total_required > 0 else 1.0

        result["missing_fields"] = missing
        result["available_fields"] = available

        if coverage < required_coverage_threshold:
            result["effective_setup_type"] = "agent_debate"
            result["is_degraded"] = True
            result["degrade_reason"] = (
                f"Template '{setup_type}' requires {total_required} field(s) "
                f"({', '.join(f.name for f in template.required_fields)}), "
                f"but only {len(available)}/{total_required} are available "
                f"(coverage={coverage:.0%} < threshold={required_coverage_threshold:.0%}). "
                f"Missing: {', '.join(missing)}. Degrading to agent_debate."
            )

        return result

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
            risk_map_defaults=[
                "Manual review required before acting on this scenario."
            ],
        )
