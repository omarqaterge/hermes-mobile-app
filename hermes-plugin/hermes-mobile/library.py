"""Library: canvas documents the user chose to keep, each with a category. Independent of chats (a deleted chat
keeps them). One library for all profiles, like the canvas.

Storage: ~/.hermes/mobile/library/<id>.json. Used from two processes (the agent's `canvas` tool and the dashboard
REST API), so changes happen under an exclusive file lock and are written atomically, like canvas.py.

Pure stdlib on purpose: the plugin must load anywhere Hermes does.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(os.path.expanduser("~")) / ".hermes" / "mobile" / "library"
MAX_CHARS = 400_000  # one item
MAX_ITEMS = 500


class LibraryError(Exception):
    """A problem worth telling the caller about (bad id, too big, library full…)."""


@contextlib.contextmanager
def _locked():
    ROOT.mkdir(parents=True, exist_ok=True)
    with open(ROOT / ".lock", "a+") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def _path(item_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]{1,60}", item_id or ""):
        raise LibraryError("bad id")
    return ROOT / f"{item_id}.json"


def _write(p: Path, item: Dict[str, Any]) -> None:
    tmp = p.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(item, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def _category(c: str) -> str:
    c = re.sub(r"\s+", " ", (c or "").strip())[:40]
    return c or "Unsorted"


def _meta(item: Dict[str, Any]) -> Dict[str, Any]:
    return {k: item.get(k) for k in ("id", "title", "type", "lang", "category", "saved", "chars", "source")}


def save(doc: Dict[str, Any], category: str, source_session: str = "") -> Dict[str, Any]:
    """Copy a canvas document (its current content and title) into the library."""
    content = doc.get("content") or ""
    if len(content) > MAX_CHARS:
        raise LibraryError(f"too large ({len(content):,} characters, limit {MAX_CHARS:,})")
    with _locked():
        if len(list(ROOT.glob("*.json"))) >= MAX_ITEMS:
            raise LibraryError(f"the library is full ({MAX_ITEMS} items): delete some first")
        title = (doc.get("title") or "").strip() or "Untitled"
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:32].strip("-") or "item"
        item = {"id": f"{slug}-{secrets.token_hex(3)}", "title": title[:120], "type": doc.get("type") or "markdown",
                "lang": doc.get("lang") or "", "category": _category(category), "saved": round(time.time(), 3),
                "chars": len(content), "content": content,
                "source": {"session": source_session or "", "doc": doc.get("id") or ""}}
        _write(_path(item["id"]), item)
        return _meta(item)


def list_items() -> List[Dict[str, Any]]:
    """Every item without its content, newest first."""
    out = []
    for p in ROOT.glob("*.json") if ROOT.exists() else []:
        with contextlib.suppress(Exception):
            out.append(_meta(json.loads(p.read_text(encoding="utf-8"))))
    return sorted(out, key=lambda m: m.get("saved") or 0, reverse=True)


def categories() -> Dict[str, int]:
    """{category: item count}, sorted by name."""
    counts: Dict[str, int] = {}
    for m in list_items():
        counts[m["category"]] = counts.get(m["category"], 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: kv[0].lower()))


def get(item_id: str) -> Dict[str, Any]:
    p = _path(item_id)
    if not p.exists():
        raise LibraryError("no such item")
    return json.loads(p.read_text(encoding="utf-8"))


def update(item_id: str, title: str = "", category: str = "") -> Dict[str, Any]:
    """Rename and/or move to another category (blank = unchanged)."""
    with _locked():
        item = get(item_id)
        if (title or "").strip():
            item["title"] = title.strip()[:120]
        if (category or "").strip():
            item["category"] = _category(category)
        _write(_path(item_id), item)
        return _meta(item)


def delete(item_id: str) -> None:
    p = _path(item_id)
    with _locked():
        with contextlib.suppress(FileNotFoundError):
            p.unlink()
