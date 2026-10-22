#!/usr/bin/env python3
"""Tests for the plugin's phone_app tool (phone_app.py) against a fake background host:
    python3 tools/test_phone_app.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import threading
import types
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("phone_app", os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile", "phone_app.py"))
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


# ── fake host ──
HOST = {"token": None, "calls": [], "open": None}
APPS = [{"pkg": "com.google.android.keep", "label": "Keep notes"}, {"pkg": "com.miui.calculator", "label": "Calculator"},
        {"pkg": "com.bunq.android", "label": "bunq"}, {"pkg": "com.example.cal2", "label": "Calendar"},
        {"pkg": "com.example.cal3", "label": "Calendar Pro"}]


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _reply(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _handle(self):
        if self.headers.get("X-HM-Token") != HOST["token"]:
            return self._reply({"ok": False, "error": "forbidden"}, 403)
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}") if n else {}
        HOST["calls"].append((self.path, body))
        p = self.path
        if p == "/status":
            return self._reply({"ok": True})
        if p == "/apps":
            return self._reply({"ok": True, "apps": APPS})
        if p == "/open":
            HOST["open"] = body["pkg"]
            return self._reply({"ok": True, "display": 7, "label": next(a["label"] for a in APPS if a["pkg"] == body["pkg"])})
        if p == "/capture":
            return self._reply({"ok": True, "w": 720, "h": 1600, "elements": [
                {"n": 1, "cls": "Button", "desc": "New note", "click": True, "x": 600, "y": 1500},
                {"n": 2, "cls": "EditText", "text": "Search", "id": "search", "edit": True, "x": 360, "y": 120}],
                **({"image_b64": "/9j/AA=="} if body.get("image") else {})})
        if p in ("/tap", "/set_text", "/type", "/key", "/scroll"):
            return self._reply({"ok": True, "via": "node"})
        if p in ("/close", "/hand_over"):
            HOST["open"] = None
            return self._reply({"ok": True})
        return self._reply({"ok": False, "error": "not found"}, 404)

    do_GET = do_POST = _handle


srv = HTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
pa.HOST_URL = f"http://127.0.0.1:{srv.server_address[1]}"

tmp = Path(tempfile.mkdtemp())
pa.PREFS = tmp / "bgapps.json"
pa.SHOT_DIR = tmp / "shots"
fake_rish = tmp / "rish"
fake_rish.write_text("#!/bin/sh\n")
pa.RISH_BIN = fake_rish

RISH = []


def rish(cmd, stdin="", timeout=20):
    RISH.append((cmd, stdin))
    if cmd.startswith("pm path"):
        return "package:/data/app/x/base.apk\n"
    if "app_process" in cmd:
        HOST["token"] = stdin.strip()  # the host reads its token from stdin
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
check("open returns the element list", "[1] Button desc=\"New note\" click @600,1500" in r.get("elements", ""), r.get("elements"))
start = [c for c in RISH if "app_process" in c[0]]
check("host started once, token only on stdin (never in the command)",
      len(start) == 1 and HOST["token"] and HOST["token"] not in start[0][0] and len(HOST["token"]) >= 32)
check("approval asked once with the per-app rule key", ASKED == [("phone_app", "phone_app:com.google.android.keep")], ASKED)
check("open event carries port + token for the app", EVENTS and EVENTS[-1][0] == "bgapp" and EVENTS[-1][2]["state"] == "open"
      and EVENTS[-1][2]["token"] == HOST["token"] and EVENTS[-1][2]["label"] == "Keep notes")
check("chip text says Using <app>", pa.chip_label({"action": "tap"}) == "Using Keep notes")
check("status line names the tapped element", pa.action_label({"action": "tap", "element": 1}) == "Keep notes: tapping \u201cNew note\u201d",
      pa.action_label({"action": "tap", "element": 1}))

r = run({"action": "tap", "element": 1, "capture_after": True})
check("tap by element, capture_after adds elements", r.get("ok") and ("/tap", {"n": 1}) in HOST["calls"] and "elements" in r)
check("act event after an action", EVENTS[-1][2]["state"] == "act")
r = run({"action": "set_text", "element": 2, "text": "milk é ✓"})
check("set_text sends the text unchanged (non-ASCII)", ("/set_text", {"n": 2, "text": "milk é ✓"}) in HOST["calls"])
r = run({"action": "capture", "mode": "som"})
check("som capture saves a screenshot file", r.get("screenshot_path") and Path(r["screenshot_path"]).exists())
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
check("Hermes Mobile itself is refused", not r["ok"])

HOST["token"] = "rotated"  # the host died and another started: our token no longer works
r = run({"action": "capture"})
check("a dead host is reported, not retried blindly", not r["ok"])

pa.RISH_BIN = tmp / "missing"
check("unavailable without rish", pa.availability() == (False, "Needs Shizuku (rish isn't set up)"))

srv.shutdown()
print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
