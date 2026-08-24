"""Task classifier package.

Phase 1 ships a deterministic rule-based classifier. The ``ClassifierProtocol``
allows Phase 2 to swap in on-device or cloud-based classifiers without touching
the routing pipeline.
"""

from __future__ import annotations

from .protocol import ClassifierProtocol
from .rule_based import RuleBasedClassifier

__all__ = ["ClassifierProtocol", "RuleBasedClassifier"]
