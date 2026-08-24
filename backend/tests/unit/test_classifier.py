"""Unit tests for the task classifier (M3)."""

from __future__ import annotations

import unittest

from app.classifier import ClassifierProtocol, RuleBasedClassifier
from app.domain import (
    Classification,
    ClassificationSource,
    Complexity,
    Modality,
    Strategy,
    Task,
    TaskType,
)


def _classify(text: str, **kw: object) -> Classification:
    """Shorthand: classify text with default task settings."""
    task = Task(input_text=text, **kw)  # type: ignore[arg-type]
    return RuleBasedClassifier().classify(task)


class TestClassifierProtocol(unittest.TestCase):
    def test_rule_based_satisfies_protocol(self) -> None:
        self.assertIsInstance(RuleBasedClassifier(), ClassifierProtocol)


class TestModalityDetection(unittest.TestCase):
    def test_code_fence_triggers_code(self) -> None:
        c = _classify("Please fix this:\n```python\ndef foo():\n    pass\n```")
        self.assertEqual(c.modality, Modality.CODE)
        self.assertIn("code_fence_detected", c.signals)

    def test_language_keywords_trigger_code(self) -> None:
        c = _classify("def calculate(x): return x * 2")
        self.assertEqual(c.modality, Modality.CODE)

    def test_code_verb_triggers_code(self) -> None:
        c = _classify("Debug this Java NullPointerException in the UserService class")
        self.assertEqual(c.modality, Modality.CODE)
        self.assertIn("code_verb_detected", c.signals)

    def test_plain_text_is_text(self) -> None:
        c = _classify("Explain the theory of relativity in simple terms")
        self.assertEqual(c.modality, Modality.TEXT)

    def test_modality_hint_code_nudges(self) -> None:
        # Without hint this would be TEXT; hint should push it to CODE
        c = _classify("Write a function to sort numbers", modality_hint=Modality.CODE)
        self.assertEqual(c.modality, Modality.CODE)
        self.assertIn("modality_hint_code", c.signals)

    def test_modality_hint_text_nudges(self) -> None:
        c = _classify("Summarize this paragraph", modality_hint=Modality.TEXT)
        self.assertEqual(c.modality, Modality.TEXT)
        self.assertIn("modality_hint_text", c.signals)

    def test_strong_code_evidence_overrides_text_hint(self) -> None:
        code = "```java\npublic class Foo { public static void main(String[] args) {} }\n```"
        c = _classify(f"Look at this:\n{code}", modality_hint=Modality.TEXT)
        # Code fence + language keywords should override the text hint
        self.assertEqual(c.modality, Modality.CODE)


class TestTaskTypeDetection(unittest.TestCase):
    def test_debugging(self) -> None:
        c = _classify("Debug this Java NullPointerException in the UserService class")
        self.assertEqual(c.task_type, TaskType.DEBUGGING)

    def test_code_generation(self) -> None:
        c = _classify("Write a Python function to calculate fibonacci numbers")
        self.assertEqual(c.task_type, TaskType.CODE_GENERATION)

    def test_refactoring(self) -> None:
        c = _classify("Refactor this class to use dependency injection:\n```python\nclass Foo:\n    pass\n```")
        self.assertEqual(c.task_type, TaskType.REFACTORING)

    def test_code_explanation(self) -> None:
        c = _classify("Explain this code:\n```python\ndef foo(): return 42\n```")
        self.assertEqual(c.task_type, TaskType.CODE_EXPLANATION)

    def test_summarization(self) -> None:
        c = _classify("Summarize the following paragraph about climate change")
        self.assertEqual(c.task_type, TaskType.SUMMARIZATION)

    def test_explanation(self) -> None:
        c = _classify("Explain dependency injection in simple terms")
        self.assertEqual(c.task_type, TaskType.EXPLANATION)

    def test_translation(self) -> None:
        c = _classify("Translate this text to Spanish: Hello, how are you?")
        self.assertEqual(c.task_type, TaskType.TRANSLATION)

    def test_question_answering(self) -> None:
        c = _classify("What is the capital of France?")
        self.assertEqual(c.task_type, TaskType.QUESTION_ANSWERING)

    def test_text_generation(self) -> None:
        c = _classify("Write a blog post about sustainable energy")
        self.assertEqual(c.task_type, TaskType.TEXT_GENERATION)

    def test_default_text_fallback(self) -> None:
        c = _classify("Hello world this is a random message")
        self.assertEqual(c.modality, Modality.TEXT)
        self.assertEqual(c.task_type, TaskType.TEXT_GENERATION)


class TestComplexityDetection(unittest.TestCase):
    def test_short_input_is_simple(self) -> None:
        c = _classify("Fix this bug")
        self.assertEqual(c.complexity, Complexity.SIMPLE)

    def test_medium_input(self) -> None:
        text = "Explain dependency injection " * 10  # ~300 chars
        c = _classify(text)
        self.assertEqual(c.complexity, Complexity.MEDIUM)

    def test_long_input_is_complex(self) -> None:
        text = "Explain this concept in detail " * 30  # ~900 chars
        c = _classify(text)
        self.assertEqual(c.complexity, Complexity.COMPLEX)

    def test_complex_topic_indicator(self) -> None:
        c = _classify("Design a microservice architecture for an e-commerce platform")
        self.assertEqual(c.complexity, Complexity.COMPLEX)
        self.assertIn("complex_topic_indicator", c.signals)


class TestConfidence(unittest.TestCase):
    def test_confidence_is_bounded(self) -> None:
        c = _classify("x")
        self.assertGreaterEqual(c.confidence, 0.3)
        self.assertLessEqual(c.confidence, 0.95)

    def test_empty_input_gets_min_confidence(self) -> None:
        c = _classify("")
        self.assertEqual(c.confidence, 0.3)

    def test_rich_input_gets_higher_confidence(self) -> None:
        simple = _classify("hello")
        rich = _classify(
            "Debug this Java NullPointerException in the UserService:\n"
            "```java\npublic class UserService {\n"
            "    public void getUser(String id) {\n"
            "        return users.get(id).getName();\n"
            "    }\n}\n```"
        )
        self.assertGreater(rich.confidence, simple.confidence)

    def test_source_is_rule_based(self) -> None:
        c = _classify("Summarize this")
        self.assertEqual(c.source, ClassificationSource.RULE_BASED)


class TestEdgeCases(unittest.TestCase):
    def test_whitespace_only(self) -> None:
        c = _classify("   \n\t  ")
        self.assertEqual(c.confidence, 0.3)
        # Should not crash; should return a valid Classification
        self.assertIsInstance(c, Classification)

    def test_very_long_input(self) -> None:
        c = _classify("word " * 5000)
        self.assertIsInstance(c, Classification)
        self.assertEqual(c.complexity, Complexity.COMPLEX)

    def test_mixed_code_and_text(self) -> None:
        c = _classify(
            "Can you explain what this function does and fix the bug?\n"
            "```python\ndef calc(n):\n    return n / 0\n```"
        )
        self.assertEqual(c.modality, Modality.CODE)
        # Debugging because "fix" + "bug" are strong signals
        self.assertEqual(c.task_type, TaskType.DEBUGGING)


if __name__ == "__main__":
    unittest.main()
