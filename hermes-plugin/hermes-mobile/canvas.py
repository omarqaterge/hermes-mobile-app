"""Canvas: documents Hermes and the user share for one chat (notes, markdown, HTML, code…).

Storage: ~/.hermes/mobile/canvas/<chat id>/<doc id>.json, one file per document with its version history.
Used from two processes (the agent's `canvas` tool and the dashboard REST API), so every change happens
under an exclusive file lock and is written atomically.

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
from typing import Any, Dict, List, Optional

ROOT = Path(os.path.expanduser("~")) / ".hermes" / "mobile" / "canvas"
MAX_CHARS = 400_000  # one document
MAX_VERSIONS = 40  # kept per document
MAX_DOCS = 30  # per chat
MAX_FILE_BYTES = 1_500_000  # opening a phone file

TYPES = ("markdown", "html", "code", "text", "json", "csv", "svg", "mermaid")
_EXT = {
    ".md": "markdown", ".markdown": "markdown", ".txt": "text", ".log": "text", ".html": "html", ".htm": "html",
    ".json": "json", ".csv": "csv", ".tsv": "csv", ".svg": "svg", ".mmd": "mermaid", ".mermaid": "mermaid",
}
_CODE_EXT = {
    ".py": "python", ".js": "javascript", ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx", ".java": "java",
    ".kt": "kotlin", ".c": "c", ".h": "c", ".cpp": "cpp", ".rs": "rust", ".go": "go", ".rb": "ruby", ".sh": "bash",
    ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".css": "css", ".sql": "sql", ".xml": "xml", ".php": "php",
    ".swift": "swift", ".lua": "lua", ".r": "r", ".tex": "latex",
}


class CanvasError(Exception):
    """A problem worth telling the caller about (bad id, too big, conflict…)."""


def _now() -> float:
    return round(time.time(), 3)


def _safe(part: str) -> str:
    """Chat/doc ids become file names: keep them plain."""
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", str(part or ""))[:120].strip(".")
    if not cleaned:
        raise CanvasError("missing id")
    return cleaned


def _dir(session: str) -> Path:
    return ROOT / _safe(session)


@contextlib.contextmanager
def _locked(session: str):
    d = _dir(session)
    d.mkdir(parents=True, exist_ok=True)
    with open(d / ".lock", "a+") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            yield d
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:32] or "doc"
    return f"{s}-{secrets.token_hex(2)}"


def guess_type(name: str = "", content: str = "") -> tuple[str, str]:
    """(type, language) from a file name (and a peek at the content when the name says nothing)."""
    ext = os.path.splitext(name or "")[1].lower()
    if ext in _EXT:
        return _EXT[ext], ""
    if ext in _CODE_EXT:
        return "code", _CODE_EXT[ext]
    head = (content or "")[:400].lstrip().lower()
    if head.startswith("<!doctype html") or head.startswith("<html"):
        return "html", ""
    if head.startswith("<svg"):
        return "svg", ""
    return "markdown", ""


def _read(path: Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write(path: Path, doc: Dict[str, Any]) -> None:
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, path)


def _meta(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"], "title": doc["title"], "type": doc["type"], "lang": doc.get("lang", ""),
        "rev": doc["rev"], "updated": doc["updated"], "by": doc["versions"][-1]["by"] if doc["versions"] else "",
        "chars": len(doc["content"]), "path": doc.get("path", ""), "created": doc.get("created", 0),
        "category": doc.get("category", ""),
    }


def clean_category(c: str) -> str:
    """A gallery category as stored: one line, at most 40 characters ('' = none, the gallery groups it by type)."""
    return re.sub(r"\s+", " ", (c or "").strip())[:40]


def used_categories() -> List[str]:
    """Categories already used on any chat's canvas (for the agent to reuse), sorted by name."""
    seen: Dict[str, str] = {}
    for p in ROOT.glob("*/*.json") if ROOT.exists() else []:
        with contextlib.suppress(Exception):
            c = clean_category(_read(p).get("category", ""))
            if c:
                seen.setdefault(c.lower(), c)
    return sorted(seen.values(), key=str.lower)


def _load(d: Path, doc_id: str) -> Dict[str, Any]:
    p = d / f"{_safe(doc_id)}.json"
    if not p.exists():
        raise CanvasError(f"no document '{doc_id}' on this canvas")
    return _read(p)


def _commit(d: Path, doc: Dict[str, Any], content: str, by: str, note: str = "") -> Dict[str, Any]:
    if len(content) > MAX_CHARS:
        raise CanvasError(f"too large ({len(content):,} characters, limit {MAX_CHARS:,})")
    doc["rev"] = int(doc.get("rev", 0)) + 1
    doc["content"] = content
    doc["updated"] = _now()
    doc.setdefault("versions", []).append({"rev": doc["rev"], "at": doc["updated"], "by": by, "note": (note or "")[:120], "content": content})
    doc["versions"] = doc["versions"][-MAX_VERSIONS:]
    _write(d / f"{doc['id']}.json", doc)
    return doc


# ── public API ───────────────────────────────────────────────

def list_docs(session: str) -> List[Dict[str, Any]]:
    d = _dir(session)
    if not d.exists():
        return []
    out = []
    for p in sorted(d.glob("*.json")):
        try:
            out.append(_meta(_read(p)))
        except Exception:
            continue
    out.sort(key=lambda m: m.get("created", 0))
    return out


def get(session: str, doc_id: str, with_versions: bool = True) -> Dict[str, Any]:
    d = _dir(session)
    doc = _load(d, doc_id)
    view = {**_meta(doc), "content": doc["content"]}
    if with_versions:
        view["versions"] = [{k: v for k, v in x.items() if k != "content"} for x in doc["versions"]]
    return view


def get_version(session: str, doc_id: str, rev: int) -> Dict[str, Any]:
    doc = _load(_dir(session), doc_id)
    for v in doc["versions"]:
        if v["rev"] == int(rev):
            return {"rev": v["rev"], "at": v["at"], "by": v["by"], "note": v.get("note", ""), "content": v["content"]}
    raise CanvasError(f"revision {rev} is no longer kept")


def create(session: str, title: str, content: str = "", type: str = "", lang: str = "", by: str = "agent", path: str = "",
           category: str = "") -> Dict[str, Any]:
    title = (title or "").strip() or "Untitled"
    if type and type not in TYPES:
        raise CanvasError(f"type must be one of {', '.join(TYPES)}")
    if not type:
        type, guessed = guess_type(path or title, content)
        lang = lang or guessed
    with _locked(session) as d:
        if len(list(d.glob("*.json"))) >= MAX_DOCS:
            raise CanvasError(f"this canvas already has {MAX_DOCS} documents: close one first")
        doc = {"id": _slug(title), "title": title[:120], "type": type, "lang": lang, "rev": 0, "content": "", "versions": [], "created": _now(), "updated": _now(), "path": path,
               "category": clean_category(category)}
        _commit(d, doc, content or "", by, "created")
        return get(session, doc["id"], with_versions=False)


def write(session: str, doc_id: str, content: str, by: str = "agent", note: str = "", base_rev: Optional[int] = None,
          title: str = "", type: str = "", lang: str = "") -> Dict[str, Any]:
    """Replace the whole document. `base_rev` (the app sends it) refuses to overwrite a newer version."""
    with _locked(session) as d:
        doc = _load(d, doc_id)
        if base_rev is not None and int(base_rev) != doc["rev"]:
            raise CanvasError(f"conflict: this document changed (now revision {doc['rev']}, you had {base_rev})")
        if title:
            doc["title"] = title[:120]
        if type:
            if type not in TYPES:
                raise CanvasError(f"type must be one of {', '.join(TYPES)}")
            doc["type"] = type
        if lang:
            doc["lang"] = lang
        if content == doc["content"] and not (title or type or lang):
            return get(session, doc_id, with_versions=False)
        _commit(d, doc, content, by, note)
        return get(session, doc_id, with_versions=False)


def patch(session: str, doc_id: str, edits: List[Dict[str, Any]], by: str = "agent", note: str = "") -> Dict[str, Any]:
    """Exact find/replace edits, applied in order. Each `find` must match once (or set all:true)."""
    if not edits:
        raise CanvasError("give at least one edit: {find, replace}")
    with _locked(session) as d:
        doc = _load(d, doc_id)
        text = doc["content"]
        for i, e in enumerate(edits, 1):
            find, repl = e.get("find", ""), e.get("replace", "")
            if not find:
                raise CanvasError(f"edit {i}: 'find' is empty")
            n = text.count(find)
            if n == 0:
                raise CanvasError(f"edit {i}: text not found (copy it exactly, or `read` the document first)")
            if n > 1 and not e.get("all"):
                raise CanvasError(f"edit {i}: text appears {n} times: make it longer, or set all:true")
            text = text.replace(find, repl) if e.get("all") else text.replace(find, repl, 1)
        _commit(d, doc, text, by, note or f"{len(edits)} edit(s)")
        return get(session, doc_id, with_versions=False)


def restore(session: str, doc_id: str, rev: int, by: str = "user") -> Dict[str, Any]:
    with _locked(session) as d:
        doc = _load(d, doc_id)
        old = next((v for v in doc["versions"] if v["rev"] == int(rev)), None)
        if not old:
            raise CanvasError(f"revision {rev} is no longer kept")
        _commit(d, doc, old["content"], by, f"restored revision {rev}")
        return get(session, doc_id, with_versions=False)


def rename(session: str, doc_id: str, title: str) -> Dict[str, Any]:
    with _locked(session) as d:
        doc = _load(d, doc_id)
        doc["title"] = (title or "").strip()[:120] or doc["title"]
        doc["updated"] = _now()
        _write(d / f"{doc['id']}.json", doc)
        return get(session, doc_id, with_versions=False)


def set_category(session: str, doc_id: str, category: str) -> Dict[str, Any]:
    """File the document under a gallery category ('' = back to its type's group). Not a new version."""
    with _locked(session) as d:
        doc = _load(d, doc_id)
        doc["category"] = clean_category(category)
        _write(d / f"{doc['id']}.json", doc)
        return get(session, doc_id, with_versions=False)


def delete(session: str, doc_id: str) -> None:
    with _locked(session) as d:
        p = d / f"{_safe(doc_id)}.json"
        if p.exists():
            p.unlink()


def clear_session(session: str) -> None:
    d = _dir(session)
    if d.exists():
        for p in d.glob("*"):
            with contextlib.suppress(OSError):
                p.unlink()
        with contextlib.suppress(OSError):
            d.rmdir()


def _phone_path(p: str) -> Path:
    """Paths as the agent/app write them (/root/…, ~/…, /sdcard/…) → a real path inside this environment."""
    p = os.path.expanduser(p.strip())
    if not os.path.isabs(p):
        raise CanvasError("give an absolute path (like /root/notes.md or /sdcard/Download/file.txt)")
    return Path(os.path.realpath(p))


def open_file(session: str, path: str, by: str = "agent") -> Dict[str, Any]:
    """Load a text file from the phone into a new canvas document linked to that path."""
    real = _phone_path(path)
    if not real.is_file():
        raise CanvasError(f"no such file: {path}")
    if real.stat().st_size > MAX_FILE_BYTES:
        raise CanvasError(f"file is too big to open here ({real.stat().st_size:,} bytes, limit {MAX_FILE_BYTES:,})")
    raw = real.read_bytes()
    if b"\x00" in raw[:4096]:
        raise CanvasError("that looks like a binary file, not text")
    text = raw.decode("utf-8", errors="replace")
    # Same file already open? Refresh it instead of piling up copies.
    for m in list_docs(session):
        if m.get("path") == str(real):
            return write(session, m["id"], text, by=by, note="reloaded from file")
    t, lang = guess_type(real.name, text)
    return create(session, real.name, text, type=t, lang=lang, by=by, path=str(real))


def save_file(session: str, doc_id: str) -> Dict[str, Any]:
    """Write the document back to the file it was opened from."""
    doc = _load(_dir(session), doc_id)
    if not doc.get("path"):
        raise CanvasError("this document isn't linked to a file")
    real = _phone_path(doc["path"])
    real.parent.mkdir(parents=True, exist_ok=True)
    tmp = real.with_name(f".{real.name}.hm.tmp")
    tmp.write_text(doc["content"], encoding="utf-8")
    os.replace(tmp, real)
    return {"path": str(real), "chars": len(doc["content"])}


# ── the agent's tool ─────────────────────────────────────────

TOOL_SCHEMA = {
    "name": "canvas",
    "description": (
        "Show the user a document on their CANVAS: a panel beside the chat in their phone app where they can read, "
        "edit, preview and keep it. Use it for anything document-like: long writing, notes, plans, reports, "
        "code files, HTML/SVG pages or small web apps, tables, diagrams. Keep the chat reply short and point to the "
        "canvas instead of pasting the whole thing into chat. The user may edit the canvas: call action=read to see "
        "their latest version before changing it, and prefer action=patch (small exact edits) over rewriting "
        "everything. Types: markdown, html (runs in a sandbox), code (set lang), text, json, csv, svg, mermaid. "
        "HTML runs OFFLINE in a sandbox: put all CSS and JS inline in one self-contained file (no CDN scripts, "
        "external fonts/images, fetch or localStorage: they are blocked); draw charts with inline SVG or <canvas>; "
        "make it responsive for a narrow phone screen and readable on both light and dark backgrounds. "
        "Every canvas document is kept in the user's Canvas gallery (all chats, grouped by category), so nothing needs "
        "saving: on create, set category to a short topic (one or two words, e.g. Recipes, Travel, Study, Work); "
        "reuse one of gallery_categories (listed in the create and list replies) when it fits. "
        "action=set_category files an existing document under another category."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["create", "write", "patch", "read", "list", "open_file", "close", "rename", "set_category"],
                       "description": "create: new document. write: replace a document's whole content. patch: exact find/replace edits. read: get the current content (including the user's edits). list: documents on the canvas. open_file: show a file from the phone on the canvas. close: remove a document. rename. set_category: file a document under another gallery category."},
            "id": {"type": "string", "description": "Document id (from create/list) or its exact title. Optional when the canvas has exactly one document."},
            "title": {"type": "string", "description": "Document title (create, rename; optional on write)."},
            "type": {"type": "string", "enum": list(TYPES), "description": "Content type (create). Guessed from the title/file when omitted."},
            "lang": {"type": "string", "description": "Programming language when type=code (python, javascript…)."},
            "content": {"type": "string", "description": "Full text (create, write)."},
            "edits": {"type": "array", "description": "For patch: list of {find, replace, all?}. `find` must match exactly once unless all=true.",
                      "items": {"type": "object", "properties": {"find": {"type": "string"}, "replace": {"type": "string"}, "all": {"type": "boolean"}}, "required": ["find", "replace"]}},
            "path": {"type": "string", "description": "Absolute file path on the phone (open_file)."},
            "note": {"type": "string", "description": "Short note for the version history (what changed)."},
            "category": {"type": "string", "description": "Canvas gallery category (create, set_category): a short topic like Recipes. Reuse an existing one when it fits."},
        },
        "required": ["action"],
    },
}


def _resolve_id(session: str, doc_id: str) -> str:
    if doc_id:
        if not (_dir(session) / f"{_safe(doc_id)}.json").exists():
            # The model sometimes passes the title it chose instead of the id.
            same = [m["id"] for m in list_docs(session) if m["title"].strip().lower() == doc_id.strip().lower()]
            if len(same) == 1:
                return same[0]
        return doc_id
    docs = list_docs(session)
    if len(docs) == 1:
        return docs[0]["id"]
    if not docs:
        raise CanvasError("the canvas is empty: use action=create first")
    raise CanvasError("several documents are open: pass id (see action=list)")


_EXTERNAL = re.compile(r"""(?:\b(?:src|href|action|poster)\s*=\s*["']?\s*(?:https?:)?//|@import\s+(?:url\()?["']?\s*(?:https?:)?//|url\(\s*["']?\s*(?:https?:)?//|\bfetch\s*\(|XMLHttpRequest|\bWebSocket\s*\(|\b(?:localStorage|sessionStorage)\b)""", re.I)


def _lint(sid: str, doc_id: str) -> List[str]:
    """Warnings for html/svg that the offline sandbox would break, so the agent can fix them in the same turn."""
    try:
        d = get(sid, doc_id)
        if d["type"] not in ("html", "svg"):
            return []
        found = sorted({m.group(0).strip().lower()[:40] for m in _EXTERNAL.finditer(d["content"])})
        if not found:
            return []
        return ["This page runs offline in a sandbox: external URLs, fetch/XMLHttpRequest/WebSocket and localStorage/sessionStorage "
                "are blocked, so parts of it will not work. Inline everything (CSS, JS, SVG/canvas charts) and rewrite the "
                "document. Found: " + ", ".join(found[:6])]
    except Exception:
        return []


def _with_lint(sid: str, out: Dict[str, Any]) -> str:
    w = _lint(sid, out["id"])
    if w:
        out["warnings"] = w
    return json.dumps(out)


def tool_handler(args: Dict[str, Any], session_id: str = "", task_id: str = "", **_: Any) -> str:
    """Entry point for Hermes. Always returns a JSON string; errors are reported, never raised."""
    sid = session_id or task_id
    try:
        if not sid:
            raise CanvasError("no chat is attached to this call")
        a = (args.get("action") or "").strip().lower()
        note = args.get("note", "")
        if a == "create":
            r = create(sid, args.get("title", ""), args.get("content", ""), args.get("type", ""), args.get("lang", ""), by="agent",
                       category=args.get("category", ""))
            return _with_lint(sid, {"ok": True, "id": r["id"], "rev": r["rev"], "title": r["title"], "type": r["type"], "chars": r["chars"],
                                    "category": r["category"], "gallery_categories": used_categories(), "shown": True})
        if a == "write":
            r = write(sid, _resolve_id(sid, args.get("id", "")), args.get("content", ""), by="agent", note=note,
                      title=args.get("title", ""), type=args.get("type", ""), lang=args.get("lang", ""))
            return _with_lint(sid, {"ok": True, "id": r["id"], "rev": r["rev"], "chars": r["chars"]})
        if a == "patch":
            r = patch(sid, _resolve_id(sid, args.get("id", "")), args.get("edits") or [], by="agent", note=note)
            return _with_lint(sid, {"ok": True, "id": r["id"], "rev": r["rev"], "chars": r["chars"]})
        if a == "read":
            r = get(sid, _resolve_id(sid, args.get("id", "")))
            last_by = r["versions"][-1]["by"] if r["versions"] else ""
            text = r["content"]
            cut = len(text) > 60_000
            return json.dumps({"ok": True, "id": r["id"], "title": r["title"], "type": r["type"], "lang": r["lang"], "rev": r["rev"],
                               "last_edited_by": last_by, "content": text[:60_000], "truncated": cut})
        if a == "list":
            return json.dumps({"ok": True, "documents": [{k: m[k] for k in ("id", "title", "type", "rev", "chars", "by", "path", "category")} for m in list_docs(sid)],
                               "gallery_categories": used_categories()})
        if a == "open_file":
            r = open_file(sid, args.get("path", ""), by="agent")
            return json.dumps({"ok": True, "id": r["id"], "title": r["title"], "type": r["type"], "chars": r["chars"], "shown": True})
        if a == "close":
            delete(sid, _resolve_id(sid, args.get("id", "")))
            return json.dumps({"ok": True})
        if a == "rename":
            r = rename(sid, _resolve_id(sid, args.get("id", "")), args.get("title", ""))
            return json.dumps({"ok": True, "id": r["id"], "title": r["title"]})
        # save_to_library: the old name (the Library of saved copies became the gallery of every document).
        if a in ("set_category", "save_to_library"):
            r = set_category(sid, _resolve_id(sid, args.get("id", "")), args.get("category", ""))
            return json.dumps({"ok": True, "id": r["id"], "title": r["title"], "category": r["category"], "gallery_categories": used_categories()})
        raise CanvasError("unknown action: use create, write, patch, read, list, open_file, close, rename or set_category")
    except CanvasError as e:
        return json.dumps({"ok": False, "error": str(e)})
    except Exception as e:  # never let a bug here break the agent's turn
        return json.dumps({"ok": False, "error": f"canvas failed: {type(e).__name__}: {e}"})
