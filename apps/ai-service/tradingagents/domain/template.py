"""Phase 5: Setup template and template-field domain models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TemplateField(BaseModel):
    """A single field required or optional for a setup template."""

    name: str
    field_type: str = "str"  # "str", "float", "bool", "list[str]"
    description: str
    default: Any = None


class SetupTemplate(BaseModel):
    """A named scenario-planning template for a specific market setup type."""

    name: str
    description: str
    required_fields: list[TemplateField] = Field(default_factory=list)
    optional_fields: list[TemplateField] = Field(default_factory=list)
    condition_template: str = ""
    expected_behavior_template: str = ""
    invalidation_template: str = ""
    risk_map_defaults: list[str] = Field(default_factory=list)

    def field_names(self) -> list[str]:
        return [f.name for f in self.required_fields + self.optional_fields]

    def validate_fields(self, values: dict[str, Any]) -> list[str]:
        """Return list of missing required field names."""
        missing = []
        for f in self.required_fields:
            if f.name not in values or values[f.name] is None:
                missing.append(f.name)
        return missing
