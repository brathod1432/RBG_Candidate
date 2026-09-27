// client/src/agents/palette.ts
// Named, coloured typing agents (shared by popup settings and content overlay).

export interface AgentPersona {
  name: string;
  color: string;
  /** Short role shown in the popup preview. */
  role: string;
}

export const AGENT_PALETTE: ReadonlyArray<AgentPersona> = [
  { name: "Nova", color: "#8B5CF6", role: "names & contact" },
  { name: "Echo", color: "#06B6D4", role: "short answers" },
  { name: "Blaze", color: "#F97316", role: "long answers" },
  { name: "Sage", color: "#22C55E", role: "dropdowns" },
  { name: "Ruby", color: "#EF4444", role: "overflow" },
  { name: "Atlas", color: "#EAB308", role: "overflow" },
];

export const MIN_AGENTS = 1;
// The user's cap: 5 is the maximum crew size the AI may use ("5 is the max that
// I can increase"). The palette keeps a sixth persona in reserve.
export const MAX_AGENTS = Math.min(5, AGENT_PALETTE.length);
export const DEFAULT_AGENTS = 3;

export type TypingSpeed = "slow" | "normal" | "fast";

export interface FillPrefs {
  animate: boolean;
  agents: number;
  speed: TypingSpeed;
  /** "Let AI workers use my profile" — when false, the profile text never leaves the device. */
  aiProfileConsent: boolean;
}

export const DEFAULT_FILL_PREFS: FillPrefs = {
  animate: true,
  agents: DEFAULT_AGENTS,
  speed: "normal",
  aiProfileConsent: true,
};

export function clampAgents(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : DEFAULT_AGENTS;
  return Math.min(MAX_AGENTS, Math.max(MIN_AGENTS, v));
}

export function normalizeFillPrefs(raw: unknown): FillPrefs {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_FILL_PREFS };
  }
  const r = raw as Record<string, unknown>;
  const speed = r["speed"] === "slow" || r["speed"] === "fast" ? r["speed"] : "normal";
  return {
    animate: r["animate"] !== false,
    agents: clampAgents(r["agents"]),
    speed,
    aiProfileConsent: r["aiProfileConsent"] !== false,
  };
}

export function personasFor(count: number): AgentPersona[] {
  return AGENT_PALETTE.slice(0, clampAgents(count));
}

/** Base per-character delay (ms) for each speed. */
export const CHAR_DELAY_MS: Record<TypingSpeed, number> = {
  slow: 70,
  normal: 32,
  fast: 12,
};

/** Upper bound on how long one field may take to type (ms). */
export const MAX_FIELD_TYPING_MS: Record<TypingSpeed, number> = {
  slow: 9000,
  normal: 5000,
  fast: 2500,
};

/**
 * How to type `length` characters: `chunk` chars per tick every `delayMs`.
 * Long texts type several characters per tick so a cover letter never takes
 * longer than MAX_FIELD_TYPING_MS.
 */
export function typingPlan(length: number, speed: TypingSpeed): { chunk: number; delayMs: number; ticks: number } {
  const delayMs = CHAR_DELAY_MS[speed];
  if (length <= 0) {
    return { chunk: 1, delayMs, ticks: 0 };
  }
  const maxTicks = Math.max(1, Math.floor(MAX_FIELD_TYPING_MS[speed] / delayMs));
  const chunk = Math.max(1, Math.ceil(length / maxTicks));
  return { chunk, delayMs, ticks: Math.ceil(length / chunk) };
}

/** Cursor travel time (ms) for a pixel distance: quick for short hops, capped. */
export function travelMs(distancePx: number, speed: TypingSpeed): number {
  const base = speed === "slow" ? 520 : speed === "fast" ? 180 : 320;
  return Math.round(Math.min(base * 2.2, base + distancePx * 0.35));
}
