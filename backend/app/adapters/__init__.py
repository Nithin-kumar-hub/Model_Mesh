"""Provider adapters package."""

from __future__ import annotations

from .litellm_adapter import LiteLLMAdapter
from .mock_adapter import (
    MOCK_ADAPTERS,
    MockCodeAdapter,
    MockExhaustedAdapter,
    MockFastAdapter,
    MockQualityAdapter,
    MockRateLimitedAdapter,
    MockTimeoutAdapter,
    MockUnavailableAdapter,
)
from .protocol import AdapterResult, ProviderAdapter
from .registry import get_adapter

__all__ = [
    "ProviderAdapter",
    "AdapterResult",
    "get_adapter",
    "LiteLLMAdapter",
    "MOCK_ADAPTERS",
    "MockFastAdapter",
    "MockQualityAdapter",
    "MockCodeAdapter",
    "MockRateLimitedAdapter",
    "MockExhaustedAdapter",
    "MockTimeoutAdapter",
    "MockUnavailableAdapter",
]
