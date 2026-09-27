# server/agents/coordinator.py
"""Coordinator: plans form-fill work and moderates the AI worker pool.

Flow for POST /fill:
  1. Plan    – every field is either resolved straight from the profile
               (no model call) or turned into an AITask (short/choice/long).
  2. Assign  – each task goes to the least-loaded healthy worker of the
               right tier (fast models for short/choice, quality for long).
  3. Watch   – per-task timeout; failures are re-assigned to a *different*
               worker, preferring a different model; 429s back off first.
  4. Verify  – answers are validated against the field spec (select options,
               numbers, email, max length); invalid answers are retried.
  5. Merge   – one answer per field plus a run report.
"""

import asyncio
import logging
import ssl
import time
from dataclasses import dataclass
from typing import Any

import certifi
import httpx

from ..config import AgentSettings
from ..nvidia_client import (
    ANALYZE_SYSTEM_PROMPT,
    ModelOutputError,
    NvidiaAuthError,
    NvidiaError,
    NvidiaModelError,
    NvidiaRateLimitError,
    NvidiaTimeoutError,
    NvidiaUpstreamError,
    list_models,
)
from ..schemas.fill import FieldAnswer, FieldSpec, FillData, FillRequest, FillStats
from .limiter import RateLimiter
from .relevance import plan_language_answers, plan_skill_answers, smart_truncate
from .tasks import (
    AITask,
    FieldKind,
    Tier,
    build_field_task,
    classify_kind,
    resolve_availability_default,
    resolve_current_employer_default,
    resolve_from_profile,
    resolve_gender_default,
    resolve_location_preference_default,
    resolve_notice_default,
    resolve_office_frequency,
    resolve_relocation_default,
    resolve_salary_default,
    resolve_work_authorization_default,
    resolve_work_model_yesno,
    resolve_work_permit,
    validate_answer,
)
from .worker import AIWorker, Job, WorkerResult

logger = logging.getLogger(__name__)


class NoWorkersAvailable(NvidiaError):
    """Raised when every worker is disabled (e.g. no configured model exists)."""


@dataclass
class TaskOutcome:
    result: WorkerResult
    attempts: int


class Coordinator:
    """Owns the worker pool and assigns every task explicitly."""

    def __init__(self, settings: AgentSettings) -> None:
        self.settings = settings
        self.limiter = RateLimiter(settings.max_rpm)
        self.workers: list[AIWorker] = []
        self.started = False
        self.discovered_models: list[str] | None = None
        self._start_lock = asyncio.Lock()
        self._ssl_context: ssl.SSLContext | None = None
        # Answer memory: (field label, job title, profile json) -> the AI answer.
        # Repeat questions ("Why us?") across stages and requests cost no new call.
        self._answer_cache: dict[tuple[str, str, str], FieldAnswer] = {}

    # ── lifecycle ─────────────────────────────────────────────────────
    async def ensure_started(self, discovery_key: str | None = None) -> None:
        if self.started:
            return
        async with self._start_lock:
            if self.started:
                return
            fast, quality = await self._resolve_models(discovery_key)
            # One TLS context shared by all workers (each still has its own client/pool).
            self._ssl_context = ssl.create_default_context(cafile=certifi.where())
            self.workers = self._build_workers(fast, quality)
            for worker in self.workers:
                await worker.start()
            self.started = True
            logger.info(
                "coordinator started %d workers (fast=%s, quality=%s)",
                len(self.workers), fast, quality,
            )

    async def stop(self) -> None:
        for worker in self.workers:
            await worker.stop()
        self.started = False

    async def _resolve_models(self, key: str | None) -> tuple[list[str], list[str]]:
        fast = list(self.settings.fast_models)
        quality = list(self.settings.quality_models)
        if not (self.settings.discover_models and key):
            return fast, quality
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                available = set(await list_models(client, api_key=key, base_url=self.settings.base_url))
        except Exception as exc:  # noqa: BLE001 — discovery is best-effort
            logger.warning("model discovery skipped: %s", type(exc).__name__)
            return fast, quality
        self.discovered_models = sorted(available)
        keep_fast = [m for m in fast if m in available]
        keep_quality = [m for m in quality if m in available]
        dropped = [m for m in fast + quality if m not in available]
        if dropped:
            logger.warning("models not available to this key, skipped: %s", dropped)
        if not keep_fast and not keep_quality:
            logger.warning("none of the configured models are listed; keeping config as-is")
            return fast, quality
        return keep_fast or keep_quality, keep_quality or keep_fast

    def _build_workers(self, fast: list[str], quality: list[str]) -> list[AIWorker]:
        """Every worker is a generalist: it holds one fast and one quality model.

        Models are spread round-robin so retries can move to a different model
        and all workers can take any task kind.
        """
        s = self.settings
        fast = fast or quality
        quality = quality or fast
        workers: list[AIWorker] = []
        for i in range(s.num_workers):
            workers.append(
                AIWorker(
                    worker_id=i + 1,
                    models={"fast": fast[i % len(fast)], "quality": quality[i % len(quality)]},
                    base_url=s.base_url,
                    limiter=self.limiter,
                    request_timeout_s=s.request_timeout_s,
                    failure_threshold=s.failure_threshold,
                    cooldown_s=s.cooldown_s,
                    ssl_context=self._ssl_context,
                )
            )
        return workers

    # ── assignment ────────────────────────────────────────────────────
    def pick_worker(
        self,
        tier: Tier,
        exclude_ids: set[int] | None = None,
        avoid_models: set[str] | None = None,
    ) -> tuple[AIWorker, str]:
        """Least-loaded healthy worker (preferring an untried model) + the model to use."""
        exclude_ids = exclude_ids or set()
        avoid_models = avoid_models or set()
        now = time.monotonic()
        enabled = [w for w in self.workers if w.model_for(tier) is not None]
        if not enabled:
            raise NoWorkersAvailable("all workers are disabled (no usable model)")
        candidates = [w for w in enabled if w.is_available(now) and w.worker_id not in exclude_ids]
        if not candidates:
            candidates = [w for w in enabled if w.worker_id not in exclude_ids] or enabled

        def score(w: AIWorker) -> tuple[int, int, int, int]:
            return (
                1 if w.model_for(tier) in avoid_models else 0,
                w.load,
                w.stats.completed + w.stats.failed,
                w.worker_id,
            )

        worker = min(candidates, key=score)
        model = worker.model_for(tier)
        assert model is not None
        return worker, model

    async def run_task(
        self, task: AITask, *, max_attempts: int | None = None, parse_json: bool = True, spec_check: Any = None
    ) -> TaskOutcome:
        """Assign a task, watch it, and re-assign on failure."""
        attempts_allowed = max_attempts or self.settings.max_attempts
        tried_ids: set[int] = set()
        tried_models: set[str] = set()
        last_exc: Exception | None = None
        loop = asyncio.get_running_loop()

        for attempt in range(1, attempts_allowed + 1):
            worker, model = self.pick_worker(task.tier, tried_ids, tried_models)
            tried_ids.add(worker.worker_id)
            tried_models.add(model)
            future: asyncio.Future[WorkerResult] = loop.create_future()
            worker.submit(Job(task=task, future=future, parse_json=parse_json, model=model))
            try:
                result = await asyncio.wait_for(future, timeout=self.settings.task_timeout_s)
                if spec_check is not None:
                    spec_check(result)
                return TaskOutcome(result=result, attempts=attempt)
            except NvidiaAuthError:
                raise
            except asyncio.TimeoutError:
                last_exc = NvidiaTimeoutError("task timed out in coordinator")
                logger.warning("task %d timed out on worker %d", task.task_id, worker.worker_id)
            except NvidiaRateLimitError as exc:
                last_exc = exc
                if attempt < attempts_allowed:
                    await asyncio.sleep(min(8.0, 1.5 * attempt))
            except NvidiaModelError as exc:
                # A missing/forbidden model is a pool-wide fact: stop every worker using it.
                last_exc = exc
                for w in self.workers:
                    w.disabled_models.setdefault(model, f"model unavailable ({exc.status_code})")
                logger.warning("model %s disabled pool-wide (%d)", model, exc.status_code)
            except (NvidiaTimeoutError, NvidiaUpstreamError, ModelOutputError) as exc:
                last_exc = exc
                logger.info(
                    "task %d attempt %d failed on worker %d: %s",
                    task.task_id, attempt, worker.worker_id, type(exc).__name__,
                )
        assert last_exc is not None
        raise last_exc

    # ── public operations ─────────────────────────────────────────────
    async def fill(self, request: FillRequest, api_key: str) -> FillData:
        started = time.perf_counter()
        answers: dict[str, FieldAnswer] = {}
        jobs: list[tuple[str, str, asyncio.Task[FieldAnswer]]] = []

        # Skill fields (lists, "Skill 1..N" slots, skill drop-downs) are filled from the candidate's
        # skills ranked against this job, so limited space goes to the most relevant ones first.
        skill_values = plan_skill_answers(request.fields, request.profile, request.job)
        language_values = plan_language_answers(request.fields, request.profile)

        for spec in request.fields:
            if spec.id in skill_values:
                answers[spec.id] = FieldAnswer(
                    value=skill_values[spec.id], confidence=0.9, source="profile", kind="profile"
                )
                continue
            if spec.id in language_values:
                answers[spec.id] = FieldAnswer(
                    value=language_values[spec.id], confidence=0.9, source="profile", kind="profile"
                )
                continue
            direct = resolve_from_profile(spec, request.profile)
            defaulted = False
            if direct is None:
                direct = (
                    resolve_notice_default(spec, request.profile)
                    or resolve_gender_default(spec, request.profile)
                    or resolve_work_authorization_default(spec, request.profile)
                    or resolve_relocation_default(spec, request.profile)
                    or resolve_availability_default(spec, request.profile)
                    or resolve_salary_default(spec, request.profile)
                    or resolve_current_employer_default(spec, request.profile, request.job)
                    or resolve_location_preference_default(spec, request.profile)
                    or resolve_work_model_yesno(spec, request.profile)
                    or resolve_office_frequency(spec, request.profile)
                    or resolve_work_permit(spec, request.profile)
                )
                defaulted = direct is not None
            if direct is not None:
                value = smart_truncate(direct, spec.max_length)
                answers[spec.id] = FieldAnswer(
                    value=value, confidence=0.9 if defaulted else 1.0, source="profile", kind="profile"
                )
                continue
            kind = classify_kind(spec)
            cache_key = self._cache_key(spec, request)
            cached = self._answer_cache.get(cache_key)
            if cached is not None and cached.value:
                answers[spec.id] = FieldAnswer(
                    value=cached.value,
                    confidence=cached.confidence,
                    source=cached.source,
                    kind=kind,
                    worker_id=cached.worker_id,
                    model=cached.model,
                    attempts=cached.attempts,
                    latency_ms=0,
                    error=None,
                )
                continue
            task = build_field_task(spec, kind, request.profile, request.job, api_key)
            jobs.append((spec.id, cache_key, asyncio.create_task(self._answer_field(spec, kind, task))))

        if jobs:
            done = await asyncio.gather(*(job for _, _, job in jobs), return_exceptions=True)
            for (field_id, cache_key, _task), outcome in zip(jobs, done):
                if isinstance(outcome, NvidiaAuthError):
                    raise outcome
                if isinstance(outcome, BaseException):
                    answers[field_id] = FieldAnswer(
                        value="", confidence=0.0, source="none",
                        kind=classify_kind(next(f for f in request.fields if f.id == field_id)),
                        error=type(outcome).__name__,
                    )
                else:
                    answers[field_id] = outcome
                    if outcome.value:
                        self._answer_cache[cache_key] = outcome

        ordered = {spec.id: answers[spec.id] for spec in request.fields}
        used = {a.worker_id for a in ordered.values() if a.worker_id is not None}
        models = sorted({a.model for a in ordered.values() if a.model})
        stats = FillStats(
            total_fields=len(ordered),
            profile_fields=sum(1 for a in ordered.values() if a.source == "profile"),
            ai_tasks=len(jobs),
            workers_used=len(used),
            models_used=models,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
        logger.info(
            "fill done: %d fields, %d ai tasks, %d workers, %dms",
            stats.total_fields, stats.ai_tasks, stats.workers_used, stats.duration_ms,
        )
        return FillData(answers=ordered, stats=stats)

    @staticmethod
    def _cache_key(spec: FieldSpec, request: FillRequest) -> tuple[str, str, str]:
        """Answer-memory key: field label + job title + the exact profile content."""
        return (
            (spec.label or spec.placeholder or spec.id).strip().lower(),
            ((request.job.title or "") if request.job else "").strip().lower(),
            request.profile.model_dump_json(),
        )

    async def _answer_field(self, spec: FieldSpec, kind: FieldKind, task: AITask) -> FieldAnswer:
        checked: dict[str, tuple[str, float]] = {}

        def check(result: WorkerResult) -> None:
            checked["v"] = validate_answer(spec, kind, result.parsed or {})

        outcome = await self.run_task(task, spec_check=check)
        value, confidence = checked["v"]
        return FieldAnswer(
            value=value,
            confidence=confidence,
            source="ai" if value else "none",
            kind=kind,
            worker_id=outcome.result.worker_id,
            model=outcome.result.model,
            attempts=outcome.attempts,
            latency_ms=outcome.result.latency_ms,
        )

    async def analyze(self, api_key: str, html: str) -> WorkerResult:
        """Legacy /analyze: one quality task, no retries (errors map 1:1 to HTTP codes)."""
        task = AITask(
            kind="analyze",
            api_key=api_key,
            messages=[
                {"role": "system", "content": ANALYZE_SYSTEM_PROMPT},
                {"role": "user", "content": html},
            ],
            temperature=0.1,
            max_tokens=2048,
        )
        outcome = await self.run_task(task, max_attempts=1, parse_json=False)
        return outcome.result

    def snapshot(self) -> dict[str, Any]:
        workers = [w.snapshot() for w in self.workers]
        return {
            "started": self.started,
            "workers": workers,
            "total": len(workers),
            "available": sum(1 for w in self.workers if w.is_available()),
            "rpm_limit": self.settings.max_rpm,
            "calls_last_minute": self.limiter.in_window(),
            "fast_models": sorted({w.models["fast"] for w in self.workers}),
            "quality_models": sorted({w.models["quality"] for w in self.workers}),
        }
