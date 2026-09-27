# server/routers/fill.py
"""POST /fill — coordinator splits a form into tasks for the AI worker pool.
GET /workers — live pool status (no keys, no PII)."""

import logging
import os

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import APIKeyHeader

from ..agents import get_coordinator
from ..nvidia_client import NvidiaError
from ..schemas import ErrorResponse, FillRequest, FillResponse
from ..utils.vault import record_fill
from .guards import (
    check_rate_limit,
    get_client_ip,
    resolve_api_key,
    upstream_http_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["fill"])


@router.post(
    "/fill",
    response_model=FillResponse,
    responses={
        400: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
    status_code=status.HTTP_200_OK,
)
async def fill_form(
    request: Request,
    payload: FillRequest,
    api_key_header: str | None = Depends(APIKeyHeader(name="x-api-key", auto_error=False)),
) -> FillResponse:
    """Answer every described field: profile matches locally, the rest via workers."""
    check_rate_limit(get_client_ip(request))
    api_key = resolve_api_key(payload.api_key, api_key_header)
    logger.info("Fill request (fields=%d)", len(payload.fields))
    coordinator = get_coordinator(request.app)
    try:
        await coordinator.ensure_started(api_key)
        data = await coordinator.fill(payload, api_key)
    except NvidiaError as exc:
        raise upstream_http_error(exc) from exc
    # History vault: every answered field is appended (DPAPI-encrypted,
    # non-blocking) to %APPDATA%\RBG_Candidate\history — 60-day TTL.
    record_fill(data.answers, payload.fields, payload.job.url if payload.job else None)
    return FillResponse(status="ok", data=data)


@router.get("/workers")
async def workers_status(request: Request) -> dict[str, object]:
    """Pool snapshot: worker ids, models, state, counters."""
    coordinator = get_coordinator(request.app)
    await coordinator.ensure_started(os.getenv("NVIDIA_API_KEY") or None)
    return coordinator.snapshot()
