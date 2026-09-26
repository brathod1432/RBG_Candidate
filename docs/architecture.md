# Architecture — RBG Candidate

> Source: idea.md (249 lines) + ToT-1 (stateless proxy, conf 91) + ToT-2 (WebCrypto-only, conf 88)
> Status: planned, not yet implemented · Task: rgbf51-20260924-001

## 1. Overview
Chrome/Edge MV3 extension that auto-fills job applications. AI field detection via Nvidia API through a stateless FastAPI proxy. Privacy-first: all PII + API key stay on-device in chrome.storage; server stores nothing.

## 2. Components
```
[Popup React] <--message--> [Background SW] <--HTTPS--> [FastAPI /analyze] --> [Nvidia API]
      ^                            |
      | preview/confirm            v
[Content script: scan DOM, build FieldMap]   [chrome.storage.local PII + ciphertext | session derived key]
```

- **client/**: MV3, TS + React + Zustand, Vite (or Webpack — task-8 picks one, documents why). Permissions: `storage`, `activeTab`, `scripting` only. CSP: no `wasm-unsafe-eval`.
- **server/**: Python 3.11 FastAPI, async, Pydantic v2. Stateless. No DB. In-memory per-IP rate limit (single-instance assumption documented). No-PII logs only.
- **security/**: WebCrypto PBKDF2 (~310k iter) + AES-GCM. No Rust WASM (rejected — see §5).
- **tests/ + e2e/**: pytest + vitest + Playwright.

## 3. API contract
- `GET /health` → `{"status":"ok"}`
- `POST /analyze` request: `{ "html": "<form slice>", "api_key?": "nvapi-..." }`
  - BYOK default: client sends user key per-request over HTTPS, server never persists/logs it.
  - Fallback: server's own `NVIDIA_API_KEY` env (operator key) when client omits key.
- Success: `{"status":"ok","data":{...nvidia result...}}`
- Error: `{"status":"error","message":"...","code":"SNAKE_CASE"}`
  - 403 INVALID_KEY, 429 RATE_LIMITED, 504 UPSTREAM_TIMEOUT, 502 UPSTREAM_ERROR
- CORS: allowlist only (no `*`). HTTPS required in prod.

## 4. Data + storage map
| Data | Where | Protection |
|---|---|---|
| Name/email/experience | `chrome.storage.local` | plaintext (documented) |
| Nvidia API key (optional) | `chrome.storage.local` `rbg_api_key_enc` | ciphertext + IV (AES-GCM, random non-extractable device key) |
| Device key | extension IndexedDB `rbg-keys` | non-extractable CryptoKey, created on first save; no passphrase |
| Server | — | stores nothing; never logs html/key |

## 5. Key decisions (ToT verdicts)
- **D1 Stateless proxy, no DB** (ToT-1 SYNTHESIS): BYOK client-side default + operator-key fallback; in-memory rate limit + no-PII error logs. GDPR/CCPA by design (transient processing only). Revisit if cross-device sync / team sharing lands.
- **D2 WebCrypto-only, no WASM** (ToT-2 SYNTHESIS): PBKDF2+AES-GCM, session-cached key. WASM rejected: CSP regression, JS-readable linear memory = zero threat-model gain, review + toolchain cost. Session-only key variant kept as documented fallback for privacy-max users.
- **D3 No auto-submit**: manual user confirm required before any fill; preview modal mandatory.
- **D4 Build tool**: deferred to task-8 (Vite preferred for speed, Webpack acceptable — must justify).

## 6. Multi-stage flow
1. Content detects stage (`[data-stage]` → URL → heading fallback).
2. Popup shows "Stage N detected. Fill or Skip".
3. Scan → server /analyze → preview modal → user confirms per-field → fill current stage only.

## 7. Non-goals v1.0
No server DB, no analytics/tracking, no auto-submit, no cross-device sync, no Rust WASM, no `*` CORS.


## 8. AI coordinator + worker pool (added 2026-09-24)
- `POST /fill` takes field descriptors from the content script (id, label, type, options, required, maxlength), the profile (+ free-text resume) and job context.
- **Coordinator** (`server/agents/coordinator.py`): (1) answers obvious profile fields locally (name split, email, phone, current title, summary), no model call; (2) classifies the rest as `short` / `choice` / `long`; (3) assigns each task to the least-loaded healthy worker, preferring a model not yet tried; (4) per-task timeout, re-assignment to another worker/model, 429 back-off, auth errors fail fast; (5) validates answers against the field and merges them in form order with a run report.
- **Workers** (`server/agents/worker.py`): 15 by default (`AI_WORKERS`). Each is independent: own inbox queue + asyncio task, own `httpx.AsyncClient`, a fast model and a quality model, own counters and circuit breaker (cooldown after N consecutive failures). A 403/404 model error disables that model pool-wide.
- **Shared limiter** (`server/agents/limiter.py`): `NVIDIA_MAX_RPM` across all workers (free tier ≈ 40/min).
- **Model discovery**: at start-up the pool calls `GET /v1/models` with the server key and drops configured models the key can't see.
- `GET /workers` exposes the pool snapshot. `POST /analyze` (legacy) runs as a single quality task.
- Extension flow: popup `SCAN` → content (`SCAN_RESULT` with descriptors + job) → popup `AI_SUGGEST` → background (reads profile + decrypts BYOK) → `POST /fill` → Review (editable, per-field source: profile / worker N · model · confidence) → `FILL` → background → content `FILL_APPLY` (fallback: `scripting.executeScript`). Never submits.
