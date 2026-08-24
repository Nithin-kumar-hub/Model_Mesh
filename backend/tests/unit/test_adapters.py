"""Unit tests for provider adapters (M7a)."""

from __future__ import annotations

import unittest

from app.adapters import (
    AdapterResult,
    MockCodeAdapter,
    MockExhaustedAdapter,
    MockFastAdapter,
    MockQualityAdapter,
    MockRateLimitedAdapter,
    MockTimeoutAdapter,
    MockUnavailableAdapter,
    ProviderAdapter,
    get_adapter,
)
from app.adapters.litellm_adapter import LiteLLMAdapter, _normalize_error
from app.domain import (
    ContextTooLargeError,
    ErrorCode,
    InvalidKeyError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    QuotaExhaustedError,
    RateLimitedError,
)


class TestMockAdapters(unittest.TestCase):
    def test_mock_fast(self) -> None:
        adapter = MockFastAdapter()
        self.assertIsInstance(adapter, ProviderAdapter)
        res = adapter.execute(model_id="fast-v1", prompt="hello world")
        self.assertIsInstance(res, AdapterResult)
        self.assertIn("MOCK [fast]", res.output_text)
        self.assertTrue(res.is_mock)
        self.assertGreater(res.usage.total_tokens, 0)
        self.assertGreater(res.latency_ms, 0)

    def test_mock_quality(self) -> None:
        adapter = MockQualityAdapter()
        res = adapter.execute(model_id="quality-v1", prompt="write an essay")
        self.assertIn("MOCK [quality]", res.output_text)
        self.assertTrue(res.is_mock)

    def test_mock_code(self) -> None:
        adapter = MockCodeAdapter()
        res = adapter.execute(model_id="code-v1", prompt="def add(a, b):")
        self.assertIn("```python", res.output_text)

    def test_mock_rate_limited_raises(self) -> None:
        adapter = MockRateLimitedAdapter()
        with self.assertRaises(RateLimitedError) as ctx:
            adapter.execute(model_id="limited-v1", prompt="test")
        self.assertEqual(ctx.exception.code, ErrorCode.RATE_LIMITED)

    def test_mock_exhausted_raises(self) -> None:
        adapter = MockExhaustedAdapter()
        with self.assertRaises(QuotaExhaustedError) as ctx:
            adapter.execute(model_id="exhausted-v1", prompt="test")
        self.assertEqual(ctx.exception.code, ErrorCode.QUOTA_EXHAUSTED)

    def test_mock_timeout_raises(self) -> None:
        adapter = MockTimeoutAdapter()
        with self.assertRaises(ProviderTimeoutError) as ctx:
            adapter.execute(model_id="timeout-v1", prompt="test")
        self.assertEqual(ctx.exception.code, ErrorCode.TIMEOUT)

    def test_mock_unavailable_raises(self) -> None:
        adapter = MockUnavailableAdapter()
        with self.assertRaises(ProviderUnavailableError) as ctx:
            adapter.execute(model_id="unavail-v1", prompt="test")
        self.assertEqual(ctx.exception.code, ErrorCode.PROVIDER_UNAVAILABLE)


class TestAdapterRegistry(unittest.TestCase):
    def test_get_mock_adapters(self) -> None:
        self.assertIsInstance(get_adapter("mock_fast"), MockFastAdapter)
        self.assertIsInstance(get_adapter("mock_quality"), MockQualityAdapter)
        self.assertIsInstance(get_adapter("mock_code"), MockCodeAdapter)
        self.assertIsInstance(get_adapter("mock_rate_limited"), MockRateLimitedAdapter)
        self.assertIsInstance(get_adapter("mock_exhausted"), MockExhaustedAdapter)
        self.assertIsInstance(get_adapter("mock_timeout"), MockTimeoutAdapter)
        self.assertIsInstance(get_adapter("mock_unavailable"), MockUnavailableAdapter)

    def test_get_real_adapter(self) -> None:
        adapter = get_adapter("groq")
        self.assertIsInstance(adapter, LiteLLMAdapter)
        self.assertEqual(adapter.provider_id, "groq")


class TestErrorNormalization(unittest.TestCase):
    def test_rate_limit_normalization(self) -> None:
        err = _normalize_error(Exception("Rate limit reached for requests per minute"))
        self.assertIsInstance(err, RateLimitedError)
        self.assertEqual(err.code, ErrorCode.RATE_LIMITED)

    def test_quota_normalization(self) -> None:
        err = _normalize_error(Exception("Insufficient quota for current plan"))
        self.assertIsInstance(err, QuotaExhaustedError)

    def test_timeout_normalization(self) -> None:
        err = _normalize_error(Exception("Connection timed out after 30s"))
        self.assertIsInstance(err, ProviderTimeoutError)

    def test_auth_normalization(self) -> None:
        err = _normalize_error(Exception("Invalid API key provided"))
        self.assertIsInstance(err, InvalidKeyError)

    def test_context_too_large(self) -> None:
        err = _normalize_error(Exception("Maximum context length exceeded"))
        self.assertIsInstance(err, ContextTooLargeError)

    def test_unknown_error_normalization(self) -> None:
        err = _normalize_error(Exception("Something strange happened"))
        self.assertIsInstance(err, ProviderUnavailableError)


if __name__ == "__main__":
    unittest.main()
