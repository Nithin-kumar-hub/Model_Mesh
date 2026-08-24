"""Unit tests for telemetry store (M12)."""

from __future__ import annotations

import unittest

from app.domain import (
    Classification,
    ClassificationSource,
    Complexity,
    ExecutionResult,
    ExecutionStatus,
    Modality,
    Strategy,
    TaskType,
    TokenRange,
    Usage,
    WorkloadProfile,
)
from app.telemetry import ExecutionRecord, TelemetryStore


def _classification() -> Classification:
    return Classification(
        modality=Modality.TEXT,
        task_type=TaskType.EXPLANATION,
        complexity=Complexity.SIMPLE,
        confidence=0.85,
        source=ClassificationSource.RULE_BASED,
    )


def _profile() -> WorkloadProfile:
    return WorkloadProfile(
        estimated_input_tokens=100,
        estimated_output_tokens=TokenRange(50, 100, 150),
        estimated_total_tokens=TokenRange(150, 200, 250),
        required_context_tokens=250,
        confidence=0.8,
    )


def _result(
    task_id: str = "task_1",
    status: ExecutionStatus = ExecutionStatus.SUCCESS,
    failovers: int = 0,
) -> ExecutionResult:
    return ExecutionResult(
        task_id=task_id,
        status=status,
        provider_id="mock_fast",
        model_id="fast-v1",
        model_ref="mock_fast/fast-v1",
        key_label=None,
        output_text="Result text",
        usage=Usage(100, 50, 150),
        latency_ms=25.0,
        retries=0,
        failovers=failovers,
        is_mock=True,
    )


class TestTelemetryStore(unittest.TestCase):
    def test_record_and_get_history(self) -> None:
        store = TelemetryStore()
        rec = store.record(_result("task_1"), _classification(), _profile(), Strategy.BALANCED)

        self.assertIsInstance(rec, ExecutionRecord)
        self.assertEqual(rec.task_id, "task_1")
        self.assertEqual(rec.strategy, "balanced")
        self.assertEqual(rec.actual_total_tokens, 150)

        history = store.get_history()
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["task_id"], "task_1")

    def test_get_stats_empty(self) -> None:
        store = TelemetryStore()
        stats = store.get_stats()
        self.assertEqual(stats["total_executions"], 0)
        self.assertEqual(stats["success_rate"], 0.0)

    def test_get_stats_aggregated(self) -> None:
        store = TelemetryStore()
        store.record(_result("task_1", ExecutionStatus.SUCCESS, failovers=0), _classification(), _profile())
        store.record(_result("task_2", ExecutionStatus.SUCCESS, failovers=1), _classification(), _profile())
        store.record(_result("task_3", ExecutionStatus.FAILED, failovers=0), _classification(), _profile())

        stats = store.get_stats()
        self.assertEqual(stats["total_executions"], 3)
        self.assertAlmostEqual(stats["success_rate"], 2 / 3, places=2)
        self.assertEqual(stats["failover_count"], 1)
        self.assertEqual(stats["provider_distribution"]["mock_fast"], 3)

    def test_max_records_limit(self) -> None:
        store = TelemetryStore(max_records=2)
        store.record(_result("task_1"), _classification(), _profile())
        store.record(_result("task_2"), _classification(), _profile())
        store.record(_result("task_3"), _classification(), _profile())

        history = store.get_history()
        self.assertEqual(len(history), 2)
        task_ids = [h["task_id"] for h in history]
        self.assertIn("task_3", task_ids)
        self.assertIn("task_2", task_ids)
        self.assertNotIn("task_1", task_ids)


if __name__ == "__main__":
    unittest.main()
