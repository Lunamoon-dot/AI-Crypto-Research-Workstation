from luna_workstation.agents.schemas import ScenarioHorizon, ScenarioItem, ScenarioPlan
from luna_workstation.domain import ResearchRun, ThesisDirection, TradeThesis
from luna_workstation.graph.journal_bridge import (
    JournalBridge,
    _parse_scenario_plan,
    _split_list_section,
    scenarios_from_structured_plan,
)


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }


def test_journal_bridge_completes_run(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="Bullish continuation if reclaim holds.",
        confidence=0.65,
    )

    run, thesis = bridge.complete_run(run, thesis)

    assert run is not None
    assert thesis is not None
    assert run.thesis_id == thesis.id


def test_journal_bridge_records_risk_debate_timeline_event(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))

    run, opinions, debate = bridge.save_agent_research(
        run,
        {
            "market_report": "Bullish market structure.",
            "sentiment_report": "",
            "news_report": "",
            "fundamentals_report": "",
            "investment_debate_state": {
                "bull_history": "Bullish because momentum improved.",
                "bear_history": "Bearish risk is funding.",
                "judge_decision": "Watch for confirmation.",
            },
            "trader_investment_plan": "Review long thesis.",
            "risk_debate_state": {
                "aggressive_history": "Upside if reclaim holds.",
                "neutral_history": "Wait for confirmation.",
                "conservative_history": "Protect against downside.",
                "history": "Risk debate history.",
                "judge_decision": "Review thesis only after confirmation.",
            },
            "final_trade_decision": "Hold",
        },
        None,
    )

    assert run is not None
    assert opinions
    assert debate is not None
    timeline = bridge.service.list_timeline_events(research_run_id=run.id)
    assert any(event.event_type == "risk.debate.recorded" for event in timeline)


def test_journal_bridge_saves_scenarios_from_json_plan(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="Bullish continuation if reclaim holds.",
        confidence=0.65,
    )
    plan = ScenarioPlan(
        setup_type="breakout",
        scenarios=[
            ScenarioItem(
                scenario_name="Upside Breakout Confirmation",
                direction="bullish risk",
                thesis_impact="medium",
                condition="Break above 108k with volume.",
                expected_behavior="Continuation toward prior highs.",
                evidence=["Volume: expanding"],
                watch_triggers=["Break above 108k", "Volume expands"],
                impact_on_thesis="Supports the bullish thesis if follow-through holds.",
                probability_band="medium",
                invalidation="Close back below 103k.",
                risk_factors=["Crowded funding"],
                suggested_action="review",
                as_of="2026-05-31",
                timeframe="1D",
                source=["market_report"],
            ),
        ],
    )
    run, thesis = bridge.complete_run(
        run,
        thesis,
        scenario_plan_json=plan.model_dump_json(),
    )
    assert thesis and thesis.id
    scenarios = bridge.service.list_scenarios(thesis_id=thesis.id)
    assert len(scenarios) == 1
    assert scenarios[0].thesis_id == thesis.id
    assert scenarios[0].condition.startswith("Break above")


def test_journal_bridge_falls_back_when_scenario_plan_is_unparseable(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.SHORT,
        thesis_text="Avoid longs while downside trend dominates.",
        confidence=0.35,
        invalidation_level="Daily close above 73500.",
    )

    run, thesis = bridge.complete_run(
        run,
        thesis,
        scenario_plan_text="Scenario Planner completed but returned malformed prose.",
    )

    assert thesis and thesis.id
    scenarios = bridge.service.list_scenarios(thesis_id=thesis.id)
    assert len(scenarios) >= 3
    assert all(scenario.thesis_id == thesis.id for scenario in scenarios)
    events = bridge.service.list_timeline_events(research_run_id=run.id)
    assert any(event.event_type == "scenario.plan.degraded" for event in events)


def test_scenarios_from_structured_plan_maps_probability():
    plan = ScenarioPlan(
        setup_type="agent_debate",
        scenarios=[
            ScenarioItem(
                scenario_name="Test Scenario",
                direction="neutral",
                thesis_impact="low",
                condition="c",
                expected_behavior="b",
                evidence=["e"],
                watch_triggers=["w"],
                impact_on_thesis="impact",
                probability_band="HIGH",
                invalidation="i",
                risk_factors=["r"],
                suggested_action="watch",
                as_of="2026-05-31",
                timeframe="1D",
                source=["test"],
            ),
        ],
    )
    rows = scenarios_from_structured_plan(plan, "thesis_x")
    assert len(rows) == 1
    assert rows[0].thesis_id == "thesis_x"
    assert rows[0].probability_band.value == "high"


def test_scenarios_from_structured_plan_preserves_horizon_payload():
    plan = ScenarioPlan(
        setup_type="agent_debate",
        scenarios=[
            ScenarioItem(
                horizon=ScenarioHorizon.MID_TERM,
                timeframe_label="1-3w",
                scenario_name="Catalyst follow-through",
                direction="bullish risk",
                thesis_impact="medium",
                condition="Catalyst path confirms over several sessions.",
                expected_behavior="Thesis follow-through improves.",
                evidence=["Catalyst: pending"],
                watch_triggers=["Catalyst confirms"],
                impact_on_thesis="Strengthens the medium-term thesis.",
                probability_band="medium",
                invalidation="Invalid if catalyst fails.",
                risk_factors=["Catalyst delay"],
                suggested_action="watch",
                as_of="2026-06-10",
                timeframe="1D",
                source=["market_report"],
            ),
        ],
    )

    rows = scenarios_from_structured_plan(plan, "thesis_x")

    assert rows[0].horizon == "mid_term"
    assert rows[0].timeframe_label == "1-3w"
    assert rows[0].template_metadata["horizon"] == "mid_term"
    assert rows[0].template_metadata["timeframe_label"] == "1-3w"


def test_scenarios_from_structured_plan_preserves_recommendation_payload():
    recommendation = {
        "version": "scenario_recommendation.v1",
        "generated_at": "2026-06-27T00:00:00.000Z",
        "source": "llm",
        "action": "consider_long",
        "action_bias": "long",
        "confidence": 0.74,
        "summary": "Consider long only after reclaim confirmation.",
        "thesis_link": "Supports the current bullish thesis if reclaim holds.",
        "required_conditions": [],
        "invalidation_conditions": [],
        "wait_for": ["4h close above resistance"],
        "hard_gates": [
            {
                "id": "fresh_market_data",
                "label": "Fresh market data",
                "status": "pending",
                "reason": "Waiting for current candle close.",
            }
        ],
        "blocking_reasons": ["No close confirmation yet."],
        "risk_notes": ["Failed reclaim can trap breakout entries."],
        "evidence_refs": [],
        "valid_until": "2026-06-30T00:00:00.000Z",
        "evaluation_readiness": "ready",
        "evaluation_window": {
            "starts_at": "2026-06-27T00:00:00.000Z",
            "ends_at": "2026-06-30T00:00:00.000Z",
            "horizon": "short_term",
            "metric_hint": "trigger_then_mfe_mae",
        },
    }
    plan = ScenarioPlan(
        setup_type="agent_debate",
        scenarios=[
            ScenarioItem(
                horizon=ScenarioHorizon.SHORT_TERM,
                timeframe_label="24-72h",
                scenario_name="Reclaim confirmation",
                direction="bullish risk",
                thesis_impact="medium",
                condition="Reclaim resistance on 4h close.",
                expected_behavior="Continuation if reclaim holds.",
                evidence=["Resistance: 620"],
                watch_triggers=["4h close above resistance"],
                impact_on_thesis="Supports the current bullish thesis if reclaim holds.",
                probability_band="medium",
                invalidation="Invalid below support.",
                risk_factors=["Failed reclaim can trap breakout entries."],
                suggested_action="wait",
                as_of="2026-06-27",
                timeframe="4H",
                source=["market_report"],
                scenario_recommendation=recommendation,
            ),
        ],
    )

    rows = scenarios_from_structured_plan(plan, "thesis_x")

    assert rows[0].scenario_recommendation == recommendation


def test_scenarios_from_structured_plan_extracts_as_of_from_timeframe():
    plan = ScenarioPlan(
        setup_type="agent_debate",
        scenarios=[
            ScenarioItem(
                scenario_name="Short squeeze",
                direction="bullish risk",
                thesis_impact="low",
                condition="RSI is deeply oversold.",
                expected_behavior="Fast bounce if shorts cover.",
                evidence=[],
                watch_triggers=[],
                impact_on_thesis="",
                probability_band="low",
                invalidation="No bounce.",
                risk_factors=[],
                suggested_action="watch",
                as_of="",
                timeframe="Intraday / 1H-4H (as_of: 2026-06-08).",
                source=["Market report ngay 2026-06-08."],
            ),
        ],
    )

    rows = scenarios_from_structured_plan(plan, "thesis_x")

    assert rows[0].as_of == "2026-06-08"
    assert rows[0].timeframe == "Intraday / 1H-4H"
    assert rows[0].source == ["Market report ngay 2026-06-08."]


def test_parse_scenario_plan_extracts_vietnamese_source_timeframe_block():
    text = """
### Scenario 1: Sụp Đổ Tiếp Diễn

**Condition**: Long/Short ratio stays crowded.
**Expected Behavior**: Price continues lower.
**Probability**: Medium
**Invalidation**: Price reclaims resistance.
**Suggested Action**: Reassess — đánh giá lại danh mục.
Source, timeframe, as_of
Báo cáo phân tích tín hiệu định lượng (market_analyst, 2026-06-08); kế hoạch đầu tư.
Khung thời gian ưu tiên: daily cho xu hướng chính, 1h cho điểm phá vỡ.
"""

    rows = _parse_scenario_plan(text, "thesis_x")

    assert len(rows) == 1
    assert rows[0].suggested_user_action == "Reassess — đánh giá lại danh mục."
    assert rows[0].as_of == "2026-06-08"
    assert rows[0].timeframe == "daily cho xu hướng chính, 1h cho điểm phá vỡ"
    assert rows[0].source == [
        "Báo cáo phân tích tín hiệu định lượng (market_analyst, 2026-06-08); kế hoạch đầu tư"
    ]


def test_parse_scenario_plan_preserves_horizon_metadata():
    text = """
### Scenario 1: Breakout confirmation

**Horizon**: short_term
**Horizon Window**: 24-72h
**Condition**: BTC reclaims resistance with improving volume.
**Expected Behavior**: Price expands toward the next liquidity zone.
**Probability**: Medium
**Suggested Action**: Watch confirmation.

---

### Scenario 2: Trend continuation

**Condition**: Weekly structure holds above support.
**Expected Behavior**: Follow-through improves over several sessions.
**Probability**: Medium
**Suggested Action**: Watch thesis.

---

### Scenario 3: Structural repricing

**Condition**: Monthly liquidity regime turns supportive.
**Expected Behavior**: Thesis quality improves over the next cycle.
**Probability**: Low
**Suggested Action**: Review allocation.
"""

    rows = _parse_scenario_plan(text, "thesis_x")

    assert len(rows) == 3
    assert rows[0].horizon == "short_term"
    assert rows[0].timeframe_label == "24-72h"
    assert rows[1].horizon == "mid_term"
    assert rows[1].timeframe_label == "1-3w"
    assert rows[2].horizon == "long_term"
    assert rows[2].timeframe_label == "1-3m"


def test_scenarios_from_structured_plan_enforces_horizon_contract_limit():
    plan = ScenarioPlan(
        setup_type="agent_debate",
        scenarios=[
            ScenarioItem(
                scenario_name=f"Scenario {index}",
                direction="neutral",
                thesis_impact="low",
                condition=f"Condition {index}",
                expected_behavior=f"Behavior {index}",
                evidence=[f"Evidence {index}"],
                watch_triggers=[f"Watch {index}"],
                impact_on_thesis=f"Impact {index}",
                probability_band="medium",
                invalidation=f"Invalidation {index}",
                risk_factors=[f"Risk {index}"],
                suggested_action="watch",
                as_of="2026-05-31",
                timeframe="1D",
                source=["test"],
            )
            for index in range(1, 7)
        ],
    )

    rows = scenarios_from_structured_plan(plan, "thesis_x")

    assert len(rows) == 3
    assert [row.scenario_name for row in rows] == [
        "Scenario 1",
        "Scenario 2",
        "Scenario 3",
    ]


def test_parse_scenario_plan_handles_markdown_headings_without_truncation():
    text = """
Intro text that should not become a scenario.

### Scenario 1: Breakout Catalyst

**Setup Type**: `news_event`

**Key Market Conditions & Catalysts**
- Price breaks above $2,400 with rising volume.
- MACD crosses bullish and ADX rises above 20.
- Social sentiment improves from low attention to moderately positive
  while market breadth confirms that the move is not a single-candle fakeout.

**Probability Assessment**
- **30%** - Catalyst path is possible but not the base case.

**Impact on Investment Thesis**
- HOLD becomes a BUY candidate after confirmation.

**Recommended Response**
- **Review** - Re-run quant and wait for a retest before changing sizing.

---

### Scenario 2: Range Reversion

**Setup Type**: `range_reversion`

**Key Market Conditions & Catalysts**
- Price remains between $2,100 and $2,400 with low volume.
- Support at $2,100 holds after a wick rejection.

**Probability Assessment**
- **45%** - Most likely while volatility stays muted.

**Impact on Investment Thesis**
- HOLD remains unchanged.

**Recommended Response**
- **Watch** - Maintain alerts at both range edges.
"""

    rows = _parse_scenario_plan(text, "thesis_x")

    assert len(rows) == 2
    assert rows[0].thesis_id == "thesis_x"
    assert rows[0].probability_band.value == "low"
    assert rows[1].probability_band.value == "medium"
    assert "Price breaks above $2,400" in rows[0].condition
    assert "ADX rises above 20" in rows[0].condition
    assert rows[0].expected_market_behavior == (
        "HOLD becomes a BUY candidate after confirmation."
    )
    assert rows[0].suggested_user_action.startswith("Review")
    assert len(rows[0].condition) > 120
    assert rows[0].expected_market_behavior != rows[0].condition


def test_parse_scenario_plan_ignores_combined_decision_card_headings():
    text = """
### Scenario 1: Bearish Continuation with Liquidity Sweep

**Key Market Conditions and Catalysts**
- Price has already fallen 20% from the May 30-31 spike.
- Weekly bearish trend remains dominant.

**Probability Assessment**
- 45% - Liquidation path remains possible.

**Evidence Chips & Watch Triggers**

**Watch**
- Price closes below $570 with above-average volume.
- Open interest drops sharply, confirming liquidation cascade.

**Impact on Thesis**
- Reinforces the Underweight stance.

**Action Watch:** - Do not add longs. If holding, reassess risk exposure.

**Source & Timeframe**
Source: Market Report & Investment Plan.
Timeframe: Short-term (1-2 weeks)
as_of: 2026-06-04
"""

    rows = _parse_scenario_plan(text, "thesis_x")

    assert len(rows) == 1
    row = rows[0]
    assert row.scenario_name == "Bearish Continuation with Liquidity Sweep"
    assert row.condition.startswith("Price has already fallen")
    assert "and Catalysts" not in row.condition
    assert row.evidence == []
    assert row.watch_triggers == [
        "Price closes below $570 with above-average volume.",
        "Open interest drops sharply, confirming liquidation cascade.",
    ]
    assert row.suggested_user_action == (
        "Do not add longs. If holding, reassess risk exposure."
    )
    assert row.source == ["Market Report & Investment Plan."]
    assert row.timeframe == "Short-term (1-2 weeks)"
    assert row.as_of == "2026-06-04"


def test_parse_scenario_plan_extracts_source_timeframe_as_of_from_legacy_action():
    text = """
### Scenario 1: Breakout reclaim

**Condition**: BNB/USDT reclaims 620 on a daily close.
**Expected Behavior**: Continuation toward 650.
**Probability**: Medium
**Evidence**: RSI recovered from oversold.
**Watch Triggers**: Daily close above 620.
**Suggested Action**: Watch for confirmation. Source, timeframe, and as_of: Quant market report dated 2026-06-05, Weekly.
"""

    scenarios = _parse_scenario_plan(text, "thesis_1")

    assert len(scenarios) == 1
    assert scenarios[0].suggested_user_action == "Watch for confirmation."
    assert scenarios[0].as_of == "2026-06-05"
    assert scenarios[0].timeframe == "Weekly"
    assert scenarios[0].source == ["Quant market report dated 2026-06-05, Weekly"]


def test_parse_scenario_plan_handles_vietnamese_fallback_markdown():
    text = """
### Kịch bản 1: Phá vỡ tăng được xác nhận

**Điều kiện thị trường**
- BTC đóng cửa trên 108k với khối lượng cải thiện.
- Funding không tăng quá nóng.

**Xác suất**
- Trung bình - cần xác nhận thêm từ thanh khoản.

**Tác động lên luận điểm**
- Làm suy yếu quan điểm tránh mua mới và buộc xem xét lại.

**Hành động đề xuất**
- Review - chạy lại phân tích nếu đóng cửa ngày giữ trên 108k.

**Rủi ro**
- Breakout giả nếu giá quay lại dưới 105k.

**Nguồn**
- market_report

---

### Kịch bản 2: Vô hiệu xu hướng hồi phục

**Điều kiện thị trường**
- Giá mất vùng 103k và OI giảm nhanh.

**Xác suất**
- Thấp - chỉ kích hoạt nếu áp lực bán mở rộng.

**Tác động lên luận điểm**
- Củng cố trạng thái underweight.

**Hành động đề xuất**
- Watch - không tăng rủi ro cho đến khi có cân bằng mới.
"""

    rows = _parse_scenario_plan(text, "thesis_vi")

    assert len(rows) == 2
    assert rows[0].scenario_name == "Phá vỡ tăng được xác nhận"
    assert rows[0].condition.startswith("BTC đóng cửa trên 108k")
    assert rows[0].probability_band.value == "medium"
    assert rows[0].suggested_user_action.startswith("Review")
    assert rows[0].risk_map == ["Breakout giả nếu giá quay lại dưới 105k."]
    assert rows[1].probability_band.value == "low"


def test_split_list_section_preserves_price_commas():
    items = _split_list_section(
        "Price remains between $60,500 and $66,000.\nVolume declining."
    )

    assert items == [
        "Price remains between $60,500 and $66,000.",
        "Volume declining.",
    ]
