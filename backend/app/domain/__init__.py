"""ModelMesh domain layer — pure-stdlib value objects, enums, and errors.

This package is framework-free by design: nothing here imports FastAPI,
Pydantic, httpx, or LiteLLM. The routing core depends only on these types, which
keeps business logic testable offline and independent of any provider or transport.

Import ergonomics: ``from app.domain import Task, RoutePlan, ModelMeshError``.
"""

from __future__ import annotations

from .enums import (
    ClassificationSource,
    Complexity,
    ExecutionStatus,
    HealthStatus,
    KeyStatus,
    Modality,
    Strategy,
    TaskType,
)
from .errors import (
    FAILOVER_CODES,
    RETRYABLE_CODES,
    TERMINAL_CODES,
    ContextTooLargeError,
    ErrorCode,
    ExecutionFailedError,
    InvalidInputError,
    InvalidKeyError,
    ModelMeshError,
    NoCompatibleProviderError,
    NoHealthyKeyError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    QuotaExhaustedError,
    RateLimitedError,
    UnsupportedTaskError,
    is_retryable,
    triggers_failover,
)
from .execution import Attempt, ExecutionResult, Usage
from .key import ApiKey, fingerprint, mask
from .provider import ModelSpec, Provider
from .route import RejectedCandidate, Route, RoutePlan
from .serialization import to_jsonable
from .task import Classification, Task, TokenRange, WorkloadProfile

__all__ = [
    # enums
    "ClassificationSource",
    "Complexity",
    "ExecutionStatus",
    "HealthStatus",
    "KeyStatus",
    "Modality",
    "Strategy",
    "TaskType",
    # errors
    "ErrorCode",
    "ModelMeshError",
    "InvalidInputError",
    "UnsupportedTaskError",
    "NoCompatibleProviderError",
    "NoHealthyKeyError",
    "InvalidKeyError",
    "RateLimitedError",
    "QuotaExhaustedError",
    "ContextTooLargeError",
    "ProviderTimeoutError",
    "ProviderUnavailableError",
    "ExecutionFailedError",
    "RETRYABLE_CODES",
    "FAILOVER_CODES",
    "TERMINAL_CODES",
    "is_retryable",
    "triggers_failover",
    # task / analysis
    "Task",
    "Classification",
    "TokenRange",
    "WorkloadProfile",
    # provider
    "ModelSpec",
    "Provider",
    # key
    "ApiKey",
    "fingerprint",
    "mask",
    # route
    "Route",
    "RoutePlan",
    "RejectedCandidate",
    # execution
    "Usage",
    "Attempt",
    "ExecutionResult",
    # serialization
    "to_jsonable",
]
