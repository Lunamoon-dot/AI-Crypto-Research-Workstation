from luna_workstation.agents.analysts.onchain_analyst import _ONCHAIN_SYSTEM_CONTENT
from luna_workstation.agents.analysts.social_media_analyst import _SOCIAL_SYSTEM_CONTENT


def test_social_prompt_keeps_fear_greed_macro_only_and_samples_weak():
    assert "Fear & Greed is market-wide" in _SOCIAL_SYSTEM_CONTENT
    assert "project-news coverage" in _SOCIAL_SYSTEM_CONTENT
    assert "News Analyst" in _SOCIAL_SYSTEM_CONTENT
    assert "missing_social_feed" in _SOCIAL_SYSTEM_CONTENT
    assert "missing_news_feed" in _SOCIAL_SYSTEM_CONTENT


def test_onchain_prompt_forbids_proxy_overclaiming():
    assert "CCXT/CoinGecko proxies" in _ONCHAIN_SYSTEM_CONTENT
    assert "not true network transaction NVT" in _ONCHAIN_SYSTEM_CONTENT
    assert "low turnover" in _ONCHAIN_SYSTEM_CONTENT
    assert "weak participation" in _ONCHAIN_SYSTEM_CONTENT
    assert "never describe burns as minting" in _ONCHAIN_SYSTEM_CONTENT
    assert "not a standalone entry signal" in _ONCHAIN_SYSTEM_CONTENT
