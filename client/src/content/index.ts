// client/src/content/index.ts
import { buildPromptSnippet, detectStage, scanFields } from "./detect";
import { describeFields, extractJobContext } from "./describe";
import { fillCheckedFieldsInPage } from "./fill";
import { runAgentFill, type FieldMeta } from "./agents";
import { clampAgents, type TypingSpeed } from "../agents/palette";
import type { FieldDescriptor, FieldMap, JobContext, StageHint } from "../types/index";

export interface ScanRequestMessage {
  type: "SCAN";
}

export interface ScanResultMessage {
  type: "SCAN_RESULT";
  stage: StageHint;
  fields: FieldMap;
  /** Every fillable control (for the AI worker pool). */
  descriptors: FieldDescriptor[];
  job: JobContext;
  snippet: string;
  url: string;
}

interface ChromeMessageSender {
  url?: string;
}

type MessageListener = (
  message: unknown,
  sender: ChromeMessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;

interface ChromeRuntime {
  onMessage: {
    addListener: (listener: MessageListener) => void;
  };
}

function getChromeRuntime(): ChromeRuntime | null {
  const scope = globalThis as unknown as {
    chrome?: { runtime?: ChromeRuntime };
  };
  const runtime = scope.chrome?.runtime;
  return runtime ?? null;
}

function getPageUrl(): string {
  if (
    typeof window !== "undefined" &&
    typeof window.location?.href === "string"
  ) {
    return window.location.href;
  }
  return "";
}

function getScanRoot(): ParentNode | null {
  if (typeof document !== "undefined") {
    return document;
  }
  return null;
}

export function isScanRequest(message: unknown): message is ScanRequestMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as Record<string, unknown>;
  return candidate["type"] === "SCAN";
}

/** Pure assembly of a scan result from an explicit root + url. */
export function buildScanResult(
  url: string,
  root: ParentNode,
): ScanResultMessage {
  const stage: StageHint = detectStage(root, url);
  const fields: FieldMap = scanFields(root);
  const snippet = buildPromptSnippet(stage, fields);
  const descriptors = describeFields(root);
  const job = extractJobContext(root, url);
  return { type: "SCAN_RESULT", stage, fields, descriptors, job, snippet, url };
}

/**
 * Handle one inbound message. Returns a SCAN_RESULT for SCAN, else null.
 * Scan-only: reads the DOM, never assigns to input values.
 */
export function handleContentMessage(
  message: unknown,
): ScanResultMessage | null {
  if (!isScanRequest(message)) {
    return null;
  }
  const root = getScanRoot();
  if (root === null) {
    return null;
  }
  try {
    return buildScanResult(getPageUrl(), root);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "scan failed";
    console.warn(`[rbg] scan failed: ${reason}`);
    return null;
  }
}

interface FillApplyRequest {
  type: "FILL_APPLY";
  values: Record<string, string>;
  selectors: FieldMap;
  animate?: { agents: number; speed: TypingSpeed };
  meta?: Record<string, FieldMeta>;
}

export function isFillApply(message: unknown): message is FillApplyRequest {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const m = message as Record<string, unknown>;
  return (
    m["type"] === "FILL_APPLY" &&
    typeof m["values"] === "object" && m["values"] !== null &&
    typeof m["selectors"] === "object" && m["selectors"] !== null
  );
}

function registerScanListener(): void {
  const runtime = getChromeRuntime();
  if (runtime === null) {
    return;
  }
  try {
    // runtime.onMessage in a content script only receives this extension's messages.
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isFillApply(message)) {
        // Values only; the page is never submitted.
        const anim = message.animate;
        if (anim === undefined) {
          const filled = fillCheckedFieldsInPage({ values: message.values, selectors: message.selectors });
          sendResponse({ type: "FILL_APPLIED", filled });
          return false;
        }
        const speed: TypingSpeed = anim.speed === "slow" || anim.speed === "fast" ? anim.speed : "normal";
        const args: Parameters<typeof runAgentFill>[0] = {
          values: message.values,
          selectors: message.selectors,
          agents: clampAgents(anim.agents),
          speed,
        };
        if (message.meta !== undefined) {
          args.meta = message.meta;
        }
        runAgentFill(args)
          .then((report) => {
            sendResponse({ type: "FILL_APPLIED", filled: report.filled, perAgent: report.perAgent });
          })
          .catch((err: unknown) => {
            console.warn(`[rbg] agent fill failed, filling instantly: ${String(err)}`);
            const filled = fillCheckedFieldsInPage({ values: message.values, selectors: message.selectors });
            sendResponse({ type: "FILL_APPLIED", filled });
          });
        return true; // async response
      }
      const result = handleContentMessage(message);
      if (result === null) {
        return false;
      }
      // Reply only to the requester (popup); never broadcast page data.
      sendResponse(result);
      return false;
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "listener failed";
    console.warn(`[rbg] listener registration failed: ${reason}`);
  }
}

// Guard against double registration when the popup re-injects this script.
const FLAG = "__rbgContentListener";
const scope = globalThis as unknown as Record<string, unknown>;
if (scope[FLAG] !== true) {
  scope[FLAG] = true;
  registerScanListener();
}
