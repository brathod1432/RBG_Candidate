# BD_README — RBG Candidate
> Maintained by rbg-fable-5.1 · Last updated: 2026-09-30 by task rgbf51-20260930-001 (familiarization + 70-item improvement list, read-only)

## Project Overview
Chrome/Edge MV3 extension that auto-fills job applications via Nvidia AI through a stateless FastAPI proxy. Privacy-first (on-device encrypted storage, transient server processing, manual review before any fill) for job seekers who want speed without losing control.

## Current Status
**Phase:** v1.2  **Last task:** rgbf51-20260930-001 — full-codebase review, no code changed  **Health:** 🟡

> **Verified baseline 2026-09-30:** pytest 171/171 · vitest 117/117 (12 files) · `tsc --noEmit` clean · `client/dist` present.
> Note: `RBG_README.md` / `RBG_todo.md` / `RBG_changelog.md` are a **second, divergent memory set** (see F17 in the improvement list).

## Tech Stack
| Layer | Technology | Version |
|---|---|---|
| Extension | TypeScript + React + Zustand | TS 5.x |
| Ext build | Vite (chosen for fast HMR, small bundle) | 5.x |
| Backend | Python FastAPI (async) + httpx + Pydantic v2 | 3.11+ |
| Crypto | WebCrypto PBKDF2 + AES-GCM, chrome.storage local+session | platform-native, zero new deps |
| Tests | pytest + respx, vitest + jsdom, Playwright | — |
| Hosting | Railway or Fly.io (single instance) + Chrome Web Store | HTTPS required |
| AI | Nvidia Integrate API (BYOK default, operator-key fallback) | verified |

## Architecture Summary
Popup ↔ Background SW ↔ Content script (FieldMap + stage detection) ↔ FastAPI `POST /analyze` (stateless, no DB, in-memory rate limit, no-PII logs) → Nvidia API. PII plaintext in `storage.local`; API key ciphertext-only (key derived from passphrase, cached in `storage.session` once per session). No auto-submit, no tracking. See `docs/architecture.md` + `docs/e2e-plan.md`.

## Key Decisions
| Decision | Chosen | Rationale | Task |
|---|---|---|---|
| Backend state | ~~Stateless proxy, no DB~~ → **SQLite in WAL mode** | **SUPERSEDED 2026-09-30**: history, undo, cross-restart answer memory and an audit trail cannot be delivered statelessly. Local-first, stdlib `sqlite3` (Rule 9), every table user-scoped, schema portable to Postgres. The original "zero breach surface" rationale still holds for the single-user-local posture. | ToT-1 SYNTHESIS 91 → rgbf51-20260930-002 |
| Encryption | WebCrypto-only, no Rust WASM | WASM = CSP regression + zero threat-model gain + review cost | ToT-2 SYNTHESIS 88 |
| Key model | BYOK default + operator fallback; keys never logged/stored server-side | Zero server trust, abuse protection via rate limit | ToT-1 |
| Fill safety | Manual confirm, preview modal, no auto-submit | Store review + user control | Rule 7 |
| Build | Vite (fast HMR, small bundle) | Chosen in task-8 | task-8 |

## What Has Been Built
| Feature | Status | Task | Notes |
|---|---|---|---|
| **Form-filling roadmap → `docs/form-filling-100.md`** | ✅ Done | rgbf51-20260930-002 | **100 items**, form-filling scope only (CV/cover-letter dropped). Detection 11 · options 10 · MCQ 8 · widgets 8 · frames/wizards 6 · execution+verification 10 · UX 12 · latency 10 · security 9 · **DB/history/WAL 10** · ops 6 |
| Full codebase review → `docs/improvements-v2.md` | ✅ Done | rgbf51-20260930-001 | **93 findings** across trust (10) / security (11) / accuracy (15) / latency (18) / UX (21) / test+CI (18) |
| Folders + scaffold (BD_*, .opencode, client/server/security/docs/tests) | ✅ Done | rgbf51-20260924-001 | — |
| docs/architecture.md | ✅ Done | planning | D1–D4 + API contract + storage map |
| Server /health + /fill + coordinator + 15-worker pool | ✅ Done | task-4–6 | 171 pytest green |
| Extension (manifest→popup→SW→content) | ✅ Done | task-8–12 | 117 vitest green, tsc clean |
| Security audit + WASM record | ⚠️ Stale | task-14–15 | Describes a `storage.session` key model that no longer exists — re-run (A9) |
| Deployment plan + CI | ❌ Broken | task-18 | CI server job tests nothing; e2e job cannot start its server and hides failures (F1–F7) |

## Known Issues
- **CI cannot fail.** `.github/workflows/ci.yml` has 6 independent breakages: pytest runs from `server/` (no tests there), `uvicorn app.main:app` doesn't exist, e2e runs from `client/` not `e2e/`, branch is `main` but repo is `master`, `--headed` on a headless runner, and `|| true` swallows failures. → F1–F7
- **Zero unit tests for the safety-critical DOM code**: `content/fill.ts`, `content/agents.ts`, `content/typeahead.ts` have no test files. → F10
- **Two implementations of the same rules** (server `tasks.py` + client `router.ts:569-892`) have already diverged (Polish city lists differ). → C1
- **Gender is inferred from the candidate's name by the model** (`tasks.py:673-679`); work-authorisation and English level are asserted rather than asked. → A2/A3/A5
- **Defaulted values are badged "profile"** in the UI — the user cannot tell a hard-coded default from their own data. → A1
- **Closing the popup destroys the session** (scan, suggestions, selections) — all in-memory Zustand. → U1
- **The fill banner blocks page clicks for 12 s** (no `pointer-events: none` on the host). → B11
- **Saved remote server URLs can never work** — `chrome.permissions.request` is never called, so `fetch` throws and is misreported as "local server not running". → B6/B7
- **The documented "server stores nothing" privacy claim is false** — `fill.py:55` writes every answer to `%APPDATA%`. → A8
- Shell PATH is broken on this machine (`git`, `findstr`, `powershell.exe` all missing) — use 8.3 paths and the venv python directly. See `.opencode/skills/env-shell-quirks.md`
- `handoff.json` + 3 `_backup_*` trees are stale duplicates of the source; gitignored but on disk. → F13

## Active Todo (Top 5)
> Ordered against `docs/form-filling-100.md` (100 form-filling items, incl. the SQLite/WAL design).
- [ ] **F1/F9/F10** — read back and verify every write; report filled/unchanged/rejected/failed per field
- [ ] **A2+E1, A3, B2/B3, C1–C3** — frames, ARIA widgets, checkbox groups, MCQ cardinality (the coverage that decides real-ATS support)
- [ ] **J1–J4, K1–K2** — SQLite in WAL mode, schema, append-only `events` log, `request_id` idempotency
- [ ] **G1, G6, G7, G10** — persist the popup session; show provenance and which rule fired; live progress and partials
- [ ] **H1, H2, H5** — profile digest once per request; field-relevant slice; server deadline < client timeout
- [ ] **A1** — add `source: "default"` and a distinct "assumed" badge (smallest fix, biggest trust win)
- [ ] **A2** — delete `_GENDER_RULE` (name-based gender inference)
- [ ] **B11 + U1** — `pointer-events: none` on the banner; persist popup session to `storage.session`
- [ ] **D1 + D5** — build the profile digest once per request; enforce a server deadline < the 120 s client timeout
- [ ] **F1–F7** — repair `.github/workflows/ci.yml` so a red build is possible

## Sub-agents Used
- rbg-fable-5.1 (this task, read-only analysis) · tot_controller ×2 (historical) · code_generation ×12 (historical) · deployment ×1 (historical)

## Skills Saved
- `.opencode/skills/env-shell-quirks.md` — broken-shell workarounds (8.3 paths, venv python, write-tool JSON helper)

## Rules Highlights
Python 3.11+ typed; no hardcoded secrets (os.getenv); no bare except; logging not print; never commit .opencode/; no auto-submit; Nvidia key never client-hardcoded; LessWorks smallest-safe-change. Full: .opencode/rules/rules.md
