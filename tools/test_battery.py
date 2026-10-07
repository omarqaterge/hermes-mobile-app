#!/usr/bin/env python3
"""Battery checks (no phone needed): the cron ticker's next-wake calculation, the plugin's status loop
staying asleep while idle, the long-tool stale window and `bots.py off`.
    python3 tools/test_battery.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
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

# ── cron ticker: next wake ──
print("cron_ticker.next_wake")
ct = load("cron_ticker", ROOT / "phone" / "cron_ticker.py")
now = time.time()
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(t))  # noqa: E731
a, b = tmp / "default", tmp / "profiles" / "coder"
for h in (a, b):
    (h / "cron").mkdir(parents=True)
(a / "cron" / "jobs.json").write_text(json.dumps({"jobs": [
    {"id": "1", "next_run_at": iso(now + 3600)},
    {"id": "2", "next_run_at": iso(now + 600), "enabled": False},  # off
    {"id": "3", "next_run_at": iso(now - 60)},  # overdue: the ticker fires it on its own
    {"id": "4", "next_run_at": None},
]}))
(b / "cron" / "jobs.json").write_text(json.dumps({"jobs": [
    {"id": "5", "next_run_at": iso(now + 1800)},
    {"id": "6", "next_run_at": iso(now + 900), "state": "paused"},
    {"id": "7", "next_run_at": iso(now + 300), "state": "completed"},
]}))
got = ct.next_wake([a, b], now)
check("earliest runnable future job across profiles", abs(got - (now + 1800)) < 2, got - now)
check("no jobs → 0", ct.next_wake([tmp / "nothing"], now) == 0)
(a / "cron" / "jobs.json").write_text("{broken")
check("broken store is skipped", abs(ct.next_wake([a, b], now) - (now + 1800)) < 2)
naive = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now + 120))
(a / "cron" / "jobs.json").write_text(json.dumps({"jobs": [{"id": "8", "next_run_at": naive}]}))
check("naive time = phone-local", abs(ct.next_wake([a], now) - (now + 120)) < 2)

# ── plugin: idle status loop sleeps, active one beats ──
print("plugin status loop")
os.environ["HOME"] = str(tmp)
plugin = load("hermes_mobile_plugin", ROOT / "hermes-plugin" / "hermes-mobile" / "__init__.py")
posts = []
plugin._post = lambda e: posts.append((time.time(), e)) or True
plugin.HEARTBEAT = 0.3
plugin.STATUS_MIN_INTERVAL = 0.0
waits = []
_ev = plugin._status_dirty


class Rec:  # records each wait's timeout: an idle loop must block without one (no periodic wake-ups)
    def wait(self, timeout=None):
        waits.append(timeout)
        return _ev.wait(timeout)

    def set(self):
        _ev.set()

    def clear(self):
        _ev.clear()


plugin._status_dirty = Rec()
_ev.set()  # one pass through the loop so it picks up the recorder
time.sleep(1.0)
check("idle: no beats", [e for _, e in posts if e.get("working")] == [], posts)
check("idle: waits without a timeout", waits and waits[-1] is None and len(waits) <= 2, waits)
plugin._on_stream_start(session_id="s-test", turn_id="s-test:x")
time.sleep(1.2)
working = [e for _, e in posts if e.get("working")]
check("active: beats while working", len(working) >= 3, len(working))
plugin._on_pre_tool_call(tool_name="terminal", args={"command": "sleep 600"}, session_id="s-test", turn_id="s-test:x")
check("inside a tool: long stale window", plugin._stale_after(plugin._active["s-test"]) == plugin.TOOL_STALE_AFTER)
plugin._on_pre_tool_call(tool_name="clarify", args={"question": "?"}, session_id="s-test", turn_id="s-test:x")
check("waiting on a question: normal window", plugin._stale_after(plugin._active["s-test"]) == plugin.STALE_AFTER)
plugin._on_post_tool_call(tool_name="terminal", session_id="s-test", turn_id="s-test:x")
check("after the tool: normal window", plugin._stale_after(plugin._active["s-test"]) == plugin.STALE_AFTER)
plugin._on_session_end(session_id="s-test", turn_id=None, interrupted=True)
time.sleep(0.5)
check("cleared → Ready sent", posts and posts[-1][1].get("working") is False, posts[-1:])
n = len(posts)
time.sleep(1.2)
check("idle again: no more beats", len(posts) == n, posts[n:])
check("idle again: waits without a timeout", waits[-1] is None, waits[-3:])

# ── a failed model call (bad key, quota…) must end "working" (it fires no session_end) ──
print("plugin: final API error")
plugin.FAIL_GRACE = 0.3
plugin._on_stream_start(session_id="s-err", turn_id="s-err:1")
plugin._on_api_request_error(session_id="s-err", turn_id="s-err:1", status_code=429, retryable=True, retry_count=0, max_retries=3)
check("retryable error: still working", "s-err" in plugin._active)
plugin._on_api_request_error(session_id="s-err", turn_id="s-err:1", status_code=401, retryable=False,
                             error={"type": "AuthenticationError",
                                    "message": "Error code: 401 - {'error': {'message': 'Missing Authentication header', 'code': 401}}"})
check("final error: status cleared at once", "s-err" not in plugin._active)
time.sleep(0.8)
errs = [e for _, e in posts if e.get("kind") == "error" and e.get("session") == "s-err"]
check("final error: one 'failed' notification, readable", len(errs) == 1 and errs[0].get("body") == "HTTP 401 · Missing Authentication header", errs)
check("final error: Ready sent", [e for _, e in posts if e.get("kind") == "status"][-1].get("working") is False)
plugin._on_stream_start(session_id="s-fb", turn_id="s-fb:1")
plugin._on_api_request_error(session_id="s-fb", turn_id="s-fb:1", status_code=401, retryable=False)
plugin._on_stream_start(session_id="s-fb", turn_id="s-fb:1")  # Hermes fell back to another provider
time.sleep(0.8)
check("fallback took over: no 'failed'", not [e for _, e in posts if e.get("kind") == "error" and e.get("session") == "s-fb"])
plugin._on_session_end(session_id="s-fb", turn_id=None, interrupted=True)
plugin._on_stream_start(session_id="s-ex", turn_id="s-ex:1")
plugin._on_api_request_error(session_id="s-ex", turn_id="s-ex:1", status_code=500, retryable=True, retry_count=3, max_retries=3)
check("retries used up: cleared", "s-ex" not in plugin._active)
time.sleep(0.5)

# ── bots.py off ──
print("bots.py off")
os.environ["HERMES_MOBILE_ROOT"] = str(tmp / "hroot")
bots = load("bots", ROOT / "hermes-plugin" / "hermes-mobile" / "bots.py")
bots.set_keep("default", True)
check("a bot was on", bots.load()["keep"] == ["default"])
bots.off()
check("off clears the keep list", bots.load()["keep"] == [])
check("no keeper found in this sandbox", bots._keeper_pids() == [])

print("OK" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
