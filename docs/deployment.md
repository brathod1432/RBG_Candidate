# Deployment Documentation

## Overview

This project requires two separate deployments:

1. **Backend** — FastAPI service (Railway or Fly.io)
2. **Frontend** — Chrome/Edge MV3 extension (Chrome Web Store / Edge Add-ons)

The backend is the single source of truth for API proxying; the extension is a stateless client that stores data locally only.

---

## 1. Backend Deployment (FastAPI / Railway or Fly.io)

### Build & Start

| Command | Description |
|---|---|
| `pip install -r requirements.txt` | Install Python runtime deps (fastapi, uvicorn, httpx, pydantic, python-jose, python-dotenv) |
| `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | Start the FastAPI app; `$PORT` is injected by the host |

### Environment Variables

| Key | Required | Description |
|---|---|---|
| `NVIDIA_API_KEY` | Yes | NVIDIA Integrate API key (format: `nvapi-...`). Used as default BYOK when request payload does not include one. **Never commit this value.** |
| `PORT` | Yes | Server port. Must be between 1 and 65535. Defaults to `8000` if omitted. |
| `ALLOWED_ORIGINS` | Yes | Comma-separated list of CORS allowed origins (e.g. `http://localhost:3000,http://localhost:5173`). Must not be empty — the app raises `RuntimeError` if missing. |

### `.env.example` (reference only — never committed)

```env
# RBG Candidate — Environment Variables Template
# Copy to .env and fill in values. Never commit .env

# NVIDIA API key for model access (format: nvapi-...)
NVIDIA_API_KEY=

# Server port (default: 8000)
PORT=8000

# Comma-separated allowed CORS origins for development
# Example: http://localhost:3000,http://localhost:5173
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Health Check

- **Endpoint**: `/health`
- **Expected status**: `200`
- **Response**: `{"status": "ok"}`
- The FastAPI app already implements this at `server/main.py:68-70`.

### Single-Instance Note — In-Memory Rate Limiter

The backend uses an **in-memory per-IP rate limiter** (`server/routers/analyze.py:27-52`):

- 30 requests per minute per IP
- Stored in a `defaultdict(list)` that prunes timestamps outside the 60-second window
- **Not persisted** — if the app is scaled to multiple instances, rate limits do not cross-process. Deploy as a **single instance** on Railway/Fly.io to preserve rate-limit guarantees.

### Privacy Compliance (Backend)

- No server-side database — all PII resides on the client
- API calls to NVIDIA are **transient**; request HTML is not logged persistently
- Rate limiter is the only in-memory state; no PII is stored server-side
- HTTPS is required (Let's Encrypt on Railway/Fly.io)

---

## 2. Client Deployment (Chrome/Edge MV3 Extension)

### Build Process

| Command | Output |
|---|---|
| `npm run build` | Runs `tsc` then `vite build`; outputs to `client/dist/` |

The build produces:

- `client/dist/` — all compiled assets including `manifest.json`, background script, content scripts, and popup assets
- `client/dist/manifest.json` — copied by the Vite plugin from `client/manifest.json`

### Zip Creation for Chrome Web Store

1. After `npm run build`, create the extension zip:

```bash
cd client
zip -r rbg-candidate-$(date +%Y%m%d-%H%M%S).zip dist/
```

The zip must contain the `dist/` directory contents at the root (i.e. `manifest.json`, `background.js`, `popup.html`, etc.).

### Store Listing Requirements — Chrome Web Store

| Requirement | Value / Details |
|---|---|
| **Privacy Policy text** | `"RBG Candidate automates form filling but does not provide legal advice. Ensure compliance with job site terms."` (same as `client/src/popup/App.tsx` footer disclaimer) |
| **Permissions justification** | - `storage`: "Stores user profile and encrypted API key ciphertext locally in the browser."<br>- `activeTab`: "Selects the active tab for form scanning."<br>- `scripting": "Injects content scripts to read form fields." |
| **Screenshots** | 2–4 screenshots of the popup UI in action (dark/light mode). Must show the Settings, Fill, and Review tabs. |
| **Category** | Productivity > Form filler / Job search helper |
| **Email contact** | Public-facing email (not hardcoded in source) |

### Store Listing Requirements — Edge Add-ons

- Same privacy policy text and permissions justification as Chrome Web Store
- Edge accepts the same `.zip` artifact; ensure `manifest.json` `version` field is correct
- Edge validation is less strict than Chrome's; the same submission works for both.

### Privacy Compliance (Extension)

- **Local-only storage**: All user data (profile, encrypted API key) lives in `chrome.storage.local` / `chrome.storage.session` — never uploaded server-side unless the user explicitly initiates a scan.
- **Transient API calls**: The only server call is `POST /analyze`, which sends HTML form content + (optional) API key; the response is used purely for form-field extraction and is not stored.
- **GDPR/CCPA readiness**:
  - Users can revoke API key access at any time by clearing extension storage.
  - No PII is transmitted to or stored by the operator; the NVIDIA API is called with user-provided or operator BYOK keys only.
  - Privacy policy URL in the store listing contains the disclaimer text above.
  - Data export/deletion is manual (user-initiated via extension popup).

---

## 3. Verification Checklist

### Pre-Deploy

- [ ] All env vars set in the deployment target dashboard (NVIDIA_API_KEY, PORT, ALLOWED_ORIGINS)
- [ ] Database migrations run — **N/A** (no DB; stateless proxy)
- [ ] `/health` endpoint implemented and tested locally (`curl https://your-domain/health` returns 200)
- [ ] No hardcoded secrets in code (search for `nvapi-` or raw keys in `server/` and `client/`)
- [ ] `requirements.txt` is up to date and pinned
- [ ] `client/package.json` dependencies are current
- [ ] Chrome Extension privacy policy text matches the disclaimer in `client/src/popup/store.ts:6-8`
- [ ] Rate-limiter is single-instance confirmed (no horizontal scaling beyond one process)

### Post-Deploy

- [ ] Backend: `GET /health` returns `200 {"status":"ok"}`
- [ ] Backend: `POST /analyze` with valid payload returns 200 with analysis data (requires NVIDIA_API_KEY)
- [ ] Extension: `npm run build` produces `client/dist/` without TypeScript errors
- [ ] Extension zip created and loadable in `chrome://extensions/` (Developer mode → "Load unpacked")
- [ ] CORS allows the extension's origins (ALLOWED_ORIGINS includes the deployed backend URL and the extension's dev URL)
- [ ] No 403/429 errors from rate limiter on first request

---

## 4. Rollback Steps

### Backend (Railway / Fly.io)

1. In the host dashboard, select the previous deployed version from the deployment history.
2. Or redeploy the previous Docker image tag/commit SHA.
3. Verify `/health` returns 200.
4. If needed, restore `NVIDIA_API_KEY` from secure vault (do not hardcode).

### Client (Chrome/Edge Extension)

1. Reload the previous version from `chrome://extensions/` → click "Reload" on the previous extension.
2. Or upload the previous `.zip` via the store dashboard.
3. Verify the extension popup opens and the disclaimer text matches.

---

## 5. Local Development Quick-Check

```bash
# 1. Backend
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set NVIDIA_API_KEY=<your-key>
set PORT=8000
set ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
uvicorn app.main:app --host 0.0.0.0 --port 8000
# Test: curl http://localhost:8000/health  => {"status":"ok"}

# 2. Client
cd client
npm install   # or npm ci
npm run build # produces client/dist/
# Load: chrome://extensions → Load unpacked → select client/dist/
```

---

## 6. Skills Saved

- `.opencode/skills/deploy-render.md` — Render-specific deployment pattern (if targeting Render in the future)
- `.opencode/skills/deploy-github-actions.md` — GitHub Actions CI/CD pattern (used for the workflow below)
- Note: Pre-deploy checklist has 8 items (not 11). CI artifact uploads `test-results/` (raw results), named "playwright-report" artifact.