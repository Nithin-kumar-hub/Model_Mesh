"""Unit tests for the capability filter (M6a)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from app.domain import (
    ApiKey,
    HealthStatus,
    KeyStatus,
    Modality,
    ModelSpec,
    Provider,
    TokenRange,
    WorkloadProfile,
)
from app.routing.filter import filter_candidates


def _model(provider_id: str = "p1", model_id: str = "m1", **kw: object) -> ModelSpec:
    defaults = dict(
        id=model_id,
        provider_id=provider_id,
        display_name=f"Model {model_id}",
        modalities=frozenset({Modality.TEXT, Modality.CODE}),
        context_window=32_768,
        max_output_tokens=4096,
    )
    defaults.update(kw)
    return ModelSpec(**defaults)  # type: ignore[arg-type]


def _provider(pid: str = "p1", mock: bool = True, **kw: object) -> Provider:
    defaults = dict(
        id=pid,
        display_name=f"Provider {pid}",
        models=(_model(provider_id=pid),),
        is_mock=mock,
    )
    defaults.update(kw)
    return Provider(**defaults)  # type: ignore[arg-type]


def _profile(context: int = 1000) -> WorkloadProfile:
    return WorkloadProfile(
        estimated_input_tokens=500,
        estimated_output_tokens=TokenRange(200, 400, 600),
        estimated_total_tokens=TokenRange(700, 900, 1100),
        required_context_tokens=context,
        confidence=0.8,
    )


def _key(provider_id: str = "p1", **kw: object) -> ApiKey:
    defaults = dict(
        provider_id=provider_id,
        env_var="TEST_KEY",
        label="test-key",
        fingerprint="abc123",
        status=KeyStatus.ACTIVE,
    )
    defaults.update(kw)
    return ApiKey(**defaults)  # type: ignore[arg-type]


class TestCapabilityFilter(unittest.TestCase):
    def test_all_pass(self) -> None:
        p = _provider(mock=True)
        candidates = [(p, p.models[0])]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(), [])
        self.assertEqual(len(survived), 1)
        self.assertEqual(len(rejected), 0)

    def test_modality_rejection(self) -> None:
        m = _model(modalities=frozenset({Modality.CODE}))
        p = Provider(id="p1", display_name="P1", models=(m,), is_mock=True)
        candidates = [(p, m)]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(), [])
        self.assertEqual(len(survived), 0)
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0].reason_code, "modality_unsupported")

    def test_context_too_small(self) -> None:
        m = _model(context_window=500)
        p = Provider(id="p1", display_name="P1", models=(m,), is_mock=True)
        candidates = [(p, m)]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(context=1000), [])
        self.assertEqual(len(survived), 0)
        self.assertEqual(rejected[0].reason_code, "context_too_small")

    def test_provider_unavailable(self) -> None:
        p = _provider(mock=True)
        candidates = [(p, p.models[0])]
        survived, rejected = filter_candidates(
            candidates, Modality.TEXT, _profile(), [],
            provider_health={"p1": HealthStatus.UNAVAILABLE},
        )
        self.assertEqual(len(survived), 0)
        self.assertEqual(rejected[0].reason_code, "provider_unavailable")

    def test_no_key_for_real_provider(self) -> None:
        m = _model(provider_id="real1")
        p = Provider(id="real1", display_name="Real", models=(m,), is_mock=False)
        candidates = [(p, m)]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(), [])
        self.assertEqual(len(survived), 0)
        self.assertEqual(rejected[0].reason_code, "no_compatible_key")

    def test_real_provider_with_key_passes(self) -> None:
        m = _model(provider_id="real1")
        p = Provider(id="real1", display_name="Real", models=(m,), is_mock=False)
        key = _key(provider_id="real1")
        candidates = [(p, m)]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(), [key])
        self.assertEqual(len(survived), 1)
        self.assertEqual(survived[0][2], key)

    def test_key_in_cooldown_rejected(self) -> None:
        m = _model(provider_id="real1")
        p = Provider(id="real1", display_name="Real", models=(m,), is_mock=False)
        key = _key(
            provider_id="real1",
            cooldown_until=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
        candidates = [(p, m)]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(), [key])
        self.assertEqual(len(survived), 0)
        self.assertEqual(rejected[0].reason_code, "no_compatible_key")

    def test_disabled_key_rejected(self) -> None:
        m = _model(provider_id="real1")
        p = Provider(id="real1", display_name="Real", models=(m,), is_mock=False)
        key = _key(provider_id="real1", status=KeyStatus.DISABLED)
        candidates = [(p, m)]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(), [key])
        self.assertEqual(len(survived), 0)

    def test_multiple_candidates_mixed(self) -> None:
        """One passes, one fails modality, one fails context."""
        m_ok = _model(provider_id="p1", model_id="ok")
        m_no_mod = _model(provider_id="p2", model_id="nomod", modalities=frozenset({Modality.CODE}))
        m_no_ctx = _model(provider_id="p3", model_id="noctx", context_window=100)
        p1 = Provider(id="p1", display_name="P1", models=(m_ok,), is_mock=True)
        p2 = Provider(id="p2", display_name="P2", models=(m_no_mod,), is_mock=True)
        p3 = Provider(id="p3", display_name="P3", models=(m_no_ctx,), is_mock=True)

        candidates = [(p1, m_ok), (p2, m_no_mod), (p3, m_no_ctx)]
        survived, rejected = filter_candidates(candidates, Modality.TEXT, _profile(), [])
        self.assertEqual(len(survived), 1)
        self.assertEqual(len(rejected), 2)

    def test_all_rejected_produces_empty_survivors(self) -> None:
        m = _model(modalities=frozenset({Modality.CODE}))
        p = Provider(id="p1", display_name="P1", models=(m,), is_mock=True)
        survived, rejected = filter_candidates([(p, m)], Modality.TEXT, _profile(), [])
        self.assertEqual(len(survived), 0)
        self.assertGreater(len(rejected), 0)

    def test_mock_provider_does_not_need_key(self) -> None:
        p = _provider(mock=True)
        survived, _ = filter_candidates([(p, p.models[0])], Modality.TEXT, _profile(), [])
        self.assertEqual(len(survived), 1)
        self.assertIsNone(survived[0][2])  # no key needed


if __name__ == "__main__":
    unittest.main()
