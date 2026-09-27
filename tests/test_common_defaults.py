# tests/test_common_defaults.py
"""D1/D2/D3/D7 default resolvers + D6 language ladder (CEFR → named options)."""

import re
from datetime import date as _d

from server.agents.relevance import plan_language_answers
from server.agents.tasks import (
    resolve_availability_default,
    resolve_relocation_default,
    resolve_salary_default,
    resolve_work_authorization_default,
)
from server.schemas.fill import CandidateProfile, FieldSpec, LanguageLevel


def spec(id_: str, label: str, type_: str = "text", **kw: object) -> FieldSpec:
    return FieldSpec.model_validate({"id": id_, "label": label, "type": type_, **kw})


class TestWorkAuthorizationDefault:
    """D1: work-authorization questions default to Yes (open work permit assumed)."""

    def test_yes_no_select_defaults_yes(self) -> None:
        out = resolve_work_authorization_default(
            spec("wa", "Are you authorized to work in Poland?", "select", options=["Yes", "No"]),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_yesno_text_question_defaults_yes(self) -> None:
        out = resolve_work_authorization_default(
            spec("wa", "Are you authorized to work in the United States?", "text"),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_right_to_work_question_defaults_yes(self) -> None:
        out = resolve_work_authorization_default(
            spec("wa", "Do you have the right to work in the UK?", "select", options=["Yes", "No"]),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_status_text_gets_sentence(self) -> None:
        out = resolve_work_authorization_default(
            spec("wa", "What is your work authorization status?", "text"),
            CandidateProfile(),
        )
        assert out == "Authorized to work with an open work permit; no visa sponsorship required"

    def test_profile_value_wins_over_default(self) -> None:
        out = resolve_work_authorization_default(
            spec(
                "wa",
                "Are you authorized to work in Poland?",
                "select",
                options=["Full work authorization", "Needs sponsorship"],
            ),
            CandidateProfile(work_authorization="Full work authorization"),
        )
        assert out == "Full work authorization"

    def test_unrelated_field_not_touched(self) -> None:
        out = resolve_work_authorization_default(spec("x", "Your favourite colour?", "text"), CandidateProfile())
        assert out is None


class TestRelocationDefault:
    """D2: relocation Yes/No by destination — Poland (any city) Yes, outside No."""

    def test_warsaw_destination_yes(self) -> None:
        out = resolve_relocation_default(
            spec("r", "Are you willing to relocate to Warsaw, Poland?", "select", options=["Yes", "No"]),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_other_polish_city_yes(self) -> None:
        out = resolve_relocation_default(
            spec("r", "Would you be willing to relocate to Krakow?", "text"),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_outside_poland_no(self) -> None:
        out = resolve_relocation_default(
            spec("r", "Are you willing to relocate to Berlin, Germany?", "select", options=["Yes", "No"]),
            CandidateProfile(),
        )
        assert out == "No"

    def test_plain_question_yes(self) -> None:
        out = resolve_relocation_default(
            spec("r", "Are you willing to relocate?", "text"),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_generic_destination_yes(self) -> None:
        out = resolve_relocation_default(
            spec("r", "Are you willing to relocate to a different city?", "text"),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_open_text_falls_to_profile_rule(self) -> None:
        # Open text is not a yes/no question — the default does not answer it;
        # resolve_from_profile fills the candidate's own relocation line.
        out = resolve_relocation_default(
            spec("r", "What is your relocation preference?", "text"),
            CandidateProfile(),
        )
        assert out is None

    def test_open_to_relocation_question_defaults_yes(self) -> None:
        # "Are you open to relocation?" is a relocation yes/no question — the
        # plain-question rule answers Yes (no destination outside Poland named).
        out = resolve_relocation_default(
            spec("r", "Are you open to relocation?", "select", options=["Yes", "No"]),
            CandidateProfile(),
        )
        assert out == "Yes"


class TestSalaryDefault:
    """D3: salary — conversational default for string fields; number inputs skipped."""

    def test_text_gets_conversational_default(self) -> None:
        out = resolve_salary_default(spec("s", "Salary expectation", "text"), CandidateProfile())
        assert out is not None
        assert "reasonable salary range" in out
        assert "interview" in out

    def test_number_input_skipped(self) -> None:
        out = resolve_salary_default(spec("s", "Expected salary", "number"), CandidateProfile())
        assert out is None

    def test_numbers_only_hint_skipped(self) -> None:
        out = resolve_salary_default(spec("s", "Expected salary (numbers only)", "text"), CandidateProfile())
        assert out is None

    def test_profile_figure_wins(self) -> None:
        out = resolve_salary_default(
            spec("s", "Salary expectation", "text"),
            CandidateProfile(desired_salary="15 000 PLN"),
        )
        assert out == "15 000 PLN"

    def test_select_left_for_ai(self) -> None:
        out = resolve_salary_default(
            spec("s", "Salary range", "select", options=["<50k", "50-70k"]),
            CandidateProfile(),
        )
        assert out is None


class TestAvailabilityDefault:
    """D7: availability — the next 1st/15th window (YYYY-MM-DD); Immediate select first."""

    def test_text_gets_next_window(self) -> None:
        out = resolve_availability_default(spec("a", "Available from", "text"), CandidateProfile())
        assert out is not None
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", out)
        today = _d.today()  # noqa: DTZ011 — mirrors the resolver's local-date rule
        if today.day < 15:
            expected = f"{today.year:04d}-{today.month:02d}-15"
        else:
            year = today.year + (1 if today.month == 12 else 0)
            month = 1 if today.month == 12 else today.month + 1
            expected = f"{year:04d}-{month:02d}-01"
        assert out == expected

    def test_select_immediate_first(self) -> None:
        out = resolve_availability_default(
            spec("a", "Availability", "select", options=["In 2 weeks", "Immediate", "Next month"]),
            CandidateProfile(),
        )
        assert out == "Immediate"

    def test_profile_date_wins(self) -> None:
        out = resolve_availability_default(
            spec("a", "Available from", "text"),
            CandidateProfile(available_from="2026-10-01"),
        )
        assert out == "2026-10-01"

    def test_unrelated_not_touched(self) -> None:
        out = resolve_availability_default(spec("a", "Your notice period", "text"), CandidateProfile())
        assert out is None


class TestLanguageLadder:
    """D6: CEFR levels match named options via the ladder; English C2 default."""

    def test_c2_matches_native_option(self) -> None:
        profile = CandidateProfile(
            languages=[LanguageLevel(language="English", level="C2 (full professional proficiency)")]
        )
        out = plan_language_answers(
            [spec("eng", "What is your English level?", "select", options=["Native", "Fluent", "Intermediate"])],
            profile,
        )
        assert out["eng"] == "Native"

    def test_a2_matches_limited_working(self) -> None:
        profile = CandidateProfile(
            languages=[LanguageLevel(language="Polish", level="A2 (limited working proficiency)")]
        )
        out = plan_language_answers(
            [
                spec(
                    "pol",
                    "What is your Polish level?",
                    "select",
                    options=["Native", "Fluent", "Limited working proficiency", "Basic"],
                )
            ],
            profile,
        )
        assert out["pol"] == "Limited working proficiency"

    def test_english_default_native_when_available(self) -> None:
        out = plan_language_answers(
            [spec("eng", "What is your English level?", "select", options=["Native", "Fluent"])],
            CandidateProfile(),
        )
        assert out["eng"] == "Native"

    def test_english_default_falls_to_fluent(self) -> None:
        out = plan_language_answers(
            [spec("eng", "What is your English level?", "select", options=["Fluent", "Intermediate", "Basic"])],
            CandidateProfile(),
        )
        assert out["eng"] == "Fluent"

    def test_english_default_text_field(self) -> None:
        out = plan_language_answers([spec("eng", "What is your English level?", "text")], CandidateProfile())
        assert out is not None
        assert "C2" in out["eng"]

    def test_generic_language_field_defaults_english(self) -> None:
        out = plan_language_answers([spec("lang", "Languages", "text")], CandidateProfile())
        assert out["lang"] == "English"
