// client/src/popup/chrome.ts
import type { ScanRequestMessage, ScanResultMessage } from "../content/index";
import type { FieldDescriptor, FieldMap, JobContext } from "../types/index";
import type { AiSuggestResult } from "../background/router";
import type { TypingSpeed } from "../agents/palette";
import type { FieldMeta } from "../content/agents";

/**
 * Fill request sent to the active tab only after explicit user confirmation
 * in the Review tab. Manual fill only: this message carries field values and
 * never triggers any automatic submission.
 */
export interface FillRequestMessage {
  type: "FILL";
  stage: string;
  values: Record<string, string>;
  selectors: FieldMap;
  /** Animated typing agents (omitted/false = instant fill). */
  animate?: { agents: number; speed: TypingSpeed };
  /** Per-field label + which pool worker/model produced the value (shown on the cursor). */
  meta?: Record<string, FieldMeta>;
}

interface ChromeTabRef {
  id?: number;
}

interface ChromeTabsApi {
  query: (
    info: { active: boolean; currentWindow: boolean },
    callback: (tabs: ChromeTabRef[]) => void,
  ) => void;
  sendMessage: (
    tabId: number,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
}

interface ChromeScriptingApi {
  executeScript: (injection: {
    target: { tabId: number };
    files: string[];
  }) => Promise<unknown>;
}

interface ChromeRuntimeApi {
  lastError?: { message?: string };
  sendMessage?: (message: unknown, callback: (response: unknown) => void) => void;
}

interface ChromeScope {
  tabs?: ChromeTabsApi;
  scripting?: ChromeScriptingApi;
  runtime?: ChromeRuntimeApi;
}

function getChrome(): ChromeScope | null {
  const scope = globalThis as unknown as { chrome?: ChromeScope };
  if (!scope.chrome || !scope.chrome.tabs) {
    return null;
  }
  return scope.chrome;
}

function lastErrorMessage(scope: ChromeScope): string | null {
  const message = scope.runtime?.lastError?.message;
  return message ?? null;
}

export function toMessage(err: unknown): string {
  if (err instanceof Error && err.message !== "") {
    return err.message;
  }
  return "operation failed";
}

function getActiveTabId(scope: ChromeScope): Promise<number> {
  const tabs = scope.tabs;
  if (!tabs) {
    return Promise.reject(new Error("chrome.tabs unavailable"));
  }
  return new Promise((resolve, reject) => {
    try {
      tabs.query({ active: true, currentWindow: true }, (found) => {
        try {
          const failed = lastErrorMessage(scope);
          if (failed !== null) {
            reject(new Error(failed));
            return;
          }
          const tabId = found[0]?.id;
          if (typeof tabId !== "number") {
            reject(new Error("no active tab"));
            return;
          }
          resolve(tabId);
        } catch (err: unknown) {
          reject(err);
        }
      });
    } catch (err: unknown) {
      reject(err);
    }
  });
}

export function isScanResultMessage(message: unknown): message is ScanResultMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as Record<string, unknown>;
  if (candidate["type"] !== "SCAN_RESULT") {
    return false;
  }
  if (typeof candidate["snippet"] !== "string") {
    return false;
  }
  if (typeof candidate["url"] !== "string") {
    return false;
  }
  if (typeof candidate["stage"] !== "object" || candidate["stage"] === null) {
    return false;
  }
  if (typeof candidate["fields"] !== "object" || candidate["fields"] === null) {
    return false;
  }
  const stage = candidate["stage"] as Record<string, unknown>;
  return (
    typeof stage["stage"] === "string" &&
    typeof stage["confidence"] === "number" &&
    typeof stage["reason"] === "string"
  );
}

/** Older content scripts may not send descriptors/job; default them. */
export function normalizeScan(scan: ScanResultMessage): ScanResultMessage {
  const descriptors: FieldDescriptor[] = Array.isArray(scan.descriptors) ? scan.descriptors : [];
  const job: JobContext =
    typeof scan.job === "object" && scan.job !== null ? scan.job : { url: scan.url };
  return { ...scan, descriptors, job };
}

const NO_RECEIVER_RE = /receiving end does not exist|could not establish connection/i;

/**
 * Send a SCAN request to the active tab. If the page was open before the
 * extension loaded (no content script yet), inject it once and retry.
 */
export async function requestScan(): Promise<ScanResultMessage> {
  const scope = getChrome();
  if (scope === null || !scope.tabs) {
    throw new Error("chrome.tabs unavailable (run as installed extension)");
  }
  const tabId = await getActiveTabId(scope);
  try {
    return normalizeScan(await sendScan(scope, tabId));
  } catch (err: unknown) {
    if (!NO_RECEIVER_RE.test(toMessage(err)) || !scope.scripting) {
      throw err;
    }
    await scope.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return normalizeScan(await sendScan(scope, tabId));
  }
}

function sendScan(scope: ChromeScope, tabId: number): Promise<ScanResultMessage> {
  const tabs = scope.tabs;
  if (!tabs) {
    return Promise.reject(new Error("chrome.tabs unavailable"));
  }
  const payload: ScanRequestMessage = { type: "SCAN" };
  return new Promise((resolve, reject) => {
    try {
      tabs.sendMessage(tabId, payload, (response: unknown) => {
        try {
          const failed = lastErrorMessage(scope);
          if (failed !== null) {
            reject(new Error(failed));
            return;
          }
          if (!isScanResultMessage(response)) {
            reject(new Error("unexpected scan response"));
            return;
          }
          resolve(response);
        } catch (err: unknown) {
          reject(err);
        }
      });
    } catch (err: unknown) {
      reject(err);
    }
  });
}

function sendToBackground<T>(message: unknown): Promise<T> {
  const scope = getChrome();
  const runtime = scope?.runtime;
  if (!scope || !runtime || typeof runtime.sendMessage !== "function") {
    return Promise.reject(new Error("chrome.runtime unavailable (run as installed extension)"));
  }
  const send = runtime.sendMessage;
  return new Promise((resolve, reject) => {
    try {
      send(message, (response: unknown) => {
        const failed = lastErrorMessage(scope);
        if (failed !== null) {
          reject(new Error(failed));
          return;
        }
        if (
          typeof response === "object" &&
          response !== null &&
          (response as Record<string, unknown>)["status"] === "error"
        ) {
          const msg = (response as Record<string, unknown>)["message"];
          reject(new Error(typeof msg === "string" ? msg : "background request failed"));
          return;
        }
        resolve(response as T);
      });
    } catch (err: unknown) {
      reject(err);
    }
  });
}

/**
 * Send a user-confirmed FILL request to the background service worker, which
 * injects values via chrome.scripting. Values only, never submits.
 */
export async function requestFill(
  message: FillRequestMessage,
): Promise<{ filled: number; perAgent?: Record<string, number> }> {
  const result = await sendToBackground<{
    type: "FILL_RESULT";
    filled: number;
    perAgent?: Record<string, number>;
  }>(message);
  const out: { filled: number; perAgent?: Record<string, number> } = {
    filled: typeof result?.filled === "number" ? result.filled : 0,
  };
  if (result?.perAgent !== undefined) {
    out.perAgent = result.perAgent;
  }
  return out;
}

/** Ask the background (→ POST /fill → coordinator + AI workers) for values. */
export async function requestSuggestions(scan: ScanResultMessage): Promise<AiSuggestResult> {
  return await sendToBackground<AiSuggestResult>({
    type: "AI_SUGGEST",
    descriptors: scan.descriptors,
    job: scan.job,
  });
}


/** Health check response from the server (via the background worker). */
export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  nvidiaApiKeyConfigured: boolean;
  workersActive: number;
  workersTotal: number;
  models: string[];
}

const DOWN: HealthResponse = {
  status: "down",
  nvidiaApiKeyConfigured: false,
  workersActive: 0,
  workersTotal: 0,
  models: [],
};

/** Ask the background to call the server's /health endpoint. Never throws. */
export async function requestHealth(): Promise<HealthResponse> {
  try {
    const r = await sendToBackground<Partial<HealthResponse>>({ type: "HEALTH_CHECK" });
    if (r === null || typeof r !== "object") return DOWN;
    return {
      status: r.status === "ok" || r.status === "degraded" ? r.status : "down",
      nvidiaApiKeyConfigured: r.nvidiaApiKeyConfigured === true,
      workersActive: typeof r.workersActive === "number" ? r.workersActive : 0,
      workersTotal: typeof r.workersTotal === "number" ? r.workersTotal : 0,
      models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === "string") : [],
    };
  } catch (_err: unknown) {
    return DOWN;
  }
}

/** Save text as a file via a temporary link (works from extension pages). */
export function downloadText(filename: string, text: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
