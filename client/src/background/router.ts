// client/src/background/router.ts
import type { ScanRequestMessage, ScanResultMessage } from "../content/index";
import type { FillRequestMessage } from "../popup/chrome";
import type {
  FieldDescriptor,
  FieldMap,
  JobContext,
  Suggestion,
  UserProfile,
} from "../types/index";
import { fillCheckedFieldsInPage } from "../content/fill";
import { getApiKey, getFillPrefs, getProfile, getServerUrl } from "../utils/storage";
import { flattenSkills, planSkillValues } from "../profile/skills";
import { planLanguageValues } from "../profile/languages";

/** Default base URL of the local FastAPI server (covered by manifest host_permissions). */
export const DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:8000";
export const ANALYZE_PATH = "/analyze";
export const FILL_PATH = "/fill";
export const SERVER_NOT_RUNNING =
  "local AI server isn't running at 127.0.0.1:8000 — double-click scripts\\start-server.bat";
const FETCH_TIMEOUT_MS = 60000;

/**
 * Trusted contexts may trigger session-key access in background.
 * Only extension pages (popup: sender has no `tab`) are trusted.
 * Content scripts always arrive with `sender.tab` set and are untrusted:
 * the session key is never read for them and never sent to any tab.
 */
export const TRUSTED_CONTEXTS: ReadonlyArray<string> = ["popup"];

export interface ChromeMessageSender {
  tab?: { id?: number };
  url?: string;
  id?: string;
}

function ownExtensionId(): string | null {
  const scope = globalThis as unknown as { chrome?: { runtime?: { id?: string } } };
  const id = scope.chrome?.runtime?.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Trusted = one of this extension's own pages (popup, options, popup opened
 * in a tab). Content scripts report the web page URL and are never trusted.
 */
export function isTrustedSender(sender: ChromeMessageSender): boolean {
  const ownId = ownExtensionId();
  if (typeof sender.url === "string" && sender.url !== "") {
    if (ownId === null) {
      return sender.tab === undefined && sender.url.startsWith("chrome-extension://");
    }
    const fromOwnPage = sender.url.startsWith(`chrome-extension://${ownId}/`);
    const idMatches = sender.id === undefined || sender.id === ownId;
    return fromOwnPage && idMatches;
  }
  // No URL (older Chrome / tests): only tab-less senders are extension pages.
  return sender.tab === undefined;
}

export interface AnalyzeRequest {
  type: "ANALYZE";
  html: string;
  serverBaseUrl?: string;
}

export interface AnalyzeData {
  fields: Record<string, string>;
  stage: number;
  confidence: Record<string, number>;
}

export interface AnalyzeOnlineResult {
  type: "ANALYZE_RESULT";
  offline: false;
  data: AnalyzeData;
}

export interface AnalyzeOfflineResult {
  type: "ANALYZE_RESULT";
  offline: true;
  reason: string;
  values: Record<string, string>;
}

export type AnalyzeResult = AnalyzeOnlineResult | AnalyzeOfflineResult;

export interface FillResultMessage {
  type: "FILL_RESULT";
  filled: number;
  perAgent?: Record<string, number>;
}

export interface BackgroundErrorMessage {
  status: "error";
  message: string;
  code: string;
}

export interface AiSuggestRequest {
  type: "AI_SUGGEST";
  descriptors: FieldDescriptor[];
  job?: JobContext;
  serverBaseUrl?: string;
}

export interface FillStats {
  total_fields: number;
  profile_fields: number;
  ai_tasks: number;
  workers_used: number;
  models_used: string[];
  duration_ms: number;
}

export interface AiSuggestResult {
  type: "AI_SUGGEST_RESULT";
  offline: boolean;
  reason?: string;
  suggestions: Record<string, Suggestion>;
  stats?: FillStats;
}

export type BackgroundRequest =
  | ScanRequestMessage
  | FillRequestMessage
  | AnalyzeRequest
  | AiSuggestRequest;

export function toMessage(err: unknown): string {
  if (err instanceof Error && err.message !== "") {
    return err.message;
  }
  return "operation failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isScanRequestMessage(
  message: unknown,
): message is ScanRequestMessage {
  return isRecord(message) && message["type"] === "SCAN";
}

export function isFillRequestMessage(
  message: unknown,
): message is FillRequestMessage {
  if (!isRecord(message) || message["type"] !== "FILL") {
    return false;
  }
  return (
    typeof message["stage"] === "string" &&
    isRecord(message["values"]) &&
    isRecord(message["selectors"])
  );
}

export function isAnalyzeRequest(message: unknown): message is AnalyzeRequest {
  if (!isRecord(message) || message["type"] !== "ANALYZE") {
    return false;
  }
  if (typeof message["html"] !== "string") {
    return false;
  }
  const base = message["serverBaseUrl"];
  return base === undefined || typeof base === "string";
}

export function isAiSuggestRequest(message: unknown): message is AiSuggestRequest {
  if (!isRecord(message) || message["type"] !== "AI_SUGGEST") {
    return false;
  }
  if (!Array.isArray(message["descriptors"])) {
    return false;
  }
  const base = message["serverBaseUrl"];
  return base === undefined || typeof base === "string";
}

/** Local SCAN_RESULT guard (matches popup/chrome.ts + content/index.ts shapes). */
export function isScanResultMessage(
  message: unknown,
): message is ScanResultMessage {
  if (!isRecord(message) || message["type"] !== "SCAN_RESULT") {
    return false;
  }
  if (typeof message["snippet"] !== "string") {
    return false;
  }
  if (typeof message["url"] !== "string") {
    return false;
  }
  if (!isRecord(message["stage"]) || !isRecord(message["fields"])) {
    return false;
  }
  const stage = message["stage"] as Record<string, unknown>;
  return (
    typeof stage["stage"] === "string" &&
    typeof stage["confidence"] === "number" &&
    typeof stage["reason"] === "string"
  );
}

/** Exact-match profile lookup (mirrors popup/store.ts profileFieldValue). */
export function exactProfileValue(
  profile: UserProfile | null,
  field: string,
): string {
  if (profile === null) {
    return "";
  }
  switch (field) {
    case "fullName":
      return profile.fullName ?? "";
    case "email":
      return profile.email ?? "";
    case "phone":
      return profile.phone ?? "";
    case "headline":
      return profile.headline ?? "";
    case "summary":
      return profile.summary ?? "";
    default:
      return "";
  }
}

/**
 * Offline fallback: exact-match fill from profile.
 * Only fields present in `fields` with a non-empty profile value are kept.
 */
export function offlineExactMatch(
  profile: UserProfile | null,
  fields: FieldMap,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of Object.keys(fields)) {
    const value = exactProfileValue(profile, field);
    if (value !== "") {
      values[field] = value;
    }
  }
  return values;
}

// Re-exported so existing imports/tests keep working.
export { fillCheckedFieldsInPage } from "../content/fill";

// ── Minimal MV3 API surfaces (no @types/chrome dependency) ──────────────

interface TabsApi {
  query: (
    info: { active: boolean; currentWindow: boolean },
    callback: (tabs: Array<{ id?: number }>) => void,
  ) => void;
  sendMessage: (
    tabId: number,
    message: ScanRequestMessage | FillApplyMessage,
    callback: (response: unknown) => void,
  ) => void;
}

interface ScriptingApi {
  executeScript: (injection: {
    target: { tabId: number };
    func: typeof fillCheckedFieldsInPage;
    args: [{ values: Record<string, string>; selectors: FieldMap }];
  }) => Promise<Array<{ result?: unknown }>>;
}

export interface BackgroundChromeScope {
  tabs?: TabsApi;
  scripting?: ScriptingApi;
  runtime?: { lastError?: { message?: string } };
}

export function getBackgroundChrome(): BackgroundChromeScope | null {
  const scope = globalThis as unknown as {
    chrome?: BackgroundChromeScope;
  };
  if (!scope.chrome) {
    return null;
  }
  return scope.chrome;
}

function lastErrorMessage(scope: BackgroundChromeScope): string | null {
  return scope.runtime?.lastError?.message ?? null;
}

export function getActiveTabId(scope: BackgroundChromeScope): Promise<number> {
  if (!scope.tabs) {
    return Promise.reject(new Error("chrome.tabs unavailable"));
  }
  const tabs = scope.tabs;
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

/**
 * Forward SCAN to tab content. Sends only { type: "SCAN" } —
 * never the session key, never the API key.
 */
export async function forwardScanToTab(
  scope: BackgroundChromeScope,
  tabId: number,
): Promise<ScanResultMessage> {
  if (!scope.tabs) {
    throw new Error("chrome.tabs unavailable");
  }
  const tabs = scope.tabs;
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

export interface FillApplyMessage {
  type: "FILL_APPLY";
  values: Record<string, string>;
  selectors: FieldMap;
  animate?: FillRequestMessage["animate"];
  meta?: FillRequestMessage["meta"];
}

function sendFillToContent(
  scope: BackgroundChromeScope,
  tabId: number,
  message: FillApplyMessage,
): Promise<{ filled: number; perAgent?: Record<string, number> }> {
  const tabs = scope.tabs;
  if (!tabs) {
    return Promise.reject(new Error("chrome.tabs unavailable"));
  }
  return new Promise((resolve, reject) => {
    try {
      tabs.sendMessage(tabId, message, (response: unknown) => {
        const failed = lastErrorMessage(scope);
        if (failed !== null) {
          reject(new Error(failed));
          return;
        }
        if (isRecord(response) && response["type"] === "FILL_APPLIED" && typeof response["filled"] === "number") {
          const out: { filled: number; perAgent?: Record<string, number> } = { filled: response["filled"] };
          if (isRecord(response["perAgent"])) {
            out.perAgent = response["perAgent"] as Record<string, number>;
          }
          resolve(out);
          return;
        }
        reject(new Error("unexpected fill response"));
      });
    } catch (err: unknown) {
      reject(err);
    }
  });
}

/**
 * Fill checked fields. First asks the page's content script (already has DOM
 * access, no extra permission needed); falls back to scripting.executeScript
 * (needs activeTab, granted when the user clicks the toolbar icon).
 * Values + selectors only — never the session key or API key, never submits.
 */
export async function fillCheckedFields(
  scope: BackgroundChromeScope,
  tabId: number,
  message: FillRequestMessage,
): Promise<FillResultMessage> {
  try {
    const apply: FillApplyMessage = {
      type: "FILL_APPLY",
      values: message.values,
      selectors: message.selectors,
    };
    if (message.animate !== undefined) {
      apply.animate = message.animate;
    }
    if (message.meta !== undefined) {
      apply.meta = message.meta;
    }
    const result = await sendFillToContent(scope, tabId, apply);
    const out: FillResultMessage = { type: "FILL_RESULT", filled: result.filled };
    if (result.perAgent !== undefined) {
      out.perAgent = result.perAgent;
    }
    return out;
  } catch (err: unknown) {
    console.warn(`[rbg] content fill unavailable, injecting: ${toMessage(err)}`);
  }
  if (!scope.scripting) {
    throw new Error("chrome.scripting unavailable");
  }
  const results = await scope.scripting.executeScript({
    target: { tabId },
    func: fillCheckedFieldsInPage,
    args: [{ values: message.values, selectors: message.selectors }],
  });
  const first = results[0]?.result;
  const filled = typeof first === "number" ? first : 0;
  return { type: "FILL_RESULT", filled };
}

/**
 * The user's own NVIDIA key (decrypted here in the background only), or null
 * when none is saved — the server then uses its key from .env.
 */
export async function resolveByokApiKey(): Promise<string | null> {
  try {
    return await getApiKey();
  } catch (err: unknown) {
    console.warn(`[rbg] saved key unreadable: ${toMessage(err)}`);
    return null;
  }
}

function normalizeBaseUrl(raw: string | undefined): string {
  const base = (raw ?? DEFAULT_SERVER_BASE_URL).replace(/\/+$/, "");
  if (base === "") {
    throw new Error("server base URL is empty");
  }
  const isHttps = base.startsWith("https://");
  const isLocalHttp =
    base.startsWith("http://localhost") ||
    base.startsWith("http://127.0.0.1");
  if (!isHttps && !isLocalHttp) {
    throw new Error("server base URL must use https");
  }
  return base;
}

function isAnalyzeData(value: unknown): value is AnalyzeData {
  if (!isRecord(value)) {
    return false;
  }
  if (!isRecord(value["fields"]) || !isRecord(value["confidence"])) {
    return false;
  }
  return typeof value["stage"] === "number";
}

/**
 * HTTPS POST /analyze. Sends the user's own key when saved, else omits
 * api_key so the server falls back to the operator key.
 */
export async function postAnalyzeToServer(
  html: string,
  apiKey: string | null,
  serverBaseUrl?: string,
): Promise<AnalyzeData> {
  const base = normalizeBaseUrl(serverBaseUrl);
  const body: { html: string; api_key?: string } = { html };
  if (apiKey !== null && apiKey !== "") {
    body.api_key = apiKey;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${ANALYZE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`analyze failed with status ${response.status}`);
    }
    const parsed: unknown = await response.json();
    if (!isRecord(parsed) || parsed["status"] !== "ok") {
      throw new Error("malformed analyze response");
    }
    const data: unknown = parsed["data"];
    if (!isAnalyzeData(data)) {
      throw new Error("malformed analyze data");
    }
    return data;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("analyze request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server call with offline fallback: on any fetch failure, exact-match
 * fill values from the local profile are returned instead.
 */
export async function analyzeWithFallback(
  html: string,
  fields: FieldMap,
  serverBaseUrl?: string,
): Promise<AnalyzeResult> {
  let apiKey: string | null = null;
  try {
    apiKey = await resolveByokApiKey();
  } catch (err: unknown) {
    console.warn(`[rbg] byok resolve failed: ${toMessage(err)}`);
    apiKey = null;
  }
  try {
    const data = await postAnalyzeToServer(html, apiKey, serverBaseUrl);
    return { type: "ANALYZE_RESULT", offline: false, data };
  } catch (err: unknown) {
    const reason = toMessage(err);
    console.warn(`[rbg] analyze offline fallback: ${reason}`);
    try {
      const profile = await getProfile();
      const values = offlineExactMatch(profile, fields);
      return { type: "ANALYZE_RESULT", offline: true, reason, values };
    } catch (fallbackErr: unknown) {
      console.warn(`[rbg] offline profile read failed: ${toMessage(fallbackErr)}`);
      return { type: "ANALYZE_RESULT", offline: true, reason, values: {} };
    }
  }
}

// ── AI suggestions via POST /fill (coordinator + worker pool) ─────────────

const FIRST_NAME_RE = /first[\s_-]?name|given[\s_-]?name|forename|\bfname\b/i;
const LAST_NAME_RE = /last[\s_-]?name|surname|family[\s_-]?name|\blname\b/i;

/** Offline/local fallback: profile values for recognised fields only. */
export function localSuggestions(
  profile: UserProfile | null,
  descriptors: FieldDescriptor[],
  job?: JobContext,
): Record<string, Suggestion> {
  const out: Record<string, Suggestion> = {};
  // Skill fields: most job-relevant skills first, whole skills only, within the field's limit.
  const skillValues = planSkillValues(flattenSkills(profile?.details), descriptors, job);
  const languageValues = planLanguageValues(profile?.details?.languages ?? [], descriptors, job);
  const parts = (profile?.fullName ?? "").trim().split(/\s+/).filter((p) => p !== "");
  const personal = profile?.details?.personal ?? {};
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const d of descriptors) {
    const text = `${d.label} ${d.placeholder} ${d.id}`;
    let value = "";
    const skillValue = skillValues[d.id];
    if (skillValue !== undefined) {
      value = skillValue;
    } else if (languageValues[d.id] !== undefined) {
      value = languageValues[d.id];
    } else if (FIRST_NAME_RE.test(text)) {
      value = personal["first_name"] ?? parts[0] ?? "";
    } else if (LAST_NAME_RE.test(text)) {
      value = personal["last_name"] ?? (parts.length > 1 ? (parts[parts.length - 1] ?? "") : "");
    } else if (/middle[\s_-]?name/i.test(text)) {
      value = personal["middle_name"] ?? "";
    } else if (/linked\s?in/i.test(text)) {
      value = personal["linkedin"] ?? "";
    } else if (/git\s?hub/i.test(text)) {
      value = personal["github"] ?? "";
    } else if (/notice\s?period|\bnotice\b/i.test(text)) {
      // Notice-period default: structured profile value matched to the options first,
      // then "Immediate", then "2 weeks"; text inputs get "Immediately".
      const own = (personal["notice_period"] ?? "").trim();
      if (d.type === "select" || d.options.length > 0) {
        if (own !== "") {
          const exact = d.options.find((o) => o.toLowerCase() === own.toLowerCase());
          const partial = exact
            ?? d.options.find((o) => o.toLowerCase().includes(own.toLowerCase()) || own.toLowerCase().includes(o.toLowerCase()));
          if (partial !== undefined) value = partial;
        }
        if (value === "") {
          value = d.options.find((o) => /immediat/i.test(o))
            ?? d.options.find((o) => /2\s*weeks|two\s*weeks/i.test(o))
            ?? "";
        }
      } else if (d.type === "text" || d.type === "search") {
        // Tight boxes get a shorter synonym instead of a mid-word cut.
        if (own !== "") {
          value = own;
        } else {
          const ladder = ["Immediately", "Immediate", "Now"];
          value = ladder.find((v) => d.maxLength === undefined || d.maxLength >= v.length) ?? "Immediately";
        }
      }
    } else if (/\bgender\b|\bsex\b/i.test(text)) {
      // Gender: the profile value when set; offline cannot infer, so no default.
      const own = (personal["gender"] ?? "").trim();
      if (own !== "") {
        if (d.type === "select" || d.options.length > 0) {
          const exact = d.options.find((o) => o.toLowerCase() === own.toLowerCase());
          const matched = exact
            ?? d.options.find((o) => o.toLowerCase().includes(own.toLowerCase()) || own.toLowerCase().includes(o.toLowerCase()));
          if (matched !== undefined) value = matched;
        } else if (d.type === "text" || d.type === "search") {
          value = own;
        }
      }
    } else if (/(current(ly)? (working|work|employed))|do you (currently )?work|are you (currently )? (working|employed)/i.test(text)) {
      // "Currently working at X?" — No by default (new applicant) unless X is in the experience.
      const exp = (profile?.details?.experience ?? []).map((e) => (e.company ?? "").trim()).filter((c) => c !== "");
      const jobCompany = (job?.company ?? "").trim().toLowerCase();
      const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const worksThere = exp.some((c) => {
        const cn = c.toLowerCase();
        const inLabel =
          (cn.length >= 2 && new RegExp(`(?<![a-z0-9])${escapeRe(c)}(?![a-z0-9])`, "i").test(text)) ||
          // "Dell Technologies" matches a label saying "Dell" via the first token.
          (cn.includes(" ") && cn.split(" ")[0].length >= 3 && new RegExp(`(?<![a-z0-9])${escapeRe(cn.split(" ")[0])}(?![a-z0-9])`, "i").test(text));
        return (jobCompany !== "" && (cn === jobCompany || cn.includes(jobCompany) || jobCompany.includes(cn))) || inLabel;
      });
      if (d.type === "select" || d.options.length > 0) {
        const want = worksThere ? "yes" : "no";
        const matched = d.options.find((o) => o.toLowerCase() === want);
        if (matched !== undefined) value = matched;
      } else if (d.type === "text" || d.type === "search") {
        value = worksThere ? "Yes" : "No";
      }
    } else if (
      // Yes/no work-model questions — placed BEFORE the location-preference branch
      // (whose select-match would otherwise swallow them). Yes unless the stored work
      // mode explicitly contradicts ("Would you be able to work in a hybrid work model?" -> Yes).
      !/how often|how many|days (per week|from|in)/i.test(text) &&
      /\bhybrid\b|\bremote\b|\bon-?site\b|\boffice\b/i.test(text) &&
      (((d.type === "select" || d.options.length > 0) &&
          d.options.some((o) => ["yes", "no", "y", "n", "true", "false"].includes(o.toLowerCase()))) ||
        /^(would|could|do|are|can) you\b/i.test(d.label || d.placeholder || d.id))
    ) {
      const mode = (personal["work_mode"] ?? "").trim().toLowerCase();
      let works = true;
      if (mode.includes("only")) {
        const asked = ["hybrid", "remote", "on-site", "onsite", "on site"].filter((w) =>
          new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`, "i").test(text),
        );
        if (asked.length > 0 && !asked.some((w) => mode.includes(w))) {
          works = false;
        }
      }
      if (d.type === "select" || d.options.length > 0) {
        const want = works ? "yes" : "no";
        const matched = d.options.find((o) => o.toLowerCase() === want);
        if (matched !== undefined) value = matched;
      } else if (d.type === "text" || d.type === "search") {
        value = works ? "Yes" : "No";
      }
    } else if (/(way of working)|(work mode)|(working (model|arrangement|setup|preferences?))|remote|hybrid|on-?site|(preferences? regarding)|(preferred location)|(location preferences?)|(willing to work)/i.test(text)) {
      // Location / way-of-working preference: combined from the profile's location + work mode.
      const location = (personal["location"] ?? "").trim();
      const mode = (personal["work_mode"] ?? "").trim();
      if (location !== "" || mode !== "") {
        if (d.type === "select" || d.options.length > 0) {
          if (mode !== "") {
            const n = mode.toLowerCase();
            const exact = d.options.find((o) => o.toLowerCase() === n);
            const partial = exact
              ?? d.options.filter((o) => o.toLowerCase().includes(n) || n.includes(o.toLowerCase()));
            if (exact !== undefined) {
              value = exact;
            } else if (partial.length === 1) {
              value = partial[0];
            }
          }
        } else if (d.type === "text" || d.type === "search" || d.type === "textarea") {
          const parts: string[] = [];
          if (location !== "") parts.push(location.endsWith(".") ? location : location + ".");
          if (mode !== "") {
            const m = mode.charAt(0).toUpperCase() + mode.slice(1);
            parts.push(m.endsWith(".") ? m : m + ".");
          }
          value = parts.join(" ");
        }
      }
    } else if (/how often|how many days|days (per week|from|in)|frequency/i.test(text) && /\boffice\b|\bremote\b|\bhybrid\b|\bweek\b/i.test(text)) {
      // "How often ... from the office?" — the frequency from the stored work mode
      // ("hybrid (2-3 days from the office)" -> "2-3 days from the office"); selects get
      // the ONE best-matching option, and the hard default "2-3 days" when the mode has
      // no detail. Only one option is selected.
      const mode = (personal["work_mode"] ?? "").trim();
      const paren = /\(([^)]+)\)/.exec(mode);
      const detail = paren !== null ? paren[1].trim() : mode;
      const tokensOf = (s: string): Set<string> =>
        new Set(
          norm(s)
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length >= 2 || /^\d$/.test(w))
            .map((w) => (w.endsWith("s") && w.length > 2 ? w.slice(0, -1) : w)),
        );
      if (d.type === "select" || d.options.length > 0) {
        const wanted = detail !== "" ? detail : "2-3 days from the office";
        const wn = norm(wanted);
        let matched: string | undefined = d.options.find((o) => norm(o) === wn);
        if (matched === undefined) {
          matched = d.options.find((o) => {
            const on = norm(o);
            return on !== "" && (on.startsWith(wn) || wn.startsWith(on));
          });
        }
        if (matched === undefined) {
          // token overlap: whichever option shares the most words with the wanted answer
          const wt = tokensOf(wanted);
          let best: string | undefined;
          let bestScore = 0;
          for (const o of d.options) {
            const score = [...tokensOf(o)].filter((t) => wt.has(t)).length;
            if (score > bestScore) {
              best = o;
              bestScore = score;
            }
          }
          matched = best;
        }
        if (matched === undefined) {
          // hard default: whichever option says "2-3" days, else any days/week option
          matched = d.options.find((o) => /2\s*-?\s*3/i.test(o));
          if (matched === undefined) {
            matched = d.options.find((o) => /\bdays?\b|\bweek\b/i.test(o));
          }
        }
        if (matched !== undefined) value = matched;
      } else if (d.type === "text" || d.type === "search") {
        value = detail !== "" ? detail : "2-3 days from the office";
      }
    } else if (/work ?permit|visa|sponsorship/i.test(text)) {
      // Work-permit / visa questions: No — the candidate does not require support
      // (unless the profile explicitly says otherwise).
      const own = (personal["visa_sponsorship"] ?? "").trim().toLowerCase();
      const requires = own !== "" && /\b(yes|true|require[d]?|need(?:ed)?|sponsor(?:ed)?)\b/.test(own);
      if (d.type === "select" || d.options.length > 0) {
        if (d.options.some((o) => ["yes", "no", "y", "n", "true", "false"].includes(o.toLowerCase()))) {
          const want = requires ? "yes" : "no";
          const matched = d.options.find((o) => o.toLowerCase() === want);
          if (matched !== undefined) value = matched;
        }
      } else if (d.type === "text" || d.type === "search") {
        value = requires ? "Yes" : "No";
      }
    } else if (
      d.profileKey !== undefined &&
      d.type !== "select" &&
      // Long text boxes ("Tell us about yourself…") only ever take the summary.
      (d.type !== "textarea" || d.profileKey === "summary")
    ) {
      value = exactProfileValue(profile, d.profileKey);
    }
    out[d.id] = value !== ""
      ? { value, source: "profile", confidence: 1 }
      : { value: "", source: "none", confidence: 0 };
  }
  return out;
}

const STRUCTURED_KEYS = [
  "first_name", "middle_name", "last_name", "city", "country", "location", "address",
  "postal_code", "linkedin", "github", "website", "work_authorization", "visa_sponsorship",
  "willing_to_relocate", "work_mode", "notice_period", "gender", "available_from", "desired_salary",
] as const;

/** Structured fields from an imported Markdown CV (empty object when none). */
export function structuredProfile(profile: UserProfile | null): Record<string, unknown> {
  const d = profile?.details;
  if (d === undefined) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const key of STRUCTURED_KEYS) {
    const v = d.personal[key];
    if (typeof v === "string" && v.trim() !== "") {
      out[key] = v.trim().slice(0, 500);
    }
  }
  if (d.totalYears > 0) {
    out["years_experience"] = Math.min(80, d.totalYears);
  }
  const skills = flattenSkills(d);
  if (skills.length > 0) {
    // Candidate's own priority order; the server re-ranks per job.
    out["skills"] = skills;
  }
  const answers: Record<string, string> = {};
  for (const [q, a] of Object.entries(d.answers).slice(0, 60)) {
    if (a.trim() !== "") {
      answers[q.slice(0, 500)] = a.slice(0, 3000);
    }
  }
  if (Object.keys(answers).length > 0) {
    out["answers"] = answers;
  }
  return out;
}

/** Body for POST /fill (snake_case to match the FastAPI schema). */
export function buildFillPayload(
  descriptors: FieldDescriptor[],
  job: JobContext | undefined,
  profile: UserProfile | null,
  apiKey: string | null,
): Record<string, unknown> {
  const fields = descriptors.map((d) => {
    const f: Record<string, unknown> = {
      id: d.id,
      label: d.label.slice(0, 500),
      type: d.type,
      placeholder: d.placeholder.slice(0, 500),
      options: d.options.map((o) => o.slice(0, 500)),
      required: d.required,
    };
    if (d.maxLength !== undefined) {
      f["max_length"] = d.maxLength;
    }
    return f;
  });
  const body: Record<string, unknown> = {
    fields,
    profile: {
      full_name: profile?.fullName ?? null,
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      headline: profile?.headline ?? null,
      summary: profile?.summary ?? null,
      resume: profile?.resume ?? null,
      ...structuredProfile(profile),
      languages: (profile?.details?.languages ?? []).slice(0, 20).map((l) => ({
        language: (l.language ?? "").slice(0, 500),
        level: (l.level ?? "").slice(0, 500),
      })),
      companies: (profile?.details?.experience ?? []).map((e) => (e.company ?? "").trim()).filter((c) => c !== "").slice(0, 50),
    },
  };
  if (job !== undefined) {
    body["job"] = {
      title: job.title?.slice(0, 500) ?? null,
      company: job.company?.slice(0, 500) ?? null,
      url: job.url?.slice(0, 2000) ?? null,
      description: job.description?.slice(0, 8000) ?? null,
    };
  }
  if (apiKey !== null && apiKey !== "") {
    body["api_key"] = apiKey;
  }
  return body;
}

interface ServerAnswer {
  value: string;
  confidence: number;
  source: "profile" | "ai" | "none";
  model?: string | null;
  worker_id?: number | null;
  error?: string | null;
}

export function answersToSuggestions(answers: Record<string, unknown>): Record<string, Suggestion> {
  const out: Record<string, Suggestion> = {};
  for (const [id, raw] of Object.entries(answers)) {
    if (!isRecord(raw) || typeof raw["value"] !== "string") {
      continue;
    }
    const a = raw as unknown as ServerAnswer;
    const s: Suggestion = {
      value: a.value,
      source: a.source === "profile" || a.source === "ai" ? a.source : "none",
      confidence: typeof a.confidence === "number" ? a.confidence : 0,
    };
    if (typeof a.model === "string") {
      s.model = a.model;
    }
    if (typeof a.worker_id === "number") {
      s.workerId = a.worker_id;
    }
    if (typeof a.error === "string") {
      s.error = a.error;
    }
    out[id] = s;
  }
  return out;
}

export async function postFillToServer(
  body: Record<string, unknown>,
  serverBaseUrl?: string,
): Promise<{ suggestions: Record<string, Suggestion>; stats?: FillStats }> {
  const base = normalizeBaseUrl(serverBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 2);
  try {
    const response = await fetch(`${base}${FILL_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = isRecord(parsed) && typeof parsed["code"] === "string" ? parsed["code"] : "";
      throw new Error(`fill failed with status ${response.status}${code ? ` (${code})` : ""}`);
    }
    if (!isRecord(parsed) || parsed["status"] !== "ok" || !isRecord(parsed["data"])) {
      throw new Error("malformed fill response");
    }
    const data = parsed["data"] as Record<string, unknown>;
    if (!isRecord(data["answers"])) {
      throw new Error("malformed fill answers");
    }
    const result: { suggestions: Record<string, Suggestion>; stats?: FillStats } = {
      suggestions: answersToSuggestions(data["answers"] as Record<string, unknown>),
    };
    if (isRecord(data["stats"])) {
      result.stats = data["stats"] as unknown as FillStats;
    }
    return result;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("fill request timed out");
    }
    if (err instanceof TypeError) {
      // fetch() rejects with TypeError("Failed to fetch") when nothing listens on the port.
      throw new Error(SERVER_NOT_RUNNING);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the coordinator for values. Falls back to local profile matching when
 * the server is unreachable, so the extension still works offline.
 */
export async function suggestWithFallback(
  descriptors: FieldDescriptor[],
  job: JobContext | undefined,
  serverBaseUrl?: string,
): Promise<AiSuggestResult> {
  let profile: UserProfile | null = null;
  try {
    profile = await getProfile();
  } catch (err: unknown) {
    console.warn(`[rbg] profile read failed: ${toMessage(err)}`);
  }
  if (descriptors.length === 0) {
    return { type: "AI_SUGGEST_RESULT", offline: false, suggestions: {} };
  }
  let apiKey: string | null = null;
  try {
    apiKey = await resolveByokApiKey();
  } catch (err: unknown) {
    console.warn(`[rbg] byok resolve failed: ${toMessage(err)}`);
  }
  const local = localSuggestions(profile, descriptors, job);
  const prefs = await getFillPrefs().catch(() => null);
  if (prefs !== null && !prefs.aiProfileConsent) {
    // Consent off: the profile text never leaves the device — local matches only.
    return {
      type: "AI_SUGGEST_RESULT",
      offline: true,
      reason: "AI profile consent is off — only profile matches are filled",
      suggestions: local,
    };
  }
  const baseUrl = serverBaseUrl ?? (await getServerUrl().catch(() => null)) ?? undefined;
  try {
    const body = buildFillPayload(descriptors.slice(0, 100), job, profile, apiKey);
    const { suggestions, stats } = await postFillToServer(body, baseUrl);
    // Keep a local profile value when the server returned nothing for a field.
    const merged: Record<string, Suggestion> = { ...local };
    for (const [id, s] of Object.entries(suggestions)) {
      if (s.value !== "" || merged[id] === undefined || merged[id]?.value === "") {
        merged[id] = s;
      }
    }
    const result: AiSuggestResult = { type: "AI_SUGGEST_RESULT", offline: false, suggestions: merged };
    if (stats !== undefined) {
      result.stats = stats;
    }
    return result;
  } catch (err: unknown) {
    const reason = toMessage(err);
    console.warn(`[rbg] ai suggest offline fallback: ${reason}`);
    return { type: "AI_SUGGEST_RESULT", offline: true, reason, suggestions: local };
  }
}

// ── Server health (merged from the Prepare-tab work) ──────────────────────

export interface HealthResult {
  status: "ok" | "degraded" | "down";
  nvidiaApiKeyConfigured: boolean;
  workersActive: number;
  workersTotal: number;
  models: string[];
}

export const HEALTH_DOWN: HealthResult = {
  status: "down",
  nvidiaApiKeyConfigured: false,
  workersActive: 0,
  workersTotal: 0,
  models: [],
};

/** GET /health; never throws — an unreachable server is reported as "down". */
export async function fetchHealth(serverBaseUrl?: string): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const base = normalizeBaseUrl(serverBaseUrl ?? (await getServerUrl().catch(() => null)) ?? undefined);
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    if (!response.ok) return HEALTH_DOWN;
    const data: unknown = await response.json();
    if (!isRecord(data)) return HEALTH_DOWN;
    const status = data["status"];
    return {
      status: status === "ok" || status === "degraded" ? status : status === "down" ? "down" : "ok",
      nvidiaApiKeyConfigured: data["nvidiaApiKeyConfigured"] === true,
      workersActive: typeof data["workersActive"] === "number" ? data["workersActive"] : 0,
      workersTotal: typeof data["workersTotal"] === "number" ? data["workersTotal"] : 0,
      models: Array.isArray(data["models"]) ? data["models"].filter((m): m is string => typeof m === "string") : [],
    };
  } catch (_err: unknown) {
    return HEALTH_DOWN;
  } finally {
    clearTimeout(timer);
  }
}
