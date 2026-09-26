# Contributing to RBG Candidate

Thank you for contributing! This guide covers how to add job site support, improve UX, audit security, and maintain code quality.

---

## Adding New Job Site Support

RBG Candidate uses content scripts with **FieldMap** selectors to detect and fill form fields. Each job site needs a FieldMap entry.

### 1. Locate the FieldMap

File: `client/src/content/field-map.ts`

```typescript
export const FIELD_MAP: Record<string, FieldMapEntry> = {
  "linkedin.com": { /* existing */ },
  "indeed.com": { /* existing */ },
  // Add new site here
};
```

### 2. Define Selectors

For each field type, provide CSS selectors that match the site's input elements:

```typescript
"newsite.com": {
  contact: {
    firstName: "#firstName, input[name='firstName']",
    lastName: "#lastName, input[name='lastName']",
    email: "#email, input[name='email']",
    phone: "#phone, input[name='phone']",
  },
  experience: {
    company: ".company-input, [data-testid='company']",
    title: ".title-input, [data-testid='title']",
    startDate: ".start-date, [data-testid='startDate']",
    endDate: ".end-date, [data-testid='endDate']",
    description: ".desc-textarea, [data-testid='description']",
  },
  // ... other sections
}
```

### 3. Add Stage Detection (if multi-step)

If the site uses multi-step forms, add a stage detector in `client/src/content/stage-detector.ts`:

```typescript
export function detectStage(url: string, doc: Document): FormStage {
  if (url.includes("newsite.com/apply")) {
    if (doc.querySelector("#step-1")) return "contact";
    if (doc.querySelector("#step-2")) return "experience";
    if (doc.querySelector("#step-3")) return "education";
  }
  return "unknown";
}
```

### 4. Test

1. Load extension unpacked
2. Navigate to the job application page
3. Open popup → click **Analyze** → verify field detection in preview modal
4. Add test fixture in `tests/fixtures/` (see existing `stage-1-contact.html`, `stage-2-experience.html`)
5. Run `pytest tests/test_analyze.py -v` and `npm run test` in client

---

## UX Improvements

### Popup (`client/src/popup/`)

- **State**: Zustand store in `client/src/store/useAppStore.ts`
- **Components**: React components in `client/src/popup/components/`
- **Adding features**: Follow existing patterns — keep components small, use the store for state

### Preview Modal (`client/src/popup/components/PreviewModal.tsx`)

- Shows field-by-field mapping before fill
- To add new field types: update `FieldPreviewRow` component and the store's `previewData` shape

### Content Script Injection

- Styles injected via `client/src/content/styles.ts` — add site-specific overrides there
- Toast notifications: `client/src/content/toast.ts`

---

## Security Audit PRs

All security-related PRs must pass the checklist in `security/README.md` (9 checks):

1. **No hardcoded secrets** — API keys, passwords, tokens
2. **No bare `except:`** — explicit exception types only
3. **Logging not print** — `logging` module everywhere
4. **Input validation** — Pydantic schemas on all endpoints
5. **CORS locked** — `ALLOWED_ORIGINS` from env, no `*`
6. **Rate limiting** — in-memory, per-IP, configurable
7. **Error envelopes** — structured `{"status","message","code"}`, no stack traces
8. **CSP compliant** — no inline scripts, `script-src 'self'` only
9. **Crypto audit** — WebCrypto only, no WASM, keys never leave device

Run the audit locally before submitting:

```bash
# Server
cd server
..\.venv\Scripts\python.exe -m pyright .
..\.venv\Scripts\pytest tests/ -v

# Client
cd client
npm run build  # runs tsc
npm run test
```

---

## Code Style

| Tool | Config | Command |
|------|--------|---------|
| Python type check | `pyproject.toml` / `pyrightconfig.json` | `pyright .` |
| TypeScript type check | `tsconfig.json` | `tsc --noEmit` |
| Python lint | Ruff (if added) / pyright | `pyright .` |
| JS/TS lint | ESLint (if added) | `npm run lint` |

### Rules (Enforced)

- **Python 3.11+** — type hints on all functions, `async`/`await` for I/O
- **No bare `except:`** — always specify exception type
- **Logging, not `print()`** — `logging.getLogger(__name__)`
- **No hardcoded secrets** — `os.getenv("VAR_NAME")` only
- **Structured errors** — `{"status": "error", "message": "...", "code": "..."}`
- **FastAPI** — Pydantic v2 models for all request/response bodies
- **React** — functional components, hooks, Zustand for global state

---

## Testing Requirements

Every new feature or job site support **must** include:

| Test Type | Location | Coverage Target |
|-----------|----------|-----------------|
| Unit (server) | `tests/test_*.py` | Pydantic models, router logic, Nvidia client |
| Unit (client) | `client/src/**/*.test.tsx` | Store actions, selectors, utilities |
| Integration (server) | `tests/test_analyze.py` | `/analyze` endpoint with mocked Nvidia |
| E2E | `e2e/*.spec.ts` | Full flow: page → popup → analyze → preview → fill |

### Running Tests Locally

```bash
# Server
cd server
..\.venv\Scripts\pytest tests/ -v --cov=server

# Client
cd client
npm run test -- --coverage

# E2E (requires built extension + running server)
cd e2e
npx playwright test
```

### CI Gates

PRs must pass:
- `pyright` (0 errors)
- `tsc --noEmit` (0 errors)
- `pytest` (all pass, coverage ≥ 80%)
- `vitest` (all pass)
- `playwright` (all pass on chromium)

---

## Pull Request Checklist

- [ ] `pyright` clean on server
- [ ] `tsc --noEmit` clean on client
- [ ] Unit tests added/updated (server + client)
- [ ] Integration test for new `/analyze` behavior
- [ ] E2E test for new job site or UX flow
- [ ] Security checklist reviewed (if security-related)
- [ ] Docs updated: `README.md`, `docs/architecture.md`, `docs/roadmap.md` if applicable
- [ ] No `.env`, `.venv`, `node_modules`, `dist`, `__pycache__` committed

---

## Questions?

Open an issue or check `docs/architecture.md` for deeper technical details.