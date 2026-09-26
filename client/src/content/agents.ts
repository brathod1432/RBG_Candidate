// client/src/content/agents.ts
//
import { pickTypeaheadOption } from "./typeahead";
//
// Visual typing agents: named, coloured mock cursors that work a shared queue
// of confirmed fields in parallel. Each agent independently takes the next
// field, glides to it, "clicks", and types the value letter by letter
// (native value setter + input events, so React/Vue forms register it).
//
// Safety: only values the user confirmed in Review are typed; nothing is
// submitted; Esc finishes instantly; prefers-reduced-motion fills instantly.
import {
  personasFor,
  travelMs,
  typingPlan,
  type AgentPersona,
  type TypingSpeed,
} from "../agents/palette";
import type { FieldMap } from "../types/index";
import { fillCheckedFieldsInPage } from "./fill";
import { logoSvg } from "../agents/logo";

export interface FieldMeta {
  label?: string;
  workerId?: number;
  model?: string;
}

export interface AgentFillArgs {
  values: Record<string, string>;
  selectors: FieldMap;
  meta?: Record<string, FieldMeta>;
  agents: number;
  speed: TypingSpeed;
}

export interface AgentFillReport {
  filled: number;
  perAgent: Record<string, number>;
  instant: boolean;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface FieldTask {
  id: string;
  el: Control;
  value: string;
  meta: FieldMeta;
}

export const OVERLAY_ID = "rbg-agents-overlay";

const norm = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return Math.max(4, Math.round(ms * (0.6 + Math.random() * 0.8)));
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_err: unknown) {
    return false;
  }
}

/** Set a value the way a real edit does (bypasses framework value trackers). */
export function setNativeValue(el: Control, value: string): void {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter !== undefined) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

function fireInput(el: Control, data: string | null, inputType: string): void {
  let ev: Event;
  try {
    ev = new InputEvent("input", { bubbles: true, inputType, data });
  } catch (_err: unknown) {
    ev = new Event("input", { bubbles: true });
  }
  el.dispatchEvent(ev);
}

function selectOptionValue(el: HTMLSelectElement, value: string): string | null {
  const wanted = norm(value);
  const match = Array.from(el.options).find(
    (o) => norm(o.value) === wanted || norm(o.textContent ?? "") === wanted,
  );
  return match === undefined ? null : match.value;
}

function resolveTasks(args: AgentFillArgs): FieldTask[] {
  const tasks: FieldTask[] = [];
  for (const [id, value] of Object.entries(args.values)) {
    const selector = args.selectors[id];
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
    tasks.push({ id, el, value, meta: args.meta?.[id] ?? {} });
  }
  return tasks;
}

// ── Overlay (shadow DOM, pointer-events: none) ───────────────────────────

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 12px/1.3 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
.cursor { position: fixed; left: 0; top: 0; will-change: transform; transition: opacity .5s; }
.cursor svg { display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,.35)); transition: transform .12s; }
.cursor.click svg { transform: scale(.86); }
.cursor .tag { position: absolute; left: 22px; top: -2px; display: flex; align-items: center; gap: 6px;
  white-space: nowrap; color: #fff; padding: 3px 9px 3px 3px; border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.18);
  transition: transform .18s ease, left .18s ease, top .18s ease; max-width: 260px; }
.cursor[data-state="typing"] .tag { left: 18px; top: -11px; }
.cursor.below .tag { left: 6px; top: 30px; }
.cursor .av { width: 18px; height: 18px; border-radius: 50%; background: rgba(255,255,255,.25);
  display: grid; place-items: center; font-weight: 800; font-size: 10px; flex: none; }
.cursor .txt { display: flex; flex-direction: column; min-width: 0; }
.cursor .txt b { font-weight: 700; font-size: 11.5px; line-height: 1.15; }
.cursor .txt i { font-style: normal; font-size: 10.5px; opacity: .92; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
.cursor .dots { display: none; gap: 2px; margin-left: 2px; }
.cursor[data-state="typing"] .dots { display: inline-flex; }
.cursor .dots span { width: 4px; height: 4px; border-radius: 50%; background: #fff; animation: bob 1s infinite ease-in-out; }
.cursor .dots span:nth-child(2) { animation-delay: .15s; }
.cursor .dots span:nth-child(3) { animation-delay: .3s; }
@keyframes bob { 0%, 80%, 100% { opacity: .35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
.cursor .ring { position: absolute; left: -12px; top: -12px; width: 24px; height: 24px;
  border-radius: 50%; border: 2px solid currentColor; opacity: 0; transform: scale(.3); }
.cursor.click .ring { animation: ripple .5s ease-out; }
@keyframes ripple { 0% { opacity: .9; transform: scale(.3); } 100% { opacity: 0; transform: scale(2); } }
.cursor.parked { opacity: 0; }
.box { position: fixed; border: 2px solid; border-radius: 7px; opacity: 0;
  transition: opacity .25s; box-sizing: border-box; }
.box.on { opacity: 1; }
.box.done { opacity: 0; transition: opacity 1s .35s; }
.box .tick { position: absolute; top: 50%; right: 6px; transform: translateY(-50%) scale(.4); opacity: 0;
  width: 18px; height: 18px; border-radius: 50%; background: #16a34a; display: grid; place-items: center;
  transition: transform .2s, opacity .2s; }
.box .tick svg { width: 11px; height: 11px; }
.box.done .tick { opacity: 1; transform: translateY(-50%) scale(1); }
.caret { position: fixed; left: 0; top: 0; width: 2px; height: 16px; border-radius: 1px; opacity: 0;
  animation: blink 1s steps(1) infinite; will-change: transform; }
.caret.on { opacity: 1; }
@keyframes blink { 50% { opacity: 0; } }
.panel { position: fixed; top: 14px; right: 14px; width: 250px; color: #f4f4f5;
  background: rgba(17,18,20,.86); backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.35); }
.panel .top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.panel .logo { display: inline-flex; }
.panel h4 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: -.01em; }
.panel .count { margin-left: auto; font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.panel .bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,.12); overflow: hidden; margin-bottom: 10px; }
.panel .bar i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #8b5cf6, #06b6d4, #f97316); transition: width .3s ease; }
.panel .row { display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: 8px; margin: 5px 0; }
.panel .av { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 10px; color: #fff; }
.panel .who { min-width: 0; }
.panel .who b { display: block; font-size: 11.5px; }
.panel .who small { display: block; font-size: 10.5px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel .n { font-size: 11px; font-variant-numeric: tabular-nums; opacity: .85; }
.panel .hint { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,.08); font-size: 10.5px; opacity: .7; }
.panel .finish { pointer-events: auto; margin-left: auto; height: 22px; padding: 0 9px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.1); color: #fff;
  font: 600 10.5px/1 inherit; cursor: pointer; }
.panel .finish:hover { background: rgba(255,255,255,.2); }
.panel.finished .finish { display: none; }
.panel kbd { font: 700 10px ui-monospace, Consolas, monospace; padding: 1px 5px; border-radius: 4px;
  border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); }
.panel.finished .bar i { background: #22c55e; }
`;

function arrowSvg(color: string, id: string): string {
  return (
    `<svg width="24" height="28" viewBox="0 0 24 28" aria-hidden="true">` +
    `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".82"/>` +
    `</linearGradient></defs>` +
    `<path d="M3 2.5 L3 22 L8.4 17.2 L12 25.2 L15.6 23.6 L12.1 15.8 L19.6 15.6 Z" ` +
    `fill="url(#g${id})" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>`
  );
}

class Overlay {
  readonly host: HTMLDivElement;
  readonly layer: HTMLDivElement;
  readonly panel: HTMLDivElement;

  constructor() {
    document.getElementById(OVERLAY_ID)?.remove();
    this.host = document.createElement("div");
    this.host.id = OVERLAY_ID;
    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.layer = document.createElement("div");
    this.layer.className = "layer";
    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.panel.setAttribute("data-role", "panel");
    root.append(style, this.layer);
    this.layer.append(this.panel);
    document.documentElement.append(this.host);
  }

  remove(): void {
    this.host.remove();
  }
}


// ── Caret position (mirror-element technique) ─────────────────────────────

const MIRROR_PROPS = [
  "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth",
  "borderBottomWidth", "borderLeftWidth", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize",
] as const;

let mirror: HTMLDivElement | null = null;

/** Viewport point just after the last typed character (inputs + textareas). */
export function caretPoint(el: Control): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const mid = { x: r.left + Math.min(28, r.width / 2), y: r.top + Math.min(r.height / 2, 18) };
  if (el instanceof HTMLSelectElement) {
    return mid;
  }
  try {
    const cs = window.getComputedStyle(el);
    if (mirror === null || !mirror.isConnected) {
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      document.documentElement.append(mirror);
    }
    const m = mirror.style;
    for (const prop of MIRROR_PROPS) {
      m[prop] = cs[prop];
    }
    const isInput = el instanceof HTMLInputElement;
    m.position = "fixed";
    m.left = "-9999px";
    m.top = "0";
    m.visibility = "hidden";
    m.whiteSpace = isInput ? "pre" : "pre-wrap";
    m.overflowWrap = isInput ? "normal" : "break-word";
    mirror.textContent = el.value;
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.append(marker);
    const x = r.left + marker.offsetLeft - el.scrollLeft;
    const lineH = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.25 || 16;
    const y = isInput
      ? r.top + r.height / 2
      : r.top + marker.offsetTop - el.scrollTop + lineH / 2;
    return {
      x: Math.max(r.left + 4, Math.min(x, r.right - 8)),
      y: Math.max(r.top + 6, Math.min(y, r.bottom - 6)),
    };
  } catch (_err: unknown) {
    return mid;
  }
}

// ── One agent ────────────────────────────────────────────────────────────

class TypingAgent {
  x: number;
  y: number;
  done = 0;
  state: "idle" | "moving" | "typing" | "parked" = "idle";
  private target: Control | null = null;
  private tween: { fx: number; fy: number; start: number; dur: number; resolve: () => void } | null = null;
  private readonly cursor: HTMLDivElement;
  private readonly status: HTMLElement;
  private readonly box: HTMLDivElement;
  private readonly tag: HTMLElement;
  private readonly caret: HTMLDivElement;
  /** Vertical label offset to avoid overlapping another agent's label. */
  labelShift = 0;
  currentLabel = "";

  constructor(
    readonly persona: AgentPersona,
    readonly index: number,
    overlay: Overlay,
  ) {
    this.x = window.innerWidth - 90;
    this.y = 90 + index * 46;
    this.cursor = document.createElement("div");
    this.cursor.className = "cursor";
    this.cursor.style.color = persona.color;
    this.cursor.setAttribute("data-agent", persona.name);
    this.cursor.setAttribute("data-state", "idle");
    this.cursor.innerHTML =
      `<div class="ring"></div>${arrowSvg(persona.color, `${index}`)}` +
      `<div class="tag" style="background:${persona.color}"><span class="av"></span>` +
      `<span class="txt"><b></b><i></i></span><span class="dots"><span></span><span></span><span></span></span></div>`;
    const name = this.cursor.querySelector(".tag b");
    if (name !== null) {
      name.textContent = persona.name;
    }
    const av = this.cursor.querySelector(".tag .av");
    if (av !== null) {
      av.textContent = persona.name.charAt(0);
    }
    this.tag = this.cursor.querySelector(".tag") as HTMLElement;
    this.status = this.cursor.querySelector(".tag i") as HTMLElement;
    this.status.textContent = "ready";
    this.box = document.createElement("div");
    this.box.className = "box";
    this.box.style.borderColor = persona.color;
    this.box.style.boxShadow = `0 0 0 3px ${persona.color}33`;
    this.caret = document.createElement("div");
    this.caret.className = "caret";
    this.caret.style.background = persona.color;
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.innerHTML =
      '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4 5 8.8 9.6 3.6" fill="none" ' +
      'stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    this.box.append(tick);
    overlay.layer.append(this.box, this.caret, this.cursor);
  }

  setStatus(text: string, state: TypingAgent["state"]): void {
    this.status.textContent = text;
    this.state = state;
    this.cursor.setAttribute("data-state", state);
  }

  private targetPoint(el: Element): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(28, r.width / 2), y: r.top + Math.min(r.height / 2, 18) };
  }

  /** Called every animation frame. */
  frame(now: number): void {
    if (this.tween !== null && this.target !== null) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const p = this.targetPoint(this.target);
      this.x = this.tween.fx + (p.x - this.tween.fx) * e;
      this.y = this.tween.fy + (p.y - this.tween.fy) * e;
      if (t >= 1) {
        const done = this.tween.resolve;
        this.tween = null;
        done();
      }
    } else if (this.target !== null && this.state === "typing") {
      // Follow the text caret (and the field while the page scrolls), eased.
      const c = caretPoint(this.target);
      this.x += (c.x + 2 - this.x) * 0.45;
      this.y += (c.y - 2 - this.y) * 0.45;
      this.caret.style.transform = `translate(${Math.round(c.x)}px, ${Math.round(c.y - 8)}px)`;
      this.caret.classList.add("on");
      const r = this.target.getBoundingClientRect();
      // No room for the name tag after the text → drop it below the field.
      const below = c.x + 190 > r.right && !(this.target instanceof HTMLSelectElement);
      this.cursor.classList.toggle("below", below);
    }
    if (this.state !== "typing") {
      this.caret.classList.remove("on");
      this.cursor.classList.remove("below");
    }
    this.cursor.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
    this.tag.style.transform = `translateY(${this.labelShift}px)`;
    if (this.target !== null && this.box.classList.contains("on")) {
      const r = this.target.getBoundingClientRect();
      this.box.style.left = `${r.left - 3}px`;
      this.box.style.top = `${r.top - 3}px`;
      this.box.style.width = `${r.width + 6}px`;
      this.box.style.height = `${r.height + 6}px`;
    }
  }

  moveTo(el: Control, speed: TypingSpeed, instant: () => boolean): Promise<void> {
    this.resetBox();
    this.target = el;
    if (instant()) {
      return Promise.resolve();
    }
    const p = this.targetPoint(el);
    const dist = Math.hypot(p.x - this.x, p.y - this.y);
    return new Promise((resolve) => {
      this.tween = { fx: this.x, fy: this.y, start: performance.now(), dur: travelMs(dist, speed), resolve };
    });
  }

  async click(): Promise<void> {
    this.cursor.classList.remove("click");
    void this.cursor.offsetWidth;
    this.cursor.classList.add("click");
    this.box.classList.remove("done");
    this.box.classList.add("on");
    await sleep(120);
  }

  finishField(): void {
    this.box.classList.add("done");
    this.done += 1;
  }

  /** Hide the highlight instantly before gliding to the next field. */
  resetBox(): void {
    this.box.className = "box";
  }

  park(): void {
    this.resetBox();
    this.caret.classList.remove("on");
    this.target = null;
    this.tween = null;
    this.setStatus(`done · ${this.done} field${this.done === 1 ? "" : "s"}`, "parked");
    this.cursor.classList.add("parked");
  }
}

// ── Engine ───────────────────────────────────────────────────────────────

function describeMeta(meta: FieldMeta): string {
  if (meta.workerId !== undefined) {
    const model = meta.model ? ` · ${meta.model.split("/").pop() ?? meta.model}` : "";
    return `worker ${meta.workerId}${model}`;
  }
  return "profile";
}

async function typeInto(
  agent: TypingAgent,
  task: FieldTask,
  speed: TypingSpeed,
  instant: () => boolean,
): Promise<boolean> {
  const { el, value } = task;
  if (!el.isConnected || el.disabled) {
    return false;
  }
  if (el instanceof HTMLSelectElement) {
    const optionValue = selectOptionValue(el, value);
    if (optionValue === null) {
      return false;
    }
    agent.setStatus(`choosing “${value.slice(0, 24)}”`, "typing");
    if (!instant()) {
      await sleep(jitter(260));
    }
    setNativeValue(el, optionValue);
    fireInput(el, null, "insertReplacementText");
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: false }));
    return true;
  }

  agent.setStatus(`typing · ${describeMeta(task.meta)}`, "typing");
  if (el.value !== "") {
    setNativeValue(el, "");
    fireInput(el, null, "deleteContentBackward");
  }
  const plan = typingPlan(value.length, speed);
  let typed = 0;
  while (typed < value.length) {
    if (!el.isConnected) {
      return false;
    }
    const step = instant() ? value.length - typed : plan.chunk;
    const next = Math.min(value.length, typed + step);
    const piece = value.slice(typed, next);
    setNativeValue(el, value.slice(0, next));
    fireInput(el, piece, "insertText");
    typed = next;
    if (typed < value.length && !instant()) {
      const pause = /[.,!?]\s*$/.test(piece) ? plan.delayMs * 4 : plan.delayMs;
      await sleep(jitter(pause));
    }
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: false }));
  return true;
}

function isInView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.top >= 40 && r.bottom <= window.innerHeight - 40;
}

let running: Promise<AgentFillReport> | null = null;

/**
 * Run the typing agents over the confirmed values. Resolves with how many
 * fields were filled once every agent has finished (or Esc finished them).
 */
export function runAgentFill(args: AgentFillArgs): Promise<AgentFillReport> {
  if (running !== null) {
    return running;
  }
  running = runInternal(args).finally(() => {
    running = null;
  });
  return running;
}

async function runInternal(args: AgentFillArgs): Promise<AgentFillReport> {
  const tasks = resolveTasks(args);
  if (tasks.length === 0) {
    return { filled: 0, perAgent: {}, instant: true };
  }
  if (prefersReducedMotion()) {
    const filled = fillCheckedFieldsInPage({ values: args.values, selectors: args.selectors });
    return { filled, perAgent: {}, instant: true };
  }

  const overlay = new Overlay();
  const personas = personasFor(Math.min(args.agents, tasks.length));
  const agents = personas.map((p, i) => new TypingAgent(p, i, overlay));
  let finishNow = false;
  const instant = (): boolean => finishNow;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      finishNow = true;
    }
  };
  window.addEventListener("keydown", onKey, true);

  const renderPanel = (): void => {
    const doneCount = agents.reduce((n, a) => n + a.done, 0);
    const left = tasks.length - doneCount;
    overlay.panel.innerHTML = "";
    const top = document.createElement("div");
    top.className = "top";
    top.innerHTML = `<span class="logo">${logoSvg(18, "rgba(17,18,20,.9)")}</span>`;
    const h = document.createElement("h4");
    h.textContent = `${agents.length} agents filling`;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${doneCount}/${tasks.length}`;
    top.append(h, count);
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.round((doneCount / tasks.length) * 100)}%`;
    bar.append(fill);
    overlay.panel.append(top, bar);
    for (const a of agents) {
      const row = document.createElement("div");
      row.className = "row";
      row.setAttribute("data-agent-row", a.persona.name);
      const av = document.createElement("span");
      av.className = "av";
      av.style.background = a.persona.color;
      av.textContent = a.persona.name.charAt(0);
      const who = document.createElement("span");
      who.className = "who";
      const nm = document.createElement("b");
      nm.textContent = a.persona.name;
      const sm = document.createElement("small");
      sm.textContent = a.state === "parked" ? "done" : a.currentLabel || "starting…";
      who.append(nm, sm);
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = a.state === "parked" ? `done · ${a.done}` : `${a.done}`;
      row.append(av, who, n);
      overlay.panel.append(row);
    }
    const hint = document.createElement("div");
    hint.className = "hint";
    if (finishNow) {
      hint.textContent = "Finishing instantly…";
    } else {
      const k = document.createElement("kbd");
      k.textContent = "Esc";
      hint.append(k, document.createTextNode(` or `));
      const finish = document.createElement("button");
      finish.type = "button";
      finish.className = "finish";
      finish.textContent = "Finish now";
      finish.addEventListener("click", () => {
        finishNow = true;
        renderPanel();
      });
      hint.append(finish);
      const tail = document.createElement("span");
      tail.textContent = `${left} left`;
      tail.style.marginLeft = "4px";
      hint.insertBefore(tail, hint.firstChild);
      hint.insertBefore(document.createTextNode(" · "), k);
    }
    overlay.panel.append(hint);
  };

  let raf = 0;
  const loop = (now: number): void => {
    // Stack labels of agents whose cursors are close together so names never overlap.
    for (let i = 0; i < agents.length; i += 1) {
      const a = agents[i];
      if (a === undefined) continue;
      let shift = 0;
      for (let j = 0; j < i; j += 1) {
        const b = agents[j];
        if (b !== undefined && b.state !== "parked" && Math.abs(a.x - b.x) < 150 && Math.abs(a.y + shift - b.y - b.labelShift) < 28) {
          shift += 30;
        }
      }
      a.labelShift += (shift - a.labelShift) * 0.25;
      a.frame(now);
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  renderPanel();

  // Shared queue: each agent independently pulls the next field.
  const queue = [...tasks];
  let scrollLock: Promise<void> = Promise.resolve();
  let filled = 0;

  const work = async (agent: TypingAgent): Promise<void> => {
    await sleep(agent.index * 140); // staggered start looks natural
    for (let task = queue.shift(); task !== undefined; task = queue.shift()) {
      const current = task;
      const label = (current.meta.label ?? current.id).slice(0, 32);
      agent.currentLabel = label;
      agent.setStatus(`→ ${label}`, "moving");
      renderPanel();
      if (!isInView(current.el) && !finishNow) {
        const mine = scrollLock.then(async () => {
          if (!isInView(current.el)) {
            current.el.scrollIntoView({ block: "center", behavior: "smooth" });
            await sleep(420);
          }
        });
        scrollLock = mine.catch(() => undefined);
        await mine;
      }
      await agent.moveTo(current.el, args.speed, instant);
      await agent.click();
      try {
        if (await typeInto(agent, current, args.speed, instant)) {
          filled += 1;
        }
      } catch (err: unknown) {
        console.warn(`[rbg] agent ${agent.persona.name} failed on ${current.id}: ${String(err)}`);
      }
      // Typeahead: sites that show a suggestion list after typing (skills, company,
      // university pickers) need an option clicked — typing alone is not a selection.
      if (!finishNow && current.el instanceof HTMLInputElement) {
        const t = (current.el.getAttribute("type") ?? "").trim().toLowerCase();
        if (t === "text" || t === "search" || t === "") {
          try {
            await pickTypeaheadOption(current.el, current.value);
          } catch (_err: unknown) {
            // best effort — never blocks the fill on a typeahead failure
          }
        }
      }
      agent.finishField();
      renderPanel();
      if (!finishNow) {
        await sleep(jitter(260)); // let the ✓ show on the finished field
      }
    }
    agent.park();
    renderPanel();
  };

  try {
    await Promise.all(agents.map((a) => work(a)));
  } finally {
    window.removeEventListener("keydown", onKey, true);
  }
  const perAgent: Record<string, number> = {};
  for (const a of agents) {
    perAgent[a.persona.name] = a.done;
  }
  renderPanel();
  overlay.panel.classList.add("finished");
  const h = overlay.panel.querySelector("h4");
  if (h !== null) {
    h.textContent = `Filled ${filled} field${filled === 1 ? "" : "s"}`;
  }
  const hint = overlay.panel.querySelector(".hint");
  if (hint !== null) {
    hint.textContent = "Review the page, then submit it yourself.";
  }
  overlay.host.setAttribute("data-finished", "true");
  setTimeout(() => {
    cancelAnimationFrame(raf);
    overlay.remove();
  }, 3200);
  return { filled, perAgent, instant: finishNow };
}
