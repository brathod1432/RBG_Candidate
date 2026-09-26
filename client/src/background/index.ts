// client/src/background/index.ts
import type { FillRequestMessage } from "../popup/chrome";
import type { FieldMap } from "../types/index";
import {
  analyzeWithFallback,
  fillCheckedFields,
  forwardScanToTab,
  getActiveTabId,
  getBackgroundChrome,
  fetchHealth,
  isAiSuggestRequest,
  isAnalyzeRequest,
  isFillRequestMessage,
  isScanRequestMessage,
  isTrustedSender,
  suggestWithFallback,
  toMessage,
  type BackgroundErrorMessage,
  type ChromeMessageSender,
} from "./router";

type MessageListener = (
  message: unknown,
  sender: ChromeMessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;

interface RuntimeWithListener {
  onMessage: { addListener: (listener: MessageListener) => void };
}

function getRuntime(): RuntimeWithListener | null {
  const scope = globalThis as unknown as {
    chrome?: { runtime?: RuntimeWithListener };
  };
  return scope.chrome?.runtime ?? null;
}

function errorMessage(err: unknown, code: string): BackgroundErrorMessage {
  return { status: "error", message: toMessage(err), code };
}

function scanFieldsOf(message: unknown): FieldMap {
  if (
    typeof message === "object" &&
    message !== null &&
    "fields" in message &&
    typeof (message as Record<string, unknown>)["fields"] === "object" &&
    (message as Record<string, unknown>)["fields"] !== null
  ) {
    return (message as { fields: FieldMap }).fields;
  }
  return {};
}

async function handleBackgroundMessage(
  message: unknown,
  sender: ChromeMessageSender,
): Promise<unknown> {
  // Content scripts echo SCAN_RESULT via runtime.sendMessage; ignore them.
  if (
    typeof message === "object" &&
    message !== null &&
    (message as Record<string, unknown>)["type"] === "SCAN_RESULT"
  ) {
    return null;
  }

  if (isScanRequestMessage(message)) {
    const scope = getBackgroundChrome();
    if (scope === null) {
      throw new Error("chrome unavailable");
    }
    const tabId = await getActiveTabId(scope);
    // Forwards only { type: "SCAN" }; session key never leaves background.
    return await forwardScanToTab(scope, tabId);
  }

  if (isFillRequestMessage(message)) {
    if (!isTrustedSender(sender)) {
      throw new Error("FILL rejected for untrusted sender");
    }
    const fill: FillRequestMessage = message;
    if (Object.keys(fill.values).length === 0) {
      throw new Error("no checked field values to fill");
    }
    const scope = getBackgroundChrome();
    if (scope === null) {
      throw new Error("chrome unavailable");
    }
    const tabId = await getActiveTabId(scope);
    // Values + selectors only; injected func never submits any form.
    return await fillCheckedFields(scope, tabId, fill);
  }

  if (isAnalyzeRequest(message)) {
    if (!isTrustedSender(sender)) {
      throw new Error("ANALYZE rejected for untrusted sender");
    }
    const fields = scanFieldsOf(message);
    // BYOK decrypt + HTTPS POST happen inside; offline falls back to profile.
    return await analyzeWithFallback(
      message.html,
      fields,
      message.serverBaseUrl,
    );
  }

  if (isAiSuggestRequest(message)) {
    if (!isTrustedSender(sender)) {
      throw new Error("AI_SUGGEST rejected for untrusted sender");
    }
    // Profile + BYOK are read here in the background; the popup never sees the key.
    return await suggestWithFallback(
      message.descriptors,
      message.job,
      message.serverBaseUrl,
    );
  }

  if (
    typeof message === "object" &&
    message !== null &&
    (message as Record<string, unknown>)["type"] === "HEALTH_CHECK"
  ) {
    if (!isTrustedSender(sender)) {
      throw new Error("HEALTH_CHECK rejected for untrusted sender");
    }
    return await fetchHealth();
  }

  throw new Error("unknown message type");
}

function registerBackgroundListener(): void {
  const runtime = getRuntime();
  if (runtime === null) {
    return;
  }
  try {
    runtime.onMessage.addListener((message, sender, sendResponse) => {
      void handleBackgroundMessage(message, sender)
        .then((result: unknown) => {
          sendResponse(result);
        })
        .catch((err: unknown) => {
          console.warn(`[rbg] background message failed: ${toMessage(err)}`);
          sendResponse(errorMessage(err, "BACKGROUND_MESSAGE_FAILED"));
        });
      return true;
    });
  } catch (err: unknown) {
    console.warn(`[rbg] background listener failed: ${toMessage(err)}`);
  }
}

registerBackgroundListener();

export { handleBackgroundMessage };
