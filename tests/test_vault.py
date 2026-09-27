# tests/test_vault.py
"""Encrypted history vault: record → read-back roundtrip, no plaintext at rest,
60-day pruning, empty answers never recorded."""

import os
import time
from datetime import datetime, timedelta, timezone

from server.schemas.fill import FieldAnswer, FieldSpec
from server.utils import vault


def _month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _wait_for_file(path: str, tries: int = 60) -> bool:
    for _ in range(tries):
        if os.path.exists(path):
            return True
        time.sleep(0.05)
    return False


def test_record_and_read_back_roundtrip(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("APPDATA", str(tmp_path))
    fields = [FieldSpec.model_validate({"id": "f1", "label": "Notice period", "type": "text"})]
    answers = {"f1": FieldAnswer(value="Immediate", confidence=0.9, source="profile", kind="profile")}
    vault.record_fill(answers, fields, "https://jobs.example.com/apply")
    path = os.path.join(vault.history_dir(), f"fill-{_month()}.jsonl")
    assert _wait_for_file(path), "vault shard not written"
    records = vault.read_shard(_month())
    assert len(records) == 1
    assert records[0]["field"] == "f1"
    assert records[0]["question"] == "Notice period"
    assert records[0]["value"] == "Immediate"
    assert records[0]["source"] == "profile"
    assert records[0]["url"] == "https://jobs.example.com/apply"
    assert "ts" in records[0]


def test_no_plaintext_at_rest(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("APPDATA", str(tmp_path))
    fields = [FieldSpec.model_validate({"id": "f1", "label": "Email", "type": "text"})]
    answers = {"f1": FieldAnswer(value="ada@example.com", confidence=1.0, source="profile", kind="profile")}
    vault.record_fill(answers, fields, None)
    path = os.path.join(vault.history_dir(), f"fill-{_month()}.jsonl")
    assert _wait_for_file(path), "vault shard not written"
    with open(path, encoding="ascii") as handle:
        raw = handle.read()
    # DPAPI-encrypted: neither the value nor the question label appears in plaintext.
    assert "ada@example.com" not in raw
    assert "Email" not in raw


def test_prune_old_shards_keeps_fresh(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("APPDATA", str(tmp_path))
    directory = vault.history_dir()
    old = os.path.join(directory, "fill-2020-01.jsonl")
    fresh = os.path.join(directory, "fill-2099-01.jsonl")
    for path in (old, fresh):
        with open(path, "w", encoding="ascii") as handle:
            handle.write("")
    past = datetime.now(timezone.utc) - timedelta(days=90)
    os.utime(old, (past.timestamp(), past.timestamp()))
    removed = vault.prune_old_shards()
    assert removed == 1
    assert not os.path.exists(old)
    assert os.path.exists(fresh)


def test_empty_answer_not_recorded(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("APPDATA", str(tmp_path))
    fields = [FieldSpec.model_validate({"id": "f1", "label": "X", "type": "text"})]
    answers = {"f1": FieldAnswer(value="", confidence=0.0, source="none", kind="profile")}
    vault.record_fill(answers, fields, None)
    time.sleep(0.3)  # let the daemon thread finish (it writes nothing)
    assert vault.read_shard(_month()) == []
