from luna_workstation.domain import (
    ThesisArtifactStatus,
    ThesisCandidate,
    ThesisValidationIssue,
    ThesisValidationResult,
    ThesisValidationSeverity,
)
from luna_workstation.graph.thesis_compiler import ThesisCompiler, ThesisTextSource


def _candidate(**overrides):
    payload = {
        "schema_version": "thesis_candidate.v1",
        "rating": "Overweight",
        "direction": "long",
        "confidence": 0.72,
        "market_type": "spot",
        "action_summary": "Favor BTC while reclaim holds",
        "investment_thesis": "Spot bid and trend structure support a conditional long thesis.",
        "confirmation_condition": "Daily close above 108000 with expanding spot volume",
        "invalidation": "Daily close below 101500",
        "entry_zone": "103000-105000 pullback",
        "target_zones": ["112000", "118000"],
        "key_reasons": [
            {
                "text": "Spot demand improved after reclaiming the prior range.",
                "supporting_evidence": [
                    {
                        "text": "Observed spot volume expanded on the reclaim.",
                        "evidence_kind": "observed",
                        "source_artifact": "signal_snapshot",
                    }
                ],
            },
            "Higher-timeframe structure remains constructive.",
        ],
        "risks": [
            "Failed acceptance above resistance would weaken the setup.",
        ],
        "monitor_next": [
            "Watch the daily close and spot volume confirmation.",
        ],
        "supporting_evidence": [
            {
                "text": "Observed spot volume expanded on the reclaim.",
                "evidence_kind": "observed",
                "source_artifact": "signal_snapshot",
            }
        ],
        "missing_data": [],
    }
    payload.update(overrides)
    return ThesisCandidate.model_validate(payload)


def _validation(
    status=ThesisArtifactStatus.VALID,
    *,
    degradation_reasons=None,
    blocked_reasons=None,
    confidence_cap=None,
):
    issues = [
        ThesisValidationIssue(
            code=reason,
            severity=(
                ThesisValidationSeverity.BLOCKER
                if status == ThesisArtifactStatus.BLOCKED
                else ThesisValidationSeverity.WARNING
            ),
            message=reason,
            source="thesis_validator",
        )
        for reason in [*(degradation_reasons or []), *(blocked_reasons or [])]
    ]
    return ThesisValidationResult(
        status=status,
        issues=issues,
        degradation_reasons=degradation_reasons or [],
        blocked_reasons=blocked_reasons or [],
        confidence_cap=confidence_cap,
    )


def test_compiler_renders_stable_sections_from_valid_candidate():
    compiler = ThesisCompiler()
    candidate = _candidate()
    result = compiler.compile(candidate=candidate, validation=_validation())

    repeated = compiler.compile(candidate=candidate, validation=_validation())

    assert result.text == repeated.text
    assert result.source == ThesisTextSource.COMPILED
    assert result.compiler_version
    assert [section.key for section in result.sections] == [
        "stance",
        "thesis",
        "key_reasons",
        "risks",
        "confirmation",
        "invalidation",
        "monitor_next",
    ]
    assert "Stance:" in result.text
    assert "Overweight" in result.text
    assert "confidence 0.72" in result.text
    assert "Key reasons:" in result.text
    assert "Daily close above 108000" in result.text
    assert (
        result.sections[4].source_fields
        == ["candidate.confirmation_condition"]
    )
    assert result.omitted_sections == []
    assert result.caveats == []


def test_compiler_includes_status_caveats_for_degraded_candidate():
    result = ThesisCompiler().compile(
        candidate=_candidate(),
        validation=_validation(
            ThesisArtifactStatus.DEGRADED,
            degradation_reasons=[
                "supporting_evidence_reasoning_only",
                "data_quality_degraded",
            ],
            confidence_cap=0.45,
        ),
    )

    assert result.source == ThesisTextSource.COMPILED
    assert "confidence 0.45" in result.text
    assert "Data caveats:" in result.text
    assert "supporting_evidence_reasoning_only" in result.text
    assert "data_quality_degraded" in result.text
    assert result.sections[-1].key == "data_caveats"
    assert result.caveats == [
        "supporting_evidence_reasoning_only",
        "data_quality_degraded",
    ]


def test_compiler_omits_empty_optional_sections_without_prose_fallback():
    result = ThesisCompiler().compile(
        candidate=_candidate(key_reasons=[], monitor_next=[]),
        validation=_validation(),
    )

    assert [section.key for section in result.sections] == [
        "stance",
        "thesis",
        "risks",
        "confirmation",
        "invalidation",
    ]
    assert result.omitted_sections == ["key_reasons", "monitor_next"]
    assert "Key reasons:" not in result.text
    assert "Monitor next:" not in result.text


def test_blocked_candidate_compiles_diagnostic_text_only():
    result = ThesisCompiler().compile(
        candidate=_candidate(),
        validation=_validation(
            ThesisArtifactStatus.BLOCKED,
            blocked_reasons=[
                "confirmation_condition_missing",
                "structured_candidate_missing",
            ],
        ),
    )

    assert result.source == ThesisTextSource.DIAGNOSTIC
    assert result.sections == []
    assert "Thesis blocked." in result.text
    assert "confirmation_condition_missing" in result.text
    assert "structured_candidate_missing" in result.text
    assert "Key reasons:" not in result.text
