"""Hermes Mobile companion plugin (runs inside Hermes on the phone).

Sends Hermes's activity to the Hermes Mobile app, which posts every notification with its own
icon and keeps a pinned status line ("Running `ls /sdcard`", "Thinking…", "Ready"):

  status    what Hermes is doing now (throttled; "Ready" when every turn has finished)
  reply     a turn finished (preview; tap opens that chat)
  approval  a command needs approval          ask   Hermes asks a question (clarify tool)
  learning  a skill or memory was changed (incl. the background self-improvement review)
  cron      a scheduled job finished          error a turn failed

Transport: HTTP POST to the app's loopback listener (127.0.0.1:9121) with the shared key the app
writes to Termux's ~/.hermes-mobile/key. If the app isn't running, urgent events (approval, ask)
fall back to a plain Termux:API notification so they are never missed.
"""

import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

APP_URL = "http://127.0.0.1:9121/event"
KEY_FILE = Path("/data/data/com.termux/files/home/.hermes-mobile/key")
APP_COMPONENT = "com.omarqaterge.hermesmobile/.MainActivity"
NOTIFY_BIN = shutil.which("termux-notification") or "/data/data/com.termux/files/usr/bin/termux-notification"
STATUS_MIN_INTERVAL = 1.0  # seconds between status updates sent to the app
HEARTBEAT = 15  # seconds; the app expires a "working" status after ~3 missed beats
STALE_AFTER = 180  # a session with no activity for this long is considered finished
TOOL_STALE_AFTER = 1800  # ... unless it is inside a tool call (a long command fires no hooks until it ends)
FAIL_GRACE = 6.0  # seconds after a final API error before "failed" is notified (Hermes may still fall back to another provider)

_lock = threading.Lock()
_last_text: dict = {}  # session_id -> latest final_text
_subagents: set = set()
_active: dict = {}  # session_id -> {"text", "ts", "profile"}
_last_end: dict = {}  # session_id -> when its last real turn ended (session_end)
_review_turns: set = set()  # turn ids of Hermes's background self-review (memory / skills), not user turns
ACTIVITY_FILE = os.path.join(os.path.expanduser("~"), ".hermes", "mobile", "activity.json")
REVIEW_STALE = 60  # background work that stops reporting for this long is over (it fires no session_end)
_btw_turns: set = set()  # turn ids of /btw side questions (a fork on the same session, like the review)
_status_dirty = threading.Event()
_key_cache = {"mtime": 0.0, "key": ""}


def _profile() -> str:
    home = os.environ.get("HERMES_HOME", "")
    return Path(home).name if "/profiles/" in home else "default"


def _chat_title(session_id: str) -> str:
    """The chat's title from this profile's state.db (read-only), '' when unknown."""
    if not session_id:
        return ""
    try:
        import sqlite3

        home = os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")
        db = sqlite3.connect(f"file:{os.path.join(home, 'state.db')}?mode=ro", uri=True, timeout=1.5)
        try:
            row = db.execute("SELECT title FROM sessions WHERE id = ?", (session_id,)).fetchone()
        finally:
            db.close()
        # A branched chat is titled "⎇ name"; notifications show the plain name.
        return _short(((row[0] if row else "") or "").lstrip("⎇ ").strip(), 60)
    except Exception:
        return ""


def _key() -> str:
    try:
        st = KEY_FILE.stat()
        if st.st_mtime != _key_cache["mtime"]:
            _key_cache.update(mtime=st.st_mtime, key=KEY_FILE.read_text().strip())
    except OSError:
        return ""
    return _key_cache["key"]


def _dbg(msg: str) -> None:
    """Status-chip trace, for diagnosing a chip stuck on "Thinking": ~/.hermes/logs/mobile-status.log."""
    try:
        path = os.path.join(os.path.expanduser("~"), ".hermes", "logs", "mobile-status.log")
        if os.path.exists(path) and os.path.getsize(path) > 200_000:
            os.replace(path, path + ".1")
        with open(path, "a") as f:
            f.write(f"{time.strftime('%H:%M:%S')} pid={os.getpid()} {msg}\n")
    except Exception:
        pass


def _post(event: dict) -> bool:
    key = _key()
    if not key:
        return False
    req = urllib.request.Request(APP_URL, data=json.dumps(event).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Hermes-Mobile-Key": key})
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.status < 300
    except Exception:
        return False


def _termux_fallback(event: dict) -> None:
    session = event.get("session") or ""
    action = f"am start -n {APP_COMPONENT}" + (f" --es session {session}" if session else "")
    try:
        subprocess.Popen([NOTIFY_BIN, "--id", f"hm-{event.get('kind')}-{session}", "--title", event.get("title", "Hermes"),
                          "--content", event.get("body", ""), "--action", action, "--priority", "high"],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    except Exception:
        pass


def _send(kind: str, title: str = "Hermes", body: str = "", session: str = "", urgent: bool = False, **extra) -> None:
    """Fire-and-forget: never block a turn on notification delivery."""
    event = {"kind": kind, "title": title, "body": " ".join((body or "").split())[:500], "session": session or "",
             "profile": _profile(), **extra}

    def run():
        if not _post(event) and urgent:
            _termux_fallback(event)

    threading.Thread(target=run, daemon=True).start()


# ── pinned status line ──────────────────────────────────────

def _publish_activity() -> None:
    """Write what this process is doing to a shared file so the app's banner (GET /activity) can show it.
    One entry per Hermes process (pid); readers drop entries that stopped updating."""
    try:
        with _lock:
            mine = [{"session": sid, "text": v["text"], "short": v.get("short", ""), "profile": v["profile"],
                     "review": bool(v.get("review")), "ts": v["ts"]} for sid, v in _active.items()]
        try:
            with open(ACTIVITY_FILE) as f:
                data = json.load(f)
        except Exception:
            data = {}
        now = time.time()
        data = {k: v for k, v in data.items() if v.get("items") and now - v.get("at", 0) < 300}
        if mine:
            data[str(os.getpid())] = {"at": now, "items": mine}
        else:
            data.pop(str(os.getpid()), None)
        os.makedirs(os.path.dirname(ACTIVITY_FILE), exist_ok=True)
        tmp = ACTIVITY_FILE + f".{os.getpid()}"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, ACTIVITY_FILE)
    except Exception:
        pass


def _set_status(session_id: str, text: str, short: str = "Working", review: bool = False, tool: bool = False,
                step: bool = False) -> None:
    if not session_id or session_id in _subagents:
        return
    if not review and short not in ("Approve?", "Asking"):
        short = _phone_app_short(session_id) or short  # an app open in the background: the chip says "Using <app>"
    now = time.time()
    with _lock:
        prev = _active.get(session_id)
        # Per-turn progress (start time, steps taken, task list) survives each status change of the same turn;
        # a turn starts when the session isn't active (session_end / stale expiry dropped it) or a review takes over.
        turn = prev["turn"] if prev and bool(prev.get("review")) == review else {"since": now, "steps": 0, "todo": None}
        if step:
            turn["steps"] += 1
        _active[session_id] = {"text": text, "short": short, "ts": now, "profile": _profile(), "review": review,
                               "tool": tool, "turn": turn}
    _status_dirty.set()
    _publish_activity()


def _phone_app_short(session_id: str) -> str:
    """ "Using <app>" while this chat has an app open on the hidden screen (only if the tool was loaded)."""
    import sys
    m = sys.modules.get("hm_phone_app")
    st = getattr(m, "_state", None) if m else None
    if st and st.get("session") == session_id and st.get("label"):
        return f"Using {st['label']}"
    return ""


def _clear_status(session_id: str) -> None:
    _dbg(f"clear {session_id}")
    with _lock:
        _active.pop(session_id, None)
    _status_dirty.set()
    _publish_activity()


def _stale_after(v: dict) -> float:
    return REVIEW_STALE if v.get("review") else TOOL_STALE_AFTER if v.get("tool") else STALE_AFTER


def _todo_summary(result) -> dict | None:
    """The todo tool's list after the call, for the chip's progress bar: tasks done / total, the one in progress
    and one letter per task (d done, a active, p pending, x cancelled). Subtasks are left out when there are
    top-level tasks. None when the result isn't a task list."""
    try:
        data = json.loads(result) if isinstance(result, str) else result
        items = data.get("todos") if isinstance(data, dict) else None
    except Exception:
        return None
    if not isinstance(items, list):
        return None
    items = [t for t in items if isinstance(t, dict)]
    top = [t for t in items if not t.get("parent")]
    items = top or items
    if not items:
        return {"done": 0, "total": 0, "current": "", "states": ""}
    code = {"completed": "d", "in_progress": "a", "cancelled": "x"}
    states = "".join(code.get(str(t.get("status", "")).lower(), "p") for t in items)
    cur = next((t for t in items if t.get("status") == "in_progress"), None) or \
        next((t for t in items if t.get("status") == "pending"), None)
    return {"done": states.count("d"), "total": len(states) - states.count("x"),
            "current": _short((cur or {}).get("content", ""), 80), "states": states[:40]}


_titles: dict = {}  # session_id -> (title, looked up at)


def _title_for(session_id: str) -> str:
    """The chat title for the status chip, cached; an untitled (new) chat is looked up again every 20 s,
    because Hermes names it after its first reply."""
    hit = _titles.get(session_id)
    if hit and (hit[0] or time.time() - hit[1] < 20):
        return hit[0]
    title = _chat_title(session_id)
    _titles[session_id] = (title, time.time())
    if len(_titles) > 100:
        _titles.pop(next(iter(_titles)))
    return title


def _status_loop() -> None:
    last_sent = 0.0
    while True:
        # Battery: beat only while something is active; an idle process sleeps until a hook marks a change.
        with _lock:
            idle = not _active
        changed = _status_dirty.wait(timeout=None if idle else HEARTBEAT)
        _status_dirty.clear()
        now = time.time()
        with _lock:
            stale = [s for s, v in _active.items() if now - v["ts"] > _stale_after(v)]
            for sid in stale:
                _active.pop(sid, None)
                _dbg(f"stale-expired {sid}")
        if stale:
            _publish_activity()
        # Only report changes: several Hermes processes load this plugin, and an idle one
        # must never overwrite another process's "working" status with a periodic "Ready".
        with _lock:
            beat = bool(_active)
        if beat:
            _publish_activity()  # keeps this process's entry fresh for the app banner
        if not changed and not stale and not beat:
            continue  # heartbeat: while working, re-send so the app can tell we are alive
        wait = STATUS_MIN_INTERVAL - (time.time() - last_sent)
        if wait > 0:
            time.sleep(wait)
        with _lock:
            # Oldest turn first, so the chip doesn't hop between chats that run at the same time.
            items = sorted(_active.items(), key=lambda kv: (kv[1].get("turn") or {}).get("since", kv[1]["ts"]))
        if items:
            sid, cur = items[0]
            turn = cur.get("turn") or {}
            _post({"kind": "status", "working": True, "body": cur["text"], "short": cur.get("short", "Working"),
                   "session": sid, "profile": cur["profile"], "title": _title_for(sid), "review": bool(cur.get("review")),
                   "since": turn.get("since", 0), "steps": turn.get("steps", 0), "todo": turn.get("todo"),
                   "others": [{"session": s, "title": _title_for(s), "text": v["text"]} for s, v in items[1:4]],
                   "more": len(items) - 1})
        else:
            _post({"kind": "status", "working": False, "body": "Ready", "profile": _profile()})
        last_sent = time.time()


threading.Thread(target=_status_loop, daemon=True, name="hermes-mobile-status").start()


def _short(v, n=70) -> str:
    s = " ".join(str(v or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _peel_bridge(tool_name, args):
    """Hermes's Tool Search bridge: the model calls deferred tools through ``tool_call`` (and looks them up with
    ``tool_search`` / ``tool_describe``). The status shows the tool underneath, like Hermes's own hooks do."""
    if tool_name == "tool_call" and isinstance(args, dict) and isinstance(args.get("calls"), list):
        calls = [c for c in args["calls"] if isinstance(c, dict) and c.get("name")]
        if len(calls) == 1:
            inner = calls[0].get("arguments")
            return str(calls[0]["name"]), inner if isinstance(inner, dict) else {}
        if calls:
            return "tool_call", {"name": f"{len(calls)} tools"}
    return tool_name, args


def _tool_label(tool_name: str, args) -> str:
    tool_name, args = _peel_bridge(tool_name, args)
    a = args if isinstance(args, dict) else {}
    first = a.get("command") or a.get("path") or a.get("query") or a.get("text") or a.get("url") or a.get("name") or a.get("goal") or ""
    labels = {
        "terminal": "Running `{}`", "execute_code": "Running code", "read_file": "Reading {}",
        "write_file": "Writing {}", "patch": "Editing {}", "search_files": "Searching files: {}",
        "web_search": "Searching the web: {}", "web_extract": "Reading {}", "browser_navigate": "Browsing {}",
        "skill_view": "Loading skill {}", "skill_manage": "Updating skill {}", "memory": "Updating memory",
        "delegate_task": "Delegating: {}", "clarify": "Waiting for your answer", "todo": "Updating tasks",
        "todo_list": "Updating tasks", "vision_analyze": "Looking at an image", "image_generate": "Generating an image",
        "send_message": "Preparing a message", "tool_search": "Looking up tools", "tool_describe": "Looking up tools",
        "tool_call": "Using {}",
    }
    if tool_name == "phone_app":
        try:
            return _phone_app().action_label(a)
        except Exception:
            return "Using an app in the background"
    if tool_name == "canvas":
        verb = {"create": "Writing to the canvas", "write": "Updating the canvas", "patch": "Editing the canvas",
                "read": "Reading the canvas", "open_file": "Opening a file on the canvas"}.get(str(a.get("action", "")), "Using the canvas")
        title = a.get("title") or a.get("path") or ""
        return f"{verb}: {_short(title, 50)}" if title and a.get("action") in ("create", "open_file") else verb
    tmpl = labels.get(tool_name)
    if tmpl:
        return tmpl.format(_short(first, 60)) if "{}" in tmpl else tmpl
    return f"{tool_name}: {_short(first, 60)}" if first else f"Using {tool_name}"


_SHORT = {
    "terminal": "Shell", "execute_code": "Code", "read_file": "Files", "write_file": "Files", "patch": "Files",
    "search_files": "Files", "web_search": "Web", "web_extract": "Web", "browser_navigate": "Browser",
    "skill_view": "Skill", "skill_manage": "Skill", "memory": "Memory", "delegate_task": "Agents",
    "clarify": "Asking", "todo": "Tasks", "todo_list": "Tasks", "vision_analyze": "Vision", "image_generate": "Image",
    "send_message": "Message", "canvas": "Canvas", "tool_search": "Tools", "tool_describe": "Tools", "tool_call": "Tools",
}


def _tool_short(tool_name: str, args) -> str:
    tool_name, args = _peel_bridge(tool_name, args)
    a = args if isinstance(args, dict) else {}
    if tool_name == "phone_app":
        try:
            return _phone_app().chip_label(a)
        except Exception:
            return "Phone"
    if tool_name == "terminal" and "rish" in str(a.get("command", "")):
        return "Phone"  # Shizuku screen/app control
    if tool_name.startswith("browser"):
        return "Browser"
    return _SHORT.get(tool_name, (tool_name or "Tool")[:8].capitalize())


# ── hooks ───────────────────────────────────────────────────

REVIEW_PREFIX = "Review the conversation above"


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _write_origin() -> str:
    """Which agent fired this hook. Hermes binds a ContextVar at every turn start ("background_review" for the
    memory/skills review, "side_question" for /btw, else the normal origin) and runs plugin hooks in a copy of
    the turn's context, so this is exact, with no timing guesses."""
    try:
        from tools.skill_provenance import get_current_write_origin
        return get_current_write_origin() or ""
    except Exception:
        return ""


def _remember(turns: set, turn_id) -> None:
    turns.add(turn_id)
    if len(turns) > 100:
        turns.pop()


def _is_review(turn_id, session_id=None) -> bool:
    """True for Hermes's background work on a chat: the self-review after a reply and /btw side questions.
    Both are forks on the SAME session id that skip pre_llm_call and never send session_end. Known by the
    turn's write origin; on a Hermes without it, by the task id being a UUID (app turns use the session id)."""
    if not turn_id:
        return False
    if turn_id in _review_turns or turn_id in _btw_turns:
        return True
    if not session_id:
        return False
    origin = _write_origin()
    if origin == "side_question":
        _remember(_btw_turns, turn_id)
    elif origin == "background_review":
        _remember(_review_turns, turn_id)
    elif origin:
        return False
    else:
        parts = str(turn_id).split(":")
        if not (len(parts) == 3 and parts[1] != session_id and _UUID_RE.match(parts[1])):
            return False
        _remember(_review_turns, turn_id)
    _dbg(f"background-detected {session_id} {turn_id} origin={origin or '?'}")
    return True


def _bg_status(session_id, turn_id, tool_label: str = "") -> None:
    """Show background work (review or /btw) for a chat, unless a real turn of that chat is running: a /btw
    asked mid-turn must not replace or later clear the main turn's status."""
    with _lock:
        cur = _active.get(session_id)
    if cur and not cur.get("review"):
        return
    if turn_id in _btw_turns:
        text, short = "Answering a side question (/btw)", "Side question"
    else:
        text, short = "Learning from this chat (memory & skills)", "Learning"
    if tool_label:
        text = f"{short} · {tool_label}"
    _set_status(session_id, text, short, review=True)


def _bg_clear(session_id) -> None:
    with _lock:
        cur = _active.get(session_id)
    if cur and cur.get("review"):
        _clear_status(session_id)


def _on_pre_llm_call(session_id=None, turn_id=None, user_message=None, **_):
    # Hermes runs a background self-review (memory / skills) after a turn, on the same session id.
    # It fires our hooks but never a session_end, so label it and let it expire on its own.
    if turn_id and isinstance(user_message, str) and user_message.lstrip().startswith(REVIEW_PREFIX):
        _remember(_review_turns, turn_id)
        _dbg(f"review-start {session_id} {turn_id}")
        _bg_status(session_id, turn_id)
    return None


def _on_post_llm_call(session_id=None, turn_id=None, **_):
    if _is_review(turn_id):
        _dbg(f"review-end {session_id} {turn_id}")
        _bg_clear(session_id)
    return None


def _on_stream_start(session_id=None, turn_id=None, **_):
    rev = _is_review(turn_id, session_id)
    _dbg(f"stream_start {session_id} turn={turn_id} review={rev}")
    if rev:
        _bg_status(session_id, turn_id)
        return
    _set_status(session_id, "Thinking…", "Thinking")


def _on_stream_end(final_text=None, session_id=None, turn_id=None, finished=None, **_):
    if _is_review(turn_id, session_id):
        _dbg(f"review stream_end finished={finished} text={bool(final_text)}")
        if finished and final_text:  # its last model call: it is over (it sends no session_end)
            _bg_clear(session_id)
        return
    if session_id and final_text:
        with _lock:
            _last_text[session_id] = final_text
            if len(_last_text) > 200:
                _last_text.pop(next(iter(_last_text)))


def _on_pre_tool_call(tool_name=None, args=None, session_id=None, turn_id=None, task_id=None, tool_call_id=None, **_):
    try:
        verdict = _auto_mode().check(tool_name, args, session_id)  # Auto access: Hermes's dangerous list never runs
    except Exception as e:
        verdict = None
        _dbg(f"auto mode check: {type(e).__name__}: {e}")
    if verdict is not None:
        _dbg(f"auto mode blocked {tool_name} in {session_id}")
        return verdict
    tool_name, args = _peel_bridge(tool_name, args)
    if tool_name in ("write_file", "patch"):
        try:
            _checkpoints().pre_tool(tool_name, args, session_id, task_id, tool_call_id)
        except Exception as e:
            _dbg(f"checkpoint pre: {type(e).__name__}: {e}")
    if _is_review(turn_id, session_id):
        _bg_status(session_id, turn_id, _tool_label(tool_name or "tool", args).removeprefix("Using "))
        return None
    _set_status(session_id, _tool_label(tool_name or "tool", args), _tool_short(tool_name or "tool", args),
                tool=tool_name != "clarify", step=True)  # a question waits on the user: no reason to keep the phone awake
    if tool_name == "clarify":
        q, choices, single = "", [], True
        if isinstance(args, dict):
            q = args.get("question") or ""
            if isinstance(args.get("choices"), list):
                choices = [str(c)[:80] for c in args["choices"][:5]]
            if not q and isinstance(args.get("questions"), list) and args["questions"]:
                # Models often send even one question as a one-item batch; only a real batch
                # can't be answered from one notification field.
                single = len(args["questions"]) == 1
                first = args["questions"][0]
                q = first.get("question", "") if isinstance(first, dict) else str(first)
                if single and isinstance(first, dict) and isinstance(first.get("choices"), list):
                    choices = [str(c)[:80] for c in first["choices"][:5]]
        # The app's notification answers a single question in place (choices become quick replies).
        _send("ask", "Hermes asks", q or "Hermes has a question", session_id or "", urgent=True,
              choices=choices, single=single)
    return None  # observe only


def _on_post_tool_call(tool_name=None, args=None, result=None, status=None, session_id=None, turn_id=None,
                       tool_call_id=None, **_):
    tool_name, args = _peel_bridge(tool_name, args)
    if tool_name in ("write_file", "patch"):
        try:
            _checkpoints().post_tool(tool_name, args, session_id, turn_id, tool_call_id)
        except Exception as e:
            _dbg(f"checkpoint post: {type(e).__name__}: {e}")
    if session_id in _active:
        if tool_name in ("todo", "todo_list") and not _is_review(turn_id, session_id):  # todo_list = its registered name
            todo = _todo_summary(result)
            _dbg(f"todo {session_id} {(todo or {}).get('states')}")
            with _lock:
                if session_id in _active and todo is not None:
                    _active[session_id]["turn"]["todo"] = todo
        if _is_review(turn_id, session_id):
            _bg_status(session_id, turn_id)
        else:
            _set_status(session_id, "Thinking…", "Thinking")
    if tool_name == "clarify":
        _send("clear", session=session_id or "", what="ask")  # answered anywhere (app sheet, island, notification)
    if tool_name == "memory" and status in (None, "success", "ok"):
        a = args if isinstance(args, dict) else {}
        action = a.get("action", "update")
        if action in ("add", "replace", "remove"):
            target = "about you" if a.get("target") == "user" else "memory"
            verb = {"add": "Saved to", "replace": "Updated", "remove": "Removed from"}[action]
            _send("learning", f"Memory · {verb} {target}", _short(a.get("content") or a.get("old_text") or "", 200),
                  session_id or "", id=f"mem-{time.time():.0f}")


_SKILL_MUTATION = ("creat", "patch", "edit", "updat", "archiv", "delet", "restor", "install", "renam", "improv")


def _on_skill_lifecycle(action=None, skill_name=None, session_id=None, **_):
    act = str(action or "").lower()
    if not skill_name or not any(k in act for k in _SKILL_MUTATION):
        return
    _send("learning", f"Skill {act.replace('_', ' ')}", skill_name, session_id or "", id=f"skill-{skill_name}")


def _on_subagent_start(child_session_id=None, parent_session_id=None, child_goal=None, **_):
    if child_session_id:
        with _lock:
            _subagents.add(child_session_id)
    if parent_session_id:
        _set_status(parent_session_id, f"Sub-agent: {_short(child_goal, 60)}", "Agents")


def _tidy_approval_text(s):
    """Hermes joins approval warnings with "; " and its security scan can repeat one finding many times
    ("Security scan — [HIGH] X; [HIGH] X; …", seen ×20): each warning once, with a count, so the
    notification's text stays short enough to show its buttons. Same rule as tidyApprovalText in web/src/text.ts."""
    seen = {}
    for part in (s or "").split("; "):
        k = re.sub(r"^Security scan [—-] ", "", part).strip()
        if k in seen:
            seen[k][1] += 1
        else:
            seen[k] = [part, 1]
    return "; ".join(t if n == 1 else f"{t} (×{n})" for t, n in seen.values())


def _on_pre_approval_request(command=None, description=None, session_key=None, session_id=None, **kw):
    sid = session_id or session_key or ""
    description = _tidy_approval_text(description) if description else description
    _set_status(sid, "Waiting for your approval", "Approve?")
    body = description or command or "a command"
    if command and description:
        body = f"{description}\n{command}"
    # The app's notification answers through /approve, which needs these to find the request.
    try:
        from tools.approval_context import _get_approval_timeout
        timeout = int(_get_approval_timeout())
    except Exception:
        timeout = 60
    _send("approval", "Approval needed", body, sid, urgent=True, key=session_key or "", timeout=timeout,
          what=description or "", command=command or "",
          request_id=_approval_request_id(session_key, command, kw.get("request_id")),
          allow_session=kw.get("allow_session") is not False)


def _approval_request_id(session_key, command, given=None) -> str:
    """The id of the approval this hook is about. Hermes doesn't pass it to the hook, but the request is
    already queued when the hook fires: the newest one for this command (or, coalesced, the one it waits on).
    Without an id, /approve would answer the session's OLDEST waiting approval, which may not be the
    command the notification shows, so /approve refuses answers that have none."""
    if given:
        return str(given)
    try:
        from tools.approval import list_gateway_approvals
        pending = list_gateway_approvals(session_key or "")
    except Exception:
        return ""
    ids = [str(p.get("request_id") or "") for p in pending if p.get("command") == (command or "")]
    return ids[-1] if ids else ""


def _on_post_approval_response(session_key=None, session_id=None, **_):
    # Answered anywhere (app sheet, notification, timeout): drop the notification.
    _send("clear", session=session_id or session_key or "", what="approval")


def _on_api_request_error(session_id=None, turn_id=None, status_code=None, retryable=None, retry_count=None,
                          max_retries=None, reason=None, error=None, **_):
    # A turn whose model call fails for good (bad key, quota, unknown model…) ends with this hook and NO
    # session_end / post_llm_call, so the chip, the activity banner and the app's wake lock used to stay on
    # "Thinking" until STALE_AFTER. Retryable errors are retried by Hermes (a new stream_start follows).
    final = retryable is False or (retry_count is not None and max_retries is not None and retry_count >= max_retries)
    _dbg(f"api_error {session_id} turn={turn_id} status={status_code} retryable={retryable} final={final}")
    if not final or not session_id or session_id in _subagents:
        return
    if _is_review(turn_id, session_id):  # background work failed: drop its label, never the chat's own turn
        _bg_clear(session_id)
        return
    _clear_status(session_id)
    msg = str((error.get("message") if isinstance(error, dict) else error) or reason or "")
    inner = re.search(r"""['"]message['"]\s*:\s*['"]([^'"]+)""", msg)  # "Error code: 401 - {'error': {'message': '…'}}"
    msg = inner.group(1) if inner else msg
    head = f"HTTP {status_code}" if status_code else ""
    body = _short(" · ".join(x for x in (head, msg) if x) or "The model call failed", 200)
    failed_at = time.time()

    def notify():
        with _lock:
            again = session_id in _active  # a fallback provider / new attempt took over
        if again or _last_end.get(session_id, 0) >= failed_at:  # or a session_end already reported it
            return
        name = _profile()
        title = _chat_title(session_id) or ("Hermes" if name == "default" else name)
        _send("error", f"{title} · failed", body, session_id)

    t = threading.Timer(FAIL_GRACE, notify)
    t.daemon = True
    t.start()


def _on_session_end(session_id=None, turn_id=None, completed=None, failed=None, interrupted=None,
                    turn_exit_reason=None, platform=None, **_):
    _dbg(f"session_end {session_id} turn={turn_id} completed={completed} interrupted={interrupted}")
    if not session_id or session_id in _subagents:
        return
    _last_end[session_id] = time.time()
    with _lock:
        turn = (_active.get(session_id) or {}).get("turn") or {}
    _clear_status(session_id)  # always, even without a turn id, or the chip sticks on "Thinking"
    if turn_id is None:
        return
    try:
        _checkpoints().maybe_maintain_async()  # daily gc of the checkpoint store, in a thread
    except Exception:
        pass
    with _lock:
        text = _last_text.pop(session_id, "")
    try:
        text = _openui().strip_ui(text)  # notifications and read-aloud say [card], not openui-lang code
    except Exception:
        pass
    if interrupted:
        return
    name = _profile()
    title = _chat_title(session_id) or ("Hermes" if name == "default" else name)
    if platform == "cron":
        _send("cron", "Scheduled job finished" if not failed else "Scheduled job failed",
              text or str(turn_exit_reason or ""), session_id, id=session_id)
    elif failed:
        _send("error", f"{title} · failed", str(turn_exit_reason or "The turn failed"), session_id)
    elif completed or text:
        # speak_text: the full reply for read-aloud mode in the app's service (notification bodies are trimmed)
        _send("reply", title, text or "Done", session_id, platform=platform or "", speak_text=(text or "")[:20000])
        _send("flash", title, "Done · " + _short(text or "", 120), session_id, short="✅ Done", color="#2E9E5B", done=True,
              reply=_short(text or "", 300), steps=turn.get("steps", 0),
              secs=round(time.time() - turn["since"]) if turn.get("since") else 0)


def _load(name: str, filename: str):
    """A module of this plugin, loaded by path (this plugin's folder isn't an importable package)."""
    import importlib.util
    import sys
    mod = sys.modules.get(name)
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, os.path.join(os.path.dirname(os.path.abspath(__file__)), filename))
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return mod


def _canvas():
    """The canvas storage/tool module."""
    return _load("hm_canvas", "canvas.py")


def _openui():
    """Cards in replies: prompt section, openui_reference tool, setting."""
    return _load("hm_openui", "openui.py")


def _chat_search():
    """The find_chats tool module."""
    return _load("hm_chat_search", "chat_search.py")


def _phone_app():
    """The phone_app tool (an app on a hidden screen, driven through the app's background host)."""
    return _load("hm_phone_app", "phone_app.py")


def _auto_mode():
    """Auto access (the app's Auto button): which chats block Hermes's dangerous-command list under /yolo."""
    return _load("hm_auto_mode", "auto_mode.py")


def _checkpoints():
    """Per-chat file checkpoints (ledger, git speed-up, daily store gc)."""
    return _load("hm_checkpoints", "checkpoints.py")


_CANVAS_PROMPT = (
    "The user talks to you in a phone app that has a CANVAS: a panel next to the chat where they read, edit and keep "
    "documents. When the user asks you to build, make or write something (an essay, notes, a plan, a report, a code "
    "file, an HTML/SVG page or small web app) or wants to look at a file, put it on the canvas with the `canvas` tool "
    "(create / write / patch / open_file) instead of pasting it into the chat, and keep the chat reply to a sentence "
    "or two. If the tool isn't loaded yet, load its description with tool_describe first. The user can edit the "
    "canvas: read it before you change it, and prefer small patch edits. HTML on the canvas runs offline in a sandbox: "
    "keep it one self-contained file with everything inline (no CDN or network), and make it fit a narrow phone screen."
)


_LINKS_PROMPT = (
    "The phone app turns a link of the form [title](hermes-chat:SESSION_ID) into a tap that opens that chat. When you "
    "mention one of the user's other chats (found with session_search or the session list), link it that way using its "
    "session id (like 20260929_194711_8c8b2a) and a short title. To find the user's chats by words, or chats with "
    "images, screenshots, files, audio or video in them, call the find_chats tool once (load it with tool_describe "
    "if needed) instead of searching state.db, logs or folders yourself."
)


RISH_BIN = Path("/data/data/com.termux/files/home/bin/rish")  # Shizuku's shell wrapper, if the user set it up

_PHONE_PROMPT = (
    "You run ON the user's phone (Termux, inside a Debian container), so questions about the phone itself (battery, "
    "temperature, storage, apps, logs, screen) are about your own host: answer them from here, don't send the user "
    "to a computer. The container is an ordinary app: `dumpsys`, `logcat` and `pm` are denied there and there is no "
    "`adb` device. Use the `termux-*` commands (Termux:API) and /sdcard first. If a skill about phone or Android access "
    "is in your skill list, load it before you try anything else."
)

_PHONE_RISH = (
    " For system-level access (dumpsys, logcat, screencap, uiautomator, input, am, pm) run the command through "
    f"`{RISH_BIN} -c \"<command>\"`; it runs as the shell user via Shizuku. If it says the server isn't running, say "
    "so and ask the user to start Shizuku, rather than guessing another route. To DO something in an app (add a note, "
    "look something up, fill a form), use the phone_app tool: it works on a hidden screen so the user keeps their own; "
    "only start apps on the real screen (`am start`) when the user wants to see them."
)


def _phone_prompt(info) -> str:
    """Always in the prompt of app chats, so a small model doesn't need to find a skill to know the phone is reachable."""
    try:
        if str(info.get("platform", "")) not in ("mobile", "tui"):
            return ""
        return _PHONE_PROMPT + (_PHONE_RISH if RISH_BIN.exists() else "")
    except Exception:
        return ""


def _links_prompt(info) -> str:
    try:
        return _LINKS_PROMPT if str(info.get("platform", "")) in ("mobile", "tui") else ""
    except Exception:
        return ""


def _canvas_prompt(info) -> str:
    """Only chats made in the phone app have a canvas (the app's chats log as `mobile`, or `tui` once resumed)."""
    try:
        return _CANVAS_PROMPT if str(info.get("platform", "")) in ("mobile", "tui") else ""
    except Exception:
        return ""


def register(ctx):
    try:
        _checkpoints().install_git_env_shim()
    except Exception as e:
        _dbg(f"checkpoint git shim not installed: {type(e).__name__}: {e}")
    try:
        c = _canvas()
        ctx.register_tool(name="canvas", toolset="canvas", schema=c.TOOL_SCHEMA, handler=c.tool_handler,
                          description="Show documents, code and pages on the user's canvas in the phone app", emoji="🗒")
    except Exception as e:  # the rest of the plugin must load even if the canvas can't
        _dbg(f"canvas tool not registered: {type(e).__name__}: {e}")
    try:
        m = _chat_search()
        ctx.register_tool(name="find_chats", toolset="canvas", schema=m.TOOL_SCHEMA, handler=m.tool_handler,
                          description="Find the user's chats by text, or by the images, files, audio or video in them", emoji="🔎")
    except Exception as e:
        _dbg(f"find_chats not registered: {type(e).__name__}: {e}")
    try:
        pa = _phone_app()
        pa.notify, pa.log = _send, _dbg
        if pa.availability()[0]:
            ctx.register_tool(name="phone_app", toolset="canvas", schema=pa.TOOL_SCHEMA, handler=pa.tool_handler,
                              description="Use a phone app on a hidden screen without taking the user's screen", emoji="📱")
    except Exception as e:
        _dbg(f"phone_app not registered: {type(e).__name__}: {e}")
    try:
        ou = _openui()
        ctx.register_tool(name="openui_reference", toolset="canvas", schema=ou.TOOL_SCHEMA, handler=ou.tool_handler,
                          description="The openui-lang reference for cards, tables, charts and forms in a reply", emoji="🧩")
        ctx.register_system_prompt_section("hermes-mobile.openui", ou.prompt_section, position="after_memory", max_chars=900)
    except Exception as e:
        _dbg(f"openui not registered: {type(e).__name__}: {e}")
    try:
        ctx.register_system_prompt_section("hermes-mobile.canvas", _canvas_prompt, position="after_memory", max_chars=900)
    except Exception as e:
        _dbg(f"canvas prompt section not registered: {type(e).__name__}: {e}")
    try:
        ctx.register_system_prompt_section("hermes-mobile.links", _links_prompt, position="after_memory", max_chars=700)
    except Exception as e:
        _dbg(f"links prompt section not registered: {type(e).__name__}: {e}")
    try:
        ctx.register_system_prompt_section("hermes-mobile.phone", _phone_prompt, position="after_memory", max_chars=1200)
    except Exception as e:
        _dbg(f"phone prompt section not registered: {type(e).__name__}: {e}")
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("on_stream_start", _on_stream_start)
    ctx.register_hook("on_stream_end", _on_stream_end)
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("on_skill_lifecycle", _on_skill_lifecycle)
    ctx.register_hook("subagent_start", _on_subagent_start)
    ctx.register_hook("pre_approval_request", _on_pre_approval_request)
    ctx.register_hook("post_approval_response", _on_post_approval_response)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("api_request_error", _on_api_request_error)
