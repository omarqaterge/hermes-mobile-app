#!/usr/bin/env python3
"""Tests for the plugin's phone_app tool (phone_app.py) against a fake background host that speaks local
authentication (tools/local_fake_server.py: the hello, then one signed request, with this start's token as the key):
    python3 tools/test_phone_app.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time as _time
import types
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from local_fake_server import FakeLocal  # noqa: E402
spec = importlib.util.spec_from_file_location("phone_app", os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile", "phone_app.py"))
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


# ── fake host ──
HOST = {"token": None, "calls": [], "open": None, "view": 0, "black": False, "missing": False}
APPS = [{"pkg": "com.google.android.keep", "label": "Keep notes"}, {"pkg": "com.miui.calculator", "label": "Calculator"},
        {"pkg": "com.bunq.android", "label": "bunq"}, {"pkg": "com.example.cal2", "label": "Calendar"},
        {"pkg": "com.example.cal3", "label": "Calendar Pro"}]


def reply(obj, code=200):
    return code, json.dumps(obj).encode()


def host(method, path, headers, raw):
    body = json.loads(raw or b"{}") if raw else {}
    HOST["calls"].append((path, body))
    p = path
    if HOST["missing"] and p not in ("/status", "/apps", "/open", "/capture", "/close"):
        return reply({"ok": False, "error": "not found"}, 404)  # an app older than the plugin
    if p == "/status":
        return reply({"ok": True})
    if p == "/apps":
        return reply({"ok": True, "apps": APPS})
    if p == "/resolve":
        data = body["intent"].get("data", "")
        if "several" in data:
            return reply({"ok": False, "error": "several apps can open this; say which with app: A (a), B (b)"})
        pkg = body.get("pkg") or ("com.bunq.android" if "bunq" in data else "com.google.android.keep")
        return reply({"ok": True, "pkg": pkg, "label": next(a["label"] for a in APPS if a["pkg"] == pkg)})
    if p == "/open":
        HOST["open"] = body["pkg"]
        HOST["view"] = 0
        return reply({"ok": True, "display": 7, "label": next(a["label"] for a in APPS if a["pkg"] == body["pkg"])})
    if p == "/capture":
        els = [{"n": 1, "role": "button", "text": "New note", "x": 600, "y": 1500},
               {"n": 2, "role": "field", "hint": "Search", "id": "search", "x": 360, "y": 120}]
        if HOST["view"]:
            els.append({"n": 3, "role": "text", "text": f"Note {HOST['view']}", "x": 360, "y": 400})
        img = {"image_b64": "/9j/AA=="} if body.get("image") else {}
        return reply({"ok": True, "w": 720, "h": 1600, "screen": "NotesActivity", "elements": els, **img,
                      **({"black": True} if HOST["black"] and body.get("image") else {})})
    if body.get("target") == "Missing":
        return reply({"ok": False, "error": 'nothing on the screen says "Missing"'})
    if p in ("/tap", "/set_text", "/type", "/key", "/long_press", "/submit", "/swipe"):
        HOST["view"] += 1  # these change the screen; scroll, toggle and the waits don't
        return reply({"ok": True, "via": "node", **({"target": "button \"" + body["target"] + "\""} if body.get("target") else {})})
    if p == "/toggle":
        return reply({"ok": True, "checked": True, "changed": not body.get("on")})
    if p in ("/scroll", "/scroll_to", "/wait_for"):
        if p == "/wait_for" and HOST.get("slow"):
            _time.sleep(HOST["slow"])  # the host waits for the screen before it answers anything
        return reply({"ok": True, "via": "node"})
    if p in ("/close", "/hand_over"):
        HOST["open"] = None
        return reply({"ok": True})
    return reply({"ok": False, "error": "not found"}, 404)


# The host proves itself with the token it was started with (HOST["token"]; "rotated" once it died and another
# started), on the port the kernel gave it.
srv = FakeLocal("bghost", lambda: HOST["token"] or "no-host-started-yet-0000", "honest", host)
HOST["log"] = None  # what the host's log says; None: the LISTENING line of the current start


tmp = Path(tempfile.mkdtemp())
pa.PREFS = tmp / "bgapps.json"
pa.SHOT_DIR = tmp / "shots"
pa.NOTES_DIR = tmp / "notes"
fake_rish = tmp / "rish"
fake_rish.write_text("#!/bin/sh\n")
pa.RISH_BIN = fake_rish

RISH = []


def rish(cmd, stdin="", timeout=20):
    RISH.append((cmd, stdin))
    if cmd.startswith("pm path"):
        return "package:/data/app/x/base.apk\n"
    if "app_process /" in cmd:
        HOST["token"], HOST["auth"] = stdin.split("\n")[:2]  # the host reads its token and HM_AUTH from stdin
    if cmd.startswith("tail"):
        if HOST["log"] is not None:
            return HOST["log"]
        return f"LISTENING {srv.port} {pa._local_auth().kid(HOST['token'])}\n" if HOST["token"] else ""
    return ""


pa._rish = rish

EVENTS = []
pa.notify = lambda kind, title, body, session, **kw: EVENTS.append((kind, session, kw))

ASKED = []
APPROVE = {"answer": True}
approval = types.ModuleType("tools.approval")


def request_tool_approval(tool_name, reason, rule_key=""):
    ASKED.append((tool_name, rule_key))
    return {"approved": APPROVE["answer"], "message": "BLOCKED: denied by user"}


approval.request_tool_approval = request_tool_approval
sys.modules.setdefault("tools", types.ModuleType("tools"))
sys.modules["tools.approval"] = approval


def run(args, sid="chat1"):
    return json.loads(pa.tool_handler(args, session_id=sid))


print("phone_app")
check("banking/2FA/password apps count as sensitive",
      all(pa.is_sensitive(p, l) for p, l in [("com.revolut.revolut", "Revolut"), ("com.bunq.android", "bunq"),
                                            ("com.ing.mobile", "ING"), ("com.google.android.apps.authenticator2", "Authenticator"),
                                            ("com.x8bit.bitwarden", "Bitwarden"), ("com.google.android.apps.walletnfcrel", "Wallet")]))
check("ordinary apps are not sensitive",
      not any(pa.is_sensitive(p, l) for p, l in [("com.google.android.keep", "Keep notes"), ("com.miui.calculator", "Calculator"),
                                                  ("com.spotify.music", "Spotify"), ("com.whatsapp", "WhatsApp"),
                                                  ("com.citymapper.app.release", "Citymapper"), ("com.android.chrome", "Chrome"),
                                                  ("com.google.android.apps.maps", "Maps"), ("com.netflix.mediaclient", "Netflix"),
                                                  ("com.android.vending", "Play Store"), ("com.ubercab.eats", "Uber Eats")]))
check("well-known finance/2FA apps from many countries are sensitive",
      all(pa.is_sensitive(p, l) for p, l in [("com.chase.sig.android", "Chase"), ("com.wf.wellsfargomobile", "Wells Fargo"),
                                            ("net.one97.paytm", "Paytm"), ("com.phonepe.app", "PhonePe"),
                                            ("com.google.android.apps.nbu.paisa.user", "Google Pay"), ("com.coinbase.android", "Coinbase"),
                                            ("com.nu.production", "Nubank"), ("com.eg.android.AlipayGphone", "Alipay"),
                                            ("com.squareup.cash", "Cash App"), ("com.klarna.android", "Klarna"),
                                            ("com.authy.authy", "Authy"), ("com.robinhood.android", "Robinhood")]))
real_sdk = pa.android_sdk
pa.android_sdk = lambda: 33
check("Android 13 is reported as unsupported", pa.availability() == (False, "Needs Android 14 or newer"))
pa.android_sdk = lambda: 0
check("unknown Android version still allowed (the host checks too)", pa.availability()[0])
pa.android_sdk = real_sdk

r = run({"action": "capture"})
check("capture before open says to open first", not r["ok"] and "open" in r["error"])

r = run({"action": "open", "app": "keep"})
check("open resolves a name, starts the host and opens", r.get("ok") and HOST["open"] == "com.google.android.keep", r)
check("open returns the element list, one line per element with its role and name",
      r.get("elements", "").splitlines() == ['[1] button "New note"', '[2] field hint="Search"'], r.get("elements"))
check("open says which screen of the app it is", r.get("screen") == "NotesActivity", r)
start = [c for c in RISH if "app_process /" in c[0]]
check("host started once, token only on stdin (never in the command)",
      len(start) == 1 and HOST["token"] and HOST["token"] not in start[0][0] and len(HOST["token"]) >= 32)
check("the kernel picks its port (port 0), and HM_AUTH=mac comes on stdin too", start[0][0].rstrip().endswith(
      "BgHost 0 </dev/null >/data/local/tmp/hm-bghost.log 2>&1 &)") and "HM_AUTH=$A" in start[0][0]
      and "mac" not in start[0][0] and HOST["auth"] == "mac", start)
check("a host from before is stopped first, in a call of its own", any(c[0] == "pkill -f 'app_process.*[B]gHost'" for c in RISH)
      and [c[0] for c in RISH].index("pkill -f 'app_process.*[B]gHost'") < [c[0] for c in RISH].index(start[0][0]), RISH)
check("every request was a hello and then a signed one: the token was never sent",
      srv.hellos >= 2 and HOST["token"].encode() not in srv.received() and b"x-hm-token" not in srv.received().lower())
check("approval asked once with the per-app rule key", ASKED == [("phone_app", "phone_app:com.google.android.keep")], ASKED)
check("open event carries port + token for the app, and auth mac", EVENTS and EVENTS[-1][0] == "bgapp" and EVENTS[-1][2]["state"] == "open"
      and EVENTS[-1][2]["token"] == HOST["token"] and EVENTS[-1][2]["label"] == "Keep notes"
      and EVENTS[-1][2]["port"] == srv.port and EVENTS[-1][2]["auth"] == "mac", EVENTS[-1])
check("chip text says Using <app>", pa.chip_label({"action": "tap"}) == "Using Keep notes")
check("status line names the tapped element", pa.action_label({"action": "tap", "element": 1}) == "Keep notes: tapping \u201cNew note\u201d",
      pa.action_label({"action": "tap", "element": 1}))

r = run({"action": "tap", "element": 1})
check("tap by element answers with the new screen without asking", r.get("ok") and ("/tap", {"n": 1}) in HOST["calls"]
      and "Note 1" in r.get("elements", ""), r)
check("act event after an action", EVENTS[-1][2]["state"] == "act")
r = run({"action": "set_text", "element": 2, "text": "milk é ✓"})
check("set_text sends the text unchanged (non-ASCII)", ("/set_text", {"n": 2, "text": "milk é ✓"}) in HOST["calls"])
r = run({"action": "capture", "mode": "som"})
check("som capture saves a screenshot file", r.get("screenshot_path") and Path(r["screenshot_path"]).exists())
check("som asks the host to draw the numbers", HOST["calls"][-1] == ("/capture", {"tree": True, "image": True, "marks": True, "max_w": 720}))
HOST["black"] = True
r = run({"action": "capture", "mode": "vision"})
check("a black (secure) screen is explained", "black" in r.get("note", ""), r)
HOST["black"] = False
r = run({"action": "tap"})
check("tap without a target is refused", not r["ok"])

r = run({"action": "tap", "element": 1}, sid="chat2")
check("another chat can't drive the open app", not r["ok"] and "another chat" in r["error"])

r = run({"action": "close"})
check("close closes and sends done (no token)", r.get("ok") and HOST["open"] is None and EVENTS[-1][2]["state"] == "done"
      and EVENTS[-1][2]["token"] == "")

r = run({"action": "open", "app": "Keep notes"})
check("same app in the same chat is not asked again", r.get("ok") and len(ASKED) == 1, ASKED)
run({"action": "close"})

r = run({"action": "open", "app": "Keep notes"}, sid="chat3")
check("a new chat is asked again", len(ASKED) == 2)
run({"action": "close"}, sid="chat3")

APPROVE["answer"] = False
r = run({"action": "open", "app": "Calculator"})
check("a denied approval doesn't open the app", not r["ok"] and HOST["open"] is None and "denied" in r["error"], r)
APPROVE["answer"] = True

r = run({"action": "open", "app": "bunq"})
check("sensitive app refused by default, without asking", not r["ok"] and "Settings" in r["error"] and len(ASKED) == 3, r)
pa.write_prefs(True)
r = run({"action": "open", "app": "bunq"})
check("sensitive app allowed after the Settings toggle", r.get("ok") and HOST["open"] == "com.bunq.android", r)
run({"action": "close"})
pa.write_prefs(False)
check("prefs persist to the json file", json.loads(pa.PREFS.read_text()) == {"allow_sensitive": False})

r = run({"action": "open", "app": "calendar"})
check("an exact label match wins over partial ones", r.get("ok") and HOST["open"] == "com.example.cal2", r)
run({"action": "close"})
r = run({"action": "open", "app": "cal"})
check("ambiguous names list the candidates", not r["ok"] and "several apps" in r["error"], r)
r = run({"action": "open", "app": "nothing-like-this"})
check("unknown app points at list_apps", not r["ok"] and "list_apps" in r["error"])
r = run({"action": "open", "app": "com.omarqaterge.hermesmobile"})
check("Hermux itself is refused", not r["ok"])

HOST["token"] = "rotated"  # the host died and another started: our token no longer works
r = run({"action": "capture"})
check("a dead host is reported, not retried blindly", not r["ok"])

print("easier for the model")
els = [{"n": 1, "role": "button", "text": "Wi-Fi, Connected", "x": 300, "y": 200},
       {"n": 2, "role": "switch", "checked": True, "x": 650, "y": 200},
       {"n": 3, "role": "list", "more": "after", "x": 360, "y": 800},
       {"n": 4, "role": "image button", "id": "more_options", "x": 680, "y": 90},
       {"n": 5, "role": "field", "text": "milk", "hint": "Title", "focused": True, "x": 360, "y": 300},
       {"n": 6, "role": "pager", "more": "both", "horizontal": True, "x": 360, "y": 1200}]
check("the list is short: names, states, and a position only for nameless elements",
      pa.format_elements(els).splitlines() == ['[1] button "Wi-Fi, Connected"', '[2] switch on @650,200',
                                               '[3] list (more below)', '[4] image button id=more_options @680,90',
                                               '[5] field "milk" hint="Title" focused', '[6] pager (more both ways)'],
      pa.format_elements(els))
check("an old host's element (cls, desc) still reads", pa.format_elements([{"n": 1, "cls": "Button", "desc": "OK", "x": 1, "y": 2}])
      == '[1] Button "OK"')

run({"action": "open", "app": "keep"})
HOST["calls"].clear()
r = run({"action": "tap", "target": "New note"})
check("tap by text sends target, not a number", ("/tap", {"target": "New note"}) in HOST["calls"] and r["target"] == 'button "New note"', r)
r = run({"action": "tap", "text": "New note"})
check("tap(text=…) is read as the target", ("/tap", {"target": "New note"}) in HOST["calls"][1:], HOST["calls"])
r = run({"action": "scroll", "direction": "down"})
check("an action that changed nothing says so instead of resending the list",
      r.get("screen_changed") is False and "elements" not in r and "end" in r.get("note", ""), r)
r = run({"action": "tap", "element": 1, "capture_after": False})
check("capture_after=false skips the screen", r.get("ok") and "elements" not in r, r)
r = run({"action": "set_text", "target": "Search", "text": "eggs"})
check("set_text finds the field by its label", ("/set_text", {"target": "Search", "text": "eggs"}) in HOST["calls"], HOST["calls"][-3:])
run({"action": "toggle", "target": "Wi-Fi", "on": False})
check("toggle passes the wanted state", ("/toggle", {"target": "Wi-Fi", "on": False}) in HOST["calls"])
run({"action": "swipe", "coordinate": [360, 1200, 360, 400]})
check("swipe takes two points", ("/swipe", {"x1": 360, "y1": 1200, "x2": 360, "y2": 400}) in HOST["calls"])
r = run({"action": "swipe", "coordinate": [1, 2]})
check("swipe with one point is refused", not r["ok"] and "x1" in r["error"], r)
run({"action": "wait_for", "target": "Saved", "seconds": 3})
check("wait_for passes text and time", ("/wait_for", {"target": "Saved", "gone": False, "seconds": 3.0}) in HOST["calls"])
t0 = _time.time()
run({"action": "key", "key": "back", "wait_after": 0.3, "capture_after": False})
check("wait_after waits before answering", _time.time() - t0 >= 0.3)

HOST["calls"].clear()
r = run({"action": "steps", "steps": [{"action": "tap", "target": "New note"}, {"action": "set_text", "target": "Search", "text": "a"},
                                      {"action": "submit"}]})
paths = [c[0] for c in HOST["calls"]]
check("steps run in order and look at the screen once, at the end",
      paths == ["/tap", "/set_text", "/submit", "/capture"] and r["ok"] and len(r["done"]) == 3 and "elements" in r, (paths, r))
HOST["calls"].clear()
r = run({"action": "steps", "steps": [{"action": "tap", "target": "New note"}, {"action": "tap", "target": "Missing"},
                                      {"action": "key", "key": "back"}]})
check("steps stop at the first failure and say which", not r["ok"] and r["error"].startswith("step 2 (tap) failed")
      and len(r["done"]) == 1 and "/key" not in [c[0] for c in HOST["calls"]] and "elements" in r, r)
r = run({"action": "steps", "steps": [{"action": "open", "app": "Calculator"}]})
check("open can't be a step", not r["ok"] and "can't be a step" in r["error"], r)
r = run({"action": "steps", "steps": [{"action": "wait", "seconds": 0}] * 21})
check("at most 20 steps", not r["ok"] and "20" in r["error"], r)

r = run({"action": "note", "text": "New note button is bottom right;  the title field says Title"})
check("note is saved for the open app", r.get("noted") and "bottom right; the title" in pa.read_notes("com.google.android.keep"))
run({"action": "close"})
r = run({"action": "open", "app": "keep"})
check("open shows the app's notes", "bottom right" in r.get("your_notes_for_this_app", ""), r)
run({"action": "close"})
for i in range(200):
    pa.add_note("com.example.cal2", f"note number {i} " + "x" * 30)
kept = pa.read_notes("com.example.cal2")
check("notes keep only the newest, whole lines", len(kept) <= pa.NOTES_MAX and kept.startswith("- ") and "note number 199" in kept
      and "note number 0 " not in kept, kept[:80])
check("a note needs a real package name", pa._notes_file("../evil") is None)

print("open straight to a screen")
check("url is a VIEW intent", pa.intent_of({"url": "https://example.org/x"}) == {"action": "android.intent.action.VIEW", "data": "https://example.org/x"})
check("share_text is a SEND intent with the text", pa.intent_of({"share_text": "milk"}) == {
    "action": "android.intent.action.SEND", "type": "text/plain", "extras": {"android.intent.extra.TEXT": "milk"}})
check("intent keeps only plain fields and extras",
      pa.intent_of({"intent": {"action": "android.intent.action.INSERT", "data": "content://com.android.calendar/events",
                               "extras": {"title": "Dentist", "beginTime": 1767261600000, "bad": {"x": 1}}, "component": "x/y"}})
      == {"action": "android.intent.action.INSERT", "data": "content://com.android.calendar/events",
          "extras": {"title": "Dentist", "beginTime": 1767261600000}})
ASKED.clear()
HOST["calls"].clear()
r = run({"action": "open", "share_text": "milk"}, sid="chat-share")
check("a share opens the app it resolves to, asking for that app", r.get("ok") and HOST["open"] == "com.google.android.keep"
      and ASKED == [("phone_app", "phone_app:com.google.android.keep")], (r, ASKED))
check("the host gets the intent with the resolved package",
      ("/open", {"pkg": "com.google.android.keep", "intent": pa.intent_of({"share_text": "milk"})}) in HOST["calls"], HOST["calls"])
run({"action": "close"}, sid="chat-share")
r = run({"action": "open", "url": "https://bunq.example/pay"}, sid="chat-share")
check("a link into a sensitive app is refused like opening it", not r["ok"] and "Settings" in r["error"] and HOST["open"] is None, r)
r = run({"action": "open", "url": "https://several.example"}, sid="chat-share")
check("a link several apps can open asks the model to choose", not r["ok"] and "several apps" in r["error"], r)
r = run({"action": "open", "app": "Calendar", "url": "https://x.example"}, sid="chat-share")
check("app + url resolves inside that app", r.get("ok") and HOST["open"] == "com.example.cal2", r)
HOST["missing"] = True
r = run({"action": "tap", "target": "New note"}, sid="chat-share")
check("an action the phone's app doesn't know yet asks for an app update", not r["ok"] and "newer Hermux" in r["error"], r)
HOST["missing"] = False
run({"action": "close"}, sid="chat-share")

print("the turn ends while an app is open")
run({"action": "open", "app": "Calculator"}, sid="chat9")
EVENTS.clear()
pa.end_session("other-chat")
check("another chat's turn ending leaves the app open", HOST["open"] == "com.miui.calculator" and not EVENTS, EVENTS)
pa.end_session("chat9")
check("the turn ending closes the app on the host", HOST["open"] is None)
check("and tells the phone app it is done (no token)", [(k, kw.get("state"), kw.get("token")) for k, _, kw in EVENTS] == [("bgapp", "done", "")], EVENTS)
check("and forgets the app", pa._state == {})
EVENTS.clear()
pa.end_session("chat9")
check("ending twice sends nothing", not EVENTS)
run({"action": "open", "app": "Calculator"}, sid="chat9")
HOST["token"] = "rotated"  # host gone: still clears the card
EVENTS.clear()
pa.end_session("chat9")
check("a dead host still ends the card", [kw.get("state") for _, _, kw in EVENTS] == ["done"] and pa._state == {}, EVENTS)

print("another chat after the owner let go")
import time as _t
pa.turn_running = None
run({"action": "open", "app": "Calculator"}, sid="chatA")
r = run({"action": "open", "app": "Keep notes"}, sid="chatB")
check("a chat whose app is in use (turn running, recent) still blocks others", not r["ok"] and "another chat" in r["error"], r)
pa.end_session("chatA")  # turn ended without close
r = run({"action": "open", "app": "Keep notes"}, sid="chatB")
check("after A's turn ends, B can open an app at once", r["ok"] and HOST["open"] == "com.google.android.keep", r)
pa.turn_running = lambda sid: False
pa._state["at"] -= 25  # A's turn is over and it has been quiet a while, but no end hook arrived
r = run({"action": "open", "app": "Calculator"}, sid="chatC")
check("an owner whose turn is gone and quiet is replaced", r["ok"] and HOST["open"] == "com.miui.calculator", r)
pa.turn_running = lambda sid: True
pa._state["at"] -= 200  # silent past the bound, turn claims to run
r = run({"action": "open", "app": "Keep notes"}, sid="chatD")
check("an owner idle past the bound is replaced, the old app closed first",
      r["ok"] and HOST["open"] == "com.google.android.keep" and [c[0] for c in HOST["calls"] if c[0] == "/close"], r)
pa.turn_running = None
pa.end_session("chatD")

print("finding and checking this start's host")
la = pa._local_auth()
check("a LISTENING line counts only with this start's key id", pa.listening_port(f"LISTENING 41234 {la.kid('a' * 48)}\n", la.kid("b" * 48)) == 0
      and pa.listening_port(f"x\nLISTENING 41234 {la.kid('a' * 48)}\n", la.kid("a" * 48)) == 41234)
check("a port below 1024 or a malformed line is no port", pa.listening_port(f"LISTENING 80 {la.kid('a' * 48)}", la.kid("a" * 48)) == 0
      and pa.listening_port(f"LISTENING 41234 {la.kid('a' * 48)} extra", la.kid("a" * 48)) == 0)
pa.DEADLINE_S = 1.0
pa._token, pa._port = "", 0
HOST["log"] = f"LISTENING {srv.port} {la.kid('c' * 48)}\n"  # a line left by an earlier start: another key id
try:
    pa.ensure_host()
    ok = False
except pa.PhoneAppError as e:
    ok = "didn't start" in str(e)
check("a line from an earlier start doesn't mislead it: no host, nothing used", ok and pa._port == 0 and pa._token == "")
HOST["log"] = None
pa.ensure_host()
check("its own LISTENING line: the host verifies, and the port is the one it named", pa._port == srv.port and pa._alive())
before = len([c for c in RISH if "app_process /" in c[0]])
pa.ensure_host()
check("a verified host is reused, not started again", len([c for c in RISH if "app_process /" in c[0]]) == before)

unproven = FakeLocal("bghost", lambda: HOST["token"], "wrong_key", host)
seen_events = []
pa.event = lambda area, name, **f: seen_events.append((area, name, f))
pa._port = unproven.port  # something else answers on the host's port now
check("a host that doesn't prove the token is not alive", not pa._alive())
try:
    pa.call("/tap", {"n": 1, "text": "secret words"})
    msg = ""
except pa.PhoneAppError as e:
    msg = str(e)
check("a request to it fails with plain words, and it got nothing but the hello", msg == pa.UNVERIFIED
      and b"secret words" not in unproven.received() and HOST["token"].encode() not in unproven.received()
      and all(h.startswith(b"GET /hermux/hello?") for h, _ in unproven.raw), (msg, unproven.raw))
check("the diagnostic event has the fixed shape", seen_events and seen_events[-1] == ("local", "unverified",
      {"port": "bghost", "why": "unknown_kid", "side": "plugin"}), seen_events)
for mode, why in (("bad_proof", "bad_proof"), ("wrong_addr", "bad_addr"), ("wrong_role", "bad_proof"),
                  ("garbage", "no_hello"), ("no_hello", "no_hello"), ("refuse", "refused")):
    other = FakeLocal("bghost", lambda: HOST["token"], mode, host)
    pa._port = other.port
    seen_events.clear()
    try:
        pa.call("/type", {"text": "typed secret"})
        failed = False
    except pa.PhoneAppError:
        failed = True
    check(f"a host that answers {mode}: the request fails ({why}), typed text never reaches it as a verified request",
          failed and not other.verified and seen_events and seen_events[-1][2]["why"] == why
          and (mode == "refuse" or b"typed secret" not in other.received()), (seen_events, other.raw))
    other.close()
silent = FakeLocal("bghost", lambda: HOST["token"], "silent", host)
pa._port = silent.port
t0 = _time.time()
check("a silent host is not alive, within the bounds", not pa._alive() and _time.time() - t0 < 8)
silent.close()
check("…and nothing private reached it", all(h.startswith(b"GET /hermux/hello?") for h, _ in silent.raw))
pa.event = lambda area, name, **f: None
starts = len([c for c in RISH if "app_process /" in c[0]])
pa._port = unproven.port
pa.ensure_host()
check("a failed hello means not alive: a fresh host with a new token on its own port",
      len([c for c in RISH if "app_process /" in c[0]]) == starts + 1 and pa._port == srv.port and pa._alive())
unproven.close()
pa._token = "x" * 48  # the token was lost (the plugin restarted with a stale copy): the hello fails
check("a lost token: not alive", not pa._alive())
pa.ensure_host()
check("…and a fresh start fixes it", pa._alive() and pa._token == HOST["token"])
HOST["log"] = f"LISTENING {srv.port} {la.kid('z' * 48)}\nAndroid 14 or newer needed\n"
pa._token, pa._port = "", 0
try:
    pa.ensure_host()
    msg = ""
except pa.PhoneAppError as e:
    msg = str(e)
check("the host's own complaint still reaches the model", "Android 14" in msg, msg)
HOST["log"] = None
print("an older app's host (no key id in its LISTENING line)")
pa._token, pa._port = "", 0
HOST["log"] = "LISTENING 9131\n"
pa.DEADLINE_S = 8.0
t0 = _time.time()
try:
    pa.ensure_host()
    msg = ""
except pa.PhoneAppError as e:
    msg = str(e)
check("it asks for the app's update, in a few seconds, and stops that host", msg == pa.OLD_APP and _time.time() - t0 < 5
      and RISH[-1][0] == "pkill -f 'app_process.*[B]gHost'", (msg, _time.time() - t0))
reads = []


def stale_then_own(cmd, stdin="", timeout=20):
    if cmd.startswith("tail"):
        reads.append(1)
        if len(reads) < 2:
            return "LISTENING 9131\n"  # left from an earlier start, before this start's own line
        return f"LISTENING {srv.port} {pa._local_auth().kid(HOST['token'])}\n"
    return rish(cmd, stdin, timeout)


pa._rish = stale_then_own
HOST["log"] = None
pa._token, pa._port = "", 0
pa.ensure_host()
check("a line without a key id left from before doesn't stop this start's own", pa._alive() and pa._port == srv.port)
pa._rish = rish
pa.DEADLINE_S = 1.0

print("a call the host takes long to answer")
pa._token, pa._port = "", 0
HOST["log"] = None
pa.ensure_host()
pa._state.update(session="chat-slow", pkg="com.google.android.keep", label="Keep notes", at=_time.time())
HOST["slow"] = 12.5
t0 = _time.time()
r = run({"action": "wait_for", "target": "Saved", "seconds": 12, "capture_after": False}, sid="chat-slow")
check("a wait_for of 12 s answers after about 12.5 s: still a success", r.get("ok") and _time.time() - t0 >= 12, (r, _time.time() - t0))
saved = dict(pa.DEADLINES)
pa.DEADLINES["/wait_for"] = 1.0
HOST["slow"] = 2.5
t0 = _time.time()
r = run({"action": "wait_for", "target": "Saved", "seconds": 2, "capture_after": False}, sid="chat-slow")
check("a call past its own deadline fails at that deadline", not r["ok"] and "lost the background host" in r["error"]
      and _time.time() - t0 < 2.4, (r, _time.time() - t0))
pa.DEADLINES.clear()
pa.DEADLINES.update(saved)
HOST["slow"] = 0
_time.sleep(1.5)  # the slow call still running on the host
check("the deadlines fit the host's longest calls", pa.DEADLINES["/scroll_to"] >= 16 * 1.5 + 8 and pa.DEADLINES["/wait_for"] >= 12 + 5
      and pa.DEADLINES["/open"] >= 10 + 5)
check("a quick call keeps the usual 10 s", pa.DEADLINE_DEFAULT == 10.0 and "/tap" not in pa.DEADLINES)
seen_deadlines = []
real_request = pa._local_auth().Session.request


def record(self, method, path, body=None, **kw):
    seen_deadlines.append((path, kw.get("deadline_s")))
    return real_request(self, method, path, body, **kw)


pa._local_auth().Session.request = record
pa._state.update(session="chat-slow", pkg="com.google.android.keep", label="Keep notes", at=_time.time())
run({"action": "tap", "element": 1, "capture_after": False}, sid="chat-slow")
run({"action": "scroll_to", "target": "x", "capture_after": False}, sid="chat-slow")
pa._local_auth().Session.request = real_request
check("each call gets its own bound: a tap 10 s, scroll_to 45 s", ("/tap", 10.0) in seen_deadlines
      and ("/scroll_to", 45.0) in seen_deadlines, seen_deadlines)
pa._state.clear()

pa._rish = rish
pa.RISH_BIN = tmp / "missing"
check("unavailable without rish", pa.availability() == (False, "Needs Shizuku (rish isn't set up)"))

srv.close()
print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
