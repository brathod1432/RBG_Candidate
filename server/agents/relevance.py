# server/agents/relevance.py
"""Job-relevance ranking for skills, and length-aware fitting of answers.

Forms often cap what fits: a 255-character "Key skills" box, five
"Skill 1..5" inputs, a single "Primary skill" drop-down. This module makes
sure the candidate's skills that matter most for THIS job go in first, and
that anything cut to a limit is cut at a clean boundary (whole skill, whole
sentence, whole word) instead of mid-word.

Everything here is deterministic: no model calls.
"""

import re
from dataclasses import dataclass
from typing import Literal

from ..schemas.fill import CandidateProfile, FieldSpec, JobContext

# ── normalisation ─────────────────────────────────────────────────────────

_ALIASES: dict[str, list[str]] = {
    "kubernetes": ["k8s"],
    "javascript": ["js"],
    "typescript": ["ts"],
    "ci/cd": ["ci cd", "cicd", "continuous integration", "continuous delivery"],
    "rest api testing": ["api testing", "rest api", "restful api", "rest apis"],
    "rest api": ["restful api", "rest apis"],
    "postgresql": ["postgres"],
    "go": ["golang"],
    "github actions": ["gha"],
    "red hat enterprise linux": ["rhel"],
    "object-oriented programming": ["oop"],
    "large language models": ["llm", "llms"],
    "llm integration": ["llm", "llms", "large language model"],
    "robot framework": ["robotframework"],
    "selenium webdriver": ["selenium"],
    "page object model": ["pom"],
    "user acceptance testing": ["uat"],
    "uat": ["user acceptance testing"],
    "nvme over fabrics (nvme-of)": ["nvme-of", "nvmeof"],
}

_VERSION_TAIL = re.compile(r"(?:\s+(?:v?\d+(?:\.\d+)*|\(\s*v?\d+(?:\.\d+)*\s*\)))+$")
_PAREN = re.compile(r"\s*\(([^)]*)\)")
_STOP = {
    "and", "or", "of", "the", "for", "with", "in", "on", "to", "a", "an", "from",
    "testing", "test", "tests", "engineering", "management", "development", "design",
    "systems", "system", "working", "knowledge", "based", "level",
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().replace("_", " ")).strip()


def base_key(skill: str) -> str:
    """'Python 3.11' / 'Python 3' / 'Python' → 'python'; drops '(working knowledge)'-style notes."""
    s = _PAREN.sub("", skill).strip()
    s = _VERSION_TAIL.sub("", s).strip() or s
    return _norm(s)


def _phrases(skill: str) -> list[str]:
    """Search phrases for one skill: the name, its version-less base, bracketed short forms, aliases."""
    out: list[str] = []

    def add(p: str) -> None:
        p = _norm(p)
        if p and p not in out:
            out.append(p)

    add(_PAREN.sub("", skill))
    add(base_key(skill))
    for inner in _PAREN.findall(skill):
        # "(FCoE)" / "(Robot Operating System)" are real alternate names; "(working knowledge)" is not.
        if not re.search(r"knowledge|level|basic|learning|and|,", inner, re.IGNORECASE):
            add(inner)
    for p in list(out):
        for alias in _ALIASES.get(p, []):
            add(alias)
    return out


def _count(haystack: str, phrase: str) -> int:
    """Whole-word occurrences of a normalised phrase in normalised text."""
    if not phrase:
        return 0
    return len(re.findall(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9+#])", haystack))


def _count_exact_case(haystack: str, word: str) -> int:
    """Very short names ("Go", "C", "R", "JS") collide with ordinary words; require the original casing."""
    return len(re.findall(r"(?<![A-Za-z0-9])" + re.escape(word) + r"(?![A-Za-z0-9+#])", haystack))


# ── ranking ──────────────────────────────────────────────────────────────


def skill_score(skill: str, title: str, description: str, context: str = "") -> float:
    """How strongly the job asks for this skill: title (and field label) > description > partial."""
    t, d, c = _norm(title), _norm(description), _norm(context)
    score = 0.0
    for i, phrase in enumerate(_phrases(skill)):
        weight = 1.0 if i == 0 else 0.85
        if len(phrase) <= 2 and phrase.isalpha():
            word = skill.strip() if len(skill.strip()) <= 2 else phrase.upper()
            in_title = _count_exact_case(f"{title} {context}", word)
            in_desc = _count_exact_case(description, word)
        else:
            in_title = _count(t, phrase) + _count(c, phrase)
            in_desc = _count(d, phrase)
        found = 0.0
        if in_title:
            found += 6.0
        if in_desc:
            found += 3.0 + 0.5 * min(in_desc - 1, 4)
        score = max(score, weight * found)
    if score == 0.0:
        # Partial credit when the meaningful words show up in another form
        # ("API Validation" vs "validate our APIs", "Performance Testing" vs "performance").
        words = [w for w in re.findall(r"[a-z0-9+#.]+", base_key(skill)) if w not in _STOP and len(w) >= 3]
        blob = f"{t} {d} {c}"

        def seen(stem: str) -> bool:
            return re.search(r"(?<![a-z0-9])" + re.escape(stem), blob) is not None

        if len(words) >= 2 and all(seen(w[:5]) for w in words):
            score = 1.5
        elif len(words) == 1 and len(words[0]) >= 6 and seen(words[0][:-1]):
            # One word on its own needs a longer stem ("performanc" ok, "robot" from "Robotics" is not).
            score = 1.0
    return score


def rank_skills(skills: list[str], job: JobContext | None, context: str = "") -> list[str]:
    """Candidate skills, most job-relevant first; ties keep the candidate's own order.

    Duplicates that differ only by version or a note ("Python", "Python 3.11") collapse to the
    first (highest-ranked) one, so limited slots are not wasted on repeats.
    """
    title = (job.title or "") if job else ""
    description = (job.description or "") if job else ""
    scored = [
        (-skill_score(s, title, description, context), i, s.strip())
        for i, s in enumerate(skills)
        if s and s.strip()
    ]
    scored.sort()
    seen: set[str] = set()
    ranked: list[str] = []
    for _, _, skill in scored:
        key = base_key(skill)
        if key in seen:
            continue
        seen.add(key)
        ranked.append(skill)
    return ranked


def relevant_skills(skills: list[str], job: JobContext | None, limit: int = 25) -> list[str]:
    """Top skills for prompts: the job-matched ones, topped up with the candidate's leading skills."""
    return rank_skills(skills, job)[:limit]


# ── fitting to limits ────────────────────────────────────────────────────


def fit_items(items: list[str], max_length: int | None, *, sep: str = ", ", max_items: int | None = None) -> str:
    """Join items in priority order, keeping only whole items that fit in max_length.

    A long item that does not fit is skipped so a shorter, lower-ranked one can still use the space.
    """
    picked: list[str] = []
    length = 0
    for item in items:
        if max_items is not None and len(picked) >= max_items:
            break
        extra = len(item) + (len(sep) if picked else 0)
        if max_length is not None and length + extra > max_length:
            continue
        picked.append(item)
        length += extra
    return sep.join(picked)


_SENTENCE_END = re.compile(r"[.!?](?:[\"')\]]+)?(?=\s|$)")


def smart_truncate(text: str, max_length: int | None) -> str:
    """Cut to max_length at the cleanest boundary: sentence, then list item, then word."""
    if max_length is None or len(text) <= max_length:
        return text
    window = text[:max_length]
    ends = [m.end() for m in _SENTENCE_END.finditer(window)]
    if ends and ends[-1] >= max_length * 0.5:
        return window[: ends[-1]].rstrip()
    if window.count(",") >= 2 and "." not in window.rstrip("."):
        cut = window.rfind(",")
        if cut > 0:
            return window[:cut].rstrip()
    space = window.rfind(" ")
    if space >= max_length * 0.5:
        return window[:space].rstrip(" ,;:-–—")
    return window.rstrip()


_DASHES = re.compile(r"\s*[—–]\s*")


def plain_dashes(text: str) -> str:
    """Em/en dashes read as machine-written in a form answer; use a plain hyphen instead."""
    return _DASHES.sub(lambda m: " - " if m.group(0).strip() != m.group(0) else "-", text)


# ── skill fields in a form ────────────────────────────────────────────────

_SKILL_WORDS = re.compile(
    r"\bskills?\b|\btechnolog(?:y|ies)\b|\btech(?:nical)? stack\b|\btools?\b|\bcompetenc(?:e|y|ies)\b|"
    r"\bexpertise\b|\bkeywords?\b|\bprogramming languages?\b|\bframeworks?\b|\bspecialti(?:es|y)\b"
)
# Questions about a skill are for the AI, not a skill list ("How many years of Python?").
_NOT_A_LIST = re.compile(
    r"\b(?:describe|tell|why|explain|how|years?|do you|are you|have you|did you|can you|would you|"
    r"level|rate|rating|proficien|experience with|example|situation|when)\b"
)
_SLOT_NUMBER = re.compile(
    r"(?:skills?|technolog(?:y|ies)|tools?|competenc(?:e|y|ies)|keywords?)[\s_#:-]*(?:no\.?\s*)?(\d{1,2})\b"
)
_COUNT_LIMIT = re.compile(r"\b(?:top|up to|max(?:imum)?|at most|list)\s*(\d{1,2})\b|\b(\d{1,2})\s+(?:key |main |top )?skills\b")


@dataclass(frozen=True)
class SkillField:
    mode: Literal["list", "slot", "choice"]
    slot: int | None = None  # 1-based, for "Skill 3"
    max_items: int | None = None


def skill_field(spec: FieldSpec) -> SkillField | None:
    """Is this form field asking for the candidate's skills (a list, one slot, or a pick)?"""
    if spec.type not in ("text", "search", "textarea", "select"):
        return None
    words = _norm(" ".join(p for p in (spec.label, spec.placeholder) if p))
    ident = _norm(spec.id)
    text = f"{words} {ident}".strip()
    if not _SKILL_WORDS.search(words or ident):
        return None
    if _NOT_A_LIST.search(words):
        return None
    if spec.type == "select" or spec.options:
        return SkillField(mode="choice")
    slot = _SLOT_NUMBER.search(text)
    if slot and spec.type != "textarea":
        return SkillField(mode="slot", slot=int(slot.group(1)))
    count = _COUNT_LIMIT.search(words)
    max_items = int(count.group(1) or count.group(2)) if count else None
    if max_items == 0:
        max_items = None
    if spec.type != "textarea" and max_items is None and re.search(r"\b(?:primary|main|top|key)\s+skill\b", words):
        return SkillField(mode="slot", slot=None)
    return SkillField(mode="list", max_items=max_items)


def _match_option(skill: str, options: list[str]) -> str | None:
    phrases = _phrases(skill)
    for option in options:
        o = _norm(option)
        if o in phrases or base_key(option) in phrases:
            return option
    for option in options:
        o = _norm(option)
        for p in phrases:
            if len(p) > 2 and _count(o, p):
                return option
    return None


# Default caps when the form gives no maxlength.
LIST_DEFAULT_CHARS = {"text": 250, "search": 250, "textarea": 1000}
LIST_DEFAULT_ITEMS = {"text": 12, "search": 12, "textarea": 30}


def plan_skill_answers(
    fields: list[FieldSpec],
    profile: CandidateProfile,
    job: JobContext | None,
) -> dict[str, str]:
    """Fill every skill field from the ranked skill list, most job-relevant first.

    - list fields get as many whole skills as the character / count limit allows;
    - "Skill 1..N" slots get ranked skill N; unnumbered slots take the next unused skill;
    - drop-downs get the highest-ranked skill that is one of the options.
    Fields it cannot answer (no skills in the profile, no matching option) are left for the AI.
    """
    if not profile.skills:
        return {}
    ranked = rank_skills(profile.skills, job)
    if not ranked:
        return {}
    plans = [(spec, sf) for spec in fields if (sf := skill_field(spec)) is not None]
    out: dict[str, str] = {}
    used: set[str] = set()

    # Numbered slots first so "Skill 1" always gets the top skill, whatever the DOM order.
    for spec, sf in plans:
        if sf.mode == "slot" and sf.slot is not None and 1 <= sf.slot <= len(ranked):
            skill = ranked[sf.slot - 1]
            out[spec.id] = smart_truncate(skill, spec.max_length)
            used.add(skill)
    free = [s for s in ranked if s not in used]
    for spec, sf in plans:
        if spec.id in out:
            continue
        if sf.mode == "slot":
            if sf.slot is None and free:
                skill = free.pop(0)
                out[spec.id] = smart_truncate(skill, spec.max_length)
                used.add(skill)
        elif sf.mode == "choice":
            # A drop-down is independent of the other fields: always offer the best match.
            for skill in ranked:
                option = _match_option(skill, spec.options)
                if option is not None:
                    out[spec.id] = option
                    break
        else:
            kind = spec.type if spec.type in LIST_DEFAULT_CHARS else "text"
            limit = spec.max_length or LIST_DEFAULT_CHARS[kind]
            max_items = sf.max_items or LIST_DEFAULT_ITEMS[kind]
            value = fit_items(ranked, limit, max_items=max_items)
            if value:
                out[spec.id] = value
    return out


# ── language fields in a form ────────────────────────────────────────────────

_LANGUAGES = {  # names the profile/CV may use → normalised key
    "english": ["english"],
    "polish": ["polish", "polski"],
    "german": ["german", "deutsch"],
    "french": ["french", "français", "francais"],
    "spanish": ["spanish", "español", "espanol"],
    "italian": ["italian", "italiano"],
    "dutch": ["dutch"],
    "russian": ["russian", "русский"],
    "ukrainian": ["ukrainian", "українська"],
}

_LEVEL_WORDS = re.compile(
    r"\blevel\b|\bwritten\b|\bspoken\b|\bspeaking\b|\breading\b|\bfluency\b|\bproficien|\bconversational\b|\bcomprehension\b",
    re.IGNORECASE,
)

# For language fields: only exclude question-style prompts (describe/tell/why…), NOT _NOT_A_LIST's level/proficien/years.
_QUESTION_STYLE = re.compile(
    r"\b(?:describe|tell|why|explain|how|do you|are you|have you|did you|can you|would you|example|situation|when)\b",
    re.IGNORECASE,
)


def language_of(text: str) -> str | None:
    """The language a field asks about ('English written level' -> 'english'), else None."""
    t = _norm(text)
    for name, aliases in _LANGUAGES.items():
        for alias in aliases:
            if re.search(r"(?<![a-z])" + re.escape(alias) + r"(?![a-z])", t):
                return name
    return None


def profile_level(languages: list, key: str) -> str | None:
    """The candidate's level for one language ('english'), None when unknown."""
    for entry in languages or []:
        lang = _norm(getattr(entry, "language", "") or "")
        if lang == key or lang in _LANGUAGES.get(key, []):
            level = (getattr(entry, "level", "") or "").strip()
            return level or None
    return None


def plan_language_answers(fields: list, profile: CandidateProfile) -> dict[str, str]:
    """Fill language-level fields from the candidate's languages, zero AI calls.

    - A field naming a language ("English written level") gets that language's
      profile level — the SAME level for every sibling field under the language.
    - A level field naming no language (matches _LEVEL_WORDS) assumes ENGLISH (the default).
    - A generic "Language(s)" field (has "language" word, NO level word, NO language name)
      gets the profile's top language NAME, or "English" when the profile has no languages.
    - Selects: language-level selects match the profile level against options;
      generic language selects (no level word) are skipped (no level to match).
    """
    out: dict[str, str] = {}
    if not profile.languages:
        return out
    for spec in fields:
        if spec.type not in ("text", "search", "textarea", "select"):
            continue
        words = _norm(" ".join(p for p in (spec.label, spec.placeholder) if p))
        text = f"{words} {_norm(spec.id)}".strip()
        lang = language_of(text)
        has_language_word = bool(re.search(r"\blanguages?\b", text))
        has_level_word = bool(_LEVEL_WORDS.search(text))
        is_language_field = lang is not None or has_language_word or has_level_word
        if not is_language_field:
            continue
        # Exclude question-style prompts ONLY (describe/tell/why…), not level/proficien/years.
        if _QUESTION_STYLE.search(words):
            continue
        if spec.type == "select" or spec.options:
            # Language-level select (has language name OR has level word) → match level against options
            if lang is not None or has_level_word:
                level = profile_level(profile.languages, lang) if lang else profile_level(profile.languages, "english")
                if level is not None:
                    for option in spec.options:
                        o = _norm(option)
                        if o == _norm(level) or o in _norm(level) or _norm(level) in o:
                            out[spec.id] = option
                            break
            # Generic language select (no language name, no level word) → skip, no level to match
            continue
        # Text/textarea fields
        if lang is not None:
            # Named language field (with or without level word) → that language's level
            level = profile_level(profile.languages, lang)
            if level:
                out[spec.id] = smart_truncate(level, spec.max_length)
            continue
        # No language name detected
        if has_level_word:
            # Level field with no language name → English level (default)
            level = profile_level(profile.languages, "english")
            if level:
                out[spec.id] = smart_truncate(level, spec.max_length)
            continue
        # Generic "Language(s)" field (has "language" word, no level word, no language name) → top language NAME
        if has_language_word:
            first = profile.languages[0]
            name = (getattr(first, "language", "") or "").strip()
            if name:
                out[spec.id] = smart_truncate(name, spec.max_length)
    return out
