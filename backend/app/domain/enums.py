"""Domain enumerations.

All enums derive from ``str`` so they serialise cleanly to JSON at the API edge
and compare naturally with string literals. Phase 1 covers TEXT and CODE; other
modalities are intentionally reserved (not emitted by the Phase 1 classifier) so
Phase 2 can add them without changing these types.
"""

from __future__ import annotations

from enum import Enum


class Modality(str, Enum):
    TEXT = "text"
    CODE = "code"
    # Reserved for Phase 2 (not produced by the Phase 1 classifier/profiler):
    # VISION = "vision"
    # PDF = "pdf"
    # AUDIO = "audio"
    # VIDEO = "video"


class TaskType(str, Enum):
    # Code-oriented
    CODE_GENERATION = "code_generation"
    DEBUGGING = "debugging"
    REFACTORING = "refactoring"
    CODE_EXPLANATION = "code_explanation"
    # Text-oriented
    TEXT_GENERATION = "text_generation"
    SUMMARIZATION = "summarization"
    EXPLANATION = "explanation"
    TRANSLATION = "translation"
    QUESTION_ANSWERING = "question_answering"
    # Fallback
    OTHER = "other"


class Complexity(str, Enum):
    SIMPLE = "simple"
    MEDIUM = "medium"
    COMPLEX = "complex"


class Strategy(str, Enum):
    DRAFT = "draft"
    BALANCED = "balanced"
    PREMIUM = "premium"


class ClassificationSource(str, Enum):
    RULE_BASED = "rule_based"
    # Reserved for Phase 2: ON_DEVICE = "on_device"; CLOUD = "cloud"


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"


class KeyStatus(str, Enum):
    NEW = "new"
    VALIDATING = "validating"
    ACTIVE = "active"
    DEGRADED = "degraded"
    RATE_LIMITED = "rate_limited"
    QUOTA_EXHAUSTED = "quota_exhausted"
    INVALID = "invalid"
    DISABLED = "disabled"


class ExecutionStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
