# RBG Candidate — analysis and improvement list

_Written 2026-09-24, after the coordinator + worker-pool pass._

## Fixed in this pass (verified)

| # | Problem found | Fix | Proof |
|---|---|---|---|
| 1 | **Fill never worked.** Popup sent `FILL` to the content script, which ignored it. Chrome error: "The message port closed before a response was received." | Popup → background → content script `FILL_APPLY` (falls back to `scripting.executeScript`) | Reproduced on the original build in Chromium; the new E2E fills the page |
| 2 | **AI was never called.** Nothing sent `ANALYZE`, and the background used `https://127.0.0.1` with no `host_permissions` | New `AI_SUGGEST` → `POST /fill`; `host_permissions` for `127.0.0.1:8000` / `localhost:8000` | E2E: suggestions come from pool workers |
| 3 | No multi-agent layer | Coordinator + 15 independent workers (`server/agents/`) | 41 pytest cases; 22 tasks ran on 15 workers, peak concurrency 15, 0.8 s against the fake API |
| 4 | Server didn't start as documented (`uvicorn main:app` inside `server/` breaks relative imports) and `.env` was never loaded | Run `uvicorn server.main:app` from the project root; `config.py` loads `.env` | Server started, `/workers` shows 15 workers |
| 5 | Model output parsing was brittle (```` ```json ```` fences, `<think>` blocks, prose around the JSON) | `extract_json_object()`; answers checked against the field (select options, numbers, email, max length) | Unit tests |
| 6 | React-controlled inputs ignored the fill (`el.value =`) | Native prototype value setter; `<select>` matched by value or text; input, change and blur events fired | E2E React-style tracker fixture |
| 7 | Only 5 profile keys; first/last name got the full name; wrong `nth-of-type` fallback selector | Full field descriptors (label, type, options, required, maxlength); unique-selector builder; first/last split; new "Resume / extra details" profile field | E2E |
| 8 | Background trust check looked only at `sender.tab`, so the popup-as-tab was rejected and the check didn't identify the sender | Trust only senders whose URL is this extension's own page | Unit and E2E tests |
| 9 | Content script was built as an ES-module chunk (breaks as soon as code is shared) | Separate IIFE build (`vite.content.config.ts`) | `dist/content.js` has no imports |
| 10 | Rate limiter trusted `X-Forwarded-For` (spoofable) | Honoured only with `TRUST_PROXY_HEADERS=1` | — |
| 11 | CI was broken: server job ran inside `server/`, it started `uvicorn app.main`, and E2E failures were hidden by `\|\| true` | New workflow in `docs/ci-workflow.proposed.yml`. The `.github` folder is write-protected from this session, so copy it over by hand. Its E2E job runs the extension against the fake NVIDIA server | Needs a first push (the repo isn't in git yet) |
| 12 | "Scan" failed on tabs opened before the extension loaded | Popup injects `content.js` once and retries | — |

## Next steps, in priority order

### P0: do these next
1. **Run the live check on your key:** `.venv\Scripts\python.exe scripts\nvidia_smoke_test.py`. If a default model isn't available to your key, the script lists the ones that are. Put your picks in `NVIDIA_FAST_MODELS` and `NVIDIA_QUALITY_MODELS` in `.env`.
2. **Real ATS controls.** Only native `<input>`, `<textarea>` and `<select>` are detected today. Common gaps:
   - radio and checkbox groups ("Authorized to work?", "Need sponsorship?")
   - custom comboboxes (react-select, Workday dropdowns)
   - file inputs (CV upload)

   Add descriptor types `radio` and `checkbox` (the `choice` task kind already fits them) plus combobox handling.
3. **Iframes and shadow DOM.** Greenhouse and Lever forms are often embedded in an iframe on the company's own site. Add `all_frames: true`, route fills per frame, and walk open shadow roots.
4. **Consent for AI fields.** Fields the profile can't answer send your profile text and the job description to NVIDIA. Add a Settings switch ("Let AI workers use my profile") and a per-field "don't send" option. State this in the store listing.
5. **Drop `<all_urls>` content scripts.** On-demand injection is already built (the popup injects `content.js` when missing). Removing the static `content_scripts` entry removes the "read and change all your data on all websites" install warning, which Chrome Web Store review flags.

### P1
6. **Server URL setting plus `optional_host_permissions`** so you can deploy to Railway or Fly. Right now the extension can only reach `localhost:8000`.
7. **Protect the operator key.** With `NVIDIA_API_KEY` set on a public server, anyone who can reach `/fill` spends your quota. Require BYOK (bring your own key) in production or add a shared-secret header.
8. **Answer memory.** Cache answers by (question label, profile hash, job), and remember answers you edited, so multi-stage forms and repeat questions ("Why us?") don't cost new calls.
9. **Coordinator review pass (optional).** Right now the coordinator is deterministic (plan, assign, retry, verify). An optional LLM step could check that long answers don't contradict each other or the profile. Put it behind a flag, because it adds a sequential call.
10. **Stream progress** (SSE, server-sent events) so the popup shows each field as its worker finishes.
11. **Structured profile:** location, work authorization, links (LinkedIn, GitHub, portfolio), education, and experience entries. Most forms ask for these, and the AI must not guess them.
12. **Better job context.** Read schema.org `JobPosting` JSON-LD and `og:title` before falling back to `<h1>`. On application pages the `<h1>` is often a step name such as "Professional Experience".

### P2: hygiene
13. The popup is unstyled HTML, and the disclaimer appears twice (the App footer plus each tab).
14. The legacy `/analyze`, FieldMap and snippet paths are unused by the UI now. Remove them or put them behind a flag.
15. The old E2E specs (`extension.spec.ts`, `extension-load.spec.ts`) use the old flow. Retire them or port them to the `ai-pool.spec.ts` pattern.
16. `python-jose` is unused (it came from the JWT example in `idea.md`) and has a CVE history, so remove it. Pin dependency versions.
17. Stray files: the `-p/` folder, `testpath.js`, `search_logs.py`, and the empty `test-minimal-extension/`.
18. The status docs (`BD_README` "ALL 19 TASKS COMPLETE", security review "9 PASS") overstated readiness. Keep them tied to test results.
19. Run `git init`. The project has no version control, so every change is hard to undo.
