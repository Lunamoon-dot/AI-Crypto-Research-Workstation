"""Tests for templates/registry.py — TemplateRegistry lookup and heuristic detection."""

import pytest

from tradingagents.domain.template import SetupTemplate
from tradingagents.templates.registry import TemplateRegistry


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
