"""Provider and model metadata (normalised, provider-agnostic).

The router operates ONLY on these normalised types — never on provider-specific
request/response shapes (those live in ``app.adapters``). Registry data (M5)
populates these; here we define only the shape.

No fabrication:
- ``quality_prior`` is a CONFIGURED routing prior in [0,1] (a tier), NOT a
  measured benchmark. It is tunable, not a claim of fact.
- Cost fields are published list prices where known (source recorded in the
  registry file), and ``None`` when unknown or for mock providers.
- ``est_latency_ms_per_1k_tokens`` is a rough prior that telemetry can refine;
  ``None`` means unknown. We never present it as a measured SLA.
- Mock providers set ``is_mock=True``; their numbers are illustrative MOCK values.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .enums import HealthStatus, Modality


@dataclass(frozen=True)
class ModelSpec:
    """Capabilities and routing priors for a single model."""

    id: str  # provider-local model id, e.g. "llama-3.3-70b-versatile"
    provider_id: str
    display_name: str
    modalities: frozenset[Modality]
    context_window: int  # max total tokens (input + output) the model accepts
    max_output_tokens: int

    # Routing priors (all configured, not benchmarks). 0.0 - 1.0.
    quality_prior: float = 0.5
    reliability_prior: float = 0.9

    # Cost (published list price, USD per 1K tokens) — None if unknown/mock.
    cost_per_1k_input_usd: float | None = None
    cost_per_1k_output_usd: float | None = None

    # Rough latency prior (ms per 1K tokens), refined by telemetry. None = unknown.
    est_latency_ms_per_1k_tokens: float | None = None

    # Free-form capability tags used by the classifier/filter, e.g. {"code", "reasoning"}.
    capabilities: frozenset[str] = field(default_factory=frozenset)

    # Real-adapter routing id for LiteLLM (e.g. "groq/llama-3.3-70b-versatile").
    litellm_id: str | None = None
    is_mock: bool = True

    @property
    def ref(self) -> str:
        """Stable "provider/model" reference used in logs, routes, telemetry."""
        return f"{self.provider_id}/{self.id}"

    def supports_modality(self, modality: Modality) -> bool:
        return modality in self.modalities

    def fits_context(self, required_tokens: int) -> bool:
        return required_tokens <= self.context_window


@dataclass(frozen=True)
class Provider:
    """A provider and its models (normalised metadata from the registry)."""

    id: str  # e.g. "groq", "openrouter", "mock_fast"
    display_name: str
    models: tuple[ModelSpec, ...]
    is_mock: bool = True
    # Name of the env var holding this provider's API key (None for pure mocks).
    env_key_name: str | None = None
    # Static default; live health is tracked per key by the key manager.
    default_health: HealthStatus = HealthStatus.HEALTHY

    def model(self, model_id: str) -> ModelSpec | None:
        for m in self.models:
            if m.id == model_id:
                return m
        return None
