# Roadmap

| Version | Target | Theme | Key Deliverables |
|---------|--------|-------|------------------|
| **v1.0** | Current | Core autofill + Nvidia API | MV3 extension (Chrome/Edge), FastAPI `/analyze` proxy, FieldMap for LinkedIn/Indeed/Generic, WebCrypto encryption (PBKDF2 + AES-GCM), preview modal, manual confirm, BYOK + operator fallback, pytest + vitest + Playwright E2E, Railway/Fly.io deploy |
| **v1.1** | Q1 2027 | Multi-browser + better detection | Firefox MV3 build (webextension-polyfill), improved FieldMap heuristics (ARIA, data attributes, shadow DOM), smart stage detection for unknown sites, keyboard shortcut for analyze, undo fill (Ctrl+Z), accessibility audit (WCAG 2.1 AA) |
| **v1.2** | Q2 2027 | Team sharing + analytics opt-in | Encrypted team vault (share FieldMaps via invite link, AES-GCM key rotation), optional anonymous usage analytics (local differential privacy, opt-in only), admin dashboard for team keys, SAML/OIDC for enterprise, Chrome Web Store + Firefox Add-ons + Edge Add-ons publishing |

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

### v1.1 — Multi-Browser + Better Field Detection
**Target**: Q1 2027

| Area | Work |
|------|------|
| Firefox | `webextension-polyfill` for `browser.*` API parity, separate `manifest.firefox.json`, GitHub Actions matrix build |
| Field detection | Heuristic scorer: `label[for]` + `aria-label` + `placeholder` + `data-testid` + common class patterns; shadow DOM traversal; fallback to Generic FieldMap |
| Stage detection | DOM mutation observer + URL hash/path patterns for unknown sites; confidence scoring |
| UX | `Cmd/Ctrl+Shift+A` shortcut to trigger analyze from content script; toast "Fill applied" with 3s undo; keyboard-navigable preview modal |
| Accessibility | Semantic HTML in popup/modal, ARIA live regions for toasts, focus trap in modal, color contrast ≥ 4.5:1 |

### v1.2 — Team Sharing + Analytics Opt-In
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
- **Minor** (v1.1, v1.2) — new features per roadmap, ~quarterly
- **Major** (v2.0) — breaking changes (e.g., Manifest V4, new crypto scheme)

All releases tagged `vX.Y.Z` on `main` branch; GitHub Actions builds + signs extension zip + publishes to stores.