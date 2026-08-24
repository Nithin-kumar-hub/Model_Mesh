"""Provider registry — the single lookup point for provider/model metadata.

The router, filter, and scorer query this registry. It is initialised from the
static catalog in ``data.py`` and optionally extended at runtime (Phase 2 may
add dynamic providers or NPU-backed local models).
"""

from __future__ import annotations

from app.domain import Modality, ModelSpec, Provider

from .data import ALL_PROVIDERS, MOCK_PROVIDERS, REAL_PROVIDERS


class ProviderRegistry:
    """In-memory provider/model registry."""

    def __init__(self, providers: tuple[Provider, ...] | None = None) -> None:
        self._providers: dict[str, Provider] = {}
        for p in (providers or ALL_PROVIDERS):
            self._providers[p.id] = p

    # -- Queries -----------------------------------------------------------

    def all_providers(self) -> list[Provider]:
        return list(self._providers.values())

    def mock_providers(self) -> list[Provider]:
        return [p for p in self._providers.values() if p.is_mock]

    def real_providers(self) -> list[Provider]:
        return [p for p in self._providers.values() if not p.is_mock]

    def get_provider(self, provider_id: str) -> Provider | None:
        return self._providers.get(provider_id)

    def all_models(self) -> list[ModelSpec]:
        return [m for p in self._providers.values() for m in p.models]

    def get_model(self, provider_id: str, model_id: str) -> ModelSpec | None:
        p = self._providers.get(provider_id)
        return p.model(model_id) if p else None

    def models_for_modality(self, modality: Modality) -> list[tuple[Provider, ModelSpec]]:
        """Return all (provider, model) pairs that support the given modality."""
        result = []
        for p in self._providers.values():
            for m in p.models:
                if m.supports_modality(modality):
                    result.append((p, m))
        return result

    # -- Mutation (for runtime extension) ----------------------------------

    def register_provider(self, provider: Provider) -> None:
        """Add or replace a provider at runtime."""
        self._providers[provider.id] = provider

    def remove_provider(self, provider_id: str) -> bool:
        return self._providers.pop(provider_id, None) is not None
