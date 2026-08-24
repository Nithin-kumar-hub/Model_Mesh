"""Provider adapter protocol and result type.

All provider-specific HTTP/auth/request/response behaviour lives inside
adapter implementations. The execution engine calls only this protocol.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.domain import HealthStatus, Usage


@dataclass(frozen=True)
class AdapterResult:
    """Normalised result from a provider adapter execution."""

    output_text: str
    usage: Usage
    latency_ms: float
    is_mock: bool = True


class ProviderAdapter(ABC):
    """Abstract provider adapter contract."""

    @abstractmethod
    def execute(
        self,
        *,
        model_id: str,
        prompt: str,
        key_env_var: str | None = None,
        max_tokens: int | None = None,
        timeout_s: float = 30.0,
    ) -> AdapterResult:
        """Execute a prompt against the provider.

        Raises ``ModelMeshError`` subclasses on failure (normalised errors).
        """

    def health(self) -> HealthStatus:
        """Return the current health of this provider."""
        return HealthStatus.HEALTHY
