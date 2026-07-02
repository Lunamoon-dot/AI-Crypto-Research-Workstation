import pytest

from luna_workstation.agents.utils.rating import DecisionConsistencyError
from luna_workstation.reporting.report_generator import ReportGenerator


def test_report_final_rating_uses_official_rating_label_only():
    report = ReportGenerator({})._executive_summary(
        "**Rating**: Underweight\n\nAvoid exposure unless flows improve."
    )

    assert "**Final Rating**: orange Underweight" in report


def test_report_final_rating_allows_counterfactual_rating_mentions():
    report = ReportGenerator({})._executive_summary(
        "**Rating**: Underweight\n\nCountercase: Overweight if flows recover."
    )

    assert "**Final Rating**: orange Underweight" in report


def test_report_final_rating_fails_on_opposing_rating_declarations():
    with pytest.raises(DecisionConsistencyError):
        ReportGenerator({})._executive_summary(
            "**Rating**: Underweight\n\n**Final Rating**: Overweight"
        )


def test_report_uses_canonical_thesis_over_raw_pm_text():
    report = ReportGenerator({}).generate_complete_report(
        {
            "company_of_interest": "BTC/USDT",
            "trade_date": "2026-05-15",
            "final_trade_decision": "**Rating**: Overweight\n\nRaw PM prose is stale.",
            "trade_thesis": {
                "direction": "avoid",
                "confidence": 0.22,
                "entry_zone": "No new longs",
                "confirmation_condition": "Acceptance back above $105000 with spot volume.",
                "invalidation_level": "Close above $110000",
                "target_zones": ["$95000"],
                "risk_notes": ["Quant confidence is low."],
                "structured_summary": {
                    "rating": "Underweight",
                    "direction": "avoid",
                    "confidence": 0.22,
                    "action_summary": "Avoid fresh longs until data improves.",
                    "entry_zone": "No new longs",
                    "confirmation_condition": "Acceptance back above $105000 with spot volume.",
                    "invalidation": "Close above $110000",
                    "target_zones": ["$95000"],
                    "risks": ["Quant confidence is low."],
                    "data_quality": 1.0,
                    "data_quality_label": "clean",
                    "is_degraded": False,
                },
            },
            "risk_debate_state": {
                "history": "",
                "judge_decision": "**Rating**: Overweight\n\nDo not render this.",
            },
        },
        include_charts=False,
    )

    assert "**Final Rating**: orange Underweight" in report
    assert "**Publication Mode**: Watch/risk memo" in report
    assert (
        "**Confirmation**: Acceptance back above $105000 with spot volume." in report
    )
    assert "**Rating**: Overweight" not in report


def test_report_does_not_render_blocked_thesis_as_customer_thesis():
    report = ReportGenerator({}).generate_complete_report(
        {
            "company_of_interest": "BNB/USDT",
            "trade_date": "2026-07-02",
            "final_trade_decision": "**Rating**: Overweight\n\nRaw PM prose is stale.",
            "trader_investment_plan": (
                "**Setup Stance**: Buy\n\n"
                "**Action**: place a limit order and vao lenh with stop-loss."
            ),
            "trade_thesis": {
                "artifact_status": "blocked",
                "thesis_text": (
                    "Thesis blocked.\n"
                    "Reasons:\n"
                    "- execution_instruction_detected"
                ),
                "blocked_reasons": ["execution_instruction_detected"],
                "direction": "long",
                "confidence": 0.72,
                "entry_zone": "$540-$545",
                "target_zones": ["$480", "$450", "$420"],
                "risk_notes": ["Do not render structured trading fields."],
                "structured_summary": {
                    "rating": "Overweight",
                    "direction": "long",
                    "confidence": 0.72,
                    "entry_zone": "$540-$545",
                    "target_zones": ["$480", "$450", "$420"],
                    "risks": ["Do not render structured trading fields."],
                },
            },
        },
        include_charts=False,
    )

    assert "Thesis blocked." in report
    assert "execution_instruction_detected" in report
    assert "**Rating**: Overweight" not in report
    assert "**Entry/Review Zone**: $540-$545" not in report
    assert "**Targets**: $480, $450, $420" not in report
    assert "place a limit order" not in report
    assert "vao lenh" not in report
    assert "final thesis artifact is blocked" in report


def test_report_labels_legacy_target_zones_as_unclassified_objectives():
    report = ReportGenerator({}).generate_complete_report(
        {
            "company_of_interest": "BNB/USDT",
            "trade_date": "2026-07-02",
            "quant_signal": "=== Quant Bias: BNB/USDT ===\nPrice: $532.65",
            "trade_thesis": {
                "artifact_status": "valid",
                "direction": "watch",
                "confidence": 0.30,
                "entry_zone": "$540-$545 review zone",
                "target_zones": ["$480", "$450", "$420"],
                "structured_summary": {
                    "rating": "Underweight",
                    "direction": "watch",
                    "confidence": 0.30,
                    "entry_zone": "$540-$545 review zone",
                    "target_zones": ["$480", "$450", "$420"],
                },
            },
        },
        include_charts=False,
    )

    assert "**Objective Zones (unclassified)**: $480, $450, $420" in report
    assert "**Targets**: $480, $450, $420" not in report


def test_report_flags_price_trigger_already_crossed():
    report = ReportGenerator({}).generate_complete_report(
        {
            "company_of_interest": "BNB/USDT",
            "trade_date": "2026-05-15",
            "quant_signal": "=== Quant Bias: BNB/USDT ===\nPrice: $682.00",
            "final_trade_decision": "**Rating**: Hold\n\nBreak above $638 with RSI confirmation.",
            "trader_investment_plan": "Review only on break above $638 with volume.",
            "scenario_plan": "",
        },
        include_charts=False,
    )

    assert "Price-Level Sanity Checks" in report
    assert "price-only above $638 has already occurred at current price $682" in report
    assert "require non-price confirmation" in report


def test_report_price_sanity_ignores_indicator_thresholds():
    report = ReportGenerator({}).generate_complete_report(
        {
            "company_of_interest": "BNB/USDT",
            "trade_date": "2026-07-02",
            "quant_signal": "=== Quant Bias: BNB/USDT ===\nPrice: $532.65",
            "scenario_plan": (
                "- Long/Short ratio tang tren 3.0\n"
                "- RSI 4H vuot len tren 50\n"
                "- RSI daily vuot len tren 40\n"
                "- Daily close duoi $540 voi volume cao"
            ),
        },
        include_charts=False,
    )

    assert "$3" not in report
    assert "$50" not in report
    assert "$40" not in report
    assert "price-only below $540" in report


def test_report_flags_vietnamese_price_trigger_already_crossed():
    report = ReportGenerator({}).generate_complete_report(
        {
            "company_of_interest": "ETH/USDT",
            "trade_date": "2026-06-08",
            "quant_signal": "=== Quant Bias: ETH/USDT ===\nPrice: $1,647.71",
            "final_trade_decision": (
                "**Rating**: Underweight\n\n"
                "Gi\u00e1 ti\u1ebfp t\u1ee5c gi\u1ea3m d\u01b0\u1edbi $3,000."
            ),
            "trader_investment_plan": "",
            "scenario_plan": "",
        },
        include_charts=False,
    )

    assert "Price-Level Sanity Checks" in report
    assert "price-only below $3,000 has already occurred" in report


def test_report_flags_stale_upside_reference_below_current_price():
    report = ReportGenerator({}).generate_complete_report(
        {
            "company_of_interest": "BNB/USDT",
            "trade_date": "2026-05-15",
            "quant_signal": "=== Quant Bias: BNB/USDT ===\nPrice: $682.00",
            "final_trade_decision": "**Rating**: Hold\n\nBreakout level: $638.",
            "trader_investment_plan": "Recent high $638 needs context.",
            "scenario_plan": "",
        },
        include_charts=False,
    )

    assert "breakout level $638 is below current price $682" in report
    assert "recent high $638 is below current price $682" in report
