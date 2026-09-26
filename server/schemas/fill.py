# server/schemas/fill.py
"""Pydantic v2 models for POST /fill (coordinator + worker pool)."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

FieldType = Literal["text", "email", "tel", "number", "url", "search", "textarea", "select"]

ShortStr = Annotated[str, Field(max_length=500)]


class LanguageLevel(BaseModel):
    """One language and its level from the candidate's Markdown CV."""
    language: ShortStr = ""
    level: ShortStr = ""


class FieldSpec(BaseModel):
    """One fillable control described by the extension's content script."""

    id: Annotated[str, Field(min_length=1, max_length=200)]
    label: ShortStr = ""
    type: FieldType = "text"
    placeholder: ShortStr = ""
    options: Annotated[list[ShortStr], Field(max_length=300)] = []
    required: bool = False
    max_length: Annotated[int, Field(ge=1, le=100_000)] | None = None


class CandidateProfile(BaseModel):
    """What the candidate saved in the extension (typed in or imported from Markdown)."""

    full_name: ShortStr | None = None
    email: ShortStr | None = None
    phone: ShortStr | None = None
    headline: ShortStr | None = None
    summary: Annotated[str, Field(max_length=5_000)] | None = None
    resume: Annotated[str, Field(max_length=20_000)] | None = None
    # Structured fields from the Markdown template (all optional).
    first_name: ShortStr | None = None
    middle_name: ShortStr | None = None
    last_name: ShortStr | None = None
    city: ShortStr | None = None
    country: ShortStr | None = None
    location: ShortStr | None = None
    address: ShortStr | None = None
    postal_code: ShortStr | None = None
    linkedin: ShortStr | None = None
    github: ShortStr | None = None
    website: ShortStr | None = None
    work_authorization: ShortStr | None = None
    visa_sponsorship: ShortStr | None = None
    willing_to_relocate: ShortStr | None = None
    work_mode: ShortStr | None = None
    notice_period: ShortStr | None = None
    gender: ShortStr | None = None
    available_from: ShortStr | None = None
    desired_salary: ShortStr | None = None
    years_experience: Annotated[float, Field(ge=0, le=80)] | None = None
    # Skills in the candidate's own priority order (most important first). The server re-ranks
    # them against each job so length- or count-limited fields get the most relevant ones.
    skills: Annotated[list[Annotated[str, Field(max_length=120)]], Field(max_length=500)] = []
    languages: Annotated[list[LanguageLevel], Field(max_length=20)] = []
    companies: Annotated[list[ShortStr], Field(max_length=50)] = []
    answers: Annotated[dict[ShortStr, Annotated[str, Field(max_length=3_000)]], Field(max_length=60)] = {}


class JobContext(BaseModel):
    """Page context so long answers can be tailored to the role."""

    title: ShortStr | None = None
    company: ShortStr | None = None
    url: Annotated[str, Field(max_length=2_000)] | None = None
    description: Annotated[str, Field(max_length=8_000)] | None = None


class FillRequest(BaseModel):
    fields: Annotated[list[FieldSpec], Field(min_length=1, max_length=100)]
    profile: CandidateProfile = CandidateProfile()
    job: JobContext | None = None
    api_key: str | None = None


class FieldAnswer(BaseModel):
    value: str
    confidence: float
    source: Literal["profile", "ai", "none"]
    kind: Literal["profile", "short", "choice", "long"]
    worker_id: int | None = None
    model: str | None = None
    attempts: int = 0
    latency_ms: int = 0
    error: str | None = None


class FillStats(BaseModel):
    total_fields: int
    profile_fields: int
    ai_tasks: int
    workers_used: int
    models_used: list[str]
    duration_ms: int


class FillData(BaseModel):
    answers: dict[str, FieldAnswer]
    stats: FillStats


class FillResponse(BaseModel):
    status: Literal["ok"]
    data: FillData
