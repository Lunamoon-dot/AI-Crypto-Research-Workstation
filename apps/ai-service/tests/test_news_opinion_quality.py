from luna_workstation.domain import AgentStance
from luna_workstation.graph.opinions import opinion_from_text


def test_news_opinion_uses_context_quality_reason_codes():
    text = """
    ===== PRE-COMPUTED NEWS CONTEXT =====
    Instrument: ARB/USDT
    Quality: insufficient_data (0.10)
    Missing/degraded data:
    - insufficient_news_evidence
    - missing_primary_source_news
    ===== END NEWS CONTEXT =====
    """

    opinion = opinion_from_text(
        "News Analyst",
        text,
        research_run_id="run_1",
        role="news_analyst",
        source_report_type="news",
    )

    assert opinion is not None
    assert opinion.stance == AgentStance.UNCERTAIN
    assert opinion.data_quality_label == "insufficient_data"
    assert opinion.data_quality <= 0.25
    assert "insufficient_news_evidence" in opinion.reason_codes
    assert "missing_primary_source_news" in opinion.reason_codes


def test_news_opinion_accepts_clean_primary_source_context():
    text = """
    ===== PRE-COMPUTED NEWS CONTEXT =====
    Instrument: ARB/USDT
    Quality: clean (0.86)
    Top catalysts:
    - Arbitrum DAO proposal passed, source Arbitrum Forum, category governance, relevance high
    Confirmed Primary-Source Items:
    - Title: Arbitrum DAO proposal passed
      URL: https://forum.arbitrum.foundation/t/proposal-1
      Published: 2026-05-30T12:00:00Z
    ===== END NEWS CONTEXT =====
    """

    opinion = opinion_from_text(
        "News Analyst",
        text,
        research_run_id="run_1",
        role="news_analyst",
        source_report_type="news",
    )

    assert opinion is not None
    assert opinion.data_quality_label == "clean"
    assert opinion.data_quality >= 0.75
    assert "missing_news_feed" not in opinion.reason_codes


def test_sentiment_missing_social_feed_does_not_emit_missing_news_feed():
    opinion = opinion_from_text(
        "Sentiment Analyst",
        "\n".join(
            [
                "Quality: insufficient_data",
                "Missing/degraded data:",
                "- missing_social_feed",
            ]
        ),
        research_run_id="run_1",
        role="sentiment_analyst",
        source_report_type="sentiment",
    )

    assert opinion is not None
    assert "missing_social_feed" in opinion.reason_codes
    assert "missing_news_feed" not in opinion.reason_codes
    assert opinion.data_quality_label == "insufficient_data"


def test_sentiment_missing_data_filters_generic_headers_and_news_delegation():
    opinion = opinion_from_text(
        "Sentiment Analyst",
        "\n".join(
            [
                "**Missing Evidence**",
                "`missing_news_feed` - delegated to News Analyst",
                "**Missing Data**:",
                "No strong high-confidence directional signal can be derived from "
                "the sentiment/social data alone due to missing news feed and low "
                "headline count",
            ]
        ),
        research_run_id="run_1",
        role="sentiment_analyst",
        source_report_type="sentiment",
    )

    assert opinion is not None
    assert opinion.reason_codes == ["missing_social_feed"]
    assert opinion.missing_data == ["missing_social_feed"]
