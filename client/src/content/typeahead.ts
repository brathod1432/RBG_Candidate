// client/src/content/typeahead.ts
// After a value is typed into a text input, sites with typeahead autocomplete
// (Workday, Greenhouse, Lever, SAP, skills pickers, company/university searches)
// often need an option CLICKED from the list that appears — typing alone does not
// register the selection. Bounded: waits ~3s max, only clicks an option that
// matches the typed value (or one segment of a comma-separated list).

export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const norm = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An open suggestion list near the input (ARIA-referenced first, then nearby containers). */
function findOpenList(input: Control): Element | null {
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
}

function clickOption(target: Element): void {
  const opts = { bubbles: true, cancelable: true };
  target.dispatchEvent(new MouseEvent("pointerdown", opts));
  target.dispatchEvent(new MouseEvent("mousedown", opts));
  target.dispatchEvent(new MouseEvent("pointerup", opts));
  target.dispatchEvent(new MouseEvent("mouseup", opts));
  target.dispatchEvent(new MouseEvent("click", opts));
}

/**
 * Wait for the suggestion list that appears after typing, and click the option
 * matching the typed value (exact > startsWith > includes). For comma-separated
 * values (skill lists) each segment is tried too, last-typed first.
 */
export async function pickTypeaheadOption(el: Control, typedValue: string): Promise<boolean> {
  const wanted = norm(typedValue);
  if (wanted === "") return false;
  const segments = wanted.split(",").map((s) => s.trim()).filter((s) => s !== "").reverse();
  const candidates: string[] = [wanted, ...segments].filter((v, i, a) => a.indexOf(v) === i);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const list = findOpenList(el);
    if (list !== null) {
      const options = Array.from(
        list.querySelectorAll('[role="option"], li, a, div[class*="option"], div[class*="item"], span[class*="item"]'),
      );
      const byText = (e: Element): string => norm(e.textContent ?? "");
      let target: Element | null = null;
      for (const candidate of candidates) {
        target =
          options.find((o) => byText(o) === candidate) ??
          options.find((o) => byText(o).startsWith(candidate)) ??
          options.find((o) => candidate.length >= 3 && byText(o).includes(candidate)) ??
          null;
        if (target !== null) break;
      }
      if (target !== null) {
        clickOption(target);
        return true;
      }
    }
    await sleep(280);
  }
  return false;
}
