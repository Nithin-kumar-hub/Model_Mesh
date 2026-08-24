"""Stage 1 — Hard capability filter.

Eliminates provider/model candidates that cannot serve the task BEFORE any
scoring is attempted. Each rejection records a machine-readable reason code
and a human-readable detail for the UI.
"""

from __future__ import annotations

from app.domain import (
    ApiKey,
    HealthStatus,
    Modality,
    ModelSpec,
    Provider,
    RejectedCandidate,
    WorkloadProfile,
)


def filter_candidates(
    candidates: list[tuple[Provider, ModelSpec]],
    modality: Modality,
    profile: WorkloadProfile,
    keys: list[ApiKey],
    *,
    provider_health: dict[str, HealthStatus] | None = None,
) -> tuple[list[tuple[Provider, ModelSpec, ApiKey | None]], list[RejectedCandidate]]:
    """Apply hard filters and return (survivors, rejected).

    Each survivor is a ``(Provider, ModelSpec, best_key_or_None)`` triple.
    Rejected candidates carry a reason code + detail.

    Parameters
    ----------
    candidates
        (provider, model) pairs from the registry (e.g. ``models_for_modality``).
    modality
        The task's detected modality.
    profile
        Workload profile for context-window filtering.
    keys
        All registered API keys (the filter selects compatible, healthy ones).
    provider_health
        Optional overrides for provider health status. Defaults to each
        provider's ``default_health``.
    """
    survived: list[tuple[Provider, ModelSpec, ApiKey | None]] = []
    rejected: list[RejectedCandidate] = []
    health = provider_health or {}

    for provider, model in candidates:
        ref = model.ref

        # 1. Modality check
        if not model.supports_modality(modality):
            rejected.append(RejectedCandidate(
                model_ref=ref,
                reason_code="modality_unsupported",
                detail=f"{ref} does not support modality '{modality.value}'",
            ))
            continue

        # 2. Context window check
        if not model.fits_context(profile.required_context_tokens):
            rejected.append(RejectedCandidate(
                model_ref=ref,
                reason_code="context_too_small",
                detail=(
                    f"{ref} context window ({model.context_window:,}) "
                    f"< required ({profile.required_context_tokens:,})"
                ),
            ))
            continue

        # 3. Provider health check
        prov_health = health.get(provider.id, provider.default_health)
        if prov_health == HealthStatus.UNAVAILABLE:
            rejected.append(RejectedCandidate(
                model_ref=ref,
                reason_code="provider_unavailable",
                detail=f"{ref} provider '{provider.id}' is unavailable",
            ))
            continue

        # 4. Key availability check (mock providers don't need keys)
        if provider.is_mock:
            survived.append((provider, model, None))
            continue

        compatible_keys = _find_compatible_keys(keys, provider.id, modality)
        if not compatible_keys:
            rejected.append(RejectedCandidate(
                model_ref=ref,
                reason_code="no_compatible_key",
                detail=f"{ref} has no healthy, compatible key for provider '{provider.id}'",
            ))
            continue

        # Pick the best key (lowest priority number, i.e. most preferred)
        best_key = min(compatible_keys, key=lambda k: k.priority)
        survived.append((provider, model, best_key))

    return survived, rejected


def _find_compatible_keys(
    keys: list[ApiKey],
    provider_id: str,
    modality: Modality,
) -> list[ApiKey]:
    """Return keys that are healthy, compatible, and not in cooldown."""
    return [
        k for k in keys
        if k.provider_id == provider_id
        and k.is_selectable
        and k.supports_modality(modality)
        and not k.is_in_cooldown()
    ]
