# tests/conftest.py
"""Pytest fixtures for async FastAPI testing."""

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Force-empty so the suite never touches the real NVIDIA API by accident;
# individual tests opt in via monkeypatch.setenv. (Process env only.)
os.environ["NVIDIA_API_KEY"] = ""
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("PORT", "8000")
# Tests never call GET /v1/models; pool uses the configured model lists as-is.
os.environ["AI_DISCOVER_MODELS"] = "0"
os.environ.setdefault("NVIDIA_MAX_RPM", "1000")

from server.main import create_app


@pytest.fixture(autouse=True)
def _clear_rate_limit_window():
    """Each test starts with an empty rate-limit window.

    The endpoint tests all POST /fill from the same test IP; without this,
    the 30/min in-memory limiter trips mid-suite (429 RATE_LIMITED).
    """
    from server.routers import guards

    guards._request_log.clear()
    yield
    guards._request_log.clear()


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Async test client with FastAPI app."""
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    coordinator = getattr(app.state, "coordinator", None)
    if coordinator is not None:
        await coordinator.stop()


@pytest.fixture
def sample_html() -> str:
    """Minimal valid HTML form for testing."""
    return "<form><input name='email' type='email'></form>"