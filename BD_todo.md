# BD_todo

## Backlog
- [ ] VENV INSTALL (user action required): run scripts\setup-venv.bat — installs server\requirements-dev.txt into .venv only — added 2026-09-24
- [x] task-1: Project infra (gitignore, env example, license, READMEs) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-2: Architecture + API contract doc — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-3: Competitor + Nvidia API landscape (docs/research.md) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-4: Server scaffold (FastAPI + /health + config) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-5: Server schemas + error envelope — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-6: Nvidia proxy client + POST /analyze + guards — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-7: Server tests cycle 1 — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-8: Extension scaffold (manifest v3 + build) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-9: Types + storage + crypto utils — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-10: Content script (form + stage detection) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-11: Popup UI (Settings + Fill + Review) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-12: Background SW (routing + server calls) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-13: Client tests (vitest) — added by rgbf51-20260924-001 on 2026-09-24
- [x] task-14: Security + privacy audit — done (task-set-1.1)
- [x] task-15: Rust WASM decision record (deferred, no code) — done (task-set-2.1)
- [x] task-16: Local test harness (fixtures + QA checklist) — done (task-set-1.2)
- [x] task-17: Playwright E2E suite — done (task-set-2.2)
- [x] task-18: Deployment plan (store + backend + CI) — done (task-set-3.1)
- [x] task-19: Final polish (README, contributing, roadmap) — done (task-set-4.1)

## Done (planning phase)
- [x] Familiarisation: read idea.md (249 lines) — 2026-09-24
- [x] Scaffold: BD_* + .opencode/* + client/server/security/docs/tests folders — 2026-09-24
- [x] ToT-1 stateless proxy + ToT-2 WebCrypto-only — 2026-09-24
- [x] docs/architecture.md + docs/e2e-plan.md + .gitignore — 2026-09-24

## Done (implementation phase — this session)
- [x] task-set-1: Security audit (9 PASS) + 3 fixtures + QA checklist (88 cases) — 2026-09-24
- [x] task-set-2: WASM decision (CryptoSeam, 2 triggers) + Playwright E2E (7 tests) — 2026-09-24
- [x] task-set-3: Deployment plan + CI workflow — 2026-09-24
- [x] task-set-4: Final polish (README, CONTRIBUTING, roadmap) — 2026-09-24

## Grounded Reviews
- [x] task-18 (deployment) — VERIFY_FLAGGED → files verified correct
- [x] task-19 (polish) — PROCEED (LOW risk, all ANCHORED)

## Next Steps (User Action Required)
- [ ] Run `scripts\setup-venv.bat` to complete venv install
- [ ] Run server pytest: `".venv\Scripts\python.exe" -m pytest tests/ -v`
- [ ] Run client tests: `cd client && npm ci && npx tsc --noEmit && npx vitest run`
- [ ] Run E2E: `cd e2e && npx playwright test`
- [ ] Initialize git repo if desired for checkpoints

## Coordinator + worker pool pass (2026-09-24, Claude)
- [x] Fix FILL routing (was broken) + wire AI suggestions via POST /fill
- [x] Coordinator + 15 independent AI workers, shared RPM limiter, retries, model discovery
- [x] Offline fake NVIDIA server + real-Chromium E2E (2/2)
- [ ] USER: run `.venv\Scripts\python.exe -m pip install -r server\requirements-dev.txt` then `.venv\Scripts\python.exe scripts\nvidia_smoke_test.py` (live key check)
- [ ] USER: `cd client && npm run build`, reload the unpacked extension
- [ ] Next: see docs/improvements.md (P0: radio/checkbox/combobox, iframes, AI-consent toggle, drop <all_urls>)
