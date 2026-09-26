// client/src/globals.d.ts
// Global Chrome extension API declarations (MV3).
// This is a global script file (no imports/exports) — `declare const` here
// creates a true global variable, which `declare global { interface Window }`
// cannot do. Callback params are fully typed so tsc infers them (no TS7006).

type StorageGetCallback = (items: Record<string, unknown>) => void;
type StorageSetCallback = () => void;

declare const chrome: {
  storage: {
    local: {
      get: (keys: string | string[], callback: StorageGetCallback) => void;
      set: (items: Record<string, unknown>, callback: StorageSetCallback) => void;
      remove: (keys: string | string[], callback: StorageSetCallback) => void;
    };
  };
  runtime: { lastError?: { message?: string } };
};
