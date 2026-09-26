# tests/test_agents.py
"""Coordinator + worker-pool tests (NVIDIA mocked with respx)."""

import asyncio
import json
import time
from dataclasses import replace
from typing import Any

import httpx
import pytest
import respx

from server.agents import Coordinator
from server.agents.limiter import RateLimiter
from server.agents.tasks import classify_kind, resolve_from_profile, validate_answer
from server.config import AgentSettings
from server.nvidia_client import ModelOutputError, NvidiaAuthError, extract_json_object
from server.schemas import CandidateProfile, FieldSpec, FillRequest, JobContext

BASE = "https://nim.test/v1"
CHAT = f"{BASE}/chat/completions"

PROFILE = CandidateProfile(
    full_name="Ada Lovelace",
    email="ada@example.com",
    phone="+44 20 7946 0000",
    headline="Senior Software Engineer",
    summary="10 years building analytical engines and Python services.",
)


def settings(**overrides: Any) -> AgentSettings:
    base = AgentSettings(
        base_url=BASE,
        num_workers=15,
        fast_models=["fast-a", "fast-b"],
        quality_models=["big-a", "big-b"],
        max_rpm=1000,
        request_timeout_s=5.0,
        task_timeout_s=5.0,
        max_attempts=3,
        failure_threshold=3,
        cooldown_s=30.0,
        discover_models=False,
    )
    return replace(base, **overrides)


def reply(content: dict[str, Any] | str) -> httpx.Response:
    text = content if isinstance(content, str) else json.dumps(content)
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


def field_of(request: httpx.Request) -> dict[str, Any]:
    body = json.loads(request.content)
    user = json.loads(body["messages"][1]["content"])
    return {"model": body["model"], **user["field"]}


def smart_answer(request: httpx.Request) -> httpx.Response:
    f = field_of(request)
    if f.get("options"):
        return reply({"value": f["options"][-1], "confidence": 0.8})
    if f["type"] == "number":
        return reply({"value": "10", "confidence": 0.7})
    return reply({"value": f"answer for {f['label']}", "confidence": 0.9})


def ai_fields(n: int) -> list[FieldSpec]:
    return [FieldSpec(id=f"q{i}", label=f"Question {i}", type="text") for i in range(n)]


# ── pure helpers ──────────────────────────────────────────────────────

class TestTasks:
    def test_profile_resolution(self) -> None:
        def r(label: str, type_: str = "text", id_: str = "x") -> str | None:
            return resolve_from_profile(FieldSpec(id=id_, label=label, type=type_), PROFILE)  # type: ignore[arg-type]

        assert r("First Name") == "Ada"
        assert r("Last name") == "Lovelace"
        assert r("Full Name") == "Ada Lovelace"
        assert r("Email address") == "ada@example.com"
        assert r("Mobile phone") == "+44 20 7946 0000"
        assert r("Current Position") == "Senior Software Engineer"
        assert r("Company name") is None
        assert r("Username") is None
        assert r("Why do you want to join?") is None
        assert r("Contact", "email") == "ada@example.com"

    def test_structured_profile_resolution(self) -> None:
        rich = PROFILE.model_copy(update={
            "full_name": "Ada King Lovelace", "first_name": "Ada", "middle_name": "King", "last_name": "Lovelace",
            "city": "London", "country": "United Kingdom", "linkedin": "https://linkedin.com/in/ada",
            "github": "https://github.com/ada", "website": "https://ada.dev", "postal_code": "N1 9GU",
            "notice_period": "1 month", "years_experience": 10.0, "desired_salary": "90000",
        })

        def r(label: str, type_: str = "text") -> str | None:
            return resolve_from_profile(FieldSpec(id="x", label=label, type=type_), rich)  # type: ignore[arg-type]

        assert r("Middle name") == "King"
        assert r("Last name") == "Lovelace"
        assert r("LinkedIn profile URL", "url") == "https://linkedin.com/in/ada"
        assert r("GitHub") == "https://github.com/ada"
        assert r("Portfolio / Website", "url") == "https://ada.dev"
        assert r("City") == "London"
        assert r("Location") == "London, United Kingdom"
        assert r("ZIP / Postal code") == "N1 9GU"
        assert r("Notice period") == "1 month"
        assert r("Years of experience", "number") == "10"
        assert r("Years of Python experience", "number") is None  # skill-specific → AI
        assert r("Expected salary") == "90000"
        assert r("Company website") is None
        assert r("School city") is None

    def test_select_never_resolved_locally(self) -> None:
        spec = FieldSpec(id="c", label="Email preference", type="select", options=["Yes", "No"])
        assert resolve_from_profile(spec, PROFILE) is None

    def test_classify(self) -> None:
        assert classify_kind(FieldSpec(id="a", type="select", options=["x"])) == "choice"
        assert classify_kind(FieldSpec(id="a", type="textarea", label="Notes")) == "long"
        assert classify_kind(FieldSpec(id="a", label="Why do you want this role?")) == "long"
        assert classify_kind(FieldSpec(id="a", label="Desired Job Title")) == "short"

    def test_validate_choice(self) -> None:
        spec = FieldSpec(id="y", type="select", options=["0-1 years", "5-7 years", "10+ years"])
        assert validate_answer(spec, "choice", {"value": "10+ YEARS", "confidence": 0.9}) == ("10+ years", 0.9)
        assert validate_answer(spec, "choice", {"value": "5-7", "confidence": 2})[0] == "5-7 years"
        with pytest.raises(ModelOutputError):
            validate_answer(spec, "choice", {"value": "twelve", "confidence": 0.5})
        assert validate_answer(spec, "choice", {"value": "", "confidence": 0.9}) == ("", 0.0)

    def test_validate_number_and_length(self) -> None:
        num = FieldSpec(id="n", type="number")
        assert validate_answer(num, "short", {"value": "about 7 years"})[0] == "7"
        with pytest.raises(ModelOutputError):
            validate_answer(num, "short", {"value": "many"})
        capped = FieldSpec(id="t", type="textarea", max_length=10)
        assert validate_answer(capped, "long", {"value": "x" * 50})[0] == "x" * 10

    def test_extract_json_object(self) -> None:
        assert extract_json_object('```json\n{"value": "a"}\n```') == {"value": "a"}
        assert extract_json_object('<think>hmm {"no": 1}</think>{"value": "b"}') == {"value": "b"}
        assert extract_json_object('Sure! {"value": "c", "confidence": 1} hope it helps') == {
            "value": "c", "confidence": 1,
        }
        with pytest.raises(ModelOutputError):
            extract_json_object("no json here")


class TestRateLimiter:
    @pytest.mark.asyncio
    async def test_blocks_after_budget(self) -> None:
        limiter = RateLimiter(max_calls=2, period_s=0.3)
        t0 = time.perf_counter()
        await limiter.acquire()
        await limiter.acquire()
        waited = await limiter.acquire()
        assert waited > 0
        assert time.perf_counter() - t0 >= 0.25


# ── coordinator + workers ─────────────────────────────────────────────

class TestPool:
    @pytest.mark.asyncio
    async def test_builds_15_independent_workers(self) -> None:
        c = Coordinator(settings())
        await c.ensure_started()
        try:
            snap = c.snapshot()
            assert snap["total"] == 15
            assert all(set(w["models"]) == {"fast", "quality"} for w in snap["workers"])
            assert snap["fast_models"] == ["fast-a", "fast-b"]
            assert snap["quality_models"] == ["big-a", "big-b"]
            clients = {id(w._client) for w in c.workers}
            assert len(clients) == 15  # each worker owns its own HTTP client
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_fifteen_tasks_run_in_parallel_on_fifteen_workers(self) -> None:
        async def slow(request: httpx.Request) -> httpx.Response:
            await asyncio.sleep(0.4)
            return smart_answer(request)

        c = Coordinator(settings())
        await c.ensure_started()
        try:
            with respx.mock(assert_all_called=False) as m:
                m.post(CHAT).mock(side_effect=slow)
                t0 = time.perf_counter()
                data = await c.fill(FillRequest(fields=ai_fields(15), profile=PROFILE), "k")
                elapsed = time.perf_counter() - t0
            assert elapsed < 1.2, f"expected parallel execution, took {elapsed:.2f}s"
            assert data.stats.ai_tasks == 15
            assert data.stats.workers_used == 15
            assert all(a.source == "ai" for a in data.answers.values())
            assert {a.worker_id for a in data.answers.values()} == set(range(1, 16))
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_routes_by_tier_and_uses_profile_first(self) -> None:
        c = Coordinator(settings())
        await c.ensure_started()
        fields = [
            FieldSpec(id="fn", label="First name"),
            FieldSpec(id="em", label="Email", type="email"),
            FieldSpec(id="yrs", label="Years of Experience", type="select",
                      options=["", "0-1", "2-4", "10+"]),
            FieldSpec(id="cl", label="Cover letter", type="textarea"),
            FieldSpec(id="title", label="Desired Job Title"),
        ]
        try:
            with respx.mock(assert_all_called=False) as m:
                route = m.post(CHAT).mock(side_effect=smart_answer)
                data = await c.fill(
                    FillRequest(fields=fields, profile=PROFILE, job=JobContext(title="Staff Engineer")), "k"
                )
            a = data.answers
            assert a["fn"].value == "Ada" and a["fn"].source == "profile" and a["fn"].worker_id is None
            assert a["em"].value == "ada@example.com"
            assert a["yrs"].value == "10+" and a["yrs"].kind == "choice"
            assert a["cl"].kind == "long" and a["cl"].model in {"big-a", "big-b"}
            assert a["yrs"].model in {"fast-a", "fast-b"}
            assert a["title"].model in {"fast-a", "fast-b"}
            assert route.call_count == 3  # profile fields never hit the model
            assert data.stats.profile_fields == 2
            assert list(a) == ["fn", "em", "yrs", "cl", "title"]
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_failure_is_reassigned_to_another_worker_and_model(self) -> None:
        def flaky(request: httpx.Request) -> httpx.Response:
            if json.loads(request.content)["model"] == "fast-a":
                return httpx.Response(503, text="overloaded")
            return smart_answer(request)

        c = Coordinator(settings())
        await c.ensure_started()
        try:
            with respx.mock(assert_all_called=False) as m:
                m.post(CHAT).mock(side_effect=flaky)
                data = await c.fill(FillRequest(fields=ai_fields(4), profile=PROFILE), "k")
            for ans in data.answers.values():
                assert ans.source == "ai"
                assert ans.model != "fast-a"
            assert any(a.attempts == 2 for a in data.answers.values())
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_missing_model_disables_worker(self) -> None:
        def gone(request: httpx.Request) -> httpx.Response:
            if json.loads(request.content)["model"] == "fast-b":
                return httpx.Response(404, text="model not found")
            return smart_answer(request)

        c = Coordinator(settings(num_workers=4))
        await c.ensure_started()
        try:
            with respx.mock(assert_all_called=False) as m:
                m.post(CHAT).mock(side_effect=gone)
                data = await c.fill(FillRequest(fields=ai_fields(4), profile=PROFILE), "k")
            assert all(a.source == "ai" and a.model != "fast-b" for a in data.answers.values())
            workers = c.snapshot()["workers"]
            assert all(w["state"] != "disabled" for w in workers)  # still usable via other model
            assert all(w["disabled_models"] == ["fast-b"] for w in workers)  # pool-wide
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_invalid_choice_is_retried(self) -> None:
        calls = {"n": 0}

        def picky(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 1:
                return reply({"value": "a lot", "confidence": 0.9})
            return reply('```json\n{"value": "2-4", "confidence": 0.6}\n```')

        c = Coordinator(settings())
        await c.ensure_started()
        try:
            with respx.mock(assert_all_called=False) as m:
                m.post(CHAT).mock(side_effect=picky)
                spec = FieldSpec(id="y", label="Years", type="select", options=["0-1", "2-4"])
                data = await c.fill(FillRequest(fields=[spec], profile=PROFILE), "k")
            assert data.answers["y"].value == "2-4"
            assert data.answers["y"].attempts == 2
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_exhausted_retries_give_empty_answer_not_crash(self) -> None:
        c = Coordinator(settings(max_attempts=2))
        await c.ensure_started()
        try:
            with respx.mock(assert_all_called=False) as m:
                m.post(CHAT).mock(return_value=httpx.Response(500, text="boom"))
                data = await c.fill(
                    FillRequest(fields=[FieldSpec(id="fn", label="First name"), *ai_fields(1)], profile=PROFILE), "k"
                )
            assert data.answers["fn"].value == "Ada"
            assert data.answers["q0"].value == "" and data.answers["q0"].error == "NvidiaUpstreamError"
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_bad_key_fails_fast(self) -> None:
        c = Coordinator(settings())
        await c.ensure_started()
        try:
            with respx.mock(assert_all_called=False) as m:
                m.post(CHAT).mock(return_value=httpx.Response(401, text="nope"))
                with pytest.raises(NvidiaAuthError):
                    await c.fill(FillRequest(fields=ai_fields(3), profile=PROFILE), "bad")
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_coordinator_timeout_reassigns(self) -> None:
        async def first_hangs(request: httpx.Request) -> httpx.Response:
            if json.loads(request.content)["model"] == "fast-a":
                await asyncio.sleep(2)
            return smart_answer(request)

        c = Coordinator(settings(num_workers=2, task_timeout_s=0.3))
        await c.ensure_started()
        try:
            with respx.mock(assert_all_called=False) as m:
                m.post(CHAT).mock(side_effect=first_hangs)
                data = await c.fill(FillRequest(fields=ai_fields(1), profile=PROFILE), "k")
            assert data.answers["q0"].model == "fast-b"
            assert data.answers["q0"].attempts == 2
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_model_discovery_drops_unavailable_models(self) -> None:
        c = Coordinator(settings(discover_models=True))
        with respx.mock(assert_all_called=False) as m:
            m.get(f"{BASE}/models").mock(
                return_value=httpx.Response(200, json={"data": [{"id": "fast-b"}, {"id": "big-a"}, {"id": "x"}]})
            )
            await c.ensure_started("k")
        try:
            snap = c.snapshot()
            assert snap["fast_models"] == ["fast-b"]
            assert snap["quality_models"] == ["big-a"]
            assert snap["total"] == 15
        finally:
            await c.stop()

    @pytest.mark.asyncio
    async def test_location_preference_default_combined(self) -> None:
        c = Coordinator(settings())
        await c.ensure_started()
        try:
            profile = CandidateProfile(
                location="Warsaw, Poland",
                work_mode="hybrid (2-3 days from the office)",
            )
            fields = [
                FieldSpec(
                    id="lp",
                    label="What are your preferences regarding location and the way of working (willing to work remote/in hybrid model/etc)?",
                    type="textarea",
                )
            ]
            with respx.mock(assert_all_called=False) as m:
                route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
                data = await c.fill(FillRequest(fields=fields, profile=profile), "k")
            ans = data.answers["lp"]
            assert ans.value == "Warsaw, Poland. Hybrid (2-3 days from the office)."
            assert ans.source == "profile"
            assert ans.confidence == 0.9
            # Ensure no AI call was made
            assert route.call_count == 0
        finally:
            await c.stop()
