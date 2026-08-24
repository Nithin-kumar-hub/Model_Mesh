"""Application configuration (standard library only).

The core engine must not depend on any web framework or settings library, so
configuration is loaded here with the stdlib. Provider API keys are read from
the environment / an optional ``.env`` file and are NEVER logged or serialised.

Scoring weights and profiler parameters live in their own modules
(``app.routing.weights``, ``app.profiler.params``) so they remain configurable
without polluting this server/secrets settings object.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_TRUTHY = {"1", "true", "yes", "on"}


def _parse_env_file(path: Path) -> dict[str, str]:
    """Parse a minimal ``KEY=VALUE`` .env file. Ignores comments/blank lines."""
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            data[key] = value
    return data


def _load_dotenv(path: Path) -> None:
    """Load .env values into the process environment without overriding real env."""
    for key, value in _parse_env_file(path).items():
        os.environ.setdefault(key, value)


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in _TRUTHY


@dataclass(frozen=True)
class Settings:
    """Immutable runtime settings."""

    groq_api_key: str | None
    openrouter_api_key: str | None
    host: str
    port: int
    cors_origins: tuple[str, ...]
    request_timeout_s: float
    max_retries: int
    enable_real_providers: bool

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        cors = env.get("MODELMESH_CORS_ORIGINS", "http://localhost:5173,http://localhost:4173")
        return cls(
            groq_api_key=(env.get("GROQ_API_KEY") or None),
            openrouter_api_key=(env.get("OPENROUTER_API_KEY") or None),
            host=env.get("MODELMESH_HOST", "0.0.0.0"),
            port=int(env.get("MODELMESH_PORT", "8000")),
            cors_origins=tuple(o.strip() for o in cors.split(",") if o.strip()),
            request_timeout_s=float(env.get("MODELMESH_REQUEST_TIMEOUT_S", "30")),
            max_retries=int(env.get("MODELMESH_MAX_RETRIES", "2")),
            enable_real_providers=_as_bool(env.get("MODELMESH_ENABLE_REAL_PROVIDERS"), True),
        )

    def has_real_provider_keys(self) -> bool:
        """True if at least one real provider key is configured."""
        return bool(self.groq_api_key or self.openrouter_api_key)

    def real_provider_available(self) -> bool:
        """True only if real providers are enabled AND a key exists."""
        return self.enable_real_providers and self.has_real_provider_keys()


@lru_cache
def get_settings() -> Settings:
    """Return a process-wide cached Settings instance (loads .env once)."""
    _load_dotenv(_BACKEND_ROOT / ".env")
    return Settings.from_env(os.environ)
