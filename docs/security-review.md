# Security & Privacy Audit — RBG Candidate

**Date:** 2026-09-24  
**Scope:** `server/`, `client/src/`, `client/manifest.json`, `.gitignore`, `.env.example`  
**Checklist Source:** `docs/e2e-plan.md` §5 (Security + compliance checklist)

---

## Pass/Fail Summary

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | No hardcoded `nvapi-` anywhere | ✅ PASS | `rg` scan of `server/` and `client/src/` returns zero matches. Only occurrences in `docs/architecture.md` (line 24, example in API contract), `docs/e2e-plan.md` (line 47, test note), and audit script itself. |
| 2 | `.env` gitignored, required vars validated at startup | ✅ PASS | `.gitignore` lines 21–22: `.env` and `.env.*` ignored; `.env.example` committed. `server/config.py` lines 15–19 validates `PORT` (1–65535) and `ALLOWED_ORIGINS` (non-empty) at import time — fails fast with clear `RuntimeError`. |
| 3 | Manifest minimal permissions + justification | ✅ PASS | `client/manifest.json` lines 17–21: exactly 3 permissions — `storage` (PII + ciphertext), `activeTab` (scan/fill current tab), `scripting` (inject fill function). `docs/architecture.md` §2: "Permissions: storage, activeTab, scripting only." |
| 4 | CSP has no `wasm-unsafe-eval` | ✅ PASS | No explicit `content_security_policy` in `manifest.json` → MV3 default CSP applies. `docs/architecture.md` §2 explicitly: "CSP: no `wasm-unsafe-eval`." No `wasm-unsafe-eval` found anywhere in codebase (`rg` clean). |
| 5 | Session key TRUSTED_CONTEXTS only, never to content script | ✅ PASS | `client/src/background/router.ts` line 23: `TRUSTED_CONTEXTS = ["popup"]`. `isTrustedSender()` (lines 31–36) returns `false` for any sender with `tab` property (content scripts). Session key stored in `chrome.storage.session` (memory-only, `storage.ts` lines 134–146) and only read via `getSessionKey()` in background. `router.test.ts` lines 17–22 asserts content-script senders are rejected. |
| 6 | Server logs contain zero html/key (grep audit) | ✅ PASS | `server/routers/analyze.py` line 100: `logger.info("Analyze request from %s (html_len=%d)", ip, html_len)` — logs only length, never content. Lines 93, 105: API key warnings log IP only, never key value. `server/nvidia_client.py` lines 78, 81, 85, 88, 91: logs status codes and truncated error text (max 200 chars), never request payload or key. |
| 7 | Rate limit active + single-instance doc | ✅ PASS | `server/routers/analyze.py` lines 26–52: in-memory per-IP limiter (30 req / 60 s). `check_rate_limit()` raises 429 with envelope. `docs/architecture.md` §7 Risk 93: "Horizontal scaling breaks in-memory limiter → single-instance doc + Redis trigger (needs approval)." |
| 8 | Disclaimer verbatim in popup | ✅ PASS | `client/src/popup/store.ts` lines 6–7: `DISCLAIMER = "RBG Candidate automates form filling but does not provide legal advice. Ensure compliance with job site terms."` Rendered in `App.tsx` footer (line 51), `FillTab.tsx` (line 78), `ReviewTab.tsx` (line 141) — exact match, all three tabs. |
| 9 | Privacy listing: local-only, transient API calls, nothing stored server-side | ✅ PASS | `docs/architecture.md` §1: "Privacy-first: all PII + API key stay on-device in chrome.storage; server stores nothing." §4 table: Server row = "stores nothing; never logs html/key". BYOK model (`analyze.py` line 91): client sends key per-request over HTTPS, server never persists. Offline fallback uses local profile only (`router.ts` lines 186–202). |

---

## Detailed Evidence Commands

```bash
# 1. No hardcoded nvapi-
rg -i "nvapi-" server/ client/src/   # → no matches

# 2. .env gitignored + startup validation
cat .gitignore | grep -E "\.env"
cat server/config.py | head -20

# 3. Manifest permissions
cat client/manifest.json | jq .permissions

# 4. CSP check
cat client/manifest.json | jq .content_security_policy   # → null (default)
rg "wasm-unsafe-eval" client/ server/   # → no matches

# 5. Session key isolation
cat client/src/background/router.ts | grep -A5 "TRUSTED_CONTEXTS"
cat client/src/background/router.ts | grep -A10 "isTrustedSender"
cat client/src/background/router.test.ts | grep -A10 "rejects content-script"

# 6. Server log audit
rg "logger\.(info|warning|error)" server/routers/analyze.py
rg "logger\.(info|warning|error)" server/nvidia_client.py

# 7. Rate limit + single-instance doc
cat server/routers/analyze.py | head -55
cat docs/architecture.md | grep -A2 "Risk 93"

# 8. Disclaimer verbatim
cat client/src/popup/store.ts | head -10
cat client/src/popup/App.tsx | grep -A2 footer
cat client/src/popup/tabs/FillTab.tsx | tail -5
cat client/src/popup/tabs/ReviewTab.tsx | tail -5

# 9. Privacy listing
cat docs/architecture.md | head -15
cat docs/architecture.md | sed -n '32,39p'
```

---

## Additional Observations

| Area | Note |
|------|------|
| **HTTPS enforcement** | `router.ts` `normalizeBaseUrl()` (lines 404–417) rejects non-HTTPS URLs except `localhost`/`127.0.0.1`. |
| **No auto-submit** | `router.ts` `fillCheckedFieldsInPage()` (lines 208–242) only sets values + dispatches `input`/`change` events — no `form.submit()`, no click, no Enter. |
| **Error envelope consistency** | All server errors return `{status, message, code}` envelope (`main.py` lines 39–66). |
| **CORS allowlist only** | `main.py` lines 29–35: `allow_origins=ALLOWED_ORIGINS` (no `*`). |
| **PII storage** | Profile stored plaintext in `chrome.storage.local` (documented, user-controlled). API key stored as AES-GCM ciphertext + salt + IV in `local`; derived key in `session` (memory-only). |

---

## Verdict

**All 9 checklist items PASS.** The extension and server meet the security and privacy requirements defined in `docs/e2e-plan.md` §5. No critical findings.