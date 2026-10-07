#!/usr/bin/env python3
"""Battery checks (no phone needed): the cron ticker's next-wake calculation, the plugin's status loop
staying asleep while idle, the long-tool stale window, the dashboard watcher slowdown and `bots.py off`.
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

# ── cron ticker: poke from the alarm, cron_idle when nothing runs ──
print("cron_ticker.Ticker")
ct.JOB_CHECK = 0.05
busy = [False]
idles = []
tk = ct.Ticker(running=lambda: busy[0], idle=lambda since: idles.append(since))
t0 = time.monotonic()
check("plain cycle: waits the whole interval", tk.wait(0.3) is False and time.monotonic() - t0 >= 0.28)
check("plain cycle: no idle report (nothing happened)", idles == [])
threading.Timer(0.1, tk.poke).start()
t0 = time.monotonic()
tk.wait(5)
check("a poke ends the wait at once", time.monotonic() - t0 < 1)
poked_cycle = time.time()
check("…and the cycle it started owes a report", idles == [])
tk.wait(0.05)
check("idle reported once, with the poked cycle's start", len(idles) == 1 and abs(idles[0] - poked_cycle) < 0.1, idles)
tk.wait(0.05)
check("not again on the next cycle", len(idles) == 1, idles)
busy[0] = True
threading.Timer(0.3, lambda: busy.__setitem__(0, False)).start()
start = time.time()
t0 = time.monotonic()
tk.wait(1.0)
check("job running: reported as soon as it is done, wait still ends on time",
      len(idles) == 2 and time.monotonic() - t0 >= 0.95, (idles, time.monotonic() - t0))
check("a job that ran is reported even without a poke", len(idles) == 2 and idles[1] <= start + 0.01)
import logging  # noqa: E402

logging.disable(logging.CRITICAL)  # the failing hooks below are logged on purpose
boom = ct.Ticker(running=lambda: 1 / 0, idle=lambda s: 1 / 0)
check("a failing hook never breaks the loop", boom.wait(0.05) is False)
logging.disable(logging.NOTSET)
threading.Timer(0.1, tk.set).start()
t0 = time.monotonic()
check("set() still stops a long wait", tk.wait(30) is True and time.monotonic() - t0 < 1)

print("cron_ticker.poke_listener")
import socket  # noqa: E402

tk2 = ct.Ticker()
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
threading.Thread(target=ct.poke_listener, args=(tk2, port, lambda: "k3y"), daemon=True).start()
time.sleep(0.2)


def send(text):
    with socket.create_connection(("127.0.0.1", port), 2) as c:
        c.sendall(text.encode())
    time.sleep(0.2)


send("wrong\n")
check("wrong key: no poke", not tk2._poke.is_set())
send("k3y\n")
check("the app's key: poked", tk2._poke.is_set())
sent = []
wr = ct.WakeReporter(homes=lambda: [b], post=lambda e: sent.append(e) or True)
wr.report()
wr.report()
wr.report(force=True)
check("wake reporter: only changes, unless forced", len(sent) == 2 and sent[0]["kind"] == "wake_at", sent)

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

# ── dashboard: Hermes Desktop's poll threads slowed down ──
print("dashboard: slow desktop watchers")
import types  # noqa: E402

try:
    import fastapi  # noqa: F401
except ImportError:  # only the module-level names plugin_api uses
    class _Router:
        def __getattr__(self, _):
            return lambda *a, **k: (lambda f: f)
    sys.modules["fastapi"] = types.SimpleNamespace(APIRouter=_Router, HTTPException=Exception, Request=object)
    sys.modules["pydantic"] = types.SimpleNamespace(BaseModel=object)
sys.modules.pop("tui_gateway.server", None)
papi = load("plugin_api_battery", ROOT / "hermes-plugin" / "hermes-mobile" / "dashboard" / "plugin_api.py")
check("gateway not loaded: nothing done, not imported", papi.slow_desktop_watchers() == {} and "tui_gateway.server" not in sys.modules)
sig = lambda: 0  # noqa: E731
srv = types.SimpleNamespace(
    _CHANGE_WATCHES={"sessions.changed": (0.5, sig, sig), "cron.changed": (1.0, sig, sig), "pet.changed": (2.0, sig, sig),
                     "slow.already": (60.0, sig, sig)},
    _LEASE_POLL_S=0.5, _KANBAN_POLL_SECONDS=5.0, _BOT_DELIVERY_POLL_SECONDS=5.0, _LOOP_POLL_SECONDS=5.0)
skins = []
srv._broadcast_skin_if_changed = lambda: skins.append(1)
watches = srv._CHANGE_WATCHES
sys.modules["tui_gateway.server"] = srv
papi._watchers_slowed = False
done = papi.slow_desktop_watchers()
w = {k: v[0] for k, v in watches.items()}
check("sessions.changed stays quick (2 s)", w["sessions.changed"] == 2.0, w)
check("cron 5 s, desktop-only watches 30 s", w["cron.changed"] == 5.0 and w["pet.changed"] == 30.0, w)
check("a slower interval is never lowered", w["slow.already"] == 60.0, w)
check("same dict object mutated (the thread holds it)", srv._CHANGE_WATCHES is watches and watches["pet.changed"][1] is sig)
check("lease 5 s, kanban/bot mailbox 30 s, /loop untouched",
      (srv._LEASE_POLL_S, srv._KANBAN_POLL_SECONDS, srv._BOT_DELIVERY_POLL_SECONDS, srv._LOOP_POLL_SECONDS) == (5.0, 30.0, 30.0, 5.0))
for _ in range(5):
    srv._broadcast_skin_if_changed()
check("skin check throttled (first call runs, the next ones skip)", skins == [1], skins)
check("runs once", done and papi.slow_desktop_watchers() == {})
sys.modules.pop("tui_gateway.server", None)

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
