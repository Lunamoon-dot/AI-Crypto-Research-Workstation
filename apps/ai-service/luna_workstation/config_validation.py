"""Backward-compatible shim for moved config schema module."""

from luna_workstation.config.schema import validate_and_normalize_config

__all__ = ["validate_and_normalize_config"]
