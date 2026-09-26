# scripts/fake_nvidia_server.py
"""Offline stand-in for integrate.api.nvidia.com (for demos and E2E tests).

Implements GET /v1/models and POST /v1/chat/completions with the OpenAI
shape, answers form-field prompts deterministically, adds a small delay, and
records peak concurrency so tests can prove the worker pool runs in parallel.

Run:  python scripts/fake_nvidia_server.py --port 9100
Then: set NVIDIA_BASE_URL=http://127.0.0.1:9100/v1 before starting the server.
"""

import argparse
import asyncio
import json
import logging
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("fake_nvidia")

MODELS = [
    "meta/llama-3.1-8b-instruct",
    "mistralai/mistral-small-3.1-24b-instruct-2503",
    "meta/llama-3.3-70b-instruct",
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",
]

app = FastAPI(title="fake-nvidia")
state: dict[str, Any] = {"active": 0, "peak": 0, "calls": 0, "by_model": {}, "delay": 0.4}


def answer_for(field: dict[str, Any], candidate: dict[str, Any], job: dict[str, Any]) -> dict[str, Any]:
    label = str(field.get("label", "")).lower()
    options = field.get("options") or []
    if options:
        pick = next((o for o in options if "5" in o), options[-1])
        return {"value": pick, "confidence": 0.8}
    if field.get("type") == "number":
        return {"value": "6", "confidence": 0.7}
    if "title" in label or "position" in label:
        return {"value": candidate.get("headline", "Software Engineer"), "confidence": 0.75}
    if "salary" in label:
        return {"value": "", "confidence": 0}
    company = job.get("company") or job.get("title") or "your team"
    return {
        "value": f"I am excited about {company}. {candidate.get('summary', '')}".strip(),
        "confidence": 0.7,
    }


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": m, "object": "model"} for m in MODELS]}


@app.get("/stats")
async def stats() -> dict[str, Any]:
    return state


@app.post("/stats/reset")
async def reset() -> dict[str, Any]:
    state.update(active=0, peak=0, calls=0, by_model={})
    return state


@app.post("/v1/chat/completions")
async def chat(request: Request) -> JSONResponse:
    if request.headers.get("authorization", "") in ("", "Bearer ", "Bearer bad"):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    model = body.get("model", "")
    if model not in MODELS:
        return JSONResponse({"error": f"model {model} not found"}, status_code=404)
    state["active"] += 1
    state["calls"] += 1
    state["peak"] = max(state["peak"], state["active"])
    state["by_model"][model] = state["by_model"].get(model, 0) + 1
    try:
        await asyncio.sleep(state["delay"])
        user = body["messages"][-1]["content"]
        try:
            payload = json.loads(user)
            content = json.dumps(answer_for(payload["field"], payload.get("candidate", {}), payload.get("job", {})))
        except (ValueError, KeyError, TypeError):
            content = json.dumps({"fields": {}, "stage": 1, "confidence": {}})
        # Mimic a chatty model: wrap in a code fence half of the time.
        if state["calls"] % 2 == 0:
            content = f"```json\n{content}\n```"
        return JSONResponse({
            "id": f"cmpl-{state['calls']}",
            "object": "chat.completion",
            "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        })
    finally:
        state["active"] -= 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("--delay", type=float, default=0.4)
    args = parser.parse_args()
    state["delay"] = args.delay
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
