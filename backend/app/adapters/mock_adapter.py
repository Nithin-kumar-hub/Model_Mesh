"""Deterministic mock adapters for testing routing and failover.

Seven behaviours covering the full error taxonomy. Each adapter produces
predictable, labelled MOCK output — never presented as real provider data.
"""

from __future__ import annotations

import time

from app.domain import (
    ProviderTimeoutError,
    ProviderUnavailableError,
    QuotaExhaustedError,
    RateLimitedError,
    Usage,
)

from .protocol import AdapterResult, ProviderAdapter


class MockFastAdapter(ProviderAdapter):
    """Fast, cheap responses. Low quality."""

    def execute(self, *, model_id: str, prompt: str, **kw: object) -> AdapterResult:
        return AdapterResult(
            output_text=f"MOCK [fast]: Response to: {prompt[:80]}...",
            usage=Usage(input_tokens=len(prompt) // 4, output_tokens=50, total_tokens=len(prompt) // 4 + 50),
            latency_ms=15.0,
            is_mock=True,
        )


class MockQualityAdapter(ProviderAdapter):
    """Slower, higher quality responses."""

    def execute(self, *, model_id: str, prompt: str, **kw: object) -> AdapterResult:
        return AdapterResult(
            output_text=f"MOCK [quality]: Detailed response to: {prompt[:80]}...",
            usage=Usage(input_tokens=len(prompt) // 4, output_tokens=200, total_tokens=len(prompt) // 4 + 200),
            latency_ms=150.0,
            is_mock=True,
        )


class MockCodeAdapter(ProviderAdapter):
    """Code-specialised responses."""

    def execute(self, *, model_id: str, prompt: str, **kw: object) -> AdapterResult:
        return AdapterResult(
            output_text=f"MOCK [code]:\n```python\n# Solution for: {prompt[:60]}\ndef solution():\n    pass\n```",
            usage=Usage(input_tokens=len(prompt) // 3, output_tokens=100, total_tokens=len(prompt) // 3 + 100),
            latency_ms=40.0,
            is_mock=True,
        )


class MockRateLimitedAdapter(ProviderAdapter):
    """Always returns a rate-limited error."""

    def execute(self, *, model_id: str, prompt: str, **kw: object) -> AdapterResult:
        raise RateLimitedError("MOCK: Rate limited", details={"provider": "mock_rate_limited"})


class MockExhaustedAdapter(ProviderAdapter):
    """Always returns a quota-exhausted error."""

    def execute(self, *, model_id: str, prompt: str, **kw: object) -> AdapterResult:
        raise QuotaExhaustedError("MOCK: Quota exhausted", details={"provider": "mock_exhausted"})


class MockTimeoutAdapter(ProviderAdapter):
    """Always returns a timeout error."""

    def execute(self, *, model_id: str, prompt: str, **kw: object) -> AdapterResult:
        raise ProviderTimeoutError("MOCK: Timed out", details={"provider": "mock_timeout"})


class MockUnavailableAdapter(ProviderAdapter):
    """Always returns an unavailable error."""

    def execute(self, *, model_id: str, prompt: str, **kw: object) -> AdapterResult:
        raise ProviderUnavailableError("MOCK: Provider unavailable", details={"provider": "mock_unavailable"})


# Registry of mock adapters keyed by provider_id
MOCK_ADAPTERS: dict[str, ProviderAdapter] = {
    "mock_fast": MockFastAdapter(),
    "mock_quality": MockQualityAdapter(),
    "mock_code": MockCodeAdapter(),
    "mock_rate_limited": MockRateLimitedAdapter(),
    "mock_exhausted": MockExhaustedAdapter(),
    "mock_timeout": MockTimeoutAdapter(),
    "mock_unavailable": MockUnavailableAdapter(),
}
