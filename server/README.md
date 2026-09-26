# Server — FastAPI backend + AI worker pool

Stateless FastAPI proxy for RBG Candidate (Python 3.11+). No database, no PII logs.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness → `{"status":"ok"}` |
| POST | `/fill` | coordinator + worker pool answers every described form field |
| GET | `/workers` | live pool snapshot (worker ids, models, state, counters; no keys) |
| POST | `/analyze` | legacy: one HTML snippet → one quality worker |

## Layout
```
server/
├── main.py            app factory, CORS, error envelope, pool start/stop in lifespan
├── config.py          loads ../.env, AgentSettings.from_env()
├── nvidia_client.py   chat_completion / list_models, error types, tolerant JSON parsing
├── agents/
│   ├── coordinator.py plan → assign → watch → verify → merge
│   ├── worker.py      AIWorker: own inbox, HTTP client, models, stats, circuit breaker
│   ├── tasks.py       profile resolver, task kinds, prompts, answer validation
│   └── limiter.py     shared requests-per-minute limiter
├── routers/           analyze.py, fill.py, guards.py (IP, rate limit, key resolution)
└── schemas/           Pydantic v2 models
```

## Run (from the project root, not from server/)
```bat
scripts\setup-venv.bat
.venv\Scripts\python.exe -m uvicorn server.main:app --reload --port 8000
```
The package uses relative imports, so `uvicorn main:app` inside `server\` does not work.

## Test
```bat
.venv\Scripts\python.exe -m pytest tests -q
.venv\Scripts\python.exe scripts\nvidia_smoke_test.py     (live NVIDIA check, uses .env key)
```

## Environment
Copy the root `.env.example` to `.env`. All pool settings are documented there.
