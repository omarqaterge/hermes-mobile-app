"""Canvas gallery: every canvas document of every chat (all profiles) in one list, grouped by category, each with
the chat it was made in. Nothing is copied: the gallery reads the canvas store (canvas.py) and the chats' state.db
files read-only. A document's category is the one Hermes (or the user) gave it; without one it is grouped by type.

Older app versions kept saved copies in a separate Library (library.py); those items are listed too
(`saved: true`) so nobody loses them.

Pure stdlib on purpose: the plugin must load anywhere Hermes does.
"""

from __future__ import annotations

import contextlib
import importlib.util
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent

# Documents without a category are grouped by what they are.
KIND = {"markdown": "Notes", "text": "Notes", "html": "Web pages", "code": "Code", "json": "Code", "csv": "Data",
        "svg": "Images", "mermaid": "Diagrams"}


def _mod(name: str, file: str):
    """A sibling module loaded by path (the plugin isn't an importable package), shared with the other loaders."""
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, HERE / file)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


def canvas():
    return _mod("hm_canvas", "canvas.py")


def _library():
    return _mod("hm_library", "library.py")


def _chats() -> Dict[str, Dict[str, Any]]:
    """{chat id: {profile, title, last_active, archived}} over every profile's state.db."""
    out: Dict[str, Dict[str, Any]] = {}
    for prof, db in _mod("hm_chat_search", "chat_search.py").profiles().items():
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        except sqlite3.Error:
            continue
        try:
            con.row_factory = sqlite3.Row
            for r in con.execute("SELECT * FROM sessions"):
                keys = r.keys()
                hidden = any(k in keys and r[k] for k in ("archived", "hidden"))
                out[r["id"]] = {"profile": prof, "title": (r["title"] if "title" in keys else "") or "",
                                "last_active": (r["last_activity_at"] if "last_activity_at" in keys else None) or r["started_at"],
                                "archived": bool(hidden)}
        except sqlite3.Error:
            pass
        finally:
            con.close()
    return out


_MD = re.compile(r"[#>*_`~|\[\]()!-]+")
_TAG = re.compile(r"<(script|style)[^>]*>.*?</\1>|<[^>]+>", re.S | re.I)


def snippet(doc_type: str, content: str, title: str = "", n: int = 140) -> str:
    """A line or two of plain text to recognise the document by (none for images and diagrams), without the
    title repeated at its start (a markdown note usually opens with it as a heading)."""
    text = content or ""
    if doc_type in ("svg", "mermaid"):
        return ""
    if doc_type == "html":
        m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
        body = re.search(r"<body[^>]*>(.*)", text, re.S | re.I)
        text = _TAG.sub(" ", body.group(1) if body else text)
        if m and not text.strip():
            text = m.group(1)
    elif doc_type in ("markdown", "text"):
        text = _MD.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if title and text.lower().startswith(title.strip().lower()):
        text = text[len(title.strip()):].lstrip(" :-–")
    return text[:n] + ("…" if len(text) > n else "")


def category_of(doc_type: str, category: str) -> str:
    return canvas().clean_category(category) or KIND.get(doc_type, "Notes")


def list_all() -> Dict[str, Any]:
    """{items, categories}: newest first; categories = {name: count} sorted by name."""
    cv = canvas()
    chats = _chats()
    items: List[Dict[str, Any]] = []
    root = cv.ROOT
    for p in root.glob("*/*.json") if root.exists() else []:
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        sid = p.parent.name
        t = d.get("type") or "markdown"
        versions = d.get("versions") or []
        items.append({
            "key": f"{sid}/{d.get('id')}", "session": sid, "doc": d.get("id"), "title": d.get("title") or "Untitled",
            "type": t, "lang": d.get("lang", ""), "category": category_of(t, d.get("category", "")),
            "auto": not cv.clean_category(d.get("category", "")), "created": d.get("created", 0),
            "updated": d.get("updated", 0), "by": versions[-1].get("by", "") if versions else "",
            "chars": len(d.get("content") or ""), "snippet": snippet(t, d.get("content") or "", d.get("title") or ""), "chat": chats.get(sid),
        })
    with contextlib.suppress(Exception):
        for m in _library().list_items():
            sid = (m.get("source") or {}).get("session") or ""
            t = m.get("type") or "markdown"
            items.append({
                "key": f"lib:{m['id']}", "session": sid, "doc": "", "lib": m["id"], "saved": True, "title": m.get("title") or "Untitled",
                "type": t, "lang": m.get("lang", ""), "category": category_of(t, m.get("category", "")), "auto": False,
                "created": m.get("saved", 0), "updated": m.get("saved", 0), "by": "", "chars": m.get("chars", 0), "snippet": "",
                "chat": chats.get(sid) if sid else None,
            })
    items.sort(key=lambda i: i.get("updated") or 0, reverse=True)
    counts: Dict[str, int] = {}
    for i in items:
        counts[i["category"]] = counts.get(i["category"], 0) + 1
    return {"items": items, "categories": dict(sorted(counts.items(), key=lambda kv: kv[0].lower()))}
