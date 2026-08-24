"""Unit tests for the provider registry (M5)."""

from __future__ import annotations

import unittest

from app.domain import HealthStatus, Modality, ModelSpec, Provider
from app.registry import ALL_PROVIDERS, MOCK_PROVIDERS, REAL_PROVIDERS, ProviderRegistry
from app.registry.data import GROQ, MOCK_CODE, MOCK_FAST, MOCK_UNAVAILABLE, OPENROUTER


class TestRegistryData(unittest.TestCase):
    def test_all_providers_populated(self) -> None:
        self.assertGreater(len(ALL_PROVIDERS), 0)

    def test_mock_and_real_partition(self) -> None:
        self.assertTrue(all(p.is_mock for p in MOCK_PROVIDERS))
        self.assertTrue(all(not p.is_mock for p in REAL_PROVIDERS))
        self.assertEqual(len(MOCK_PROVIDERS) + len(REAL_PROVIDERS), len(ALL_PROVIDERS))

    def test_mock_providers_have_seven(self) -> None:
        self.assertEqual(len(MOCK_PROVIDERS), 7)

    def test_real_providers_have_groq_and_openrouter(self) -> None:
        ids = {p.id for p in REAL_PROVIDERS}
        self.assertIn("groq", ids)
        self.assertIn("openrouter", ids)

    def test_every_model_has_required_fields(self) -> None:
        for p in ALL_PROVIDERS:
            for m in p.models:
                self.assertTrue(m.id)
                self.assertEqual(m.provider_id, p.id)
                self.assertTrue(m.display_name)
                self.assertGreater(m.context_window, 0)
                self.assertGreater(m.max_output_tokens, 0)
                self.assertTrue(len(m.modalities) > 0)

    def test_groq_models(self) -> None:
        self.assertEqual(len(GROQ.models), 3)
        ids = {m.id for m in GROQ.models}
        self.assertIn("llama-3.3-70b-versatile", ids)
        self.assertIn("llama-3.1-8b-instant", ids)
        self.assertIn("mixtral-8x7b-32768", ids)

    def test_real_models_have_litellm_id(self) -> None:
        for p in REAL_PROVIDERS:
            for m in p.models:
                self.assertIsNotNone(m.litellm_id, f"{m.ref} missing litellm_id")
                self.assertFalse(m.is_mock)

    def test_mock_unavailable_has_unavailable_health(self) -> None:
        self.assertEqual(MOCK_UNAVAILABLE.default_health, HealthStatus.UNAVAILABLE)


class TestProviderRegistry(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = ProviderRegistry()

    def test_all_providers(self) -> None:
        self.assertEqual(len(self.registry.all_providers()), len(ALL_PROVIDERS))

    def test_get_provider(self) -> None:
        p = self.registry.get_provider("groq")
        self.assertIsNotNone(p)
        self.assertEqual(p.id, "groq")

    def test_get_provider_missing(self) -> None:
        self.assertIsNone(self.registry.get_provider("nonexistent"))

    def test_get_model(self) -> None:
        m = self.registry.get_model("groq", "llama-3.3-70b-versatile")
        self.assertIsNotNone(m)
        self.assertEqual(m.id, "llama-3.3-70b-versatile")

    def test_get_model_missing(self) -> None:
        self.assertIsNone(self.registry.get_model("groq", "nonexistent"))
        self.assertIsNone(self.registry.get_model("nonexistent", "x"))

    def test_all_models(self) -> None:
        models = self.registry.all_models()
        total = sum(len(p.models) for p in ALL_PROVIDERS)
        self.assertEqual(len(models), total)

    def test_models_for_modality_text(self) -> None:
        pairs = self.registry.models_for_modality(Modality.TEXT)
        # Mock code specialist only supports CODE, not TEXT
        refs = {m.ref for _, m in pairs}
        self.assertNotIn("mock_code/code-v1", refs)
        self.assertGreater(len(pairs), 0)

    def test_models_for_modality_code(self) -> None:
        pairs = self.registry.models_for_modality(Modality.CODE)
        refs = {m.ref for _, m in pairs}
        self.assertIn("mock_code/code-v1", refs)

    def test_register_and_remove(self) -> None:
        custom = Provider(
            id="custom", display_name="Custom", is_mock=True,
            models=(
                ModelSpec(
                    id="c1", provider_id="custom", display_name="C1",
                    modalities=frozenset({Modality.TEXT}),
                    context_window=4096, max_output_tokens=1024,
                ),
            ),
        )
        self.registry.register_provider(custom)
        self.assertIsNotNone(self.registry.get_provider("custom"))
        self.assertTrue(self.registry.remove_provider("custom"))
        self.assertIsNone(self.registry.get_provider("custom"))

    def test_custom_registry_subset(self) -> None:
        """Registry can be constructed with a subset of providers."""
        reg = ProviderRegistry(providers=(MOCK_FAST,))
        self.assertEqual(len(reg.all_providers()), 1)
        self.assertEqual(reg.all_providers()[0].id, "mock_fast")


if __name__ == "__main__":
    unittest.main()
