"""Unit tests specifically focused on failover scenarios and edge cases (M8b)."""

from __future__ import annotations

import unittest

from app.domain import (
    ApiKey,
    ErrorCode,
    ExecutionResult,
    ExecutionStatus,
    KeyStatus,
    Modality,
    Route,
    RoutePlan,
    Strategy,
    Task,
)
from app.execution import ExecutionConfig, ExecutionEngine
from app.keys import KeyManager


def _route(provider_id: str, model_id: str = "v1", rank: int = 1, key_label: str | None = None) -> Route:
    return Route(
        provider_id=provider_id,
        model_id=model_id,
        model_ref=f"{provider_id}/{model_id}",
        key_label=key_label,
        score=1.0 - (rank * 0.1),
        rank=rank,
        reasons=("supports modality",),
        is_mock=True,
    )


class TestFailoverScenarios(unittest.TestCase):
    def setUp(self) -> None:
        self.km = KeyManager()
        self.engine = ExecutionEngine(self.km, ExecutionConfig(max_retries=1, max_failovers=3))

    def test_multi_hop_failover_success(self) -> None:
        """Fails on mock_rate_limited, fails on mock_exhausted, succeeds on mock_quality."""
        r1 = _route("mock_rate_limited", "limited-v1", rank=1)
        r2 = _route("mock_exhausted", "exhausted-v1", rank=2)
        r3 = _route("mock_quality", "quality-v1", rank=3)

        plan = RoutePlan(strategy=Strategy.BALANCED, selected=r1, candidates=(r1, r2, r3))
        task = Task(input_text="Generate code")

        result = self.engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertEqual(result.provider_id, "mock_quality")
        self.assertEqual(result.failovers, 2)
        # r1 (rate limited): 1 try + 1 retry = 2 attempts
        # r2 (exhausted): 1 attempt (non-retryable)
        # r3 (quality): 1 attempt (success)
        # Total = 4 attempts
        self.assertEqual(len(result.attempts), 4)
        self.assertEqual(result.attempts[0].error_code, ErrorCode.RATE_LIMITED.value)
        self.assertEqual(result.attempts[1].error_code, ErrorCode.RATE_LIMITED.value)
        self.assertEqual(result.attempts[2].error_code, ErrorCode.QUOTA_EXHAUSTED.value)
        self.assertEqual(result.attempts[3].status, ExecutionStatus.SUCCESS)

    def test_all_routes_fail_structured_response(self) -> None:
        """When all routes fail, return a structured ExecutionResult with status=FAILED and error details."""
        r1 = _route("mock_exhausted", "exhausted-v1", rank=1)
        r2 = _route("mock_unavailable", "unavail-v1", rank=2)

        plan = RoutePlan(strategy=Strategy.BALANCED, selected=r1, candidates=(r1, r2))
        task = Task(input_text="Test prompt")

        result = self.engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.FAILED)
        self.assertFalse(result.ok)
        self.assertIsNotNone(result.error_message)
        # r1 (exhausted): 1 attempt
        # r2 (unavailable): 1 try + 1 retry = 2 attempts
        # Total = 3 attempts
        self.assertEqual(len(result.attempts), 3)
        self.assertEqual(result.failovers, 1)

    def test_max_failovers_limit_enforced(self) -> None:
        """Ensure execution stops when max_failovers threshold is hit."""
        engine = ExecutionEngine(self.km, ExecutionConfig(max_retries=0, max_failovers=1))

        r1 = _route("mock_rate_limited", "limited-v1", rank=1)
        r2 = _route("mock_exhausted", "exhausted-v1", rank=2)
        r3 = _route("mock_fast", "fast-v1", rank=3)

        plan = RoutePlan(strategy=Strategy.DRAFT, selected=r1, candidates=(r1, r2, r3))
        task = Task(input_text="Test prompt")

        result = engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.FAILED)
        # Only tried r1 (initial) and r2 (1 failover) = 2 attempts total
        self.assertEqual(len(result.attempts), 2)
        self.assertEqual(result.failovers, 1)

    def test_key_failure_triggers_status_update(self) -> None:
        key = ApiKey(
            provider_id="mock_rate_limited",
            env_var="RATE_KEY",
            label="rate-key-1",
            fingerprint="fp_rate",
            status=KeyStatus.ACTIVE,
        )
        self.km.register_key(key)

        r1 = _route("mock_rate_limited", "limited-v1", rank=1, key_label="rate-key-1")
        r2 = _route("mock_fast", "fast-v1", rank=2)
        plan = RoutePlan(strategy=Strategy.BALANCED, selected=r1, candidates=(r1, r2))

        result = self.engine.execute(Task(input_text="hello"), plan)

        self.assertTrue(result.ok)
        self.assertEqual(key.status, KeyStatus.RATE_LIMITED)
        self.assertTrue(key.is_in_cooldown())


if __name__ == "__main__":
    unittest.main()
