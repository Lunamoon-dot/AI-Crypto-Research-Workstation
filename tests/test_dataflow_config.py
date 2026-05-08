from concurrent.futures import ThreadPoolExecutor

from tradingagents.dataflows.config import config_context, get_config


def test_config_context_is_thread_isolated():
    def worker(vendor_name: str) -> str:
        cfg = {"data_vendors": {"crypto": vendor_name}}
        with config_context(cfg):
            return get_config()["data_vendors"]["crypto"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(worker, "vendor_a")
        b = pool.submit(worker, "vendor_b")

    assert a.result() == "vendor_a"
    assert b.result() == "vendor_b"


def test_get_config_returns_deep_copy():
    cfg = {"data_vendors": {"crypto": "original"}}
    with config_context(cfg):
        loaded = get_config()
        loaded["data_vendors"]["crypto"] = "mutated"
        assert get_config()["data_vendors"]["crypto"] == "original"
