"""Canvas: documents Hermes and the user share for one chat (notes, markdown, HTML, code…).

Storage: ~/.hermes/mobile/canvas/<chat id>/<doc id>.json, one file per document with its version history.
Used from two processes (the agent's `canvas` tool and the dashboard REST API), so every change happens
under an exclusive file lock and is written atomically.

Pure stdlib on purpose: the plugin must load anywhere Hermes does.
"""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import re
import secrets
import tempfile
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
    }


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


def create(session: str, title: str, content: str = "", type: str = "", lang: str = "", by: str = "agent", path: str = "") -> Dict[str, Any]:
    title = (title or "").strip() or "Untitled"
    if type and type not in TYPES:
        raise CanvasError(f"type must be one of {', '.join(TYPES)}")
    if not type:
        type, guessed = guess_type(path or title, content)
        lang = lang or guessed
    with _locked(session) as d:
        if len(list(d.glob("*.json"))) >= MAX_DOCS:
            raise CanvasError(f"this canvas already has {MAX_DOCS} documents: close one first")
        doc = {"id": _slug(title), "title": title[:120], "type": type, "lang": lang, "rev": 0, "content": "", "versions": [], "created": _now(), "updated": _now(), "path": path}
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


_SHELL_INIT_FILES = frozenset({
    ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".profile",
    ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".zlogout",
})
_HERMES_SECRET_FILES = frozenset({
    "auth.json", ".anthropic_oauth.json", "google_token.json",
    "google_client_secret.json", "google_oauth_pending.json",
})


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _home_dir() -> Path:
    return Path(os.path.realpath(os.path.expanduser("~")))


def _allowed_roots() -> List[Path]:
    """Folders Files may open/save: the user's home and Android shared storage."""
    roots: List[Path] = []
    seen: set[str] = set()
    home = os.path.expanduser("~")
    for candidate in (home, "/sdcard", "/storage/emulated/0"):
        if candidate != home and not os.path.exists(candidate):
            continue
        r = Path(os.path.realpath(candidate))
        s = str(r)
        if s not in seen:
            seen.add(s)
            roots.append(r)
    return roots


def _hermes_homes() -> List[Path]:
    """Every Hermes home directory that may hold config, secrets, plugins or internal state."""
    roots: List[Path] = []
    seen: set[str] = set()

    def add(p: Path) -> None:
        r = Path(os.path.realpath(str(p)))
        s = str(r)
        if s not in seen:
            seen.add(s)
            roots.append(r)

    add(_home_dir() / ".hermes")
    if ROOT.parent.name == "mobile":
        add(ROOT.parent.parent)
    for env_name in ("HERMES_HOME", "HERMES_MOBILE_ROOT"):
        val = (os.environ.get(env_name) or "").strip()
        if val:
            p = Path(os.path.realpath(os.path.expanduser(val)))
            add(p)
            if p.parent.name == "profiles":
                add(p.parent.parent)
    return roots


def _is_env_file(name: str) -> bool:
    low = name.lower()
    return low == ".env" or low.startswith(".env.")


def _check_allowed_path(real: Path, verb: str = "open") -> None:
    if not any(_is_within(real, r) for r in _allowed_roots()):
        raise CanvasError(f"refused: this file is outside the folders Hermux can {verb}")


def _check_open_path(real: Path) -> None:
    _check_allowed_path(real, "open")
    home = _home_dir()
    if _is_within(real, home / ".hermes-mobile") or _is_within(real, home / ".ssh") or _is_env_file(real.name):
        raise CanvasError("refused: Hermux won’t open secrets or key files in the canvas")
    for hh in _hermes_homes():
        if _is_within(real, hh):
            if real.name.lower() in _HERMES_SECRET_FILES or _is_within(real, hh / "mobile"):
                raise CanvasError("refused: Hermux won’t open secrets or internal files in the canvas")


def _check_save_path(raw_path: str) -> Path:
    p = os.path.expanduser((raw_path or "").strip())
    if not os.path.isabs(p):
        raise CanvasError("give an absolute path (like /root/notes.md or /sdcard/Download/file.txt)")
    if Path(p).is_symlink():
        raise CanvasError("refused: won’t save through a symbolic link")
    real = Path(os.path.realpath(p))
    _check_allowed_path(real, "save to")
    home = _home_dir()
    if _is_within(real, home / ".hermes-mobile") or any(_is_within(real, hh) for hh in _hermes_homes()):
        raise CanvasError("refused: Hermux won’t overwrite its own settings, secrets or plugin files from the canvas. Change them in Settings instead.")
    if _is_env_file(real.name):
        raise CanvasError("refused: Hermux won’t overwrite .env secrets files from the canvas. Change API keys in Settings instead.")
    if _is_within(real, home / ".ssh") or _is_within(real, home / "bin"):
        raise CanvasError("refused: this file is outside the folders Hermux can save to")
    if real.parent == home and real.name in _SHELL_INIT_FILES:
        raise CanvasError("refused: Hermux won’t overwrite shell start-up files from the canvas")
    return real


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _phone_path(p: str) -> Path:
    """Paths as the agent/app write them (/root/…, ~/…, /sdcard/…) → a real path inside this environment."""
    p = os.path.expanduser(p.strip())
    if not os.path.isabs(p):
        raise CanvasError("give an absolute path (like /root/notes.md or /sdcard/Download/file.txt)")
    return Path(os.path.realpath(p))


def open_file(session: str, path: str, by: str = "agent") -> Dict[str, Any]:
    """Load a text file from the phone into a new canvas document linked to that path."""
    real = _phone_path(path)
    _check_open_path(real)
    if not real.is_file():
        raise CanvasError(f"no such file: {path}")
    if real.stat().st_size > MAX_FILE_BYTES:
        raise CanvasError(f"file is too big to open here ({real.stat().st_size:,} bytes, limit {MAX_FILE_BYTES:,})")
    raw = real.read_bytes()
    if b"\x00" in raw[:4096]:
        raise CanvasError("that looks like a binary file, not text")
    text = raw.decode("utf-8", errors="replace")
    digest = _sha256_bytes(raw)
    # Same file already open? Refresh it (and its disk hash) instead of piling up copies.
    with _locked(session) as d:
        for p in sorted(d.glob("*.json")):
            try:
                existing = _read(p)
            except Exception:
                continue
            if existing.get("path") == str(real):
                existing["file_sha256"] = digest
                if text != existing["content"]:
                    _commit(d, existing, text, by, "reloaded from file")
                else:
                    _write(d / f"{existing['id']}.json", existing)
                return get(session, existing["id"], with_versions=False)
        if len(list(d.glob("*.json"))) >= MAX_DOCS:
            raise CanvasError(f"this canvas already has {MAX_DOCS} documents: close one first")
        t, lang = guess_type(real.name, text)
        title = real.name.strip() or "Untitled"
        doc = {"id": _slug(title), "title": title[:120], "type": t, "lang": lang, "rev": 0, "content": "",
               "versions": [], "created": _now(), "updated": _now(), "path": str(real), "file_sha256": digest}
        _commit(d, doc, text, by, "created")
        return get(session, doc["id"], with_versions=False)


def save_file(session: str, doc_id: str, force: bool = False) -> Dict[str, Any]:
    """Write the document back to the file it was opened from. Refuses paths outside allowed folders and
    protected Hermes/secrets/system files; refuses to overwrite a file changed on disk unless `force=True`."""
    with _locked(session) as d:
        doc = _load(d, doc_id)
        if not doc.get("path"):
            raise CanvasError("this document isn't linked to a file")
        real = _check_save_path(doc["path"])
        if not real.parent.is_dir():
            raise CanvasError("the folder for this file no longer exists")
        if real.exists() and not real.is_file():
            raise CanvasError("refused: target is not a regular file")
        if not force:
            expected = doc.get("file_sha256")
            if expected is None and doc.get("versions"):
                expected = _sha256_bytes(str(doc["versions"][0].get("content", "")).encode("utf-8"))
            if not real.exists():
                raise CanvasError("conflict: the original file was removed or moved since you opened it")
            current = _sha256_bytes(real.read_bytes())
            if expected is None or current != expected:
                raise CanvasError("conflict: the file on disk changed since you opened it")
        data = doc["content"].encode("utf-8")
        fd, tmp_name = tempfile.mkstemp(prefix=f".{real.name}.", suffix=".hm.tmp", dir=str(real.parent))
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp_name, real)
        except Exception:
            with contextlib.suppress(OSError):
                os.unlink(tmp_name)
            raise
        doc["file_sha256"] = _sha256_bytes(data)
        _write(d / f"{doc['id']}.json", doc)
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
        "Every canvas document is kept in the user's Canvas gallery (all chats, searchable, grouped by type), so "
        "nothing needs saving; when the user asks to keep something, it already is."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["create", "write", "patch", "read", "list", "open_file", "close", "rename"],
                       "description": "create: new document. write: replace a document's whole content. patch: exact find/replace edits. read: get the current content (including the user's edits). list: documents on the canvas. open_file: show a file from the phone on the canvas. close: remove a document. rename."},
            "id": {"type": "string", "description": "Document id (from create/list) or its exact title. Optional when the canvas has exactly one document."},
            "title": {"type": "string", "description": "Document title (create, rename; optional on write)."},
            "type": {"type": "string", "enum": list(TYPES), "description": "Content type (create). Guessed from the title/file when omitted."},
            "lang": {"type": "string", "description": "Programming language when type=code (python, javascript…)."},
            "content": {"type": "string", "description": "Full text (create, write)."},
            "edits": {"type": "array", "description": "For patch: list of {find, replace, all?}. `find` must match exactly once unless all=true.",
                      "items": {"type": "object", "properties": {"find": {"type": "string"}, "replace": {"type": "string"}, "all": {"type": "boolean"}}, "required": ["find", "replace"]}},
            "path": {"type": "string", "description": "Absolute file path on the phone (open_file)."},
            "note": {"type": "string", "description": "Short note for the version history (what changed)."},
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
            r = create(sid, args.get("title", ""), args.get("content", ""), args.get("type", ""), args.get("lang", ""), by="agent")
            return _with_lint(sid, {"ok": True, "id": r["id"], "rev": r["rev"], "title": r["title"], "type": r["type"], "chars": r["chars"], "shown": True})
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
            return json.dumps({"ok": True, "documents": [{k: m[k] for k in ("id", "title", "type", "rev", "chars", "by", "path")} for m in list_docs(sid)]})
        if a == "open_file":
            r = open_file(sid, args.get("path", ""), by="agent")
            return json.dumps({"ok": True, "id": r["id"], "title": r["title"], "type": r["type"], "chars": r["chars"], "shown": True})
        if a == "close":
            delete(sid, _resolve_id(sid, args.get("id", "")))
            return json.dumps({"ok": True})
        if a == "rename":
            r = rename(sid, _resolve_id(sid, args.get("id", "")), args.get("title", ""))
            return json.dumps({"ok": True, "id": r["id"], "title": r["title"]})
        if a == "save_to_library":  # the old Library's action: every document is in the gallery already
            return json.dumps({"ok": True, "note": "Every canvas document is already in the user's Canvas gallery; nothing to save."})
        raise CanvasError("unknown action: use create, write, patch, read, list, open_file, close or rename")
    except CanvasError as e:
        return json.dumps({"ok": False, "error": str(e)})
    except Exception as e:  # never let a bug here break the agent's turn
        return json.dumps({"ok": False, "error": f"canvas failed: {type(e).__name__}: {e}"})
