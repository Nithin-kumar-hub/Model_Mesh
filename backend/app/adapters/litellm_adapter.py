"""LiteLLM-based real provider adapter.

Supports Groq and OpenRouter through LiteLLM's unified interface. LiteLLM
is imported lazily at call time so the module can be loaded even when LiteLLM
is not installed (tests/sandbox).

Error normalisation maps LiteLLM/HTTP exceptions → canonical ModelMesh errors.
"""

from __future__ import annotations

import os
import time
from typing import Any

from app.domain import (
    ErrorCode,
    HealthStatus,
    ModelMeshError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    QuotaExhaustedError,
    RateLimitedError,
    Usage,
)

from .protocol import AdapterResult, ProviderAdapter


def _normalize_error(exc: Exception) -> ModelMeshError:
    """Convert a LiteLLM/HTTP exception to a canonical ModelMesh error."""
    msg = str(exc).lower()

    if "context" in msg and ("large" in msg or "length" in msg or "exceed" in msg or "too long" in msg):
        from app.domain import ContextTooLargeError
        return ContextTooLargeError(f"Context too large: {exc}")
    if "rate" in msg and "limit" in msg:
        return RateLimitedError(f"Rate limited: {exc}")
    if "quota" in msg or "insufficient" in msg or ("exceed" in msg and "quota" in msg):
        return QuotaExhaustedError(f"Quota exhausted: {exc}")
    if "timeout" in msg or "timed out" in msg:
        return ProviderTimeoutError(f"Timeout: {exc}")
    if "invalid" in msg and "key" in msg:
        from app.domain import InvalidKeyError
        return InvalidKeyError(f"Invalid key: {exc}")
    if "401" in msg or "403" in msg:
        from app.domain import InvalidKeyError
        return InvalidKeyError(f"Authentication failed: {exc}")

    return ProviderUnavailableError(f"Provider error: {exc}")


class LiteLLMAdapter(ProviderAdapter):
    """Real provider adapter using LiteLLM as the unified transport layer."""

    def __init__(self, provider_id: str) -> None:
        self.provider_id = provider_id

    def execute(
        self,
        *,
        model_id: str,
        prompt: str,
        key_env_var: str | None = None,
        max_tokens: int | None = None,
        timeout_s: float = 30.0,
    ) -> AdapterResult:
        try:
            import litellm  # lazy import
        except ImportError:
            raise ProviderUnavailableError(
                "LiteLLM is not installed. Install with: pip install litellm"
            )

        # Resolve the API key from the environment variable
        api_key: str | None = None
        if key_env_var:
            api_key = os.environ.get(key_env_var)
            if not api_key:
                from app.domain import InvalidKeyError
                raise InvalidKeyError(f"Environment variable '{key_env_var}' is not set or empty")

        start = time.perf_counter()
        try:
            response = litellm.completion(
                model=model_id,
                messages=[{"role": "user", "content": prompt}],
                api_key=api_key,
                max_tokens=max_tokens or 2048,
                timeout=timeout_s,
            )
        except Exception as exc:
            raise _normalize_error(exc) from exc

        elapsed_ms = (time.perf_counter() - start) * 1000

        # Extract response
        output_text = response.choices[0].message.content or ""

        # Extract usage (real data from provider)
        usage_data = getattr(response, "usage", None)
        if usage_data:
            usage = Usage(
                input_tokens=getattr(usage_data, "prompt_tokens", 0),
                output_tokens=getattr(usage_data, "completion_tokens", 0),
                total_tokens=getattr(usage_data, "total_tokens", 0),
                is_estimate=False,  # Real data from provider
            )
        else:
            usage = Usage(
                input_tokens=len(prompt) // 4,
                output_tokens=len(output_text) // 4,
                total_tokens=(len(prompt) + len(output_text)) // 4,
                is_estimate=True,
            )

        return AdapterResult(
            output_text=output_text,
            usage=usage,
            latency_ms=round(elapsed_ms, 1),
            is_mock=False,
        )
