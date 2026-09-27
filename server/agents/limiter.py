# server/agents/limiter.py
"""Shared sliding-window rate limiter for upstream NVIDIA calls.

All workers share one limiter so 15 parallel workers never exceed the
account's requests-per-minute budget (NVIDIA free tier is ~40 RPM).
"""

import asyncio
import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    """Async sliding-window limiter: at most `max_calls` per `period_s`."""

    def __init__(
        self,
        max_calls: int,
        period_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if max_calls < 1:
            raise ValueError("max_calls must be >= 1")
        self.max_calls = max_calls
        self.period_s = period_s
        self._clock = clock
        self._stamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    def _prune(self, now: float) -> None:
        while self._stamps and now - self._stamps[0] >= self.period_s:
            self._stamps.popleft()

    async def acquire(self) -> float:
        """Wait for a slot. Returns seconds spent waiting."""
        waited = 0.0
        async with self._lock:
            while True:
                now = self._clock()
                self._prune(now)
                if len(self._stamps) < self.max_calls:
                    self._stamps.append(now)
                    return waited
                delay = self.period_s - (now - self._stamps[0]) + 0.01
                waited += delay
                await asyncio.sleep(delay)

    def in_window(self) -> int:
        self._prune(self._clock())
        return len(self._stamps)
