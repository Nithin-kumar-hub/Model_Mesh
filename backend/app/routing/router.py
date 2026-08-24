"""Two-stage router: filter → score → RoutePlan.

This is the core of ModelMesh. It combines the hard filter (Stage 1) and the
strategy scorer (Stage 2) into a single ``route()`` call that produces a
complete ``RoutePlan`` with selected route, ranked alternatives, and rejection
details.
"""

from __future__ import annotations

from app.domain import (
    ApiKey,
    Classification,
    Modality,
    NoCompatibleProviderError,
    RoutePlan,
    Strategy,
    WorkloadProfile,
)
from app.registry import ProviderRegistry

from .filter import filter_candidates
from .scorer import score_candidates


class Router:
    """The ModelMesh routing engine."""

    def __init__(self, registry: ProviderRegistry) -> None:
        self._registry = registry

    def route(
        self,
        classification: Classification,
        profile: WorkloadProfile,
        strategy: Strategy,
        keys: list[ApiKey],
    ) -> RoutePlan:
        """Produce a full routing decision for the given task analysis.

        Raises ``NoCompatibleProviderError`` if no candidate survives filtering.
        """
        modality = classification.modality

        # Stage 1: gather all models for this modality, then filter
        all_candidates = self._registry.models_for_modality(modality)
        survived, rejected = filter_candidates(
            all_candidates, modality, profile, keys
        )

        if not survived:
            raise NoCompatibleProviderError(
                f"No compatible provider/model found for modality={modality.value}, "
                f"required_context={profile.required_context_tokens:,}",
                details={
                    "modality": modality.value,
                    "required_context": profile.required_context_tokens,
                    "rejected_count": len(rejected),
                },
            )

        # Stage 2: score and rank
        ranked = score_candidates(survived, profile, strategy)

        return RoutePlan(
            strategy=strategy,
            selected=ranked[0],
            candidates=tuple(ranked),
            rejected=tuple(rejected),
        )
