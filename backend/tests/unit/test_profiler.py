"""Unit tests for the workload profiler (M4)."""

from __future__ import annotations

import unittest

from app.domain import (
    Classification,
    ClassificationSource,
    Complexity,
    Modality,
    Task,
    TaskType,
    TokenRange,
    WorkloadProfile,
)
from app.profiler import CodeProfiler, ProfilerProtocol, TextProfiler, get_profiler


def _text_classification(**kw: object) -> Classification:
    defaults = dict(
        modality=Modality.TEXT,
        task_type=TaskType.EXPLANATION,
        complexity=Complexity.MEDIUM,
        confidence=0.8,
        source=ClassificationSource.RULE_BASED,
    )
    defaults.update(kw)
    return Classification(**defaults)  # type: ignore[arg-type]


def _code_classification(**kw: object) -> Classification:
    defaults = dict(
        modality=Modality.CODE,
        task_type=TaskType.CODE_GENERATION,
        complexity=Complexity.MEDIUM,
        confidence=0.8,
        source=ClassificationSource.RULE_BASED,
    )
    defaults.update(kw)
    return Classification(**defaults)  # type: ignore[arg-type]


class TestProfilerProtocol(unittest.TestCase):
    def test_text_profiler_satisfies_protocol(self) -> None:
        self.assertIsInstance(TextProfiler(), ProfilerProtocol)

    def test_code_profiler_satisfies_protocol(self) -> None:
        self.assertIsInstance(CodeProfiler(), ProfilerProtocol)


class TestTextProfiler(unittest.TestCase):
    def test_basic_estimation(self) -> None:
        task = Task(input_text="Explain dependency injection in simple terms")
        cl = _text_classification(task_type=TaskType.EXPLANATION)
        profile = TextProfiler().profile(task, cl)

        self.assertIsInstance(profile, WorkloadProfile)
        self.assertTrue(profile.is_estimate)
        self.assertGreater(profile.estimated_input_tokens, 0)

    def test_output_range_is_ordered(self) -> None:
        task = Task(input_text="Explain X " * 20)
        cl = _text_classification()
        profile = TextProfiler().profile(task, cl)

        self.assertTrue(profile.estimated_output_tokens.is_ordered())
        self.assertTrue(profile.estimated_total_tokens.is_ordered())

    def test_summarization_produces_less_output(self) -> None:
        text = "A very long document about climate change. " * 20
        task = Task(input_text=text)
        summary_cl = _text_classification(task_type=TaskType.SUMMARIZATION)
        gen_cl = _text_classification(task_type=TaskType.TEXT_GENERATION)

        summary_profile = TextProfiler().profile(task, summary_cl)
        gen_profile = TextProfiler().profile(task, gen_cl)

        self.assertLess(
            summary_profile.estimated_output_tokens.expected,
            gen_profile.estimated_output_tokens.expected,
        )

    def test_complexity_affects_range_width(self) -> None:
        task = Task(input_text="Explain X " * 30)
        simple_cl = _text_classification(complexity=Complexity.SIMPLE)
        complex_cl = _text_classification(complexity=Complexity.COMPLEX)

        simple_p = TextProfiler().profile(task, simple_cl)
        complex_p = TextProfiler().profile(task, complex_cl)

        simple_width = simple_p.estimated_output_tokens.worst - simple_p.estimated_output_tokens.best
        complex_width = complex_p.estimated_output_tokens.worst - complex_p.estimated_output_tokens.best
        self.assertGreater(complex_width, simple_width)

    def test_max_output_tokens_caps_estimate(self) -> None:
        task = Task(input_text="A long text " * 100, max_output_tokens=50)
        cl = _text_classification(task_type=TaskType.TEXT_GENERATION)
        profile = TextProfiler().profile(task, cl)

        self.assertLessEqual(profile.estimated_output_tokens.expected, 50)

    def test_confidence_bounded(self) -> None:
        task = Task(input_text="x")
        cl = _text_classification(confidence=0.5)
        profile = TextProfiler().profile(task, cl)
        self.assertGreaterEqual(profile.confidence, 0.3)
        self.assertLessEqual(profile.confidence, 0.9)

    def test_context_requirement(self) -> None:
        task = Task(input_text="Hello world " * 50)
        cl = _text_classification()
        profile = TextProfiler().profile(task, cl)

        # Context should be >= input + worst output
        self.assertEqual(
            profile.required_context_tokens,
            profile.estimated_input_tokens + profile.estimated_output_tokens.worst,
        )

    def test_reasons_included(self) -> None:
        task = Task(input_text="Test")
        cl = _text_classification()
        profile = TextProfiler().profile(task, cl)
        self.assertTrue(len(profile.reasons) > 0)
        self.assertTrue(any("input_chars" in r for r in profile.reasons))


class TestCodeProfiler(unittest.TestCase):
    def test_basic_estimation(self) -> None:
        task = Task(input_text="def foo():\n    return 42")
        cl = _code_classification(task_type=TaskType.CODE_GENERATION)
        profile = CodeProfiler().profile(task, cl)

        self.assertIsInstance(profile, WorkloadProfile)
        self.assertTrue(profile.is_estimate)

    def test_code_is_denser(self) -> None:
        """Code profiler uses fewer chars_per_token than text profiler."""
        text = "x" * 100
        task = Task(input_text=text)
        text_profile = TextProfiler().profile(task, _text_classification())
        code_profile = CodeProfiler().profile(task, _code_classification())

        # Code profiler estimates more input tokens for the same text
        self.assertGreater(
            code_profile.estimated_input_tokens,
            text_profile.estimated_input_tokens,
        )

    def test_debugging_produces_less_than_generation(self) -> None:
        text = "Fix the bug in this function:\ndef broken():\n    return 1/0\n" * 5
        task = Task(input_text=text)
        debug_cl = _code_classification(task_type=TaskType.DEBUGGING)
        gen_cl = _code_classification(task_type=TaskType.CODE_GENERATION)

        debug_p = CodeProfiler().profile(task, debug_cl)
        gen_p = CodeProfiler().profile(task, gen_cl)

        self.assertLess(
            debug_p.estimated_output_tokens.expected,
            gen_p.estimated_output_tokens.expected,
        )

    def test_output_range_ordered(self) -> None:
        task = Task(input_text="Write a function " * 10)
        cl = _code_classification()
        profile = CodeProfiler().profile(task, cl)
        self.assertTrue(profile.estimated_output_tokens.is_ordered())
        self.assertTrue(profile.estimated_total_tokens.is_ordered())


class TestProfilerFactory(unittest.TestCase):
    def test_text_dispatches_to_text_profiler(self) -> None:
        p = get_profiler(Modality.TEXT)
        self.assertIsInstance(p, TextProfiler)

    def test_code_dispatches_to_code_profiler(self) -> None:
        p = get_profiler(Modality.CODE)
        self.assertIsInstance(p, CodeProfiler)

    def test_factory_returns_protocol_instance(self) -> None:
        for modality in Modality:
            p = get_profiler(modality)
            self.assertIsInstance(p, ProfilerProtocol)

    def test_profiler_independent_of_provider(self) -> None:
        """Profiler output should not reference any provider-specific data."""
        task = Task(input_text="Explain X " * 20)
        cl = _text_classification()
        profile = TextProfiler().profile(task, cl)
        # Profile should not mention provider names
        all_reasons = " ".join(profile.reasons)
        for name in ("groq", "openrouter", "openai"):
            self.assertNotIn(name, all_reasons.lower())


if __name__ == "__main__":
    unittest.main()
