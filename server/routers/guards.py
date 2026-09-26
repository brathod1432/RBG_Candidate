# server/routers/guards.py
"""Shared request guards: client IP, per-IP rate limit, API-key resolution."""

import logging
import os
import time
from collections import defaultdict
from typing import Final

from fastapi import HTTPException, Request, status

from ..config import trust_proxy_headers

logger = logging.getLogger(__name__)

# Naive in-memory per-IP rate limiter (single-instance server by design).
RATE_LIMIT: Final[int] = 30
RATE_WINDOW_SECONDS: Final[int] = 60
_request_log: dict[str, list[float]] = defaultdict(list)


def get_client_ip(request: Request) -> str:
    """Client IP. X-Forwarded-For is only trusted when TRUST_PROXY_HEADERS=1."""
    if trust_proxy_headers():
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(ip: str) -> None:
    """Enforce per-IP rate limit. Raises HTTPException(429) if exceeded."""
    now = time.time()
    window_start = now - RATE_WINDOW_SECONDS
    _request_log[ip] = [ts for ts in _request_log[ip] if ts > window_start]
    if len(_request_log[ip]) >= RATE_LIMIT:
        logger.warning("Rate limit exceeded for IP (count=%d)", len(_request_log[ip]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"status": "error", "message": "Rate limit exceeded", "code": "RATE_LIMITED"},
        )
    _request_log[ip].append(now)


def resolve_api_key(body_key: str | None, header_key: str | None) -> str:
    """BYOK from body, then x-api-key header, then the operator key from env/.env.

    FILL_REQUIRE_BYOK=1 withholds the operator key: the caller must bring
    their own key (protects the operator's quota on public deployments).
    """
    api_key = (body_key or "").strip() or (header_key or "").strip()
    if not api_key:
        if os.getenv("FILL_REQUIRE_BYOK", "").strip() == "1":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "status": "error",
                    "message": "API key required — this server requires your own key (BYOK)",
                    "code": "INVALID_KEY",
                },
            )
        api_key = os.getenv("NVIDIA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"status": "error", "message": "API key required", "code": "INVALID_KEY"},
        )
    return api_key


def upstream_http_error(exc: Exception) -> HTTPException:
    """Map NVIDIA/pool errors to the {status, message, code} envelope."""
    from ..agents import NoWorkersAvailable
    from ..nvidia_client import (
        ModelOutputError,
        NvidiaAuthError,
        NvidiaModelError,
        NvidiaRateLimitError,
        NvidiaTimeoutError,
    )

    if isinstance(exc, NvidiaAuthError):
        code, http, msg = "INVALID_KEY", status.HTTP_403_FORBIDDEN, str(exc)
    elif isinstance(exc, NvidiaRateLimitError):
        code, http, msg = "RATE_LIMITED", status.HTTP_429_TOO_MANY_REQUESTS, str(exc)
    elif isinstance(exc, NvidiaTimeoutError):
        code, http, msg = "UPSTREAM_TIMEOUT", status.HTTP_504_GATEWAY_TIMEOUT, str(exc)
    elif isinstance(exc, (NvidiaModelError, NoWorkersAvailable)):
        code, http, msg = "MODEL_UNAVAILABLE", status.HTTP_502_BAD_GATEWAY, "Configured model unavailable"
    elif isinstance(exc, ModelOutputError):
        code, http, msg = "UPSTREAM_ERROR", status.HTTP_502_BAD_GATEWAY, "Malformed model response"
    else:
        code, http, msg = "UPSTREAM_ERROR", status.HTTP_502_BAD_GATEWAY, "Upstream error"
    return HTTPException(status_code=http, detail={"status": "error", "message": msg, "code": code})
