from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "luna_workstation" / "agents"


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_portfolio_manager_keeps_tables_out_of_trade_thesis_json():
    source = _read("managers/portfolio_manager.py")

    assert "Do not put Markdown tables" in source
    assert "inside TRADE_THESIS_JSON string fields" in source
    assert "key_reasons" in source
    assert "supporting_evidence" in source


def test_portfolio_manager_trade_thesis_json_includes_plan_boundaries():
    source = _read("managers/portfolio_manager.py")

    assert '"entry_zone"' in source
    assert '"target_zones"' in source


def test_structured_pm_schema_discourages_pipe_rows_in_list_items():
    source = _read("schemas.py")

    assert "Markdown tables" in source
    assert "pipe-delimited rows inside list item text" in source


def test_analyst_table_prompts_require_valid_markdown_pipe_tables():
    for relative_path in (
        "analysts/market_analyst.py",
        "analysts/social_media_analyst.py",
        "analysts/onchain_analyst.py",
    ):
        source = _read(relative_path)
        assert "valid Markdown pipe table" in source
        assert "`|---|---|`" in source
