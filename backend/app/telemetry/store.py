"""Telemetry store for recording execution metadata.

Records usage, latency, routing strategy, model selection, retries, and failovers
for each executed task. Secrets and private data are never stored.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.domain import (
    Classification,
    ExecutionResult,
    ExecutionStatus,
    Strategy,
    WorkloadProfile,
    to_jsonable,
)


@dataclass(frozen=True)
class ExecutionRecord:
    """Immutable record of an executed task."""

    task_id: str
    timestamp: datetime
    status: ExecutionStatus
    provider_id: str | None
    model_id: str | None
    model_ref: str | None
    strategy: str | None
    modality: str
    task_type: str
    complexity: str
    estimated_input_tokens: int
    estimated_output_tokens: int
    actual_input_tokens: int
    actual_output_tokens: int
    actual_total_tokens: int
    latency_ms: float
    retries: int
    failovers: int
    is_mock: bool
    is_estimate_usage: bool
    error_code: str | None = None
    failover_occurred: bool = False


class TelemetryStore:
    """In-memory telemetry store."""

    def __init__(self, max_records: int = 1000) -> None:
        self.max_records = max_records
        self._records: list[ExecutionRecord] = []

    def record(
        self,
        result: ExecutionResult,
        classification: Classification,
        profile: WorkloadProfile,
        strategy: Strategy | None = None,
    ) -> ExecutionRecord:
        """Create and append an execution telemetry record."""
        rec = ExecutionRecord(
            task_id=result.task_id,
            timestamp=datetime.now(timezone.utc),
            status=result.status,
            provider_id=result.provider_id,
            model_id=result.model_id,
            model_ref=result.model_ref,
            strategy=strategy.value if strategy else None,
            modality=classification.modality.value,
            task_type=classification.task_type.value,
            complexity=classification.complexity.value,
            estimated_input_tokens=profile.estimated_input_tokens,
            estimated_output_tokens=profile.estimated_output_tokens.expected,
            actual_input_tokens=result.usage.input_tokens,
            actual_output_tokens=result.usage.output_tokens,
            actual_total_tokens=result.usage.total_tokens,
            latency_ms=result.latency_ms,
            retries=result.retries,
            failovers=result.failovers,
            is_mock=result.is_mock,
            is_estimate_usage=result.usage.is_estimate,
            error_code=result.error_code,
            failover_occurred=result.failover_occurred,
        )

        self._records.append(rec)
        if len(self._records) > self.max_records:
            self._records.pop(0)

        return rec

    def get_history(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return the most recent execution records as JSON-safe dicts."""
        recent = self._records[-limit:]
        recent.reverse()
        return [to_jsonable(r) for r in recent]

    def get_stats(self) -> dict[str, Any]:
        """Aggregate performance and routing metrics."""
        total = len(self._records)
        if total == 0:
            return {
                "total_executions": 0,
                "success_rate": 0.0,
                "total_tokens": 0,
                "avg_latency_ms": 0.0,
                "failover_count": 0,
                "provider_distribution": {},
            }

        successes = sum(1 for r in self._records if r.status == ExecutionStatus.SUCCESS)
        total_tokens = sum(r.actual_total_tokens for r in self._records)
        avg_latency = sum(r.latency_ms for r in self._records) / total
        failovers = sum(1 for r in self._records if r.failover_occurred)

        prov_dist: dict[str, int] = {}
        for r in self._records:
            if r.provider_id:
                prov_dist[r.provider_id] = prov_dist.get(r.provider_id, 0) + 1

        return {
            "total_executions": total,
            "success_rate": round(successes / total, 3),
            "total_tokens": total_tokens,
            "avg_latency_ms": round(avg_latency, 1),
            "failover_count": failovers,
            "provider_distribution": prov_dist,
        }
