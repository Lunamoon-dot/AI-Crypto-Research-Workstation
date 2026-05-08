"""Configuration profile management — YAML/TOML load with deep merge."""

from __future__ import annotations

import logging
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.config.loader import load_config_file
from tradingagents.config.schema import validate_and_normalize_config

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


def _resolve_profile_file(name: str) -> Path | None:
    """Return the first existing profile file for *name* (.yaml/.yml/.toml)."""
    base = name.replace("/", "_").replace("\\", "_").replace("..", "_")
    candidates = [
        _profiles_dir() / f"{base}.yaml",
        _profiles_dir() / f"{base}.yml",
        _profiles_dir() / f"{base}.toml",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


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
    path = _resolve_profile_file(name) or _profile_path(name)
    if not path.exists():
        logger.warning("Profile %r not found at %s — using defaults.", name, path)
        return deepcopy(DEFAULT_CONFIG)

    overrides = load_config_file(path, validate=False)

    merged = _deep_merge(DEFAULT_CONFIG, overrides)
    return validate_and_normalize_config(merged, source=f"profile:{name}")


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
    """Return sorted profile names (deduped across .yaml/.yml/.toml)."""
    names = set()
    for ext in ("*.yaml", "*.yml", "*.toml"):
        for path in _profiles_dir().glob(ext):
            names.add(path.stem)
    return sorted(names)


def delete_profile(name: str) -> bool:
    """Delete a named profile. Returns True if it existed."""
    removed = False
    for ext in (".yaml", ".yml", ".toml"):
        path = _profiles_dir() / f"{name}{ext}"
        if path.exists():
            path.unlink()
            removed = True
    return removed


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
        file_overrides = load_config_file(config_path, validate=False)
        config = _deep_merge(config, file_overrides)
    elif profile:
        config = load_profile(profile)

    if cli_overrides:
        config = _deep_merge(config, cli_overrides)

    source = f"config_path:{config_path}" if config_path else (f"profile:{profile}" if profile else "defaults")
    return validate_and_normalize_config(config, source=source)
