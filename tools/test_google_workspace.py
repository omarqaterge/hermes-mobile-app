#!/usr/bin/env python3
"""Tests for the Google Workspace sign-in (hermes-plugin/hermes-mobile/google_workspace.py and its /google routes).
Needs fastapi + httpx:
    python3 tools/test_google_workspace.py                                   # Hermes's script faked (CI)
    ~/.hermes/hermes-agent/venv/bin/python3 tools/test_google_workspace.py   # + Hermes's real setup.py

Part 1 puts a fake google-workspace setup.py in a throwaway home: it answers the flags like Hermes's script and logs
them, so the routes are checked for what they run and what they answer. Part 2 (only when Hermes is importable) runs
Hermes's real script on a throwaway home for the steps that need no Google account.
"""
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "hermes-plugin" / "hermes-mobile"
fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


FAKE = r'''
import json, os, sys
from pathlib import Path
home = Path(os.environ["HERMES_HOME"])
with open(home / "calls.log", "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
a = sys.argv[1:]
tok, sec = home / "google_token.json", home / "google_client_secret.json"
if a[0] == "--check":
    if tok.exists() and json.loads(tok.read_text()).get("ok"):
        print(f"AUTHENTICATED: Token valid at {tok}"); sys.exit(0)
    print(f"TOKEN_INVALID: Re-run setup."); sys.exit(1)
if a[0] == "--client-secret":
    d = json.loads(Path(a[1]).read_text())
    if "installed" not in d and "web" not in d:
        print("ERROR: Not a Google OAuth client secret file (missing 'installed' key)."); sys.exit(1)
    sec.write_text(json.dumps(d)); print(f"OK: Client secret saved to {sec}"); sys.exit(0)
if a[0] == "--auth-url":
    if not sec.exists():
        print("ERROR: No client secret stored. Run --client-secret first."); sys.exit(1)
    print("https://accounts.google.com/o/oauth2/auth?state=s1&client_id=x"); sys.exit(0)
if a[0] == "--auth-code":
    if "state=s1" not in a[1]:
        print("ERROR: OAuth state mismatch. Run --auth-url again to start a fresh session."); sys.exit(1)
    tok.write_text(json.dumps({"ok": True})); print(f"OK: Authenticated. Token saved to {tok}"); sys.exit(0)
if a[0] == "--revoke":
    tok.unlink(missing_ok=True); print("Token revoked with Google."); sys.exit(0)
if a[0] == "--install-deps":
    print("Google dependencies synced. Restart Hermes, then rerun setup to continue OAuth."); sys.exit(0)
'''

print("google_workspace with Hermes's script faked")
gw = load("hm_google_workspace", PLUGIN / "google_workspace.py")
gw.agent_root = lambda: None  # only the home's copy of the skill
home = Path(tempfile.mkdtemp())
check("no skill: not available", gw.status(home) == {"available": False, "client_secret": False, "signed_in": False, "detail": ""})
script = home / gw.SCRIPT
script.parent.mkdir(parents=True)
script.write_text(FAKE)
calls = lambda: [json.loads(ln) for ln in (home / "calls.log").read_text().splitlines()] if (home / "calls.log").exists() else []

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

api = load("hm_plugin_api_google", PLUGIN / "dashboard" / "plugin_api.py")
api._home = lambda profile: home  # the profile's home (resolved by Hermes's hermes_constants on the phone)
app = FastAPI()
app.include_router(api.router, prefix="/api/plugins/hermes-mobile")
c = TestClient(app)
G = "/api/plugins/hermes-mobile/google"

r = c.get(G)
check("status: available, nothing set up, no --check without a token", r.json() == {"available": True, "client_secret": False, "signed_in": False, "detail": ""} and calls() == [], r.text)
r = c.post(G + "/start")
check("start without a client: 400 with the script's words", r.status_code == 400 and r.json()["detail"] == "No client secret stored. Run --client-secret first.", r.text)
r = c.put(G + "/client", json={"text": "not json"})
check("a client file that isn't JSON is refused before the script", r.status_code == 400 and "JSON" in r.json()["detail"] and calls()[-1] == ["--auth-url"], r.text)
r = c.put(G + "/client", json={"text": json.dumps({"other": {}})})
check("JSON that isn't an OAuth client is refused", r.status_code == 400 and "OAuth client" in r.json()["detail"], r.text)
r = c.put(G + "/client", json={"text": json.dumps({"installed": {"client_id": "x", "client_secret": "test-not-a-secret"}})})
check("a client file is stored through the script", r.status_code == 200 and r.json()["client_secret"] and calls()[-1][0] == "--client-secret", r.text)
check("the temporary copy is gone", not list(home.glob("hm-google-client-*")))
check("the stored client file is private", (home / "google_client_secret.json").stat().st_mode & 0o077 == 0)
r = c.post(G + "/start")
check("start answers Google's link", r.status_code == 200 and r.json()["url"].startswith("https://accounts.google.com/"), r.text)
r = c.post(G + "/finish", json={"url": "http://localhost:1/?state=WRONG&code=c"})
check("a pasted address from another sign-in is refused with the script's words", r.status_code == 400 and r.json()["detail"].startswith("OAuth state mismatch"), r.text)
r = c.post(G + "/finish", json={"url": "two words"})
check("something that isn't an address is refused before the script", r.status_code == 400 and calls()[-1][0] == "--auth-code" and calls()[-1][1].startswith("http://localhost:1/?state=WRONG"), r.text)
r = c.post(G + "/finish", json={"url": "http://localhost:1/?state=s1&code=4/abc&scope=x"})
check("the right address signs in", r.status_code == 200 and r.json()["signed_in"] is True and r.json()["detail"] == "", r.text)
check("status checks the token with --check", calls()[-1] == ["--check"])
r = c.post(G + "/install")
check("install runs the script's --install-deps", r.status_code == 200 and ["--install-deps"] in calls(), r.text)
r = c.delete(G)
check("sign out revokes", r.status_code == 200 and r.json()["signed_in"] is False and not (home / "google_token.json").exists(), r.text)
(home / "google_token.json").write_text(json.dumps({"ok": False}))
r = c.get(G)
check("a token that no longer works: not signed in, with the reason", r.json()["signed_in"] is False and r.json()["detail"].startswith("TOKEN_INVALID"), r.text)
check("the message helper keeps the ERROR line without its prefix", gw._message("x\nERROR: boom\ny", "f") == "boom" and gw._message("", "f") == "f")

# ── Part 2: Hermes's real script ──
try:
    import hermes_constants  # noqa: F401

    real = True
except Exception:
    real = False
if real:
    print("google_workspace with Hermes's real setup.py")
    gw2 = load("hm_google_workspace_real", PLUGIN / "google_workspace.py")
    h2 = Path(tempfile.mkdtemp())
    check("the script is found in the Hermes checkout", gw2.find_script(h2) is not None)
    check("status on an empty home", gw2.status(h2) == {"available": True, "client_secret": False, "signed_in": False, "detail": ""})
    try:
        gw2.start(h2)
        check("start without a client fails", False)
    except gw2.GoogleError as e:
        check("start without a client fails with the script's words", "client secret" in str(e).lower(), str(e))
    gw2.save_client_secret(h2, json.dumps({"installed": {"client_id": "x.apps.googleusercontent.com", "client_secret": "test-not-a-secret", "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token", "redirect_uris": ["http://localhost"]}}))
    check("the real script stores the client file", (h2 / "google_client_secret.json").is_file())
    try:
        url = gw2.start(h2)
        check("the real script makes Google's consent link", url.startswith("https://accounts.google.com/") and "localhost%3A1" in url, url[:80])
    except gw2.GoogleError as e:  # Google's libraries not installed in this Hermes: the app offers to install them
        check("without Google's libraries the reason is readable", "Google" in str(e), str(e))
    try:
        gw2.finish(h2, "http://localhost:1/?state=WRONG&code=c")
        check("a wrong state is refused", False)
    except gw2.GoogleError as e:
        check("the real script refuses a wrong state or a missing session", bool(str(e)), str(e))
else:
    print("(Hermes not importable: the real-script part is skipped)")

print("PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
