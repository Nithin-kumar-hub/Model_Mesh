"""FastAPI application entrypoint (transport edge only).

Controllers are intentionally thin: the API layer delegates all work to the
pure-Python application services in ``app.*``. This module only wires the app
together and therefore is the ONLY place that imports FastAPI.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="ModelMesh",
        version="0.1.0",
        summary="Universal AI workload router — Phase 1 core (text + code).",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, Any]:
        """Liveness probe. Reports whether real provider keys are configured
        (never the keys themselves)."""
        return {
            "status": "ok",
            "service": "modelmesh",
            "version": "0.1.0",
            "real_providers_configured": settings.has_real_provider_keys(),
        }

    # Feature routers
    from app.api.routes import router as api_router
    app.include_router(api_router)

    return app


app = create_app()
