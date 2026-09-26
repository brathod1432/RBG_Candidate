// client/src/content/describe.ts
// Rich field descriptors + job context for POST /fill (read-only DOM scan).
import type { FieldControlType, FieldDescriptor, JobContext } from "../types/index";
import {
  attrEscape,
  classifyField,
  cssEscape,
  getAriaText,
  getLabelText,
} from "./detect";

export const MAX_DESCRIPTORS = 100;
export const MAX_JOB_DESCRIPTION_CHARS = 3000;

const INPUT_TYPES: ReadonlySet<string> = new Set([
  "",
  "text",
  "email",
  "tel",
  "number",
  "url",
  "search",
]);
const SKIP_NAME_RE = /password|captcha|recaptcha|honeypot|csrf|token/i;

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function clean(text: string | null | undefined, max = 300): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (typeof html.getClientRects !== "function") {
    return true;
  }
  return html.getClientRects().length > 0;
}

function controlType(el: Control): FieldControlType | null {
  if (el instanceof HTMLSelectElement) {
    return el.multiple ? null : "select";
  }
  if (el instanceof HTMLTextAreaElement) {
    return "textarea";
  }
  const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
  if (!INPUT_TYPES.has(type)) {
    return null;
  }
  return type === "" ? "text" : (type as FieldControlType);
}

/** Selector that matches exactly this element inside `root`. */
export function uniqueSelector(root: ParentNode, el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id !== "") {
    const byId = `#${cssEscape(el.id)}`;
    if (root.querySelectorAll(byId).length === 1) {
      return byId;
    }
  }
  const name = el.getAttribute("name");
  if (name !== null && name !== "") {
    const byName = `${tag}[name="${attrEscape(name)}"]`;
    if (root.querySelectorAll(byName).length === 1) {
      return byName;
    }
  }
  const parts: string[] = [];
  let node: Element | null = el;
  while (node !== null && node.tagName.toLowerCase() !== "html") {
    const current: Element = node;
    const nodeTag = current.tagName.toLowerCase();
    if (current !== el && current.id !== "") {
      parts.unshift(`#${cssEscape(current.id)}`);
      break;
    }
    const parent: Element | null = current.parentElement;
    if (parent === null) {
      parts.unshift(nodeTag);
      break;
    }
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === current.tagName,
    );
    const index = sameTag.indexOf(current) + 1;
    parts.unshift(sameTag.length > 1 ? `${nodeTag}:nth-of-type(${index})` : nodeTag);
    node = parent;
  }
  return parts.join(" > ");
}

function fallbackLabel(el: Control): string {
  const legend = el.closest("fieldset")?.querySelector("legend");
  const legendText = clean(legend?.textContent);
  const own = el.textContent ?? "";
  const parentRaw = el.parentElement?.textContent ?? "";
  const parentText = clean(own !== "" ? parentRaw.replace(own, " ") : parentRaw, 160);
  return parentText !== "" ? parentText : legendText;
}

function optionsOf(el: Control): string[] {
  if (!(el instanceof HTMLSelectElement)) {
    return [];
  }
  const out: string[] = [];
  for (const option of Array.from(el.options)) {
    const text = clean(option.textContent, 200);
    if (option.disabled || option.value === "" || text === "") {
      continue;
    }
    out.push(text);
  }
  return out.slice(0, 300);
}

/** The label text of a radio/checkbox (for/id, wrapped label, or its value). */
function controlOptionLabel(root: ParentNode, el: HTMLInputElement): string {
  const id = el.id.trim();
  if (id !== "") {
    const label = root.querySelector(`label[for="${cssEscape(id)}"]`);
    const text = clean(label?.textContent, 200);
    if (text !== "") {
      return text;
    }
  }
  const wrap = el.closest("label");
  const wrapText = clean(wrap?.textContent, 200);
  if (wrapText !== "") {
    return wrapText;
  }
  return el.value;
}

/**
 * Describe every fillable, visible, enabled control (max MAX_DESCRIPTORS).
 * Read-only: never writes to the page.
 */
export function describeFields(root: ParentNode): FieldDescriptor[] {
  const out: FieldDescriptor[] = [];
  const usedIds = new Set<string>();
  const controls = Array.from(root.querySelectorAll("input, select, textarea"));
  let counter = 0;
  for (const node of controls) {
    if (out.length >= MAX_DESCRIPTORS) {
      break;
    }
    if (
      !(node instanceof HTMLInputElement) &&
      !(node instanceof HTMLSelectElement) &&
      !(node instanceof HTMLTextAreaElement)
    ) {
      continue;
    }
    const el: Control = node;
    const rawType = el instanceof HTMLInputElement ? (el.getAttribute("type") ?? "").trim().toLowerCase() : "";
    const isRadio = rawType === "radio";
    const isCheckbox = rawType === "checkbox";
    const type = isRadio || isCheckbox ? "select" : controlType(el);
    if (type === null || el.disabled || !isVisible(el)) {
      continue;
    }
    if (!isRadio && !isCheckbox && !(el instanceof HTMLSelectElement) && el.readOnly) {
      continue;
    }
    if (isRadio) {
      // One descriptor per radio GROUP: the first radio describes it, siblings are skipped.
      const groupName = el.getAttribute("name")?.trim() ?? "";
      if (groupName !== "") {
        const first = root.querySelector(`input[type="radio"][name="${attrEscape(groupName)}"]`);
        if (first !== el) {
          continue;
        }
      }
    }
    const idAttr = el.id.trim();
    const name = el.getAttribute("name")?.trim() ?? "";
    if (SKIP_NAME_RE.test(`${idAttr} ${name}`)) {
      continue;
    }
    counter += 1;
    let key = idAttr || name || `field-${counter}`;
    while (usedIds.has(key)) {
      key = `${key}-${counter}`;
    }
    usedIds.add(key);

    const placeholder = clean(el.getAttribute("placeholder"));
    let label = clean(`${getLabelText(root, el, idAttr)} ${getAriaText(root, el)}`);
    if (label === "") {
      label = fallbackLabel(el);
    }
    if (isRadio || isCheckbox) {
      // The fieldset legend is the question ("Gender", "Authorized to work?") —
      // it beats the parent label (which is one option's text).
      const legend = el.closest("fieldset")?.querySelector("legend");
      const legendText = clean(legend?.textContent);
      if (legendText !== "") {
        label = legendText;
      }
    }
    const maxAttr = el.getAttribute("maxlength");
    const maxLength = maxAttr !== null ? Number.parseInt(maxAttr, 10) : NaN;
    const profileKey =
      classifyField(`${label} ${name} ${idAttr} ${placeholder} ${type === "email" ? "email" : ""}`) ??
      undefined;

    let options: string[];
    if (isRadio) {
      // The group's radio labels are the options ("Male", "Female", …).
      const groupName = el.getAttribute("name")?.trim() ?? "";
      const group =
        groupName !== ""
          ? Array.from(root.querySelectorAll(`input[type="radio"][name="${attrEscape(groupName)}"]`))
          : [el];
      options = group.map((r) => controlOptionLabel(root, r as HTMLInputElement)).filter((t) => t !== "");
      options = Array.from(new Set(options)).slice(0, 300);
    } else if (isCheckbox) {
      // A checkbox is binary: the answer picks checked (Yes) or unchecked (No).
      options = ["Yes", "No"];
    } else {
      options = optionsOf(el);
    }

    const descriptor: FieldDescriptor = {
      id: key,
      selector: uniqueSelector(root, el),
      label,
      type,
      placeholder,
      options,
      required: el.required || el.getAttribute("aria-required") === "true",
    };
    if (Number.isFinite(maxLength) && maxLength > 0) {
      descriptor.maxLength = maxLength;
    }
    if (profileKey !== undefined) {
      descriptor.profileKey = profileKey;
    }
    out.push(descriptor);
  }
  return out;
}

const DESCRIPTION_SELECTORS = [
  '[class*="job-description" i]',
  '[id*="job-description" i]',
  '[data-testid*="description" i]',
  '[class*="jobDescription" i]',
  '[class*="description" i]',
  "article",
];

/** Title/company/description so long answers can be tailored. Read-only. */
export function extractJobContext(root: ParentNode, url: string): JobContext {
  const job: JobContext = { url };
  const h1 = clean(root.querySelector("h1")?.textContent, 200);
  const docTitle = clean(root.querySelector("title")?.textContent, 200);
  const title = h1 || docTitle;
  if (title !== "") {
    job.title = title;
  }
  const site = root.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
  if (site) {
    job.company = clean(site, 200);
  }
  for (const selector of DESCRIPTION_SELECTORS) {
    const el = root.querySelector(selector);
    if (el === null || el.querySelector("form, input, textarea, select") !== null) {
      continue;
    }
    const text = clean(el.textContent, MAX_JOB_DESCRIPTION_CHARS);
    if (text.length >= 80) {
      job.description = text;
      break;
    }
  }
  return job;
}
