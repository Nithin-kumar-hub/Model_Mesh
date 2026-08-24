"""Pytest fixtures.

Used only when the suite is run via pytest on a machine where dependencies are
installed. The offline build sandbox runs the core suite via ``unittest``, which
does not import this file. Imports are therefore kept lazy.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def client():  # type: ignore[no-untyped-def]
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())
