"""Execution models: Usage, Attempt, ExecutionResult.

The execution engine (M7b) runs the selected route, and the failover engine
(M8b) may make several attempts across keys/providers. Each try is recorded as
an ``Attempt`` (the failover trail); the final outcome is an ``ExecutionResult``.

No fabrication:
- ``Usage.is_estimate`` is True when the provider did not return real token
  counts and we fell back to the profiler's estimate.
- ``is_mock`` marks output produced by a deterministic mock adapter.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .enums import ExecutionStatus


@dataclass(frozen=True)
class Usage:
    """Token usage for one execution."""

    input_tokens: int
    output_tokens: int
    total_tokens: int
    # True => derived from the profiler estimate, not reported by the provider.
    is_estimate: bool = False

    @classmethod
    def zero(cls) -> "Usage":
        return cls(0, 0, 0, is_estimate=True)


@dataclass(frozen=True)
class Attempt:
    """One provider/key attempt in the failover trail."""

    provider_id: str
    model_id: str
    model_ref: str
    key_label: str | None
    status: ExecutionStatus
    latency_ms: float
    error_code: str | None = None  # canonical ErrorCode value if failed
    detail: str | None = None  # safe, redacted message (never secrets)


@dataclass(frozen=True)
class ExecutionResult:
    """Final outcome of executing a task (after any retries/failover)."""

    task_id: str
    status: ExecutionStatus
    # Winning route (or last tried, if all failed).
    provider_id: str | None
    model_id: str | None
    model_ref: str | None
    key_label: str | None

    output_text: str | None
    usage: Usage
    latency_ms: float  # total wall-clock across all attempts

    attempts: tuple[Attempt, ...] = ()
    retries: int = 0  # same-route retries
    failovers: int = 0  # switches to a different route/key
    is_mock: bool = True

    # Populated on failure (canonical ErrorCode value + safe message).
    error_code: str | None = None
    error_message: str | None = None

    # Route justification carried through for the result screen.
    route_reasons: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.status is ExecutionStatus.SUCCESS

    @property
    def failover_occurred(self) -> bool:
        return self.failovers > 0
