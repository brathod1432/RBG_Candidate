# server/agents/worker.py
"""AIWorker: one independent worker in the pool.

Each worker is self-contained, like a tiny service:
  * its own inbox queue and asyncio task (processes one job at a time),
  * its own HTTP client and assigned model/tier,
  * its own stats and circuit breaker (cooldown after repeated failures).

Workers never pick work themselves; the Coordinator assigns jobs to them.
"""

import asyncio
import logging
import ssl
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from ..nvidia_client import (
    NvidiaModelError,
    chat_completion,
    extract_json_object,
)
from .limiter import RateLimiter
from .tasks import AITask, Tier

logger = logging.getLogger(__name__)

WorkerState = Literal["idle", "busy", "cooldown", "disabled", "stopped"]


@dataclass
class WorkerResult:
    worker_id: int
    model: str
    content: str
    parsed: dict[str, Any] | None
    latency_ms: int


@dataclass
class Job:
    task: AITask
    future: "asyncio.Future[WorkerResult]"
    parse_json: bool = True
    model: str | None = None  # coordinator's pick for this attempt


@dataclass
class WorkerStats:
    completed: int = 0
    failed: int = 0
    consecutive_failures: int = 0
    total_latency_ms: int = 0
    last_error: str | None = None

    @property
    def avg_latency_ms(self) -> int:
        return self.total_latency_ms // self.completed if self.completed else 0


@dataclass
class AIWorker:
    worker_id: int
    models: dict[str, str]  # tier -> model id, e.g. {"fast": ..., "quality": ...}
    base_url: str
    limiter: RateLimiter
    request_timeout_s: float = 45.0
    failure_threshold: int = 3
    cooldown_s: float = 30.0
    ssl_context: ssl.SSLContext | None = None
    stats: WorkerStats = field(default_factory=WorkerStats)
    inbox: "asyncio.Queue[Job]" = field(default_factory=asyncio.Queue)
    busy: bool = False
    disabled_models: dict[str, str] = field(default_factory=dict)  # model -> reason
    cooldown_until: float = 0.0
    _client: httpx.AsyncClient | None = None
    _runner: "asyncio.Task[None] | None" = None

    # ── lifecycle ──
    async def start(self) -> None:
        if self._runner is not None:
            return
        self._client = httpx.AsyncClient(
            timeout=self.request_timeout_s,
            verify=self.ssl_context if self.ssl_context is not None else True,
        )
        self._runner = asyncio.create_task(self._run(), name=f"ai-worker-{self.worker_id}")

    async def stop(self) -> None:
        if self._runner is not None:
            self._runner.cancel()
            try:
                await self._runner
            except asyncio.CancelledError:
                pass
            self._runner = None
        while not self.inbox.empty():
            job = self.inbox.get_nowait()
            if not job.future.done():
                job.future.cancel()
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── coordinator-facing view ──
    @property
    def load(self) -> int:
        return self.inbox.qsize() + (1 if self.busy else 0)

    def model_for(self, tier: Tier) -> str | None:
        """Model this worker uses for a tier (None when that model is unusable)."""
        model = self.models.get(tier) or next(iter(self.models.values()), None)
        if model is None or model in self.disabled_models:
            other = [m for m in self.models.values() if m not in self.disabled_models]
            return other[0] if other else None
        return model

    @property
    def disabled_reason(self) -> str | None:
        if self.models and all(m in self.disabled_models for m in self.models.values()):
            return "; ".join(sorted(set(self.disabled_models.values())))
        return None

    def state(self, now: float | None = None) -> WorkerState:
        if self._runner is None:
            return "stopped"
        if self.disabled_reason is not None:
            return "disabled"
        if (now if now is not None else time.monotonic()) < self.cooldown_until:
            return "cooldown"
        return "busy" if self.busy else "idle"

    def is_available(self, now: float | None = None) -> bool:
        return self.state(now) in ("idle", "busy")

    def submit(self, job: Job) -> None:
        self.inbox.put_nowait(job)

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.worker_id,
            "models": dict(self.models),
            "state": self.state(),
            "queued": self.inbox.qsize(),
            "completed": self.stats.completed,
            "failed": self.stats.failed,
            "avg_latency_ms": self.stats.avg_latency_ms,
            "last_error": self.stats.last_error,
            "disabled_models": sorted(self.disabled_models),
        }

    # ── work loop ──
    async def _run(self) -> None:
        while True:
            job = await self.inbox.get()
            if job.future.done():  # coordinator gave up (timeout) before we started
                continue
            self.busy = True
            try:
                result = await self._execute(job)
            except asyncio.CancelledError:
                if not job.future.done():
                    job.future.cancel()
                raise
            except Exception as exc:  # noqa: BLE001 — any failure is reported to the coordinator
                self._record_failure(exc)
                if not job.future.done():
                    job.future.set_exception(exc)
            else:
                self._record_success(result.latency_ms)
                if not job.future.done():
                    job.future.set_result(result)
            finally:
                self.busy = False

    async def _execute(self, job: Job) -> WorkerResult:
        if self._client is None:
            raise RuntimeError("worker not started")
        model = job.model or self.model_for(job.task.tier)
        if model is None:
            raise NvidiaModelError("-", 404, "no usable model on this worker")
        await self.limiter.acquire()
        started = time.perf_counter()
        messages = job.task.messages
        if "nemotron" in model.lower() and messages and messages[0]["role"] == "system":
            # Nemotron reasoning models: skip the <think> phase so short answers fit max_tokens.
            messages = [{"role": "system", "content": "/no_think\n" + messages[0]["content"]}, *messages[1:]]
        content = await chat_completion(
            self._client,
            api_key=job.task.api_key,
            model=model,
            messages=messages,
            base_url=self.base_url,
            temperature=job.task.temperature,
            max_tokens=job.task.max_tokens,
        )
        parsed = extract_json_object(content) if job.parse_json else None
        latency_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "worker %d (%s) finished task %d kind=%s in %dms",
            self.worker_id, model, job.task.task_id, job.task.kind, latency_ms,
        )
        return WorkerResult(self.worker_id, model, content, parsed, latency_ms)

    def _record_success(self, latency_ms: int) -> None:
        self.stats.completed += 1
        self.stats.total_latency_ms += latency_ms
        self.stats.consecutive_failures = 0

    def _record_failure(self, exc: Exception) -> None:
        self.stats.failed += 1
        self.stats.consecutive_failures += 1
        self.stats.last_error = type(exc).__name__
        if isinstance(exc, NvidiaModelError):
            self.disabled_models[exc.model] = f"model unavailable ({exc.status_code})"
            logger.warning("worker %d stops using %s: %s", self.worker_id, exc.model, exc)
            return
        if self.stats.consecutive_failures >= self.failure_threshold:
            self.cooldown_until = time.monotonic() + self.cooldown_s
            self.stats.consecutive_failures = 0
            logger.warning(
                "worker %d (%s) cooling down %.0fs after repeated failures",
                self.worker_id, list(self.models.values()), self.cooldown_s,
            )
