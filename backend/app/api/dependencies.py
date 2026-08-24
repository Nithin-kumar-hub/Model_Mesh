"""FastAPI dependency injection and singleton container.

Initializes the core services once and provides them cleanly to API route controllers.
"""

from __future__ import annotations

from functools import lru_cache

from app.classifier import ClassifierProtocol, RuleBasedClassifier
from app.config import Settings, get_settings
from app.domain import ApiKey, KeyStatus, Modality
from app.execution import ExecutionConfig, ExecutionEngine
from app.keys import KeyManager
from app.registry import ProviderRegistry
from app.routing import Router
from app.telemetry import TelemetryStore


class ServiceContainer:
    """Holds shared singleton instances of backend core components."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.registry = ProviderRegistry()
        self.key_manager = KeyManager()
        self.classifier: ClassifierProtocol = RuleBasedClassifier()
        self.router = Router(self.registry)
        self.telemetry = TelemetryStore()
        self.executor = ExecutionEngine(
            self.key_manager,
            ExecutionConfig(
                max_retries=settings.max_retries,
                request_timeout_s=settings.request_timeout_s,
            ),
        )

        # Register configured real keys if present
        if settings.groq_api_key:
            self.key_manager.register_key(
                ApiKey.from_secret(
                    provider_id="groq",
                    env_var="GROQ_API_KEY",
                    label="groq-primary",
                    secret=settings.groq_api_key,
                    priority=10,
                )
            )

        if settings.openrouter_api_key:
            self.key_manager.register_key(
                ApiKey.from_secret(
                    provider_id="openrouter",
                    env_var="OPENROUTER_API_KEY",
                    label="openrouter-primary",
                    secret=settings.openrouter_api_key,
                    priority=10,
                )
            )


@lru_cache
def get_container() -> ServiceContainer:
    """Return process-wide singleton service container."""
    return ServiceContainer(get_settings())
