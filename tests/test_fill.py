# tests/test_fill.py
"""HTTP tests for POST /fill and GET /workers."""

import json

import httpx
import pytest
import respx
from httpx import AsyncClient

CHAT = "https://integrate.api.nvidia.com/v1/chat/completions"

FORM = {
    "fields": [
        {"id": "firstName", "label": "First name", "type": "text"},
        {"id": "email", "label": "Email", "type": "email"},
        {"id": "exp", "label": "Years of Experience", "type": "select", "options": ["0-1", "2-4", "5-7"]},
        {"id": "why", "label": "Why do you want to work here?", "type": "textarea", "max_length": 40},
    ],
    "profile": {"full_name": "Ada Lovelace", "email": "ada@example.com", "summary": "6 years of Python."},
    "job": {"title": "Backend Engineer", "company": "Acme"},
}


def answer(request: httpx.Request) -> httpx.Response:
    field = json.loads(json.loads(request.content)["messages"][1]["content"])["field"]
    value = "5-7" if field.get("options") else "Because Acme builds reliable systems I care about deeply."
    content = json.dumps({"value": value, "confidence": 0.8})
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


class TestFillEndpoint:
    @pytest.mark.asyncio
    async def test_fill_mixes_profile_and_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=answer)
            resp = await client.post("/fill", json=FORM)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        a = body["data"]["answers"]
        assert a["firstName"]["value"] == "Ada" and a["firstName"]["source"] == "profile"
        assert a["email"]["value"] == "ada@example.com"
        assert a["exp"]["value"] == "5-7" and a["exp"]["source"] == "ai"
        assert len(a["why"]["value"]) <= 40
        assert body["data"]["stats"]["ai_tasks"] == 2
        assert route.call_count == 2
        sent = json.loads(route.calls[0].request.content)
        assert route.calls[0].request.headers["authorization"] == "Bearer server-key"
        assert sent["model"]

    @pytest.mark.asyncio
    async def test_fill_prefers_byok(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=answer)
            resp = await client.post("/fill", json={**FORM, "api_key": "user-key"})
        assert resp.status_code == 200
        assert all(c.request.headers["authorization"] == "Bearer user-key" for c in route.calls)

    @pytest.mark.asyncio
    async def test_fill_403_without_key(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
        resp = await client.post("/fill", json=FORM)
        assert resp.status_code == 403
        assert resp.json()["code"] == "INVALID_KEY"

    @pytest.mark.asyncio
    async def test_fill_403_on_bad_key(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "bad")
        with respx.mock(assert_all_called=False) as m:
            m.post(CHAT).mock(return_value=httpx.Response(401))
            resp = await client.post("/fill", json=FORM)
        assert resp.status_code == 403
        assert resp.json() == {"status": "error", "message": "Invalid API key", "code": "INVALID_KEY"}

    @pytest.mark.asyncio
    async def test_fill_400_on_empty_fields(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "k")
        resp = await client.post("/fill", json={"fields": []})
        assert resp.status_code == 400
        assert resp.json()["code"] == "VALIDATION_ERROR"

    @pytest.mark.asyncio
    async def test_workers_endpoint_reports_pool(self, client: AsyncClient) -> None:
        resp = await client.get("/workers")
        assert resp.status_code == 200
        snap = resp.json()
        assert snap["total"] == 15
        assert snap["available"] == 15
        assert "api_key" not in json.dumps(snap)


class TestAnalyzeParsing:
    @pytest.mark.asyncio
    async def test_analyze_accepts_fenced_json(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "k")
        content = '```json\n{"fields": {"age": 30}, "stage": "2", "confidence": {"age": "0.5"}}\n```'
        with respx.mock(assert_all_called=False) as m:
            m.post(CHAT).mock(
                return_value=httpx.Response(200, json={"choices": [{"message": {"content": content}}]})
            )
            resp = await client.post("/analyze", json={"html": "<form></form>"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"] == {"fields": {"age": "30"}, "stage": 2, "confidence": {"age": 0.5}}
