"""Tests for templates/registry.py — TemplateRegistry lookup and heuristic detection."""

import pytest

from luna_workstation.domain.template import SetupTemplate
from luna_workstation.templates.registry import TemplateRegistry


# Reset registry to a clean state before each test
@pytest.fixture(autouse=True)
def _reset_registry():
    TemplateRegistry._initialized = False
    TemplateRegistry._templates = {}
    yield
    TemplateRegistry._initialized = False
    TemplateRegistry._templates = {}


class TestRegistryLookup:
    def test_list_all_returns_names(self):
        names = TemplateRegistry.list_all()
        assert len(names) >= 7
        assert "breakout" in names
        assert "range_reversion" in names

    def test_get_known_template(self):
        tmpl = TemplateRegistry.get("breakout")
        assert tmpl is not None
        assert tmpl.name == "breakout"
        assert "breaking" in tmpl.description.lower()

    def test_get_unknown_returns_none(self):
        assert TemplateRegistry.get("nonexistent") is None

    def test_get_or_default_known(self):
        tmpl = TemplateRegistry.get_or_default("breakout")
        assert tmpl.name == "breakout"

    def test_get_or_default_unknown_falls_back_to_generic(self):
        tmpl = TemplateRegistry.get_or_default("does_not_exist")
        assert tmpl.name == "agent_debate"

    def test_get_or_default_none_falls_back_to_generic(self):
        tmpl = TemplateRegistry.get_or_default(None)
        assert tmpl.name == "agent_debate"

    def test_get_or_default_empty_string_falls_back(self):
        tmpl = TemplateRegistry.get_or_default("")
        assert tmpl.name == "agent_debate"

    def test_list_templates_returns_instances(self):
        templates = TemplateRegistry.list_templates()
        assert len(templates) >= 7
        for t in templates:
            assert isinstance(t, SetupTemplate)


class TestRegisterCustom:
    def test_can_register_custom_template(self):
        custom = SetupTemplate(name="custom_setup", description="A custom setup")
        TemplateRegistry.register(custom)
        assert TemplateRegistry.get("custom_setup") is custom

    def test_custom_overrides_builtin(self):
        custom = SetupTemplate(name="breakout", description="Custom breakout override")
        TemplateRegistry.register(custom)
        assert (
            TemplateRegistry.get("breakout").description == "Custom breakout override"
        )


class TestHeuristicDetection:
    def test_breakout_context_matches_breakout_template(self):
        context = {
            "resistance_level": "110,000",
            "volume_confirmation": "spot CVD rising",
            "funding_state": "neutral",
        }
        result = TemplateRegistry.detect(context)
        assert result == "breakout"

    def test_no_match_falls_back_to_agent_debate(self):
        result = TemplateRegistry.detect({"irrelevant_key": "irrelevant_value"})
        assert result == "agent_debate"

    def test_keyword_in_value_adds_bonus(self):
        context = {
            "some_key": "this is a macro_event scenario",
        }
        result = TemplateRegistry.detect(context)
        assert result == "macro_event"

    def test_multiple_matches_picks_best(self):
        context = {
            "resistance_level": "100k",
            "funding_state": "overheated",
            # funding_squeeze also has 'funding_state' as required
        }
        result = TemplateRegistry.detect(context)
        # breakout has more required fields matching (resistance_level + funding_state)
        # vs funding_squeeze which has different fields
        assert result in ("breakout", "funding_squeeze")


class TestGenericTemplate:
    def test_generic_template_has_no_required_fields(self):
        tmpl = TemplateRegistry.get_or_default(None)
        assert tmpl.required_fields == []
        assert tmpl.optional_fields == []

    def test_generic_template_has_risk_map(self):
        tmpl = TemplateRegistry.get_or_default(None)
        assert len(tmpl.risk_map_defaults) >= 1


class TestBreakoutTemplateFields:
    def test_required_fields_present(self):
        tmpl = TemplateRegistry.get("breakout")
        names = tmpl.field_names()
        assert "resistance_level" in names
        assert "volume_confirmation" in names
        assert "funding_state" in names
        assert "invalidation_level" in names

    def test_validate_missing_required(self):
        tmpl = TemplateRegistry.get("breakout")
        missing = tmpl.validate_fields({})
        assert len(missing) >= 4

    def test_validate_all_required_present(self):
        tmpl = TemplateRegistry.get("breakout")
        missing = tmpl.validate_fields(
            {
                "resistance_level": "110k",
                "volume_confirmation": "yes",
                "funding_state": "neutral",
                "invalidation_level": "108k",
                "higher_timeframe_trend": "uptrend",
            }
        )
        assert missing == []


# ---------------------------------------------------------------------------
# Phase 5: validate_template_context — pre-LLM gate
# ---------------------------------------------------------------------------


class TestValidateTemplateContext:
    """Tests for TemplateRegistry.validate_template_context()."""

    def test_none_setup_type_returns_agent_debate_no_degrade(self):
        result = TemplateRegistry.validate_template_context(None, {})
        assert result["effective_setup_type"] == "agent_debate"
        assert result["is_degraded"] is False
        assert result["missing_fields"] == []
        assert result["degrade_reason"] == ""

    def test_agent_debate_setup_type_returns_as_is(self):
        result = TemplateRegistry.validate_template_context("agent_debate", {})
        assert result["effective_setup_type"] == "agent_debate"
        assert result["is_degraded"] is False

    def test_unknown_setup_type_degrades(self):
        result = TemplateRegistry.validate_template_context("nonexistent", {})
        assert result["effective_setup_type"] == "agent_debate"
        assert result["is_degraded"] is True
        assert "Unknown setup_type" in result["degrade_reason"]

    def test_all_required_fields_present_no_degrade(self):
        context = {
            "resistance_level": "110k",
            "volume_confirmation": "yes",
            "funding_state": "neutral",
            "invalidation_level": "108k",
            "higher_timeframe_trend": "uptrend",
        }
        result = TemplateRegistry.validate_template_context("breakout", context)
        assert result["effective_setup_type"] == "breakout"
        assert result["is_degraded"] is False
        assert result["missing_fields"] == []

    def test_insufficient_coverage_degrades(self):
        """Only 1 of 5 required fields → coverage 20% < 50% threshold."""
        context = {
            "resistance_level": "110k",
            # missing: volume_confirmation, funding_state, invalidation_level,
            # higher_timeframe_trend
        }
        result = TemplateRegistry.validate_template_context("breakout", context)
        assert result["effective_setup_type"] == "agent_debate"
        assert result["is_degraded"] is True
        assert len(result["missing_fields"]) == 4
        assert "Degrading to agent_debate" in result["degrade_reason"]

    def test_partial_coverage_no_degrade_at_threshold(self):
        """3 of 5 required fields → coverage 60% ≥ 50% threshold."""
        context = {
            "resistance_level": "110k",
            "volume_confirmation": "yes",
            "funding_state": "neutral",
            # missing: invalidation_level, higher_timeframe_trend
        }
        result = TemplateRegistry.validate_template_context("breakout", context)
        assert result["effective_setup_type"] == "breakout"
        assert result["is_degraded"] is False
        assert len(result["missing_fields"]) == 2
        assert len(result["available_fields"]) == 3

    def test_template_without_required_fields_never_degrades(self):
        """The 'agent_debate' template has no required fields."""
        # Register a template with no required fields
        TemplateRegistry.register(
            SetupTemplate(name="simple_setup", description="No required fields")
        )
        result = TemplateRegistry.validate_template_context("simple_setup", {})
        assert result["effective_setup_type"] == "simple_setup"
        assert result["is_degraded"] is False

    def test_empty_context_values_degrades(self):
        """All values empty/N/A → no fields available."""
        context = {
            "resistance_level": "",
            "volume_confirmation": "N/A",
            "funding_state": "",
            "invalidation_level": "N/A",
        }
        result = TemplateRegistry.validate_template_context("breakout", context)
        assert result["effective_setup_type"] == "agent_debate"
        assert result["is_degraded"] is True
        assert len(result["available_fields"]) == 0

    def test_requested_setup_type_preserved(self):
        result = TemplateRegistry.validate_template_context("breakout", {})
        assert result["requested_setup_type"] == "breakout"
        assert result["effective_setup_type"] == "agent_debate"

    def test_custom_threshold(self):
        """With threshold 0.0, any coverage is accepted."""
        context = {"resistance_level": "110k"}
        result = TemplateRegistry.validate_template_context(
            "breakout", context, required_coverage_threshold=0.0
        )
        assert result["is_degraded"] is False
        assert result["effective_setup_type"] == "breakout"
