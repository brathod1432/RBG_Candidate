# Client — MV3 extension (React + TypeScript + Vite)

## Build
```bat
cd client
npm install
npm run build
```
`npm run build` runs `tsc`, the main Vite build (popup + background) and a second
build (`vite.content.config.ts`) that emits `content.js` as one self-contained IIFE —
MV3 content scripts cannot load ES-module chunks.

Load `client/dist` via `chrome://extensions` → Developer mode → Load unpacked.
The extension talks to `http://127.0.0.1:8000` (see `host_permissions` in `manifest.json`).

## Test
```bat
npx tsc --noEmit
npx vitest run
```

## Message flow
- Popup → content script: `SCAN` → `SCAN_RESULT` (stage, field descriptors, job context)
- Popup → background: `AI_SUGGEST` → `POST /fill` (profile + BYOK key read in background only)
- Popup → background: `FILL` (+ `animate` prefs, per-field worker/model meta) → content script `FILL_APPLY` → typing agents overlay (`src/content/agents.ts`); fallback: instant `scripting.executeScript`
- Background only trusts senders whose URL is this extension's own page.
