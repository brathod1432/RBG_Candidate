# RBG Candidate

Chrome/Edge MV3 extension that auto-fills job applications via Nvidia AI through a stateless FastAPI proxy. Privacy-first (on-device encrypted storage, transient server processing, manual review before any fill) for job seekers who want speed without losing control.

## Key Features

- **AI-powered autofill** — a coordinator splits each form across a pool of 15 parallel AI workers (NVIDIA Integrate API, fast + quality models)
- **Privacy by design** — Local-only encrypted storage (WebCrypto PBKDF2 + AES-GCM), transient API calls, no tracking
- **Manual review** — Preview modal shows every field before filling; no auto-submit
- **Multi-stage forms** — Detects and handles multi-step application flows
- **Bring your own key** — Nvidia API key never leaves your device; operator fallback available

---

## Install

### Backend (FastAPI)

Run from the **project root** (the server is a package with relative imports):

```bat
scripts\setup-venv.bat
.venv\Scripts\python.exe -m uvicorn server.main:app --reload --port 8000
```

The server loads `.env` from the project root. Health check: `GET /health` → `{"status": "ok"}`.
Pool status: `GET /workers` (15 workers, their models and counters).

### Extension (MV3)

1. Build the client:
   ```bash
   cd client
   npm install
   npm run build
   ```
   Outputs to `client/dist/` (gitignored).

2. Open Chrome/Edge → `chrome://extensions` → **Developer mode** → **Load unpacked** → select `client/dist`.

---

## Development

```bat
:: Terminal 1: Backend (project root)
.venv\Scripts\python.exe -m uvicorn server.main:app --reload --port 8000

# Terminal 2: Frontend (hot reload)
cd client
npm run dev
```

Extension loads from `client/dist`; rebuild with `npm run build` after changes.

---

## Test

| Layer | Command | Framework |
|-------|---------|-----------|
| Server unit/integration (incl. worker pool) | `.venv\Scripts\python.exe -m pytest tests -q` | pytest + respx |
| Client unit | `cd client && npx tsc --noEmit && npx vitest run` | vitest |
| **Live NVIDIA check** (uses `.env` key) | `.venv\Scripts\python.exe scripts\nvidia_smoke_test.py` | — |
| E2E: real Chromium + extension + pool | see header of `e2e/ai-pool.spec.ts` | Playwright |

For an offline demo/E2E, run `scripts/fake_nvidia_server.py` and set
`NVIDIA_BASE_URL=http://127.0.0.1:9100/v1` before starting the server.

---

## AI coordinator + worker pool

```
POST /fill {fields[], profile, job}
      │
      ▼
 Coordinator ── 1. plan: profile matches (name/email/phone/title…) answered locally, no LLM call
      │         2. classify the rest: short | choice (select) | long (cover letter, "why us")
      │         3. assign each task to the least-loaded healthy worker (untried model preferred)
      │         4. watch: per-task timeout, retry on another worker/model, 429 back-off
      │         5. verify: option must exist, numbers numeric, max_length, never invent facts
      ▼
 Worker 1 … Worker 15   (each: own inbox, own HTTP client, fast model + quality model,
                         own stats + circuit breaker; a missing model is disabled pool-wide)
      │
      ▼   shared rate limiter (NVIDIA_MAX_RPM)
 NVIDIA Integrate API
```

All settings (worker count, model lists, RPM budget, retries) live in `.env` — see `.env.example`.

## Profile from a Markdown CV

Popup → **Profile** → *Download template* gives you `rbg-candidate-profile.md`
(also in `docs/profile-template.md`). Fill it in — personal details, links, work authorization,
every job with **start/end dates** (YYYY-MM or "Mar 2021", `present` for the current one),
education, skills by category, languages, certifications, projects and ready-made answers —
then drop it on *Import profile from Markdown*.

- The popup profile is filled from it and saved on this device; *Export my profile* writes it back
  out, so the workflow is edit the .md → re-import.
- Total experience is computed from the job dates (overlaps merged).
- Obvious fields (first/middle/last name, email, phone, city, LinkedIn, GitHub, website, postal
  code, notice period, years of experience, salary) are filled straight from it with no AI call;
  everything else goes to the AI workers together with a compact text version of the CV.
- Unknown keys and extra `##` sections are kept as answers, HTML comments are ignored.
- **Skills under limits.** List your most important skills first. Skill fields ("Key skills",
  "Skill 1..N", a "Primary technology" drop-down) are filled with your skills ranked against the
  job description. Whole skills only, within the field's maxlength or "top N". Ties keep your order.
- **Messages stay short.** Recruiter / hiring-manager messages are 3-5 plain sentences about this
  job. Add a `## Not in my experience` section and the AI will never claim what is listed there.
- **Notice period default.** "Notice period" drop-downs pick "Immediate" (or "2 weeks" when there is no Immediate option); text fields get "Immediately" — unless your profile has a notice period, which always wins.
- **Gender default.** A gender field on a form is filled from your profile's Gender when set; otherwise the AI infers the most likely answer from your name. Add it to the template ("Gender:") to set it yourself.
- **Language levels.** English is the default. If your profile gives one level for a language (e.g. English: fluent), every English level field on a form (written, spoken, reading) is filled with that same level — no AI call.
- **New applicant default.** "Are you currently working at X?" is answered "No" — you are applying to a new company — unless X matches one of the companies in your experience, which answers "Yes". No AI call.
- **Location & work-mode preference.** Questions about preferred location / way of working are answered from your profile: your Location and Work mode combined (e.g. "Warsaw, Poland. Hybrid (2-3 days from the office).") — no AI call.
- **Strengths stay recent.** "Biggest strength" questions get a friendly, few-sentence reply backed by your recent experience and the skills that match the role.
- **Work model.** "Would you be able to work in a hybrid work model?" answers "Yes" (unless your Work mode explicitly says otherwise, e.g. "on-site only").
- **Office frequency.** "How often would you be able to work from the office?" answers from your Work mode's detail ("hybrid (2-3 days from the office)" → "2-3 days from the office") — matched against the drop-down when there is one.
- **Work permit / visa.** "Would you require a work permit to work in X?" answers "No" by default — set "Requires visa sponsorship" in your profile if you do need support.
- **Typeahead pickers.** For fields where you type and a list appears (skills, company name, university), the typing agents click the matching option from that list after typing — typing alone is not a selection. Works for any pickable field.
- **Work authorization default.** "Are you authorized to work in X?" / "Do you have the right to work in X?" answers "Yes" by default (an open work permit is assumed) — set "Work authorization" in your profile to override. An open status question ("What is your work authorization status?") gets a full sentence: authorized to work with an open work permit, no sponsorship required.
- **Relocation default.** "Are you willing to relocate to [city]?" answers "Yes" when the city is your own or anywhere in Poland, and "No" when it is outside Poland. A plain "willing to relocate?" answers "Yes". Open text fields keep your profile's own relocation line.
- **Salary expectation default.** Text fields get a one-sentence reply — you'd prefer to discuss a reasonable range after learning the role and responsibilities during the interview. Number-only inputs (type="number" or "numbers only") are skipped rather than guessed. Your profile's Desired salary always wins when set.
- **Availability default.** "Available from" / "When can you start?" gets the next 1st or 15th of the month (YYYY-MM-DD): before the 15th → the 15th of this month; from the 15th → the 1st of next month. Selects pick an "Immediate"-style option first.
- **English level default.** With no profile language, English level fields default to C2 — matched to the form's options via a CEFR ladder ("Native" first, then C2/full-professional, then fluent), so A2 finds "Limited working proficiency", not "Basic".
- **Profile completeness.** The Settings tab shows the share of critical profile fields filled (name, contact, work auth, visa, relocation, work mode, notice, availability, salary) with the missing list — click it to fill them in yourself. Defaults cover the gaps at fill time.
- **Fill summary banner.** After an instant fill, a small banner in the page lists what was filled and points to the Review tab where defaults (applied where your profile was empty) can be changed before submitting.
- **Encrypted history vault.** Every answered field is appended to `%APPDATA%\RBG_Candidate\history` (DPAPI-encrypted, monthly shards, 60-day TTL) — your own encrypted record of what was filled where. Nothing is stored on the server.
- **Adaptive typing agents.** The typing agents scale with the form: 1-2 fields → 1 cursor, 3-5 → 2, 6-15 → 3, 16-30 → 4, longer → 5. An explicit agent count in the popup always wins; 5 is the hard max.
- Anything the defaults can't answer still goes to the AI workers: it picks the best option from a drop-down, or writes the answer for text fields.
- Personal profiles go in `profiles/` (gitignored).

## Typing agents (on the page)

After you confirm values in Review, a crew of named, coloured cursors types them into the page:
**Nova** (violet), **Echo** (cyan), **Blaze** (orange), **Sage** (green), **Ruby** (red), **Atlas** (amber).
The crew size adapts to the form: 1-2 fields → 1 cursor, 3-5 → 2, 6-15 → 3, 16-30 → 4, longer → 5.
Your explicit count in Settings → *Typing agents* wins when you change it; 5 is the hard max (speed, on/off also there).

- Each agent independently pulls the next field from a shared queue, glides to it, clicks, and types
  letter by letter (long answers type several characters per tick, capped at a few seconds per field).
- The cursor label shows the source: `typing · worker 7 · llama-3.3-70b-instruct` or `profile`.
- A panel (top-right) shows fields left and each agent's count. **Esc** finishes instantly.
- Native value setter + `input` events per keystroke, so React/Vue forms register every character.
- Nothing is submitted. `prefers-reduced-motion` fills instantly without the overlay.


---

## Privacy

- **Local-only storage** — Everything stays in `chrome.storage.local` on this device. An NVIDIA key you save in the extension is optional (the server's `.env` key is used otherwise). It is encrypted with AES-GCM using a random, non-extractable device key the extension keeps in its own IndexedDB, with no passphrase. That keeps it out of the storage files as plain text, but anyone in full control of your Windows account could still recover it. Profile fields are stored unencrypted.
- **Transient API calls** — Server is stateless: no database, no PII logs, in-memory rate limiting only. Request/response payloads discarded after processing.
- **History vault** — Filled values are appended to `%APPDATA%\RBG_Candidate\history` as DPAPI-encrypted monthly shards (60-day TTL), on this device only. The server stores nothing; shards are never sent anywhere.
- **What leaves the device** — for fields the profile can't answer directly, the field label/options, your profile text and the job title/description are sent to NVIDIA to draft an answer. Fields answered from the profile never reach a model.
- **No tracking** — No analytics, telemetry, or third-party scripts. Network calls only to your FastAPI instance and `integrate.api.nvidia.com`.
- **No auto-submit** — Every fill requires explicit confirmation in the preview modal.

---

## Disclaimer

> **RBG Candidate automates form filling but does not provide legal advice. Ensure compliance with job site terms.**

## Version control

The repo is Git-ready: `.gitignore` excludes `profiles/` (personal candidate data), `.env` and
secrets, `.opencode/` (agent memory), `client/dist`, virtualenvs, `node_modules` and test artefacts.
Git itself is not installed on this machine yet — after installing it, run from the project root:

```bat
git init
git add -A
git commit -m "Initial commit"
```

---

## Architecture Summary

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  MV3 Ext    │────▶│ Background SW │────▶│  FastAPI         │────▶│ Nvidia API   │
│  popup +    │     │  profile +    │     │  POST /fill      │     │ (integrate.  │
│  content    │     │  BYOK decrypt │     │  coordinator +   │     │  api.nvidia. │
│  (scan/fill)│     │  fill routing │     │  15 AI workers   │     │  com)        │
└─────────────┘     └──────────────┘     └──────────────────┘     └──────────────┘
```

- **Extension** — Manifest V3, React popup, service worker background, content scripts with FieldMap + stage detection
- **FastAPI** — Stateless proxy, Pydantic v2 schemas, CORS locked to extension origin, structured error envelopes
- **Nvidia API** — BYOK default (user provides key), operator-key fallback; keys never stored server-side

---

## Project Structure

```
RBG_Candidate/
├── client/          # MV3 extension (React + TS + Vite)
│   ├── src/         # popup, background, content scripts
│   └── dist/        # built extension (load unpacked here)
├── server/          # FastAPI backend
│   ├── main.py      # app entry + /health
│   ├── routers/     # /analyze endpoint
│   └── schemas/     # Pydantic models
├── e2e/             # Playwright E2E tests
├── tests/           # Server pytest suite
├── docs/            # Architecture, deployment, security, roadmap
└── security/        # Audit artifacts, WASM decision record
```

---

## License

MIT — see [LICENSE](LICENSE).