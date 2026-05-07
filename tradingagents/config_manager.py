"""Configuration profile management — YAML save/load with deep merge.

Profiles are stored in ``~/.tradingagents/profiles/{name}.yaml`` and
contain only overrides relative to ``DEFAULT_CONFIG``, keeping them
short and readable.
"""

from __future__ import annotations

import logging
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

from tradingagents.default_config import DEFAULT_CONFIG

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Profile storage
# ---------------------------------------------------------------------------


def _profiles_dir() -> Path:
    """Ensure the profiles directory exists and return its path."""
    base = Path(os.path.expanduser("~/.tradingagents/profiles"))
    base.mkdir(parents=True, exist_ok=True)
    return base


def _profile_path(name: str) -> Path:
    safe = name.replace("/", "_").replace("\\", "_").replace("..", "_")
    if not safe.endswith(".yaml"):
        safe += ".yaml"
    return _profiles_dir() / safe


# ---------------------------------------------------------------------------
# Deep merge
# ---------------------------------------------------------------------------


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into *base*, returning a new dict."""
    result = deepcopy(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = deepcopy(val)
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_profile(name: str) -> dict:
    """Load a named profile and deep-merge it onto DEFAULT_CONFIG.

    Returns DEFAULT_CONFIG unchanged if the profile does not exist.
    """
    path = _profile_path(name)
    if not path.exists():
        logger.warning("Profile %r not found at %s — using defaults.", name, path)
        return deepcopy(DEFAULT_CONFIG)

    with open(path, "r", encoding="utf-8") as fh:
        overrides = yaml.safe_load(fh) or {}

    return _deep_merge(DEFAULT_CONFIG, overrides)


def save_profile(config: dict, name: str) -> Path:
    """Save *config* as a named profile (overrides only)."""
    # Strip keys whose values match DEFAULT_CONFIG to keep profiles slim
    overrides = {}
    for key, val in config.items():
        default_val = DEFAULT_CONFIG.get(key)
        if isinstance(val, dict) and isinstance(default_val, dict):
            diff = {k: v for k, v in val.items() if v != default_val.get(k)}
            if diff:
                overrides[key] = diff
        elif val != default_val:
            overrides[key] = val

    path = _profile_path(name)
    with open(path, "w", encoding="utf-8") as fh:
        yaml.safe_dump(overrides, fh, default_flow_style=False, sort_keys=False,
                       allow_unicode=True)
    logger.info("Saved profile %r → %s", name, path)
    return path


def list_profiles() -> list[str]:
    """Return sorted list of available profile names (without .yaml suffix)."""
    profiles = []
    for p in _profiles_dir().glob("*.yaml"):
        profiles.append(p.stem)
    return sorted(profiles)


def delete_profile(name: str) -> bool:
    """Delete a named profile. Returns True if it existed."""
    path = _profile_path(name)
    if path.exists():
        path.unlink()
        return True
    return False


def resolve_config(
    profile: str | None = None,
    config_path: str | None = None,
    cli_overrides: dict | None = None,
) -> dict:
    """Full resolution chain: DEFAULT → profile/config file → CLI overrides.

    Priority (highest last):
        1. DEFAULT_CONFIG
        2. Named profile OR explicit config file path
        3. CLI flag overrides
    """
    config = deepcopy(DEFAULT_CONFIG)

    if config_path:
        with open(config_path, "r", encoding="utf-8") as fh:
            file_overrides = yaml.safe_load(fh) or {}
        config = _deep_merge(config, file_overrides)
    elif profile:
        config = load_profile(profile)

    if cli_overrides:
        config = _deep_merge(config, cli_overrides)

    return config
