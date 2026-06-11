"""Deterministic rendering for validated thesis candidates."""

from __future__ import annotations

from typing import Any

from luna_workstation.domain import (
    CompiledThesis,
    CompiledThesisSection,
    ThesisArtifactStatus,
    ThesisCandidate,
    ThesisTextSource,
    ThesisValidationResult,
    research_item_texts,
)

COMPILER_VERSION = "thesis_compiler.v1"


class ThesisCompiler:
    """Compile validated thesis fields into user-facing text."""

    def compile(
        self,
        *,
        candidate: ThesisCandidate | None,
        validation: ThesisValidationResult,
        confidence: float | None = None,
    ) -> CompiledThesis:
        if validation.status == ThesisArtifactStatus.BLOCKED:
            return self._diagnostic(validation)
        if candidate is None:
            return self._missing()

        rendered_confidence = _capped_confidence(
            confidence if confidence is not None else candidate.confidence,
            validation.confidence_cap,
        )
        sections: list[CompiledThesisSection] = []
        omitted_sections: list[str] = []

        _append_section(
            sections,
            key="stance",
            title="Stance",
            text=_stance_text(candidate, rendered_confidence),
            source_fields=[
                "candidate.rating",
                "candidate.direction",
                "candidate.confidence",
                "candidate.market_type",
            ],
        )
        _append_section(
            sections,
            key="thesis",
            title="Thesis",
            text=_join_sentences(candidate.action_summary, candidate.investment_thesis),
            source_fields=[
                "candidate.action_summary",
                "candidate.investment_thesis",
            ],
        )
        _append_list_section(
            sections,
            omitted_sections,
            key="key_reasons",
            title="Key reasons",
            items=research_item_texts(candidate.key_reasons),
            source_fields=["candidate.key_reasons"],
        )
        _append_list_section(
            sections,
            omitted_sections,
            key="risks",
            title="Risks",
            items=research_item_texts(candidate.risks),
            source_fields=["candidate.risks"],
        )
        _append_section(
            sections,
            key="confirmation",
            title="Confirmation",
            text=candidate.confirmation_condition,
            source_fields=["candidate.confirmation_condition"],
            omitted_sections=omitted_sections,
        )
        _append_section(
            sections,
            key="invalidation",
            title="Invalidation",
            text=candidate.invalidation,
            source_fields=["candidate.invalidation"],
            omitted_sections=omitted_sections,
        )
        _append_list_section(
            sections,
            omitted_sections,
            key="monitor_next",
            title="Monitor next",
            items=research_item_texts(candidate.monitor_next),
            source_fields=["candidate.monitor_next"],
        )

        caveats = _dedupe(
            [
                *validation.degradation_reasons,
                *candidate.missing_data,
            ]
        )
        if validation.status == ThesisArtifactStatus.DEGRADED and caveats:
            _append_list_section(
                sections,
                omitted_sections,
                key="data_caveats",
                title="Data caveats",
                items=caveats,
                source_fields=[
                    "validation.degradation_reasons",
                    "candidate.missing_data",
                ],
            )

        return CompiledThesis(
            text=_render_sections(sections),
            source=ThesisTextSource.COMPILED,
            sections=sections,
            omitted_sections=omitted_sections,
            caveats=caveats if validation.status == ThesisArtifactStatus.DEGRADED else [],
            compiler_version=COMPILER_VERSION,
        )

    def _diagnostic(self, validation: ThesisValidationResult) -> CompiledThesis:
        reasons = _dedupe([*validation.blocked_reasons, *validation.degradation_reasons])
        lines = ["Thesis blocked."]
        if reasons:
            lines.extend(["Reasons:", *[f"- {reason}" for reason in reasons]])
        return CompiledThesis(
            text="\n".join(lines),
            source=ThesisTextSource.DIAGNOSTIC,
            sections=[],
            omitted_sections=[],
            caveats=reasons,
            compiler_version=COMPILER_VERSION,
        )

    def _missing(self) -> CompiledThesis:
        return CompiledThesis(
            text="Thesis text missing.",
            source=ThesisTextSource.MISSING,
            sections=[],
            omitted_sections=[],
            caveats=["structured_candidate_missing"],
            compiler_version=COMPILER_VERSION,
        )


def _append_section(
    sections: list[CompiledThesisSection],
    *,
    key: str,
    title: str,
    text: str,
    source_fields: list[str],
    omitted_sections: list[str] | None = None,
) -> None:
    clean = _clean_text(text)
    if not clean:
        if omitted_sections is not None:
            omitted_sections.append(key)
        return
    sections.append(
        CompiledThesisSection(
            key=key,
            title=title,
            text=clean,
            source_fields=source_fields,
        )
    )


def _append_list_section(
    sections: list[CompiledThesisSection],
    omitted_sections: list[str],
    *,
    key: str,
    title: str,
    items: list[Any],
    source_fields: list[str],
) -> None:
    cleaned = _dedupe([_clean_text(item) for item in items])
    if not cleaned:
        omitted_sections.append(key)
        return
    sections.append(
        CompiledThesisSection(
            key=key,
            title=title,
            text="\n".join(f"- {item}" for item in cleaned),
            source_fields=source_fields,
        )
    )


def _render_sections(sections: list[CompiledThesisSection]) -> str:
    blocks: list[str] = []
    for section in sections:
        if section.text.startswith("- "):
            blocks.append(f"{section.title}:\n{section.text}")
        else:
            blocks.append(f"{section.title}: {section.text}")
    return "\n\n".join(blocks)


def _stance_text(candidate: ThesisCandidate, confidence: float | None) -> str:
    parts = [candidate.rating, candidate.direction]
    if confidence is not None:
        parts.append(f"confidence {confidence:.2f}")
    if candidate.market_type:
        parts.append(f"market {candidate.market_type}")
    return " / ".join(_clean_text(part) for part in parts if _clean_text(part))


def _capped_confidence(
    confidence: float | None,
    confidence_cap: float | None,
) -> float | None:
    if confidence is None:
        return confidence_cap
    if confidence_cap is None:
        return confidence
    return min(confidence, confidence_cap)


def _join_sentences(*values: str) -> str:
    return " ".join(_clean_text(value) for value in values if _clean_text(value))


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _dedupe(values: list[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _clean_text(value)
        if text and text not in seen:
            result.append(text)
            seen.add(text)
    return result
