// client/src/content/detect.ts
import type { FieldMap, StageHint } from "../types/index";

/** Hard cap for the prompt snippet sent to POST /analyze. */
export const PROMPT_SNIPPET_MAX_CHARS = 4000;

const URL_STAGE_RE = /(?:[?&#](?:stage|step|page)=|[/#-](?:stage|step|page|part)[-_ ]?)(\d{1,2})/i;
const HEADING_STAGE_RE = /(?:stage|step|page|part)\s*(\d{1,2})/i;
const SKIPPED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "date",
  "time",
  "month",
  "week",
  "password",
]);
const ALLOWED_INPUT_TYPES = new Set([
  "",
  "text",
  "email",
  "tel",
  "number",
  "search",
  "url",
]);
const EXCLUDED_SUBSTRINGS = [
  "company",
  "city",
  "state",
  "zip",
  "postal",
  "country",
  "password",
  "username",
];

function nowMs(): number {
  return Date.now();
}

function parseStageNumber(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const match = raw.match(/(\d{1,2})/);
  if (match === null) {
    return null;
  }
  const n = Number.parseInt(match[1] ?? "", 10);
  if (Number.isNaN(n) || n < 1 || n > 20) {
    return null;
  }
  return n;
}

export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export function attrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function textOf(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

/** Resolve label text via <label for=id> and wrapping <label>. Read-only. */
export function getLabelText(
  root: ParentNode,
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  id: string,
): string {
  const parts: string[] = [];
  if (id !== "") {
    const explicit = root.querySelector(`label[for="${attrEscape(id)}"]`);
    const explicitText = textOf(explicit);
    if (explicitText !== "") {
      parts.push(explicitText);
    }
  }
  const wrapping = el.closest("label");
  const wrappingText = textOf(wrapping);
  if (wrappingText !== "") {
    parts.push(wrappingText);
  }
  return parts.join(" ");
}

/** Resolve aria-label / aria-labelledby referenced text. Read-only. */
export function getAriaText(
  root: ParentNode,
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): string {
  const parts: string[] = [];
  const ariaLabel = el.getAttribute("aria-label")?.trim() ?? "";
  if (ariaLabel !== "") {
    parts.push(ariaLabel);
  }
  const labelledBy = el.getAttribute("aria-labelledby")?.trim() ?? "";
  if (labelledBy !== "") {
    const ids = labelledBy.split(/\s+/);
    for (const refId of ids) {
      if (refId === "") {
        continue;
      }
      const refEl = root.querySelector(`#${cssEscape(refId)}`);
      const refText = textOf(refEl);
      if (refText !== "") {
        parts.push(refText);
      }
    }
  }
  return parts.join(" ");
}

/**
 * Detect the current application stage.
 * Priority: [data-stage] attribute → URL number → heading fallback → "1".
 * Pure: reads only from `root` + `url`, never touches the live DOM.
 */
export function detectStage(root: ParentNode, url: string): StageHint {
  const marked = root.querySelector("[data-stage]");
  const fromAttr = parseStageNumber(marked?.getAttribute("data-stage") ?? null);
  if (fromAttr !== null) {
    return {
      stage: String(fromAttr),
      confidence: 1,
      reason: "data-stage",
      updatedAt: nowMs(),
    };
  }

  const urlMatch = url.match(URL_STAGE_RE);
  const fromUrl = parseStageNumber(urlMatch?.[1] ?? null);
  if (fromUrl !== null) {
    return {
      stage: String(fromUrl),
      confidence: 0.7,
      reason: "url",
      updatedAt: nowMs(),
    };
  }

  const headings = root.querySelectorAll("h1, h2, h3, legend");
  for (const heading of Array.from(headings)) {
    const headingMatch = heading.textContent?.match(HEADING_STAGE_RE) ?? null;
    const fromHeading = parseStageNumber(headingMatch?.[1] ?? null);
    if (fromHeading !== null) {
      return {
        stage: String(fromHeading),
        confidence: 0.5,
        reason: "heading",
        updatedAt: nowMs(),
      };
    }
  }

  return { stage: "1", confidence: 0.2, reason: "default", updatedAt: nowMs() };
}

export function classifyField(
  search: string,
): "fullName" | "email" | "phone" | "headline" | "summary" | null {
  const s = search.toLowerCase();
  if (s === "") {
    return null;
  }
  for (const excluded of EXCLUDED_SUBSTRINGS) {
    if (s.includes(excluded)) {
      return null;
    }
  }
  if (
    s.includes("e-mail") ||
    s.includes("email") ||
    s.includes("e mail")
  ) {
    return "email";
  }
  if (
    s.includes("phone") ||
    s.includes("mobile") ||
    s.includes("telephone") ||
    s.includes("contact number") ||
    /\btel\b/.test(s)
  ) {
    return "phone";
  }
  if (
    s.includes("headline") ||
    s.includes("job title") ||
    s.includes("desired title") ||
    s.includes("current title") ||
    s.includes("position") ||
    s === "title" ||
    s.includes(" title ")
  ) {
    return "headline";
  }
  if (
    s.includes("cover") ||
    s.includes("summary") ||
    s.includes("experience") ||
    s.includes("about you") ||
    s.includes("about yourself") ||
    s === "bio" ||
    s.includes("objective") ||
    s.includes("description")
  ) {
    return "summary";
  }
  if (
    s.includes("full name") ||
    s.includes("your name") ||
    s.includes("applicant name") ||
    s.includes("first name") ||
    s.includes("last name") ||
    s === "name" ||
    s.includes(" name")
  ) {
    return "fullName";
  }
  return null;
}

function buildSelector(
  root: ParentNode,
  tag: string,
  id: string,
  name: string,
): string {
  if (id !== "") {
    return `#${cssEscape(id)}`;
  }
  if (name !== "") {
    return `${tag}[name="${attrEscape(name)}"]`;
  }
  const sameTag = Array.from(root.querySelectorAll(tag));
  return `${tag}:nth-of-type(${sameTag.length > 0 ? sameTag.length : 1})`;
}

/**
 * Scan fillable fields and map profile keys to selectors.
 * Heuristics: <label> text → aria-label/labelledby → name/id/placeholder.
 * Pure + scan-only: reads attributes/textContent, never writes to the DOM.
 */
export function scanFields(root: ParentNode): FieldMap {
  const fields: FieldMap = {};
  const controls = root.querySelectorAll("input, select, textarea");
  let position = 0;

  for (const node of Array.from(controls)) {
    position += 1;
    if (
      !(node instanceof HTMLInputElement) &&
      !(node instanceof HTMLSelectElement) &&
      !(node instanceof HTMLTextAreaElement)
    ) {
      continue;
    }
    const el = node;
    const tag = el.tagName.toLowerCase();

    if (el instanceof HTMLInputElement) {
      const type = el.type.trim().toLowerCase();
      if (SKIPPED_INPUT_TYPES.has(type) || !ALLOWED_INPUT_TYPES.has(type)) {
        continue;
      }
      if (el.disabled) {
        continue;
      }
    } else if (el.disabled) {
      continue;
    }

    const id = el.id.trim();
    const name = el.getAttribute("name")?.trim() ?? "";
    const placeholder = el.getAttribute("placeholder")?.trim() ?? "";
    const inputType =
      el instanceof HTMLInputElement ? el.type.trim().toLowerCase() : "";

    const haystack = [
      getLabelText(root, el, id),
      getAriaText(root, el),
      name,
      id,
      placeholder,
      inputType === "email" ? "email" : "",
      inputType === "tel" ? "phone" : "",
    ]
      .join(" ")
      .trim();

    const key = classifyField(haystack);
    if (key === null || key in fields) {
      continue;
    }
    const base =
      id === "" && name === ""
        ? `${tag}:nth-of-type(${(position % 100) + 1})`
        : buildSelector(root, tag, id, name);
    fields[key] = base;
  }

  return fields;
}

/**
 * Build the prompt snippet forwarded to POST /analyze.
 * Always ≤ PROMPT_SNIPPET_MAX_CHARS chars; drops trailing fields first.
 */
export function buildPromptSnippet(
  stage: StageHint,
  fields: FieldMap,
): string {
  const header =
    `stage=${stage.stage} confidence=${stage.confidence} ` +
    `reason=${stage.reason}`;
  const entries = Object.entries(fields);
  const kept: FieldMap = {};
  let body = "{}";

  for (const [key, selector] of entries) {
    kept[key] = selector;
    const candidate = `${header}\nfields=${JSON.stringify(kept, null, 2) ?? "{}"}`;
    if (candidate.length > PROMPT_SNIPPET_MAX_CHARS) {
      delete kept[key];
      break;
    }
    body = JSON.stringify(kept, null, 2) ?? "{}";
  }

  let snippet = `${header}\nfields=${body}`;
  if (snippet.length > PROMPT_SNIPPET_MAX_CHARS) {
    snippet = `${snippet.slice(0, PROMPT_SNIPPET_MAX_CHARS - 3)}...`;
  }
  return snippet;
}
