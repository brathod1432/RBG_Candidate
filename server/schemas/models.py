# server/schemas/models.py
"""Pydantic v2 request/response models for the /analyze proxy route."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field


class FormRequest(BaseModel):
    """Request payload for POST /analyze.

    Attributes:
        html: Raw HTML content to analyze. Must be 1-200,000 characters.
        api_key: Optional NVIDIA API key override. If omitted, uses server default.
    """

    html: Annotated[str, Field(min_length=1, max_length=200_000)]
    api_key: str | None = None


class AnalyzeData(BaseModel):
    """Structured analysis result returned by the NVIDIA model.

    Attributes:
        fields: Extracted key-value pairs from the form.
        stage: Processing stage indicator (1=initial, 2=enriched, etc.).
        confidence: Per-field confidence scores (0.0-1.0).
    """

    fields: dict[str, str]
    stage: int
    confidence: dict[str, float]


class AnalyzeResponse(BaseModel):
    """Successful response envelope for POST /analyze."""

    status: Literal["ok"]
    data: AnalyzeData


class ErrorResponse(BaseModel):
    """Error response envelope for all endpoints."""

    status: Literal["error"]
    message: str
    code: str