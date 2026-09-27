# tests/test_schemas.py
"""Schema validation tests for request/response models."""

import pytest
from pydantic import ValidationError

from server.schemas import AnalyzeData, AnalyzeResponse, ErrorResponse, FormRequest


class TestFormRequest:
    """Tests for FormRequest schema."""

    def test_valid_html_accepted(self) -> None:
        """Valid HTML (1-200k chars) is accepted."""
        req = FormRequest(html="<form></form>")
        assert req.html == "<form></form>"
        assert req.api_key is None

    def test_valid_with_api_key(self) -> None:
        """Optional api_key field is accepted."""
        req = FormRequest(html="<form></form>", api_key="test-key")
        assert req.api_key == "test-key"

    def test_empty_html_rejected(self) -> None:
        """Empty HTML string raises ValidationError."""
        with pytest.raises(ValidationError) as exc:
            FormRequest(html="")
        assert "string_too_short" in str(exc.value)

    def test_html_too_long_rejected(self) -> None:
        """HTML > 200k chars raises ValidationError."""
        long_html = "x" * 200_001
        with pytest.raises(ValidationError) as exc:
            FormRequest(html=long_html)
        assert "string_too_long" in str(exc.value)


class TestAnalyzeData:
    """Tests for AnalyzeData schema."""

    def test_valid_data(self) -> None:
        """Valid analysis data is accepted."""
        data = AnalyzeData(
            fields={"email": "test@example.com"},
            stage=1,
            confidence={"email": 0.95},
        )
        assert data.fields == {"email": "test@example.com"}
        assert data.stage == 1
        assert data.confidence == {"email": 0.95}


class TestAnalyzeResponse:
    """Tests for AnalyzeResponse schema."""

    def test_valid_response(self) -> None:
        """Valid response envelope is accepted."""
        resp = AnalyzeResponse(
            status="ok",
            data={"fields": {}, "stage": 1, "confidence": {}},
        )
        assert resp.status == "ok"
        assert isinstance(resp.data, AnalyzeData)

    def test_invalid_status_rejected(self) -> None:
        """Non-'ok' status raises ValidationError."""
        with pytest.raises(ValidationError):
            AnalyzeResponse(status="error", data={})


class TestErrorResponse:
    """Tests for ErrorResponse schema."""

    def test_valid_error(self) -> None:
        """Valid error envelope is accepted."""
        err = ErrorResponse(status="error", message="Failed", code="ERR_CODE")
        assert err.status == "error"
        assert err.message == "Failed"
        assert err.code == "ERR_CODE"

    def test_invalid_status_rejected(self) -> None:
        """Non-'error' status raises ValidationError."""
        with pytest.raises(ValidationError):
            ErrorResponse(status="ok", message="Failed", code="ERR_CODE")