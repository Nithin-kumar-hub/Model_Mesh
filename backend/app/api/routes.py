"""API route handlers (thin controllers).

Each endpoint delegates to the core services and converts domain objects into
strict JSON-serializable responses using schemas and to_jsonable.
"""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import ServiceContainer, get_container
from app.api.schemas import (
    ClassifyRequest,
    ExecuteRequest,
    ProfilePipelineResponse,
    ProfileRequest,
    ProviderResponse,
    RoutePlanResponse,
    RouteRequest,
)
from app.domain import ModelMeshError, Task, to_jsonable
from app.profiler import get_profiler

router = APIRouter()


@router.post("/classify", tags=["pipeline"])
def classify_task(
    req: ClassifyRequest,
    container: ServiceContainer = Depends(get_container),
) -> dict[str, Any]:
    """Classify a task's modality, task type, complexity, and confidence."""
    task = Task(input_text=req.input_text, modality_hint=req.modality_hint)
    classification = container.classifier.classify(task)
    return to_jsonable(classification)


@router.post("/profile", response_model=ProfilePipelineResponse, tags=["pipeline"])
def profile_task(
    req: ProfileRequest,
    container: ServiceContainer = Depends(get_container),
) -> dict[str, Any]:
    """Classify and profile token requirements for a task."""
    task = Task(
        input_text=req.input_text,
        modality_hint=req.modality_hint,
        max_output_tokens=req.max_output_tokens,
    )
    classification = container.classifier.classify(task)
    profiler = get_profiler(classification.modality)
    profile = profiler.profile(task, classification)

    return {
        "classification": to_jsonable(classification),
        "profile": to_jsonable(profile),
    }


@router.post("/route", response_model=RoutePlanResponse, tags=["pipeline"])
def route_task(
    req: RouteRequest,
    container: ServiceContainer = Depends(get_container),
) -> dict[str, Any]:
    """Analyze a task and determine the recommended execution route and fallbacks."""
    task = Task(
        input_text=req.input_text,
        strategy=req.strategy,
        modality_hint=req.modality_hint,
        max_output_tokens=req.max_output_tokens,
    )
    classification = container.classifier.classify(task)
    profiler = get_profiler(classification.modality)
    profile = profiler.profile(task, classification)

    try:
        plan = container.router.route(
            classification=classification,
            profile=profile,
            strategy=req.strategy,
            keys=container.key_manager.all_keys(),
        )
    except ModelMeshError as err:
        raise HTTPException(status_code=422, detail=err.to_dict())

    return {
        "strategy": plan.strategy.value,
        "selected": to_jsonable(plan.selected),
        "candidates": to_jsonable(list(plan.candidates)),
        "rejected": to_jsonable(list(plan.rejected)),
        "classification": to_jsonable(classification),
        "profile": to_jsonable(profile),
    }


@router.post("/compare-strategies", response_model=CompareStrategiesResponse, tags=["pipeline"])
def compare_strategies(
    req: CompareStrategiesRequest,
    container: ServiceContainer = Depends(get_container),
) -> dict[str, Any]:
    """Compare Draft vs Balanced vs Premium routing decisions side-by-side for the same task."""
    task = Task(input_text=req.input_text, modality_hint=req.modality_hint)
    classification = container.classifier.classify(task)
    profiler = get_profiler(classification.modality)
    profile = profiler.profile(task, classification)

    keys = container.key_manager.all_keys()
    draft_plan = container.router.route(classification, profile, Strategy.DRAFT, keys)
    balanced_plan = container.router.route(classification, profile, Strategy.BALANCED, keys)
    premium_plan = container.router.route(classification, profile, Strategy.PREMIUM, keys)

    def _plan_dict(p: Any) -> dict[str, Any]:
        return {
            "strategy": p.strategy.value,
            "selected": to_jsonable(p.selected),
            "candidates": to_jsonable(list(p.candidates)),
            "rejected": to_jsonable(list(p.rejected)),
            "classification": to_jsonable(classification),
            "profile": to_jsonable(profile),
        }

    return {
        "classification": to_jsonable(classification),
        "profile": to_jsonable(profile),
        "draft": _plan_dict(draft_plan),
        "balanced": _plan_dict(balanced_plan),
        "premium": _plan_dict(premium_plan),
    }


@router.post("/execute", tags=["pipeline"])
def execute_task(
    req: ExecuteRequest,
    container: ServiceContainer = Depends(get_container),
) -> dict[str, Any]:
    """Complete end-to-end pipeline: Classify -> Profile -> Route -> Execute -> Telemetry -> Result."""
    task = Task(
        input_text=req.input_text,
        strategy=req.strategy,
        modality_hint=req.modality_hint,
        max_output_tokens=req.max_output_tokens,
    )
    classification = container.classifier.classify(task)
    profiler = get_profiler(classification.modality)
    profile = profiler.profile(task, classification)

    try:
        plan = container.router.route(
            classification=classification,
            profile=profile,
            strategy=req.strategy,
            keys=container.key_manager.all_keys(),
        )
    except ModelMeshError as err:
        raise HTTPException(status_code=422, detail=err.to_dict())

    # If fault simulation requested (e.g. rate-limit or timeout on primary), adjust plan or keys to simulate
    if req.simulate_fault and plan.candidates:
        # Prepend a failing mock route as primary candidate to trigger automatic failover to the actual route
        from app.domain import Route
        fault_provider = "mock_rate_limited" if req.simulate_fault == "rate_limit" else "mock_timeout"
        fault_route = Route(
            provider_id=fault_provider,
            model_id=f"{fault_provider}-v1",
            model_ref=f"{fault_provider}/{fault_provider}-v1",
            score=0.99,
            rank=1,
            reasons=(f"simulated_fault_{req.simulate_fault}",),
            is_mock=True,
        )
        from app.domain import RoutePlan
        plan = RoutePlan(
            strategy=plan.strategy,
            selected=fault_route,
            candidates=(fault_route,) + tuple(plan.candidates),
            rejected=plan.rejected,
        )

    result = container.executor.execute(task, plan)

    # Record telemetry
    container.telemetry.record(result, classification, profile, req.strategy)

    data = to_jsonable(result)
    data["classification"] = to_jsonable(classification)
    data["profile"] = to_jsonable(profile)
    return data


@router.get("/keys", response_model=list[KeyResponse], tags=["keys"])
def list_keys(
    container: ServiceContainer = Depends(get_container),
) -> list[dict[str, Any]]:
    """List registered API keys (without raw secrets) including status, cooldown, and quota."""
    keys = container.key_manager.all_keys()
    result = []
    for k in keys:
        d = to_jsonable(k)
        d["mask"] = k.mask
        d["is_in_cooldown"] = k.is_in_cooldown()
        result.append(d)
    return result


@router.post("/keys", response_model=KeyResponse, tags=["keys"])
def register_key(
    req: AddKeyRequest,
    container: ServiceContainer = Depends(get_container),
) -> dict[str, Any]:
    """Register a new provider key into the Key Manager (stores no raw secret)."""
    from app.domain import ApiKey
    key = ApiKey.from_secret(
        provider_id=req.provider_id,
        env_var=f"{req.provider_id.upper()}_KEY",
        label=req.label,
        secret=req.secret,
        priority=req.priority,
        quota_limit=req.quota_limit,
    )
    container.key_manager.register_key(key)
    d = to_jsonable(key)
    d["mask"] = key.mask
    d["is_in_cooldown"] = key.is_in_cooldown()
    return d


@router.get("/providers", tags=["registry"])
def list_providers(
    container: ServiceContainer = Depends(get_container),
) -> list[dict[str, Any]]:
    """List all available providers and models."""
    return to_jsonable(container.registry.all_providers())


@router.get("/stats", tags=["telemetry"])
def get_stats(
    container: ServiceContainer = Depends(get_container),
) -> dict[str, Any]:
    """Retrieve telemetry metrics and routing statistics."""
    return container.telemetry.get_stats()


@router.get("/history", tags=["telemetry"])
def get_history(
    limit: int = 20,
    container: ServiceContainer = Depends(get_container),
) -> list[dict[str, Any]]:
    """Retrieve recent task execution history."""
    return container.telemetry.get_history(limit=limit)
