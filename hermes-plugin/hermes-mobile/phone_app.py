"""phone_app: Hermes uses a phone app on a hidden screen, so the user keeps using the real one.

The work is done by the app's background host (android/.../bg/BgHost.java), a small program that runs as the shell
user through Shizuku's rish. This module starts it on demand, talks to it over 127.0.0.1 with a per-start token,
asks the user once per app per chat (Hermes's approval gate; /yolo skips it), refuses banking/payment/password/2FA
apps unless the user allowed them in the app's Settings, and tells the phone app what is happening (event `bgapp`).

Made for few model round trips: actions take an element's text instead of a number, several can go in one call
(`steps`), `open` can jump straight to a screen (a link, a share, an intent), and every action answers with the new
screen (or says nothing changed).
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
NOTES_DIR = Path.home() / ".hermes" / "mobile" / "app-notes"   # <package>.md: what the model learned about an app
NOTES_MAX = 3000                     # characters kept per app (the newest)
MAX_STEPS = 20

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
_state: Dict[str, Any] = {}          # {session, pkg, label, at}  (at = owner's last phone_app call)
DEADLINE_S = 10.0                    # how long to wait for a started host to answer
STALE_S = 130.0                      # same as the host's idle timeout: an owner silent this long has let go
STALE_IDLE_S = 20.0                  # owner's turn is over and it has been quiet this long: let go sooner
turn_running: Optional[Callable[[str], bool]] = None   # set by the plugin: is this chat's turn still running?
_granted: set = set()                # (session, pkg) already approved in this chat
_names: Dict[int, str] = {}          # element number -> its text, from the last capture (for the status line)
_last_view = ""                      # the last element list the model was shown (to say "nothing changed")
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


# ── app notes ───────────────────────────────────────────────────────────────

def _notes_file(pkg: str) -> Optional[Path]:
    return NOTES_DIR / f"{pkg}.md" if re.fullmatch(r"[A-Za-z0-9_.]+", pkg or "") else None


def read_notes(pkg: str) -> str:
    f = _notes_file(pkg)
    try:
        return f.read_text().strip() if f else ""
    except Exception:
        return ""


def add_note(pkg: str, text: str) -> None:
    """Keep what worked in an app for the next time (shown on open). The newest NOTES_MAX characters stay."""
    f = _notes_file(pkg)
    if not f:
        raise PhoneAppError("no app to write a note for")
    line = " ".join(text.split())[:500]
    if not line:
        raise PhoneAppError("note needs text")
    old = read_notes(pkg)
    body = (old + "\n" if old else "") + f"- {time.strftime('%Y-%m-%d')}: {line}"
    if len(body) > NOTES_MAX:
        body = body[-NOTES_MAX:]
        body = body[body.find("\n") + 1:] if "\n" in body else body
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(body + "\n")
    tmp.replace(f)


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


def ensure_host(_retry: bool = False) -> None:
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
        deadline = time.time() + DEADLINE_S
        while time.time() < deadline:
            if _alive():
                return
            time.sleep(0.4)
        _token = ""
        tail = _rish("tail -5 /data/local/tmp/hm-bghost.log")
        if ("Address already in use" in tail or "BindException" in tail) and not _retry:
            # A host from before (the plugin restarted and lost its token, or a close never reached it) still holds
            # the port. It is ours and nobody can use it without the token: stop it and start a fresh one.
            _rish("pkill -f 'app_process.*[B]gHost'; sleep 1")
            return ensure_host(_retry=True)
        if "Address already in use" in tail or "BindException" in tail:
            raise PhoneAppError("Another background-app session is still running; wait 2 minutes and try again.")
        if "Android 14" in tail:
            raise PhoneAppError("Background apps need Android 14 or newer.")
        raise PhoneAppError("The background host didn't start: " + " ".join(tail.split())[-300:])


def call(path: str, body: Optional[dict] = None) -> dict:
    try:
        r = _request(path, body)
    except urllib.error.HTTPError as e:
        if e.code == 404:  # the plugin is newer than the app on the phone
            raise PhoneAppError(f"this needs a newer Hermes Mobile app ({path[1:]} is missing); ask the user to update it") from e
        raise PhoneAppError(f"the background host answered {e.code}") from e
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


def intent_of(a: dict) -> Optional[dict]:
    """open's way into a screen: `intent` {action, data, type, extras}, or the shorthands `url` (open a link) and
    `share_text` (send text to the app, as its share sheet would). None = the app's first screen."""
    if isinstance(a.get("intent"), dict):
        i = a["intent"]
        out = {k: i[k] for k in ("action", "data", "type") if isinstance(i.get(k), str) and i[k]}
        if isinstance(i.get("extras"), dict):
            out["extras"] = {str(k): v for k, v in i["extras"].items() if isinstance(v, (str, int, float, bool))}
        return out
    if a.get("url"):
        return {"action": "android.intent.action.VIEW", "data": str(a["url"])}
    if a.get("share_text"):
        return {"action": "android.intent.action.SEND", "type": "text/plain",
                "extras": {"android.intent.extra.TEXT": str(a["share_text"])}}
    return None


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

_MORE = {("after", False): "more below", ("before", False): "more above", ("both", False): "more above and below",
         ("after", True): "more to the right", ("before", True): "more to the left", ("both", True): "more both ways"}


def format_elements(els: List[dict]) -> str:
    """One line per element: `[n] role "name"` and its state. Position only for elements with no name (an icon's
    place is the best hint to what it is); a list says which way it scrolls instead. Old hosts send `cls`, not `role`."""
    lines = []
    for e in els:
        bits = [f"[{e['n']}]", e.get("role") or e.get("cls") or "element"]
        name = e.get("text") or e.get("desc") or ""
        if name:
            bits.append(json.dumps(name, ensure_ascii=False))
        if e.get("hint") and e.get("hint") != name:
            bits.append("hint=" + json.dumps(e["hint"], ensure_ascii=False))
        if "checked" in e:
            bits.append("on" if e["checked"] else "off")
        bits += [k for k in ("selected", "focused", "disabled") if e.get(k)]
        more = _MORE.get((e.get("more"), bool(e.get("horizontal"))))
        if more:
            bits.append(f"({more})")
        if not name and not e.get("hint") and not more:
            if e.get("id"):
                bits.append("id=" + e["id"])
            bits.append(f"@{e.get('x')},{e.get('y')}")
        lines.append(" ".join(bits))
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


def _capture(mode: str, after: str = "") -> dict:
    """The screen for the model. after = the action that just ran: if the screen looks exactly as before, say so
    instead of sending the same list again."""
    global _last_view
    want_img = mode in ("vision", "som")
    want_tree = mode in ("ax", "som")
    r = call("/capture", {"tree": want_tree, "image": want_img, "marks": mode == "som", "max_w": 720})
    out: Dict[str, Any] = {"app": _state.get("label")}
    where = " › ".join(x for x in (r.get("screen"), r.get("title")) if x and x != _state.get("label"))
    if where:
        out["screen"] = where
    if r.get("popup"):
        out["popup"] = "a dialog or menu is open: its elements come first"
    if want_tree:
        els = r.get("elements", [])
        _names.clear()
        _names.update({e["n"]: str(e.get("text") or e.get("desc") or e.get("hint") or "") for e in els})
        view = where + "\n" + format_elements(els)
        if after and view == _last_view and not want_img:
            out["screen_changed"] = False
            out["note"] = ("The list stopped moving: this is its end." if after == "scroll" else
                           "Nothing on the screen changed (the elements are as in the last list). It may need more "
                           "time (wait_for, wait_after) or another way.")
            return out
        _last_view = view
        out["elements"] = format_elements(els) or "(nothing readable: try mode='som' for a screenshot)"
    if want_img and r.get("image_b64"):
        out["screenshot_path"] = _save_image(r["image_b64"])
        out["note"] = ("Look at screenshot_path with your vision tool; the numbers drawn on it are the element numbers."
                       if mode == "som" else "Look at screenshot_path with your vision tool.")
    if r.get("black"):
        out["note"] = ("This app hides its screen from pictures (it shows black); use the element list, not "
                       "screenshots.")
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
    global _last_view
    with _lock:
        if not _state or (_state.get("session") and _state["session"] != sid):
            return
        try:
            _request("/close", {}, timeout=5)
        except Exception as e:  # the host is gone or busy: the card must go anyway
            log(f"phone_app end_session close: {type(e).__name__}: {e}")
        _event("done", "Finished")
        _state.clear()
        _last_view = ""


def _event(state: str, action: str = "") -> None:
    if notify is None or not _state:
        return
    try:
        notify("bgapp", _state.get("label", ""), action, _state.get("session", ""), state=state, pkg=_state.get("pkg", ""),
               label=_state.get("label", ""), action=action, port=PORT, token=_token if state != "done" else "")
    except Exception as e:
        log(f"bgapp event failed: {e}")


# ── tool ────────────────────────────────────────────────────────────────────

STEP_ACTIONS = ("tap", "long_press", "set_text", "type", "key", "submit", "toggle", "scroll", "scroll_to", "swipe",
                "wait_for", "wait")

TOOL_SCHEMA = {
    "name": "phone_app",
    "description": (
        "Use an app on the user's phone WITHOUT taking their screen: the app runs on a hidden screen while the user keeps "
        "using the phone. Workflow: action='open' (app name or package; add url, share_text or intent to land on the "
        "right screen at once). Every action answers with the screen's numbered elements (or says nothing changed), so "
        "you rarely need 'capture'. Point at an element by its text with target (\"Save\", \"Search\") or by its number. "
        "Put several actions in one call with steps. Actions return as soon as the screen settles; when something "
        "slow follows (loading, a search, sending), use wait_for with the text you expect, or wait_after. Write a "
        "note when you learn how to do something in an app: it is shown the next time it opens. 'close' when done "
        "(or 'hand_over' to put the app on the user's real screen). The user is asked once per app per chat. Banking, "
        "payment, password and 2FA apps are refused unless the user allowed them in Settings."),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list_apps", "open", "capture", "tap", "long_press", "set_text", "type",
                                                  "key", "submit", "toggle", "scroll", "scroll_to", "swipe", "wait_for",
                                                  "wait", "steps", "note", "hand_over", "close"],
                       "description": "What to do. capture is free (no side effects). submit = the keyboard's Search/Send/Go "
                                      "button of a field (more reliable than key enter). toggle = a switch or checkbox. "
                                      "scroll_to = scroll until target is on screen. wait_for = wait until target shows "
                                      "(or with gone=true, disappears)."},
            "app": {"type": "string", "description": "open: the app's name as shown on the phone, or its package."},
            "url": {"type": "string", "description": "open: a link to open in the app (https:, geo:, tel:, mailto:, an app's deep link)."},
            "share_text": {"type": "string", "description": "open: text to share into the app (a new note, a message draft)."},
            "intent": {"type": "object", "description": "open: an Android intent {action, data, type, extras}, e.g. "
                                                        "{action: 'android.intent.action.INSERT', data: 'content://com.android.calendar/events', "
                                                        "extras: {title: 'Dentist', beginTime: 1767261600000}}. Only intents that open a screen."},
            "target": {"type": "string", "description": "tap/long_press/set_text/submit/toggle/scroll_to/wait_for: the element's text, "
                                                        "label or hint, read fresh from the screen (no capture needed)."},
            "element": {"type": "integer", "description": "The element's number from the last list (instead of target)."},
            "coordinate": {"type": "array", "items": {"type": "integer"}, "description": "tap/long_press: [x, y] on the hidden screen "
                                                                                       "(720x1600). swipe: [x1, y1, x2, y2]."},
            "text": {"type": "string", "description": "set_text: the field's new text (replaces it). type: text added to the focused "
                                                      "field. note: what to remember about this app."},
            "on": {"type": "boolean", "description": "toggle: the state wanted; it is only tapped when not already so."},
            "gone": {"type": "boolean", "description": "wait_for: wait until target is no longer on the screen."},
            "key": {"type": "string", "description": "key: back, enter, del, tab, search, menu, up, down, left, right, space."},
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"], "description": "scroll/scroll_to direction (down = further down the list)."},
            "mode": {"type": "string", "enum": ["ax", "som", "vision"], "description": "capture: ax = element list (default), som = list + "
                                                                                       "screenshot with the numbers drawn on it, vision = screenshot only."},
            "seconds": {"type": "number", "description": "wait: seconds (max 10). wait_for: how long at most (default 8, max 12)."},
            "wait_after": {"type": "number", "description": "Seconds to wait after the action before looking (max 10), when you know "
                                                            "the app is slow to answer it."},
            "steps": {"type": "array", "items": {"type": "object"}, "description": "steps: actions to run in order, each an object with "
                                                                                  "the same fields (action, target, text…): one of "
                                                                                  + ", ".join(STEP_ACTIONS) + ". Stops at the first "
                                                                                  "that fails. The screen is returned once, at the end."},
            "capture_after": {"type": "boolean", "description": "Return the screen after the action (default true; false saves time "
                                                                "when you don't need it)."},
        },
        "required": ["action"],
    },
}

_VERB = {"tap": "Tapping", "long_press": "Long-pressing", "set_text": "Typing", "type": "Typing", "key": "Pressing",
         "submit": "Submitting", "toggle": "Switching", "scroll": "Scrolling", "scroll_to": "Scrolling to",
         "swipe": "Swiping", "capture": "Looking", "wait": "Waiting", "wait_for": "Waiting for", "note": "Noting"}


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
    if act == "steps":
        n = len(a["steps"]) if isinstance(a.get("steps"), list) else 0
        return f"{label}: doing {n} step{'s' if n != 1 else ''}"
    verb = _VERB.get(act, "Using")
    what = ""
    if act in ("set_text", "type") and a.get("text"):
        what = f" “{str(a['text'])[:40]}”"
    elif act == "key" and a.get("key"):
        what = f" {a['key']}"
    elif a.get("target"):
        what = f" “{str(a['target'])[:40]}”"
    elif act in ("tap", "long_press", "toggle") and a.get("element") is not None:
        name = _names.get(int(a["element"]), "") if str(a["element"]).isdigit() else ""
        what = f" “{name[:40]}”" if name else ""
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


def _free_if_stale(sid: str) -> None:
    """Another chat owns the app but has let go: its turn is over (and quiet a while) or it was silent for STALE_S.
    Close the old app so this chat can use the phone. A chat that is still working keeps it."""
    owner = _state.get("session")
    if not _state or not owner or owner == sid:
        return
    age = time.time() - float(_state.get("at") or 0)
    running = True
    if turn_running is not None:
        try:
            running = bool(turn_running(owner))
        except Exception:
            running = True
    if age > STALE_S or (not running and age > STALE_IDLE_S):
        log(f"phone_app: taking over from {owner} (idle {age:.0f}s, turn running={running})")
        end_session(owner)


def _need_open(sid: str) -> None:
    if not _state or not _alive():
        _state.clear()
        raise PhoneAppError("no app is open; use action='open' first")
    if _state.get("session") and sid and _state["session"] != sid:
        raise PhoneAppError(f"another chat is using {_state.get('label')} right now")


def _where(a: dict) -> dict:
    """Which element an action works on, for the host: {n} or {target} (an empty dict = none given)."""
    if a.get("element") is not None:
        return {"n": int(a["element"])}
    if a.get("target"):
        return {"target": str(a["target"])}
    return {}


def _act(act: str, a: dict) -> dict:
    """One action on the open app (no capture). Returns what the host said that the model should know."""
    if act in ("tap", "long_press", "toggle", "scroll_to", "wait_for") and not a.get("target") and a.get("text") \
            and a.get("element") is None and not a.get("coordinate"):
        a = {**a, "target": a["text"]}  # models often write tap(text="Save")
    path = "/" + act
    if act in ("tap", "long_press"):
        body = _where(a)
        if not body:
            c = a.get("coordinate")
            if not (isinstance(c, list) and len(c) == 2):
                raise PhoneAppError(f"{act} needs target (the element's text), element (its number) or coordinate [x, y]")
            body = {"x": int(c[0]), "y": int(c[1])}
    elif act == "set_text":
        body = _where(a)
        if not body:
            raise PhoneAppError("set_text needs target (the field's label or hint) or element (a text field's number)")
        body["text"] = str(a.get("text") or "")
    elif act == "type":
        body = {"text": str(a.get("text") or "")}
    elif act == "key":
        body = {"name": str(a.get("key") or "")}
    elif act == "submit":
        body = _where(a)
    elif act == "toggle":
        body = _where(a)
        if not body:
            raise PhoneAppError("toggle needs target (the switch's label) or element")
        if isinstance(a.get("on"), bool):
            body["on"] = a["on"]
    elif act == "scroll":
        body = {"direction": str(a.get("direction") or "down"), "n": int(a.get("element") or 0)}
    elif act == "scroll_to":
        body = {"target": str(a.get("target") or ""), "direction": str(a.get("direction") or "down")}
    elif act == "wait_for":
        body = {"target": str(a.get("target") or ""), "gone": bool(a.get("gone")), "seconds": float(a.get("seconds") or 8)}
    elif act == "swipe":
        c = a.get("coordinate")
        if not (isinstance(c, list) and len(c) == 4):
            raise PhoneAppError("swipe needs coordinate [x1, y1, x2, y2]")
        body = {"x1": int(c[0]), "y1": int(c[1]), "x2": int(c[2]), "y2": int(c[3])}
    elif act == "wait":
        time.sleep(max(0.0, min(float(a.get("seconds") or 1), 10.0)))
        return {}
    else:
        raise PhoneAppError(f"unknown action {act!r}")
    r = call(path, body)
    _event("act", action_label({**a, "action": act}))
    return {k: r[k] for k in ("via", "target", "checked", "changed", "found", "waited_ms") if k in r and r[k] != ""}


def _wait_after(a: dict) -> None:
    s = a.get("wait_after")
    if isinstance(s, (int, float)) and s > 0:
        time.sleep(min(float(s), 10.0))


def _open(a: dict, sid: str) -> dict:
    global _last_view
    intent = intent_of(a)
    if intent is not None:
        # Which app the link or intent opens decides the approval and the sensitive-app check, not the words used.
        pkg = resolve_app(str(a["app"]))["pkg"] if a.get("app") else ""
        ensure_host()
        r = call("/resolve", {"intent": intent, "pkg": pkg})
        pkg, label = r["pkg"], r.get("label") or r["pkg"]
    else:
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
        return {"ok": False, "action": "open", "error": denied}
    ensure_host()
    r = call("/open", {"pkg": pkg, **({"intent": intent} if intent is not None else {})})
    _state.clear()
    _state.update({"session": sid, "pkg": pkg, "label": r.get("label") or label, "at": time.time()})
    _last_view = ""
    _event("open", f"Opened {_state['label']}")
    out = {"ok": True, "opened": _state["label"], "package": pkg}
    notes = read_notes(pkg)
    if notes:
        out["your_notes_for_this_app"] = notes
    out.update(_capture("ax"))
    return out


def _run(act: str, a: dict, sid: str) -> dict:
    global _last_view
    with _lock:
        _free_if_stale(sid)
        if _state and _state.get("session") == sid:
            _state["at"] = time.time()
        if act == "list_apps":
            return {"ok": True, "apps": [f"{x['label']} ({x['pkg']})" for x in list_apps()]}
        if act == "open":
            return _open(a, sid)
        if act in ("close", "hand_over"):
            if not _state or not _alive():
                _state.clear()
                return {"ok": True, "note": "nothing was open"}
            _need_open(sid)
            call("/" + act, {})
            label = _state.get("label")
            _event("done", "Closed" if act == "close" else "Handed over")
            _state.clear()
            _last_view = ""
            return {"ok": True, ("closed" if act == "close" else "handed_over"): label}
        if act == "note":
            pkg = resolve_app(str(a["app"]))["pkg"] if a.get("app") else _state.get("pkg", "")
            add_note(pkg, str(a.get("text") or ""))
            return {"ok": True, "noted": True}
        if act == "wait" and not _state:
            _act("wait", a)
            return {"ok": True}
        _need_open(sid)
        if act == "capture":
            _event("act", "Looking at the screen")
            return {"ok": True, **_capture(str(a.get("mode") or "ax"))}
        if act == "steps":
            steps = a.get("steps")
            if not isinstance(steps, list) or not steps:
                raise PhoneAppError("steps needs a list of actions")
            if len(steps) > MAX_STEPS:
                raise PhoneAppError(f"at most {MAX_STEPS} steps in one call")
            out: Dict[str, Any] = {"ok": True, "action": "steps"}
            done: List[str] = []
            for i, st in enumerate(steps, 1):
                sa = str(st.get("action") or "") if isinstance(st, dict) else ""
                if sa not in STEP_ACTIONS:
                    out.update({"ok": False, "error": f"step {i}: {sa or '?'} can't be a step (only {', '.join(STEP_ACTIONS)})"})
                    break
                try:
                    r = _act(sa, st)
                    _wait_after(st)
                except PhoneAppError as e:
                    out.update({"ok": False, "error": f"step {i} ({sa}) failed: {e}"})
                    break
                done.append(sa + (f" {json.dumps(r, ensure_ascii=False)}" if r else ""))
            out["done"] = done
            if a.get("capture_after", True) is not False:
                out.update(_capture("ax", after=str(steps[len(done) - 1].get("action")) if done else "steps"))
            return out
        if act not in STEP_ACTIONS:
            raise PhoneAppError(f"unknown action {act!r}")
        out = {"ok": True, "action": act, **_act(act, a)}
        _wait_after(a)
        if a.get("capture_after", act != "wait"):
            out.update(_capture("ax", after=act))
        return out
