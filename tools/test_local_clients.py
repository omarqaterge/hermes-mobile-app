#!/usr/bin/env python3
"""The plugin side's clients of local authentication send nothing private to a local server that doesn't prove it holds
the key, and never send the key itself: the plugin's events sender (`__init__._post`, every hook and the phone_app
`bgapp` event through it, with the urgent fallback and its hourly limit), the cron ticker's events, and the
compatibility case of an app older than the plugin (its listener answers the hello with 403). Each runs against
tools/local_fake_server.py: honest, the wrong key, a proof under another key, the wrong address, the wrong role, silent,
garbage, an old app, and a good hello whose request is refused.
    python3 tools/test_local_clients.py
"""
import importlib.util
import json
import logging
import os
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "hermes-plugin" / "hermes-mobile"
sys.path.insert(0, str(HERE))
from local_fake_server import FakeLocal  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def wait(cond, seconds=5.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


tmp = Path(tempfile.mkdtemp())
os.environ["HOME"] = str(tmp)
os.environ["HERMES_HOME"] = str(tmp)
KEY = "4f1c0e9a7b3d5c2e8a6f4b1d9c7e5a3b2d0f8e6c4a2b1d3f"
NEW_KEY = "9d2e4f6a8c0b1d3e5f7a9c1e3b5d7f9a0c2e4a6c8e0b2d4f"
keyfile = tmp / "key"
keyfile.write_text(KEY + "\n")
SECRET = "rm -rf /sdcard/Private-Canary"

plugin = load("hermes_mobile_plugin_clients", PLUGIN / "__init__.py")
plugin.KEY_FILE = keyfile
plugin._key_cache.clear()
DIAG = []
plugin._event = lambda area, name, **f: DIAG.append((area, name, f))
NOTES = []
plugin._termux_fallback = lambda event: NOTES.append(dict(event))
APP = []


def app(method, path, headers, body):
    APP.append((method, path, json.loads(body or b"{}")))
    return 204, b""


def fresh(port):
    """The events client's state as a new process has it, aimed at ``port``."""
    plugin.EVENTS_PORT = port
    plugin._events.update(backoff=None, why="", fallback_at=None)
    DIAG.clear()
    NOTES.clear()
    APP.clear()


def only_hellos(srv):
    return all(h.startswith(b"GET /hermux/hello?") and not b for h, b in srv.raw)


def nothing_private(srv):
    data = srv.received()
    return KEY.encode() not in data and SECRET.encode() not in data and b"x-hermes-mobile-key" not in data.lower()


print("the plugin's events: an honest app")
honest = FakeLocal("events", lambda: keyfile.read_text().strip(), "honest", app)
fresh(honest.port)
event = {"kind": "approval", "title": "Approval needed", "body": SECRET, "session": "s1"}
check("delivered", plugin._post(event) is True and APP and APP[-1][2]["body"] == SECRET, APP)
check("signed after a hello on the same connection; the key itself never on the wire",
      len(honest.verified) == 1 and honest.hellos == 1 and KEY.encode() not in honest.received()
      and b"x-hermes-mobile-key" not in honest.received().lower(), honest.raw)
check("no diagnostic event, no fallback", not DIAG and not NOTES)

print("the plugin's events: a listener that doesn't prove the key gets nothing")
CASES = (("wrong_key", "unknown_kid"), ("bad_proof", "bad_proof"), ("wrong_addr", "bad_addr"), ("wrong_role", "bad_proof"),
         ("garbage", "no_hello"), ("no_hello", "no_hello"), ("refuse", "refused"))
for mode, why in CASES:
    other = FakeLocal("events", KEY, mode, app)
    fresh(other.port)
    ok = plugin._post(event)
    check(f"{mode}: not delivered ({why})", ok is False and not APP and not other.verified)
    if mode != "refuse":
        check(f"{mode}: it got the hello and nothing else: no key, no event text", only_hellos(other) and nothing_private(other), other.raw)
    else:
        check("refuse: our request had passed its hello, and still carried no key", KEY.encode() not in other.received())
    check(f"{mode}: one diagnostic event in the fixed shape", DIAG == [("local", "unverified", {"port": "events", "why": why, "side": "plugin"})], DIAG)
    n = len(other.raw)
    check(f"{mode}: then it waits: the next event tries nothing", plugin._post(event) is False and len(other.raw) == n, other.raw[n:])
    other.close()

silent = FakeLocal("events", KEY, "silent", app)
fresh(silent.port)
t0 = time.monotonic()
ok = plugin._post(event)
check("silent: not delivered, within the hello's bounds", ok is False and time.monotonic() - t0 < 8, time.monotonic() - t0)
check("silent: it got the hello only", only_hellos(silent) and nothing_private(silent))
check("silent: counts as no answer (the app may be starting): no back-off", plugin._events["backoff"].ready())
silent.close()

print("back-off and recovery")
unproven = FakeLocal("events", KEY, "wrong_key", app)
fresh(unproven.port)
plugin._post(event)
bo = plugin._events["backoff"]
check("first failure: 1 s", bo._delay == 1.0)
bo._until = 0
plugin._post(event)
check("then 2 s, doubling", bo._delay == 2.0)
for _ in range(12):
    bo._until = 0
    plugin._post(event)
check("at most 300 s", bo._delay == 300.0, bo._delay)
unproven.close()
plugin.EVENTS_PORT = honest.port
bo._until = 0
APP.clear()
check("the real app again: delivered, and the wait is gone", plugin._post(event) is True and bo.ready() and bo._delay == 0)

print("a new key: read again, tried once more")
fresh(honest.port)
keyfile.write_text(NEW_KEY)  # the app's listener proves with the new key; this process read the old one first
keys = [KEY, NEW_KEY]
real_key = plugin._key
plugin._key = lambda: keys.pop(0) if len(keys) > 1 else keys[0]
v0, h0 = len(honest.verified), honest.hellos
ok = plugin._post(event)
check("the first hello names the old key (unknown_kid), the key is read again and the second hello verifies",
      ok is True and len(honest.verified) == v0 + 1 and honest.hellos == h0 + 2
      and NEW_KEY.encode() not in honest.received() and KEY.encode() not in honest.received(), (ok, honest.hellos - h0))
check("no back-off after the retry worked", plugin._events["backoff"].ready() and not DIAG, DIAG)
keys = [KEY]
ok = plugin._post(event)
check("the same old key again: one try, then unknown_kid, nothing sent", ok is False and len(honest.verified) == v0 + 1
      and ("local", "unverified", {"port": "events", "why": "unknown_kid", "side": "plugin"}) in DIAG, DIAG)
plugin._key = real_key
keyfile.write_text(KEY)

print("urgent events: the fallback")
unproven = FakeLocal("events", KEY, "wrong_key", app)
fresh(unproven.port)
plugin._send("approval", "Approval needed", SECRET, "s1", urgent=True)
check("unverified: one Termux notification in plain words", wait(lambda: len(NOTES) == 1) and NOTES[0]["title"] == "Hermux didn't answer correctly"
      and NOTES[0]["body"] == "Hermes sent nothing to it. Open Hermux; if this stays, restart the phone.", NOTES)
check("…with none of the event's text", SECRET not in json.dumps(NOTES))
plugin._events["backoff"]._until = 0
plugin._send("ask", "Hermux asks", "another question", "s1", urgent=True)
time.sleep(0.5)
check("a second one within the hour: no second notification", len(NOTES) == 1, NOTES)
plugin._events["fallback_at"] -= plugin.FALLBACK_EVERY + 1
plugin._send("ask", "Hermux asks", "another question", "s1", urgent=True)
check("an hour later: one again", wait(lambda: len(NOTES) == 2), NOTES)
plugin._send("status", "Hermux", "Working", "s1")
time.sleep(0.5)
check("a non-urgent event: never a notification", len(NOTES) == 2)
check("nothing reached the listener but hellos", only_hellos(unproven) and nothing_private(unproven))
unproven.close()
fresh(1)
plugin._send("approval", "Approval needed", "the command", "s1", urgent=True)
check("the app isn't running (nothing listens): the request itself as a Termux notification, as before",
      wait(lambda: len(NOTES) == 1) and NOTES[0]["body"] == "the command" and NOTES[0]["kind"] == "approval", NOTES)

print("an app older than the plugin (its listener has no hello)")
old_app = FakeLocal("events", KEY, "no_hello", app)
fresh(old_app.port)
plugin._send("approval", "Approval needed", SECRET, "s1", urgent=True)
check("urgent: asks for the app's update, in plain words", wait(lambda: len(NOTES) == 1) and NOTES[0]["title"] == "Update the Hermux app", NOTES)
check("nothing was sent: no event, no key (the raw key is never a fallback)", only_hellos(old_app) and nothing_private(old_app)
      and not old_app.verified, old_app.raw)
check("the diagnostic event says no_hello", ("local", "unverified", {"port": "events", "why": "no_hello", "side": "plugin"}) in DIAG, DIAG)
old_app.close()

print("phone_app's bgapp event goes only to a verified app")
pa = load("hm_phone_app", PLUGIN / "phone_app.py")
pa.notify = plugin._send
pa._state.update(session="s1", pkg="com.example", label="Example")
pa._token, pa._port = "b" * 48, 40001
unproven = FakeLocal("events", KEY, "bad_proof", app)
fresh(unproven.port)
pa._event("open", "Opened Example")
time.sleep(0.6)
check("to an unverified listener: the host's token never goes", ("b" * 48).encode() not in unproven.received() and only_hellos(unproven))
unproven.close()
fresh(honest.port)
pa._event("open", "Opened Example")
check("to the app: delivered with port, token and auth mac", wait(lambda: APP) and APP[-1][2].get("token") == "b" * 48
      and APP[-1][2].get("auth") == "mac" and APP[-1][2].get("port") == 40001, APP)
pa._state.clear()

print("no local_auth.py: nothing is sent")
real = plugin._local_auth
plugin._local_auth = lambda: None
fresh(honest.port)
n = len(honest.raw)
check("not delivered, and nothing reached the port", plugin._post(event) is False and len(honest.raw) == n)
plugin._send("approval", "Approval needed", SECRET, "s1", urgent=True)
check("urgent: the plain fallback, not the event's text", wait(lambda: len(NOTES) == 1) and SECRET not in json.dumps(NOTES), NOTES)
plugin._local_auth = real

print("the cron ticker's events")
ct = load("cron_ticker_clients", PLUGIN / "cron_ticker.py")
ct.KEY_FILE = keyfile
ct._key_file = None
ct.EVENTS_PORT = honest.port
APP.clear()
check("honest: wake_at delivered, signed", ct._post({"kind": "wake_at", "at": 0}) is True and APP[-1][2] == {"kind": "wake_at", "at": 0})
check("…the key itself never sent", KEY.encode() not in honest.received())
for mode, why in CASES:
    other = FakeLocal("events", KEY, mode, app)
    ct.EVENTS_PORT = other.port
    ct._client.update(backoff=None, said=set())
    APP.clear()
    ok = ct._post({"kind": "cron_idle", "since": 1.0})
    check(f"ticker, {mode}: not delivered, only the hello went", ok is False and not other.verified and (mode == "refuse" or only_hellos(other))
          and KEY.encode() not in other.received(), other.raw)
    n = len(other.raw)
    check(f"ticker, {mode}: then it waits", ct._post({"kind": "cron_idle", "since": 1.0}) is False and len(other.raw) == n)
    other.close()
logs = []


class Grab(logging.Handler):
    def emit(self, record):
        logs.append(record.getMessage())


logging.getLogger().addHandler(Grab())
ct._local_auth = lambda: None
ct.EVENTS_PORT = honest.port
ct._client.update(backoff=None, said=set())
n = len(honest.raw)
r1 = ct._post({"kind": "wake_at", "at": 0})
r2 = ct._post({"kind": "wake_at", "at": 0})
check("ticker without local_auth.py: sends nothing", r1 is False and r2 is False and len(honest.raw) == n)
check("…and says so once", sum("local_auth.py is missing" in m for m in logs) == 1, logs)
check("the ticker's log lines hold no key", not any(KEY in m for m in logs))

honest.close()

print("a request's own deadline (Session.request deadline_s)")
la0 = plugin._local_auth()
slow = FakeLocal("bghost", KEY, "honest", lambda m, p, h, b: (time.sleep(1.5), (200, b"{}"))[1])
saved_deadline = la0.ANSWER_DEADLINE_S
la0.ANSWER_DEADLINE_S = 1.0  # 10 s on the phone; short here


def slow_call(**kw):
    timeout = kw.pop("timeout", 3)
    try:
        return la0.session("bghost", slow.port, KEY, timeout=timeout).request("POST", "/wait_for", b"{}", **kw).status
    except OSError:
        return "failed"


check("by default the answer has ANSWER_DEADLINE_S: a slower one fails", slow_call(timeout=0.5) == "failed")
check("a longer deadline for a call that takes longer: it succeeds", slow_call(timeout=3, deadline_s=3.0) == 200)
check("never shorter than the per-read timeout", slow_call(timeout=2.5, deadline_s=0.2) == 200)
check("a shorter one than the call takes: it fails", slow_call(timeout=0.5, deadline_s=0.8) == "failed")
la0.ANSWER_DEADLINE_S = saved_deadline
from importlib.machinery import SourceFileLoader  # noqa: E402

_loader = SourceFileLoader("hm_local_copy", str(HERE.parent / "phone" / "hm-local"))
hm_copy = importlib.util.module_from_spec(importlib.util.spec_from_loader("hm_local_copy", _loader))
_loader.exec_module(hm_copy)
for name, mod in (("local_auth.py", la0), ("hm-local", hm_copy)):
    for bad in (float("nan"), float("inf"), float("-inf"), 0, -1.0, True, "5", 10 ** 400, -(10 ** 400)):
        n = len(slow.raw)
        try:
            mod.session("bghost", slow.port, KEY, timeout=2).request("POST", "/wait_for", b"{}", deadline_s=bad)
            got = "sent"
        except ValueError:
            got = "refused"
        except Exception as e:  # anything else (an OverflowError, say) is not the same refusal
            got = type(e).__name__
        check(f"{name}: a deadline of {str(bad)[:12]} is refused before anything is sent",
              got == "refused" and len(slow.raw) == n + 1 and slow.raw[-1][0].startswith(b"GET /hermux/hello?"), (got, slow.raw[n:]))
    saved_max = mod.MAX_DEADLINE_S
    mod.MAX_DEADLINE_S = 0.8  # 120 s on the phone
    t0 = time.monotonic()
    try:
        mod.session("bghost", slow.port, KEY, timeout=0.5).request("POST", "/wait_for", b"{}", deadline_s=1e9)
        got = "answered"
    except OSError:
        got = "failed"
    check(f"{name}: a huge deadline is capped at MAX_DEADLINE_S", got == "failed" and time.monotonic() - t0 < 1.4, (got, time.monotonic() - t0))
    mod.MAX_DEADLINE_S = saved_max
slow.close()

print("the developer tools' token (tools/devtoken.py)")
import http.server  # noqa: E402
import threading  # noqa: E402

import devtoken  # noqa: E402
from local_auth_cases import TokenServer  # noqa: E402

V = json.loads((HERE / "local-auth-vectors.json").read_text(encoding="utf-8"))
la = devtoken.local_auth()
honest_case, other_case = V["token_cases"][0], V["token_cases"][1]
os.environ["HM_EVENT_KEY"] = V["key"]
os.environ.pop("HM_DASH_ADDR", None)
ts = TokenServer(la, V["key"], V["other_key"], honest_case)
real = ts.port
ts.port = 9119  # the phone's dashboard, reached through `adb forward tcp:<real> tcp:9119`: it proves 127.0.0.1:9119
check("over adb forward: the proof names the phone's address (HM_DASH_ADDR, default 127.0.0.1:9119)",
      devtoken.dashboard_token(f"http://127.0.0.1:{real}") == honest_case["token"])
ts = TokenServer(la, V["key"], V["other_key"], honest_case)
os.environ["HM_DASH_ADDR"] = "127.0.0.1:9119"
try:
    devtoken.dashboard_token(f"http://127.0.0.1:{ts.port}")
    got = "token"
except SystemExit as e:
    got = str(e)
check("a proof for the port dialled, when the phone's address is expected: refused", "bad_addr" in got, got)
os.environ.pop("HM_DASH_ADDR")
ts = TokenServer(la, V["key"], V["other_key"], other_case)
try:
    devtoken.dashboard_token(f"http://127.0.0.1:{ts.port}")
    got = "token"
except SystemExit as e:
    got = str(e)
check("a wrong proof over the token: no token, a plain message", "not verified" in got and V["key"] not in got, got)
seen_keys = []


class Page(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        seen_keys.append(self.headers.get("X-Hermes-Mobile-Key"))
        b = b'<script>window.__HERMES_SESSION_TOKEN__ = "mock-token";</script>'
        self.send_response(200)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


mock = http.server.HTTPServer(("127.0.0.1", 0), Page)
threading.Thread(target=mock.serve_forever, daemon=True).start()
os.environ["HM_EVENT_KEY"] = ""
devtoken.KEY_FILE = str(tmp / "no-key-here")
try:
    devtoken.dashboard_token(f"http://127.0.0.1:{mock.server_port}")
    got = "token"
except SystemExit as e:
    got = str(e)
check("no key: the tools for the phone refuse, with what to do", "HM_EVENT_KEY" in got and not seen_keys, got)
check("no key, a mock (plain): the page's token, sent no key at all",
      devtoken.dashboard_token(f"http://127.0.0.1:{mock.server_port}", plain=True) == "mock-token" and seen_keys == [None], seen_keys)
os.environ["HM_EVENT_KEY"] = V["key"]
seen_keys.clear()
try:
    devtoken.dashboard_token(f"http://127.0.0.1:{mock.server_port}", plain=True)
    got = "token"
except SystemExit as e:
    got = str(e)
check("with a key, a page without the hello: nothing but the hello, no token, the key never sent", "no_hello" in got and seen_keys == [None], (got, seen_keys))
mock.shutdown()
print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
