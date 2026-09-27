# server/routers/analyze.py
"""POST /analyze — legacy single-call HTML analysis, now executed by a pool worker."""

import logging

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import APIKeyHeader

from ..agents import get_coordinator
from ..nvidia_client import ModelOutputError, NvidiaError, extract_json_object
from ..schemas import AnalyzeData, AnalyzeResponse, ErrorResponse, FormRequest
from .guards import (
    check_rate_limit,
    get_client_ip,
    resolve_api_key,
    upstream_http_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analyze", tags=["analyze"])


def _coerce_data(parsed: dict[str, object]) -> AnalyzeData:
    fields_raw = parsed.get("fields", {})
    conf_raw = parsed.get("confidence", {})
    fields = {str(k): "" if v is None else str(v) for k, v in fields_raw.items()} if isinstance(fields_raw, dict) else {}
    confidence: dict[str, float] = {}
    if isinstance(conf_raw, dict):
        for k, v in conf_raw.items():
            try:
                confidence[str(k)] = max(0.0, min(1.0, float(v)))
            except (TypeError, ValueError):
                continue
    try:
        stage = int(str(parsed.get("stage", 1)).strip() or 1)
    except ValueError:
        stage = 1
    return AnalyzeData(fields=fields, stage=stage, confidence=confidence)


@router.post(
    "",
    response_model=AnalyzeResponse,
    responses={
        400: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
    status_code=status.HTTP_200_OK,
)
async def analyze_form(
    request: Request,
    payload: FormRequest,
    api_key_header: str | None = Depends(APIKeyHeader(name="x-api-key", auto_error=False)),
) -> AnalyzeResponse:
    """Analyze an HTML form snippet with one quality-tier worker."""
    ip = get_client_ip(request)
    check_rate_limit(ip)
    api_key = resolve_api_key(payload.api_key, api_key_header)
    logger.info("Analyze request (html_len=%d)", len(payload.html))

    coordinator = get_coordinator(request.app)
    try:
        await coordinator.ensure_started(api_key)
        result = await coordinator.analyze(api_key, payload.html)
        data = _coerce_data(extract_json_object(result.content))
    except ModelOutputError as exc:
        logger.error("Failed to parse model response as JSON")
        raise upstream_http_error(exc) from exc
    except NvidiaError as exc:
        raise upstream_http_error(exc) from exc

    logger.info("Analyze success (fields=%d, stage=%d)", len(data.fields), data.stage)
    return AnalyzeResponse(status="ok", data=data)

