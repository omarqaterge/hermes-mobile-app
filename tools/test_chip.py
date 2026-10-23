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
plugin._send = lambda kind, title="Hermes", body="", session="", urgent=False, **kw: sent.append(dict(kind=kind, title=title, body=body, **kw))
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
check("turn start time sent", isinstance(since, float) and abs(since - time.time()) < 5, since)
plugin._on_pre_tool_call(tool_name="terminal", args={"command": "make"}, session_id="s-a", turn_id="s-a:1")
plugin._on_post_tool_call(tool_name="terminal", session_id="s-a", turn_id="s-a:1")
plugin._on_pre_tool_call(tool_name="todo_list", args={}, session_id="s-a", turn_id="s-a:1")  # its registered name
plugin._on_post_tool_call(tool_name="todo_list", result=res, session_id="s-a", turn_id="s-a:1")
e = last_status()
check("each tool call is a step, kept across 'Thinking…'", e.get("steps") == 2 and e.get("body") == "Thinking…", e)
check("task list kept on the turn", (e.get("todo") or {}).get("states") == "dapx", e.get("todo"))
check("same turn start", e.get("since") == since, (e.get("since"), since))

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
check("the other chat is listed with its title and step", e.get("others") == [
    {"session": "s-b", "title": "Plan the trip", "text": "Searching the web: trains"}] and e.get("more") == 1, e.get("others"))
check("body has no '(+1 more)' any more", "more)" not in e.get("body", ""), e.get("body"))

print("the turn ends")
plugin._last_text["s-a"] = "All fixed: the build passes."
plugin._on_session_end(session_id="s-a", turn_id="s-a:1", completed=True)
flash = [x for x in sent if x["kind"] == "flash"][-1]
check("Done carries steps, duration and the reply", flash.get("steps") == 2 and flash.get("secs", -1) >= 0
      and flash.get("reply") == "All fixed: the build passes." and flash.get("done"), flash)
e = last_status()
check("then the chip follows the other chat", e.get("session") == "s-b" and e.get("more") == 0, e)
plugin._on_session_end(session_id="s-b", turn_id=None, interrupted=True)
plugin._on_stream_start(session_id="s-a", turn_id="s-a:2")
e = last_status()
check("a new turn starts from zero", e.get("steps") == 0 and e.get("todo") is None and e.get("since") != since, e)
plugin._on_session_end(session_id="s-a", turn_id=None, interrupted=True)
check("all over → Ready", last_status().get("working") is False)

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


class Page:
    def read(self):
        return b'<script>window.__HERMES_SESSION_TOKEN__ = "tok";</script>'


import urllib.request  # noqa: E402

urllib.request.urlopen = lambda *a, **k: Page()
out = asyncio.run(papi.stop(papi.Stop(session="s-a")))
check("interrupts the runtime holding the chat", out == {"interrupted": "rt-2"}
      and ("session.interrupt", {"session_id": "rt-2"}) in calls and ("session.interrupt", {"session_id": "rt-1"}) not in calls, calls)
try:
    asyncio.run(papi.stop(papi.Stop(session="s-gone")))
    check("a chat not running → 404", False)
except fastapi.HTTPException as ex:
    check("a chat not running → 404", ex.status_code == 404, ex.status_code)

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
