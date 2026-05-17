from typer.testing import CliRunner

from cli import watch_cmd
from tradingagents.domain import (
    AlertType,
    MarketSnapshot,
    ResearchRun,
    Scenario,
    ScenarioProbabilityBand,
    ThesisDirection,
    TradeThesis,
    WatchlistItem,
    WatchlistItemType,
)
from tradingagents.services import JournalService, WatchlistService


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }


def _workspace_config(tmp_path, workspace_id):
    config = _config(tmp_path)
    config["_engine"] = {"workspace_id": workspace_id}
    return config


def test_watchlist_service_adds_lists_and_removes_items(tmp_path):
    service = WatchlistService(_config(tmp_path))

    symbol_item = service.add_symbol("BTC/USDT")
    duplicate_symbol = service.add_symbol("btc/usdt")
    items = service.list_items(enabled_only=True)
    removed = service.remove_item(symbol_item.id)

    assert symbol_item.id.startswith("watch_item_")
    assert duplicate_symbol.id == symbol_item.id
    assert len(items) == 1
    assert items[0].symbol == "BTC/USDT"
    assert items[0].item_type == WatchlistItemType.SYMBOL
    assert removed.enabled is False
    assert service.list_items(enabled_only=True) == []


def test_watchlist_service_reuses_existing_thesis_track(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    service = WatchlistService(config)
    thesis = journal.save_thesis(
        TradeThesis(
            symbol="BTC/USDT",
            direction=ThesisDirection.WATCH,
            thesis_text="Watch reclaim confirmation.",
        )
    )

    first = service.add_thesis(thesis.id)
    second = service.add_thesis(thesis.id)

    assert second.id == first.id
    assert len(service.list_items(enabled_only=True)) == 1


def test_watchlist_check_creates_invalidation_alert_and_timeline_event(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    watchlists = WatchlistService(config)
    run = journal.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Bullish continuation if support holds.",
            invalidation_level="Lose 103800",
            target_zones=["110000"],
        )
    )
    item = watchlists.add_thesis(thesis.id)

    result = watchlists.check_once(current_prices={"BTC/USDT": 103700.0})
    duplicate = watchlists.check_once(current_prices={"BTC/USDT": 103600.0})
    alerts = watchlists.list_alerts(thesis_id=thesis.id)
    timeline = journal.list_timeline_events(thesis_id=thesis.id)

    assert item.thesis_id == thesis.id
    assert len(result.alerts_created) == 1
    assert duplicate.alerts_created == []
    assert alerts[0].alert_type == AlertType.THESIS_INVALIDATED
    assert "Review thesis" in alerts[0].message
    assert any(event.event_type == "thesis_invalidated" for event in timeline)


def test_watchlist_check_honors_invalidation_cues_for_avoid_thesis(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    watchlists = WatchlistService(config)
    run = journal.start_research_run(ResearchRun(symbol="BNB/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BNB/USDT",
            direction=ThesisDirection.AVOID,
            thesis_text="Avoid until resistance clears.",
            invalidation_level=(
                "Break above $638 with increasing volume and RSI sustained above 50."
            ),
        )
    )
    watchlists.add_thesis(thesis.id)

    before_break = watchlists.check_once(current_prices={"BNB/USDT": 637.0})
    after_break = watchlists.check_once(current_prices={"BNB/USDT": 650.0})

    assert before_break.alerts_created == []
    assert len(after_break.alerts_created) == 1
    assert after_break.alerts_created[0].alert_type == AlertType.THESIS_INVALIDATED


def test_watchlist_check_uses_latest_market_snapshot(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    watchlists = WatchlistService(config)
    run = journal.start_research_run(ResearchRun(symbol="ETH/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="ETH/USDT",
            direction=ThesisDirection.SHORT,
            thesis_text="Bearish continuation if resistance holds.",
            invalidation_level="Break above 3800",
        )
    )
    journal.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol="ETH/USDT",
            current_price=3810.0,
        )
    )
    watchlists.add_thesis(thesis.id)

    result = watchlists.check_once()

    assert len(result.alerts_created) == 1
    assert result.alerts_created[0].alert_type == AlertType.THESIS_INVALIDATED


def test_watchlist_check_creates_scenario_activation_alert_once(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    watchlists = WatchlistService(config)
    run = journal.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Bullish continuation if resistance reclaim holds.",
        )
    )
    saved_scenarios = journal.save_scenarios(
        [
            Scenario(
                thesis_id=thesis.id,
                condition="If BTC reclaims 110000 with improving participation.",
                expected_market_behavior="Bullish continuation becomes more likely.",
                probability_band=ScenarioProbabilityBand.MEDIUM,
                invalidation="Invalid if reclaim fails.",
                risk_map=["Funding can overheat."],
                suggested_user_action="review long thesis",
            )
        ]
    )
    watchlists.add_thesis(thesis.id)

    result = watchlists.check_once(current_prices={"BTC/USDT": 110100.0})
    duplicate = watchlists.check_once(current_prices={"BTC/USDT": 110200.0})
    alerts = watchlists.list_alerts(thesis_id=thesis.id)
    timeline = journal.list_timeline_events(thesis_id=thesis.id)

    assert len(result.alerts_created) == 1
    assert duplicate.alerts_created == []
    assert alerts[0].alert_type == AlertType.SCENARIO_ACTIVATED
    assert alerts[0].payload["scenario_id"] == saved_scenarios[0].id
    assert any(event.event_type == "scenario_activated" for event in timeline)


def test_watchlist_items_and_alerts_are_workspace_scoped(tmp_path):
    config_a = _workspace_config(tmp_path, "workspace_a")
    config_b = _workspace_config(tmp_path, "workspace_b")
    journal_a = JournalService(config_a)
    journal_b = JournalService(config_b)
    watchlists_a = WatchlistService(config_a)
    watchlists_b = WatchlistService(config_b)

    run_a = journal_a.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis_a = journal_a.save_thesis(
        TradeThesis(
            research_run_id=run_a.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Workspace A thesis.",
            invalidation_level="Lose 100",
        )
    )
    run_b = journal_b.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis_b = journal_b.save_thesis(
        TradeThesis(
            research_run_id=run_b.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Workspace B thesis.",
            invalidation_level="Lose 100",
        )
    )
    watchlists_a.add_thesis(thesis_a.id)
    watchlists_b.add_thesis(thesis_b.id)

    watchlists_a.check_once(current_prices={"BTC/USDT": 90.0})

    assert [item.workspace_id for item in watchlists_a.list_items()] == ["workspace_a"]
    assert [item.workspace_id for item in watchlists_b.list_items()] == ["workspace_b"]
    assert [alert.workspace_id for alert in watchlists_a.list_alerts()] == [
        "workspace_a"
    ]
    assert watchlists_b.list_alerts() == []
    assert watchlists_b.mark_alert_read(watchlists_a.list_alerts()[0].id) is None


def test_watchlist_brief_scopes_theses_scenarios_and_alerts(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    watchlists = WatchlistService(config)
    run = journal.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            confidence=0.7,
            thesis_text="Bullish continuation if resistance reclaim holds.",
            invalidation_level="Lose 103800",
        )
    )
    scenario = journal.save_scenario(
        Scenario(
            thesis_id=thesis.id,
            condition="If BTC reclaims 110000 with improving participation.",
            expected_market_behavior="Bullish continuation becomes more likely.",
            probability_band=ScenarioProbabilityBand.MEDIUM,
            suggested_user_action="review long thesis",
        )
    )
    journal.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol="BTC/USDT",
            current_price=110100.0,
        )
    )
    watchlists.add_symbol("SOL/USDT")
    watchlists.add_thesis(thesis.id)
    watchlist = watchlists.get_or_create_watchlist()
    watchlists.repo.save_watchlist_item(
        WatchlistItem(
            workspace_id=watchlists.workspace_id,
            watchlist_id=watchlist.id,
            item_type=WatchlistItemType.THESIS,
            symbol=thesis.symbol,
            thesis_id=thesis.id,
            setup_type=thesis.setup_type,
        )
    )
    watchlists.check_once(current_prices={"BTC/USDT": 110100.0})

    other_thesis = journal.save_thesis(
        TradeThesis(
            symbol="ETH/USDT",
            direction=ThesisDirection.SHORT,
            thesis_text="Separate watchlist thesis.",
        )
    )
    watchlists.add_thesis(other_thesis.id, watchlist_name="other")

    brief = watchlists.build_brief(evaluate_snapshots=True)

    assert brief.watchlist_name == "default"
    assert brief.item_count == 2
    assert brief.thesis_count == 1
    assert brief.symbol_only_items[0].symbol == "SOL/USDT"
    assert brief.theses[0].thesis_id == thesis.id
    assert brief.theses[0].last_price == 110100.0
    assert brief.scenarios[0].scenario_id == scenario.id
    assert brief.scenarios[0].activated is True
    assert brief.scenarios[0].snapshot_active is True
    assert all(alert.thesis_id == thesis.id for alert in brief.alerts)


def test_watchlist_brief_batches_thesis_snapshot_and_scenario_reads(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    watchlists = WatchlistService(config)

    for idx in range(5):
        symbol = f"BTC{idx}/USDT"
        run = journal.start_research_run(ResearchRun(symbol=symbol))
        thesis = journal.save_thesis(
            TradeThesis(
                research_run_id=run.id,
                symbol=symbol,
                direction=ThesisDirection.LONG,
                thesis_text="Bullish continuation if resistance reclaim holds.",
                target_zones=["110000"],
            )
        )
        journal.save_market_snapshot(
            MarketSnapshot(
                research_run_id=run.id,
                symbol=symbol,
                current_price=110100.0 + idx,
            )
        )
        journal.save_scenario(
            Scenario(
                thesis_id=thesis.id,
                condition="If resistance reclaims 110000.",
                expected_market_behavior="Bullish continuation becomes more likely.",
                probability_band=ScenarioProbabilityBand.MEDIUM,
                suggested_user_action="review long thesis",
            )
        )
        watchlists.add_thesis(thesis.id)

    reads: list[tuple[str, str]] = []
    original_fetchone = watchlists.store.fetchone
    original_fetchall = watchlists.store.fetchall

    def counting_fetchone(sql, params=()):
        reads.append(("one", sql))
        return original_fetchone(sql, params)

    def counting_fetchall(sql, params=()):
        reads.append(("all", sql))
        return original_fetchall(sql, params)

    watchlists.store.fetchone = counting_fetchone
    watchlists.store.fetchall = counting_fetchall

    brief = watchlists.build_brief(evaluate_snapshots=True)

    assert len(brief.theses) == 5
    assert len(brief.scenarios) == 5
    assert len(reads) <= 6
    assert sum("FROM trade_theses" in sql for _, sql in reads) == 1
    assert sum("FROM market_snapshots" in sql for _, sql in reads) == 1
    assert sum("FROM scenarios" in sql for _, sql in reads) == 1


def test_watchlist_cli_add_symbol_and_list(tmp_path, monkeypatch):
    service = WatchlistService(_config(tmp_path))
    monkeypatch.setattr(watch_cmd, "_service", lambda: service)
    runner = CliRunner()

    add_result = runner.invoke(watch_cmd.app, ["add-symbol", "SOL/USDT"])
    list_result = runner.invoke(watch_cmd.app, ["list"])

    assert add_result.exit_code == 0
    assert list_result.exit_code == 0
    assert "SOL/USDT" in list_result.output


def test_watchlist_cli_brief_renders_summary(tmp_path, monkeypatch):
    config = _config(tmp_path)
    journal = JournalService(config)
    service = WatchlistService(config)
    thesis = journal.save_thesis(
        TradeThesis(
            symbol="BTC/USDT",
            direction=ThesisDirection.WATCH,
            thesis_text="Watch reclaim confirmation.",
        )
    )
    service.add_symbol("SOL/USDT")
    service.add_thesis(thesis.id)
    monkeypatch.setattr(watch_cmd, "_service", lambda: service)
    runner = CliRunner()

    result = runner.invoke(watch_cmd.app, ["brief"])

    assert result.exit_code == 0
    assert "Watchlist Brief" in result.output
    assert "BTC/USDT" in result.output
    assert "SOL/USDT" in result.output
