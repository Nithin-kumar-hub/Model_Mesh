"""Classifier protocol (abstract interface).

Any classifier implementation must satisfy this protocol. Phase 1 ships a
deterministic rule-based classifier; Phase 2 may add on-device or cloud
classifiers without changing the downstream pipeline.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.domain import Classification, Task


class ClassifierProtocol(ABC):
    """Contract for task classifiers."""

    @abstractmethod
    def classify(self, task: Task) -> Classification:
        """Analyse *task* and return a classification.

        Must never raise for valid Task instances. If the classifier cannot
        determine the modality/task-type with confidence it should return a
        low-confidence classification with ``TaskType.OTHER``.
        """
