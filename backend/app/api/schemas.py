"""Pydantic schemas for the FastAPI transport edge.

Strict request/response validation schemas. These map to and from the pure-Python
domain models, ensuring the API edge never leaks raw keys or internal implementation objects.
"""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field

from app.domain import Complexity, Modality, Strategy, TaskType


# --- Requests ---

class ClassifyRequest(BaseModel):
    input_text: str = Field(..., min_length=1, max_length=100_000, description="The user's prompt")
    modality_hint: Modality | None = Field(None, description="Optional caller hint")


class ProfileRequest(BaseModel):
    input_text: str = Field(..., min_length=1, max_length=100_000, description="The user's prompt")
    modality_hint: Modality | None = Field(None, description="Optional caller hint")
    max_output_tokens: int | None = Field(None, ge=1, le=100_000)


class RouteRequest(BaseModel):
    input_text: str = Field(..., min_length=1, max_length=100_000, description="The user's prompt")
    strategy: Strategy = Field(default=Strategy.BALANCED, description="Routing strategy")
    modality_hint: Modality | None = None
    max_output_tokens: int | None = None


class ExecuteRequest(BaseModel):
    input_text: str = Field(..., min_length=1, max_length=100_000, description="The user's prompt")
    strategy: Strategy = Field(default=Strategy.BALANCED, description="Routing strategy")
    modality_hint: Modality | None = None
    max_output_tokens: int | None = None
    simulate_fault: str | None = Field(
        None, description="Optional fault simulation ('rate_limit', 'timeout', 'quota_exhausted')"
    )


class CompareStrategiesRequest(BaseModel):
    input_text: str = Field(..., min_length=1, max_length=100_000, description="The user's prompt")
    modality_hint: Modality | None = None


class AddKeyRequest(BaseModel):
    provider_id: str
    label: str
    secret: str
    priority: int = 100
    quota_limit: int | None = None


# --- Responses ---

class ClassificationResponse(BaseModel):
    modality: str
    task_type: str
    complexity: str
    confidence: float
    source: str
    signals: list[str]


class TokenRangeResponse(BaseModel):
    best: int
    expected: int
    worst: int


class WorkloadProfileResponse(BaseModel):
    estimated_input_tokens: int
    estimated_output_tokens: TokenRangeResponse
    estimated_total_tokens: TokenRangeResponse
    required_context_tokens: int
    confidence: float
    reasons: list[str]
    is_estimate: bool = True


class ProfilePipelineResponse(BaseModel):
    classification: ClassificationResponse
    profile: WorkloadProfileResponse


class RouteCandidateResponse(BaseModel):
    provider_id: str
    model_id: str
    model_ref: str
    score: float
    rank: int
    score_breakdown: dict[str, float]
    reasons: list[str]
    estimated_cost_usd: float | None
    estimated_latency_ms: float | None
    is_mock: bool


class RejectedCandidateResponse(BaseModel):
    model_ref: str
    reason_code: str
    detail: str


class RoutePlanResponse(BaseModel):
    strategy: str
    selected: RouteCandidateResponse
    candidates: list[RouteCandidateResponse]
    rejected: list[RejectedCandidateResponse]
    classification: ClassificationResponse
    profile: WorkloadProfileResponse


class AttemptResponse(BaseModel):
    provider_id: str
    model_id: str
    model_ref: str
    status: str
    latency_ms: float
    error_code: str | None = None
    detail: str | None = None


class UsageResponse(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int
    is_estimate: bool


class ExecutionResponse(BaseModel):
    task_id: str
    status: str
    provider_id: str | None
    model_id: str | None
    model_ref: str | None
    output_text: str | None
    usage: UsageResponse
    latency_ms: float
    attempts: list[AttemptResponse]
    retries: int
    failovers: int
    is_mock: bool
    failover_occurred: bool
    route_reasons: list[str]
    classification: ClassificationResponse
    profile: WorkloadProfileResponse
    error_code: str | None = None
    error_message: str | None = None


class ProviderModelResponse(BaseModel):
    id: str
    provider_id: str
    display_name: str
    modalities: list[str]
    context_window: int
    max_output_tokens: int
    quality_prior: float
    reliability_prior: float
    is_mock: bool


class ProviderResponse(BaseModel):
    id: str
    display_name: str
    is_mock: bool
    models: list[ProviderModelResponse]


class KeyResponse(BaseModel):
    provider_id: str
    label: str
    fingerprint: str
    mask: str
    status: str
    priority: int
    quota_used: int
    quota_limit: int | None = None
    last_error_code: str | None = None
    is_in_cooldown: bool = False


class CompareStrategiesResponse(BaseModel):
    classification: ClassificationResponse
    profile: WorkloadProfileResponse
    draft: RoutePlanResponse
    balanced: RoutePlanResponse
    premium: RoutePlanResponse
