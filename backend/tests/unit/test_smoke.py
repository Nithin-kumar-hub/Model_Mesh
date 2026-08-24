"""Smoke test: the core package imports using only the standard library."""

from __future__ import annotations

import importlib
import unittest


class PackageImportSmokeTest(unittest.TestCase):
    def test_app_package_importable(self) -> None:
        importlib.import_module("app")

    def test_config_module_exposes_get_settings(self) -> None:
        mod = importlib.import_module("app.config")
        self.assertTrue(hasattr(mod, "get_settings"))
        self.assertTrue(hasattr(mod, "Settings"))


if __name__ == "__main__":
    unittest.main()
