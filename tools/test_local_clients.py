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
liar = FakeLocal("events", KEY, "wrong_key", app)
fresh(liar.port)
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
liar.close()
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
liar = FakeLocal("events", KEY, "wrong_key", app)
fresh(liar.port)
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
check("nothing reached the listener but hellos", only_hellos(liar) and nothing_private(liar))
liar.close()
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
liar = FakeLocal("events", KEY, "bad_proof", app)
fresh(liar.port)
pa._event("open", "Opened Example")
time.sleep(0.6)
check("to an unverified listener: the host's token never goes", ("b" * 48).encode() not in liar.received() and only_hellos(liar))
liar.close()
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
print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
