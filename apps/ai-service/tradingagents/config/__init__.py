"""Config loading + schema validation + provider registry + secrets."""

from .loader import load_config_file, ConfigLoader
from .providers import (
    PROVIDER_REGISTRY,
    KNOWN_PROVIDERS,
    get_provider_defaults,
    get_provider_env_vars,
)
from .schema import validate_and_normalize_config
from .secrets import SecretsManager, get_default_secrets

__all__ = [
    "ConfigLoader",
    "KNOWN_PROVIDERS",
    "PROVIDER_REGISTRY",
    "SecretsManager",
    "get_default_secrets",
    "get_provider_defaults",
    "get_provider_env_vars",
    "load_config_file",
    "validate_and_normalize_config",
]
