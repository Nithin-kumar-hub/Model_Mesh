"""Unit tests for the scoring engine and router (M6b)."""

from __future__ import annotations

import unittest

from app.domain import (
    ApiKey,
    Classification,
    ClassificationSource,
    Complexity,
    KeyStatus,
    Modality,
    ModelSpec,
    NoCompatibleProviderError,
    Provider,
    Route,
    RoutePlan,
    Strategy,
    TaskType,
    TokenRange,
    WorkloadProfile,
)
from app.registry import ProviderRegistry
from app.registry.data import MOCK_CODE, MOCK_FAST, MOCK_QUALITY, MOCK_UNAVAILABLE
from app.routing import Router
from app.routing.scorer import score_candidates
from app.routing.weights import WeightProfile


def _profile(input_tokens: int = 500, context: int = 2000) -> WorkloadProfile:
    return WorkloadProfile(
        estimated_input_tokens=input_tokens,
        estimated_output_tokens=TokenRange(200, 400, 600),
        estimated_total_tokens=TokenRange(700, 900, 1100),
        required_context_tokens=context,
        confidence=0.8,
    )


def _classification(modality: Modality = Modality.TEXT) -> Classification:
    return Classification(
        modality=modality,
        task_type=TaskType.EXPLANATION,
        complexity=Complexity.MEDIUM,
        confidence=0.8,
        source=ClassificationSource.RULE_BASED,
    )


class TestScorer(unittest.TestCase):
    def _fast_and_quality(self) -> list[tuple[Provider, ModelSpec, ApiKey | None]]:
        """Two mock candidates: fast (low quality) and quality (high quality)."""
        return [
            (MOCK_FAST, MOCK_FAST.models[0], None),
            (MOCK_QUALITY, MOCK_QUALITY.models[0], None),
        ]

    def test_draft_prefers_fast(self) -> None:
        routes = score_candidates(self._fast_and_quality(), _profile(), Strategy.DRAFT)
        self.assertEqual(len(routes), 2)
        # Draft should prefer the fast model (low latency + efficiency)
        self.assertEqual(routes[0].provider_id, "mock_fast")
        self.assertEqual(routes[0].rank, 1)

    def test_premium_prefers_quality(self) -> None:
        routes = score_candidates(self._fast_and_quality(), _profile(), Strategy.PREMIUM)
        self.assertEqual(routes[0].provider_id, "mock_quality")

    def test_balanced_is_between(self) -> None:
        routes = score_candidates(self._fast_and_quality(), _profile(), Strategy.BALANCED)
        # Both should be scored; order depends on weights
        self.assertEqual(len(routes), 2)
        # All scores should be in [0, 1]
        for r in routes:
            self.assertGreaterEqual(r.score, 0.0)
            self.assertLessEqual(r.score, 1.0)

    def test_scores_are_ranked(self) -> None:
        routes = score_candidates(self._fast_and_quality(), _profile(), Strategy.BALANCED)
        for i, r in enumerate(routes):
            self.assertEqual(r.rank, i + 1)

    def test_reasons_are_populated(self) -> None:
        routes = score_candidates(self._fast_and_quality(), _profile(), Strategy.BALANCED)
        for r in routes:
            self.assertTrue(len(r.reasons) > 0)
            # Should have context_fits reason
            self.assertTrue(any("context_fits" in reason for reason in r.reasons))

    def test_score_breakdown_present(self) -> None:
        routes = score_candidates(self._fast_and_quality(), _profile(), Strategy.BALANCED)
        for r in routes:
            self.assertIn("quality", r.score_breakdown)
            self.assertIn("efficiency", r.score_breakdown)
            self.assertIn("latency", r.score_breakdown)
            self.assertIn("reliability", r.score_breakdown)
            self.assertIn("quota", r.score_breakdown)

    def test_custom_weights(self) -> None:
        # All weight on quality → quality model wins regardless
        w = WeightProfile(quality=1.0, efficiency=0.0, latency=0.0, reliability=0.0, quota=0.0)
        routes = score_candidates(self._fast_and_quality(), _profile(), Strategy.DRAFT, weights=w)
        self.assertEqual(routes[0].provider_id, "mock_quality")

    def test_single_candidate(self) -> None:
        routes = score_candidates(
            [(MOCK_FAST, MOCK_FAST.models[0], None)],
            _profile(), Strategy.BALANCED,
        )
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0].rank, 1)

    def test_empty_candidates(self) -> None:
        routes = score_candidates([], _profile(), Strategy.BALANCED)
        self.assertEqual(len(routes), 0)


class TestRouter(unittest.TestCase):
    def test_basic_route(self) -> None:
        registry = ProviderRegistry(providers=(MOCK_FAST, MOCK_QUALITY))
        router = Router(registry)
        plan = router.route(_classification(), _profile(), Strategy.BALANCED, [])
        self.assertIsInstance(plan, RoutePlan)
        self.assertEqual(plan.strategy, Strategy.BALANCED)
        self.assertEqual(plan.selected.rank, 1)
        self.assertGreater(len(plan.candidates), 0)

    def test_no_candidates_raises(self) -> None:
        # Only CODE model, but requesting TEXT
        registry = ProviderRegistry(providers=(MOCK_CODE,))
        router = Router(registry)
        with self.assertRaises(NoCompatibleProviderError):
            router.route(_classification(Modality.TEXT), _profile(), Strategy.BALANCED, [])

    def test_code_modality_includes_code_specialist(self) -> None:
        registry = ProviderRegistry(providers=(MOCK_FAST, MOCK_CODE))
        router = Router(registry)
        plan = router.route(_classification(Modality.CODE), _profile(), Strategy.BALANCED, [])
        refs = {r.model_ref for r in plan.candidates}
        self.assertIn("mock_code/code-v1", refs)

    def test_unavailable_provider_rejected(self) -> None:
        registry = ProviderRegistry(providers=(MOCK_FAST, MOCK_UNAVAILABLE))
        router = Router(registry)
        plan = router.route(_classification(), _profile(), Strategy.BALANCED, [])
        rejected_refs = {r.model_ref for r in plan.rejected}
        self.assertIn("mock_unavailable/unavail-v1", rejected_refs)

    def test_strategy_differentiation(self) -> None:
        """Same task, different strategies → different selected routes (or at least different scores)."""
        registry = ProviderRegistry(providers=(MOCK_FAST, MOCK_QUALITY))
        router = Router(registry)
        cl = _classification()
        prof = _profile()

        draft_plan = router.route(cl, prof, Strategy.DRAFT, [])
        premium_plan = router.route(cl, prof, Strategy.PREMIUM, [])

        # Draft should prefer fast, Premium should prefer quality
        self.assertEqual(draft_plan.selected.provider_id, "mock_fast")
        self.assertEqual(premium_plan.selected.provider_id, "mock_quality")

    def test_fallbacks_available(self) -> None:
        registry = ProviderRegistry(providers=(MOCK_FAST, MOCK_QUALITY))
        router = Router(registry)
        plan = router.route(_classification(), _profile(), Strategy.BALANCED, [])
        self.assertGreater(len(plan.fallbacks), 0)

    def test_route_plan_serialisable(self) -> None:
        """RoutePlan should be convertible to JSON via to_jsonable."""
        from app.domain import to_jsonable
        import json
        registry = ProviderRegistry(providers=(MOCK_FAST,))
        router = Router(registry)
        plan = router.route(_classification(), _profile(), Strategy.BALANCED, [])
        blob = json.dumps(to_jsonable(plan))
        self.assertIn("mock_fast", blob)


if __name__ == "__main__":
    unittest.main()
