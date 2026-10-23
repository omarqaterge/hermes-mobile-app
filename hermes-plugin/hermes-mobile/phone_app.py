"""phone_app: Hermes uses a phone app on a hidden screen, so the user keeps using the real one.

The work is done by the app's background host (android/.../bg/BgHost.java), a small program that runs as the shell
user through Shizuku's rish. This module starts it on demand, talks to it over 127.0.0.1 with a per-start token,
asks the user once per app per chat (Hermes's approval gate; /yolo skips it), refuses banking/payment/password/2FA
apps unless the user allowed them in the app's Settings, and tells the phone app what is happening (event `bgapp`).
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

PORT = 9131
HOST_URL = f"http://127.0.0.1:{PORT}"
APP_PKG = "com.omarqaterge.hermesmobile"
HOST_CLASS = "com.omarqaterge.hermesmobile.bg.BgHost"
RISH_BIN = Path("/data/data/com.termux/files/home/bin/rish")
PREFS = Path.home() / ".hermes" / "mobile" / "bgapps.json"
SHOT_DIR = Path.home() / ".hermes" / "cache" / "phone_app"

# Apps refused unless the user allowed them (Settings → Background apps). Matched on package name and label, so it is
# best effort: generic words (bank, pay, wallet, authenticator, password…) plus well-known apps from many countries
# whose names don't say what they are.
SENSITIVE = re.compile(
    r"bank|banco|banque|\bpay\b|payment|pay\b|paypal|wallet|money|finance|venmo|zelle|cash ?app|squareup\.cash|klarna"
    r"|affirm|afterpay|chime|sofi|revolut|bunq|monzo|starling|\bn26\b|\bwise\b|transferwise|tikkie|chase|wellsfargo"
    r"|bofa|citibank|citimobile|hsbc|barclays|santander|lloyds|natwest|nubank|mercadopago|paytm|phonepe|paisa|\bupi\b|bhim|alipay|kakaopay"
    r"|\bing\b|\.ing\.|trading|trade|invest|broker|stock|robinhood|etoro|crypto|coin|binance|kraken|metamask|trustwallet"
    r"|ledger|authenticator|\bauthy\b|\b2fa\b|\botp\b|totp|password|passkey|keepass|bitwarden|1password|lastpass"
    r"|dashlane|\bkeeper\b|proton ?pass|enpass|vault|credential|digid|\beid\b|bankid|itsme",
    re.I)

# Set by the plugin's register(): notify(kind, title, body, session, **extra) and log(msg).
notify: Optional[Callable[..., None]] = None
log: Callable[[str], None] = lambda m: None

_lock = threading.RLock()
_token = ""
_state: Dict[str, Any] = {}          # {session, pkg, label}
_granted: set = set()                # (session, pkg) already approved in this chat
_names: Dict[int, str] = {}          # element number -> its text, from the last capture (for the status line)
_apps_cache: Tuple[float, List[dict]] = (0.0, [])


class PhoneAppError(Exception):
    pass


# ── settings ────────────────────────────────────────────────────────────────

def read_prefs() -> dict:
    try:
        d = json.loads(PREFS.read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def write_prefs(allow_sensitive: bool) -> dict:
    d = read_prefs()
    d["allow_sensitive"] = bool(allow_sensitive)
    PREFS.parent.mkdir(parents=True, exist_ok=True)
    tmp = PREFS.with_suffix(".tmp")
    tmp.write_text(json.dumps(d))
    tmp.replace(PREFS)
    return d


def is_sensitive(pkg: str, label: str = "") -> bool:
    return bool(SENSITIVE.search(pkg.replace("_", " ")) or SENSITIVE.search(label or ""))


MIN_SDK = 34  # VIRTUAL_DISPLAY_FLAG_STEAL_TOP_FOCUS_DISABLED: without it every tap would pull focus off the user's screen


def android_sdk() -> int:
    """The phone's API level (0 = unknown). getprop works from Termux and from the Debian container."""
    for exe in ("/system/bin/getprop", "getprop"):
        try:
            out = subprocess.run([exe, "ro.build.version.sdk"], capture_output=True, text=True, timeout=3).stdout.strip()
            if out.isdigit():
                return int(out)
        except Exception:
            continue
    return 0


def availability() -> Tuple[bool, str]:
    if not RISH_BIN.exists():
        return False, "Needs Shizuku (rish isn't set up)"
    sdk = android_sdk()
    if 0 < sdk < MIN_SDK:
        return False, "Needs Android 14 or newer"
    return True, ""


# ── host process ───────────────────────────────────────────────────────────

def _rish(cmd: str, stdin: str = "", timeout: float = 20) -> str:
    p = subprocess.run([str(RISH_BIN), "-c", cmd], input=stdin, capture_output=True, text=True, timeout=timeout)
    return (p.stdout or "") + (p.stderr or "")


def _request(path: str, body: Optional[dict] = None, timeout: float = 30, raw: bool = False):
    data = json.dumps(body or {}).encode() if body is not None or path not in ("/status",) else None
    req = urllib.request.Request(HOST_URL + path, data=data, method="POST" if data is not None else "GET",
                                 headers={"X-HM-Token": _token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = r.read()
        return payload if raw else json.loads(payload.decode() or "{}")


def _alive() -> bool:
    if not _token:
        return False
    try:
        return bool(_request("/status", None, timeout=2).get("ok"))
    except Exception:
        return False


def _apk_path() -> str:
    out = _rish(f"pm path {APP_PKG}")
    for line in out.splitlines():
        if line.startswith("package:") and line.endswith(".apk"):
            return line[len("package:"):].strip()
    if "Server is not running" in out or "not running" in out.lower():
        raise PhoneAppError("Shizuku isn't running. Ask the user to open Shizuku and start it, then try again.")
    raise PhoneAppError("The Hermes Mobile app isn't installed (or Shizuku can't see it).")


def ensure_host() -> None:
    """Start the background host if it isn't running (it exits by itself after 2 idle minutes)."""
    global _token
    with _lock:
        if _alive():
            return
        ok, why = availability()
        if not ok:
            raise PhoneAppError(why)
        apk = _apk_path()
        tok = secrets.token_hex(24)
        # The token goes in on stdin, never on a command line. The host closes rish's pipes, so rish returns at once.
        script = ("read -r T; cd /data/local/tmp; (HM_TOKEN=$T CLASSPATH=" + apk + " setsid nohup app_process / "
                  + HOST_CLASS + f" {PORT} </dev/null >/data/local/tmp/hm-bghost.log 2>&1 &)")
        try:
            _rish(script, stdin=tok + "\n", timeout=20)
        except subprocess.TimeoutExpired:
            pass
        _token = tok
        deadline = time.time() + 10
        while time.time() < deadline:
            if _alive():
                return
            time.sleep(0.4)
        _token = ""
        tail = _rish("tail -5 /data/local/tmp/hm-bghost.log")
        if "Address already in use" in tail or "BindException" in tail:
            raise PhoneAppError("Another background-app session is still running; wait 2 minutes and try again.")
        if "Android 14" in tail:
            raise PhoneAppError("Background apps need Android 14 or newer.")
        raise PhoneAppError("The background host didn't start: " + " ".join(tail.split())[-300:])


def call(path: str, body: Optional[dict] = None) -> dict:
    try:
        r = _request(path, body)
    except urllib.error.URLError as e:
        raise PhoneAppError(f"lost the background host ({e.reason}); open the app again") from e
    if not r.get("ok"):
        raise PhoneAppError(str(r.get("error") or "failed"))
    return r


# ── apps ────────────────────────────────────────────────────────────────────

def list_apps() -> List[dict]:
    global _apps_cache
    if time.time() - _apps_cache[0] < 300 and _apps_cache[1]:
        return _apps_cache[1]
    ensure_host()
    apps = sorted(call("/apps").get("apps", []), key=lambda a: a.get("label", "").lower())
    _apps_cache = (time.time(), apps)
    return apps


def resolve_app(name: str) -> dict:
    n = (name or "").strip()
    if not n:
        raise PhoneAppError("say which app (its name or package)")
    apps = list_apps()
    for a in apps:
        if a["pkg"] == n:
            return a
    low = n.lower()
    for test in (lambda l: l == low, lambda l: l.startswith(low), lambda l: low in l):
        hits = [a for a in apps if test(a.get("label", "").lower())]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            raise PhoneAppError("several apps match: " + ", ".join(f"{a['label']} ({a['pkg']})" for a in hits[:8]))
    raise PhoneAppError(f"no app called {n!r}; use action='list_apps'")


# ── approval ────────────────────────────────────────────────────────────────

def _approve(session: str, pkg: str, label: str) -> Optional[str]:
    """None when allowed. Asked once per app per chat; /yolo and approvals-off pass through Hermes's gate."""
    if (session, pkg) in _granted:
        return None
    try:
        from tools.approval import request_tool_approval
    except Exception:
        return "BLOCKED: Hermes's approval gate is unavailable, so phone_app can't ask the user"
    res = request_tool_approval(
        "phone_app", f"Use {label} in the background: Hermes opens it on a hidden screen and can read, tap and type in it",
        rule_key=f"phone_app:{pkg}")
    if not res.get("approved"):
        return str(res.get("message") or "the user said no")
    _granted.add((session, pkg))
    return None


# ── formatting ──────────────────────────────────────────────────────────────

def format_elements(els: List[dict]) -> str:
    lines = []
    for e in els:
        bits = [f"[{e['n']}]", e.get("cls", "")]
        if e.get("text"):
            bits.append(json.dumps(e["text"], ensure_ascii=False))
        if e.get("desc") and e.get("desc") != e.get("text"):
            bits.append("desc=" + json.dumps(e["desc"], ensure_ascii=False))
        if e.get("id"):
            bits.append("id=" + e["id"])
        bits += [k for k in ("click", "edit", "scroll", "checked", "focused") if e.get(k)]
        bits.append(f"@{e.get('x')},{e.get('y')}")
        lines.append(" ".join(b for b in bits if b))
    return "\n".join(lines)


def _save_image(b64: str) -> str:
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    for old in sorted(SHOT_DIR.glob("*.jpg"))[:-20]:  # keep the last 20
        try:
            old.unlink()
        except Exception:
            pass
    p = SHOT_DIR / f"screen-{int(time.time() * 1000)}.jpg"
    p.write_bytes(base64.b64decode(b64))
    return str(p)


def _capture(mode: str) -> dict:
    want_img = mode in ("vision", "som")
    want_tree = mode in ("ax", "som")
    r = call("/capture", {"tree": want_tree, "image": want_img, "max_w": 720})
    out: Dict[str, Any] = {"app": _state.get("label"), "screen": f"{r.get('w')}x{r.get('h')}"}
    if want_tree:
        els = r.get("elements", [])
        _names.clear()
        _names.update({e["n"]: str(e.get("text") or e.get("desc") or "") for e in els})
        out["elements"] = format_elements(els)
    if want_img and r.get("image_b64"):
        out["screenshot_path"] = _save_image(r["image_b64"])
        out["note"] = "Look at screenshot_path with your vision tool if the element list isn't enough."
    return out


def chip_label(args: Optional[dict] = None) -> str:
    """The status chip's short text: "Using <app>" (owner's wording)."""
    a = args if isinstance(args, dict) else {}
    if a.get("action") == "open" and a.get("app"):
        return f"Using {a['app']}"
    return f"Using {_state['label']}" if _state.get("label") else "Phone"


def end_session(sid: str) -> None:
    """The chat's turn is over (finished, failed or interrupted): close its app and take the card away.

    The tool only said "done" when the model called close/hand_over. A model that just stops talking left the app
    open and the card on screen until the app's own 130 s timer. Nothing is done for another chat's app."""
    with _lock:
        if not _state or (_state.get("session") and _state["session"] != sid):
            return
        try:
            _request("/close", {}, timeout=5)
        except Exception as e:  # the host is gone or busy: the card must go anyway
            log(f"phone_app end_session close: {type(e).__name__}: {e}")
        _event("done", "Finished")
        _state.clear()


def _event(state: str, action: str = "") -> None:
    if notify is None or not _state:
        return
    try:
        notify("bgapp", _state.get("label", ""), action, _state.get("session", ""), state=state, pkg=_state.get("pkg", ""),
               label=_state.get("label", ""), action=action, port=PORT, token=_token if state != "done" else "")
    except Exception as e:
        log(f"bgapp event failed: {e}")


# ── tool ────────────────────────────────────────────────────────────────────

TOOL_SCHEMA = {
    "name": "phone_app",
    "description": (
        "Use an app on the user's phone WITHOUT taking their screen: the app runs on a hidden screen while the user keeps "
        "using the phone. Workflow: action='open' with app (name or package), then 'capture' (numbered elements; "
        "mode='som' adds a screenshot path), then tap/set_text by element number, re-capture to check, and 'close' when "
        "done (or 'hand_over' to put the app on the user's real screen). The user is asked once per app per chat. "
        "Banking, payment, password and 2FA apps are refused unless the user allowed them in Settings."),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list_apps", "open", "capture", "tap", "set_text", "type", "key", "scroll",
                                                  "wait", "hand_over", "close"],
                       "description": "What to do. capture is free (no side effects)."},
            "app": {"type": "string", "description": "open: the app's name as shown on the phone, or its package."},
            "element": {"type": "integer", "description": "tap/set_text/scroll: element number from the last capture."},
            "coordinate": {"type": "array", "items": {"type": "integer"}, "description": "tap: [x, y] on the hidden screen (720x1600), when no element fits."},
            "text": {"type": "string", "description": "set_text: the field's new text (replaces it). type: text added to the focused field."},
            "key": {"type": "string", "description": "key: back, enter, del, tab, search, menu, up, down, left, right, space."},
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"], "description": "scroll direction (down = further down the list)."},
            "mode": {"type": "string", "enum": ["ax", "som", "vision"], "description": "capture: ax = element list (default), som = list + screenshot, vision = screenshot only."},
            "seconds": {"type": "number", "description": "wait: seconds (max 10)."},
            "capture_after": {"type": "boolean", "description": "Return a fresh element list after the action (saves a call)."},
        },
        "required": ["action"],
    },
}

_VERB = {"tap": "Tapping", "set_text": "Typing", "type": "Typing", "key": "Pressing", "scroll": "Scrolling",
         "capture": "Looking", "wait": "Waiting"}


def action_label(args: dict) -> str:
    """The status line for a call (the plugin's _tool_label)."""
    a = args if isinstance(args, dict) else {}
    act = str(a.get("action") or "")
    label = _state.get("label") or a.get("app") or "an app"
    if act == "open":
        return f"Opening {a.get('app') or 'an app'} in the background"
    if act == "list_apps":
        return "Listing the phone's apps"
    if act in ("close", "hand_over"):
        return f"{'Closing' if act == 'close' else 'Handing over'} {label}"
    verb = _VERB.get(act, "Using")
    what = ""
    if act in ("set_text", "type") and a.get("text"):
        what = f" \u201c{str(a['text'])[:40]}\u201d"
    elif act == "key" and a.get("key"):
        what = f" {a['key']}"
    elif act == "tap" and a.get("element") is not None:
        name = _names.get(int(a["element"]), "") if str(a["element"]).isdigit() else ""
        what = f" \u201c{name[:40]}\u201d" if name else ""
    return f"{label}: {verb.lower()}{what}"


def tool_handler(args: Dict[str, Any], session_id: str = "", task_id: str = "", **_: Any) -> str:
    sid = session_id or task_id or ""
    a = args if isinstance(args, dict) else {}
    act = str(a.get("action") or "").strip()
    try:
        return json.dumps(_run(act, a, sid), ensure_ascii=False)
    except PhoneAppError as e:
        return json.dumps({"ok": False, "action": act, "error": str(e)}, ensure_ascii=False)
    except Exception as e:
        log(f"phone_app {act}: {type(e).__name__}: {e}")
        return json.dumps({"ok": False, "action": act, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False)


def _need_open(sid: str) -> None:
    if not _state or not _alive():
        _state.clear()
        raise PhoneAppError("no app is open; use action='open' first")
    if _state.get("session") and sid and _state["session"] != sid:
        raise PhoneAppError(f"another chat is using {_state.get('label')} right now")


def _run(act: str, a: dict, sid: str) -> dict:
    with _lock:
        if act == "list_apps":
            return {"ok": True, "apps": [f"{x['label']} ({x['pkg']})" for x in list_apps()]}
        if act == "open":
            app = resolve_app(str(a.get("app") or ""))
            pkg, label = app["pkg"], app.get("label") or app["pkg"]
            if pkg == APP_PKG:
                raise PhoneAppError("that is Hermes Mobile itself")
            if is_sensitive(pkg, label) and not read_prefs().get("allow_sensitive"):
                raise PhoneAppError(f"{label} looks like a banking, payment, password or 2FA app. The user has not allowed "
                                    "those (Settings → Background apps in the phone app); don't try another way.")
            if _state and _state.get("session") not in ("", sid) and _alive():
                raise PhoneAppError(f"another chat is using {_state.get('label')} right now")
            denied = _approve(sid, pkg, label)
            if denied:
                return {"ok": False, "action": act, "error": denied}
            ensure_host()
            r = call("/open", {"pkg": pkg})
            _state.clear()
            _state.update({"session": sid, "pkg": pkg, "label": r.get("label") or label})
            _event("open", f"Opened {_state['label']}")
            out = {"ok": True, "opened": _state["label"], "package": pkg}
            out.update(_capture("ax"))
            return out
        if act in ("close", "hand_over"):
            if not _state or not _alive():
                _state.clear()
                return {"ok": True, "note": "nothing was open"}
            _need_open(sid)
            call("/" + act, {})
            label = _state.get("label")
            _event("done", "Closed" if act == "close" else "Handed over")
            _state.clear()
            return {"ok": True, ("closed" if act == "close" else "handed_over"): label}
        if act == "wait":
            time.sleep(max(0.0, min(float(a.get("seconds") or 1), 10.0)))
            if _state:
                return {"ok": True, **_capture("ax")} if a.get("capture_after") else {"ok": True}
            return {"ok": True}
        _need_open(sid)
        if act == "capture":
            _event("act", "Looking at the screen")
            return {"ok": True, **_capture(str(a.get("mode") or "ax"))}
        if act == "tap":
            if a.get("element") is not None:
                body: dict = {"n": int(a["element"])}
            elif isinstance(a.get("coordinate"), list) and len(a["coordinate"]) == 2:
                body = {"x": int(a["coordinate"][0]), "y": int(a["coordinate"][1])}
            else:
                raise PhoneAppError("tap needs element (from capture) or coordinate [x, y]")
            r = call("/tap", body)
        elif act == "set_text":
            if a.get("element") is None:
                raise PhoneAppError("set_text needs element (a text field from capture)")
            r = call("/set_text", {"n": int(a["element"]), "text": str(a.get("text") or "")})
        elif act == "type":
            r = call("/type", {"text": str(a.get("text") or "")})
        elif act == "key":
            r = call("/key", {"name": str(a.get("key") or "")})
        elif act == "scroll":
            r = call("/scroll", {"direction": str(a.get("direction") or "down"), "n": int(a.get("element") or 0)})
        else:
            raise PhoneAppError(f"unknown action {act!r}")
        _event("act", action_label(a))
        out = {"ok": True, "action": act, "via": r.get("via")}
        if a.get("capture_after"):
            out.update(_capture("ax"))
        return out
