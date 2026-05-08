"""Load config documents from YAML/TOML files with schema validation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    import tomli as tomllib

from tradingagents.config.schema import validate_and_normalize_config
from tradingagents.exceptions import ConfigurationError


def load_config_file(path: str | Path, *, validate: bool = False) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.exists():
        raise ConfigurationError(f"Config file not found: {file_path}")

    suffix = file_path.suffix.lower()
    with open(file_path, "rb") as fh:
        if suffix in {".yaml", ".yml"}:
            content = yaml.safe_load(fh.read().decode("utf-8")) or {}
        elif suffix == ".toml":
            content = tomllib.loads(fh.read().decode("utf-8")) or {}
        else:
            raise ConfigurationError(
                f"Unsupported config format {suffix!r}; use .yaml/.yml or .toml"
            )

    if not isinstance(content, dict):
        raise ConfigurationError(f"Config document must be a mapping: {file_path}")

    if validate:
        return validate_and_normalize_config(content, source=str(file_path))
    return content

