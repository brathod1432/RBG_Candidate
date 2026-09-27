// client/src/profile/languages.ts
// Language levels from the profile, propagated to all level fields under the same language.
// The server does the same (server/agents/relevance.py); this mirror keeps language
// fields filled when the local server is offline.
import type { FieldDescriptor, JobContext } from "../types/index";

export const MAX_LANGUAGES = 20;

const norm = (s: string): string => s.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();

const LANGUAGES: Record<string, string[]> = {
  english: ["english"],
  polish: ["polish", "polski"],
  german: ["german", "deutsch"],
  french: ["french", "français", "francais"],
  spanish: ["spanish", "español", "espanol"],
  italian: ["italian", "italiano"],
  dutch: ["dutch"],
  russian: ["russian", "русский"],
  ukrainian: ["ukrainian", "українська"],
};

const ESCAPE_RE = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LANGUAGE_HINT = /\blanguages?\b/i;
const LEVEL_WORDS = /\blevel\b|\bwritten\b|\bspoken\b|\bspeaking\b|\breading\b|\bfluency\b|\bproficien|\bconversational\b|\bcomprehension\b/i;

// For language fields: only exclude question-style prompts (describe/tell/why…), NOT level/proficien/years.
const QUESTION_STYLE = /\b(?:describe|tell|why|explain|how|do you|are you|have you|did you|can you|would you|example|situation|when)\b/i;

/** The language a field asks about ('English written level' -> 'english'), else null. */
export function languageOf(text: string): string | null {
  const t = norm(text);
  for (const [name, aliases] of Object.entries(LANGUAGES)) {
    for (const alias of aliases) {
      if (new RegExp(`(?<![a-z])${ESCAPE_RE(alias)}(?![a-z])`).test(t)) {
        return name;
      }
    }
  }
  return null;
}

/** The profile's level for one language ('english'), null when unknown. */
export function profileLevel(languages: Array<{ language: string; level: string }>, key: string): string | null {
  for (const entry of languages) {
    const lang = norm(entry.language);
    if (lang === key || LANGUAGES[key]?.includes(lang)) {
      const level = (entry.level ?? "").trim();
      if (level) return level;
    }
  }
  return null;
}

/** Check if a field is asking about a language level (not a generic list of languages). */
function isLanguageLevelField(d: FieldDescriptor): boolean {
  const words = `${d.label} ${d.placeholder}`.trim();
  const text = `${words} ${d.id}`.replace(/_/g, " ");
  if (!LANGUAGE_HINT.test(text) && languageOf(text) === null && !LEVEL_WORDS.test(text)) return false;
  // Exclude question-style prompts ONLY (describe/tell/why…), not level/proficien/years.
  if (QUESTION_STYLE.test(words)) return false;
  return true;
}

/** Match a profile level against select options via the CEFR ladder
 * (C2 finds "Native", A2 finds "Limited working proficiency") — a level with
 * no matching option never guesses. */
const ENGLISH_DEFAULT_LEVEL = "C2 (full professional proficiency)";

const LEVEL_LADDERS: Record<string, string[]> = {
  native: ["native", "bilingual", "c2", "full professional", "fluent", "c1"],
  c2: ["native", "bilingual", "c2", "full professional", "fluent", "c1"],
  c1: ["c1", "advanced", "fluent", "full professional", "professional working", "c2"],
  fluent: ["fluent", "full professional", "c1", "professional working", "advanced"],
  b2: ["b2", "upper intermediate", "intermediate", "conversational", "professional working"],
  b1: ["b1", "intermediate", "conversational", "limited working"],
  a2: ["a2", "limited working", "elementary", "basic", "beginner", "b1"],
  a1: ["a1", "beginner", "elementary", "basic"],
};

function matchLevelOption(level: string, options: string[]): string | undefined {
  const n = norm(level);
  const cefr = /\b(c2|c1|b2|b1|a2|a1)\b/.exec(n)?.[1] ?? '';
  const ladder = LEVEL_LADDERS[cefr] ?? LEVEL_LADDERS[n] ?? [n];
  for (const want of ladder) {
    for (const o of options) {
      if (norm(o) === want) return o;
    }
    for (const o of options) {
      const on = norm(o);
      if (on !== '' && (want.includes(on) || on.includes(want))) return o;
    }
  }
  return undefined;
}

/**
 * Values for every language level field, propagated from the profile's single level per language.
 * - "English written level", "English spoken level", "English reading" → all get the SAME English level.
 * - A level field naming NO language (matches LEVEL_WORDS) → English's level (default).
 * - A generic "Language(s)" field (has "language" word, NO level word, NO language name) → the profile's top language NAME, or "English".
 * - Selects: language-level selects match the level against options; generic language selects (no level word) are skipped.
 */
export function planLanguageValues(
  languages: Array<{ language: string; level: string }>,
  descriptors: FieldDescriptor[],
  _job?: JobContext,
): Record<string, string> {
  const out: Record<string, string> = {};

  // Pre-compute level for each language once
  const levelByLang: Record<string, string> = {};
  for (const entry of languages) {
    const key = norm(entry.language);
    if (!levelByLang[key] && entry.level?.trim()) {
      levelByLang[key] = entry.level.trim();
    }
  }

  // English default level: the profile's level when set; otherwise C2
  // ("native" first, then fluent) — matched against options via the ladder.
  const englishLevel = levelByLang["english"] ?? ENGLISH_DEFAULT_LEVEL;

  for (const d of descriptors) {
    if (!["text", "search", "textarea", "select"].includes(d.type)) continue;
    if (!isLanguageLevelField(d)) continue;

    const words = norm(`${d.label} ${d.placeholder}`);
    const text = `${words} ${norm(d.id)}`.trim();
    const lang = languageOf(text);
    const hasLanguageWord = LANGUAGE_HINT.test(text);
    const hasLevelWord = LEVEL_WORDS.test(text);

    if (d.type === "select" || d.options.length > 0) {
      // Language-level select (has language name OR has level word) → match level against options
      if (lang !== null || hasLevelWord) {
        const level =
          lang !== null
            ? levelByLang[lang] ?? (lang === "english" ? ENGLISH_DEFAULT_LEVEL : undefined)
            : englishLevel;
        if (level !== undefined && level !== null) {
          const matched = matchLevelOption(level, d.options);
          if (matched !== undefined) out[d.id] = matched;
        }
      }
      // Generic language select (no language name, no level word) → skip, no level to match
      continue;
    }

    if (lang !== null) {
      // Named language field (with or without level word) → that language's level
      const level = levelByLang[lang] ?? (lang === "english" ? ENGLISH_DEFAULT_LEVEL : undefined);
      if (level) out[d.id] = d.maxLength ? level.slice(0, d.maxLength) : level;
      continue;
    }

    // No language name detected
    if (hasLevelWord) {
      // Level field with no language name → English level (default)
      if (englishLevel) {
        out[d.id] = d.maxLength ? englishLevel.slice(0, d.maxLength) : englishLevel;
      }
      continue;
    }

    // Generic "Language(s)" field (has "language" word, no level word, no language name) → top language NAME
    if (hasLanguageWord) {
      const first = languages[0];
      const name = (first?.language ?? "English").trim();
      if (name) out[d.id] = d.maxLength ? name.slice(0, d.maxLength) : name;
    }
  }
  return out;
}