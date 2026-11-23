#!/usr/bin/env python3
"""Status chip checks (no phone needed): what the plugin tells the app about a running turn (chat title, steps,
task list, other busy chats, how the turn ended) and the /stop endpoint behind the chip's Stop button.
    python3 tools/test_chip.py
"""
import asyncio
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tmp = Path(tempfile.mkdtemp())
os.environ["HOME"] = str(tmp)
os.environ["HERMES_HOME"] = str(tmp)
db = sqlite3.connect(tmp / "state.db")
db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)")
db.executemany("INSERT INTO sessions VALUES (?, ?)", [("s-a", "Fix the build"), ("s-b", "⎇ Plan the trip")])
db.commit()
db.close()

plugin = load("hermes_mobile_plugin_chip", ROOT / "hermes-plugin" / "hermes-mobile" / "__init__.py")
posts, sent = [], []
plugin._post = lambda e: posts.append(e) or True
plugin._send = lambda kind, title="Hermux", body="", session="", urgent=False, **kw: sent.append(dict(kind=kind, title=title, body=body, **kw))
plugin.STATUS_MIN_INTERVAL = 0.0
plugin.HEARTBEAT = 0.2


def last_status(wait=0.4):
    time.sleep(wait)
    st = [e for e in posts if e.get("kind") == "status"]
    return st[-1] if st else {}


print("todo summary")
res = json.dumps({"todos": [
    {"id": "1", "content": "Read the code", "status": "completed"},
    {"id": "2", "content": "Write the fix", "status": "in_progress"},
    {"id": "2a", "content": "a subtask", "status": "pending", "parent": "2"},
    {"id": "3", "content": "Test it", "status": "pending"},
    {"id": "4", "content": "Old idea", "status": "cancelled"},
]})
s = plugin._todo_summary(res)
check("subtasks left out, one letter per task", s["states"] == "dapx", s)
check("done / total (cancelled not counted)", (s["done"], s["total"]) == (1, 3), s)
check("current = the task in progress", s["current"] == "Write the fix", s)
check("not a task list → None", plugin._todo_summary("oops") is None and plugin._todo_summary({"x": 1}) is None)
check("all pending → current is the first", plugin._todo_summary({"todos": [{"content": "A", "status": "pending"}]})["current"] == "A")

print("a turn's progress")
plugin._on_stream_start(session_id="s-a", turn_id="s-a:1")
e = last_status()
check("chat title rides on the status", e.get("title") == "Fix the build", e)
check("no steps yet", e.get("steps") == 0 and e.get("todo") is None, e)
since = e.get("since")
tid_a1 = e.get("turn_id")
check("turn start time, turn_id and proc sent", isinstance(since, float) and abs(since - time.time()) < 5
      and isinstance(tid_a1, str) and tid_a1.startswith(plugin._PROC_ID + ":") and e.get("proc") == plugin._PROC_ID, e)
plugin._on_pre_tool_call(tool_name="terminal", args={"command": "make"}, session_id="s-a", turn_id="s-a:1")
plugin._on_post_tool_call(tool_name="terminal", session_id="s-a", turn_id="s-a:1")
plugin._on_pre_tool_call(tool_name="todo_list", args={}, session_id="s-a", turn_id="s-a:1")  # its registered name
plugin._on_post_tool_call(tool_name="todo_list", result=res, session_id="s-a", turn_id="s-a:1")
e = last_status()
check("each tool call is a step, kept across 'Thinking…'", e.get("steps") == 2 and e.get("body") == "Thinking…", e)
check("task list kept on the turn", (e.get("todo") or {}).get("states") == "dapx", e.get("todo"))
check("same turn start and turn_id across steps", e.get("since") == since and e.get("turn_id") == tid_a1, (e.get("since"), e.get("turn_id"), tid_a1))

print("an app open in the background")
pa = plugin._phone_app()
pa._state.update({"session": "s-a", "pkg": "com.example.notes", "label": "Notes"})
plugin._on_post_tool_call(tool_name="phone_app", session_id="s-a", turn_id="s-a:1")
e = last_status()
check("the chip says 'Using <app>' while thinking", e.get("short") == "Using Notes" and e.get("body") == "Thinking…", e)
check("an action's line names the app and the action",
      plugin._tool_label("phone_app", {"action": "key", "key": "back"}) == "Notes: pressing back"
      and plugin._tool_short("phone_app", {"action": "key"}) == "Using Notes")
pa._state.clear()
plugin._on_post_tool_call(tool_name="phone_app", session_id="s-a", turn_id="s-a:1")
check("back to the normal chip once the app is closed", last_status().get("short") != "Using Notes")

ended = []
pa.end_session = lambda sid: ended.append(sid)
pa._state.update({"session": "s-x", "pkg": "com.example.notes", "label": "Notes"})
plugin._on_session_end(session_id="s-x", turn_id=None, interrupted=True)
for t in list(plugin._bgapp_enders):
    t.join(5)
check("a turn's end (even interrupted) ends its background app", ended == ["s-x"], ended)
del pa.end_session
pa._state.clear()

print("tools behind Hermes's Tool Search bridge")
bridged = {"calls": [{"name": "web_search", "arguments": {"query": "trains"}}]}
check("tool_call shows the tool underneath", plugin._tool_label("tool_call", bridged) == "Searching the web: trains"
      and plugin._tool_short("tool_call", bridged) == "Web", plugin._tool_label("tool_call", bridged))
check("a batch says how many", plugin._tool_label("tool_call", {"calls": [{"name": "a"}, {"name": "b"}]}) == "Using 2 tools")
check("tool lookups have a plain label", plugin._tool_label("tool_describe", {"names": ["x"]}) == "Looking up tools")
check("todo_list is 'Updating tasks'", plugin._tool_label("todo_list", {"todos": []}) == "Updating tasks")

print("two chats at once")
plugin._on_stream_start(session_id="s-b", turn_id="s-b:1")
plugin._on_pre_tool_call(tool_name="web_search", args={"query": "trains"}, session_id="s-b", turn_id="s-b:1")
e = last_status()
check("the chip stays on the chat that started first", e.get("session") == "s-a", e.get("session"))
others = e.get("others") or []
tid_b1 = others[0].get("turn_id") if others else ""
check("the other chat is listed with its title, step, since and distinct turn_id",
      len(others) == 1 and others[0].get("session") == "s-b" and others[0].get("title") == "Plan the trip"
      and others[0].get("text") == "Searching the web: trains"
      and isinstance(others[0].get("since"), float) and others[0]["since"] > 0
      and isinstance(tid_b1, str) and tid_b1.startswith(plugin._PROC_ID + ":") and tid_b1 != tid_a1
      and e.get("more") == 1, others)
check("body has no '(+1 more)' any more", "more)" not in e.get("body", ""), e.get("body"))

print("the turn ends")
plugin._last_text["s-a"] = "All fixed: the build passes."
plugin._on_session_end(session_id="s-a", turn_id="s-a:1", completed=True)
flash = [x for x in sent if x["kind"] == "flash"][-1]
check("Done carries steps, duration, reply, turn_id and proc", flash.get("steps") == 2 and flash.get("secs", -1) >= 0
      and flash.get("reply") == "All fixed: the build passes." and flash.get("done")
      and flash.get("turn_id") == tid_a1 and flash.get("proc") == plugin._PROC_ID, flash)
e = last_status()
check("then the chip follows the other chat with the same turn_id",
      e.get("session") == "s-b" and e.get("more") == 0 and e.get("turn_id") == tid_b1, e)
plugin._on_session_end(session_id="s-b", turn_id=None, interrupted=True)
plugin._on_stream_start(session_id="s-a", turn_id="s-a:2")
e = last_status()
tid_a2 = e.get("turn_id")
check("a new turn starts from zero with a fresh turn_id",
      e.get("steps") == 0 and e.get("todo") is None and e.get("since") != since
      and isinstance(tid_a2, str) and tid_a2 != tid_a1, e)
# Back-to-back turn on a chat in others (even without session_end, a different hook turn_id mints a fresh turn_id).
plugin._on_stream_start(session_id="s-b", turn_id="s-b:2")
e_o1 = last_status()
tid_b2 = (e_o1.get("others") or [{}])[0].get("turn_id", "")
plugin._on_stream_start(session_id="s-b", turn_id="s-b:3")
e_o2 = last_status()
tid_b3 = (e_o2.get("others") or [{}])[0].get("turn_id", "")
check("back-to-back turns in others get distinct turn_ids", tid_b2 and tid_b3 and tid_b2 != tid_b3, (tid_b2, tid_b3))
plugin._on_session_end(session_id="s-b", turn_id=None, interrupted=True)
plugin._on_session_end(session_id="s-a", turn_id=None, interrupted=True)
idle_e = last_status()
check("all over → Ready with proc", idle_e.get("working") is False and idle_e.get("proc") == plugin._PROC_ID, idle_e)

print("untitled chat is looked up again")
plugin._titles.clear()
check("new chat: empty title", plugin._title_for("s-new") == "")
db = sqlite3.connect(tmp / "state.db")
db.execute("INSERT INTO sessions VALUES ('s-new', 'Named later')")
db.commit()
db.close()
check("…cached for a while", plugin._title_for("s-new") == "")
plugin._titles["s-new"] = ("", time.time() - 30)
check("…then read again", plugin._title_for("s-new") == "Named later")

print("per-chat turn records stay bounded and keep running turns")
plugin._on_pre_llm_call(session_id="keep-1", turn_id="t-keep", user_message="hello")
plugin._set_status("keep-1", "Thinking…", "Thinking")
for i in range(300):
    plugin._on_pre_llm_call(session_id=f"flood-{i}", turn_id=f"t-{i}", user_message="hi")
check("a turn in progress keeps its start time while many other chats start", "keep-1" in plugin._turn_started,
      len(plugin._turn_started))
check("turn start records are bounded", len(plugin._turn_started) <= 300, len(plugin._turn_started))
for i in range(2000):
    plugin._on_subagent_start(child_session_id=f"child-{i}", parent_session_id=None)
    plugin._on_session_end(session_id=f"ended-{i}", turn_id=None)
check("sub-agent ids are bounded", len(plugin._subagents) <= 1024, len(plugin._subagents))
check("last-end records are bounded", len(plugin._last_end) <= 256, len(plugin._last_end))
check("the most recent sub-agent is still known", "child-1999" in plugin._subagents)
plugin._on_session_end(session_id="keep-1", turn_id=None)
check("ending a turn forgets its start", "keep-1" not in plugin._turn_started)

print("a background label never replaces a live turn, even when the turn starts between check and act")
plugin._clear_status("race-1")
real_lock = plugin._lock


class HookLock:
    """Runs a real turn's status change right after the first release of the lock (the gap the old check had)."""
    def __init__(self):
        self.armed = True

    def __enter__(self):
        real_lock.acquire()

    def __exit__(self, *a):
        real_lock.release()
        if self.armed:
            self.armed = False
            plugin._lock = real_lock
            plugin._set_status("race-1", "Using terminal", "Terminal", tool=True)


plugin._lock = HookLock()
plugin._bg_status("race-1", "t-x")
plugin._lock = real_lock
cur = plugin._active.get("race-1") or {}
check("a review label does not replace the live turn's status", not cur.get("review") and cur.get("short") == "Terminal", cur)
plugin._lock = HookLock()
plugin._bg_clear("race-1")
plugin._lock = real_lock
check("a review clear does not drop a live turn", "race-1" in plugin._active)
plugin._clear_status("race-1")


# ── /stop: finds the live runtime of the stored chat and interrupts it ──
print("/stop")
try:
    import fastapi  # noqa: F401
except ImportError:
    print("  (skipped: fastapi not installed)")
    print("FAILED" if fails else "all passed")
    sys.exit(1 if fails else 0)

papi = load("plugin_api_chip", ROOT / "hermes-plugin" / "hermes-mobile" / "dashboard" / "plugin_api.py")
calls = []
live = [{"id": "rt-1", "session_key": "s-other"}, {"id": "rt-2", "session_key": "s-a"}]


class FakeWS:
    def __init__(self):
        self.q = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def send(self, raw):
        m = json.loads(raw)
        calls.append((m["method"], m["params"]))
        if m["method"] == "session.active_list":
            res = {"sessions": live}
        else:
            res = {"status": "interrupted"} if m["params"]["session_id"] == "rt-2" else {"status": "not_interrupted"}
        self.q.append(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": res}))

    async def recv(self):
        return self.q.pop(0)


sys.modules["websockets"] = types.SimpleNamespace(connect=lambda *a, **k: FakeWS())


# The token comes from the dashboard's own process (hermes_cli.web_server._SESSION_TOKEN), never over loopback.
sys.modules.setdefault("hermes_cli", types.ModuleType("hermes_cli"))
sys.modules["hermes_cli.web_server"] = types.SimpleNamespace(_SESSION_TOKEN="tok")
dialled = []
sys.modules["websockets"] = types.SimpleNamespace(connect=lambda url, **k: dialled.append(url) or FakeWS())
here = types.SimpleNamespace(scope={"server": ("127.0.0.1", 9119)})
out = asyncio.run(papi.stop(papi.Stop(session="s-a"), here))
check("its WebSocket goes to the dashboard that got the request, with the in-process token",
      dialled and dialled[0] == "ws://127.0.0.1:9119/api/ws?token=tok", dialled)
check("interrupts the runtime holding the chat (no active turn record: backward compatible)", out == {"interrupted": "rt-2"}
      and ("session.interrupt", {"session_id": "rt-2"}) in calls and ("session.interrupt", {"session_id": "rt-1"}) not in calls, (out, calls))
# With an active turn in the plugin: /stop returns its turn_id and refuses a stale turn_id without interrupting.
plugin._on_stream_start(session_id="s-a", turn_id="s-a:stop1")
active_tid = plugin._active_turn_id("s-a")
calls.clear()
out_tid = asyncio.run(papi.stop(papi.Stop(session="s-a", turn_id=active_tid), here))
check("/stop returns the active turn_id when it matches", out_tid == {"interrupted": "rt-2", "turn_id": active_tid}
      and ("session.interrupt", {"session_id": "rt-2"}) in calls, (out_tid, calls))
calls.clear()
out_old_app = asyncio.run(papi.stop(papi.Stop(session="s-a"), here))
check("older app omitting turn_id still interrupts and receives turn_id", out_old_app == {"interrupted": "rt-2", "turn_id": active_tid}, out_old_app)
calls.clear()
try:
    asyncio.run(papi.stop(papi.Stop(session="s-a", turn_id="stale-turn-id"), here))
    check("mismatched turn_id → 409 without calling session.interrupt", False)
except fastapi.HTTPException as ex:
    check("mismatched turn_id → 409 without calling session.interrupt",
          ex.status_code == 409 and ("session.interrupt", {"session_id": "rt-2"}) not in calls, (ex.status_code, calls))
plugin._clear_status("s-a")
# Fail closed when caller sends a turn_id and the live turn id is unknown (between turns / before first stream event).
calls.clear()
try:
    asyncio.run(papi.stop(papi.Stop(session="s-a", turn_id=active_tid), here))
    check("unknown live turn_id with caller turn_id → 409 without interrupting", False)
except fastapi.HTTPException as ex:
    check("unknown live turn_id with caller turn_id → 409 without interrupting",
          ex.status_code == 409 and ("session.interrupt", {"session_id": "rt-2"}) not in calls, (ex.status_code, calls))
# activity.json is never trusted by /stop: a forged entry does not satisfy turn_id matching or interrupt the chat.
act_path = tmp / ".hermes" / "mobile" / "activity.json"
act_path.parent.mkdir(parents=True, exist_ok=True)
act_path.write_text(json.dumps({
    str(os.getpid()): {
        "at": time.time(),
        "items": [{"session": "s-a", "text": "Forged", "short": "Forged", "profile": "default",
                   "review": False, "ts": time.time(), "turn_id": "forged:1"}],
    }
}))
calls.clear()
check("_active_turn_id ignores activity.json", papi._active_turn_id(["s-a"]) == "", papi._active_turn_id(["s-a"]))
try:
    asyncio.run(papi.stop(papi.Stop(session="s-a", turn_id="forged:1"), here))
    check("forged activity.json turn_id → 409 without interrupting", False)
except fastapi.HTTPException as ex:
    check("forged activity.json turn_id → 409 without interrupting",
          ex.status_code == 409 and ("session.interrupt", {"session_id": "rt-2"}) not in calls, (ex.status_code, calls))
# A second load of __init__.py in the same process does not overwrite sys.modules["hm_plugin"] or clobber the first load.
reg_before = sys.modules.get("hm_plugin")
plugin._on_stream_start(session_id="s-a", turn_id="s-a:multi1")
tid_first = plugin._active_turn_id("s-a")
plugin2 = load("hermes_mobile_plugin_chip_second", ROOT / "hermes-plugin" / "hermes-mobile" / "__init__.py")
plugin2._post = lambda e: True
plugin2._send = lambda *a, **k: None
plugin2._on_stream_start(session_id="s-b", turn_id="s-b:multi2")
tid_second = plugin2._active_turn_id("s-b")
check("second plugin load keeps sys.modules['hm_plugin'] and both loads' active turns resolve",
      sys.modules.get("hm_plugin") is reg_before
      and papi._active_turn_id(["s-a"]) == tid_first
      and papi._active_turn_id(["s-b"]) == tid_second,
      (sys.modules.get("hm_plugin") is reg_before, papi._active_turn_id(["s-a"]), tid_first, papi._active_turn_id(["s-b"]), tid_second))
plugin._clear_status("s-a")
plugin2._clear_status("s-b")
try:
    asyncio.run(papi.stop(papi.Stop(session="s-gone"), here))
    check("a chat not running → 404", False)
except fastapi.HTTPException as ex:
    check("a chat not running → 404", ex.status_code == 404, ex.status_code)

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
