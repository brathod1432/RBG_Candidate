// client/src/popup/health.ts
// "Prepare" health model (merged from the Prepare-tab work): what the popup
// needs to know before scanning — server reachable, a key available, workers up.
import type { HealthResponse } from "./chrome";

export type PrepareStatus = "unknown" | "checking" | "ready" | "degraded" | "down";

export interface PrepareChecks {
  server: boolean;
  /** Server key from .env OR the user's own encrypted key in the extension. */
  apiKey: boolean;
  /** Where the key comes from, for the UI. */
  keySource: "server" | "yours" | "both" | "none";
  workers: number;
  workersTotal: number;
  models: string[];
}

export const EMPTY_CHECKS: PrepareChecks = {
  server: false,
  apiKey: false,
  keySource: "none",
  workers: 0,
  workersTotal: 0,
  models: [],
};

export function checksFrom(health: HealthResponse, hasOwnKey: boolean): PrepareChecks {
  const server = health.status !== "down" || health.workersTotal > 0;
  const serverKey = server && health.nvidiaApiKeyConfigured;
  const keySource = serverKey && hasOwnKey ? "both" : serverKey ? "server" : hasOwnKey ? "yours" : "none";
  return {
    server,
    apiKey: keySource !== "none",
    keySource,
    workers: server ? health.workersActive : 0,
    workersTotal: server ? health.workersTotal : 0,
    models: server ? health.models : [],
  };
}

export function deriveStatus(c: PrepareChecks): PrepareStatus {
  if (!c.server) return "down";
  if (c.apiKey && c.workersTotal > 0 && c.workers >= c.workersTotal) return "ready";
  return "degraded";
}

export const POLL_READY_MS = 10_000;
export const POLL_BUSY_MS = 2_000;
export const POLL_MAX_MS = 10_000;

/** Next poll delay: quick while not ready, relaxed when ready, backoff while down. */
export function nextDelay(status: PrepareStatus, previousMs: number): number {
  if (status === "ready") return POLL_READY_MS;
  if (status === "down") return Math.min(POLL_MAX_MS, Math.max(POLL_BUSY_MS, previousMs * 2));
  return POLL_BUSY_MS;
}
