"""Configurable strategy weight profiles.

Each strategy defines how much weight to give quality, efficiency, latency,
reliability, and quota health when scoring route candidates. Weights should
sum to 1.0 for interpretability but are normalised by the scorer anyway.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain import Strategy


@dataclass(frozen=True)
class WeightProfile:
    """Per-factor weights for the scoring engine."""

    quality: float
    efficiency: float
    latency: float
    reliability: float
    quota: float

    @property
    def total(self) -> float:
        return self.quality + self.efficiency + self.latency + self.reliability + self.quota


# Strategy weight configurations — easily tunable, no magic numbers.
STRATEGY_WEIGHTS: dict[Strategy, WeightProfile] = {
    Strategy.DRAFT: WeightProfile(
        quality=0.10,
        efficiency=0.40,
        latency=0.30,
        reliability=0.10,
        quota=0.10,
    ),
    Strategy.BALANCED: WeightProfile(
        quality=0.30,
        efficiency=0.20,
        latency=0.15,
        reliability=0.20,
        quota=0.15,
    ),
    Strategy.PREMIUM: WeightProfile(
        quality=0.50,
        efficiency=0.10,
        latency=0.10,
        reliability=0.20,
        quota=0.10,
    ),
}


def get_weights(strategy: Strategy) -> WeightProfile:
    """Return the weight profile for a given strategy."""
    return STRATEGY_WEIGHTS[strategy]
