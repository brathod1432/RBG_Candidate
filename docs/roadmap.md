# Roadmap

| Version | Target | Theme | Key Deliverables |
|---------|--------|-------|------------------|
| **v1.0** | Shipped | Core autofill + Nvidia API | MV3 extension (Chrome/Edge), FastAPI `/analyze` proxy, FieldMap for LinkedIn/Indeed/Generic, WebCrypto encryption (PBKDF2 + AES-GCM), preview modal, manual confirm, BYOK + operator fallback, pytest + vitest + Playwright E2E, Railway/Fly.io deploy |
| **v1.1** | Shipped 2026-09 | Worker pool + skill ranking + first defaults | Coordinator + 15 independent AI workers (fast + quality models, retry/timeout/circuit-breaker), skill ranking against the job, radio/checkbox + typeahead pickers, work-model/notice/gender/new-applicant defaults, AI consent switch, server URL setting, answer memory |
| **v1.2** | Shipped 2026-09-27 | Common-question defaults + privacy infra | Work-auth (Yes, open work permit assumed) + relocation (Poland-aware) + salary (conversational, number inputs skipped) + availability (next 1st/15th) defaults, CEFR language ladder, hybrid hard default, DPAPI-encrypted history vault (%APPDATA%, 60-day TTL), profile-completeness score, fill summary banner, adaptive typing agents (1-5 by form size), .MD template DEFAULT comments |
| **v1.3** | Q1 2027 | Multi-browser + better detection | Firefox MV3 build (webextension-polyfill), improved FieldMap heuristics (ARIA, data attributes, shadow DOM), smart stage detection for unknown sites, keyboard shortcut for analyze, undo fill (Ctrl+Z), accessibility audit (WCAG 2.1 AA) |
| **v1.4** | Q2 2027 | Team sharing + analytics opt-in | Encrypted team vault (share FieldMaps via invite link, AES-GCM key rotation), optional anonymous usage analytics (local differential privacy, opt-in only), admin dashboard for team keys, SAML/OIDC for enterprise, Chrome Web Store + Firefox Add-ons + Edge Add-ons publishing |

---

## Version Details

### v1.0 — Core Autofill + Nvidia API (Current)
**Status**: Implementation complete, deployment pending (task-18)

- Extension: Manifest V3, React 18 popup, service worker background, content scripts with FieldMap + multi-stage detection
- Backend: FastAPI async, stateless `/analyze`, Pydantic v2, CORS locked to extension origin, in-memory rate limit
- Crypto: WebCrypto PBKDF2 (100k iterations) → AES-GCM, keys in `storage.local` (ciphertext) + `storage.session` (derived key cache)
- AI: Nvidia Integrate API, BYOK default, operator fallback, no server-side key storage
- Safety: Preview modal shows every field mapping, explicit confirm per fill, no auto-submit
- Tests: pytest (server), vitest (client), Playwright (E2E with 3 HTML fixtures)
- Deploy: Dockerfile, Railway/Fly.io, GitHub Actions CI, Chrome Web Store package

### v1.1 — Worker Pool + Skill Ranking + First Defaults (Shipped 2026-09)
**Status**: Implementation complete, all tests green

- Coordinator (`server/agents/coordinator.py`) + 15 independent workers: per-worker inbox, HTTP client, fast + quality models, retry on another worker/model, 429 back-off, circuit breaker
- Skills ranked against the job description; count/length-limited fields get the most relevant whole skills
- Radio/checkbox descriptors (choice mapping) and typeahead pickers (the matching option is clicked after typing)
- First deterministic defaults: work-model yes/no, notice period (Immediate → 2 weeks), gender, new-applicant, location & work-mode preference
- AI consent switch, saved server URL + `optional_host_permissions`, answer memory (cache by label/profile/job)

### v1.2 — Common-Question Defaults + Privacy Infra (Shipped 2026-09-27)
**Status**: Implementation complete, all tests green (pytest 171/171 · vitest 117/117)

- Work-authorization default: Yes (open work permit assumed); status questions get the full sentence; the profile always wins
- Relocation: Yes when the destination is the user's city or anywhere in Poland, No outside; plain question → Yes
- Salary: one-sentence conversational default for string fields; number-only inputs skipped; the profile figure wins
- Availability: the next 1st or 15th of the month (YYYY-MM-DD, local date); selects pick "Immediate" first
- Language ladder: CEFR levels match named options (C2 → "Native" first); English C2 default with no profile languages
- Sponsorship regex fix ("requires"/"sponsors" now match); hybrid hard default with no profile
- DPAPI-encrypted history vault (`%APPDATA%\RBG_Candidate\history`, monthly shards, 60-day TTL, non-blocking writes)
- Profile-completeness score in Settings; fill summary banner after an instant fill; adaptive typing agents (1-5 by form size, 5 the hard max); .MD template DEFAULT comments

### v1.3 — Multi-Browser + Better Field Detection
**Target**: Q1 2027

| Area | Work |
|------|------|
| Firefox | `webextension-polyfill` for `browser.*` API parity, separate `manifest.firefox.json`, GitHub Actions matrix build |
| Field detection | Heuristic scorer: `label[for]` + `aria-label` + `placeholder` + `data-testid` + common class patterns; shadow DOM traversal; fallback to Generic FieldMap |
| Stage detection | DOM mutation observer + URL hash/path patterns for unknown sites; confidence scoring |
| UX | `Cmd/Ctrl+Shift+A` shortcut to trigger analyze from content script; toast "Fill applied" with 3s undo; keyboard-navigable preview modal |
| Accessibility | Semantic HTML in popup/modal, ARIA live regions for toasts, focus trap in modal, color contrast ≥ 4.5:1 |

### v1.4 — Team Sharing + Analytics Opt-In
**Target**: Q2 2027

| Area | Work |
|------|------|
| Team vault | Invite link → recipient enters passphrase → derives shared key → encrypts FieldMap + site configs → stores in `storage.sync` (encrypted); key rotation on member remove |
| Analytics | Opt-in toggle in settings; local differential privacy (ε=1.0) on event counts (analyze invoked, fill confirmed, site domain); batch send weekly via `navigator.sendBeacon` to `/telemetry` (new endpoint, no PII) |
| Admin dashboard | React app (separate repo) for team owners: view members, revoke access, rotate keys, audit log |
| Enterprise auth | SAML/OIDC via FastAPI `authlib`; SCIM provisioning; SSO login for extension popup |
| Publishing | Chrome Web Store (verified), Firefox Add-ons (AMO), Edge Add-ons; automated release via GitHub Actions on tag |

---

## Non-Goals (Explicit)

- **Auto-submit applications** — violates safety rule, never planned
- **Server-side PII storage** — stateless by design, no DB
- **Cloud sync of PII** — `storage.sync` only for encrypted team configs, never plaintext
- **Mobile browsers** — MV3 extension API not available
- **Other AI providers** — Nvidia Integrate API only; abstraction layer exists but no multi-provider UI

---

## Release Cadence

- **Patch** (v1.0.x) — bug fixes, selector updates for existing sites, dependency updates
- **Minor** (v1.3, v1.4) — new features per roadmap, ~quarterly
- **Major** (v2.0) — breaking changes (e.g., Manifest V4, new crypto scheme)

All releases tagged `vX.Y.Z` on `main` branch; GitHub Actions builds + signs extension zip + publishes to stores.