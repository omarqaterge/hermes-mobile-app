"""Canvas gallery: every canvas document of every chat (all profiles) in one list, grouped by type (HTML, Markdown,
Code…), searchable by title and content, each with the chat it was made in. Nothing is copied: the gallery reads
the canvas store (canvas.py) and the chats' state.db files read-only.

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

# The gallery's categories: what a document is.
KIND = {"html": "HTML", "markdown": "Markdown", "code": "Code", "text": "Text", "json": "JSON", "csv": "CSV",
        "svg": "SVG", "mermaid": "Mermaid"}


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


def plain_text(doc_type: str, content: str) -> str:
    """The document's words without markup: what search looks in (none for images and diagrams)."""
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
    return re.sub(r"\s+", " ", text).strip()


def snippet(doc_type: str, content: str, title: str = "", n: int = 140, words: List[str] = ()) -> str:
    """A line or two of plain text to recognise the document by: around the first search word when searching,
    else its start without the title repeated (a markdown note usually opens with it as a heading)."""
    if doc_type in ("markdown", "text"):
        content = re.sub(r"\A\s*#{1,6} [^\n]*\n", "", content or "")
    text = plain_text(doc_type, content)
    if words:
        at = min((i for i in (text.lower().find(w) for w in words) if i >= 0), default=-1)
        if at > 40:
            text = "…" + text[at - 30:].lstrip()
    elif title and text.lower().startswith(title.strip().lower()):
        text = text[len(title.strip()):].lstrip(" :-–")
    return text[:n] + ("…" if len(text) > n else "")


def list_all(q: str = "") -> Dict[str, Any]:
    """{items, categories}: newest first; categories = {type label: count}, in KIND order. `q`: every word must be in
    the title or the text (case-insensitive)."""
    cv = canvas()
    chats = _chats()
    words = [w for w in (q or "").lower().split() if w]
    items: List[Dict[str, Any]] = []
    root = cv.ROOT
    for p in root.glob("*/*.json") if root.exists() else []:
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        sid = p.parent.name
        t = d.get("type") or "markdown"
        title = d.get("title") or "Untitled"
        content = d.get("content") or ""
        if words:
            hay = f"{title} {plain_text(t, content)}".lower()
            if not all(w in hay for w in words):
                continue
        versions = d.get("versions") or []
        items.append({
            "key": f"{sid}/{d.get('id')}", "session": sid, "doc": d.get("id"), "title": title,
            "type": t, "lang": d.get("lang", ""), "category": KIND.get(t, "Text"), "created": d.get("created", 0),
            "updated": d.get("updated", 0), "by": versions[-1].get("by", "") if versions else "",
            "chars": len(content), "snippet": snippet(t, content, title, words=words), "chat": chats.get(sid),
        })
    with contextlib.suppress(Exception):
        lib = _library()
        for m in lib.list_items():
            t = m.get("type") or "markdown"
            if words:
                with contextlib.suppress(Exception):
                    hay = f"{m.get('title', '')} {plain_text(t, lib.get(m['id']).get('content', ''))}".lower()
                    if not all(w in hay for w in words):
                        continue
            sid = (m.get("source") or {}).get("session") or ""
            items.append({
                "key": f"lib:{m['id']}", "session": sid, "doc": "", "lib": m["id"], "saved": True, "title": m.get("title") or "Untitled",
                "type": t, "lang": m.get("lang", ""), "category": KIND.get(t, "Text"), "created": m.get("saved", 0),
                "updated": m.get("saved", 0), "by": "", "chars": m.get("chars", 0), "snippet": "",
                "chat": chats.get(sid) if sid else None,
            })
    items.sort(key=lambda i: i.get("updated") or 0, reverse=True)
    counts = {label: 0 for label in dict.fromkeys(KIND.values())}
    for i in items:
        counts[i["category"]] = counts.get(i["category"], 0) + 1
    return {"items": items, "categories": {k: v for k, v in counts.items() if v}}
