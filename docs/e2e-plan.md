# E2E Implementation Plan — RBG Candidate
> Task: rgbf51-20260924-001 · Mode: BYPASS · Source: idea.md + 2 ToT verdicts
> 7 areas → 19 atomic tasks · Test cycles: 3 (unit → integration → E2E) · Nothing omitted — this file is the checklist.

## 0. How to execute
Strictly in `task_order` (task-1 → task-19). One agent call per task. `depends_on` must be `complete` before starting. Git checkpoint before every `code_generation` task (`git add -A && git commit -m "bd-checkpoint: before <title> [rgbf51-20260924-001]"`; skip if clean tree / not a git repo). Pyright zero-errors + pytest/vitest green before marking complete. Grounded review if trigger ≥ 2. One retry, then BLOCKED (dependents cascade to blocked, session continues).

## 1. Temperature strategy
| Task | Agent | Temp | Why |
|---|---|---|---|
| 1 infra | code_generation | CONSERVATIVE | spec-exact hygiene, no surprises |
| 2 arch contract | idea_planner | BALANCED | proven patterns, one alternative max |
| 3 landscape | competitor_research | CREATIVE | open-ended exploration |
| 4 server scaffold | code_generation | CONSERVATIVE | fail-fast config, health contract |
| 5 schemas | code_generation | CONSERVATIVE | Pydantic exactness |
| 6 nvidia proxy | code_generation | BALANCED | standard feature, retry/timeout judgment |
| 7 server tests | code_generation | CONSERVATIVE | spec-exact verification |
| 8 ext scaffold | code_generation | BALANCED | build-tool choice needs judgment |
| 9 types/storage/crypto | code_generation | CONSERVATIVE | security-critical, safest approach |
| 10 content script | code_generation | BALANCED | heuristics need judgment |
| 11 popup UI | code_generation | BALANCED | standard feature + UX judgment |
| 12 background SW | code_generation | CONSERVATIVE | key-handling, no deviations |
| 13 client tests | code_generation | CONSERVATIVE | verification only |
| 14 security audit | code_generation | CONSERVATIVE | checklist-exact |
| 15 wasm decision | code_generation | BALANCED | record ToT-2 + triggers |
| 16 fixtures + QA | code_generation | BALANCED | fixture design judgment |
| 17 playwright E2E | code_generation | CONSERVATIVE | deterministic, no flakiness |
| 18 deploy + CI | deployment | CONSERVATIVE | spec-exact, no surprises |
| 19 polish docs | code_generation | BALANCED | docs judgment |

## 2. Task dependency graph
```
1 → 2 →┬→ 4 → 5 → 6 → 7 ↘
       │                    → 14 → 15
       ├→ 8 → 9 → 10 → 11 → 12 → 13 ↗
       └→ 3 (parallel after 2, blocks nothing)
13 → 16 → 17 → 18 → 19
14 needs 7 AND 13. 15 needs 14.
```

## 3. Per-task acceptance (must all hold before complete)
- **T1**: `.gitignore` covers .opencode/.env/.venv/node_modules/dist; `.env.example` lists NVIDIA_API_KEY, PORT, ALLOWED_ORIGINS; LICENSE MIT; READMEs exist. No logic.
- **T2**: `docs/architecture.md` contains D1–D4, component diagram, /health + /analyze contract, error envelope, CORS/rate-limit/no-PII rules.
- **T3**: `docs/research.md` — 5+ extensions table (permissions, privacy text, rating) + Nvidia endpoint/key/limit notes + 3 gaps RBG exploits.
- **T4**: `uvicorn` boots, `GET /health` → `{"status":"ok"}`; missing env fails fast with clear message; `logging` only.
- **T5**: Pydantic v2 models validate/reject correctly; error envelope `{status,error,message,code}`; ≥1 test per model.
- **T6**: `/analyze` forwards to Nvidia (mocked in tests), maps 401→403, 429 passthrough, timeout→504; rate limit triggers 429; `rg -i "nvapi-" server/` finds no key; no html/key in logs.
- **T7**: `pytest -q` all green; covers happy/403/429/504; pyright clean.
- **T8**: `manifest.json` MV3, 3 permissions only + justification comment, no wasm CSP; `tsc --noEmit` clean; unpacked load succeeds.
- **T9**: PBKDF2→AES-GCM round-trip test green; storage areas correct (local PII/ciphertext, session key); raw key never written to disk (code search proves).
- **T10**: Fixture forms produce correct FieldMap + stage for stage-1/2/aria-only cases; no DOM write without confirm flag.
- **T11**: 3 tabs render; Scan→preview modal; per-field checkboxes; Fill/Skip per stage; disclaimer verbatim; no auto-submit element in DOM.
- **T12**: Messages SCAN/FILL/UNLOCK routed; session key never sent to content script (assert in test); offline fallback fills exact-match fields; HTTPS only in prod.
- **T13**: `npm test` green (crypto, storage mock, stage matrix, heuristics).
- **T14**: `docs/security-review.md` pass/fail table all pass; permission/CSP/key/log/disclaimer/storage checks evidenced with commands.
- **T15**: `security/wasm-decision.md` records rejection + seam + 2 revisit triggers. Zero Rust code.
- **T16**: `tests/fixtures/*.html` (stage-1, stage-2, edge) load standalone; `docs/qa-checklist.md` covers LinkedIn/Indeed/local.
- **T17**: `npx playwright test` green headless: unlock→scan→preview→confirm-fill→assert values; no-auto-submit asserted; stage-2 skip path.
- **T18**: `docs/deployment.md` (store zip + listing privacy text, Railway/Fly + HTTPS + env, single-instance note) + `.github/workflows/ci.yml` (pytest+pyright, vitest+tsc, playwright).
- **T19**: README/CONTRIBUTING/roadmap rewritten; every file in this plan exists; no orphans; BD_* updated.

## 4. Test strategy (3 cycles, always)
| Cycle | Scope | Gate |
|---|---|---|
| 1 unit | T7 server pytest, T13 vitest | 100% of new functions covered, pyright/tsc clean |
| 2 integration | server↔mocked Nvidia, popup↔background↔content via mocks, storage+crypto round-trip | error mapping + key isolation proven |
| 3 E2E | Playwright unpacked ext + local uvicorn + fixtures (T17) + manual LinkedIn/Indeed checklist (T16) | full user journey green, no auto-submit |

Bug-fix policy: fix between cycles, re-run affected cycle, log in changelog. After 3 failed attempts on one bug → record as Known Issue, continue.

## 5. Security + compliance checklist (T14 enforces)
- [ ] No hardcoded `nvapi-` anywhere (`rg` clean)
- [ ] `.env` gitignored, required vars validated at startup
- [ ] Manifest minimal permissions + justification
- [ ] CSP has no `wasm-unsafe-eval`
- [ ] Session key TRUSTED_CONTEXTS only, never to content script
- [ ] Server logs contain zero html/key (grep audit)
- [ ] Rate limit active + single-instance doc
- [ ] Disclaimer verbatim in popup: *"RBG Candidate automates form filling but does not provide legal advice. Ensure compliance with job site terms."*
- [ ] Privacy listing: local-only, transient API calls, nothing stored server-side

## 6. Deployment (T18)
- Client: `zip -r dist.zip client/dist` → Chrome Developer Dashboard ($25) + Edge Add-ons; privacy disclosure = §5 last two bullets.
- Backend: Railway or Fly.io, HTTPS (Let's Encrypt), env `NVIDIA_API_KEY / PORT / ALLOWED_ORIGINS`, single instance (rate limiter), `/health` as healthcheck.
- CI: GitHub Actions on PR — server job, client job, e2e job (playwright + local server).

## 7. Risks + mitigations
| Risk | Mitigation | Task |
|---|---|---|
| bash tool broken in planner env (`ChildProcess.spawn NotFound`) | implementation agents must verify shell; fallback to file tools; record in Known Issues | T1 |
| Nvidia API shape drift vs idea.md's `/v1/analyze` guess | T3 verifies real endpoint; T6 isolates URL in one const + mock | T3/T6 |
| Session-key UX (re-unlock per browser restart) | once-per-session cache (ToT-2); document fallback | T9/T11 |
| Horizontal scaling breaks in-memory limiter | single-instance doc + Redis trigger (needs approval) | T6/T18 |
| Store review friction (permissions/privacy) | minimal permissions + disclosure text ready | T8/T14/T18 |
| Auto-submit accusation | no auto-submit element + E2E asserts manual submit | T11/T17 |

## 8. What was deliberately excluded (LessWorks)
Server DB, analytics, cross-device sync, Rust WASM code, `*` CORS, auto-submit, committed secrets, broad rewrites, new deps without approval. Revisit only on triggers in T15 / ToT dissent notes.

## 9. Done definition (T19 exit)
All 19 tasks complete or blocked-with-reason; 3 test cycles logged; `BD_README.md` rewritten; `BD_changelog.md` appended; `BD_todo.md` has zero hidden follow-ups; grounded reviews logged; git checkpoints listed.
