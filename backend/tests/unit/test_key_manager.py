"""Unit tests for the key manager (M8a)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from app.domain import ApiKey, ErrorCode, KeyStatus, Modality, NoHealthyKeyError
from app.keys import KeyManager


def _key(provider_id: str = "groq", label: str = "k1", priority: int = 100, **kw: object) -> ApiKey:
    defaults = dict(
        provider_id=provider_id,
        env_var=f"{provider_id.upper()}_KEY",
        label=label,
        fingerprint=f"fp_{label}",
        priority=priority,
        status=KeyStatus.NEW,
    )
    defaults.update(kw)
    return ApiKey(**defaults)  # type: ignore[arg-type]


class TestKeyRegistration(unittest.TestCase):
    def test_register_activates_new_key(self) -> None:
        km = KeyManager()
        k = _key()
        km.register_key(k)
        self.assertEqual(k.status, KeyStatus.ACTIVE)

    def test_register_multiple(self) -> None:
        km = KeyManager()
        km.register_keys([_key(label="a"), _key(label="b")])
        self.assertEqual(len(km.all_keys()), 2)

    def test_keys_for_provider(self) -> None:
        km = KeyManager()
        km.register_keys([_key(provider_id="groq"), _key(provider_id="openrouter")])
        self.assertEqual(len(km.keys_for_provider("groq")), 1)
        self.assertEqual(len(km.keys_for_provider("openrouter")), 1)


class TestKeySelection(unittest.TestCase):
    def test_select_best_by_priority(self) -> None:
        km = KeyManager()
        high = _key(label="high", priority=50)
        low = _key(label="low", priority=200)
        km.register_keys([low, high])
        selected = km.select_key("groq", Modality.TEXT)
        self.assertEqual(selected.label, "high")

    def test_select_no_key_raises(self) -> None:
        km = KeyManager()
        with self.assertRaises(NoHealthyKeyError):
            km.select_key("groq", Modality.TEXT)

    def test_select_skips_disabled(self) -> None:
        km = KeyManager()
        disabled = _key(label="disabled", priority=1, status=KeyStatus.DISABLED)
        active = _key(label="active", priority=100)
        km.register_key(disabled)
        km.register_key(active)
        selected = km.select_key("groq", Modality.TEXT)
        self.assertEqual(selected.label, "active")

    def test_select_skips_cooldown(self) -> None:
        km = KeyManager()
        cooling = _key(label="cooling", priority=1)
        km.register_key(cooling)
        cooling.cooldown_until = datetime.now(timezone.utc) + timedelta(minutes=5)
        ok = _key(label="ok", priority=100)
        km.register_key(ok)
        selected = km.select_key("groq", Modality.TEXT)
        self.assertEqual(selected.label, "ok")

    def test_compatible_keys_filters_modality(self) -> None:
        km = KeyManager()
        text_only = _key(label="text_only", modalities=frozenset({Modality.TEXT}))
        km.register_key(text_only)
        self.assertEqual(len(km.compatible_keys("groq", Modality.TEXT)), 1)
        self.assertEqual(len(km.compatible_keys("groq", Modality.CODE)), 0)

    def test_select_prefers_more_quota(self) -> None:
        km = KeyManager()
        depleted = _key(label="depleted", priority=100, quota_limit=1000, quota_used=900)
        fresh = _key(label="fresh", priority=100, quota_limit=1000, quota_used=100)
        km.register_keys([depleted, fresh])
        selected = km.select_key("groq", Modality.TEXT)
        self.assertEqual(selected.label, "fresh")


class TestHealthTracking(unittest.TestCase):
    def test_mark_success_resets_failures(self) -> None:
        km = KeyManager()
        k = _key()
        km.register_key(k)
        k.consecutive_failures = 5
        k.status = KeyStatus.DEGRADED
        km.mark_success(k)
        self.assertEqual(k.consecutive_failures, 0)
        self.assertEqual(k.status, KeyStatus.ACTIVE)

    def test_mark_failure_rate_limited(self) -> None:
        km = KeyManager()
        k = _key()
        km.register_key(k)
        km.mark_failure(k, ErrorCode.RATE_LIMITED, cooldown_seconds=60)
        self.assertEqual(k.status, KeyStatus.RATE_LIMITED)
        self.assertIsNotNone(k.cooldown_until)

    def test_mark_failure_quota_exhausted(self) -> None:
        km = KeyManager()
        k = _key(quota_limit=1000)
        km.register_key(k)
        km.mark_failure(k, ErrorCode.QUOTA_EXHAUSTED)
        self.assertEqual(k.status, KeyStatus.QUOTA_EXHAUSTED)

    def test_mark_failure_invalid_key(self) -> None:
        km = KeyManager()
        k = _key()
        km.register_key(k)
        km.mark_failure(k, ErrorCode.INVALID_KEY)
        self.assertEqual(k.status, KeyStatus.INVALID)

    def test_consecutive_failures_degrade(self) -> None:
        km = KeyManager()
        k = _key()
        km.register_key(k)
        for _ in range(3):
            km.mark_failure(k, ErrorCode.TIMEOUT)
        self.assertEqual(k.status, KeyStatus.DEGRADED)

    def test_record_usage_exhausts_quota(self) -> None:
        km = KeyManager()
        k = _key(quota_limit=100)
        km.register_key(k)
        km.record_usage(k, 100)
        self.assertEqual(k.status, KeyStatus.QUOTA_EXHAUSTED)

    def test_record_usage_partial(self) -> None:
        km = KeyManager()
        k = _key(quota_limit=1000)
        km.register_key(k)
        km.record_usage(k, 500)
        self.assertEqual(k.quota_used, 500)
        self.assertEqual(k.status, KeyStatus.ACTIVE)


if __name__ == "__main__":
    unittest.main()
