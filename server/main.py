# server/main.py
import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .agents import get_coordinator
from .config import ALLOWED_ORIGIN_REGEX, ALLOWED_ORIGINS, NVIDIA_API_KEY, PORT
from .routers import analyze, fill

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Server starting on port %d", PORT)
    logger.info("CORS allowed origins: %s (+ regex %s)", ALLOWED_ORIGINS, ALLOWED_ORIGIN_REGEX)
    coordinator = get_coordinator(app)
    # Start the worker pool up-front so the 15 workers are live before the first request.
    await coordinator.ensure_started(NVIDIA_API_KEY or None)
    snap = coordinator.snapshot()
    logger.info("AI pool ready: %d workers (fast=%s, quality=%s)", snap["total"], snap["fast_models"], snap["quality_models"])
    yield
    await coordinator.stop()
    logger.info("Server shutting down")


def create_app() -> FastAPI:
    app = FastAPI(title="RBG Candidate API", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_origin_regex=ALLOWED_ORIGIN_REGEX or None,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "x-api-key"],
    )

    app.include_router(analyze.router)
    app.include_router(fill.router)

    @app.exception_handler(HTTPException)
    async def http_exception_envelope(request: Request, exc: HTTPException) -> JSONResponse:
        """Unwrap dict details so errors always match the {status, message, code} envelope.

        HTTPException bodies default to {"detail": ...}; our routes raise with
        detail already shaped as an ErrorResponse dict, so return it directly.
        """
        if isinstance(exc.detail, dict) and "status" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            content={"status": "error", "message": message, "code": "HTTP_ERROR"},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_envelope(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Return 400 + envelope for Pydantic validation failures (not bare 422)."""
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": f"Invalid request: {exc.errors()[0]['msg'] if exc.errors() else 'validation failed'}",
                "code": "VALIDATION_ERROR",
            },
        )

    @app.get("/health")
    async def health(request: Request) -> dict[str, object]:
        """Liveness + AI pool readiness (used by the extension's Prepare step).

        status: "ok" (all workers available) | "degraded" (some unavailable or
        no key) | "down" (no usable workers). Never exposes the key itself.
        """
        coordinator = get_coordinator(request.app)
        key = os.getenv("NVIDIA_API_KEY", "").strip()
        await coordinator.ensure_started(key or None)
        snap = coordinator.snapshot()
        total = int(snap["total"])
        available = int(snap["available"])
        models = sorted(set(snap["fast_models"]) | set(snap["quality_models"]))
        if total == 0 or available == 0:
            status = "down"
        elif available < total or not key:
            status = "degraded"
        else:
            status = "ok"
        return {
            "status": status,
            "nvidiaApiKeyConfigured": bool(key),
            "workersActive": available,
            "workersTotal": total,
            "models": models,
        }

    return app


app = create_app()