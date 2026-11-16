"""Auto access: a chat that runs without approval prompts EXCEPT for Hermes's own list of dangerous commands.

The app's "Auto" button has two levels per chat:
  - Full access = Hermes's /yolo (no prompts; Hermes's unbypassable hardline floor still blocks rm -rf /, mkfs,
    shutdown and the like).
  - Auto access = /yolo too, plus this module: before a `terminal` or `execute_code` call it runs Hermes's own
    `detect_dangerous_command` (the DANGEROUS_PATTERNS list) and blocks a match, unless the user already allowed that
    pattern "always" or for this chat. The model is told what was blocked and that the user can allow it.

The app writes the chat ids in Auto access to ~/.hermes/mobile/auto.json (dashboard PUT /auto) BEFORE it turns
/yolo on, and turns /yolo off before it removes the entry, so a chat is never silently in Full access. The file is
shared by the dashboard and the agent processes; it is re-read when it changes.

Which chat: the hook's stored id, and Hermes's approval session key (the key /yolo is kept under; a subagent runs under
its parent's). A context compression can give a chat a new stored id (Hermes moves /yolo to it), so each of those ids is
also followed back through the segments it was compressed from (the session database's `parent_session_id` while the
parent ended by compression); an entry under any of them counts. When that chain can't be read, Auto access is in use
and Hermes would not ask (/yolo), a dangerous command is blocked rather than run. Turning Auto off removes the entry
under the id given and under its older segments.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, Optional

PATH = Path.home() / ".hermes" / "mobile" / "auto.json"
MAX_CHATS = 500
MAX_SEGMENTS = 16      # older compression segments followed per id
MAX_LINEAGE = 1000     # stored ids whose older segments are remembered (this process)

_lock = threading.Lock()
_cache: tuple = (None, {})  # ((mtime_ns, inode, size), {session: "auto"})
_lineage_cache: Dict[str, tuple] = {}  # stored id -> the ids it was compressed from, nearest first


def _state_db() -> Path:
    """The agent's session database (a test points this elsewhere)."""
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home()) / "state.db"
    except Exception:
        return Path.home() / ".hermes" / "state.db"


def _older_segments(sid: str) -> Optional[tuple]:
    """The stored ids a context compression rotated `sid` away from, nearest first; () when there are none or there is
    no database; None when the database exists but can't be read. Read-only; remembered once the chat's row is found
    (a session's parent never changes)."""
    hit = _lineage_cache.get(sid)
    if hit is not None:
        return hit
    db = _state_db()
    if not db.exists():
        return ()
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.0)
        try:
            known = con.execute("SELECT 1 FROM sessions WHERE id = ?", (sid,)).fetchone() is not None
            out: list = []
            cur = sid
            for _ in range(MAX_SEGMENTS):
                row = con.execute(
                    "SELECT p.id FROM sessions c JOIN sessions p ON p.id = c.parent_session_id "
                    "WHERE c.id = ? AND p.end_reason = 'compression'", (cur,)).fetchone()
                if not row or not isinstance(row[0], str) or not row[0] or row[0] == sid or row[0] in out:
                    break
                out.append(row[0])
                cur = row[0]
        finally:
            con.close()
    except Exception:
        return None
    res = tuple(out)
    if known:
        with _lock:
            while len(_lineage_cache) >= MAX_LINEAGE:
                _lineage_cache.pop(next(iter(_lineage_cache)))
            _lineage_cache[sid] = res
    return res


def _approval_key() -> str:
    try:
        from tools.approval_context import get_current_session_key
        return str(get_current_session_key(default="") or "")
    except Exception:
        return ""


def _ids(session_id: Optional[str]) -> list:
    """The ids this tool call's chat may be in auto.json under: its stored id and the approval session key."""
    out: list = []
    for i in (session_id, _approval_key()):
        i = str(i or "").strip()
        if i and i not in out:
            out.append(i)
    return out


def _auto_state(session_id: Optional[str]) -> str:
    """"auto" when the chat (by one of its ids or an older segment of one) is in Auto access, "" when it isn't,
    "unknown" when an older segment couldn't be read and no entry matched."""
    chats = _read()
    if not chats:
        return ""
    ids = _ids(session_id)
    if any(chats.get(i) == "auto" for i in ids):
        return "auto"
    unknown = False
    for i in ids:
        older = _older_segments(i)
        if older is None:
            unknown = True
        elif any(chats.get(o) == "auto" for o in older):
            return "auto"
    return "unknown" if unknown else ""


def _hermes_skips_asking() -> bool:
    """Would Hermes run a dangerous command without asking in this chat (/yolo, or approvals off)? True when that
    can't be told."""
    try:
        from tools import approval as ap
        from tools import approval_context as ac
        return bool(ap.is_session_yolo_enabled(_approval_key())) or ac._get_approval_mode() == "off"
    except Exception:
        return True


def _read() -> Dict[str, str]:
    global _cache
    try:
        s = PATH.stat()
        st = (s.st_mtime_ns, s.st_ino, s.st_size)  # every write replaces the file: a new inode
    except OSError:
        return {}
    with _lock:
        if _cache[0] == st:
            return _cache[1]
        try:
            d = json.loads(PATH.read_text())
            chats = d.get("chats") if isinstance(d, dict) else None
            chats = {str(k): str(v) for k, v in chats.items()} if isinstance(chats, dict) else {}
        except Exception:
            chats = {}
        _cache = (st, chats)
        return chats


def mode_of(session_id: Optional[str]) -> str:
    """"auto" when the chat is in Auto access, else "" (the /yolo flag itself lives in Hermes)."""
    return "auto" if session_id and _read().get(str(session_id)) == "auto" else ""


def set_mode(session_id: str, mode: str) -> str:
    """mode "auto" adds the chat, anything else removes it. Returns the stored mode."""
    sid = str(session_id or "").strip()
    if not sid or len(sid) > 200:
        raise ValueError("session id needed")
    older = (_older_segments(sid) or ()) if mode != "auto" else ()   # the same chat before a compression gave it a new id
    with _lock:
        try:
            d = json.loads(PATH.read_text())
            chats = d.get("chats") if isinstance(d, dict) else None
            chats = dict(chats) if isinstance(chats, dict) else {}
        except Exception:
            chats = {}
        if mode == "auto":
            chats.pop(sid, None)
            chats[sid] = "auto"  # newest last, so the trim drops the oldest
            while len(chats) > MAX_CHATS:
                chats.pop(next(iter(chats)))
        else:
            chats.pop(sid, None)
            for o in older:
                chats.pop(o, None)
        PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps({"chats": chats}))
        tmp.replace(PATH)
    return "auto" if mode == "auto" else ""


def _approved(text: str, pattern_key: str) -> bool:
    """The user already said "always" (permanent allowlist) or "this session" for this pattern."""
    try:
        from tools import approval as ap
        if ap._command_matches_permanent_allowlist(text) or ap._is_permanently_approved(pattern_key):
            return True
        from tools.approval_context import get_current_session_key
        key = get_current_session_key(default="")
        return bool(key) and ap.is_approved(key, pattern_key)
    except Exception:
        return False


def _detect(text: str):
    from tools.approval_detection import detect_dangerous_command
    return detect_dangerous_command(text)


def _calls(tool_name: Any, args: Any):
    """The tool calls inside one call: Hermes's Tool Search bridge (`tool_call`) can carry several."""
    if tool_name == "tool_call" and isinstance(args, dict) and isinstance(args.get("calls"), list):
        for c in args["calls"]:
            if isinstance(c, dict) and c.get("name"):
                inner = c.get("arguments")
                yield str(c["name"]), inner if isinstance(inner, dict) else {}
        return
    yield str(tool_name or ""), args if isinstance(args, dict) else {}


def check(tool_name: Any, args: Any, session_id: Optional[str]) -> Optional[dict]:
    """A pre_tool_call directive {"action": "block", "message"} for a dangerous command in an Auto access chat."""
    if not _read():
        return None   # no chat is in Auto access
    state: Optional[str] = "auto" if mode_of(session_id) == "auto" or mode_of(_approval_key()) == "auto" else None
    for name, a in _calls(tool_name, args):
        if name == "terminal":
            text = str(a.get("command") or "")
        elif name == "execute_code":
            text = str(a.get("code") or "")
        else:
            continue
        if not text:
            continue
        try:
            dangerous, pattern_key, description = _detect(text)
        except Exception:
            # Hermes's detector is missing or broke: the safe side is to ask the user to choose a mode.
            if state is None:
                state = _auto_state(session_id)
            if state == "auto" or (state == "unknown" and _hermes_skips_asking()):
                return {"action": "block", "message": (
                    "BLOCKED by Auto access: Hermux's dangerous-command check is unavailable, so shell commands and code "
                    "can't run in Auto access right now. Tell the user; they can switch the chat to Full access or turn "
                    "Auto off (then Hermux asks before risky commands).")}
            return None
        if not dangerous or _approved(text, pattern_key):
            continue
        if state is None:
            state = _auto_state(session_id)   # read the chat's older segments only for a dangerous command
        if state == "unknown" and _hermes_skips_asking():
            return {"action": "block", "message": (
                f"BLOCKED: this {'command' if name == 'terminal' else 'script'} is on Hermux's dangerous-command list "
                f"({description}), and Hermux could not confirm whether this chat is in Auto access. Do not try to get "
                "around it with another command or tool. Tell the user exactly what you want to run and why; they can "
                "set the chat's access again with the Auto button at the top.")}
        if state != "auto":
            return None
        what = "command" if name == "terminal" else "script"
        return {"action": "block", "message": (
            f"BLOCKED by Auto access: this {what} is on Hermux's dangerous-command list ({description}). "
            "Auto access runs everything else without asking but never runs these. Do not try to get around it with "
            "another command or tool. Tell the user exactly what you want to run and why; they can allow it by "
            "switching the chat to Full access (the Auto button at the top) or by turning Auto off, so Hermux asks "
            "for approval.")}
    return None
