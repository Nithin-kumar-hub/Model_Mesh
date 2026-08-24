"""Task input and analysis models: Task, Classification, WorkloadProfile.

These sit at the front of the pipeline:

    Task --(classifier)--> Classification --(profiler)--> WorkloadProfile

All are immutable value objects. Construction stays side-effect free; input
*validation* (empty prompt, oversized input) lives in the API/service layer so
these remain pure data containers.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .enums import (
    ClassificationSource,
    Complexity,
    Modality,
    Strategy,
    TaskType,
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Task:
    """A unit of work submitted by the user.

    Phase 1 handles TEXT and CODE; ``modality_hint`` lets a caller nudge the
    classifier but the classifier is free to override it.
    """

    input_text: str
    strategy: Strategy = Strategy.BALANCED
    modality_hint: Modality | None = None
    max_output_tokens: int | None = None
    id: str = field(default_factory=lambda: _new_id("task"))
    created_at: datetime = field(default_factory=_utcnow)

    @property
    def input_length(self) -> int:
        return len(self.input_text)


@dataclass(frozen=True)
class Classification:
    """Result of the task classifier."""

    modality: Modality
    task_type: TaskType
    complexity: Complexity
    confidence: float  # 0.0 - 1.0
    source: ClassificationSource = ClassificationSource.RULE_BASED
    # Human-readable signals that drove the decision (e.g. "code fence detected").
    signals: tuple[str, ...] = ()


@dataclass(frozen=True)
class TokenRange:
    """Optimistic / expected / pessimistic token estimate.

    ``best`` is the low (fewest tokens) case, ``worst`` the high case. The
    profiler guarantees ``best <= expected <= worst``.
    """

    best: int
    expected: int
    worst: int

    def is_ordered(self) -> bool:
        return 0 <= self.best <= self.expected <= self.worst

    def scaled(self, factor: float) -> "TokenRange":
        return TokenRange(
            best=int(self.best * factor),
            expected=int(self.expected * factor),
            worst=int(self.worst * factor),
        )


@dataclass(frozen=True)
class WorkloadProfile:
    """Provider-independent estimate of a task's resource requirements.

    Everything here is a heuristic ESTIMATE, never a billing figure
    (see ``is_estimate``). ``required_context_tokens`` is the conservative
    number the routing filter compares against each model's context window.
    """

    estimated_input_tokens: int
    estimated_output_tokens: TokenRange
    estimated_total_tokens: TokenRange
    required_context_tokens: int
    confidence: float  # 0.0 - 1.0
    reasons: tuple[str, ...] = ()
    is_estimate: bool = True
