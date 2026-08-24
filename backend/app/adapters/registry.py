"""Adapter registry — maps provider_id → ProviderAdapter instance."""

from __future__ import annotations

from .litellm_adapter import LiteLLMAdapter
from .mock_adapter import MOCK_ADAPTERS
from .protocol import ProviderAdapter


def get_adapter(provider_id: str) -> ProviderAdapter:
    """Return the adapter for the given provider.

    Mock providers get deterministic mock adapters; real providers get a
    LiteLLM-based adapter.
    """
    mock = MOCK_ADAPTERS.get(provider_id)
    if mock is not None:
        return mock
    return LiteLLMAdapter(provider_id)
