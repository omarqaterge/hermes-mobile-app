"""The diagnostic log on Hermes's side (hermes-plugin/hermes-mobile/diag.py, GET/PUT/DELETE /diag and the plugin's hooks).
What matters most is what can't come out: a canary secret and chat text are planted in every place the log reads from, and
none may appear in what the app is given.
Run: python3 tools/test_diag.py (the route part needs fastapi and httpx; skipped without them)."""
import importlib.util
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "hermes-plugin" / "hermes-mobile"
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (f" ({detail})" if detail and not cond else ""))
    if not cond:
        fails += 1


home = Path(tempfile.mkdtemp())
termux = Path(tempfile.mkdtemp())
os.environ["HOME"] = str(home)
os.environ["HM_TERMUX_HOME"] = str(termux)
(termux / "logs").mkdir()
(termux / ".hermes-mobile").mkdir()

spec = importlib.util.spec_from_file_location("hm_diag", PLUGIN / "diag.py")
diag = importlib.util.module_from_spec(spec)
sys.modules["hm_diag"] = diag
spec.loader.exec_module(diag)

CANARIES = [
    "sk-ant-api03-CANARYabcdefghijklmnopqrstuvwxyz0123456789",
    "ghp_CANARYabcdefghijklmnopqrstuvwxyz012345",
    "call my doctor about the results",
    "/sdcard/Documents/private-canary.pdf",
    "/root/my-private-canary-script.py",
    "canary@example.org",
    "https://canary.example.org/?token=abc",
    "CANARY_WORDS",
    # Phone data (contacts, messages, location) must never reach the log: a number, a place and a message's words.
    # Not listed: a lone token such as +15551234567, 555-010-0199 or 51.5074 has the same shape as a count or a status
    # and passes the shape check by design. scrubLog catches a number only in a known shape or under a name such as
    # number= or phone=; a lone 51.5074 or a bare digit run is not caught anywhere, on purpose (it looks like a count).
    "(555) 010-0199",
    "51.5074,-0.1278",
    "Your code is 123456, call me",
    "Meet at 5pm, the door code is 4821",
]


def leaks(obj):
    text = json.dumps(obj)
    return [c for c in CANARIES if c in text or c in text.replace("\\", "")]


print("events")
SHAPED = [c for c in CANARIES if c != "CANARY_WORDS"]  # that one is only planted where a line is read back or parsed
for c in SHAPED:
    check(f"a value of the wrong shape becomes ?: {c[:24]}", diag.format_line(1000000000, "a", "b", {"f": c}).endswith("f=?"))
check("short values stay", diag.format_line(1000000000, "turn", "end", {"secs": 12, "completed": True, "model": "claude-3-5-sonnet-20241022", "none": None}) == "1000000000 turn end secs=12 completed=true model=claude-3-5-sonnet-20241022")
check("a path is not a value", diag.format_line(1000000000, "a", "b", {"p": "sdcard/x"}).endswith("p=?"))
check("bad names become unknown", diag.format_line(1000000000, "Bad Area", "x y", {"A b": 1}) == "1000000000 unknown unknown unknown=1")
check("a reason keeps its name", diag.reason_name("text_response(finish_reason=stop)") == "text_response")
check("a reason drops an error's words", diag.reason_name("local_processing_error(call my doctor about the results)") == "local_processing_error")
check("a reason that isn't a name goes", diag.reason_name("Call my doctor") is None and diag.reason_name(None) is None and diag.reason_name(5) is None)
check("a chat's alias isn't its id", diag.alias("20260101_abc") != "20260101_abc" and len(diag.alias("20260101_abc")) == 8)
check("no chat", diag.alias(None) == "none")

for i, c in enumerate(SHAPED):
    diag.event("test", "canary", value=c, n=i)
diag.event("turn", "end", secs=3)
lines = diag.read_lines([diag.log_path()])
check("events read back with a date and no year", bool(lines) and re.match(r"\d\d-\d\d \d\d:\d\d:\d\d ", lines[-1]), lines[-1:])
check("no canary in the events", not leaks(lines), lines)
check("the log file is private to its owner", (diag.log_path().stat().st_mode & 0o077) == 0)

print("reading back checks every line again")
now = int(time.time())
with open(diag.log_path(), "a") as f:
    f.write("written by something else: call my doctor about the results\n")
    f.write(f"{now} test planted value=sk-ant-api03-CANARYabcdefghijklmnopqrstuvwxyz0123456789\n")  # too long for a value
    f.write(f"{now} test planted value=/sdcard/Documents/private-canary.pdf\n")
    f.write(f"{now - 8 * 86400} old line\n")
    f.write(f"{now} good line k=1\n")
back = diag.read_lines([diag.log_path()])
check("only well-formed lines come back", any("good line k=1" in l for l in back) and not leaks(back), back[-3:])
check("older than a week is dropped", not any(" old line" in l for l in back))

print("the limits")
diag._rate.update(minute=int(time.time()) // 60, count=diag.RATE_MAX, dropped=0)
minute = int(time.time()) // 60
diag.event("flood", "one")
if int(time.time()) // 60 == minute:
    check("over the rate limit: nothing written", not any("flood" in l for l in diag.read_lines([diag.log_path()])))
    check("over the rate limit: counted", diag._rate["dropped"] == 1)
diag._rate.update(minute=0, count=0, dropped=0)
big = "x" * 40
for i in range(6000):
    diag._rate.update(count=0)
    diag.event("fill", "the_log", a=big, n=i)
check("two files, each under the limit", diag.log_path().stat().st_size <= diag.MAX_BYTES and Path(f"{diag.log_path()}.1").stat().st_size <= diag.MAX_BYTES)
check("a read is bounded", len(diag.read_lines([f"{diag.log_path()}.1", diag.log_path()])) <= diag.MAX_READ_LINES)
diag.clear()

print("traceback shapes")
LOG = f"""
2026-01-01 starting
sending prompt: call my doctor about the results
Traceback (most recent call last):
  File "/root/.hermes/hermes-agent/gateway/run.py", line 120, in handle
    await send("call my doctor about the results", key="sk-ant-api03-CANARYabcdefghijklmnopqrstuvwxyz0123456789")
  File "/root/.hermes/installs/x/venv/lib/python3.12/site-packages/httpx/_client.py", line 9, in post
    return self.send(url="https://canary.example.org/?token=abc")
  File "/root/my-private-canary-script.py", line 3, in <module>
    run()
  File "/sdcard/Documents/private-canary.pdf", line 3, in x
    run()
httpx.ConnectError: can't reach https://canary.example.org/?token=abc for canary@example.org
some other line CANARY_WORDS
Traceback (most recent call last):
  File "/root/.hermes/plugins/hermes-mobile/canvas.py", line 7, in write
    open("/sdcard/Documents/private-canary.pdf")
FileNotFoundError: [Errno 2] /sdcard/Documents/private-canary.pdf
Traceback (most recent call last):
  File "/root/.hermes/plugins/hermes-mobile/canvas.py", line 7, in write
    open("/sdcard/Documents/private-canary.pdf")
FileNotFoundError: [Errno 2] again CANARY_WORDS
Traceback (most recent call last):
  File "/root/.hermes/hermes-agent/x.py", line 1, in y
    z()
call my doctor about the results: this first line has no error type
"""
shapes = diag.traceback_shapes(LOG)
check("no canary in the shapes", not leaks(shapes), shapes)
check("the type and the frames in known code are kept", shapes[0] == {"type": "httpx.ConnectError", "at": ["gateway/run.py:120", "httpx/_client.py:9"], "count": 1}, shapes[0])
check("the same one twice is counted", shapes[1] == {"type": "FileNotFoundError", "at": ["canvas.py:7"], "count": 2}, shapes[1])
check("words where a type belongs aren't kept", shapes[2]["type"] == "unknown", shapes[2])
for line in ["Alice: my private message", "my_private_diary.txt: No such file", "sk_" + "live_" + "fake" * 8, "SecretPlan: call my doctor", "Error"]:
    got = diag.traceback_shapes(f'Traceback (most recent call last):\n  File "/root/.hermes/hermes-agent/x.py", line 1, in y\n    z()\n{line}\n')
    check(f"not a type: {line[:24]}", got[0]["type"] == "unknown", got)
long_type = "a.very.long.module.path.that.keeps.going.on.ConnectTimeoutError"
check("a long module path keeps the class's name", diag.traceback_shapes(f'Traceback (most recent call last):\n{long_type}: x\n')[0]["type"] == "ConnectTimeoutError")
user_folder = diag.traceback_shapes('Traceback (most recent call last):\n  File "/storage/emulated/0/hermes-agent/omar_notes.py", line 3, in x\n    y()\n  File "/root/hermes-mobile/notes.py", line 3, in x\n    y()\nValueError: z\n')
check("a user's folder named like the code isn't code", user_folder[0]["at"] == [], user_folder)

print("what the app is given")
(termux / "logs" / "dashboard.log").write_text(LOG)
(termux / "logs" / "dashboard.pid").write_text(str(os.getpid()))
(termux / "logs" / "cron-ticker.pid").write_text("999999999")
(termux / "logs" / "loop-events.log").write_text(f"{now} service loop_exit name=dashboard code=137\n{now} service loop_exit name=call my doctor about the results\n")
(termux / ".hermes-mobile" / "distro").write_text("chroot\n")
diag.event("turn", "start", chat=diag.alias("abc"))
snap = diag.snapshot(1234)
check("no canary anywhere in the snapshot", not leaks(snap), leaks(snap))
check("the service's state", {"name": "dashboard", "alive": True, "log_kb": 2} in snap["services"] or any(s["name"] == "dashboard" and s["alive"] for s in snap["services"]), snap["services"])
check("a dead service shows as dead", any(s["name"] == "cron-ticker" and not s["alive"] for s in snap["services"]))
check("a service without a pid file isn't listed", not any(s["name"] == "memory-sync" for s in snap["services"]))
check("a loop's exit is in the events", any("loop_exit name=dashboard code=137" in l for l in snap["events"]))
check("a malformed loop line isn't", not any("doctor" in l for l in snap["events"]))
check("crashes name their service", snap["crashes"] and snap["crashes"][0]["service"] == "dashboard")
check("the facts", snap["facts"]["debian"] == "chroot" and snap["facts"]["plugin_stamp"] == 1234 and "python" in snap["facts"], snap["facts"])
(termux / ".hermes-mobile" / "distro").write_text("something-else\n")
check("only a known install kind", diag.facts()["debian"] == "proot")
check("never raises", diag.event("a", "b", x=object()) is None)

print("old lines leave the disk, not only the read")
old = now - 8 * 86400
diag.log_path().write_text(f"{old} old line\n{now} new line\nnot ours at all\n")
(termux / "logs" / "loop-events.log").write_text(f"{old} service loop_exit name=dashboard code=1\n")
diag.prune()
check("prune keeps only young checked lines", diag.log_path().read_text() == f"{now} new line\n", diag.log_path().read_text())
check("prune covers the supervisor's file", (termux / "logs" / "loop-events.log").read_text() == "")
diag._pruned_at[0] = 0
diag.log_path().write_text(f"{old} old line\n")
diag.event("a", "b")
check("an event prunes once a day", "old line" not in diag.log_path().read_text())

print("delete and off")
diag.clear()
check("delete empties the log and the crash source", diag.snapshot()["events"] == [] and diag.snapshot()["crashes"] == [], diag.snapshot())
check("a service log is emptied, not removed (a program may be appending)", (termux / "logs" / "dashboard.log").exists() and (termux / "logs" / "dashboard.log").stat().st_size == 0)
diag.event("a", "b")
(termux / "logs" / "dashboard.log").write_text(LOG)
diag.set_enabled(False)
check("off leaves the flag hermes-services reads", (termux / ".hermes-mobile" / "diag-off").exists())
check("off deletes what was kept", not diag.log_path().exists() and (termux / "logs" / "dashboard.log").stat().st_size == 0)
diag.event("after", "off")
check("off writes nothing", not diag.log_path().exists())
off = diag.snapshot()
check("off answers nothing", off == {"enabled": False, "facts": {}, "events": [], "services": [], "crashes": []}, off)
diag.set_enabled(True)
diag.event("back", "on")
check("on again", diag.enabled() and any("back on" in l for l in diag.snapshot()["events"]))
diag.clear()

print("local authentication's events: a closed list")
diag.clear()
diag._rate.update(minute=0, count=0, dropped=0)
diag.event("local", "unverified", port="events", why="bad_proof", side="plugin")
diag.event("local", "unverified", port="events", why="the key is 0123456789abcdef", side="plugin")
diag.event("local", "port_taken", port="dashboard", why="no_hello", side="termux")
diag.event("local", "port_taken", port="events", why="self", side="app")
diag.event("local", "legacy_key", port="dashboard", side="termux")
diag.event("local", "key_rotated", why="enforce", side="app")
diag.event("local", "unverified", port="9121", why="no_answer", side="plugin", kid="a1b2c3d4", nc="0" * 32)
diag.event("local", "secret_thing", port="events")
diag.event("local", "unverified", port="events", why="no_answer", side="someone")
written = diag.log_path().read_text().splitlines()
check("a fitting event is written as it is", any(l.endswith(" local unverified port=events why=bad_proof side=plugin") for l in written), written)
check("a reason outside the list is written as ?", any(l.endswith(" local unverified port=events why=? side=plugin") for l in written), written)
check("port_taken, legacy_key, key_rotated fit", sum(" local port_taken " in l or " local legacy_key " in l or " local key_rotated " in l for l in written) == 4, written)
check("a field that isn't listed (kid, nonce) is left out, a port number is ?",
      any(l.endswith(" local unverified port=? why=no_answer side=plugin") for l in written) and not any("kid=" in l or "nc=" in l for l in written), written)
check("a name outside the list is not written", not any("secret_thing" in l for l in written), written)
check("a side outside the list is ?", any(l.endswith(" local unverified port=events why=no_answer side=?") for l in written), written)
check("nothing secret-shaped got in", not any("0123456789abcdef" in l or "a1b2c3d4" in l for l in written), written)
(termux / "logs" / "loop-events.log").write_text(
    f"{now} local port_taken port=dashboard side=termux why=no_hello\n"
    f"{now} local legacy_key port=dashboard side=termux\n"
    f"{now} local port_taken port=dashboard side=termux why=deadbeef\n"
    f"{now} local unverified port=events kid=a1b2c3d4\n"
    f"{now} local whatever port=events\n"
    f"{now} local port_ok port=ticker\n"
    f"{now} local port_taken port=events port=events\n")
events = diag.snapshot()["events"]
check("the supervisor's fitting lines are read", any("local port_taken port=dashboard side=termux why=no_hello" in l for l in events)
      and any("local legacy_key port=dashboard side=termux" in l for l in events) and any("local port_ok port=ticker" in l for l in events), events)
check("a supervisor line that doesn't fit is dropped whole",
      not any("deadbeef" in l or "kid=" in l or "whatever" in l or "port=events port=events" in l for l in events), events)
check("the read-back check is the same as the write rule", diag.local_line_ok("local unverified port=events why=? side=plugin")
      and not diag.local_line_ok("local unverified port=events why=maybe") and diag.local_line_ok("service loop_exit name=x code=1"))
diag.clear()

print("wiring")
init = (PLUGIN / "__init__.py").read_text()
api_text = (PLUGIN / "dashboard" / "plugin_api.py").read_text()
check("no hook hands an error's words to the log", not re.search(r'_event\([^)]*(?:error=error\b|error=str\(|=\s*str\(e\)|reason=str)', init))
check("a hook passes only a reason's name", "reason=_reason(turn_exit_reason)" in init and "reason=_reason(reason)" in init)
check("no hook logs the message or tool arguments", not re.search(r'_event\([^)]*(user_message|tool_input|args=|final_text|content=)', init))
check("no session id goes in as it is", not re.search(r'_event\([^)]*chat=session_id', init))
check("the raw status trace isn't served by /diag", "mobile-status" not in (PLUGIN / "diag.py").read_text() and "/diag" in api_text)

try:
    import fastapi  # noqa: F401
    import httpx  # noqa: F401
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except ImportError:
    print("  [SKIP] routes: fastapi or httpx not installed (CI installs them)")
else:
    print("routes")
    spec = importlib.util.spec_from_file_location("plugin_api_diag", PLUGIN / "dashboard" / "plugin_api.py")
    api = importlib.util.module_from_spec(spec)
    sys.modules["plugin_api_diag"] = api
    spec.loader.exec_module(api)
    app = FastAPI()
    app.include_router(api.router)
    c = TestClient(app)
    (termux / "logs" / "dashboard.log").write_text(LOG)
    diag.event("turn", "start", chat=diag.alias("abc"))
    r = c.get("/diag")
    check("GET /diag answers", r.status_code == 200 and r.json()["enabled"] is True, r.text[:200])
    check("GET /diag holds no canary", not leaks(r.json()), leaks(r.json()))
    check("DELETE /diag", c.delete("/diag").status_code == 200 and c.get("/diag").json()["events"] == [])
    check("PUT /diag off", c.put("/diag", json={"enabled": False}).status_code == 200 and c.get("/diag").json()["enabled"] is False)
    check("PUT /diag on", c.put("/diag", json={"enabled": True}).status_code == 200 and c.get("/diag").json()["enabled"] is True)

print("OK" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
