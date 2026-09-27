# server/config.py
"""Server configuration.

Values come from the process environment, with the project-root `.env`
loaded first (python-dotenv, never overriding variables that are already
set). Agent-pool settings are read through `AgentSettings.from_env()` at
pool start, so tests can monkeypatch the environment.
"""

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"

if ENV_FILE.is_file():
    load_dotenv(ENV_FILE, override=False)

PORT = int(os.getenv("PORT", "8000"))

raw_origins = os.getenv("ALLOWED_ORIGINS")
if raw_origins:
    ALLOWED_ORIGINS: list[str] = [o.strip() for o in raw_origins.split(",") if o.strip()]
else:
    ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

# Extension pages call the server from chrome-extension://<id> (Chrome/Edge).
# The background worker is also covered by manifest host_permissions, but the
# regex keeps popup-origin fetches working too.
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", r"^chrome-extension://[a-p]{32}$")

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")

if PORT <= 0 or PORT > 65535:
    raise RuntimeError(f"Invalid PORT: {PORT}. Must be between 1 and 65535.")

if not ALLOWED_ORIGINS:
    raise RuntimeError("ALLOWED_ORIGINS cannot be empty. Set ALLOWED_ORIGINS environment variable.")


# Preferred models per tier. The pool checks them against GET /v1/models at
# start-up (when a server key exists) and drops any the key cannot see.
DEFAULT_FAST_MODELS = "meta/llama-3.1-8b-instruct,mistralai/mistral-small-3.1-24b-instruct-2503"
DEFAULT_QUALITY_MODELS = "meta/llama-3.3-70b-instruct,nvidia/llama-3.3-nemotron-super-49b-v1.5"


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _int_env(name: str, default: int, low: int, high: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("Ignoring non-integer %s=%r", name, raw)
        return default
    return max(low, min(high, value))


def _float_env(name: str, default: float, low: float, high: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Ignoring non-numeric %s=%r", name, raw)
        return default
    return max(low, min(high, value))


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class AgentSettings:
    """Coordinator + worker-pool settings (all overridable via env)."""

    base_url: str = "https://integrate.api.nvidia.com/v1"
    num_workers: int = 15
    fast_models: list[str] = field(default_factory=lambda: _csv(DEFAULT_FAST_MODELS))
    quality_models: list[str] = field(default_factory=lambda: _csv(DEFAULT_QUALITY_MODELS))
    max_rpm: int = 40
    request_timeout_s: float = 45.0
    task_timeout_s: float = 60.0
    max_attempts: int = 3
    failure_threshold: int = 3
    cooldown_s: float = 30.0
    discover_models: bool = True

    @classmethod
    def from_env(cls) -> "AgentSettings":
        num_workers = _int_env("AI_WORKERS", 15, 1, 64)
        return cls(
            base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/"),
            num_workers=num_workers,
            fast_models=_csv(os.getenv("NVIDIA_FAST_MODELS", DEFAULT_FAST_MODELS)),
            quality_models=_csv(os.getenv("NVIDIA_QUALITY_MODELS", DEFAULT_QUALITY_MODELS)),
            max_rpm=_int_env("NVIDIA_MAX_RPM", 40, 1, 10_000),
            request_timeout_s=_float_env("AI_REQUEST_TIMEOUT_S", 45.0, 1.0, 600.0),
            task_timeout_s=_float_env("AI_TASK_TIMEOUT_S", 60.0, 1.0, 900.0),
            max_attempts=_int_env("AI_MAX_ATTEMPTS", 3, 1, 10),
            failure_threshold=_int_env("AI_FAILURE_THRESHOLD", 3, 1, 50),
            cooldown_s=_float_env("AI_COOLDOWN_S", 30.0, 0.0, 3600.0),
            discover_models=_bool_env("AI_DISCOVER_MODELS", True),
        )


def trust_proxy_headers() -> bool:
    """Only honour X-Forwarded-For when running behind a trusted proxy."""
    return _bool_env("TRUST_PROXY_HEADERS", False)
