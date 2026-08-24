"""Unit tests for the domain layer (pure stdlib, runnable via unittest)."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone

from app.domain import (
    ApiKey,
    Attempt,
    Classification,
    ClassificationSource,
    Complexity,
    ErrorCode,
    ExecutionResult,
    ExecutionStatus,
    HealthStatus,
    Modality,
    ModelMeshError,
    ModelSpec,
    Provider,
    RateLimitedError,
    Route,
    RoutePlan,
    Strategy,
    Task,
    TaskType,
    TokenRange,
    Usage,
    WorkloadProfile,
    fingerprint,
    is_retryable,
    mask,
    to_jsonable,
)
from app.domain.errors import (
    FAILOVER_CODES,
    RETRYABLE_CODES,
    TERMINAL_CODES,
    triggers_failover,
)
from app.domain.key import fingerprint as key_fingerprint


class TestEnums(unittest.TestCase):
    def test_enums_are_str_and_json_safe(self) -> None:
        self.assertEqual(Strategy.BALANCED, "balanced")
        self.assertEqual(Modality.CODE.value, "code")
        # str-enum serialises cleanly
        self.assertEqual(json.dumps(Strategy.PREMIUM), '"premium"')

    def test_phase1_modalities_only(self) -> None:
        # Guard against accidentally shipping Phase 2 modalities in Phase 1.
        self.assertEqual({m.value for m in Modality}, {"text", "code"})


class TestTaskModels(unittest.TestCase):
    def test_task_defaults(self) -> None:
        t = Task(input_text="hello")
        self.assertEqual(t.strategy, Strategy.BALANCED)
        self.assertEqual(t.input_length, 5)
        self.assertTrue(t.id.startswith("task_"))
        self.assertIsInstance(t.created_at, datetime)

    def test_task_is_frozen(self) -> None:
        t = Task(input_text="x")
        with self.assertRaises(Exception):
            t.input_text = "y"  # type: ignore[misc]

    def test_unique_ids(self) -> None:
        self.assertNotEqual(Task(input_text="a").id, Task(input_text="b").id)

    def test_token_range_ordering(self) -> None:
        tr = TokenRange(best=10, expected=20, worst=30)
        self.assertTrue(tr.is_ordered())
        self.assertFalse(TokenRange(best=30, expected=20, worst=10).is_ordered())

    def test_token_range_scaled(self) -> None:
        tr = TokenRange(best=10, expected=20, worst=30).scaled(2.0)
        self.assertEqual((tr.best, tr.expected, tr.worst), (20, 40, 60))

    def test_workload_profile_is_estimate_by_default(self) -> None:
        p = WorkloadProfile(
            estimated_input_tokens=100,
            estimated_output_tokens=TokenRange(50, 100, 200),
            estimated_total_tokens=TokenRange(150, 200, 300),
            required_context_tokens=300,
            confidence=0.7,
        )
        self.assertTrue(p.is_estimate)


class TestProviderModels(unittest.TestCase):
    def _model(self, **kw: object) -> ModelSpec:
        base = dict(
            id="m1",
            provider_id="p1",
            display_name="Model 1",
            modalities=frozenset({Modality.TEXT, Modality.CODE}),
            context_window=8192,
            max_output_tokens=2048,
        )
        base.update(kw)
        return ModelSpec(**base)  # type: ignore[arg-type]

    def test_model_ref_and_capabilities(self) -> None:
        m = self._model()
        self.assertEqual(m.ref, "p1/m1")
        self.assertTrue(m.supports_modality(Modality.CODE))
        self.assertTrue(m.fits_context(8192))
        self.assertFalse(m.fits_context(8193))

    def test_provider_model_lookup(self) -> None:
        m = self._model()
        p = Provider(id="p1", display_name="P1", models=(m,))
        self.assertIs(p.model("m1"), m)
        self.assertIsNone(p.model("missing"))
        self.assertEqual(p.default_health, HealthStatus.HEALTHY)


class TestKeySecurity(unittest.TestCase):
    def test_fingerprint_is_one_way_and_short(self) -> None:
        fp = fingerprint("sk-super-secret-value")
        self.assertEqual(len(fp), 12)
        self.assertNotIn("secret", fp)
        # deterministic
        self.assertEqual(fp, fingerprint("sk-super-secret-value"))
        self.assertEqual(fingerprint(""), "unknown")

    def test_mask_reveals_only_tail(self) -> None:
        self.assertEqual(mask("sk-abcd1234"), "…1234")
        self.assertEqual(mask(""), "…")

    def test_apikey_never_stores_secret(self) -> None:
        secret = "sk-DO-NOT-LEAK-0001"
        key = ApiKey.from_secret(
            provider_id="groq",
            env_var="GROQ_API_KEY",
            label="groq-primary",
            secret=secret,
        )
        # The secret must not appear anywhere in the serialised handle.
        blob = json.dumps(to_jsonable(key))
        self.assertNotIn(secret, blob)
        self.assertNotIn("DO-NOT-LEAK", blob)
        # Only the fingerprint (one-way) is present.
        self.assertEqual(key.fingerprint, key_fingerprint(secret))
        self.assertIn(key.fingerprint, blob)

    def test_apikey_quota_and_selectable(self) -> None:
        key = ApiKey(
            provider_id="groq",
            env_var="GROQ_API_KEY",
            label="k",
            fingerprint="abc",
            quota_limit=1000,
            quota_used=250,
        )
        self.assertEqual(key.quota_remaining, 750)
        self.assertTrue(key.is_selectable)  # NEW is selectable
        self.assertTrue(key.supports_modality(Modality.TEXT))

    def test_cooldown(self) -> None:
        now = datetime.now(timezone.utc)
        key = ApiKey(
            provider_id="p",
            env_var="E",
            label="k",
            fingerprint="abc",
            cooldown_until=now + timedelta(seconds=30),
        )
        self.assertTrue(key.is_in_cooldown(now))
        self.assertFalse(key.is_in_cooldown(now + timedelta(seconds=31)))


class TestErrorTaxonomy(unittest.TestCase):
    def test_error_carries_code_and_message(self) -> None:
        err = RateLimitedError("slow down", details={"provider": "groq"})
        self.assertEqual(err.code, ErrorCode.RATE_LIMITED)
        self.assertTrue(err.retryable)
        self.assertEqual(err.to_dict()["code"], "RATE_LIMITED")
        self.assertEqual(err.to_dict()["details"]["provider"], "groq")

    def test_base_error_default_retryable_from_code(self) -> None:
        self.assertTrue(ModelMeshError(ErrorCode.TIMEOUT, "t").retryable)
        self.assertFalse(ModelMeshError(ErrorCode.INVALID_INPUT, "i").retryable)

    def test_policy_sets_are_consistent(self) -> None:
        # Retryable codes must also be failover-eligible (retry same, then switch).
        self.assertTrue(RETRYABLE_CODES.issubset(FAILOVER_CODES))
        # Terminal codes must never be retryable or failover-eligible.
        self.assertEqual(TERMINAL_CODES & RETRYABLE_CODES, frozenset())
        self.assertEqual(TERMINAL_CODES & FAILOVER_CODES, frozenset())

    def test_policy_helpers(self) -> None:
        self.assertTrue(is_retryable(ErrorCode.TIMEOUT))
        self.assertFalse(is_retryable(ErrorCode.QUOTA_EXHAUSTED))
        self.assertTrue(triggers_failover(ErrorCode.QUOTA_EXHAUSTED))
        self.assertFalse(triggers_failover(ErrorCode.INVALID_INPUT))

    def test_message_has_no_secret_by_construction(self) -> None:
        # Errors carry only what callers pass; ensure to_dict is clean/serialisable.
        err = ModelMeshError(ErrorCode.EXECUTION_FAILED, "boom")
        json.dumps(err.to_dict())


class TestRouteAndExecution(unittest.TestCase):
    def _route(self, ref: str, rank: int, score: float) -> Route:
        pid, mid = ref.split("/")
        return Route(
            provider_id=pid,
            model_id=mid,
            model_ref=ref,
            key_label="k",
            score=score,
            rank=rank,
            reasons=("supports code",),
        )

    def test_routeplan_fallbacks_exclude_selected(self) -> None:
        r1 = self._route("p/a", 1, 0.9)
        r2 = self._route("p/b", 2, 0.7)
        plan = RoutePlan(strategy=Strategy.BALANCED, selected=r1, candidates=(r1, r2))
        self.assertEqual(plan.fallbacks, (r2,))

    def test_execution_result_flags(self) -> None:
        res = ExecutionResult(
            task_id="task_1",
            status=ExecutionStatus.SUCCESS,
            provider_id="p",
            model_id="a",
            model_ref="p/a",
            key_label="k",
            output_text="MOCK: done",
            usage=Usage(10, 20, 30),
            latency_ms=12.5,
            attempts=(
                Attempt("p", "a", "p/a", "k", ExecutionStatus.SUCCESS, 12.5),
            ),
            failovers=1,
        )
        self.assertTrue(res.ok)
        self.assertTrue(res.failover_occurred)

    def test_usage_zero_is_estimate(self) -> None:
        self.assertTrue(Usage.zero().is_estimate)


class TestSerialization(unittest.TestCase):
    def test_roundtrip_is_json_safe(self) -> None:
        c = Classification(
            modality=Modality.CODE,
            task_type=TaskType.CODE_GENERATION,
            complexity=Complexity.MEDIUM,
            confidence=0.82,
            source=ClassificationSource.RULE_BASED,
            signals=("code fence detected",),
        )
        blob = json.dumps(to_jsonable(c))
        data = json.loads(blob)
        self.assertEqual(data["modality"], "code")
        self.assertEqual(data["task_type"], "code_generation")
        self.assertEqual(data["signals"], ["code fence detected"])

    def test_nested_and_datetime(self) -> None:
        t = Task(input_text="hi")
        data = to_jsonable(t)
        # datetime became an ISO string
        self.assertIsInstance(data["created_at"], str)
        json.dumps(data)  # must not raise

    def test_enum_and_container_conversion(self) -> None:
        self.assertEqual(to_jsonable(Strategy.DRAFT), "draft")
        self.assertEqual(to_jsonable({Modality.TEXT, Modality.CODE}).__class__, list)
        # Sets serialise deterministically (already sorted) for stable responses.
        self.assertEqual(to_jsonable(frozenset({"b", "a"})), ["a", "b"])
        self.assertEqual(to_jsonable({Modality.TEXT, Modality.CODE}), ["code", "text"])


if __name__ == "__main__":
    unittest.main()
