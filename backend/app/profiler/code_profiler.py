"""Code-task workload profiler (Phase 1).

Same structure as the text profiler but with different output multipliers
tuned for code tasks (debugging tends to produce shorter output than full
code generation).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain import Classification, Complexity, Task, TaskType, TokenRange, WorkloadProfile

from .protocol import ProfilerProtocol

# Code output multipliers — code generation is verbose; debugging is tighter.
_CODE_OUTPUT_MULTIPLIERS: dict[TaskType, float] = {
    TaskType.CODE_GENERATION: 2.5,
    TaskType.DEBUGGING: 1.2,
    TaskType.REFACTORING: 1.8,
    TaskType.CODE_EXPLANATION: 1.5,
    TaskType.OTHER: 1.5,
}

# Complexity range factors for code tasks.
_COMPLEXITY_RANGE: dict[Complexity, tuple[float, float]] = {
    Complexity.SIMPLE: (0.5, 1.4),
    Complexity.MEDIUM: (0.4, 2.0),
    Complexity.COMPLEX: (0.3, 3.0),
}


@dataclass
class CodeProfiler(ProfilerProtocol):
    """Heuristic profiler for CODE tasks."""

    chars_per_token: float = 3.5  # code is denser than prose
    min_output_tokens: int = 30

    def profile(self, task: Task, classification: Classification) -> WorkloadProfile:
        input_tokens = max(1, int(len(task.input_text) / self.chars_per_token))

        multiplier = _CODE_OUTPUT_MULTIPLIERS.get(classification.task_type, 1.5)
        expected_output = max(self.min_output_tokens, int(input_tokens * multiplier))

        if task.max_output_tokens is not None:
            expected_output = min(expected_output, task.max_output_tokens)

        best_factor, worst_factor = _COMPLEXITY_RANGE.get(
            classification.complexity, (0.4, 2.0)
        )
        best_output = max(self.min_output_tokens, int(expected_output * best_factor))
        worst_output = int(expected_output * worst_factor)
        output_range = TokenRange(
            best=best_output, expected=expected_output, worst=worst_output
        )

        total_range = TokenRange(
            best=input_tokens + output_range.best,
            expected=input_tokens + output_range.expected,
            worst=input_tokens + output_range.worst,
        )

        required_context = input_tokens + output_range.worst

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
        if input_tokens < 10:
            base = 0.35
        elif input_tokens < 100:
            base = 0.55
        else:
            base = 0.7

        blended = (base * 0.6) + (classification_confidence * 0.4)
        return round(min(max(blended, 0.3), 0.9), 2)
