# server/nvidia_client.py
"""Async HTTP client helpers for the NVIDIA Integrate (OpenAI-compatible) API."""

import json
import logging
import re
from typing import Any, Final

import httpx

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL: Final[str] = "https://integrate.api.nvidia.com/v1"
NVIDIA_URL: Final[str] = f"{DEFAULT_BASE_URL}/chat/completions"
DEFAULT_TIMEOUT: Final[float] = 60.0
ANALYZE_MODEL: Final[str] = "meta/llama-3.3-70b-instruct"

ANALYZE_SYSTEM_PROMPT: Final[str] = (
    "You are a form analysis assistant. Extract structured fields from the provided "
    "HTML form. Reply with ONLY a JSON object of the shape "
    '{"fields": {"<field>": "<value>"}, "stage": <int>, "confidence": {"<field>": <0..1>}}. '
    "No markdown, no commentary."
)


class NvidiaError(Exception):
    """Base class for NVIDIA client errors."""


class NvidiaAuthError(NvidiaError):
    """Raised when NVIDIA API returns 401 Unauthorized (bad key)."""


class NvidiaRateLimitError(NvidiaError):
    """Raised when NVIDIA API returns 429 Too Many Requests."""


class NvidiaTimeoutError(NvidiaError):
    """Raised when request to NVIDIA API times out."""


class NvidiaModelError(NvidiaError):
    """Raised when the model is unknown or not available to this key (403/404/422)."""

    def __init__(self, model: str, status_code: int, message: str) -> None:
        super().__init__(f"model {model!r} unavailable ({status_code}): {message}")
        self.model = model
        self.status_code = status_code


class NvidiaUpstreamError(NvidiaError):
    """Raised when NVIDIA API returns 5xx or an unusable response."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"NVIDIA upstream error {status_code}: {message}")
        self.status_code = status_code


class ModelOutputError(NvidiaError):
    """Raised when the model reply cannot be parsed into the expected JSON."""


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def extract_json_object(text: str) -> dict[str, Any]:
    """Parse the first JSON object in a model reply.

    Tolerates reasoning blocks (<think>...</think>), markdown code fences and
    leading/trailing prose around the object.
    """
    cleaned = _THINK_RE.sub("", text).strip()
    cleaned = _FENCE_RE.sub("", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ModelOutputError("no JSON object in model reply") from None
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ModelOutputError("malformed JSON in model reply") from exc
    if not isinstance(parsed, dict):
        raise ModelOutputError("model reply is not a JSON object")
    return parsed


async def chat_completion(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    base_url: str = DEFAULT_BASE_URL,
    temperature: float = 0.1,
    max_tokens: int = 512,
) -> str:
    """POST /chat/completions and return the assistant text.

    Raises:
        NvidiaAuthError: 401.
        NvidiaRateLimitError: 429.
        NvidiaModelError: 403/404/422 (model missing or not allowed for key).
        NvidiaTimeoutError: request timed out.
        NvidiaUpstreamError: network failure, 5xx, other 4xx, malformed body.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    url = f"{base_url.rstrip('/')}/chat/completions"
    try:
        resp = await client.post(url, headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        logger.warning("NVIDIA request timeout (model=%s)", model)
        raise NvidiaTimeoutError("Upstream request timed out") from exc
    except httpx.RequestError as exc:
        logger.error("NVIDIA request failed (model=%s): %s", model, type(exc).__name__)
        raise NvidiaUpstreamError(502, "Upstream request failed") from exc

    status = resp.status_code
    if status == 401:
        logger.warning("NVIDIA auth failed (401)")
        raise NvidiaAuthError("Invalid API key")
    if status == 429:
        logger.warning("NVIDIA rate limited (429, model=%s)", model)
        raise NvidiaRateLimitError("Rate limited")
    if status in (403, 404, 422):
        logger.warning("NVIDIA model unavailable (%d, model=%s)", status, model)
        raise NvidiaModelError(model, status, resp.text[:200])
    if 500 <= status < 600:
        logger.error("NVIDIA upstream error %d (model=%s)", status, model)
        raise NvidiaUpstreamError(status, resp.text[:200])
    if status >= 400:
        logger.error("NVIDIA request rejected %d (model=%s)", status, model)
        raise NvidiaUpstreamError(status, resp.text[:200])

    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        logger.error("Unexpected NVIDIA response structure (model=%s)", model)
        raise NvidiaUpstreamError(502, "Malformed upstream response") from exc
    if not isinstance(content, str):
        raise NvidiaUpstreamError(502, "Empty upstream response")
    return content


async def list_models(
    client: httpx.AsyncClient, *, api_key: str, base_url: str = DEFAULT_BASE_URL
) -> list[str]:
    """Return the model ids visible to this key (GET /models)."""
    resp = await client.get(
        f"{base_url.rstrip('/')}/models",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
    )
    if resp.status_code == 401:
        raise NvidiaAuthError("Invalid API key")
    if resp.status_code >= 400:
        raise NvidiaUpstreamError(resp.status_code, resp.text[:200])
    try:
        items = resp.json().get("data", [])
    except (ValueError, AttributeError) as exc:
        raise NvidiaUpstreamError(502, "Malformed models response") from exc
    return [str(item["id"]) for item in items if isinstance(item, dict) and "id" in item]


async def chat(api_key: str, html: str, model: str = ANALYZE_MODEL) -> str:
    """Legacy single-call helper used by scripts: analyze an HTML form snippet."""
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        return await chat_completion(
            client,
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": ANALYZE_SYSTEM_PROMPT},
                {"role": "user", "content": html},
            ],
            temperature=0.1,
            max_tokens=2048,
        )


def dumps_compact(value: Any) -> str:
    """Compact JSON for prompts (keeps token use down)."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
