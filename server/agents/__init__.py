# server/agents/__init__.py
"""AI coordinator + worker pool."""

from fastapi import FastAPI

from ..config import AgentSettings
from .coordinator import Coordinator, NoWorkersAvailable
from .worker import AIWorker

__all__ = ["AIWorker", "Coordinator", "NoWorkersAvailable", "get_coordinator"]


def get_coordinator(app: FastAPI) -> Coordinator:
    """One coordinator per app instance, created lazily (settings read from env)."""
    coordinator = getattr(app.state, "coordinator", None)
    if coordinator is None:
        coordinator = Coordinator(AgentSettings.from_env())
        app.state.coordinator = coordinator
    return coordinator
