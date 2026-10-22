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
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional

PATH = Path.home() / ".hermes" / "mobile" / "auto.json"
MAX_CHATS = 500

_lock = threading.Lock()
_cache: tuple = (None, {})  # ((mtime_ns, inode, size), {session: "auto"})


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
    if mode_of(session_id) != "auto":
        return None
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
            return {"action": "block", "message": (
                "BLOCKED by Auto access: Hermes's dangerous-command check is unavailable, so shell commands and code "
                "can't run in Auto access right now. Tell the user; they can switch the chat to Full access or turn "
                "Auto off (then Hermes asks before risky commands).")}
        if not dangerous or _approved(text, pattern_key):
            continue
        what = "command" if name == "terminal" else "script"
        return {"action": "block", "message": (
            f"BLOCKED by Auto access: this {what} is on Hermes's dangerous-command list ({description}). "
            "Auto access runs everything else without asking but never runs these. Do not try to get around it with "
            "another command or tool. Tell the user exactly what you want to run and why; they can allow it by "
            "switching the chat to Full access (the Auto button at the top) or by turning Auto off, so Hermes asks "
            "for approval.")}
    return None
