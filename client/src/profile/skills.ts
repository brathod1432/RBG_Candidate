// client/src/profile/skills.ts
// Skills in priority order, ranked against the job, fitted into form limits.
// The server does the same (server/agents/relevance.py) with more signals;
// this lighter copy keeps skill fields filled when the local server is offline.
import type { FieldDescriptor, JobContext, ProfileDetails } from "../types/index";

export const MAX_SKILLS = 500;
export const MAX_SKILL_CHARS = 120;

const norm = (s: string): string => s.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
const PAREN = /\s*\(([^)]*)\)/g;
const VERSION_TAIL = /(?:\s+(?:v?\d+(?:\.\d+)*|\(\s*v?\d+(?:\.\d+)*\s*\)))+$/;

/** "Python 3.11" / "Python" → "python"; "Kubernetes (working knowledge)" → "kubernetes". */
export function baseKey(skill: string): string {
  const s = skill.replace(PAREN, "").trim();
  return norm(s.replace(VERSION_TAIL, "").trim() || s);
}

/** Skill categories in the user's own order (chrome.storage sorts object keys, so use skillOrder). */
export function orderedSkillEntries(details: Pick<ProfileDetails, "skills" | "skillOrder">): Array<[string, string[]]> {
  const keys = Object.keys(details.skills);
  const order = (details.skillOrder ?? []).filter((k) => k in details.skills);
  const rest = keys.filter((k) => !order.includes(k));
  return [...order, ...rest].map((k): [string, string[]] => [k, details.skills[k] ?? []]);
}

/** Every skill from the imported profile, in the order written (categories top to bottom). */
export function flattenSkills(details: ProfileDetails | undefined): string[] {
  if (details === undefined) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [, items] of orderedSkillEntries(details)) {
    for (const raw of items) {
      const s = raw.trim().slice(0, MAX_SKILL_CHARS);
      const key = norm(s);
      if (s === "" || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= MAX_SKILLS) return out;
    }
  }
  return out;
}

const ALIASES: Record<string, string[]> = {
  kubernetes: ["k8s"],
  javascript: ["js"],
  typescript: ["ts"],
  "ci/cd": ["ci cd", "cicd", "continuous integration"],
  "rest api testing": ["api testing", "rest api", "restful api"],
  "selenium webdriver": ["selenium"],
  "red hat enterprise linux": ["rhel"],
  go: ["golang"],
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function phrases(skill: string): string[] {
  const out = new Set<string>([norm(skill.replace(PAREN, "")), baseKey(skill)]);
  for (const m of skill.matchAll(/\(([^)]*)\)/g)) {
    const inner = m[1] ?? "";
    if (!/knowledge|level|basic|learning|and|,/i.test(inner)) out.add(norm(inner));
  }
  for (const p of [...out]) for (const a of ALIASES[p] ?? []) out.add(a);
  return [...out].filter(Boolean);
}

function count(text: string, phrase: string, exactCase: boolean): number {
  const flags = exactCase ? "g" : "gi";
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(phrase)}(?![A-Za-z0-9+#])`, flags);
  return (text.match(re) ?? []).length;
}

export function skillScore(skill: string, job: JobContext | undefined): number {
  const title = job?.title ?? "";
  const desc = job?.description ?? "";
  let best = 0;
  phrases(skill).forEach((p, i) => {
    const short = p.length <= 2 && /^[a-z]+$/.test(p);
    const word = short ? (skill.trim().length <= 2 ? skill.trim() : p.toUpperCase()) : p;
    const inTitle = count(title, word, short);
    const inDesc = count(desc, word, short);
    const found = (inTitle ? 6 : 0) + (inDesc ? 3 + 0.5 * Math.min(inDesc - 1, 4) : 0);
    best = Math.max(best, (i === 0 ? 1 : 0.85) * found);
  });
  return best;
}

/** Most job-relevant first; ties keep the candidate's order; "Python" and "Python 3.11" count once. */
export function rankSkills(skills: string[], job: JobContext | undefined): string[] {
  const scored = skills
    .map((s, i) => ({ s: s.trim(), i, score: skillScore(s, job) }))
    .filter((x) => x.s !== "")
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { s } of scored) {
    const key = baseKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Whole items only, highest priority first, within maxLength characters and maxItems items. */
export function fitItems(items: string[], maxLength?: number, maxItems?: number, sep = ", "): string {
  const picked: string[] = [];
  let len = 0;
  for (const item of items) {
    if (maxItems !== undefined && picked.length >= maxItems) break;
    const extra = item.length + (picked.length ? sep.length : 0);
    if (maxLength !== undefined && len + extra > maxLength) continue;
    picked.push(item);
    len += extra;
  }
  return picked.join(sep);
}

const SKILL_WORDS =
  /\bskills?\b|\btechnolog(?:y|ies)\b|\btech(?:nical)? stack\b|\btools?\b|\bcompetenc(?:e|y|ies)\b|\bexpertise\b|\bkeywords?\b|\bprogramming languages?\b|\bframeworks?\b/i;
const NOT_A_LIST =
  /\b(?:describe|tell|why|explain|how|years?|do you|are you|have you|did you|can you|would you|level|rate|rating|proficien|experience with|example|situation|when)\b/i;
const SLOT_NUMBER = /(?:skills?|technolog(?:y|ies)|tools?|competenc(?:e|y|ies)|keywords?)[\s_#:-]*(?:no\.?\s*)?(\d{1,2})\b/i;
const COUNT_LIMIT = /\b(?:top|up to|max(?:imum)?|at most|list)\s*(\d{1,2})\b|\b(\d{1,2})\s+(?:key |main |top )?skills\b/i;

export type SkillField =
  | { mode: "list"; maxItems?: number }
  | { mode: "slot"; slot?: number }
  | { mode: "choice" };

export function skillFieldOf(d: FieldDescriptor): SkillField | null {
  if (!["text", "search", "textarea", "select"].includes(d.type)) return null;
  const words = `${d.label} ${d.placeholder}`.trim();
  const text = `${words} ${d.id}`.replace(/_/g, " ");
  if (!SKILL_WORDS.test(words || d.id.replace(/_/g, " "))) return null;
  if (NOT_A_LIST.test(words)) return null;
  if (d.type === "select" || d.options.length > 0) return { mode: "choice" };
  const slot = text.match(SLOT_NUMBER);
  if (slot && d.type !== "textarea") return { mode: "slot", slot: Number(slot[1]) };
  const c = words.match(COUNT_LIMIT);
  const maxItems = c ? Number(c[1] ?? c[2]) || undefined : undefined;
  if (d.type !== "textarea" && maxItems === undefined && /\b(?:primary|main|top|key)\s+skill\b/i.test(words)) {
    return { mode: "slot" };
  }
  return maxItems !== undefined ? { mode: "list", maxItems } : { mode: "list" };
}

/** Values for every skill field, most job-relevant skills first (see plan_skill_answers on the server). */
export function planSkillValues(
  skills: string[],
  descriptors: FieldDescriptor[],
  job: JobContext | undefined,
): Record<string, string> {
  const ranked = rankSkills(skills, job);
  const out: Record<string, string> = {};
  if (ranked.length === 0) return out;
  const plans = descriptors
    .map((d) => ({ d, f: skillFieldOf(d) }))
    .filter((x): x is { d: FieldDescriptor; f: SkillField } => x.f !== null);
  const used = new Set<string>();
  for (const { d, f } of plans) {
    if (f.mode === "slot" && f.slot !== undefined && f.slot >= 1 && f.slot <= ranked.length) {
      const skill = ranked[f.slot - 1] ?? "";
      out[d.id] = d.maxLength !== undefined ? skill.slice(0, d.maxLength) : skill;
      used.add(skill);
    }
  }
  const free = ranked.filter((s) => !used.has(s));
  for (const { d, f } of plans) {
    if (d.id in out) continue;
    if (f.mode === "slot") {
      const skill = f.slot === undefined ? free.shift() : undefined;
      if (skill !== undefined) out[d.id] = d.maxLength !== undefined ? skill.slice(0, d.maxLength) : skill;
    } else if (f.mode === "choice") {
      for (const skill of ranked) {
        const keys = phrases(skill);
        const option = d.options.find((o) => keys.includes(norm(o)) || keys.includes(baseKey(o)));
        if (option !== undefined) {
          out[d.id] = option;
          break;
        }
      }
    } else {
      const isArea = d.type === "textarea";
      const value = fitItems(ranked, d.maxLength ?? (isArea ? 1000 : 250), f.maxItems ?? (isArea ? 30 : 12));
      if (value !== "") out[d.id] = value;
    }
  }
  return out;
}
