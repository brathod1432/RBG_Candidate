# scripts/nvidia_smoke_test.py
"""Live check of the NVIDIA API + the 15-worker pool, using the key in .env.

Run from the project root (Windows):
    .venv\\Scripts\\python.exe scripts\\nvidia_smoke_test.py
Options:
    --workers 15        pool size for step 3
    --skip-pool         only steps 1-2 (models + one call per model)
    --base-url URL      e.g. http://127.0.0.1:9100/v1 for the offline fake server

Steps:
  1. GET /v1/models         – is the key valid, which configured models exist?
  2. one chat call / model  – latency + does the reply parse as JSON?
  3. coordinator run        – a realistic 20-field form across all workers.
Exit code 0 = everything passed.
"""

import argparse
import asyncio
import os
import sys
import time
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402

from server.agents import Coordinator  # noqa: E402  (importing server.config loads .env)
from server.config import AgentSettings  # noqa: E402
from server.nvidia_client import (  # noqa: E402
    NvidiaError,
    chat_completion,
    extract_json_object,
    list_models,
)
from server.schemas import CandidateProfile, FieldSpec, FillRequest, JobContext  # noqa: E402

OK, FAIL, WARN = "PASS", "FAIL", "WARN"
CHAT_HINTS = ("llama", "mistral", "nemotron", "qwen", "gemma", "phi", "deepseek", "mixtral")

PROFILE = CandidateProfile(
    full_name="Alex Candidate",
    email="candidate@example.com",
    phone="+48 500 000 000",
    headline="Senior Software Engineer",
    summary=(
        "Senior software engineer with experience in test automation, Python services, "
        "and building AI/LLM applications."
    ),
    resume=(
        "Experience: Senior Software Engineer (platform testing, automation, Python). "
        "Delivered several AI integrations for clients. Skills: Python, FastAPI, TypeScript, "
        "React, LLM integration, CI/CD. Languages: English."
    ),
)

JOB = JobContext(
    title="Senior Python Engineer (AI Platform)",
    company="Example Robotics",
    url="https://jobs.example.com/123",
    description=(
        "We are hiring a senior Python engineer to build LLM-powered services with FastAPI, "
        "async workers and strong testing practices."
    ),
)

FIELDS = [
    FieldSpec(id="firstName", label="First name"),
    FieldSpec(id="lastName", label="Last name"),
    FieldSpec(id="email", label="Email", type="email"),
    FieldSpec(id="phone", label="Phone number", type="tel"),
    FieldSpec(id="currentTitle", label="Current job title"),
    FieldSpec(id="desiredTitle", label="Desired job title"),
    FieldSpec(id="pyYears", label="Years of Python experience", type="number"),
    FieldSpec(id="seniority", label="Seniority level", type="select",
              options=["Junior", "Mid", "Senior", "Lead / Principal"]),
    FieldSpec(id="remote", label="Preferred work mode", type="select",
              options=["On-site", "Hybrid", "Remote"]),
    FieldSpec(id="english", label="English proficiency", type="select",
              options=["Basic", "Intermediate", "Fluent", "Native"]),
    FieldSpec(id="topSkill", label="Your strongest technical skill"),
    FieldSpec(id="aiExp", label="Describe your experience with LLM / AI integrations", type="textarea",
              max_length=800),
    FieldSpec(id="why", label="Why do you want to work at Example Robotics?", type="textarea",
              max_length=1000),
    FieldSpec(id="cover", label="Cover letter", type="textarea", max_length=1500),
    FieldSpec(id="achievement", label="Tell us about a project you are proud of", type="textarea",
              max_length=800),
    FieldSpec(id="testing", label="How do you approach automated testing?", type="textarea",
              max_length=800),
    FieldSpec(id="salary", label="Expected salary (EUR)", type="number"),
    FieldSpec(id="notice", label="Notice period"),
    FieldSpec(id="linkedin", label="LinkedIn profile URL", type="url"),
    FieldSpec(id="extra", label="Anything else you would like us to know?", type="textarea",
              max_length=500),
]


def mask(key: str) -> str:
    return f"{key[:8]}…{key[-4:]}" if len(key) > 14 else "***"


def line(status: str, text: str) -> None:
    print(f"  [{status}] {text}")


async def step_models(settings: AgentSettings, key: str) -> tuple[bool, set[str]]:
    print("\n1) GET /models")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            ids = set(await list_models(client, api_key=key, base_url=settings.base_url))
    except NvidiaError as exc:
        line(FAIL, f"{type(exc).__name__}: {exc}")
        return False, set()
    except httpx.HTTPError as exc:
        line(FAIL, f"network error: {type(exc).__name__}: {exc}")
        return False, set()
    line(OK, f"key accepted, {len(ids)} models visible")
    all_ok = True
    for tier, models in (("fast", settings.fast_models), ("quality", settings.quality_models)):
        for m in models:
            present = m in ids
            all_ok &= present
            line(OK if present else WARN, f"{tier:7s} {m}{'' if present else '  <- NOT available to this key'}")
    if not all_ok:
        suggestions = sorted(i for i in ids if any(h in i.lower() for h in CHAT_HINTS) and "embed" not in i)
        print("     Chat-capable models you could put in NVIDIA_FAST_MODELS / NVIDIA_QUALITY_MODELS:")
        for s in suggestions[:25]:
            print(f"       - {s}")
    return True, ids


async def step_calls(settings: AgentSettings, key: str, models: list[str]) -> bool:
    print("\n2) One chat call per model")
    ok_all = True
    async with httpx.AsyncClient(timeout=settings.request_timeout_s) as client:
        for m in models:
            t0 = time.perf_counter()
            try:
                text = await chat_completion(
                    client, api_key=key, model=m, base_url=settings.base_url, max_tokens=60,
                    messages=[
                        {"role": "system", "content": "Reply with ONLY a JSON object."},
                        {"role": "user", "content": 'Return {"value": "pong", "confidence": 1}'},
                    ],
                )
                parsed = extract_json_object(text)
                good = str(parsed.get("value", "")).lower() == "pong"
                line(OK if good else WARN, f"{m}  {int((time.perf_counter() - t0) * 1000)} ms  -> {parsed}")
            except NvidiaError as exc:
                ok_all = False
                line(FAIL, f"{m}  {type(exc).__name__}: {str(exc)[:160]}")
    return ok_all


async def step_pool(settings: AgentSettings, key: str) -> bool:
    print(f"\n3) Coordinator + {settings.num_workers} workers on a {len(FIELDS)}-field form")
    coordinator = Coordinator(settings)
    await coordinator.ensure_started(key)
    snap = coordinator.snapshot()
    print(f"     pool: {snap['total']} workers | fast={snap['fast_models']} | quality={snap['quality_models']}")
    print(f"     rate limit: {settings.max_rpm} calls/min shared by all workers")
    try:
        data = await coordinator.fill(FillRequest(fields=FIELDS, profile=PROFILE, job=JOB), key)
    except NvidiaError as exc:
        line(FAIL, f"{type(exc).__name__}: {exc}")
        await coordinator.stop()
        return False
    print(f"\n     {'field':13s} {'src':7s} {'wkr':>3s} {'model':42s} {'try':>3s} {'ms':>6s}  value")
    for fid, a in data.answers.items():
        value = a.value.replace("\n", " ")
        value = value[:60] + ("…" if len(value) > 60 else "")
        err = f"  !{a.error}" if a.error else ""
        print(f"     {fid:13s} {a.source:7s} {a.worker_id or '-':>3} {(a.model or '-')[:42]:42s} "
              f"{a.attempts:>3d} {a.latency_ms:>6d}  {value}{err}")
    st = data.stats
    print(f"\n     {st.ai_tasks} AI tasks on {st.workers_used} workers, {st.profile_fields} from profile, "
          f"{st.duration_ms} ms total, models: {', '.join(st.models_used)}")
    print("     workers:")
    for w in coordinator.snapshot()["workers"]:
        print(f"       #{w['id']:>2} {w['state']:8s} done={w['completed']:<2} failed={w['failed']:<2} "
              f"avg={w['avg_latency_ms']}ms models={list(w['models'].values())}"
              f"{' disabled=' + ','.join(w['disabled_models']) if w['disabled_models'] else ''}")
    await coordinator.stop()
    failed = [f for f, a in data.answers.items() if a.error]
    if failed:
        line(WARN, f"{len(failed)} field(s) failed after retries: {failed}")
    line(OK if len(failed) < len(FIELDS) // 2 else FAIL, "pool run finished")
    return len(failed) < len(FIELDS) // 2


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--skip-pool", action="store_true")
    parser.add_argument("--base-url", default=None)
    args = parser.parse_args()

    key = os.getenv("NVIDIA_API_KEY", "").strip()
    print(f"RBG Candidate — NVIDIA smoke test  (.env: {'found' if (ROOT / '.env').is_file() else 'missing'})")
    if not key:
        print("  [FAIL] NVIDIA_API_KEY is empty. Put it in .env at the project root.")
        return 2
    settings = AgentSettings.from_env()
    if args.workers:
        settings = replace(settings, num_workers=args.workers)
    if args.base_url:
        settings = replace(settings, base_url=args.base_url.rstrip("/"))
    print(f"  key {mask(key)} | base {settings.base_url}")

    ok, visible = await step_models(settings, key)
    if not ok:
        return 1
    configured = list(dict.fromkeys(settings.fast_models + settings.quality_models))
    to_call = [m for m in configured if m in visible] or configured
    calls_ok = await step_calls(settings, key, to_call)
    pool_ok = True if args.skip_pool else await step_pool(settings, key)
    print("\nRESULT:", "ALL PASSED" if (calls_ok and pool_ok) else "SOME CHECKS FAILED")
    return 0 if (calls_ok and pool_ok) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
