"""Integration tests: validates integration between classifier, profiler, registry, router, key manager, and execution engine."""

from __future__ import annotations

import unittest

from app.classifier import RuleBasedClassifier
from app.domain import (
    ApiKey,
    ClassificationSource,
    Complexity,
    ExecutionStatus,
    KeyStatus,
    Modality,
    Strategy,
    Task,
    TaskType,
)
from app.execution import ExecutionConfig, ExecutionEngine
from app.keys import KeyManager
from app.profiler import get_profiler
from app.registry import ProviderRegistry
from app.routing import Router


class TestPipelineIntegration(unittest.TestCase):
    def setUp(self) -> None:
        self.classifier = RuleBasedClassifier()
        self.registry = ProviderRegistry()
        self.router = Router(self.registry)
        self.key_manager = KeyManager()
        self.engine = ExecutionEngine(self.key_manager, ExecutionConfig(max_retries=1, max_failovers=2))

    def test_classifier_to_profiler_integration(self) -> None:
        task = Task(input_text="Explain asynchronous programming in Python with examples")
        classification = self.classifier.classify(task)
        self.assertEqual(classification.modality, Modality.TEXT)

        profiler = get_profiler(classification.modality)
        profile = profiler.profile(task, classification)

        self.assertGreater(profile.estimated_input_tokens, 0)
        self.assertTrue(profile.estimated_output_tokens.is_ordered())
        self.assertTrue(profile.is_estimate)

    def test_profiler_to_router_integration(self) -> None:
        task = Task(input_text="def quicksort(arr): ...", strategy=Strategy.PREMIUM)
        classification = self.classifier.classify(task)
        profiler = get_profiler(classification.modality)
        profile = profiler.profile(task, classification)

        plan = self.router.route(classification, profile, task.strategy, self.key_manager.all_keys())

        self.assertIsNotNone(plan.selected)
        self.assertEqual(plan.strategy, Strategy.PREMIUM)
        self.assertIn("mock_quality/quality-v1", [c.model_ref for c in plan.candidates])

    def test_full_pipeline_text_task(self) -> None:
        task = Task(input_text="Summarize the key events of World War 2", strategy=Strategy.DRAFT)
        classification = self.classifier.classify(task)
        profiler = get_profiler(classification.modality)
        profile = profiler.profile(task, classification)

        plan = self.router.route(classification, profile, task.strategy, self.key_manager.all_keys())
        result = self.engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertTrue(result.ok)
        self.assertIsNotNone(result.output_text)
        self.assertGreater(result.usage.total_tokens, 0)

    def test_full_pipeline_code_task(self) -> None:
        task = Task(
            input_text="Debug this: TypeError: unsupported operand type(s) for +: 'int' and 'str'",
            strategy=Strategy.BALANCED,
        )
        classification = self.classifier.classify(task)
        self.assertEqual(classification.modality, Modality.CODE)
        self.assertEqual(classification.task_type, TaskType.DEBUGGING)

        profiler = get_profiler(classification.modality)
        profile = profiler.profile(task, classification)

        plan = self.router.route(classification, profile, task.strategy, self.key_manager.all_keys())
        result = self.engine.execute(task, plan)

        self.assertEqual(result.status, ExecutionStatus.SUCCESS)
        self.assertTrue(result.ok)


if __name__ == "__main__":
    unittest.main()
