# server/utils/vault.py
"""Encrypted local history vault for filled form details.

Every answered field is appended to a monthly shard under
%APPDATA%\\RBG_Candidate\\history as a DPAPI-encrypted record (Windows
CryptProtectData — user-scoped, no plaintext at rest). Shards older than
HISTORY_TTL_DAYS (60) are pruned on each write. Writes run on a daemon
thread so the vault never adds latency to a fill, and any failure inside
the vault is swallowed — it must never break a fill response.

Read-back (review / undo) uses read_shard(), which decrypts in-process.
"""

import base64
import ctypes
import ctypes.wintypes
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

HISTORY_TTL_DAYS = 60

_APPDATA_SUBDIR = os.path.join("RBG_Candidate", "history")


def history_dir() -> str:
    """The vault directory, created on demand (%APPDATA% on Windows)."""
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    path = os.path.join(base, _APPDATA_SUBDIR)
    os.makedirs(path, exist_ok=True)
    return path


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _blob(data: bytes) -> _DataBlob:
    buf = ctypes.create_string_buffer(data, len(data))
    return _DataBlob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _protect(data: bytes) -> bytes:
    """CryptProtectData (user-scoped DPAPI). Returns b"" when unavailable
    (non-Windows) or on any failure — the caller then skips the record.
    """
    try:
        blob_in = _blob(data)
        blob_out = _DataBlob()
        ok = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in),
            "rbg-candidate",
            None,
            None,
            None,
            0,
            ctypes.byref(blob_out),
        )
        if not ok:
            return b""
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
    except Exception:  # noqa: BLE001 — any failure means "no vault record", never an error
        return b""


def _unprotect(data: bytes) -> bytes:
    """CryptUnprotectData. Returns b"" when the blob cannot be decrypted."""
    try:
        blob_in = _blob(data)
        blob_out = _DataBlob()
        ok = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            0,
            ctypes.byref(blob_out),
        )
        if not ok:
            return b""
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
    except Exception:  # noqa: BLE001 — an undecryptable blob reads as empty
        return b""


def prune_old_shards(now: datetime | None = None) -> int:
    """Delete shards older than HISTORY_TTL_DAYS. Returns the number removed."""
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=HISTORY_TTL_DAYS)).timestamp()
    removed = 0
    try:
        names = os.listdir(history_dir())
    except OSError:
        return 0
    for name in names:
        path = os.path.join(history_dir(), name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            continue
    return removed


def record_fill(answers: dict[str, Any], fields: list[Any], job_url: str | None) -> None:
    """Append one encrypted record per answered field (non-blocking thread).

    answers: the coordinator's FieldAnswer map; fields: the request's FieldSpecs
    (for question labels); job_url: the application's URL when known.
    """
    by_id = {f.id: f for f in fields if hasattr(f, "id")}

    def _write() -> None:
        try:
            prune_old_shards()
            now = datetime.now(timezone.utc)
            shard = os.path.join(history_dir(), f"fill-{now:%Y-%m}.jsonl")
            lines_out: list[str] = []
            for field_id, answer in (answers or {}).items():
                value = getattr(answer, "value", "")
                if not value:
                    continue
                spec = by_id.get(field_id)
                record = {
                    "ts": now.isoformat(),
                    "field": field_id,
                    "question": (getattr(spec, "label", "") or field_id) if spec else field_id,
                    "value": value,
                    "source": getattr(answer, "source", "none"),
                    "url": job_url or "",
                }
                payload = _protect(json.dumps(record, ensure_ascii=False).encode("utf-8"))
                if not payload:
                    continue
                lines_out.append(base64.b64encode(payload).decode("ascii"))
            if lines_out:
                with open(shard, "a", encoding="ascii") as handle:
                    handle.writelines(line + "\n" for line in lines_out)
        except Exception:  # noqa: BLE001, S110 — the vault never breaks a fill
            pass

    threading.Thread(target=_write, daemon=True).start()


def read_shard(month: str) -> list[dict[str, Any]]:
    """Decrypt one month's shard ("2026-09") into its records (review / undo)."""
    shard = os.path.join(history_dir(), f"fill-{month}.jsonl")
    records: list[dict[str, Any]] = []
    try:
        with open(shard, encoding="ascii") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = _unprotect(base64.b64decode(line))
                    if payload:
                        records.append(json.loads(payload.decode("utf-8")))
                except Exception:  # noqa: BLE001, S112 — an unreadable record is skipped, not fatal
                    continue
    except OSError:
        return []
    return records
