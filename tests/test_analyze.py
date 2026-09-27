# tests/test_analyze.py
"""Tests for POST /analyze endpoint with mocked NVIDIA client."""

import json

import httpx
import pytest
import respx
from fastapi import HTTPException
from httpx import AsyncClient

from server.routers.guards import resolve_api_key


class TestResolveApiKey:
    """Unit tests for the shared API-key resolution (BYOK + operator fallback)."""

    def test_byok_required_withholds_operator_key(self, monkeypatch) -> None:
        monkeypatch.setenv("FILL_REQUIRE_BYOK", "1")
        monkeypatch.setenv("NVIDIA_API_KEY", "operator-key")
        with pytest.raises(HTTPException) as exc:
            resolve_api_key(None, None)
        assert exc.value.status_code == 403
        assert resolve_api_key("nvapi-mine", None) == "nvapi-mine"

    def test_operator_fallback_by_default(self, monkeypatch) -> None:
        monkeypatch.setenv("FILL_REQUIRE_BYOK", "0")
        monkeypatch.setenv("NVIDIA_API_KEY", "operator-key")
        assert resolve_api_key(None, None) == "operator-key"
        assert resolve_api_key("nvapi-mine", "nvapi-header") == "nvapi-mine"  # body wins

    def test_no_key_anywhere_raises(self, monkeypatch) -> None:
        monkeypatch.setenv("FILL_REQUIRE_BYOK", "0")
        monkeypatch.setenv("NVIDIA_API_KEY", "")
        with pytest.raises(HTTPException) as exc:
            resolve_api_key(None, None)
        assert exc.value.status_code == 403



class TestAnalyzeEndpoint:
    """Tests for POST /analyze route."""

    @pytest.mark.asyncio
    async def test_analyze_success_with_server_key(
        self, client: AsyncClient, sample_html: str, monkeypatch
    ) -> None:
        """Happy path: valid HTML + server API key returns structured response."""
        # Mock NVIDIA chat API
        mock_response = {
            "choices": [{"message": {"content": json.dumps({
                "fields": {"email": "test@example.com"},
                "stage": 1,
                "confidence": {"email": 0.95}
            })}}]
        }

        with respx.mock(assert_all_called=False) as m:
            m.post("https://integrate.api.nvidia.com/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=mock_response)
            )

            # Ensure server has a default key
            monkeypatch.setenv("NVIDIA_API_KEY", "test-server-key")

            resp = await client.post("/analyze", json={"html": sample_html})

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["data"]["fields"]["email"] == "test@example.com"
        assert data["data"]["stage"] == 1
        assert data["data"]["confidence"]["email"] == 0.95

    @pytest.mark.asyncio
    async def test_analyze_success_with_byok(
        self, client: AsyncClient, sample_html: str, monkeypatch
    ) -> None:
        """Happy path: valid HTML + BYOK (request api_key) returns structured response."""
        mock_response = {
            "choices": [{"message": {"content": json.dumps({
                "fields": {"name": "John"},
                "stage": 2,
                "confidence": {"name": 0.9}
            })}}]
        }

        with respx.mock(assert_all_called=False) as m:
            m.post("https://integrate.api.nvidia.com/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=mock_response)
            )

            # No server key, use BYOK
            monkeypatch.delenv("NVIDIA_API_KEY", raising=False)

            resp = await client.post("/analyze", json={
                "html": sample_html,
                "api_key": "test-byok-key"
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["data"]["fields"]["name"] == "John"

    @pytest.mark.asyncio
    async def test_analyze_403_no_api_key(
        self, client: AsyncClient, sample_html: str, monkeypatch
    ) -> None:
        """403 error when no API key available (server or BYOK)."""
        # Ensure no API key anywhere
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)

        resp = await client.post("/analyze", json={"html": sample_html})

        assert resp.status_code == 403
        data = resp.json()
        assert data["status"] == "error"
        assert data["code"] == "INVALID_KEY"
        assert "API key required" in data["message"]

    @pytest.mark.asyncio
    async def test_analyze_400_empty_html(self, client: AsyncClient, monkeypatch) -> None:
        """400 error when HTML is empty (validation)."""
        monkeypatch.setenv("NVIDIA_API_KEY", "test-key")

        resp = await client.post("/analyze", json={"html": ""})

        assert resp.status_code == 400
        data = resp.json()
        assert data["status"] == "error"

    @pytest.mark.asyncio
    async def test_analyze_429_rate_limit(
        self, client: AsyncClient, sample_html: str, monkeypatch
    ) -> None:
        """429 error when NVIDIA returns rate limit."""
        monkeypatch.setenv("NVIDIA_API_KEY", "test-key")

        with respx.mock(assert_all_called=False) as m:
            m.post("https://integrate.api.nvidia.com/v1/chat/completions").mock(
                return_value=httpx.Response(429, text="Rate limited")
            )

            resp = await client.post("/analyze", json={"html": sample_html})

        assert resp.status_code == 429
        data = resp.json()
        assert data["status"] == "error"
        assert data["code"] == "RATE_LIMITED"

    @pytest.mark.asyncio
    async def test_analyze_504_timeout(
        self, client: AsyncClient, sample_html: str, monkeypatch
    ) -> None:
        """504 error when NVIDIA request times out."""
        monkeypatch.setenv("NVIDIA_API_KEY", "test-key")

        with respx.mock(assert_all_called=False) as m:
            m.post("https://integrate.api.nvidia.com/v1/chat/completions").mock(
                side_effect=httpx.TimeoutException("Timeout")
            )

            resp = await client.post("/analyze", json={"html": sample_html})

        assert resp.status_code == 504
        data = resp.json()
        assert data["status"] == "error"
        assert data["code"] == "UPSTREAM_TIMEOUT"

    @pytest.mark.asyncio
    async def test_analyze_502_upstream_error(
        self, client: AsyncClient, sample_html: str, monkeypatch
    ) -> None:
        """502 error when NVIDIA returns 5xx."""
        monkeypatch.setenv("NVIDIA_API_KEY", "test-key")

        with respx.mock(assert_all_called=False) as m:
            m.post("https://integrate.api.nvidia.com/v1/chat/completions").mock(
                return_value=httpx.Response(500, text="Internal server error")
            )

            resp = await client.post("/analyze", json={"html": sample_html})

        assert resp.status_code == 502
        data = resp.json()
        assert data["status"] == "error"
        assert data["code"] == "UPSTREAM_ERROR"