"""Canvas: documents Hermes and the user share for one chat (notes, markdown, HTML, code…).

Storage: ~/.hermes/mobile/canvas/<chat id>/<doc id>.json, one file per document with its version history.
Used from two processes (the agent's `canvas` tool and the dashboard REST API), so every change happens
under an exclusive file lock and is written atomically.

Pure stdlib on purpose: the plugin must load anywhere Hermes does.
"""

from __future__ import annotations

import contextlib
import errno
import fcntl
import hashlib
import json
import os
import re
import secrets
import stat
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

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
    ".shinit", ".cshrc", ".tcshrc", ".kshrc",
})
_PROTECTED_SAVE_FILES = _SHELL_INIT_FILES | frozenset({".gitconfig", ".netrc"})
_OPEN_SECRET_SEGMENTS = frozenset({".hermes-mobile", ".ssh", ".gnupg", ".aws", ".android", ".termux"})
_OPEN_SECRET_FILES = frozenset({".netrc"})
_SAVE_BLOCKED_SEGMENTS = _OPEN_SECRET_SEGMENTS
_SAVE_BLOCKED_PAIRS = frozenset({
    (".local", "bin"),
    (".config", "git"),
    (".config", "fish"),
})
_CONTAINER_ROOTFS_SEGMENTS = frozenset({"proot-distro", "chroot-distro"})
_KERNEL_PSEUDO_ROOTS = frozenset({"proc", "sys", "dev"})
_HERMES_SECRET_FILES = frozenset({
    "auth.json", ".anthropic_oauth.json", "google_token.json",
    "google_client_secret.json", "google_oauth_pending.json",
})
_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_O_NONBLOCK = getattr(os, "O_NONBLOCK", 0)
_DIR_FD_UNSUPPORTED = frozenset({
    errno.ENOSYS,
    errno.EOPNOTSUPP,
    getattr(errno, "ENOTSUP", errno.EOPNOTSUPP),
})


# Default_Ignorable_Code_Point characters outside General_Category Cf (combining grapheme joiner, variation
# selectors, Hangul fillers, Mongolian free variation selectors, ...). Android's casefolded ext4/f2fs (utf8nfdicf)
# ignores every default-ignorable character, so these must go too, or `.e\u034fnv` would reach the real `.env`.
_IGNORABLE_NON_CF = (
    (0x034F, 0x034F), (0x115F, 0x1160), (0x17B4, 0x17B5), (0x180B, 0x180D), (0x180F, 0x180F), (0x2065, 0x2065),
    (0x3164, 0x3164), (0xFE00, 0xFE0F), (0xFFA0, 0xFFA0), (0xFFF0, 0xFFF8), (0xE0000, 0xE0FFF),
)


def _ignorable(ch: str) -> bool:
    if unicodedata.category(ch) == "Cf":
        return True
    o = ord(ch)
    return any(lo <= o <= hi for lo, hi in _IGNORABLE_NON_CF)


def _fold(s: str) -> str:
    """Fold a path segment/name like casefolding filesystems (Android ext4/f2fs: NFKD, drop every default-ignorable
    character, casefold; APFS)."""
    cleaned = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not _ignorable(ch))
    return cleaned.casefold()


def _low_segments(path: Path) -> Tuple[str, ...]:
    return tuple(_fold(s) for s in path.parts if s and s.strip("/"))


def _has_pair(low: Tuple[str, ...], a: str, b: str) -> bool:
    return any(low[i] == a and low[i + 1] == b for i in range(len(low) - 1))


def _rel_ci(path: Path, root: Path) -> Optional[Tuple[str, ...]]:
    """Unicode-folded relative path segments when `path` is equal to or under `root`, else None."""
    if path.is_absolute() != root.is_absolute():
        return None
    p_parts = _low_segments(path)
    r_parts = _low_segments(root)
    if len(p_parts) < len(r_parts) or p_parts[:len(r_parts)] != r_parts:
        return None
    return p_parts[len(r_parts):]


def _is_within_ci(path: Path, root: Path) -> bool:
    return _rel_ci(path, root) is not None


def _is_home_bin(real: Path, low: Tuple[str, ...]) -> bool:
    """True for home's top-level `bin/` (active HOME, `/root/bin`, or Termux home `bin/`), not nested project `bin/`."""
    if _is_within_ci(real, _home_dir() / "bin"):
        return True
    if len(low) >= 2 and low[0] == "root" and low[1] == "bin":
        return True
    if low[:6] == ("data", "data", "com.termux", "files", "home", "bin"):
        return True
    if len(low) >= 7 and low[:2] == ("data", "user") and low[3:7] == ("com.termux", "files", "home", "bin"):
        return True
    return False


def _home_dir() -> Path:
    return Path(os.path.realpath(os.path.expanduser("~")))


def _plugin_dir() -> Path:
    return Path(os.path.realpath(str(Path(__file__).resolve().parent)))


_EXTRA_SAVE_ROOTS: Tuple[str, ...] = ("/sdcard", "/storage/emulated/0")


def _allowed_root_pairs() -> List[Tuple[Path, Path]]:
    """Folders Files may save to: the user's home and Android shared storage, as (raw, real) pairs.
    Deduped by (raw, real) so aliases that resolve to the same real directory (e.g. /sdcard and
    /storage/emulated/0) each keep their raw prefix."""
    pairs: List[Tuple[Path, Path]] = []
    seen: set[Tuple[str, str]] = set()
    home = os.path.expanduser("~")
    for candidate in (home, *_EXTRA_SAVE_ROOTS):
        if candidate != home and not os.path.exists(candidate):
            continue
        raw_r = Path(os.path.normpath(candidate))
        real_r = Path(os.path.realpath(candidate))
        key = (str(raw_r), str(real_r))
        if key not in seen:
            seen.add(key)
            pairs.append((raw_r, real_r))
    return pairs


def _hermes_homes() -> List[Path]:
    """Every Hermes home (and every profile directory under it) that may hold config, secrets, plugins or state."""
    roots: List[Path] = []
    seen: set[str] = set()

    def add(p: Path) -> None:
        for cand in (p, Path(os.path.realpath(str(p)))):
            s = str(cand)
            if s not in seen:
                seen.add(s)
                roots.append(cand)

    seeds: List[Path] = [_home_dir() / ".hermes"]
    if _fold(ROOT.parent.name) == "mobile":
        seeds.append(ROOT.parent.parent)
    for env_name in ("HERMES_HOME", "HERMES_MOBILE_ROOT"):
        val = (os.environ.get(env_name) or "").strip()
        if val:
            p = Path(os.path.realpath(os.path.expanduser(val)))
            seeds.append(p)
            if _fold(p.parent.name) == "profiles":
                seeds.append(p.parent.parent)
    for hh in seeds:
        add(hh)
        profiles_dir = Path(os.path.realpath(str(hh))) / "profiles"
        try:
            if profiles_dir.is_dir():
                for child in profiles_dir.iterdir():
                    add(child)
        except OSError:
            pass
    return roots


def _is_env_file(name: str) -> bool:
    low = _fold(name)
    return low == ".env" or low.startswith(".env.")


def _validate_raw_path(raw_path: str) -> str:
    if not isinstance(raw_path, str) or "\x00" in raw_path:
        raise CanvasError("refused: invalid path")
    s = raw_path.strip()
    if s.startswith("~") and s != "~" and not s.startswith("~/"):
        raise CanvasError("refused: invalid path")
    p = os.path.expanduser(s)
    if not os.path.isabs(p):
        raise CanvasError("give an absolute path (like /root/notes.md or /sdcard/Download/file.txt)")
    return p


def _is_hermes_segment_secret(low: Tuple[str, ...]) -> bool:
    name = low[-1] if low else ""
    for i, seg in enumerate(low):
        if seg != ".hermes":
            continue
        inside = low[i + 1:]
        if not inside:
            continue
        if name in _HERMES_SECRET_FILES:
            return True
        sub = inside[2:] if len(inside) >= 2 and inside[0] == "profiles" else inside
        if sub and sub[0] == "mobile":
            return True
    return False


def _check_open_path(path: Path) -> None:
    """Refuse secrets, container rootfs aliases, kernel pseudo-fs, etc/ssh and internal files by segment at any
    depth (Unicode case-folded), plus resolved `_hermes_homes()` as an extra layer."""
    low = _low_segments(path)
    name = low[-1] if low else ""
    if low and low[0] in _KERNEL_PSEUDO_ROOTS:
        raise CanvasError("refused: Hermux won’t open system or device files in the canvas")
    if any(seg in _CONTAINER_ROOTFS_SEGMENTS for seg in low):
        raise CanvasError("refused: Hermux won’t open container rootfs files in the canvas")
    if _has_pair(low, "etc", "ssh"):
        raise CanvasError("refused: Hermux won’t open secrets or key files in the canvas")
    if _is_env_file(name) or name in _OPEN_SECRET_FILES or any(seg in _OPEN_SECRET_SEGMENTS for seg in low):
        raise CanvasError("refused: Hermux won’t open secrets or key files in the canvas")
    if _is_hermes_segment_secret(low):
        raise CanvasError("refused: Hermux won’t open secrets or internal files in the canvas")
    for hh in _hermes_homes():
        rel_hh = _rel_ci(path, hh)
        if rel_hh is not None:
            if name in _HERMES_SECRET_FILES or (len(rel_hh) >= 1 and rel_hh[0] == "mobile"):
                raise CanvasError("refused: Hermux won’t open secrets or internal files in the canvas")


def _is_in_secret_reach(real: Path) -> bool:
    low = _low_segments(real)
    if ".hermes" in low or ".hermes-mobile" in low:
        return True
    return any(_is_within_ci(real, hh) for hh in _hermes_homes())


def _check_save_denylist(real: Path) -> None:
    low = _low_segments(real)
    name = low[-1] if low else ""
    if (
        ".hermes" in low
        or ".hermes-mobile" in low
        or _is_within_ci(real, _plugin_dir())
        or any(_is_within_ci(real, hh) for hh in _hermes_homes())
    ):
        raise CanvasError("refused: Hermux won’t overwrite its own settings, secrets or plugin files from the canvas. Change them in Settings instead.")
    if _is_env_file(name):
        raise CanvasError("refused: Hermux won’t overwrite .env secrets files from the canvas. Change API keys in Settings instead.")
    if (
        (low and low[0] in _KERNEL_PSEUDO_ROOTS)
        or any(seg in _CONTAINER_ROOTFS_SEGMENTS for seg in low)
        or _has_pair(low, "etc", "ssh")
        or any(seg in _SAVE_BLOCKED_SEGMENTS for seg in low)
        or any(_has_pair(low, a, b) for a, b in _SAVE_BLOCKED_PAIRS)
        or _is_home_bin(real, low)
    ):
        raise CanvasError("refused: this file is outside the folders Hermux can save to")
    if name in _PROTECTED_SAVE_FILES:
        if name in _SHELL_INIT_FILES:
            raise CanvasError("refused: Hermux won’t overwrite shell start-up files from the canvas")
        raise CanvasError("refused: this file is outside the folders Hermux can save to")


def _match_save_root(raw_abs: str) -> Tuple[Path, Tuple[str, ...]]:
    """Match an absolute path to an allowed save root (case-sensitively) without collapsing intermediate symlinks."""
    clean = Path(raw_abs)
    if ".." in clean.parts:
        raise CanvasError("refused: invalid path")
    for raw_r, real_r in _allowed_root_pairs():
        for cand_r in (real_r, raw_r):
            try:
                rel = clean.relative_to(cand_r)
            except ValueError:
                continue
            if not rel.parts:
                raise CanvasError("refused: target is not a regular file")
            return real_r, rel.parts
    raise CanvasError("refused: this file is outside the folders Hermux can save to")


def _check_no_symlinks_under_root(real_root: Path, rel_parts: Sequence[str]) -> None:
    cur = real_root
    for i, part in enumerate(rel_parts):
        cur = cur / part
        is_leaf = i == len(rel_parts) - 1
        try:
            st = os.lstat(cur)
        except FileNotFoundError:
            if not is_leaf:
                raise CanvasError("the folder for this file no longer exists")
            return
        except NotADirectoryError:
            raise CanvasError("the folder for this file no longer exists")
        if stat.S_ISLNK(st.st_mode):
            raise CanvasError("refused: won’t save through a symbolic link")
        if not is_leaf and not stat.S_ISDIR(st.st_mode):
            raise CanvasError("the folder for this file no longer exists")


def _fs_error(action: str, e: OSError) -> CanvasError:
    if e.errno in (errno.EACCES, errno.EPERM):
        return CanvasError(f"cannot {action} file: permission denied")
    if e.errno == errno.EROFS:
        return CanvasError(f"cannot {action} file: read-only file system")
    if e.errno == errno.ENAMETOOLONG:
        return CanvasError(f"cannot {action} file: file path is too long")
    if e.errno in (errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)):
        return CanvasError(f"cannot {action} file: no space left on device")
    return CanvasError(f"cannot {action} file: {e.strerror or e}")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_bounded_fd(fd: int, limit: int = MAX_FILE_BYTES) -> bytes:
    chunks: List[bytes] = []
    total = 0
    cap = limit + 1
    while total < cap:
        chunk = os.read(fd, min(65536, cap - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
    return b"".join(chunks)


def _write_all_fd(fd: int, data: bytes) -> None:
    view = memoryview(data)
    written = 0
    while written < len(view):
        n = os.write(fd, view[written:])
        if n <= 0:
            raise OSError("short write")
        written += n


def _open_dir_chain(root: Path, dir_parts: Sequence[str], *, nofollow: bool, verb: str = "save") -> int:
    flags = os.O_RDONLY | _O_DIRECTORY
    step_flags = flags | (_O_NOFOLLOW if nofollow else 0)
    cur_fd = os.open(str(root), flags)
    try:
        for part in dir_parts:
            try:
                nxt = os.open(part, step_flags, dir_fd=cur_fd)
            except OSError as e:
                if e.errno == errno.ELOOP:
                    raise CanvasError(f"refused: won’t {verb} through a symbolic link") from e
                if e.errno == errno.ENOTDIR and nofollow:
                    with contextlib.suppress(OSError):
                        if stat.S_ISLNK(os.lstat(part, dir_fd=cur_fd).st_mode):
                            raise CanvasError(f"refused: won’t {verb} through a symbolic link") from e
                if e.errno in (errno.ENOENT, errno.ENOTDIR):
                    raise CanvasError("the folder for this file no longer exists") from e
                raise
            os.close(cur_fd)
            cur_fd = nxt
        return cur_fd
    except Exception:
        with contextlib.suppress(OSError):
            os.close(cur_fd)
        raise


def _open_readonly_bounded(real: Path, raw_label: str) -> Tuple[bytes, os.stat_result]:
    """Open `real` walking its parent with O_NOFOLLOW (falling back only when openat/dir_fd is unsupported),
    require a regular file, and read at most MAX_FILE_BYTES."""
    leaf_flags = os.O_RDONLY | _O_NOFOLLOW | _O_NONBLOCK
    fd = -1
    parent_fd = -1
    try:
        try:
            parent_parts = [p for p in real.parent.parts if p and p.strip("/")]
            parent_fd = _open_dir_chain(Path("/"), parent_parts, nofollow=True, verb="open")
            fd = os.open(real.name, leaf_flags, dir_fd=parent_fd)
        except (NotImplementedError, OSError) as e:
            if isinstance(e, OSError) and e.errno not in _DIR_FD_UNSUPPORTED:
                raise
            if parent_fd >= 0:
                with contextlib.suppress(OSError):
                    os.close(parent_fd)
                parent_fd = -1
            fd = os.open(str(real), leaf_flags)
    except CanvasError as e:
        if "folder for this file no longer exists" in str(e):
            raise CanvasError(f"no such file: {raw_label}") from e
        raise
    except OSError as e:
        if e.errno == errno.ELOOP:
            raise CanvasError("refused: won’t open through a symbolic link") from e
        if e.errno in (errno.ENOENT, errno.ENOTDIR, errno.EISDIR):
            raise CanvasError(f"no such file: {raw_label}") from e
        raise _fs_error("read", e) from e
    finally:
        if parent_fd >= 0:
            with contextlib.suppress(OSError):
                os.close(parent_fd)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise CanvasError(f"no such file: {raw_label}")
        if st.st_size > MAX_FILE_BYTES:
            raise CanvasError(f"file is too big to open here ({st.st_size:,} bytes, limit {MAX_FILE_BYTES:,})")
        raw = _read_bounded_fd(fd, MAX_FILE_BYTES)
        if len(raw) > MAX_FILE_BYTES:
            raise CanvasError(f"file is too big to open here ({len(raw):,} bytes, limit {MAX_FILE_BYTES:,})")
        return raw, st
    except OSError as e:
        raise _fs_error("read", e) from e
    finally:
        with contextlib.suppress(OSError):
            os.close(fd)


def open_file(session: str, path: str, by: str = "agent") -> Dict[str, Any]:
    """Load a text file from the phone into a new canvas document linked to that path."""
    raw_abs = _validate_raw_path(path)
    _check_open_path(Path(os.path.abspath(raw_abs)))
    try:
        real = Path(os.path.realpath(raw_abs))
    except OSError as e:
        raise _fs_error("read", e) from e
    _check_open_path(real)
    raw, st = _open_readonly_bounded(real, path)
    if _is_in_secret_reach(real) and st.st_nlink > 1:
        raise CanvasError("refused: Hermux won’t open hard-linked files inside Hermux’s own folders")
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


def _expected_digest(doc: Dict[str, Any]) -> Optional[str]:
    expected = doc.get("file_sha256")
    if expected is None and doc.get("versions"):
        expected = _sha256_bytes(str(doc["versions"][0].get("content", "")).encode("utf-8"))
    return expected


def _inspect_existing_fd(fd: int, doc: Dict[str, Any], force: bool) -> int:
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode):
        raise CanvasError("refused: target is not a regular file")
    mode = stat.S_IMODE(st.st_mode) & 0o777
    if not force:
        expected = _expected_digest(doc)
        if st.st_size > MAX_FILE_BYTES:
            raise CanvasError("conflict: the file on disk changed since you opened it")
        cur_bytes = _read_bounded_fd(fd, MAX_FILE_BYTES)
        if len(cur_bytes) > MAX_FILE_BYTES or expected is None or _sha256_bytes(cur_bytes) != expected:
            raise CanvasError("conflict: the file on disk changed since you opened it")
    return mode


class _DirFdUnsupported(Exception):
    """Raised only before any write when openat/dir_fd itself is unsupported on this filesystem."""


def _save_with_dir_fd(real_root: Path, rel_parts: Sequence[str], doc: Dict[str, Any], data: bytes, force: bool) -> None:
    leaf = rel_parts[-1]
    try:
        parent_fd = _open_dir_chain(real_root, rel_parts[:-1], nofollow=True, verb="save")
    except (NotImplementedError, OSError) as e:
        if isinstance(e, OSError) and e.errno not in _DIR_FD_UNSUPPORTED:
            raise
        raise _DirFdUnsupported() from e

    tmp_leaf: Optional[str] = None
    try:
        existing_mode: Optional[int] = None
        try:
            cur_fd = os.open(leaf, os.O_RDONLY | _O_NOFOLLOW | _O_NONBLOCK, dir_fd=parent_fd)
        except (NotImplementedError, OSError) as e:
            if isinstance(e, NotImplementedError) or e.errno in _DIR_FD_UNSUPPORTED:
                raise _DirFdUnsupported() from e
            if e.errno == errno.ELOOP:
                raise CanvasError("refused: won’t save through a symbolic link") from e
            if e.errno == errno.ENOENT:
                if not force:
                    raise CanvasError("conflict: the original file was removed or moved since you opened it") from e
            else:
                raise
        else:
            try:
                existing_mode = _inspect_existing_fd(cur_fd, doc, force)
            finally:
                with contextlib.suppress(OSError):
                    os.close(cur_fd)

        create_mode = (existing_mode & 0o777) if existing_mode is not None else 0o644
        tmp_fd = -1
        for _ in range(16):
            cand = f".{leaf}.{secrets.token_hex(6)}.hm.tmp"
            try:
                tmp_fd = os.open(cand, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _O_NOFOLLOW, create_mode, dir_fd=parent_fd)
                tmp_leaf = cand
                break
            except FileExistsError:
                continue
        if tmp_fd < 0 or tmp_leaf is None:
            raise CanvasError("could not create temporary file")
        try:
            _write_all_fd(tmp_fd, data)
            if existing_mode is not None:
                with contextlib.suppress(OSError):
                    os.fchmod(tmp_fd, existing_mode & 0o777)
        finally:
            with contextlib.suppress(OSError):
                os.close(tmp_fd)
        os.replace(tmp_leaf, leaf, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        tmp_leaf = None
    except Exception:
        if tmp_leaf is not None:
            with contextlib.suppress(OSError):
                os.unlink(tmp_leaf, dir_fd=parent_fd)
        raise
    finally:
        with contextlib.suppress(OSError):
            os.close(parent_fd)


def _save_fallback(real_root: Path, rel_parts: Sequence[str], doc: Dict[str, Any], data: bytes, force: bool) -> None:
    """Path-based fallback used only when openat/dir_fd itself is unsupported (e.g. FUSE /sdcard).
    Checks every component with lstat and opens the leaf with O_NOFOLLOW, but does not defend against
    a concurrent racing symlink swap between lstat and replace."""
    _check_no_symlinks_under_root(real_root, rel_parts)
    real = real_root.joinpath(*rel_parts)
    existing_mode: Optional[int] = None
    try:
        cur_fd = os.open(str(real), os.O_RDONLY | _O_NOFOLLOW | _O_NONBLOCK)
    except OSError as e:
        if e.errno == errno.ELOOP:
            raise CanvasError("refused: won’t save through a symbolic link") from e
        if e.errno == errno.ENOENT:
            if not force:
                raise CanvasError("conflict: the original file was removed or moved since you opened it") from e
        else:
            raise
    else:
        try:
            existing_mode = _inspect_existing_fd(cur_fd, doc, force)
        finally:
            with contextlib.suppress(OSError):
                os.close(cur_fd)

    create_mode = (existing_mode & 0o777) if existing_mode is not None else 0o644
    tmp_path: Optional[Path] = None
    tmp_fd = -1
    for _ in range(16):
        cand = real.parent / f".{real.name}.{secrets.token_hex(6)}.hm.tmp"
        try:
            tmp_fd = os.open(str(cand), os.O_WRONLY | os.O_CREAT | os.O_EXCL | _O_NOFOLLOW, create_mode)
            tmp_path = cand
            break
        except FileExistsError:
            continue
    if tmp_fd < 0 or tmp_path is None:
        raise CanvasError("could not create temporary file")
    try:
        try:
            _write_all_fd(tmp_fd, data)
            if existing_mode is not None:
                with contextlib.suppress(OSError):
                    os.fchmod(tmp_fd, existing_mode & 0o777)
        finally:
            with contextlib.suppress(OSError):
                os.close(tmp_fd)
        os.replace(tmp_path, real)
        tmp_path = None
    finally:
        if tmp_path is not None:
            with contextlib.suppress(OSError):
                os.unlink(tmp_path)


def save_file(session: str, doc_id: str, force: bool = False) -> Dict[str, Any]:
    """Write the document back to the file it was opened from. Refuses symlinks (including intermediate
    directories), paths outside allowed folders, and protected Hermes/secrets/code-execution/shell files;
    refuses to overwrite a file changed on disk unless `force=True`."""
    with _locked(session) as d:
        doc = _load(d, doc_id)
        if not doc.get("path"):
            raise CanvasError("this document isn't linked to a file")
        raw_abs = _validate_raw_path(doc["path"])
        real_root, rel_parts = _match_save_root(raw_abs)
        target = real_root.joinpath(*rel_parts)
        _check_save_denylist(target)
        try:
            _check_save_denylist(Path(os.path.realpath(str(target))))
        except OSError as e:
            raise _fs_error("save", e) from e
        data = doc["content"].encode("utf-8")
        try:
            try:
                _save_with_dir_fd(real_root, rel_parts, doc, data, force)
            except _DirFdUnsupported:
                _save_fallback(real_root, rel_parts, doc, data, force)
        except OSError as e:
            raise _fs_error("save", e) from e
        doc["file_sha256"] = _sha256_bytes(data)
        _write(d / f"{doc['id']}.json", doc)
        return {"path": str(target), "chars": len(doc["content"])}


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
