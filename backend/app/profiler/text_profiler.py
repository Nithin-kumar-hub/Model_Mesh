"""Text-task workload profiler (Phase 1).

Estimates token usage for text-oriented tasks using configurable heuristics.
All values are labelled as ESTIMATES. The profiler is provider-independent.

Heuristic basis:
- Input tokens ≈ characters / chars_per_token (default 4 for English text).
- Output tokens vary by task type (summarisation produces less output than
  generation) and complexity (complex tasks produce wider ranges).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain import Classification, Complexity, Task, TaskType, TokenRange, WorkloadProfile

from .protocol import ProfilerProtocol

# Task-type output multipliers (relative to input tokens).
# A multiplier of 1.0 means "expect roughly as many output tokens as input tokens".
_TEXT_OUTPUT_MULTIPLIERS: dict[TaskType, float] = {
    TaskType.SUMMARIZATION: 0.3,
    TaskType.TRANSLATION: 1.1,
    TaskType.EXPLANATION: 1.5,
    TaskType.QUESTION_ANSWERING: 0.8,
    TaskType.TEXT_GENERATION: 2.0,
    TaskType.OTHER: 1.0,
}

# Complexity range factors: (best_factor, worst_factor) relative to expected.
_COMPLEXITY_RANGE: dict[Complexity, tuple[float, float]] = {
    Complexity.SIMPLE: (0.6, 1.3),
    Complexity.MEDIUM: (0.5, 1.8),
    Complexity.COMPLEX: (0.4, 2.5),
}


@dataclass
class TextProfiler(ProfilerProtocol):
    """Heuristic profiler for TEXT tasks."""

    chars_per_token: float = 4.0
    min_output_tokens: int = 20

    def profile(self, task: Task, classification: Classification) -> WorkloadProfile:
        input_tokens = max(1, int(len(task.input_text) / self.chars_per_token))

        # Determine output estimate
        multiplier = _TEXT_OUTPUT_MULTIPLIERS.get(classification.task_type, 1.0)
        expected_output = max(self.min_output_tokens, int(input_tokens * multiplier))

        # If user specified max_output_tokens, cap the expected output
        if task.max_output_tokens is not None:
            expected_output = min(expected_output, task.max_output_tokens)

        # Apply complexity range
        best_factor, worst_factor = _COMPLEXITY_RANGE.get(
            classification.complexity, (0.5, 1.8)
        )
        best_output = max(self.min_output_tokens, int(expected_output * best_factor))
        worst_output = int(expected_output * worst_factor)
        output_range = TokenRange(
            best=best_output, expected=expected_output, worst=worst_output
        )

        # Total = input + output
        total_range = TokenRange(
            best=input_tokens + output_range.best,
            expected=input_tokens + output_range.expected,
            worst=input_tokens + output_range.worst,
        )

        # Context requirement = conservative (input + worst-case output)
        required_context = input_tokens + output_range.worst

        # Confidence based on input size and classification confidence
        confidence = self._compute_confidence(input_tokens, classification.confidence)

        reasons = [
            f"input_chars={len(task.input_text)}",
            f"chars_per_token={self.chars_per_token}",
            f"task_type_multiplier={multiplier}",
            f"complexity={classification.complexity.value}",
        ]

        return WorkloadProfile(
            estimated_input_tokens=input_tokens,
            estimated_output_tokens=output_range,
            estimated_total_tokens=total_range,
            required_context_tokens=required_context,
            confidence=confidence,
            reasons=tuple(reasons),
            is_estimate=True,
        )

    @staticmethod
    def _compute_confidence(input_tokens: int, classification_confidence: float) -> float:
        """Heuristic confidence based on input size and classifier confidence."""
        # Very short inputs are harder to estimate
        if input_tokens < 10:
            base = 0.4
        elif input_tokens < 100:
            base = 0.6
        else:
            base = 0.75

        # Blend with classification confidence
        blended = (base * 0.6) + (classification_confidence * 0.4)
        return round(min(max(blended, 0.3), 0.9), 2)
