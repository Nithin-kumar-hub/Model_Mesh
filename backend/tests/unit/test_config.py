"""Unit tests for configuration parsing (stdlib unittest, no deps)."""

from __future__ import annotations

import unittest

from app.config import Settings


class SettingsFromEnvTest(unittest.TestCase):
    def test_defaults(self) -> None:
        s = Settings.from_env({})
        self.assertEqual(s.host, "0.0.0.0")
        self.assertEqual(s.port, 8000)
        self.assertEqual(s.max_retries, 2)
        self.assertEqual(s.request_timeout_s, 30.0)
        self.assertTrue(s.enable_real_providers)
        self.assertIsNone(s.groq_api_key)
        self.assertFalse(s.has_real_provider_keys())
        self.assertFalse(s.real_provider_available())
        self.assertEqual(
            s.cors_origins, ("http://localhost:5173", "http://localhost:4173")
        )

    def test_parsing_and_trimming(self) -> None:
        s = Settings.from_env(
            {
                "GROQ_API_KEY": "gsk_secret",
                "MODELMESH_PORT": "9000",
                "MODELMESH_CORS_ORIGINS": "http://a, http://b ,",
                "MODELMESH_ENABLE_REAL_PROVIDERS": "false",
                "MODELMESH_MAX_RETRIES": "5",
                "MODELMESH_REQUEST_TIMEOUT_S": "12.5",
            }
        )
        self.assertEqual(s.port, 9000)
        self.assertEqual(s.cors_origins, ("http://a", "http://b"))
        self.assertEqual(s.max_retries, 5)
        self.assertEqual(s.request_timeout_s, 12.5)
        self.assertTrue(s.has_real_provider_keys())
        self.assertFalse(s.enable_real_providers)
        # Disabled even though a key exists.
        self.assertFalse(s.real_provider_available())

    def test_empty_key_is_treated_as_absent(self) -> None:
        s = Settings.from_env({"GROQ_API_KEY": ""})
        self.assertIsNone(s.groq_api_key)
        self.assertFalse(s.has_real_provider_keys())

    def test_real_provider_available_when_enabled_and_keyed(self) -> None:
        s = Settings.from_env(
            {"OPENROUTER_API_KEY": "or_secret", "MODELMESH_ENABLE_REAL_PROVIDERS": "true"}
        )
        self.assertTrue(s.real_provider_available())


if __name__ == "__main__":
    unittest.main()
