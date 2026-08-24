"""Unit tests for the execution engine (M7b)."""

from __future__ import annotations

import unittest

from app.domain import (
    ApiKey,
    Classification,
    ClassificationSource,
    Complexity,
    ExecutionResult,
    ExecutionStatus,
    KeyStatus,
    Modality,
    Route,
    RoutePlan,
    Strategy,
    Task,
    TaskType,
    TokenRange,
    WorkloadProfile,
)
from app.execution import ExecutionConfig, ExecutionEngine
from app.keys import KeyManager


def _task(text: str = "Test prompt") -> Task:
    return Task(input_text=text, strategy=Strategy.BALANCED)


def _route(
    provider_id: str,
    model_id: str = "v1",
    rank: int = 1,
    score: float = 0.9,
    key_label: str | None = None,
) -> Route:
    return Route(
        provider_id=provider_id,
        model_id=model_id,
        model_ref=f"{provider_id}/{model_id}",
        key_label=key_label,
        score=score,
        rank=rank,
        reasons=("supports text",),
        is_mock=True,
    )


class TestExecutionEngine(unittest.TestCase):
    def setUp(self) -> None:
        self.km = KeyManager()
        self.engine = ExecutionEngine(self.km, ExecutionConfig(max_retries=1, max_failovers=2))

    def test_successful_execution(self) -> None:
        r1 = _route("mock_fast", "fast-v1", rank=1)
        plan = RoutePlan(strategy=Strategy.DRAFT, selected=r1, candidates=(r1,))
        task = _task()

        result = self.engine.execute(task, plan)

        self.assertIsInstance(result, ExecutionResult)
        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertTrue(result.ok)
        self.assertEqual(result.provider_id, "mock_fast")
        self.assertIn("MOCK [fast]", result.output_text or "")
        self.assertEqual(len(result.attempts), 1)
        self.assertEqual(result.attempts[0].status, ExecutionStatus.SUCCESS)
        self.assertEqual(result.retries, 0)
        self.assertEqual(result.failovers, 0)

    def test_retry_on_transient_error(self) -> None:
        # mock_timeout raises ProviderTimeoutError which is retryable
        r1 = _route("mock_timeout", "timeout-v1", rank=1)
        plan = RoutePlan(strategy=Strategy.BALANCED, selected=r1, candidates=(r1,))
        task = _task()

        result = self.engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.FAILED)
        self.assertFalse(result.ok)
        # initial try + 1 retry = 2 attempts
        self.assertEqual(len(result.attempts), 2)
        self.assertEqual(result.retries, 1)

    def test_failover_to_secondary_on_recoverable_error(self) -> None:
        # mock_rate_limited fails, then failover to mock_fast succeeds
        r1 = _route("mock_rate_limited", "limited-v1", rank=1)
        r2 = _route("mock_fast", "fast-v1", rank=2)
        plan = RoutePlan(strategy=Strategy.BALANCED, selected=r1, candidates=(r1, r2))
        task = _task()

        result = self.engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertEqual(result.provider_id, "mock_fast")
        self.assertEqual(result.failovers, 1)
        self.assertTrue(result.failover_occurred)
        # initial try + 1 retry on r1, then 1 try on r2 = 3 attempts
        self.assertEqual(len(result.attempts), 3)
        self.assertEqual(result.attempts[0].status, ExecutionStatus.FAILED)
        self.assertEqual(result.attempts[1].status, ExecutionStatus.FAILED)
        self.assertEqual(result.attempts[2].status, ExecutionStatus.SUCCESS)

    def test_key_health_and_usage_updated(self) -> None:
        key = ApiKey(
            provider_id="mock_fast",
            env_var="MOCK_KEY",
            label="fast-key-1",
            fingerprint="fp1",
            status=KeyStatus.ACTIVE,
            quota_limit=1000,
        )
        self.km.register_key(key)

        r1 = _route("mock_fast", "fast-v1", rank=1, key_label="fast-key-1")
        plan = RoutePlan(strategy=Strategy.BALANCED, selected=r1, candidates=(r1,))
        task = _task()

        result = self.engine.execute(task, plan)

        self.assertTrue(result.ok)
        self.assertGreater(key.quota_used, 0)
        self.assertIsNotNone(key.last_used_at)


if __name__ == "__main__":
    unittest.main()
