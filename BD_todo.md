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

## Improvement list v2 (2026-09-30) — 93 findings, full report in `docs/improvements-v2.md`
- [ ] **A1** Add `source: "default"` + distinct "assumed" badge — defaults are currently badged "profile" — added by rgbf51-20260930-001
- [ ] **A2** Delete `_GENDER_RULE` — the model infers gender from the candidate's name — added by rgbf51-20260930-001
- [ ] **A3** Remove the hard work-authorisation default (asserts legal status) — added by rgbf51-20260930-001
- [ ] **A4** Profile `willing_to_relocate` must win over the hard-coded Polish city list — added by rgbf51-20260930-001
- [ ] **A5/A6** English C2 + next-1st/15th availability are asserted, not asked — added by rgbf51-20260930-001
- [ ] **A7** Drop the model self-reported confidence bar; badge by provenance — added by rgbf51-20260930-001
- [ ] **A8** Vault contradicts the "server stores nothing" privacy claim — gate it or fix the docs — added by rgbf51-20260930-001
- [ ] **A9/A10** Re-run the stale security audit; add per-user quota on the shared key — added by rgbf51-20260930-001
- [ ] **B1** Default `FILL_REQUIRE_BYOK=1`; `/fill` and `/analyze` are unauthenticated — added by rgbf51-20260930-001
- [ ] **B2** `/workers` + `/health` are unauthenticated and unrated — added by rgbf51-20260930-001
- [ ] **B3** `_request_log` in guards.py grows without bound — added by rgbf51-20260930-001
- [ ] **B4** Send the API key in the header, not the JSON body — added by rgbf51-20260930-001
- [ ] **B5** Profile is stored plaintext while docs say "encrypted" — added by rgbf51-20260930-001
- [ ] **B6/B7** `chrome.permissions.request` never called → remote server URLs cannot work — added by rgbf51-20260930-001
- [ ] **B8/B9/B10** Distinct failure messages; empty prod CORS defaults; move `.env` out of the repo — added by rgbf51-20260930-001
- [ ] **B11** Fill banner has no `pointer-events: none` → blocks page clicks for 12 s — added by rgbf51-20260930-001
- [ ] **C1/C2** Delete the duplicated client rule engine in `router.ts:569-892` (already diverged) — added by rgbf51-20260930-001
- [ ] **C3** Support `input[type=date]` — date fields are currently invisible — added by rgbf51-20260930-001
- [ ] **C4** File inputs (CV upload) unsupported — added by rgbf51-20260930-001
- [ ] **C5** Multi-checkbox groups get every box ticked — added by rgbf51-20260930-001
- [ ] **C6** Re-resolve selectors at fill time; re-scan on DOM mutation — added by rgbf51-20260930-001
- [ ] **C7** Tell the user when fields are silently capped at 100 — added by rgbf51-20260930-001
- [ ] **C8** `all_frames: true` + shadow-root traversal (Greenhouse/Lever/Workday) — added by rgbf51-20260930-001
- [ ] **C9** Read schema.org JobPosting JSON-LD before `<h1>` for the job title — added by rgbf51-20260930-001
- [ ] **C10** Retry re-sends the identical prompt — use a repair prompt with the validation error — added by rgbf51-20260930-001
- [ ] **C11/C12/C13** Best-match option scoring; surface per-field errors; escape `name` in the radio selector — added by rgbf51-20260930-001
- [ ] **C14/C15** Warn on unresolved required fields; report which fields were skipped — added by rgbf51-20260930-001
- [ ] **D1** Build the profile digest ONCE per request (currently re-sent per AI field) — added by rgbf51-20260930-001
- [ ] **D2** Hoist the per-field `profile.model_dump_json()` cache key — added by rgbf51-20260930-001
- [ ] **D3** Share one `httpx.AsyncClient` across the 15 workers (15 TLS handshakes today) — added by rgbf51-20260930-001
- [ ] **D4** Rate limiter sleeps while holding its lock — added by rgbf51-20260930-001
- [ ] **D5** Server worst case 180 s vs client timeout 120 s — add a server deadline + partial answers — added by rgbf51-20260930-001
- [ ] **D6** No partial results / no streaming — added by rgbf51-20260930-001
- [ ] **D7** No in-request dedup — identical questions each call the model — added by rgbf51-20260930-001
- [ ] **D8** `_answer_cache` unbounded and process-local — added by rgbf51-20260930-001
- [ ] **D9/D10** Dispatch long tasks first; add jitter to the 429 backoff — added by rgbf51-20260930-001
- [ ] **D11/D12** Model discovery keyed to the wrong key; global limiter starves other users — added by rgbf51-20260930-001
- [ ] **D13** Health re-runs `ensure_started` every 2 s poll — added by rgbf51-20260930-001
- [ ] **D14/D15/D16/D17/D18** Body-size guard; single vault writer thread; structured logs; graceful drain; prefix caching — added by rgbf51-20260930-001
- [ ] **U1** Persist popup session to `chrome.storage.session` — closing the popup loses everything — added by rgbf51-20260930-001
- [ ] **U2** Write confirmed edits back into `profile.answers` (edited-answer memory) — added by rgbf51-20260930-001
- [ ] **U3/U4** Summary banner never shows on the animated (default) path; move it into a shadow root — added by rgbf51-20260930-001
- [ ] **U5/U6/U7** Report skipped fields; don't silently overwrite; add undo via the existing vault — added by rgbf51-20260930-001
- [ ] **U8/U9** Review list: search, select-all, keyboard nav; fix `aria-label` using internal ids — added by rgbf51-20260930-001
- [ ] **U10/U11** Auto-advance the step flow; preflight the tab before spending an AI call — added by rgbf51-20260930-001
- [ ] **U13** Leave unvalidated AI answers unticked by default — added by rgbf51-20260930-001
- [ ] **U14–U21** Real progress, stage awareness, remove the leaked mirror element, cache the serialised profile, widen the popup — added by rgbf51-20260930-001
- [ ] **F1–F7** Repair `.github/workflows/ci.yml` (6 breakages: wrong cwd, bad uvicorn target, wrong e2e cwd, main vs master, --headed, `|| true`) — added by rgbf51-20260930-001
- [ ] **F8/F9/F11** Add ruff job; commit `pyrightconfig.json`; set coverage floors — added by rgbf51-20260930-001
- [ ] **F10** Add unit tests for `fill.ts`, `agents.ts`, `typeahead.ts` (zero coverage today) — added by rgbf51-20260930-001
- [ ] **F12–F16** Retire legacy E2E specs; delete `_backup_*` + `handoff.json`; remove `/analyze`; delete dead PBKDF2; delete `PreviewModal` — added by rgbf51-20260930-001
- [ ] **F17** Consolidate the duplicate `BD_*` / `RBG_*` memory sets — added by rgbf51-20260930-001
- [ ] **F18** Regression test: zero network calls when AI consent is off — added by rgbf51-20260930-001

## Form-filling 100 (2026-09-30) — full report in `docs/form-filling-100.md`
Scope: form filling only. CV/file upload and cover-letter generation explicitly dropped.
**A** detection/DOM 11 · **B** options/selects 10 · **C** MCQ 8 · **D** custom widgets 8 ·
**E** frames/wizards 6 · **F** fill execution & verification 10 · **G** UX 12 · **H** latency 10 ·
**I** security 9 · **J** database/history/audit/WAL 10 · **K** observability/testing/ops 6.
- [ ] **A1** Recursive open-shadow-root walk in describeFields — added by rgbf51-20260930-002
- [ ] **A2/E1** `all_frames: true` + per-frame routing; aggregate descriptors by frameId — added by rgbf51-20260930-002
- [ ] **A3** Detect by ARIA role (combobox, spinbutton, switch, listbox) not tag name — added by rgbf51-20260930-002
- [ ] **A4/A5** contenteditable as text inputs; IntersectionObserver scroll pass for lazy/virtualised fields — added by rgbf51-20260930-002
- [ ] **A6** Upgrade label resolution (floating labels, aria-describedby, data-testid) — added by rgbf51-20260930-002
- [ ] **A7** Group fields into sections/fieldsets; carry the section name — added by rgbf51-20260930-002
- [ ] **A8** Conditional-field second pass after a choice reveals new fields — added by rgbf51-20260930-002
- [ ] **A9/A10/A11** De-dup responsive DOM; use the HTML `autocomplete` token; report the 100-field cap — added by rgbf51-20260930-002
- [ ] **B1** `<select multiple>` → one descriptor, list-valued answer (currently skipped entirely) — added by rgbf51-20260930-002
- [ ] **B2** Checkbox groups by `name` → one descriptor, all labels as options (today every box gets ticked) — added by rgbf51-20260930-002
- [ ] **B3** Detect "select all that apply" vs "choose one" → set answer cardinality — added by rgbf51-20260930-002
- [ ] **B4/B5** Option match cascade (exact→alias→fuzzy→abbrev) and match by `value` as well as text — added by rgbf51-20260930-002
- [ ] **B6/B7** Optgroup-aware options; snap number answers into min/max/step — added by rgbf51-20260930-002
- [ ] **B8** Date format negotiation from placeholder/pattern/locale — added by rgbf51-20260930-002
- [ ] **B9/B10** Country matching by ISO/native/demonym; dependent select chains (country→state→city) — added by rgbf51-20260930-002
- [ ] **C1** MCQ block detection (fieldset per question, "Question N", repeated radios) — added by rgbf51-20260930-002
- [ ] **C2/C3** Single-answer MCQ (exactly one) and multi-answer MCQ (ordered set, write every member) — added by rgbf51-20260930-002
- [ ] **C4/C5** Render the MCQ as one numbered block; one task per set, not per question — added by rgbf51-20260930-002
- [ ] **C6/C7** Detect "None of the above"/"Other" and prefer blank; knowledge-check MCQs abstain, never invent — added by rgbf51-20260930-002
- [ ] **C8** Answer memory keyed by question text + option-set hash → consistent on re-sit — added by rgbf51-20260930-002
- [ ] **D1/D2** react-select and MUI Autocomplete via open→type→wait→click and aria-activedescendant — added by rgbf51-20260930-002
- [ ] **D3/D4** Workday composites; calendar/date-picker day-cell click + verify — added by rgbf51-20260930-002
- [ ] **D5/D6** `datalist` resolution; input-mask formatting (phone/date/currency/IBAN) — added by rgbf51-20260930-002
- [ ] **D7/D8** Framework-specific event sequences; div-based role=checkbox/radio click by label — added by rgbf51-20260930-002
- [ ] **E2** MutationObserver re-describe, diffed against the previous scan — added by rgbf51-20260930-002
- [ ] **E3/E4** Wizard step detection + "Fill and advance"; auto re-scan after each fill — added by rgbf51-20260930-002
- [ ] **E5/E6** Carry answers across steps; invalidate stale scan on SPA route change — added by rgbf51-20260930-002
- [ ] **F1** ⭐ Read back and verify every write — nothing in the codebase verifies a single write today — added by rgbf51-20260930-002
- [ ] **F2** Retry ladder: native setter → prototype setter → per-character — added by rgbf51-20260930-002
- [ ] **F3/F4** Full realistic event sequence; handle React's overridden value tracker — added by rgbf51-20260930-002
- [ ] **F5/F6** Set `selectedIndex` for selects + verify; scroll into view and focus before writing — added by rgbf51-20260930-002
- [ ] **F7/F8** Never silently overwrite a user-typed value; snapshot previous values before writing — added by rgbf51-20260930-002
- [ ] **F9/F10** Per-field filled/unchanged/rejected/failed report; re-write if the framework wipes the value — added by rgbf51-20260930-002
- [ ] **G1** Persist the popup session to `chrome.storage.session` — added by rgbf51-20260930-002
- [ ] **G2/G3/G4** Group Review by section; text search; select-all per section — added by rgbf51-20260930-002
- [ ] **G5** Keyboard navigation (↑↓, Space, Enter, `/`) — added by rgbf51-20260930-002
- [ ] **G6/G7** Show provenance + which rule fired; distinct "assumed" badge, assumed-first filter — added by rgbf51-20260930-002
- [ ] **G8/G9/G10** Live per-field progress; cancel a running scan; partial results as they land — added by rgbf51-20260930-002
- [ ] **G11/G12** Preflight the tab before spending an AI call; undo last fill — added by rgbf51-20260930-002
- [ ] **H1/H2** Profile digest once per request; field-relevant profile slice per field — added by rgbf51-20260930-002
- [ ] **H3/H4** In-request dedup; return deterministic answers immediately, patch in AI answers — added by rgbf51-20260930-002
- [ ] **H5/H6** Server deadline < client timeout with partials; dispatch long tasks first — added by rgbf51-20260930-002
- [ ] **H7/H8/H9/H10** One shared HTTP client; client-side profile cache; client-side answer memory; batch MCQs + prefix reuse — added by rgbf51-20260930-002
- [ ] **I1/I2** Default `FILL_REQUIRE_BYOK=1` + real auth on /fill and /analyze; shared-secret header — added by rgbf51-20260930-002
- [ ] **I3/I4/I5** Rate-limit and trim /health and /workers; bound the rate-limit store; key in the header — added by rgbf51-20260930-002
- [ ] **I6/I7** Per-key quota + daily budget; encrypt the profile at rest or document it honestly — added by rgbf51-20260930-002
- [ ] **I8/I9** Drop unused `optional_host_permissions` and request the exact origin; never log PII — added by rgbf51-20260930-002
- [ ] **J1** ⭐ SQLite in WAL mode (`journal_mode=WAL`, `synchronous=NORMAL`) replaces the DPAPI vault + in-memory cache — added by rgbf51-20260930-002
- [ ] **J2/J3** Schema (applications/fills/field_answers/answer_memory/events/migrations); append-only `events` audit log — added by rgbf51-20260930-002
- [ ] **J4** `request_id` idempotency on every fill — added by rgbf51-20260930-002
- [ ] **J5** Replace `server/utils/vault.py` (Windows-only, no production read path, thread-per-request) — added by rgbf51-20260930-002
- [ ] **J6/J7/J8** `wal_checkpoint(TRUNCATE)` + crash recovery; retention/TTL + VACUUM; versioned migrations — added by rgbf51-20260930-002
- [ ] **J9/J10** History surface in the popup; DPAPI-encrypt the sensitive columns (value, url) — added by rgbf51-20260930-002
- [ ] **K1/K2** Structured JSON logs with a correlation id; SQLite as the log sink, searchable in the popup — added by rgbf51-20260930-002
- [ ] **K3/K4** Log rotation caps for container deploys; unit tests for fill.ts / agents.ts / typeahead.ts — added by rgbf51-20260930-002
- [ ] **K5/K6** DB tests (migration, WAL crash recovery, idempotency, concurrency); repair `.github/workflows/ci.yml` + coverage floors — added by rgbf51-20260930-002

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
