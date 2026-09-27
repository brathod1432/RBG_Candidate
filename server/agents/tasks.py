# server/agents/tasks.py
"""Task model, planning rules, prompts and answer validation.

The coordinator uses this module to:
  1. resolve fields it can answer straight from the profile (no LLM call),
  2. turn every other field into an AITask of kind short / choice / long,
  3. validate each worker's answer against the field spec.
"""

import itertools
import re
from dataclasses import dataclass, field
from datetime import date as _date
from typing import Any, Literal

from ..nvidia_client import ModelOutputError, dumps_compact
from ..schemas.fill import CandidateProfile, FieldSpec, JobContext
from .relevance import plain_dashes, relevant_skills, smart_truncate

FieldKind = Literal["short", "choice", "long"]
TaskKind = Literal["short", "choice", "long", "analyze"]
Tier = Literal["fast", "quality"]

TIER_FOR_KIND: dict[str, Tier] = {
    "short": "fast",
    "choice": "fast",
    "long": "quality",
    "analyze": "quality",
}

_task_ids = itertools.count(1)


@dataclass
class AITask:
    """One unit of work handed to a single worker."""

    kind: TaskKind
    messages: list[dict[str, str]]
    api_key: str
    field_id: str | None = None
    temperature: float = 0.1
    max_tokens: int = 300
    task_id: int = field(default_factory=lambda: next(_task_ids))

    @property
    def tier(self) -> Tier:
        return TIER_FOR_KIND[self.kind]


# ── Deterministic profile resolution ────────────────────────────────────

_EXCLUDE_NAME = re.compile(
    r"company|employer|school|university|college|reference|referee|emergency|manager|"
    r"user ?name|\bfile\b|account|spouse|contact person|recruiter|\bproject\b|"
    r"\borg(anization|anisation)?\b"
)

_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("email", re.compile(r"e-?\s?mail")),
    ("phone", re.compile(r"phone|mobile|telephone|\btel\b|contact number|cell")),
    ("first_name", re.compile(r"first[\s_-]?name|given[\s_-]?name|forename|\bfname\b")),
    ("last_name", re.compile(r"last[\s_-]?name|surname|family[\s_-]?name|\blname\b")),
    ("middle_name", re.compile(r"middle[\s_-]?name|\bmname\b")),
    ("linkedin", re.compile(r"linked\s?in")),
    ("github", re.compile(r"git\s?hub")),
    ("website", re.compile(r"website|portfolio|personal (site|url|page)")),
    ("postal_code", re.compile(r"postal|zip|post\s?code")),
    ("notice_period", re.compile(r"notice period|\bnotice\b")),
    ("available_from", re.compile(r"available from|availability date|earliest start|start date|when can you start")),
    ("desired_salary", re.compile(r"salary|compensation|pay expectation")),
    ("years_experience", re.compile(r"^(total )?years of (professional |work |relevant )?experience\??$")),
    ("city", re.compile(r"\bcity\b|\btown\b")),
    ("country", re.compile(r"\bcountry\b")),
    ("location", re.compile(r"\blocation\b|where are you (currently )?based")),
    ("address", re.compile(r"^(street |home |postal )?address( line 1)?$")),
    ("full_name", re.compile(r"full[\s_-]?name|your name|applicant name|legal name|^name$|^name\b|\bname$")),
    ("headline", re.compile(r"headline|current (job )?title|current position|current role|^job title$")),
    ("summary", re.compile(r"^(professional )?summary$")),
]

# Keys that describe the candidate; skip them when the field is about someone/something else
# ("Company name", "Company website", "School city", "Reference phone"...).
_PERSONAL_ONLY = {
    "full_name", "first_name", "last_name", "middle_name", "linkedin", "github", "website",
    "city", "country", "location", "address", "postal_code",
}

_LABEL_ONLY = {
    "full_name", "summary", "headline", "years_experience", "address", "location",
    "available_from", "desired_salary", "notice_period",
}

_LONG_HINT = re.compile(
    r"cover letter|why|describe|tell us|motivation|about (you|yourself)|objective|"
    r"additional information|anything else|explain|summary|bio|recruiter|hiring manager|"
    r"message|note to|introduce yourself|pitch"
)


def field_text(spec: FieldSpec) -> str:
    return " ".join(part for part in (spec.label, spec.placeholder, spec.id) if part).strip().lower()


def resolve_from_profile(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Return a profile value when the field is an obvious direct match."""
    if spec.type == "select":
        return None
    if _LOCATION_PREF_HINT.search(field_text(spec)):
        # Location/way-of-working preference questions are answered by
        # resolve_location_preference_default (combined answer) in the
        # coordinator's defaults chain — not by the bare location rule.
        return None
    text = field_text(spec)
    label = (spec.label or spec.placeholder or spec.id).strip().lower()
    if _RELOCATION_YESNO.search(label):
        # Yes/no relocation questions ("Are you willing to relocate to X?") are
        # answered by resolve_relocation_default (destination-based Yes/No) in
        # the coordinator's defaults chain — the bare profile string could answer
        # Yes to a city outside the candidate's acceptable area.
        return None
    for key, pattern in _RULES:
        target = label if key in _LABEL_ONLY else text
        if not pattern.search(target):
            continue
        if key in _PERSONAL_ONLY and _EXCLUDE_NAME.search(text):
            return None
        value = _profile_value(key, profile)
        return value or None
    if spec.type == "email" and profile.email:
        return profile.email
    if spec.type == "tel" and profile.phone:
        return profile.phone
    return None


def resolve_notice_default(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Default for notice-period fields when the profile has no answer.

    Selects get the best matching option — "Immediate" first, then "2 weeks";
    plain text fields get "Immediately". Returns None for anything else
    (the field then goes to the AI workers as today).
    """
    label = (spec.label or spec.placeholder or spec.id).strip().lower()
    if not re.search(r"notice period|\bnotice\b", label):
        return None
    if spec.type == "select" or spec.options:
        own = (profile.notice_period or "").strip()
        if own:
            matched = match_option(own, spec.options)
            if matched is not None:
                return matched
        for pattern in (re.compile(r"immediat", re.IGNORECASE), re.compile(r"2\s*weeks|two\s*weeks", re.IGNORECASE)):
            for option in spec.options:
                if pattern.search(option):
                    return option
        return None
    if spec.type in ("text", "search"):
        if (profile.notice_period or "").strip():
            return None
        if spec.max_length is not None:
            # Tight boxes get a shorter synonym instead of a mid-word cut ("Immed").
            if spec.max_length >= len("Immediately"):
                return "Immediately"
            if spec.max_length >= len("Immediate"):
                return "Immediate"
            if spec.max_length >= len("Now"):
                return "Now"
            return smart_truncate("Immediately", spec.max_length)
        return "Immediately"
    return None


def resolve_gender_default(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Gender fields: the profile value when set (option-matched for selects).

    When the profile has no gender, returns None — the field goes to the AI,
    which infers the most likely answer from the candidate's name.
    """
    label = (spec.label or spec.placeholder or spec.id).strip().lower()
    if not re.search(r"\bgender\b|\bsex\b", label):
        return None
    own = (profile.gender or "").strip()
    if not own:
        return None
    if spec.type == "select" or spec.options:
        return match_option(own, spec.options)
    if spec.type in ("text", "search"):
        return own
    return None


_CURRENT_EMPLOYER_HINT = re.compile(
    r"current(ly)? (working|work|employed)|do you (currently )?work|are you (currently )? (working|employed)",
    re.IGNORECASE,
)


def _company_in_text(company: str, text: str) -> bool:
    """Whole-word, case-insensitive match of a company name (or its first token) in text.

    "Dell Technologies" matches a label saying "Dell" via the first token;
    the whole phrase matches when the label spells it out.
    """
    cn = _norm(company)
    if len(cn) >= 2 and re.search(r"(?<![a-z0-9])" + re.escape(cn) + r"(?![a-z0-9])", text) is not None:
        return True
    first = cn.split(" ")[0] if " " in cn else ""
    return len(first) >= 3 and re.search(r"(?<![a-z0-9])" + re.escape(first) + r"(?![a-z0-9])", text) is not None


def resolve_current_employer_default(
    spec: FieldSpec, profile: CandidateProfile, job: JobContext | None
) -> str | None:
    """'Are you currently working at X?' — No by default (new applicant).

    Unless the applying company (job.company) or a company named in the field
    label is one of the candidate's experience companies — then Yes.
    Deterministic: no model call.
    """
    text = field_text(spec)
    if not _CURRENT_EMPLOYER_HINT.search(text):
        return None
    job_company = (job.company or "").strip() if job else ""
    works_there = False
    for company in profile.companies or []:
        c = (company or "").strip()
        if not c:
            continue
        cn = _norm(c)
        jc = _norm(job_company)
        if (jc and (cn == jc or cn in jc or jc in cn)) or _company_in_text(c, text):
            works_there = True
            break
    if spec.type == "select" or spec.options:
        want = "yes" if works_there else "no"
        for option in spec.options:
            on = _norm(option)
            if on == want or (want == "yes" and on in ("y", "true")) or (want == "no" and on in ("n", "false")):
                return option
        return None
    if spec.type in ("text", "search"):
        return "Yes" if works_there else "No"
    return None


_LOCATION_PREF_HINT = re.compile(
    r"way of working|work mode|working (model|arrangement|setup|preferences?)|remote|hybrid|on-?site|"
    r"preferences? regarding|preferred location|location preferences?|willing to work",
    re.IGNORECASE,
)

# Yes/no relocation questions — handled by resolve_relocation_default, not the
# bare willing_to_relocate rule (which could answer Yes to a city the candidate
# would not move to).
_RELOCATION_YESNO = re.compile(
    r"^(are|do|would|could|can) you\b[^\?]*\b(relocate|moving|relocation)\b",
    re.IGNORECASE,
)

# Polish cities — relocation to any of them is a Yes for a candidate based in Poland.
_POLAND_CITIES = (
    "warsaw", "warszawa", "krakow", "kraków", "wroclaw", "wrocław", "gdansk", "gdańsk",
    "gdynia", "poznan", "poznań", "lodz", "łódź", "katowice", "lublin", "szczecin",
    "bydgoszcz", "bialystok", "białystok", "rzeszow", "rzeszów", "torun", "toruń",
    "kielce", "olsztyn", "zabrze", "gliwice", "bielsko-biala", "bielsko-biała",
    "radom", "rybnik", "tychy", "opole", "elblag", "elbląg", "plock", "płock",
    "walbrzych", "wałbrzych", "legnica", "kalisz", "koszalin", "nowy sacz",
)

# Generic relocation destinations — not a real place, so unspecified ("a different city").
_GENERIC_DEST = re.compile(r"\b(different|another|other|any|elsewhere|anywhere)\b", re.IGNORECASE)


def resolve_location_preference_default(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Location / way-of-working preference questions: answered from the profile.

    Combines the candidate's location and work mode — e.g. "Warsaw, Poland.
    Hybrid (2-3 days from the office)." Selects get the work mode matched
    against the options. None when the profile has neither (goes to the AI).
    """
    text = field_text(spec)
    if not _LOCATION_PREF_HINT.search(text):
        return None
    location = (profile.location or "").strip()
    mode = (profile.work_mode or "").strip()
    if not location and not mode:
        # Hard default: the candidate's hybrid preference (2-3 days from the
        # office) even with no profile — selects get the best-matching option.
        if spec.type == "select" or spec.options:
            for option in spec.options:
                if re.search(r"2\s*-\s*3|2\s*to\s*3", _norm(option), re.IGNORECASE):
                    return option
            for option in spec.options:
                if "hybrid" in _norm(option):
                    return option
            return None
        if spec.type in ("text", "search", "textarea"):
            return smart_truncate("2-3 days from the office", spec.max_length)
        return None
    if spec.type == "select" or spec.options:
        return match_option(mode, spec.options) if mode else None
    if spec.type in ("text", "search", "textarea"):
        parts: list[str] = []
        if location:
            parts.append(location if location.endswith(".") else location + ".")
        if mode:
            m = mode[0].upper() + mode[1:]
            parts.append(m if m.endswith(".") else m + ".")
        return smart_truncate(" ".join(parts), spec.max_length)
    return None


# ── work-model / permit defaults ─────────────────────────────────────────

_MODE_WORD = re.compile(r"\bhybrid\b|\bremote\b|\bon-?site\b|\boffice\b", re.IGNORECASE)
_YESNO_OPTIONS = ("yes", "no", "y", "n", "true", "false")


def resolve_work_model_yesno(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Yes/no questions about work models: Yes unless the profile's work mode
    explicitly contradicts it.

    "Would you be able to work in a hybrid work model?" -> "Yes" (the profile
    says hybrid is fine). An explicit restriction ("on-site only") answers No
    to a hybrid/remote question.
    """
    text = field_text(spec)
    if not _MODE_WORD.search(text):
        return None
    if re.search(r"how often|how many|days (per week|from|in)", text, re.IGNORECASE):
        return None  # a frequency question, not yes/no (resolve_office_frequency)
    is_select_yesno = (spec.type == "select" or bool(spec.options)) and any(
        _norm(o) in _YESNO_OPTIONS for o in spec.options
    )
    is_yesno_question = bool(
        re.search(r"^(would|could|do|are|can) you\b", (spec.label or spec.placeholder or spec.id).strip().lower())
    )
    if not is_select_yesno and not is_yesno_question:
        return None
    mode = (profile.work_mode or "").strip().lower()
    works = True
    if mode and "only" in mode:
        # explicit restriction ("on-site only"): No to a question about a mode it excludes
        asked = [w for w in ("hybrid", "remote", "on-site", "onsite", "on site") if re.search(r"\b" + re.escape(w) + r"\b", text)]
        if asked and not any(re.search(r"\b" + re.escape(w) + r"\b", mode) for w in asked):
            works = False
    if is_select_yesno:
        want = "yes" if works else "no"
        for option in spec.options:
            if _norm(option) == want:
                return option
        return None
    if spec.type in ("text", "search"):
        return "Yes" if works else "No"
    return None


def resolve_office_frequency(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """'How often would you be able to work from the office?' — from the profile's
    work mode. "hybrid (2-3 days from the office)" -> "2-3 days from the office".

    Selects get the ONE best-matching option (exact > startsWith > token overlap);
    when the work mode has no detail (or is missing), the hard default "2-3 days"
    picks whichever option suits it best.
    """
    text = field_text(spec)
    if not re.search(r"how often|how many days|days (per week|from|in)|frequency", text, re.IGNORECASE):
        return None
    if not re.search(r"\boffice\b|\bremote\b|\bhybrid\b|\bweek\b", text, re.IGNORECASE):
        return None
    mode = (profile.work_mode or "").strip()
    match = re.search(r"\(([^)]+)\)", mode) if mode else None
    detail = match.group(1).strip() if match else mode

    def tokens(s: str) -> set[str]:
        return {w.rstrip("s") for w in re.findall(r"[a-z0-9]+", _norm(s)) if len(w) >= 2 or w.isdigit()}

    if spec.type == "select" or spec.options:
        wanted = detail if detail else "2-3 days from the office"
        wn = _norm(wanted)
        for option in spec.options:
            if _norm(option) == wn:
                return option
        for option in spec.options:
            on = _norm(option)
            if on and (on.startswith(wn) or wn.startswith(on)):
                return option
        wt = tokens(wanted)
        best, best_score = None, 0
        for option in spec.options:
            score = len(wt & tokens(option))
            if score > best_score:
                best, best_score = option, score
        if best is not None:
            return best
        # hard default: whichever option says "2-3" days, else any days/week option
        for option in spec.options:
            if re.search(r"2\s*-?\s*3", _norm(option), re.IGNORECASE):
                return option
        for option in spec.options:
            if re.search(r"\bdays?\b|\bweek\b", _norm(option), re.IGNORECASE):
                return option
        return None
    if spec.type in ("text", "search"):
        return detail if detail else "2-3 days from the office"
    return None


def resolve_work_permit(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Work-permit / visa-sponsorship questions: No — the candidate does not
    require permit or visa support (unless the profile explicitly says otherwise).

    "Would you require a work permit to work in X Company?" -> "No".
    """
    text = field_text(spec)
    if not re.search(r"work ?permit|visa|sponsorship", text, re.IGNORECASE):
        return None
    own = (profile.visa_sponsorship or "").strip().lower()
    requires = bool(own and re.search(r"\b(yes|true|require[ds]?|need(?:ed)?|sponsor[ds]?)\b", own))
    if spec.type == "select" or spec.options:
        if any(_norm(o) in _YESNO_OPTIONS for o in spec.options):
            want = "yes" if requires else "no"
            for option in spec.options:
                if _norm(option) == want:
                    return option
            return None
        return None
    if spec.type in ("text", "search"):
        return "Yes" if requires else "No"
    return None


def resolve_work_authorization_default(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Work-authorization questions: Yes — the candidate is authorized to work
    (open work permit assumed, no sponsorship needed), unless the profile
    explicitly says otherwise.

    "Are you authorized to work in Poland?" -> "Yes". An open status question
    ("What is your work authorization status?") gets the status sentence.
    """
    text = field_text(spec)
    if not re.search(
        r"work authori[sz]ation|authori[sz]ed to work|legally authori[sz]ed|right to work|"
        r"eligible to work|work eligibility|permitted to work",
        text,
        re.IGNORECASE,
    ):
        return None
    own = (profile.work_authorization or "").strip()
    if own:
        if spec.type == "select" or spec.options:
            return match_option(own, spec.options)
        if spec.type in ("text", "search"):
            return own
        return None
    # Hard default: authorized to work (the candidate's standing assumption).
    if spec.type == "select" or spec.options:
        if any(_norm(o) in _YESNO_OPTIONS for o in spec.options):
            for option in spec.options:
                if _norm(option) == "yes":
                    return option
        return None
    if spec.type in ("text", "search"):
        yesno_question = bool(
            re.search(r"^(are|do|can|would|could) you\b", (spec.label or spec.placeholder or spec.id).strip().lower())
        )
        if yesno_question:
            return "Yes"
        return "Authorized to work with an open work permit; no visa sponsorship required"
    return None


def resolve_relocation_default(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """'Willing to relocate to [X]?' — Yes when X is the candidate's city or
    anywhere in Poland; No when X is outside Poland. A plain "willing to
    relocate?" (no destination) -> Yes. One answer, never more.
    """
    text = field_text(spec)
    if not re.search(r"willing to (relocate|move)|\brelocat", text, re.IGNORECASE):
        return None
    is_select_yesno = (spec.type == "select" or bool(spec.options)) and any(
        _norm(o) in _YESNO_OPTIONS for o in spec.options
    )
    is_yesno_question = bool(
        re.search(r"^(are|do|would|could|can) you\b", (spec.label or spec.placeholder or spec.id).strip().lower())
    )
    if not is_select_yesno and not is_yesno_question:
        return None  # open text falls through to the profile's own relocation line

    match = re.search(
        r"(?:relocat\w*|moving|move)\s+(?:to|in|at)\s+((?:our |the |a |an )?[a-z][a-z\s\-]{1,40}?)[\?.,;!]",
        text,
        re.IGNORECASE,
    )
    dest = match.group(1).strip() if match else None
    if dest:
        dest = re.sub(r"^(our|the|a|an)\s+", "", dest, flags=re.IGNORECASE).strip()
    answer: str
    if dest is None or _GENERIC_DEST.search(dest) or any(city in dest for city in _POLAND_CITIES):
        answer = "Yes"
    else:
        answer = "No"
    if spec.type == "select" or spec.options:
        want = _norm(answer)
        for option in spec.options:
            if _norm(option) == want:
                return option
        return None
    if spec.type in ("text", "search"):
        return answer
    return None


_SALARY_NUMBER_ONLY = re.compile(r"numbers? only|numeric only|numeric value|integer only|digits only", re.IGNORECASE)

_SALARY_DEFAULT = (
    "I would prefer to discuss a reasonable salary range after learning more about "
    "the role and responsibilities with the team and hiring manager during the interview."
)


def resolve_salary_default(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Salary-expectation fields: the profile's figure when set; otherwise a
    one-sentence conversational default for string fields. Number-only inputs
    (type="number" or a "numbers only" hint) are skipped — no numeric guess.
    """
    text = field_text(spec)
    if not re.search(r"salary|compensation|pay expectation|pay range", text, re.IGNORECASE):
        return None
    own = (profile.desired_salary or "").strip()
    if own:
        if spec.type == "select" or spec.options:
            return match_option(own, spec.options)
        return own
    if spec.type == "number" or _SALARY_NUMBER_ONLY.search(text):
        return None
    if spec.type == "select" or spec.options:
        return None  # no numeric default to match — the AI picks from the options
    if spec.type in ("text", "search", "textarea"):
        return smart_truncate(_SALARY_DEFAULT, spec.max_length)
    return None


def resolve_availability_default(spec: FieldSpec, profile: CandidateProfile) -> str | None:
    """Availability / start-date fields: the profile's date when set; otherwise
    the next 1st/15th window (YYYY-MM-DD) — the soonest "immediate" start:
    before the 15th -> the 15th of this month; from the 15th -> the 1st of next
    month. Selects get an "Immediate"-style option first, then the date match.
    """
    text = field_text(spec)
    if not re.search(r"available from|availability|earliest start|start date|when can you start", text, re.IGNORECASE):
        return None
    own = (profile.available_from or "").strip()
    if own:
        if spec.type == "select" or spec.options:
            return match_option(own, spec.options)
        return own
    # The candidate's LOCAL date, not UTC — the availability window must follow
    # the user's calendar (a Poland user is UTC+1/+2 off server UTC).
    today = _date.today()  # noqa: DTZ011 — local date is the requirement here
    if today.day < 15:
        target = _date(today.year, today.month, 15)
    else:
        year = today.year + (1 if today.month == 12 else 0)
        month = 1 if today.month == 12 else today.month + 1
        target = _date(year, month, 1)
    iso = target.strftime("%Y-%m-%d")
    if spec.type == "select" or spec.options:
        for option in spec.options:
            if re.search(r"immediat", option, re.IGNORECASE):
                return option
        for option in spec.options:
            if _norm(option) == iso or iso in _norm(option):
                return option
        return None
    if spec.type in ("text", "search"):
        return iso
    return None


def _profile_value(key: str, profile: CandidateProfile) -> str:
    full = (profile.full_name or "").strip()
    parts = full.split()
    if key == "first_name":
        return (profile.first_name or "").strip() or (parts[0] if parts else "")
    if key == "last_name":
        return (profile.last_name or "").strip() or (parts[-1] if len(parts) > 1 else "")
    if key == "middle_name":
        return (profile.middle_name or "").strip() or (" ".join(parts[1:-1]) if len(parts) > 2 else "")
    if key == "full_name":
        return full
    if key == "location":
        return (profile.location or "").strip() or ", ".join(
            v for v in ((profile.city or "").strip(), (profile.country or "").strip()) if v
        )
    if key == "years_experience":
        years = profile.years_experience
        # Whole years (rounded down) — what forms asking "years of experience" expect.
        return "" if years is None else str(int(years))
    value = getattr(profile, key, None)
    return value.strip() if isinstance(value, str) else ""


def classify_kind(spec: FieldSpec) -> FieldKind:
    if spec.type == "select" or spec.options:
        return "choice"
    if spec.type == "textarea" or _LONG_HINT.search(field_text(spec)):
        return "long"
    return "short"


# ── Prompts ─────────────────────────────────────────────────────────────

FIELD_SYSTEM_PROMPT = (
    "You fill in ONE job-application form field on behalf of the candidate. "
    "Use only facts found in the candidate profile and job context. Never invent employers, "
    "dates, degrees, certifications, salaries or numbers, and never claim a skill, tool or domain the "
    "profile does not show. Anything listed under prepared_answers['Not in my experience'] is something "
    "the candidate does NOT have. If the profile does not contain the answer, reply with an empty value "
    "and confidence 0. Write plainly: short sentences, everyday words, plain hyphens (never em or en "
    "dashes), no markdown. Reply with ONLY a JSON object: "
    '{"value": "<text>", "confidence": <number 0..1>}. No commentary.'
)

_KEEP_IT_RELEVANT = (
    "Keep it simple and about THIS job: pick the two or three facts from the candidate profile that best "
    "match the job title and description (use candidate.skills_for_this_job, most relevant first) and "
    "leave out everything unrelated. No clichés ('passionate', 'excited', 'dynamic', 'synergy'), no lists."
)

_KIND_RULES: dict[str, str] = {
    "short": "Answer in one short line (a few words or a number).",
    "choice": "value MUST be copied exactly from `field.options`, or be empty if none fits.",
    "long": (
        "Write in the first person, 50-120 words. " + _KEEP_IT_RELEVANT
    ),
    "message": (
        "This is a short message to a recruiter or hiring manager. Write 3-5 short sentences (40-100 words) "
        "in the first person: one line on who the candidate is now, one or two lines on why they fit THIS "
        "job (name what the job asks for and the matching real experience, with one real number if the "
        "profile has one), and one line inviting a conversation. Start with 'Hello,' and end with "
        "'Best regards, <candidate full name>'. No subject line, no placeholders like [Company]. "
        + _KEEP_IT_RELEVANT
    ),
    "cover": (
        "Write a short cover letter in the first person, 120-200 words in two or three short paragraphs: "
        "the role and what the candidate does now; the strongest real evidence for this job; a one-line "
        "close. " + _KEEP_IT_RELEVANT
    ),
    "strength": (
        "This asks for the candidate's biggest strength for THIS role. Write a friendly, "
        "confident reply in 3-5 short sentences (60-120 words) in the first person: name the "
        "strength, then back it with the candidate's RECENT real experience (their most recent "
        "role and what it proves — see candidate.resume), and mention the skills that match "
        "this job (use candidate.skills_for_this_job, most relevant first). No clichés "
        "('passionate', 'hard worker', 'team player'), no lists. " + _KEEP_IT_RELEVANT
    ),
}

_MESSAGE_HINT = re.compile(
    r"recruiter|hiring (manager|team)|message|note to|note for|introduce yourself|introduction|"
    r"\bpitch\b|reach out|inmail|say hello"
)
_COVER_HINT = re.compile(r"cover letter|covering letter|motivation(al)? letter|letter of motivation")

_STRENGTH_HINT = re.compile(
    r"\b(?:biggest|greatest|strongest|key)\s+(?:strength|asset|point|quality)\b|"
    r"your\s+strengths?\b|what makes you a good candidate",
    re.IGNORECASE,
)

_GENDER_HINT = re.compile(r"\bgender\b|\bsex\b", re.IGNORECASE)
_GENDER_RULE = (
    " This asks for the candidate's gender. If candidate.gender is set, use it (for a "
    "drop-down: copy the matching option exactly). Otherwise infer the most likely "
    "option from the candidate's name alone and reply with it — a demographic form "
    "field, not a claim about skills or experience."
)


def long_style(spec: FieldSpec) -> str:
    """Which writing rules a long field gets: recruiter message, cover letter, strength, or a normal answer."""
    text = field_text(spec)
    if _STRENGTH_HINT.search(text):
        return "strength"
    if _COVER_HINT.search(text):
        return "cover"
    if _MESSAGE_HINT.search(text):
        return "message"
    return "long"


def _length_rule(spec: FieldSpec) -> str:
    if not spec.max_length:
        return ""
    words = max(3, spec.max_length // 7)
    return (
        f" HARD LIMIT: at most {spec.max_length} characters (about {words} words) including spaces. "
        "If space is short, keep only the most job-relevant points."
    )


def _profile_payload(profile: CandidateProfile, job: JobContext | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {k: v for k, v in profile.model_dump().items() if isinstance(v, str) and v.strip()}
    if profile.years_experience is not None:
        out["years_experience"] = profile.years_experience
    if profile.skills:
        out["skills_for_this_job"] = relevant_skills(profile.skills, job)
    answers = {q: a for q, a in profile.answers.items() if a.strip()}
    if answers:
        out["prepared_answers"] = answers
    return out


def build_field_task(
    spec: FieldSpec,
    kind: TaskKind,
    profile: CandidateProfile,
    job: JobContext | None,
    api_key: str,
) -> AITask:
    field_view: dict[str, Any] = {"label": spec.label or spec.placeholder or spec.id, "type": spec.type}
    if spec.placeholder:
        field_view["placeholder"] = spec.placeholder
    if spec.options:
        field_view["options"] = spec.options
    if spec.max_length:
        field_view["max_length"] = spec.max_length
    if spec.required:
        field_view["required"] = True
    job_view = {k: v for k, v in (job.model_dump() if job else {}).items() if v}
    rules = _KIND_RULES[long_style(spec) if kind == "long" else kind]
    if _GENDER_HINT.search(field_text(spec)):
        rules += _GENDER_RULE
    if kind in ("long", "short"):
        rules += _length_rule(spec)
    user = dumps_compact(
        {
            "field": field_view,
            "rules": rules,
            "candidate": _profile_payload(profile, job),
            "job": job_view,
        }
    )
    return AITask(
        kind=kind,
        field_id=spec.id,
        api_key=api_key,
        messages=[
            {"role": "system", "content": FIELD_SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        temperature=0.4 if kind == "long" else 0.1,
        max_tokens=_max_tokens(spec, kind),
    )


def _max_tokens(spec: FieldSpec, kind: TaskKind) -> int:
    if kind != "long":
        return 200
    if spec.max_length:
        # ~4 characters per token, plus room for the JSON wrapper and reasoning-style preambles.
        return max(160, min(900, spec.max_length // 3 + 120))
    return 700


# ── Validation ──────────────────────────────────────────────────────────

_NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def match_option(value: str, options: list[str]) -> str | None:
    """Map a model answer onto one of the select options (exact, then unique partial)."""
    target = _norm(value)
    if target == "":
        return None
    for option in options:
        if _norm(option) == target:
            return option
    partial = [o for o in options if _norm(o) and (target in _norm(o) or _norm(o) in target)]
    if len(partial) == 1:
        return partial[0]
    return None


def validate_answer(spec: FieldSpec, kind: TaskKind, raw: dict[str, Any]) -> tuple[str, float]:
    """Check a worker's JSON answer against the field. Raises ModelOutputError to force a retry."""
    value_raw = raw.get("value", "")
    if value_raw is None:
        value_raw = ""
    if isinstance(value_raw, (int, float)) and not isinstance(value_raw, bool):
        value_raw = str(value_raw)
    if not isinstance(value_raw, str):
        raise ModelOutputError("value is not a string")
    value = value_raw.strip()

    try:
        confidence = float(raw.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    if value == "":
        return "", 0.0

    if kind == "choice":
        matched = match_option(value, spec.options)
        if matched is None:
            raise ModelOutputError(f"answer {value[:40]!r} is not one of the options")
        value = matched
    elif spec.type == "number":
        found = _NUMBER_RE.search(value)
        if found is None:
            raise ModelOutputError("expected a number")
        value = found.group(0).replace(",", ".")
    elif spec.type == "email" and "@" not in value:
        raise ModelOutputError("expected an email address")

    if kind != "choice":
        value = plain_dashes(value)
    # Too long for the box: cut at a sentence / list item / word boundary, never mid-word.
    value = smart_truncate(value, spec.max_length)
    return value, confidence
