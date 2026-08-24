"""Health endpoint test.

Skipped automatically when FastAPI is not installed (e.g. the offline build
sandbox). Runs normally on any machine after ``pip install -r requirements.txt``.
"""

from __future__ import annotations

import unittest

try:
    from fastapi.testclient import TestClient

    from app.main import create_app

    _HAS_FASTAPI = True
except Exception:  # pragma: no cover - exercised only where FastAPI is absent
    _HAS_FASTAPI = False


@unittest.skipUnless(_HAS_FASTAPI, "FastAPI not installed in this environment")
class HealthEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(create_app())

    def test_health_ok(self) -> None:
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "modelmesh")
        self.assertIsInstance(body["real_providers_configured"], bool)

    def test_health_never_leaks_keys(self) -> None:
        resp = self.client.get("/health")
        self.assertNotIn("api_key", resp.text.lower())


if __name__ == "__main__":
    unittest.main()
