"""Stage 2 — Strategy-based scoring of filtered candidates.

Each surviving (provider, model, key) triple is scored against the chosen
strategy's weight profile. Every route includes a score breakdown and
human-readable reasons so the UI can answer "why this route?".
"""

from __future__ import annotations

from app.domain import (
    ApiKey,
    ModelSpec,
    Provider,
    Route,
    Strategy,
    WorkloadProfile,
)

from .weights import WeightProfile, get_weights


def score_candidates(
    candidates: list[tuple[Provider, ModelSpec, ApiKey | None]],
    profile: WorkloadProfile,
    strategy: Strategy,
    *,
    weights: WeightProfile | None = None,
) -> list[Route]:
    """Score and rank candidates, returning a sorted list of Routes (best first).

    Parameters
    ----------
    candidates
        Survivors from the hard-filter stage, each with an optional best key.
    profile
        The workload profile for cost estimation.
    strategy
        The user-selected routing strategy.
    weights
        Optional override for strategy weights (useful for testing).
    """
    w = weights or get_weights(strategy)
    scored: list[Route] = []

    for provider, model, key in candidates:
        breakdown: dict[str, float] = {}
        reasons: list[str] = []

        # --- Quality factor [0, 1] ---
        q = model.quality_prior
        breakdown["quality"] = round(q, 3)
        if q >= 0.8:
            reasons.append("high_quality")
        elif q >= 0.5:
            reasons.append("moderate_quality")

        # --- Efficiency factor [0, 1] ---
        eff = _efficiency_factor(model, profile)
        breakdown["efficiency"] = round(eff, 3)
        if eff >= 0.7:
            reasons.append("efficient")

        # --- Latency factor [0, 1] ---
        lat = _latency_factor(model)
        breakdown["latency"] = round(lat, 3)
        if lat >= 0.7:
            reasons.append("low_latency")

        # --- Reliability factor [0, 1] ---
        rel = model.reliability_prior
        breakdown["reliability"] = round(rel, 3)
        if rel >= 0.85:
            reasons.append("reliable")

        # --- Quota factor [0, 1] ---
        quota = _quota_factor(key)
        breakdown["quota"] = round(quota, 3)
        if quota >= 0.8:
            reasons.append("healthy_quota")

        # --- Capability reasons ---
        for mod in model.modalities:
            reasons.append(f"supports_{mod.value}")
        reasons.append(
            f"context_fits({profile.required_context_tokens:,}/{model.context_window:,})"
        )
        if key:
            reasons.append("healthy_key")

        # --- Weighted score ---
        score = (
            w.quality * q
            + w.efficiency * eff
            + w.latency * lat
            + w.reliability * rel
            + w.quota * quota
        )
        # Normalise to [0, 1] by dividing by total weight (should be ~1.0)
        if w.total > 0:
            score /= w.total
        score = round(min(max(score, 0.0), 1.0), 4)

        # --- Cost estimate ---
        est_cost = _estimate_cost(model, profile)
        est_latency = _estimate_latency(model, profile)

        scored.append(Route(
            provider_id=provider.id,
            model_id=model.id,
            model_ref=model.ref,
            key_label=key.label if key else None,
            score=score,
            rank=0,  # set below
            score_breakdown=breakdown,
            reasons=tuple(reasons),
            estimated_cost_usd=est_cost,
            estimated_latency_ms=est_latency,
            is_mock=model.is_mock,
        ))

    # Sort by score descending, assign ranks
    scored.sort(key=lambda r: r.score, reverse=True)
    ranked: list[Route] = []
    for i, route in enumerate(scored):
        # Routes are frozen dataclasses — rebuild with correct rank
        ranked.append(Route(
            provider_id=route.provider_id,
            model_id=route.model_id,
            model_ref=route.model_ref,
            key_label=route.key_label,
            score=route.score,
            rank=i + 1,
            score_breakdown=route.score_breakdown,
            reasons=route.reasons,
            estimated_cost_usd=route.estimated_cost_usd,
            estimated_latency_ms=route.estimated_latency_ms,
            is_mock=route.is_mock,
        ))
    return ranked


# -- Factor computation helpers ----------------------------------------


def _efficiency_factor(model: ModelSpec, profile: WorkloadProfile) -> float:
    """Higher is better (cheaper). Returns 0.5 if cost is unknown."""
    if model.cost_per_1k_input_usd is None or model.cost_per_1k_output_usd is None:
        return 0.5  # unknown cost → neutral

    input_cost = (profile.estimated_input_tokens / 1000) * model.cost_per_1k_input_usd
    output_cost = (profile.estimated_output_tokens.expected / 1000) * model.cost_per_1k_output_usd
    total_cost = input_cost + output_cost

    # Normalise: $0 → 1.0, $0.01 → ~0.5, higher → lower score
    # Using a simple inverse: 1 / (1 + cost * 100)
    return 1.0 / (1.0 + total_cost * 100)


def _latency_factor(model: ModelSpec) -> float:
    """Higher is better (faster). Returns 0.5 if latency is unknown."""
    if model.est_latency_ms_per_1k_tokens is None:
        return 0.5

    # Normalise: 10ms → ~0.91, 50ms → ~0.67, 200ms → ~0.33
    return 1.0 / (1.0 + model.est_latency_ms_per_1k_tokens / 100)


def _quota_factor(key: ApiKey | None) -> float:
    """Higher is better (more quota remaining)."""
    if key is None:
        return 0.8  # mock providers don't need keys

    remaining = key.quota_remaining
    if remaining is None:
        return 0.8  # unknown quota → fairly healthy

    limit = key.quota_limit or 1
    return min(remaining / limit, 1.0)


def _estimate_cost(model: ModelSpec, profile: WorkloadProfile) -> float | None:
    """Estimated cost in USD (labelled ESTIMATE). None if unknown."""
    if model.cost_per_1k_input_usd is None or model.cost_per_1k_output_usd is None:
        return None

    input_cost = (profile.estimated_input_tokens / 1000) * model.cost_per_1k_input_usd
    output_cost = (profile.estimated_output_tokens.expected / 1000) * model.cost_per_1k_output_usd
    return round(input_cost + output_cost, 6)


def _estimate_latency(model: ModelSpec, profile: WorkloadProfile) -> float | None:
    """Estimated latency in ms (labelled ESTIMATE). None if unknown."""
    if model.est_latency_ms_per_1k_tokens is None:
        return None

    total_tokens = profile.estimated_total_tokens.expected
    return round((total_tokens / 1000) * model.est_latency_ms_per_1k_tokens, 1)
