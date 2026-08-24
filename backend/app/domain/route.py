"""Routing decision models: RejectedCandidate, Route, RoutePlan.

Produced by the two-stage router:
1. FILTER — incompatible (provider, model) pairs become ``RejectedCandidate``s
   with a machine reason code + human-readable detail.
2. SCORE — survivors become ranked ``Route``s under the chosen strategy, each
   carrying a score breakdown and human-readable reasons ("explain every route").

The full decision is a ``RoutePlan`` (selected route + ranked alternatives +
what was rejected and why), which the API surfaces to the UI.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .enums import Strategy


@dataclass(frozen=True)
class RejectedCandidate:
    """A (provider, model) pair eliminated during the hard-filter stage."""

    model_ref: str  # "provider/model"
    reason_code: str  # e.g. "modality_unsupported", "context_too_small", "no_key", "unhealthy"
    detail: str  # human-readable explanation


@dataclass(frozen=True)
class Route:
    """A scored, selectable candidate route (a provider/model + chosen key)."""

    provider_id: str
    model_id: str
    model_ref: str
    key_label: str | None  # which key would be used (label, never the secret)
    score: float  # final strategy score, 0.0 - 1.0
    rank: int  # 1 = best
    # Per-factor contributions (quality, efficiency, latency, reliability, quota...).
    score_breakdown: dict[str, float] = field(default_factory=dict)
    # Human-readable justifications, e.g. "supports code", "context fits (3.4K/32K)".
    reasons: tuple[str, ...] = ()
    # Estimates carried forward for display (labelled estimates, not billing).
    estimated_cost_usd: float | None = None
    estimated_latency_ms: float | None = None
    is_mock: bool = True


@dataclass(frozen=True)
class RoutePlan:
    """The complete routing decision for one task under one strategy."""

    strategy: Strategy
    selected: Route
    candidates: tuple[Route, ...]  # ranked, includes ``selected`` at rank 1
    rejected: tuple[RejectedCandidate, ...] = ()

    @property
    def fallbacks(self) -> tuple[Route, ...]:
        """Ranked alternatives after the selected route (used by failover)."""
        return tuple(c for c in self.candidates if c.model_ref != self.selected.model_ref)
