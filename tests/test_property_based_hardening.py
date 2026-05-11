import tomllib

import pytest

hypothesis = pytest.importorskip("hypothesis")
st = pytest.importorskip("hypothesis.strategies")

from cli.config_cmd import _write_toml_section
from tradingagents.utils.collections import dedupe, deep_merge
from tradingagents.utils.numbers import extract_numbers


simple_key = st.text(
    alphabet=list("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"),
    min_size=1,
    max_size=12,
).filter(lambda s: any(ch.isalnum() for ch in s))

scalar = st.one_of(
    st.text(max_size=30),
    st.booleans(),
    st.integers(min_value=-1000, max_value=1000),
    st.floats(allow_nan=False, allow_infinity=False, width=32),
)


@hypothesis.settings(suppress_health_check=[hypothesis.HealthCheck.too_slow])
@hypothesis.given(st.dictionaries(simple_key, scalar, max_size=8))
def test_toml_writer_round_trips_scalar_dicts(data):
    lines = []
    _write_toml_section(lines, data, 0)
    parsed = tomllib.loads("\n".join(lines) + "\n")

    for key, value in data.items():
        if isinstance(value, float):
            assert parsed[key] == pytest.approx(value)
        else:
            assert parsed[key] == value


@hypothesis.given(st.lists(st.text(min_size=1, max_size=12), max_size=20))
def test_dedupe_keeps_first_seen_case_insensitive_order(values):
    result = dedupe(values)
    lowered = [value.lower() for value in result]

    assert len(lowered) == len(set(lowered))
    for value in result:
        assert values.index(value) == min(
            idx
            for idx, candidate in enumerate(values)
            if candidate.lower() == value.lower()
        )


@hypothesis.given(
    st.dictionaries(simple_key, scalar, max_size=5),
    st.dictionaries(simple_key, scalar, max_size=5),
)
def test_deep_merge_does_not_mutate_inputs(base, override):
    base_copy = dict(base)
    override_copy = dict(override)
    merged = deep_merge(base, override)

    assert base == base_copy
    assert override == override_copy
    for key, value in override.items():
        assert merged[key] == value


@hypothesis.given(st.integers(min_value=-1_000_000, max_value=1_000_000))
def test_extract_numbers_parses_plain_integer_text(value):
    text = f"level={value} stop"

    assert extract_numbers(text) == [float(value)]
