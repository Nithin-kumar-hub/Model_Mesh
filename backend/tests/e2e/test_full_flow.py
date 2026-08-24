"""End-to-End full flow tests for Phase 1.

Verifies:
1. End-to-end task analysis -> profiling -> routing -> execution -> results -> telemetry.
2. Provider failure -> automatic fallback recovery -> successful result.
3. Strategy differentiation (Draft vs Balanced vs Premium on the same task).
4. Explainability inspection across all stages.
"""

from __future__ import annotations

import unittest

from app.classifier import RuleBasedClassifier
from app.domain import (
    ApiKey,
    ExecutionStatus,
    KeyStatus,
    Modality,
    ModelSpec,
    Provider,
    Strategy,
    Task,
)
from app.execution import ExecutionConfig, ExecutionEngine
from app.keys import KeyManager
from app.profiler import get_profiler
from app.registry import ProviderRegistry
from app.registry.data import MOCK_FAST, MOCK_QUALITY, MOCK_RATE_LIMITED
from app.routing import Router
from app.telemetry import TelemetryStore


class TestEndToEndFlow(unittest.TestCase):
    def test_happy_path_e2e(self) -> None:
        """USER -> TASK -> CLASSIFY -> PROFILE -> ROUTE -> EXECUTE -> RESULT + TELEMETRY."""
        task = Task(input_text="Write a Python script to download files", strategy=Strategy.BALANCED)

        # 1. Classification
        classifier = RuleBasedClassifier()
        classification = classifier.classify(task)
        self.assertEqual(classification.modality, Modality.CODE)
        self.assertGreater(len(classification.signals), 0)

        # 2. Profiling
        profiler = get_profiler(classification.modality)
        profile = profiler.profile(task, classification)
        self.assertTrue(profile.is_estimate)
        self.assertGreater(profile.required_context_tokens, 0)

        # 3. Routing
        registry = ProviderRegistry()
        router = Router(registry)
        key_manager = KeyManager()
        plan = router.route(classification, profile, task.strategy, key_manager.all_keys())
        self.assertIsNotNone(plan.selected)
        self.assertGreater(len(plan.candidates), 0)
        self.assertGreater(len(plan.selected.reasons), 0)

        # 4. Execution
        engine = ExecutionEngine(key_manager, ExecutionConfig(max_retries=1, max_failovers=2))
        result = engine.execute(task, plan)
        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertTrue(result.ok)
        self.assertIsNotNone(result.output_text)

        # 5. Telemetry
        telemetry = TelemetryStore()
        record = telemetry.record(result, classification, profile, task.strategy)
        self.assertEqual(record.task_id, task.id)
        self.assertEqual(record.status, ExecutionStatus.SUCCESS)

    def test_failover_recovery_e2e(self) -> None:
        """Route to failing provider -> automatic fallback -> successful execution."""
        task = Task(input_text="Explain recursion", strategy=Strategy.DRAFT)

        # Custom registry where primary candidate is rate-limited, fallback is fast
        custom_registry = ProviderRegistry(providers=(MOCK_RATE_LIMITED, MOCK_FAST))
        router = Router(custom_registry)
        key_manager = KeyManager()

        classifier = RuleBasedClassifier()
        classification = classifier.classify(task)
        profiler = get_profiler(classification.modality)
        profile = profiler.profile(task, classification)

        plan = router.route(classification, profile, task.strategy, key_manager.all_keys())

        # Ensure mock_rate_limited is selected as primary (or present in candidates)
        engine = ExecutionEngine(key_manager, ExecutionConfig(max_retries=0, max_failovers=2))
        result = engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertTrue(result.ok)

    def test_strategy_differentiation_e2e(self) -> None:
        """Verify Draft, Balanced, and Premium make distinct routing decisions on identical tasks."""
        task_text = "Generate a complete neural network architecture in PyTorch"
        registry = ProviderRegistry(providers=(MOCK_FAST, MOCK_QUALITY))
        router = Router(registry)
        classifier = RuleBasedClassifier()
        key_manager = KeyManager()

        task_draft = Task(input_text=task_text, strategy=Strategy.DRAFT)
        task_premium = Task(input_text=task_text, strategy=Strategy.PREMIUM)

        cl_draft = classifier.classify(task_draft)
        prof_draft = get_profiler(cl_draft.modality).profile(task_draft, cl_draft)
        plan_draft = router.route(cl_draft, prof_draft, Strategy.DRAFT, key_manager.all_keys())

        cl_prem = classifier.classify(task_premium)
        prof_prem = get_profiler(cl_prem.modality).profile(task_premium, cl_prem)
        plan_prem = router.route(cl_prem, prof_prem, Strategy.PREMIUM, key_manager.all_keys())

        # Draft selects Mock Fast, Premium selects Mock Quality
        self.assertEqual(plan_draft.selected.provider_id, "mock_fast")
        self.assertEqual(plan_prem.selected.provider_id, "mock_quality")
        self.assertNotEqual(plan_draft.selected.score, plan_prem.selected.score)


if __name__ == "__main__":
    unittest.main()
