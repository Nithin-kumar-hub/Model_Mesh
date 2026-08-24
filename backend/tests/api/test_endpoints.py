"""API endpoint integration tests using FastAPI TestClient."""

from __future__ import annotations

import unittest

try:
    from fastapi.testclient import TestClient
    from app.main import create_app
    _HAS_FASTAPI = True
except Exception:
    _HAS_FASTAPI = False


@unittest.skipUnless(_HAS_FASTAPI, "FastAPI not installed")
class TestApiEndpoints(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(create_app())

    def test_classify_text_endpoint(self) -> None:
        resp = self.client.post("/classify", json={"input_text": "Explain quantum computing"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["modality"], "text")
        self.assertEqual(data["task_type"], "explanation")
        self.assertIn("confidence", data)

    def test_classify_code_endpoint(self) -> None:
        resp = self.client.post("/classify", json={"input_text": "def sort_list(items):\n    return sorted(items)"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["modality"], "code")

    def test_profile_endpoint(self) -> None:
        resp = self.client.post("/profile", json={"input_text": "Summarize this article: ..." * 10})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("classification", data)
        self.assertIn("profile", data)
        self.assertIn("estimated_output_tokens", data["profile"])

    def test_route_draft_strategy(self) -> None:
        resp = self.client.post(
            "/route",
            json={"input_text": "Write a quick hello world", "strategy": "draft"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["strategy"], "draft")
        self.assertIn("selected", data)
        self.assertIn("candidates", data)
        self.assertGreater(len(data["candidates"]), 0)

    def test_route_premium_strategy(self) -> None:
        resp = self.client.post(
            "/route",
            json={"input_text": "Complex distributed architecture analysis", "strategy": "premium"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["strategy"], "premium")
        self.assertIn("selected", data)

    def test_execute_endpoint_happy_path(self) -> None:
        resp = self.client.post(
            "/execute",
            json={"input_text": "Fix this bug in python", "strategy": "balanced"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertIsNotNone(data["output_text"])
        self.assertIn("usage", data)
        self.assertIn("latency_ms", data)
        self.assertIn("attempts", data)

    def test_providers_endpoint(self) -> None:
        resp = self.client.get("/providers")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)
        provider_ids = [p["id"] for p in data]
        self.assertIn("mock_fast", provider_ids)
        self.assertIn("groq", provider_ids)

    def test_stats_and_history_endpoints(self) -> None:
        # Run an execution first
        self.client.post("/execute", json={"input_text": "Test stats"})

        stats_resp = self.client.get("/stats")
        self.assertEqual(stats_resp.status_code, 200)
        stats = stats_resp.json()
        self.assertGreater(stats["total_executions"], 0)

        history_resp = self.client.get("/history")
        self.assertEqual(history_resp.status_code, 200)
        history = history_resp.json()
        self.assertGreater(len(history), 0)

    def test_validation_error_empty_input(self) -> None:
        resp = self.client.post("/classify", json={"input_text": ""})
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
