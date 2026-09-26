# tests/test_health.py
"""Health endpoint tests (liveness + AI pool readiness for the Prepare step)."""

import pytest
from httpx import AsyncClient


class TestHealth:
    """Tests for GET /health."""

    @pytest.mark.asyncio
    async def test_health_reports_pool(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-test")
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["nvidiaApiKeyConfigured"] is True
        assert data["workersTotal"] == 15
        assert data["workersActive"] == 15
        assert data["models"]
        assert "nvapi-test" not in resp.text  # never leaks the key

    @pytest.mark.asyncio
    async def test_health_degraded_without_key(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "degraded"
        assert data["nvidiaApiKeyConfigured"] is False
