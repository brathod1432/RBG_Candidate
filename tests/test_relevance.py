# tests/test_relevance.py
"""Skill ranking, limit-aware filling and simple job-related messages."""

import json

import httpx
import pytest
import respx
from httpx import AsyncClient

from server.agents.relevance import (
    base_key,
    fit_items,
    language_of,
    plan_language_answers,
    plan_skill_answers,
    plain_dashes,
    profile_level,
    rank_skills,
    skill_field,
    smart_truncate,
)
from server.agents.tasks import (
    build_field_task,
    classify_kind,
    long_style,
    resolve_current_employer_default,
    resolve_gender_default,
    resolve_location_preference_default,
    resolve_notice_default,
    resolve_office_frequency,
    resolve_work_model_yesno,
    resolve_work_permit,
    validate_answer,
)
from server.schemas.fill import CandidateProfile, FieldSpec, JobContext, LanguageLevel

CHAT = "https://integrate.api.nvidia.com/v1/chat/completions"

SKILLS = [
    "Python", "Pytest", "Robot Framework", "Playwright", "Selenium WebDriver", "Jenkins", "Groovy",
    "Docker", "Kubernetes (working knowledge)", "REST API Testing", "Postman", "Linux", "VMware ESXi",
    "Python 3.11", "Java 8", "Go", "MATLAB", "Fibre Channel over Ethernet (FCoE)", "Leadership",
]

JOB = JobContext(
    title="Senior QA Automation Engineer (Java)",
    description=(
        "We need strong Java and Selenium skills. You will build API tests with Postman and REST Assured, "
        "run suites in Docker and K8s, and own CI/CD in GitHub Actions. Nice to have: Kubernetes, Postman."
    ),
)


def spec(id_: str, label: str, type_: str = "text", **kw: object) -> FieldSpec:
    return FieldSpec.model_validate({"id": id_, "label": label, "type": type_, **kw})


class TestRanking:
    def test_job_matched_skills_come_first_and_ties_keep_candidate_order(self) -> None:
        ranked = rank_skills(SKILLS, JOB)
        # Title match (Java) beats description-only matches; repeated Postman/Kubernetes beat single ones.
        assert ranked[0] == "Java 8"
        top = ranked[:5]
        assert set(top) == {"Java 8", "Selenium WebDriver", "Postman", "Kubernetes (working knowledge)", "Docker"}
        # Unmatched skills follow in the candidate's own order.
        # "REST API Testing" gets partial credit ("API tests", "REST Assured"); unmatched ones then
        # follow in the candidate's own order.
        rest = [s for s in ranked if s not in top]
        assert rest[0] == "REST API Testing"
        assert rest[1:4] == ["Python", "Pytest", "Robot Framework"]

    def test_versions_collapse_and_short_names_need_real_casing(self) -> None:
        ranked = rank_skills(SKILLS, JobContext(title="Engineer", description="Ready to go? Python 3.12 please."))
        assert "Python 3.11" not in ranked  # duplicate of Python
        assert ranked[0] == "Python"
        assert ranked.index("Go") > 5  # "go" the verb is not the Go language
        assert rank_skills(["Pytest", "Go"], JobContext(title="Go Developer"))[0] == "Go"

    def test_bracketed_short_forms_and_aliases_count(self) -> None:
        ranked = rank_skills(SKILLS, JobContext(description="Experience with FCoE fabrics and k8s"))
        assert ranked[:2] == ["Kubernetes (working knowledge)", "Fibre Channel over Ethernet (FCoE)"] or ranked[:2] == [
            "Fibre Channel over Ethernet (FCoE)", "Kubernetes (working knowledge)"]

    def test_no_job_keeps_candidate_order(self) -> None:
        assert rank_skills(SKILLS, None)[:3] == ["Python", "Pytest", "Robot Framework"]

    def test_base_key(self) -> None:
        assert base_key("Python 3.11") == base_key("Python") == "python"
        assert base_key("Pydantic v2") == "pydantic"
        assert base_key("Kubernetes (working knowledge)") == "kubernetes"


class TestFitting:
    def test_fit_items_keeps_whole_items_in_priority_order(self) -> None:
        assert fit_items(["Python", "Robot Framework", "Go", "SQL"], 20) == "Python, Go, SQL"
        assert fit_items(["a", "b", "c"], None, max_items=2) == "a, b"

    def test_smart_truncate_prefers_sentence_then_word(self) -> None:
        text = "I build Python test frameworks. I cut regression from four weeks to five days. More."
        assert smart_truncate(text, 60) == "I build Python test frameworks."
        cut = smart_truncate("Automation engineer building reliable pipelines everywhere", 30)
        assert cut == "Automation engineer building"
        assert smart_truncate("short", 30) == "short"
        assert smart_truncate("Python, Pytest, Robot Framework, Jenkins", 25) == "Python, Pytest"

    def test_plain_dashes(self) -> None:
        assert plain_dashes("Dell — Warsaw, 2020–2022") == "Dell - Warsaw, 2020-2022"


class TestSkillFields:
    def test_detection(self) -> None:
        assert skill_field(spec("s", "Key skills")).mode == "list"  # type: ignore[union-attr]
        assert skill_field(spec("s", "List your top 5 skills")).max_items == 5  # type: ignore[union-attr]
        assert skill_field(spec("skill_3", "Skill 3")).slot == 3  # type: ignore[union-attr]
        assert skill_field(spec("p", "Primary skill")).mode == "slot"  # type: ignore[union-attr]
        assert skill_field(spec("t", "Main technology", "select", options=["Java", "Python"])).mode == "choice"  # type: ignore[union-attr]
        assert skill_field(spec("y", "How many years of Python experience do you have?")) is None
        assert skill_field(spec("d", "Describe your technical skills", "textarea")) is None
        assert skill_field(spec("n", "First name")) is None

    def test_plan_fills_lists_slots_and_choices_by_relevance(self) -> None:
        profile = CandidateProfile(skills=SKILLS)
        fields = [
            spec("s2", "Skill 2"),
            spec("s1", "Skill 1"),
            spec("list", "Key skills", max_length=40),
            spec("pick", "Primary technology", "select", options=["C#", "Python", "Java"]),
            spec("top3", "Top 3 skills", "textarea"),
            spec("name", "First name"),
        ]
        out = plan_skill_answers(fields, profile, JOB)
        ranked = rank_skills(SKILLS, JOB)
        assert out["s1"] == ranked[0] == "Java 8"
        assert out["s2"] == ranked[1]
        assert len(out["list"]) <= 40 and out["list"].startswith("Java 8, ")
        assert all(item in SKILLS for item in out["list"].split(", "))
        assert out["pick"] == "Java"
        assert len(out["top3"].split(", ")) == 3
        assert "name" not in out

    def test_plan_is_empty_without_skills(self) -> None:
        assert plan_skill_answers([spec("s", "Skills")], CandidateProfile(), JOB) == {}


class TestMessages:
    def test_recruiter_message_gets_simple_job_related_rules(self) -> None:
        field = spec("msg", "Message to the recruiter", "textarea", max_length=600)
        assert classify_kind(field) == "long" and long_style(field) == "message"
        task = build_field_task(field, "long", CandidateProfile(full_name="Ada", skills=SKILLS), JOB, "k")
        user = json.loads(task.messages[1]["content"])
        assert "Hello," in user["rules"] and "THIS job" in user["rules"]
        assert "600 characters" in user["rules"]
        assert user["candidate"]["skills_for_this_job"][0] == "Java 8"
        assert "em or en" in task.messages[0]["content"]

    def test_text_input_message_is_long_and_cover_letter_style(self) -> None:
        assert classify_kind(spec("m", "Note to hiring manager")) == "long"
        assert long_style(spec("c", "Cover letter", "textarea")) == "cover"
        assert long_style(spec("w", "Why do you want this job?", "textarea")) == "long"

    def test_long_answers_are_cut_cleanly_and_dashes_fixed(self) -> None:
        field = spec("why", "Why us?", "textarea", max_length=50)
        value, _ = validate_answer(
            field, "long", {"value": "I test storage — at scale. I also lead a team of engineers.", "confidence": 0.9}
        )
        assert value == "I test storage - at scale."
        choice = spec("c", "Pick", "select", options=["A — B"])
        assert validate_answer(choice, "choice", {"value": "A — B"})[0] == "A — B"


class TestStrength:
    def test_strength_style_detected(self) -> None:
        assert long_style(spec("s", "What do you consider to be your biggest strength that makes you a good candidate for this role?", "textarea")) == "strength"
        assert long_style(spec("w", "Why do you want this job?", "textarea")) == "long"
        assert long_style(spec("c", "Cover letter", "textarea")) == "cover"
        assert long_style(spec("m", "Message to the recruiter", "textarea")) == "message"

    def test_build_field_task_strength_includes_recent_and_skills(self) -> None:
        field = spec("s", "What do you consider to be your biggest strength that makes you a good candidate for this role?", "textarea", max_length=500)
        profile = CandidateProfile(full_name="Ada Lovelace", skills=SKILLS)
        task = build_field_task(field, "long", profile, JOB, "k")
        user = json.loads(task.messages[1]["content"])
        assert "biggest strength" in user["rules"]
        assert "RECENT" in user["rules"]
        assert user["candidate"]["skills_for_this_job"][0] == "Java 8"

    def test_strength_task_includes_hard_limit(self) -> None:
        field = spec("s", "What is your biggest strength?", "textarea", max_length=200)
        profile = CandidateProfile(full_name="Ada", skills=SKILLS)
        task = build_field_task(field, "long", profile, JOB, "k")
        user = json.loads(task.messages[1]["content"])
        assert "200 characters" in user["rules"]


class TestNoticeDefault:
    def test_select_immediate_first_when_empty_profile(self) -> None:
        s = spec("np", "Notice period", "select", options=["Immediate", "2 weeks", "1 month"])
        assert resolve_notice_default(s, CandidateProfile()) == "Immediate"

    def test_select_two_weeks_when_no_immediate(self) -> None:
        s = spec("np", "Notice period", "select", options=["2 weeks", "1 month"])
        assert resolve_notice_default(s, CandidateProfile()) == "2 weeks"

    def test_select_profile_value_wins_when_matches_option(self) -> None:
        s = spec("np", "Notice period", "select", options=["1 month", "2 weeks", "Immediate"])
        profile = CandidateProfile(notice_period="1 month")
        assert resolve_notice_default(s, profile) == "1 month"

    def test_select_no_match_returns_none_stays_with_ai(self) -> None:
        s = spec("np", "Notice period", "select", options=["1 month", "3 months"])
        assert resolve_notice_default(s, CandidateProfile()) is None

    def test_text_field_empty_profile_returns_immediately(self) -> None:
        s = spec("np", "Notice period", "text")
        assert resolve_notice_default(s, CandidateProfile()) == "Immediately"

    def test_text_field_with_profile_value_resolved_via_existing_rule(self) -> None:
        # resolve_from_profile handles text fields with profile notice_period
        s = spec("np", "Notice period", "text")
        profile = CandidateProfile(notice_period="1 month")
        assert resolve_notice_default(s, profile) is None  # default not used when profile has value

    def test_non_notice_field_returns_none(self) -> None:
        s = spec("fn", "First name", "text")
        assert resolve_notice_default(s, CandidateProfile()) is None


class TestGenderDefault:
    def test_select_male_matches_option(self) -> None:
        s = spec("gender", "Gender", "select", options=["Male", "Female", "Prefer not to say"])
        profile = CandidateProfile(gender="male")
        assert resolve_gender_default(s, profile) == "Male"

    def test_select_partial_match_male(self) -> None:
        s = spec("gender", "Gender", "select", options=["M", "F"])
        profile = CandidateProfile(gender="male")
        assert resolve_gender_default(s, profile) == "M"

    def test_text_field_female(self) -> None:
        s = spec("gender", "Gender", "text")
        profile = CandidateProfile(gender="female")
        assert resolve_gender_default(s, profile) == "female"

    def test_select_empty_profile_returns_none_goes_to_ai(self) -> None:
        s = spec("gender", "Gender", "select", options=["Male", "Female"])
        assert resolve_gender_default(s, CandidateProfile()) is None

    def test_non_gender_field_returns_none(self) -> None:
        s = spec("fn", "First name", "text")
        assert resolve_gender_default(s, CandidateProfile()) is None

    def test_build_field_task_gender_select_empty_profile_includes_inference_rule(self) -> None:
        s = spec("gender", "Gender", "select", options=["Male", "Female"])
        profile = CandidateProfile(full_name="John Doe")
        task = build_field_task(s, "choice", profile, None, "key")
        user = json.loads(task.messages[1]["content"])
        assert "infer the most likely option from the candidate's name" in user["rules"]


class TestLanguages:
    def test_sibling_propagation_english_level_fields(self) -> None:
        profile = CandidateProfile(
            languages=[
                LanguageLevel(language="English", level="fluent"),
                LanguageLevel(language="Polish", level="intermediate"),
            ]
        )
        fields = [
            spec("eng_written", "English written level", "text"),
            spec("eng_spoken", "English spoken", "text"),
            spec("eng_reading", "English reading", "text"),
        ]
        out = plan_language_answers(fields, profile)
        assert out["eng_written"] == "fluent"
        assert out["eng_spoken"] == "fluent"
        assert out["eng_reading"] == "fluent"

    def test_polish_level_field(self) -> None:
        profile = CandidateProfile(
            languages=[
                LanguageLevel(language="English", level="fluent"),
                LanguageLevel(language="Polish", level="intermediate"),
            ]
        )
        fields = [spec("pol_level", "Polish level", "text")]
        out = plan_language_answers(fields, profile)
        assert out["pol_level"] == "intermediate"

    def test_select_english_level_matches_option(self) -> None:
        profile = CandidateProfile(
            languages=[LanguageLevel(language="English", level="native")]
        )
        fields = [
            spec("eng_sel", "English level", "select", options=["Native", "Fluent", "Intermediate"])
        ]
        out = plan_language_answers(fields, profile)
        assert out["eng_sel"] == "Native"

    def test_level_field_no_language_defaults_to_english(self) -> None:
        profile = CandidateProfile(
            languages=[LanguageLevel(language="English", level="fluent")]
        )
        fields = [spec("written_lvl", "Written level", "text")]
        out = plan_language_answers(fields, profile)
        assert out["written_lvl"] == "fluent"

    def test_generic_languages_field_gets_top_language(self) -> None:
        profile = CandidateProfile(
            languages=[
                LanguageLevel(language="English", level="fluent"),
                LanguageLevel(language="Polish", level="intermediate"),
            ]
        )
        fields = [spec("langs", "Languages", "text")]
        out = plan_language_answers(fields, profile)
        assert out["langs"] == "English"

    def test_no_profile_languages_returns_empty(self) -> None:
        fields = [spec("eng_written", "English written level", "text")]
        out = plan_language_answers(fields, CandidateProfile())
        assert out == {}

    def test_non_language_field_not_in_output(self) -> None:
        profile = CandidateProfile(
            languages=[LanguageLevel(language="English", level="fluent")]
        )
        fields = [spec("fn", "First name", "text")]
        out = plan_language_answers(fields, profile)
        assert out == {}

    def test_language_of_detects_english(self) -> None:
        assert language_of("English written level") == "english"
        assert language_of("English spoken proficiency") == "english"
        assert language_of("First name") is None

    def test_profile_level_returns_level(self) -> None:
        langs = [
            LanguageLevel(language="English", level="fluent"),
            LanguageLevel(language="Polish", level="intermediate"),
        ]
        assert profile_level(langs, "english") == "fluent"
        assert profile_level(langs, "polish") == "intermediate"
        assert profile_level(langs, "german") is None


class TestCurrentEmployer:
    def test_not_working_at_applying_company(self) -> None:
        profile = CandidateProfile(companies=["Dell", "Nokia"])
        job = JobContext(company="Google")
        fields = [spec("ce", "Are you currently working at Google?", "text")]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out == "No"

    def test_working_at_applying_company(self) -> None:
        profile = CandidateProfile(companies=["Dell", "Nokia"])
        job = JobContext(company="Dell")
        fields = [spec("ce", "Are you currently working at Dell?", "text")]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out == "Yes"

    def test_label_names_experience_company(self) -> None:
        profile = CandidateProfile(companies=["Dell", "Nokia"])
        job = JobContext(company="Google")
        fields = [spec("ce", "Are you currently working at Nokia?", "text")]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out == "Yes"

    def test_select_no_at_applying_company(self) -> None:
        profile = CandidateProfile(companies=["Dell", "Nokia"])
        job = JobContext(company="Google")
        fields = [spec("ce", "Are you currently working at Google?", "select", options=["Yes", "No"])]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out == "No"

    def test_select_yes_at_applying_company(self) -> None:
        profile = CandidateProfile(companies=["Dell", "Nokia"])
        job = JobContext(company="Dell")
        fields = [spec("ce", "Are you currently working at Dell?", "select", options=["Yes", "No"])]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out == "Yes"

    def test_select_non_yesno_options_returns_none(self) -> None:
        profile = CandidateProfile(companies=["Dell", "Nokia"])
        job = JobContext(company="Google")
        fields = [spec("ce", "Are you currently working at Google?", "select", options=["Dell", "Google"])]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out is None

    def test_empty_profile_companies_defaults_no(self) -> None:
        profile = CandidateProfile(companies=[])
        job = JobContext(company="Google")
        fields = [spec("ce", "Are you currently working at Google?", "text")]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out == "No"

    def test_notice_text_maxlength_ladder(self) -> None:
        assert resolve_notice_default(spec("np", "Notice period", "text", max_length=20), CandidateProfile()) == "Immediately"
        assert resolve_notice_default(spec("np", "Notice period", "text", max_length=10), CandidateProfile()) == "Immediate"
        assert resolve_notice_default(spec("np", "Notice period", "text", max_length=5), CandidateProfile()) == "Now"
        assert resolve_notice_default(spec("np", "Notice period", "text", max_length=2), CandidateProfile()) == "Im"

    def test_notice_text_profile_value_beats_maxlength(self) -> None:
        # A profile value wins over the default even when it exceeds max_length
        # (the coordinator smart-truncates the resolved value).
        assert (
            resolve_notice_default(spec("np", "Notice period", "text", max_length=5), CandidateProfile(notice_period="2 weeks"))
            is None
        )

    def test_non_matching_field_returns_none(self) -> None:
        profile = CandidateProfile(companies=["Dell"])
        job = JobContext(company="Google")
        fields = [spec("fn", "First name", "text")]
        out = resolve_current_employer_default(fields[0], profile, job)
        assert out is None


class TestLocationPreference:
    def test_both_location_and_mode(self) -> None:
        profile = CandidateProfile(
            location="Warsaw, Poland",
            work_mode="hybrid (2-3 days from the office)"
        )
        fields = [spec("lp", "What are your preferences regarding location and the way of working (willing to work remote/in hybrid model/etc)?", "textarea")]
        out = resolve_location_preference_default(fields[0], profile)
        assert out == "Warsaw, Poland. Hybrid (2-3 days from the office)."

    def test_location_only(self) -> None:
        profile = CandidateProfile(location="Warsaw, Poland")
        fields = [spec("lp", "What are your preferences regarding location and the way of working?", "textarea")]
        out = resolve_location_preference_default(fields[0], profile)
        assert out == "Warsaw, Poland."

    def test_mode_only(self) -> None:
        profile = CandidateProfile(work_mode="hybrid (2-3 days from the office)")
        fields = [spec("lp", "What are your preferences regarding location and the way of working?", "textarea")]
        out = resolve_location_preference_default(fields[0], profile)
        assert out == "Hybrid (2-3 days from the office)."

    def test_select_work_mode_matches_option(self) -> None:
        profile = CandidateProfile(work_mode="hybrid")
        fields = [spec("wm", "Preferred work mode", "select", options=["Remote", "Hybrid", "On-site"])]
        out = resolve_location_preference_default(fields[0], profile)
        assert out == "Hybrid"

    def test_select_work_mode_no_match(self) -> None:
        profile = CandidateProfile(work_mode="hybrid")
        fields = [spec("wm", "Preferred work mode", "select", options=["Remote", "On-site"])]
        out = resolve_location_preference_default(fields[0], profile)
        assert out is None

    def test_empty_profile_returns_none(self) -> None:
        profile = CandidateProfile()
        fields = [spec("lp", "What are your preferences regarding location and the way of working?", "textarea")]
        out = resolve_location_preference_default(fields[0], profile)
        assert out is None

    def test_bare_location_label_returns_none(self) -> None:
        profile = CandidateProfile(location="Warsaw, Poland")
        fields = [spec("loc", "Location", "text")]
        out = resolve_location_preference_default(fields[0], profile)
        assert out is None

    def test_non_matching_field_returns_none(self) -> None:
        profile = CandidateProfile(location="Warsaw, Poland", work_mode="hybrid")
        fields = [spec("fn", "First name", "text")]
        out = resolve_location_preference_default(fields[0], profile)
        assert out is None


class TestWorkDefaults:
    def test_work_model_hybrid_yes(self) -> None:
        profile = CandidateProfile(work_mode="hybrid (2-3 days from the office)")
        out = resolve_work_model_yesno(
            spec("wm", "Would you be able to work in a hybrid work model?", "select", options=["Yes", "No"]), profile
        )
        assert out == "Yes"

    def test_work_model_explicit_contradiction_no(self) -> None:
        profile = CandidateProfile(work_mode="on-site only")
        out = resolve_work_model_yesno(
            spec("wm", "Would you be able to work in a hybrid work model?", "select", options=["Yes", "No"]), profile
        )
        assert out == "No"

    def test_work_model_no_profile_yes(self) -> None:
        out = resolve_work_model_yesno(
            spec("wm", "Would you be able to work in a hybrid work model?", "select", options=["Yes", "No"]),
            CandidateProfile(),
        )
        assert out == "Yes"

    def test_work_model_text_answer(self) -> None:
        out = resolve_work_model_yesno(
            spec("wm", "Would you be able to work in a hybrid work model?", "text"), CandidateProfile()
        )
        assert out == "Yes"

    def test_office_frequency_from_work_mode(self) -> None:
        profile = CandidateProfile(work_mode="hybrid (2-3 days from the office)")
        out = resolve_office_frequency(spec("of", "How often would you be able to work from the office?", "text"), profile)
        assert out == "2-3 days from the office"

    def test_office_frequency_select(self) -> None:
        profile = CandidateProfile(work_mode="hybrid (2-3 days from the office)")
        out = resolve_office_frequency(
            spec("of", "How often would you be able to work from the office?", "select", options=["1 day", "2-3 days", "5 days"]),
            profile,
        )
        assert out == "2-3 days"

    def test_office_frequency_no_mode_defaults_hard(self) -> None:
        # The user's default: even with no work mode, the frequency question is
        # answered "2-3 days from the office" (the hard default), not left for the AI.
        out = resolve_office_frequency(spec("of", "How often would you be able to work from the office?", "text"), CandidateProfile())
        assert out == "2-3 days from the office"

    def test_work_permit_no(self) -> None:
        out = resolve_work_permit(
            spec("wp", "Would you require a work permit to work in Google?", "select", options=["Yes", "No"]), CandidateProfile()
        )
        assert out == "No"

    def test_work_permit_profile_requires_yes(self) -> None:
        out = resolve_work_permit(
            spec("wp", "Would you require a work permit to work in Google?", "select", options=["Yes", "No"]),
            CandidateProfile(visa_sponsorship="yes, sponsored"),
        )
        assert out == "Yes"

    def test_work_permit_text_answer(self) -> None:
        out = resolve_work_permit(spec("wp", "Would you require a work permit to work in Google?", "text"), CandidateProfile())
        assert out == "No"

    def test_office_frequency_fuzzy_select(self) -> None:
        # Differently-worded options: the token overlap picks the one that suits best.
        profile = CandidateProfile(work_mode="hybrid (2-3 days from the office)")
        out = resolve_office_frequency(
            spec(
                "of",
                "How often would you be able to work from the office?",
                "select",
                options=["Every day", "2-3 days a week", "Occasionally", "Never"],
            ),
            profile,
        )
        assert out == "2-3 days a week"

    def test_office_frequency_hard_default_no_mode(self) -> None:
        out = resolve_office_frequency(
            spec(
                "of",
                "How often would you be able to work from the office?",
                "select",
                options=["Every day", "2-3 days a week", "Never"],
            ),
            CandidateProfile(),
        )
        assert out == "2-3 days a week"

    def test_office_frequency_hard_default_text(self) -> None:
        out = resolve_office_frequency(spec("of", "How often would you be able to work from the office?", "text"), CandidateProfile())
        assert out == "2-3 days from the office"


class TestFillEndpointSkills:
    @pytest.mark.asyncio
    async def test_skill_fields_filled_without_ai_and_ranked(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "skills", "label": "Key skills", "type": "text", "max_length": 30},
                {"id": "s1", "label": "Skill 1", "type": "text"},
                {"id": "why", "label": "Message to the recruiter", "type": "textarea", "max_length": 200},
            ],
            "profile": {"full_name": "Ada Lovelace", "skills": SKILLS},
            "job": JOB.model_dump(),
        }

        def reply(request: httpx.Request) -> httpx.Response:
            content = json.dumps({"value": "Hello, I build Java and Selenium suites. " * 8, "confidence": 0.8})
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=reply)
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["s1"]["value"] == "Java 8" and a["s1"]["source"] == "profile"
        assert a["skills"]["value"].startswith("Java 8") and len(a["skills"]["value"]) <= 30
        assert len(a["why"]["value"]) <= 200 and a["why"]["value"].endswith(".")
        assert route.call_count == 1  # only the message needed a model


class TestFillEndpointDefaults:
    """Endpoint-level checks for the default behaviors (D-series + notice period)."""

    @pytest.mark.asyncio
    async def test_notice_select_immediate_without_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "notice", "label": "Notice period", "type": "select", "options": ["Immediate", "2 weeks", "1 month"]}
            ],
            "profile": {"full_name": "Ada Lovelace"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["notice"]["value"] == "Immediate"
        assert a["notice"]["source"] == "profile"
        assert route.call_count == 0  # the default needs no model

    @pytest.mark.asyncio
    async def test_notice_text_immediately_without_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "notice", "label": "Notice period", "type": "text"}],
            "profile": {"full_name": "Ada Lovelace"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["notice"]["value"] == "Immediately"
        assert a["notice"]["source"] == "profile"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_notice_profile_value_wins(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "notice", "label": "Notice period", "type": "select", "options": ["Immediate", "2 weeks", "1 month"]}
            ],
            "profile": {"full_name": "Ada Lovelace", "notice_period": "2 weeks"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["notice"]["value"] == "2 weeks"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_notice_no_matching_option_goes_to_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "notice", "label": "Notice period", "type": "select", "options": ["1 month", "3 months"]}
            ],
            "profile": {"full_name": "Ada Lovelace"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(
                side_effect=lambda r: httpx.Response(
                    200, json={"choices": [{"message": {"content": json.dumps({"value": "1 month", "confidence": 0.8})}}]}
                )
            )
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["notice"]["value"] == "1 month"
        assert a["notice"]["source"] == "ai"
        assert route.call_count == 1  # no default option -> the AI picks

    @pytest.mark.asyncio
    async def test_gender_profile_value_wins(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "gender", "label": "Gender", "type": "select", "options": ["Male", "Female"]}],
            "profile": {"full_name": "Ada Lovelace", "gender": "male"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["gender"]["value"] == "Male"
        assert a["gender"]["source"] == "profile"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_gender_no_profile_goes_to_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "gender", "label": "Gender", "type": "select", "options": ["Male", "Female"]}],
            "profile": {"full_name": "Ada Lovelace"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(
                side_effect=lambda r: httpx.Response(
                    200, json={"choices": [{"message": {"content": json.dumps({"value": "Female", "confidence": 0.7})}}]}
                )
            )
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["gender"]["value"] == "Female"
        assert a["gender"]["source"] == "ai"
        assert route.call_count == 1  # no profile gender -> AI infers from the name

    @pytest.mark.asyncio
    async def test_gender_text_profile_value(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "gender", "label": "Gender", "type": "text"}],
            "profile": {"full_name": "Ada Lovelace", "gender": "female"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["gender"]["value"] == "female"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_language_siblings_propagate(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "eng_written", "label": "English written level", "type": "text"},
                {"id": "eng_spoken", "label": "English spoken", "type": "text"},
                {"id": "eng_reading", "label": "English reading", "type": "text"},
            ],
            "profile": {"full_name": "Ada Lovelace", "languages": [{"language": "English", "level": "fluent"}]},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["eng_written"]["value"] == "fluent"
        assert a["eng_spoken"]["value"] == "fluent"
        assert a["eng_reading"]["value"] == "fluent"
        assert route.call_count == 0  # one level fills every sibling, no model

    @pytest.mark.asyncio
    async def test_language_unnamed_level_field_defaults_to_english(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "written_lvl", "label": "Written level", "type": "text"}],
            "profile": {"full_name": "Ada Lovelace", "languages": [{"language": "English", "level": "fluent"}]},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["written_lvl"]["value"] == "fluent"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_language_generic_field_gets_top_language(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "langs", "label": "Languages", "type": "text"}],
            "profile": {"full_name": "Ada Lovelace", "languages": [{"language": "English", "level": "fluent"}]},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["langs"]["value"] == "English"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_language_select_matches_level(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "eng_level", "label": "English level", "type": "select", "options": ["Native", "Fluent", "Intermediate"]}
            ],
            "profile": {"full_name": "Ada Lovelace", "languages": [{"language": "English", "level": "native"}]},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["eng_level"]["value"] == "Native"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_current_employer_new_applicant_no(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "ce", "label": "Are you currently working at Google?", "type": "text"}],
            "profile": {"full_name": "Ada Lovelace", "companies": ["Dell", "Nokia"]},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["ce"]["value"] == "No"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_current_employer_experience_company_yes(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "ce", "label": "Are you currently working at Dell?", "type": "text"}],
            "profile": {"full_name": "Ada Lovelace", "companies": ["Dell Technologies", "Nokia"]},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["ce"]["value"] == "Yes"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_current_employer_select_option(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "ce", "label": "Are you currently working at Google?", "type": "select", "options": ["Yes", "No"]}
            ],
            "profile": {"full_name": "Ada Lovelace", "companies": ["Dell", "Nokia"]},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["ce"]["value"] == "No"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_location_pref_combined_without_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {
                    "id": "lp",
                    "label": "What are your preferences regarding location and the way of working (willing to work remote/in hybrid model/etc)?",
                    "type": "textarea",
                }
            ],
            "profile": {"full_name": "Ada Lovelace", "location": "Warsaw, Poland", "work_mode": "hybrid (2-3 days from the office)"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["lp"]["value"] == "Warsaw, Poland. Hybrid (2-3 days from the office)."
        assert a["lp"]["source"] == "profile"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_location_pref_select_matches_mode(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "wm", "label": "Preferred work mode", "type": "select", "options": ["Remote", "Hybrid", "On-site"]}
            ],
            "profile": {"full_name": "Ada Lovelace", "work_mode": "hybrid"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["wm"]["value"] == "Hybrid"
        assert route.call_count == 0

    @pytest.mark.asyncio
    async def test_location_pref_no_data_goes_to_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "lp", "label": "What are your preferences regarding location and the way of working?", "type": "textarea"}
            ],
            "profile": {"full_name": "Ada Lovelace"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(
                side_effect=lambda r: httpx.Response(
                    200, json={"choices": [{"message": {"content": json.dumps({"value": "Open to any location.", "confidence": 0.6})}}]}
                )
            )
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["lp"]["value"] == "Open to any location."
        assert a["lp"]["source"] == "ai"
        assert route.call_count == 1  # no profile data -> the AI drafts it

    @pytest.mark.asyncio
    async def test_all_defaults_one_request_zero_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "notice", "label": "Notice period", "type": "select", "options": ["Immediate", "2 weeks"]},
                {"id": "gender", "label": "Gender", "type": "select", "options": ["Male", "Female"]},
                {"id": "eng_written", "label": "English written level", "type": "text"},
                {"id": "ce", "label": "Are you currently working at Google?", "type": "select", "options": ["Yes", "No"]},
                {
                    "id": "lp",
                    "label": "What are your preferences regarding location and the way of working?",
                    "type": "textarea",
                },
            ],
            "profile": {
                "full_name": "Ada Lovelace",
                "gender": "male",
                "languages": [{"language": "English", "level": "fluent"}],
                "companies": ["Dell", "Nokia"],
                "location": "Warsaw, Poland",
                "work_mode": "hybrid (2-3 days from the office)",
            },
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["notice"]["value"] == "Immediate"
        assert a["gender"]["value"] == "Male"
        assert a["eng_written"]["value"] == "fluent"
        assert a["ce"]["value"] == "No"
        assert a["lp"]["value"] == "Warsaw, Poland. Hybrid (2-3 days from the office)."
        assert all(v["source"] == "profile" for v in a.values())
        assert route.call_count == 0  # five defaults, zero model calls

    @pytest.mark.asyncio
    async def test_defaults_and_ai_mix(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "notice", "label": "Notice period", "type": "select", "options": ["Immediate", "2 weeks"]},
                {"id": "why", "label": "Why do you want this job?", "type": "textarea"},
            ],
            "profile": {"full_name": "Ada Lovelace"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(
                side_effect=lambda r: httpx.Response(
                    200, json={"choices": [{"message": {"content": json.dumps({"value": "The role matches my experience.", "confidence": 0.8})}}]}
                )
            )
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["notice"]["value"] == "Immediate"
        assert a["notice"]["source"] == "profile"
        assert a["why"]["value"] == "The role matches my experience."
        assert a["why"]["source"] == "ai"
        assert route.call_count == 1  # only the AI field cost a model call

    @pytest.mark.asyncio
    async def test_answer_memory_reuses_same_question(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [{"id": "why", "label": "Why do you want this job?", "type": "textarea"}],
            "profile": {"full_name": "Ada Lovelace"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(
                side_effect=lambda r: httpx.Response(
                    200, json={"choices": [{"message": {"content": json.dumps({"value": "Because it matches.", "confidence": 0.8})}}]}
                )
            )
            r1 = await client.post("/fill", json=body)
            r2 = await client.post("/fill", json=body)  # same question -> cache hit
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text
        assert r2.json()["data"]["answers"]["why"]["value"] == "Because it matches."
        assert route.call_count == 1  # the second ask cost no model call

    @pytest.mark.asyncio
    async def test_work_model_office_permit_defaults_zero_ai(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setenv("NVIDIA_API_KEY", "server-key")
        body = {
            "fields": [
                {"id": "wm", "label": "Would you be able to work in a hybrid work model?", "type": "select", "options": ["Yes", "No"]},
                {"id": "of", "label": "How often would you be able to work from the office?", "type": "text"},
                {"id": "wp", "label": "Would you require a work permit to work in Google?", "type": "select", "options": ["Yes", "No"]},
            ],
            "profile": {"full_name": "Ada Lovelace", "work_mode": "hybrid (2-3 days from the office)"},
            "job": JOB.model_dump(),
        }

        with respx.mock(assert_all_called=False) as m:
            route = m.post(CHAT).mock(side_effect=lambda r: httpx.Response(500, text="should not be called"))
            resp = await client.post("/fill", json=body)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]["answers"]
        assert a["wm"]["value"] == "Yes"
        assert a["of"]["value"] == "2-3 days from the office"
        assert a["wp"]["value"] == "No"
        assert all(v["source"] == "profile" for v in a.values())
        assert route.call_count == 0  # three defaults, zero model calls
