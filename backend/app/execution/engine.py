"""Execution engine with integrated retry and failover.

The engine receives a RoutePlan, selects keys, invokes adapters, handles
retries (same key) and failovers (next key or next route), and produces
a complete ExecutionResult with the full attempt trail.

Bounded: max_retries per route, max fallback routes tried. Never loops
indefinitely.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from app.adapters import get_adapter
from app.adapters.protocol import AdapterResult
from app.domain import (
    Attempt,
    ErrorCode,
    ExecutionResult,
    ExecutionStatus,
    ModelMeshError,
    RoutePlan,
    Task,
    Usage,
    is_retryable,
    triggers_failover,
)
from app.keys import KeyManager


@dataclass
class ExecutionConfig:
    """Configurable execution/failover policy."""

    max_retries: int = 2  # retries per route (same key)
    max_failovers: int = 3  # max different routes to try
    request_timeout_s: float = 30.0


class ExecutionEngine:
    """Executes a routed task with retry and failover."""

    def __init__(
        self,
        key_manager: KeyManager,
        config: ExecutionConfig | None = None,
    ) -> None:
        self._km = key_manager
        self._cfg = config or ExecutionConfig()

    def execute(self, task: Task, plan: RoutePlan) -> ExecutionResult:
        """Execute the task following the route plan.

        Tries the selected route first, then fallbacks. Returns a complete
        ExecutionResult regardless of success or failure.
        """
        attempts: list[Attempt] = []
        total_retries = 0
        total_failovers = 0
        start = time.perf_counter()

        # Build the ordered list of routes to try
        routes_to_try = [plan.selected] + list(plan.fallbacks)
        routes_to_try = routes_to_try[: self._cfg.max_failovers + 1]

        for route_idx, route in enumerate(routes_to_try):
            if route_idx > 0:
                total_failovers += 1

            adapter = get_adapter(route.provider_id)

            # Determine the key to use
            key = None
            key_env_var: str | None = None
            if route.key_label:
                # Find the key by label
                for k in self._km.all_keys():
                    if k.label == route.key_label and k.provider_id == route.provider_id:
                        key = k
                        key_env_var = k.env_var
                        break

            # Retry loop for this route
            for retry in range(self._cfg.max_retries + 1):
                if retry > 0:
                    total_retries += 1

                attempt_start = time.perf_counter()
                try:
                    result = adapter.execute(
                        model_id=route.model_id,
                        prompt=task.input_text,
                        key_env_var=key_env_var,
                        max_tokens=task.max_output_tokens,
                        timeout_s=self._cfg.request_timeout_s,
                    )

                    attempt_ms = (time.perf_counter() - attempt_start) * 1000
                    attempts.append(Attempt(
                        provider_id=route.provider_id,
                        model_id=route.model_id,
                        model_ref=route.model_ref,
                        key_label=route.key_label,
                        status=ExecutionStatus.SUCCESS,
                        latency_ms=round(attempt_ms, 1),
                    ))

                    # Mark key success
                    if key:
                        self._km.mark_success(key)
                        self._km.record_usage(key, result.usage.total_tokens)

                    total_ms = (time.perf_counter() - start) * 1000
                    return ExecutionResult(
                        task_id=task.id,
                        status=ExecutionStatus.SUCCESS,
                        provider_id=route.provider_id,
                        model_id=route.model_id,
                        model_ref=route.model_ref,
                        key_label=route.key_label,
                        output_text=result.output_text,
                        usage=result.usage,
                        latency_ms=round(total_ms, 1),
                        attempts=tuple(attempts),
                        retries=total_retries,
                        failovers=total_failovers,
                        is_mock=result.is_mock,
                        route_reasons=route.reasons,
                    )

                except ModelMeshError as err:
                    attempt_ms = (time.perf_counter() - attempt_start) * 1000
                    attempts.append(Attempt(
                        provider_id=route.provider_id,
                        model_id=route.model_id,
                        model_ref=route.model_ref,
                        key_label=route.key_label,
                        status=ExecutionStatus.FAILED,
                        latency_ms=round(attempt_ms, 1),
                        error_code=err.code.value,
                        detail=err.message,
                    ))

                    # Update key health
                    if key:
                        self._km.mark_failure(key, err.code)

                    # Decide: retry same route or failover?
                    if is_retryable(err.code) and retry < self._cfg.max_retries:
                        continue  # retry
                    elif triggers_failover(err.code):
                        break  # try next route
                    else:
                        # Terminal error — stop entirely
                        total_ms = (time.perf_counter() - start) * 1000
                        return self._build_failure(
                            task, err, attempts, total_retries, total_failovers, total_ms
                        )

        # All routes exhausted
        total_ms = (time.perf_counter() - start) * 1000
        last_attempt = attempts[-1] if attempts else None
        return ExecutionResult(
            task_id=task.id,
            status=ExecutionStatus.FAILED,
            provider_id=last_attempt.provider_id if last_attempt else None,
            model_id=last_attempt.model_id if last_attempt else None,
            model_ref=last_attempt.model_ref if last_attempt else None,
            key_label=last_attempt.key_label if last_attempt else None,
            output_text=None,
            usage=Usage.zero(),
            latency_ms=round(total_ms, 1),
            attempts=tuple(attempts),
            retries=total_retries,
            failovers=total_failovers,
            is_mock=True,
            error_code=last_attempt.error_code if last_attempt else ErrorCode.UNKNOWN.value,
            error_message="All routes exhausted after retry/failover",
        )

    def _build_failure(
        self,
        task: Task,
        err: ModelMeshError,
        attempts: list[Attempt],
        retries: int,
        failovers: int,
        total_ms: float,
    ) -> ExecutionResult:
        last = attempts[-1] if attempts else None
        return ExecutionResult(
            task_id=task.id,
            status=ExecutionStatus.FAILED,
            provider_id=last.provider_id if last else None,
            model_id=last.model_id if last else None,
            model_ref=last.model_ref if last else None,
            key_label=last.key_label if last else None,
            output_text=None,
            usage=Usage.zero(),
            latency_ms=round(total_ms, 1),
            attempts=tuple(attempts),
            retries=retries,
            failovers=failovers,
            is_mock=True,
            error_code=err.code.value,
            error_message=err.message,
        )
