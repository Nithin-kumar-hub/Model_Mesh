"""Profiler protocol (abstract interface).

Any profiler implementation must satisfy this protocol. Phase 1 ships text and
code profilers; Phase 2 adds PDF, image, audio, video profilers without
changing the router.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.domain import Classification, Task, WorkloadProfile


class ProfilerProtocol(ABC):
    """Contract for workload profilers."""

    @abstractmethod
    def profile(self, task: Task, classification: Classification) -> WorkloadProfile:
        """Estimate the resource requirements for *task* given its *classification*.

        All returned values are heuristic **estimates**, never billing-grade
        figures (``WorkloadProfile.is_estimate`` should remain ``True``).
        """
