"""Canonical error taxonomy and the ModelMesh exception hierarchy.

External/provider failures are normalised into a small, closed set of
``ErrorCode`` values (see ``app.adapters`` for normalisation). The failover
engine consults ``RETRYABLE_CODES`` / ``FAILOVER_CODES`` / ``TERMINAL_CODES`` to
decide recovery behaviour — the policy lives here as a single source of truth so
it is not scattered across the codebase.
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class ErrorCode(str, Enum):
    # Input / routing
    INVALID_INPUT = "INVALID_INPUT"
    UNSUPPORTED_TASK = "UNSUPPORTED_TASK"
    NO_COMPATIBLE_PROVIDER = "NO_COMPATIBLE_PROVIDER"
    NO_HEALTHY_KEY = "NO_HEALTHY_KEY"
    # Provider / execution (normalised)
    INVALID_KEY = "INVALID_KEY"
    RATE_LIMITED = "RATE_LIMITED"
    QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED"
    CONTEXT_TOO_LARGE = "CONTEXT_TOO_LARGE"
    TIMEOUT = "TIMEOUT"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    BAD_REQUEST = "BAD_REQUEST"
    EXECUTION_FAILED = "EXECUTION_FAILED"
    UNKNOWN = "UNKNOWN"


# Retrying the SAME key/route may succeed (transient). Bounded by policy.
RETRYABLE_CODES: frozenset[ErrorCode] = frozenset(
    {ErrorCode.TIMEOUT, ErrorCode.PROVIDER_UNAVAILABLE, ErrorCode.RATE_LIMITED}
)

# Recoverable by switching to a DIFFERENT key and/or provider.
FAILOVER_CODES: frozenset[ErrorCode] = frozenset(
    {
        ErrorCode.RATE_LIMITED,
        ErrorCode.QUOTA_EXHAUSTED,
        ErrorCode.INVALID_KEY,
        ErrorCode.TIMEOUT,
        ErrorCode.PROVIDER_UNAVAILABLE,
        ErrorCode.CONTEXT_TOO_LARGE,
    }
)

# Never auto-recovered — surfaced to the caller immediately.
TERMINAL_CODES: frozenset[ErrorCode] = frozenset(
    {
        ErrorCode.INVALID_INPUT,
        ErrorCode.UNSUPPORTED_TASK,
        ErrorCode.NO_COMPATIBLE_PROVIDER,
        ErrorCode.BAD_REQUEST,
    }
)


def is_retryable(code: ErrorCode) -> bool:
    """Whether retrying the same key/route is worthwhile."""
    return code in RETRYABLE_CODES


def triggers_failover(code: ErrorCode) -> bool:
    """Whether a different key/provider should be attempted."""
    return code in FAILOVER_CODES


class ModelMeshError(Exception):
    """Base error carrying a canonical :class:`ErrorCode`.

    ``details`` must never contain secrets; error messages are safe to surface
    to clients (no stack traces, no key material).
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        retryable: bool | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable if retryable is not None else (code in RETRYABLE_CODES)
        self.details: dict[str, Any] = dict(details or {})

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code.value, "message": self.message, "details": self.details}

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return f"ModelMeshError(code={self.code.value!r}, message={self.message!r})"


# --- Convenience subclasses (each pins its ErrorCode) ---------------------- #


class InvalidInputError(ModelMeshError):
    def __init__(self, message: str = "Invalid input.", **kw: Any) -> None:
        super().__init__(ErrorCode.INVALID_INPUT, message, **kw)


class UnsupportedTaskError(ModelMeshError):
    def __init__(self, message: str = "Unsupported task.", **kw: Any) -> None:
        super().__init__(ErrorCode.UNSUPPORTED_TASK, message, **kw)


class NoCompatibleProviderError(ModelMeshError):
    def __init__(self, message: str = "No compatible provider/model.", **kw: Any) -> None:
        super().__init__(ErrorCode.NO_COMPATIBLE_PROVIDER, message, **kw)


class NoHealthyKeyError(ModelMeshError):
    def __init__(self, message: str = "No healthy key available.", **kw: Any) -> None:
        super().__init__(ErrorCode.NO_HEALTHY_KEY, message, **kw)


class InvalidKeyError(ModelMeshError):
    def __init__(self, message: str = "Invalid API key.", **kw: Any) -> None:
        super().__init__(ErrorCode.INVALID_KEY, message, **kw)


class RateLimitedError(ModelMeshError):
    def __init__(self, message: str = "Rate limited.", **kw: Any) -> None:
        super().__init__(ErrorCode.RATE_LIMITED, message, **kw)


class QuotaExhaustedError(ModelMeshError):
    def __init__(self, message: str = "Quota exhausted.", **kw: Any) -> None:
        super().__init__(ErrorCode.QUOTA_EXHAUSTED, message, **kw)


class ContextTooLargeError(ModelMeshError):
    def __init__(self, message: str = "Context too large for model.", **kw: Any) -> None:
        super().__init__(ErrorCode.CONTEXT_TOO_LARGE, message, **kw)


class ProviderTimeoutError(ModelMeshError):
    def __init__(self, message: str = "Provider timed out.", **kw: Any) -> None:
        super().__init__(ErrorCode.TIMEOUT, message, **kw)


class ProviderUnavailableError(ModelMeshError):
    def __init__(self, message: str = "Provider unavailable.", **kw: Any) -> None:
        super().__init__(ErrorCode.PROVIDER_UNAVAILABLE, message, **kw)


class ExecutionFailedError(ModelMeshError):
    def __init__(self, message: str = "Execution failed.", **kw: Any) -> None:
        super().__init__(ErrorCode.EXECUTION_FAILED, message, **kw)
