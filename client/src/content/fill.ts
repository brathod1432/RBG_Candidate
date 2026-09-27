// client/src/content/fill.ts
import type { FieldMap } from "../types/index";

/**
 * Page function injected via scripting.executeScript. Must be self-contained
 * (Chrome serialises it). Values only, never submits: no form.submit(),
 * no button click, no Enter key.
 *
 * Uses the native value setter so React/Vue-controlled inputs (Greenhouse,
 * Lever, Workday, LinkedIn) register the change, and matches <select>
 * options by value or visible text. After typing into a text input, a
 * typeahead suggestion list may appear (company/university/skills pickers) —
 * a fire-and-forget continuation clicks the matching option.
 */
export function fillCheckedFieldsInPage(args: {
  values: Record<string, string>;
  selectors: FieldMap;
}): number {
  let filled = 0;
  const norm = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

  /**
   * Typeahead pick: wait for the suggestion list that appears after typing and
   * click the matching option (exact > startsWith > includes; each comma-separated
   * segment is tried too). Fire-and-forget, bounded (~3s), clicks options only.
   */
  function scheduleTypeaheadPick(input: HTMLInputElement, typedValue: string): void {
    const wanted = typedValue.replace(/\s+/g, " ").trim().toLowerCase();
    if (wanted === "") return;
    const segments = wanted.split(",").map((s) => s.trim()).filter((s) => s !== "").reverse();
    const candidates: string[] = [wanted, ...segments].filter((v, i, a) => a.indexOf(v) === i);
    let attempts = 0;
    const findList = (): Element | null => {
      const refs = [input.getAttribute("aria-controls"), input.getAttribute("aria-owns")];
      for (const ref of refs) {
        if (!ref) continue;
        try {
          const list = document.getElementById(ref);
          if (list !== null && list.getClientRects().length > 0 && list.querySelector('[role="option"], li, a')) {
            return list;
          }
        } catch (_err: unknown) {
          // malformed id reference — ignore
        }
      }
      let node: HTMLElement | null = input.parentElement;
      let depth = 0;
      while (node !== null && depth < 4) {
        const candidates = node.querySelectorAll(
          '[role="listbox"], [class*="autocomplete"], [class*="typeahead"], [class*="suggestion"], [class*="dropdown"], ul[class*="menu"]',
        );
        for (const c of Array.from(candidates)) {
          const html = c as HTMLElement;
          if (
            html !== input &&
            html.getClientRects().length > 0 &&
            c.querySelector('[role="option"], li, a, div[class*="option"], div[class*="item"], span[class*="item"]')
          ) {
            return c;
          }
        }
        node = node.parentElement;
        depth += 1;
      }
      return null;
    };
    const tick = (): void => {
      attempts += 1;
      if (attempts > 10) return;
      const list = findList();
      if (list === null) {
        window.setTimeout(tick, 280);
        return;
      }
      const normText = (e: Element): string => (e.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const options = Array.from(
        list.querySelectorAll('[role="option"], li, a, div[class*="option"], div[class*="item"], span[class*="item"]'),
      );
      let target: Element | null = null;
      for (const candidate of candidates) {
        target =
          options.find((o) => normText(o) === candidate) ??
          options.find((o) => normText(o).startsWith(candidate)) ??
          options.find((o) => candidate.length >= 3 && normText(o).includes(candidate)) ??
          null;
        if (target !== null) break;
      }
      if (target === null) {
        window.setTimeout(tick, 280);
        return;
      }
      const opts = { bubbles: true, cancelable: true };
      target.dispatchEvent(new MouseEvent("pointerdown", opts));
      target.dispatchEvent(new MouseEvent("mousedown", opts));
      target.dispatchEvent(new MouseEvent("pointerup", opts));
      target.dispatchEvent(new MouseEvent("mouseup", opts));
      target.dispatchEvent(new MouseEvent("click", opts));
    };
    window.setTimeout(tick, 400);
  }

  /** Post-fill banner: what was filled, and a pointer to the Review tab
   * where defaults (applied where the profile was empty) can be changed. */
  function showFillBanner(count: number, applied: Array<[string, string]>): void {
    try {
      const host = document.createElement("div");
      host.setAttribute(
        "style",
        "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;background:#111827;color:#f9fafb;" +
          "font:12px/1.45 'Segoe UI',system-ui,sans-serif;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3);" +
          "padding:12px 30px 12px 14px;",
      );
      const title = document.createElement("div");
      title.textContent = `RBG filled ${count} field${count === 1 ? "" : "s"}`;
      title.setAttribute("style", "font-weight:600;margin-bottom:4px;");
      host.appendChild(title);
      for (const [name, val] of applied.slice(0, 8)) {
        const row = document.createElement("div");
        row.setAttribute("style", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0;");
        const strong = document.createElement("strong");
        strong.textContent = name;
        strong.setAttribute("style", "color:#93c5fd;");
        row.appendChild(strong);
        row.appendChild(document.createTextNode(` = ${val}`));
        host.appendChild(row);
      }
      const note = document.createElement("div");
      note.textContent =
        "Defaults were applied where your profile was empty — review each in the extension popup (Review tab) before submitting.";
      note.setAttribute("style", "margin-top:6px;opacity:.75;");
      host.appendChild(note);
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute(
        "style",
        "position:absolute;top:6px;right:8px;background:none;border:none;color:#f9fafb;font-size:14px;cursor:pointer;pointer-events:auto;line-height:1;padding:2px;",
      );
      close.addEventListener("click", () => host.remove());
      host.appendChild(close);
      document.body.appendChild(host);
      window.setTimeout(() => host.remove(), 12000);
    } catch (_err: unknown) {
      // the banner is best-effort — never blocks the fill
    }
  }

  const applied: Array<[string, string]> = [];
  for (const [field, value] of Object.entries(args.values)) {
    const selector = args.selectors[field];
    if (typeof selector !== "string" || selector === "" || value === "") {
      continue;
    }
    let el: Element | null = null;
    try {
      el = document.querySelector(selector);
    } catch (_err: unknown) {
      continue;
    }
    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLTextAreaElement) &&
      !(el instanceof HTMLSelectElement)
    ) {
      continue;
    }
    if (el.disabled) {
      continue;
    }
    const inputType =
      el instanceof HTMLInputElement ? (el.getAttribute("type") ?? "").trim().toLowerCase() : "";
    if (inputType === "radio") {
      // The descriptor points at the FIRST radio of the group; pick the option whose label matches.
      const groupName = el.getAttribute("name")?.trim() ?? "";
      const wanted = norm(value);
      const group =
        groupName !== ""
          ? Array.from(document.querySelectorAll(`input[type="radio"][name="${groupName}"]`))
          : [el];
      let target: HTMLInputElement | null = null;
      for (const r of group) {
        const radio = r as HTMLInputElement;
        if (radio.disabled) {
          continue;
        }
        const labelText = norm(
          document.querySelector(`label[for="${radio.id}"]`)?.textContent ??
            radio.closest("label")?.textContent ??
            radio.value,
        );
        if (labelText === wanted) {
          target = radio;
          break;
        }
      }
      if (target === null) {
        continue;
      }
      target.click();
      target.dispatchEvent(new Event("change", { bubbles: true }));
      applied.push([field, value]);
      filled += 1;
      continue;
    }
    if (inputType === "checkbox") {
      const cb = el as HTMLInputElement;
      const wanted = norm(value);
      const shouldCheck =
        wanted === "yes" || wanted === "y" || wanted === "true" || wanted === "checked";
      const shouldUncheck =
        wanted === "no" || wanted === "n" || wanted === "false" || wanted === "unchecked";
      if (!shouldCheck && !shouldUncheck) {
        continue; // not a yes/no answer — leave the box alone
      }
      if (cb.checked === shouldCheck) {
        applied.push([field, value]);
        filled += 1; // already in the answered state
        continue;
      }
      cb.click();
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      applied.push([field, value]);
      filled += 1;
      continue;
    }
    let next = value;
    if (el instanceof HTMLSelectElement) {
      const wanted = norm(value);
      const match = Array.from(el.options).find(
        (o) => norm(o.value) === wanted || norm(o.textContent ?? "") === wanted,
      );
      if (match === undefined) {
        continue;
      }
      next = match.value;
    }
    const proto =
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter !== undefined) {
      setter.call(el, next);
    } else {
      el.value = next;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    if (el instanceof HTMLInputElement && (inputType === "text" || inputType === "search" || inputType === "")) {
      // Typeahead: click the matching option from the list that appears (skills,
      // company, university pickers) — typing alone does not register the selection.
      scheduleTypeaheadPick(el, next);
    }
    applied.push([field, value]);
    filled += 1;
  }
  showFillBanner(filled, applied);
  return filled;
}
