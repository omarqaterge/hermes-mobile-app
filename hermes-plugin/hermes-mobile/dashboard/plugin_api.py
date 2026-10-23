"""Dashboard API for the Hermes Mobile app: built-in memory entries (MEMORY.md / USER.md).

Mounted at /api/plugins/hermes-mobile/. Uses Hermes's own MemoryStore so writes take the same
file locks, character limits and threat scanning as the agent's memory tool — and the memory
sync script sees ordinary, canonical files.
"""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


def _home(profile: Optional[str]) -> Path:
    from hermes_constants import get_hermes_home

    base = Path(get_hermes_home())
    # The dashboard may run with a profile HERMES_HOME; profiles live under the default home.
    root = base.parent.parent if base.parent.name == "profiles" else base
    if not profile or profile == "default":
        return root
    if "/" in profile or profile.startswith("."):
        raise HTTPException(status_code=400, detail="bad profile")
    home = root / "profiles" / profile
    if not home.is_dir():
        raise HTTPException(status_code=404, detail="profile not found")
    return home


def _limits(home: Path) -> tuple[int, int]:
    mem, user = 2200, 1375
    try:
        import yaml

        cfg = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) or {}
        m = cfg.get("memory") or {}
        mem = int(m.get("memory_char_limit", mem))
        user = int(m.get("user_char_limit", user))
    except Exception:
        pass
    return mem, user


def _store(profile: Optional[str]):
    from tools.memory_tool_store import MemoryStore

    home = _home(profile)
    mem_limit, user_limit = _limits(home)

    class ProfileMemoryStore(MemoryStore):
        def _path_for(self, target: str) -> Path:  # type: ignore[override]
            return home / "memories" / ("USER.md" if target == "user" else "MEMORY.md")

    store = ProfileMemoryStore(mem_limit, user_limit)
    for target in ("memory", "user"):
        store._set_entries(target, list(dict.fromkeys(store._read_file(store._path_for(target)))))
    return store


def _snapshot(store, target: str) -> dict:
    entries = store._entries_for(target)
    return {
        "target": target,
        "entries": entries,
        "used": store._char_count(target),
        "limit": store._char_limit(target),
    }


@router.get("/memory")
async def get_memory(profile: Optional[str] = None):
    store = _store(profile)
    return {"memory": _snapshot(store, "memory"), "user": _snapshot(store, "user")}


@router.get("/tool-result")
async def get_tool_result(id: str, profile: Optional[str] = None):
    """Stored output of one tool call (resumed transcripts omit it). Read-only, by tool_call_id,
    so it works across compressed/continued session lineages."""
    import sqlite3

    db_path = _home(profile) / "state.db"
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="no session database")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    try:
        row = con.execute(
            "SELECT content, tool_name FROM messages WHERE role = 'tool' AND tool_call_id = ? ORDER BY id DESC LIMIT 1",
            (id,),
        ).fetchone()
    finally:
        con.close()
    if not row:
        raise HTTPException(status_code=404, detail="output not stored")
    content = row[0] if isinstance(row[0], str) else ""
    limit = 60_000
    return {"tool_name": row[1], "content": content[:limit], "truncated": len(content) > limit}


class MemoryEdit(BaseModel):
    action: str  # add | replace | remove
    target: str = "memory"  # memory | user
    content: Optional[str] = None
    old_text: Optional[str] = None


@router.post("/memory")
async def edit_memory(body: MemoryEdit, profile: Optional[str] = None):
    if body.target not in ("memory", "user"):
        raise HTTPException(status_code=400, detail="target must be memory or user")
    store = _store(profile)
    if body.action == "add":
        result = store.add(body.target, body.content or "")
    elif body.action == "replace":
        result = store.replace(body.target, body.old_text or "", body.content or "")
    elif body.action == "remove":
        result = store.remove(body.target, body.old_text or "")
    else:
        raise HTTPException(status_code=400, detail="action must be add, replace or remove")
    fresh = _store(profile)
    return {"result": result, body.target: _snapshot(fresh, body.target)}


# ── Always-on bots (see ../bots.py; the keeper process does the starting/stopping) ──


def _bots():
    import importlib.util

    spec = importlib.util.spec_from_file_location("hermes_mobile_bots", Path(__file__).resolve().parent.parent / "bots.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.ROOT = _home(None)
    mod.STATE = mod.ROOT / "mobile" / "bots.json"
    mod.HEARTBEAT = mod.ROOT / "mobile" / "bots.heartbeat"
    mod.LOG = mod.ROOT / "logs" / "mobile-gateway.log"
    return mod


class BotKeep(BaseModel):
    keep: bool
    restart: bool = False


@router.get("/bots")
async def get_bots():
    return _bots().status()


@router.put("/bots/{name}")
async def put_bot(name: str, body: BotKeep):
    bots = _bots()
    if not bots.valid(name):
        raise HTTPException(status_code=404, detail="profile not found")
    bots.set_keep(name, body.keep, body.restart)
    return bots.status()


@router.get("/bots/log")
async def get_bots_log():
    return {"log": _bots().log_tail()}


# ── approvals from the notification ────────────────────────

class Approve(BaseModel):
    session: str
    key: Optional[str] = None
    choice: str
    request_id: Optional[str] = None
    profile: Optional[str] = None


@router.post("/approve")
async def approve(body: Approve):
    """Answer a pending approval from the app's notification buttons: the same ``approval.respond``
    the gateway offers every client, over this dashboard's own WebSocket."""
    import asyncio
    import json
    import re
    import urllib.request

    import websockets

    if body.choice not in ("once", "session", "always", "deny"):
        raise HTTPException(status_code=400, detail="bad choice")
    if not body.request_id:
        # Without an id Hermes answers the session's oldest waiting approval, which may not be the one shown.
        raise HTTPException(status_code=409, detail="no request id: answer in the app")
    page = await asyncio.to_thread(lambda: urllib.request.urlopen("http://127.0.0.1:9119/", timeout=5).read().decode())
    m = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page)
    if not m:
        raise HTTPException(status_code=503, detail="no dashboard token")
    last = None
    async with websockets.connect(f"ws://127.0.0.1:9119/api/ws?token={m.group(1)}", max_size=None) as ws:
        for n, sid in enumerate(dict.fromkeys(x for x in (body.session, body.key) if x), 1):
            params = {"session_id": sid, "choice": body.choice}
            if body.request_id:
                params["request_id"] = body.request_id
            if body.profile and body.profile != "default":
                params["profile"] = body.profile
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": n, "method": "approval.respond", "params": params}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if msg.get("id") == n:
                    break
            last = msg.get("result") or msg.get("error")
            if (msg.get("result") or {}).get("resolved"):
                return {"resolved": msg["result"]["resolved"]}
    raise HTTPException(status_code=409, detail=f"nothing resolved: {last}")


class Stop(BaseModel):
    session: str


@router.post("/stop")
async def stop(body: Stop):
    """Stop a running turn from the status chip's Stop button: find the live runtime that holds this stored
    chat (``session.active_list``) and send it the same ``session.interrupt`` the app's stop button sends."""
    import asyncio
    import json
    import re
    import urllib.request

    import websockets

    if not body.session:
        raise HTTPException(status_code=400, detail="no session")
    page = await asyncio.to_thread(lambda: urllib.request.urlopen("http://127.0.0.1:9119/", timeout=5).read().decode())
    m = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', page)
    if not m:
        raise HTTPException(status_code=503, detail="no dashboard token")

    async with websockets.connect(f"ws://127.0.0.1:9119/api/ws?token={m.group(1)}", max_size=None) as ws:
        async def call(n, method, params):
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if msg.get("id") == n:
                    return msg

        live = ((await call(1, "session.active_list", {})).get("result") or {}).get("sessions") or []
        rts = [s.get("id") for s in live if body.session in (s.get("session_key"), s.get("id")) and s.get("id")]
        if not rts:
            raise HTTPException(status_code=404, detail="that chat isn't running here")
        for n, rt in enumerate(rts, 2):
            msg = await call(n, "session.interrupt", {"session_id": rt})
            if (msg.get("result") or {}).get("status") == "interrupted":
                return {"interrupted": rt}
    raise HTTPException(status_code=409, detail="not interrupted")


# ── media for the app's players (byte ranges, so video can seek) ──

def parse_range(header: Optional[str], size: int):
    """``Range: bytes=a-b`` → (start, end) inclusive; None = whole file; "bad" = unsatisfiable (416).
    Only single ranges (what media players send)."""
    import re

    m = re.fullmatch(r"\s*bytes=(\d*)-(\d*)\s*", header or "")
    if not m or not (m.group(1) or m.group(2)):
        return None
    if m.group(1):
        start = int(m.group(1))
        end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
    else:
        n = int(m.group(2))
        if n == 0:
            return "bad"
        start, end = max(0, size - n), size - 1
    if start >= size or start > end:
        return "bad"
    return start, end


@router.get("/media")
async def media(path: str, request: Request):
    """A file on the phone, streamed with Range support. The app's WebView reaches it through
    MainActivity.shouldInterceptRequest (which adds the session token), so <video> can seek and nothing
    travels as base64 through the JS bridge."""
    import mimetypes
    import os

    from starlette.responses import Response, StreamingResponse

    p = os.path.realpath(os.path.expanduser(path))
    if not os.path.isfile(p):
        raise HTTPException(status_code=404, detail="not found")
    size = os.path.getsize(p)
    ctype = mimetypes.guess_type(p)[0] or "application/octet-stream"
    rng = parse_range(request.headers.get("range"), size)
    if rng == "bad":
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    start, end = rng if rng else (0, size - 1)
    length = max(0, end - start + 1)

    def body():
        with open(p, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(256 * 1024, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(length), "Cache-Control": "no-store"}
    if rng:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(body(), status_code=206 if rng else 200, media_type=ctype, headers=headers)


# ── battery: Hermes Desktop's file watchers ──
# The dashboard runs the gateway's poll threads, tuned for Hermes Desktop on a laptop: a change watcher
# waking every 0.5 s (pet sprite, pairing, platforms, projects, bot relay outbox…), a display lease
# watcher every 0.5 s and per-chat kanban/bot-mailbox polls every 5 s. Under proot every syscall is
# traced, so on the phone they cost ~2.5 s of CPU a minute even with the app closed. The app only
# listens for `sessions.changed`, so that one stays quick and the rest slow down. The threads read
# these values on every pass from `tui_gateway.server` (bind_module rebinds them there).
_WATCH_EVERY = {"sessions.changed": 2.0, "cron.changed": 5.0}
_WATCH_DEFAULT = 30.0
_POLL_EVERY = {"_LEASE_POLL_S": 5.0, "_KANBAN_POLL_SECONDS": 30.0, "_BOT_DELIVERY_POLL_SECONDS": 30.0}
# Group-chat (hosted room) runtime: its idle fallback poll (5 s) only matters if a write's wakeup() is missed; it
# must stay under the room lease TTL (30 s) it renews.
_ROOM_IDLE_POLL = 25.0
# Each live chat has a notification poller blocking on the process-wide completion queue with a 0.5 s timeout
# (the app keeps up to 3 chats live). A put still wakes it at once; /loop checks run every 5 s regardless.
_NOTIF_QUEUE_WAIT = 2.5
_watchers_slowed = False
_extras_slowed = set()


def slow_desktop_watchers(server=None) -> dict:
    """Raise the poll intervals (never lowers one). Returns what changed; {} once done or not loaded yet."""
    global _watchers_slowed
    if server is None:
        if _watchers_slowed:
            return {}
        import sys

        server = sys.modules.get("tui_gateway.server")  # never import it: that's Hermes's call to make
        if server is None:
            return {}
    changed = {}
    watches = getattr(server, "_CHANGE_WATCHES", None)
    if isinstance(watches, dict):
        for event, spec in list(watches.items()):
            want = _WATCH_EVERY.get(event, _WATCH_DEFAULT)
            if isinstance(spec, tuple) and spec and isinstance(spec[0], (int, float)) and spec[0] < want:
                watches[event] = (want, *spec[1:])
                changed[event] = want
    for name, want in _POLL_EVERY.items():
        v = getattr(server, name, None)
        if isinstance(v, (int, float)) and v < want:
            setattr(server, name, want)
            changed[name] = want
    # The watcher loop also checks the Desktop skin on every 0.5 s wake; the app has no skins.
    skin = getattr(server, "_broadcast_skin_if_changed", None)
    if callable(skin) and not getattr(skin, "_hm_slow", False):
        import time

        last = [0.0]

        def slow_skin():
            if time.monotonic() - last[0] >= _WATCH_DEFAULT:
                last[0] = time.monotonic()
                skin()

        slow_skin._hm_slow = True
        server._broadcast_skin_if_changed = slow_skin
        changed["skin"] = _WATCH_DEFAULT
    _watchers_slowed = True
    if changed:
        import logging

        logging.getLogger("hermes_mobile").info("battery: slowed desktop watchers %s", changed)
    return changed


def slow_background_polls(groups=None, registry=None) -> dict:
    """The group-chat runtime and the per-chat notification pollers (see above). Each part runs once, when its
    module is loaded; returns what changed."""
    import sys

    changed = {}
    if "room" not in _extras_slowed:
        groups = groups or sys.modules.get("tui_gateway.methods_groups")
        runtime = getattr(getattr(groups, "_service", None), "runtime", None)
        v = getattr(runtime, "poll_interval_seconds", None)
        if isinstance(v, (int, float)):
            if v < _ROOM_IDLE_POLL and getattr(runtime, "lease_ttl_seconds", 30.0) > _ROOM_IDLE_POLL:
                runtime.poll_interval_seconds = _ROOM_IDLE_POLL
                changed["room"] = _ROOM_IDLE_POLL
            _extras_slowed.add("room")
    if "notif" not in _extras_slowed:
        if registry is None:
            mod = sys.modules.get("tools.process_registry")
            registry = getattr(mod, "process_registry", None)
        q = getattr(registry, "completion_queue", None)
        if q is not None and callable(getattr(q, "get", None)):
            plain = type(q).get

            def get(block=True, timeout=None, _q=q, _get=plain):
                if block and timeout is not None and 0 < timeout < _NOTIF_QUEUE_WAIT:
                    timeout = _NOTIF_QUEUE_WAIT  # only the pollers' short sleep; a put wakes it at once
                return _get(_q, block, timeout)

            get._hm_slow = True
            if not getattr(q.get, "_hm_slow", False):
                q.get = get
                changed["notif"] = _NOTIF_QUEUE_WAIT
            _extras_slowed.add("notif")
    if changed:
        import logging

        logging.getLogger("hermes_mobile").info("battery: slowed background polls %s", changed)
    return changed


_slow_failed = False


def _slow_all() -> None:
    global _slow_failed
    try:
        slow_desktop_watchers()
        slow_background_polls()
    except Exception:
        if not _slow_failed:  # say it once; the dashboard works the same without these
            _slow_failed = True
            import logging

            logging.getLogger("hermes_mobile").exception("battery: slowing background polls failed")


_slow_all()


# ── what Hermes is doing right now (feeds the app's banner) ──

@router.get("/activity")
async def get_activity():
    """Live work reported by the plugin hooks in every Hermes process, including background self-review."""
    import time

    _slow_all()  # in case the gateway (or a chat's poller) loaded after this module

    path = Path.home() / ".hermes" / "mobile" / "activity.json"
    try:
        data = json.loads(path.read_text())
    except Exception:
        return {"items": []}
    now = time.time()
    items = []
    for pid, entry in data.items():
        if now - entry.get("at", 0) > 300:
            continue
        # A Hermes process that died mid-turn (killed, restarted) can't report "done": drop its entries.
        if str(pid).isdigit() and not Path("/proc", str(pid)).exists():
            continue
        for it in entry.get("items", []):
            limit = 60 if it.get("review") else 180
            if now - it.get("ts", 0) <= limit:
                items.append(it)
    items.sort(key=lambda i: i.get("ts", 0), reverse=True)
    return {"items": items}


# ── what of the phone Hermes can reach (the app's Setup check) ──

_RISH = Path("/data/data/com.termux/files/home/bin/rish")  # Shizuku's shell, put there by the installer
_phone_cache: dict = {}


def phone_access_now() -> dict:
    """files: /sdcard is readable here (only a Hermes started after Termux got the permission sees it).
    termux_api: a termux-* command answers (needs the Termux:API app). shizuku: ok | off (not running) |
    denied (Termux not allowed in Shizuku) | blocked (the Shizuku app doesn't answer: missing or battery-restricted) |
    missing (no rish: the installer didn't set it up)."""
    import shutil
    import subprocess

    try:
        files = any(True for _ in Path("/sdcard").iterdir())
    except Exception:
        files = False
    api = False
    cmd = shutil.which("termux-battery-status") or "/usr/local/bin/termux-battery-status"
    if Path(cmd).exists():
        try:
            out = subprocess.run([cmd], capture_output=True, text=True, timeout=10).stdout
            api = "percentage" in out
        except Exception:
            pass
    shizuku = "missing"
    if _RISH.exists():
        try:
            # A first call makes Shizuku ask whether Termux may use it; rish waits for the answer. A Shizuku app frozen
            # in the background can miss the first request ("Request timeout"): one retry.
            text = ""
            for _ in range(2):
                r = subprocess.run([str(_RISH), "-c", "id"], capture_output=True, text=True, timeout=20)
                text = r.stdout + r.stderr
                if "Request timeout" not in text:
                    break
            shizuku = ("ok" if "uid=2000" in text else "denied" if "Permission denied" in text
                       else "blocked" if "Request timeout" in text else "off")
        except subprocess.TimeoutExpired:
            shizuku = "denied"  # still waiting on Shizuku's prompt
        except Exception:
            shizuku = "off"
    return {"files": files, "termux_api": api, "shizuku": shizuku}


@router.get("/phone-access")
async def phone_access():
    """Runs two short commands; cached 15 s, since the Setup screen asks every few seconds while it is open."""
    import asyncio
    import time

    now = time.monotonic()
    if _phone_cache.get("v") is not None and now - _phone_cache.get("t", 0) < 15:
        return _phone_cache["v"]
    v = await asyncio.to_thread(phone_access_now)
    _phone_cache.update(v=v, t=time.monotonic())
    return v


# ── app preferences that should follow the user across installs (pins + custom chat order) ──

_PREFS = Path.home() / ".hermes" / "mobile" / "prefs.json"


def _read_prefs() -> dict:
    try:
        return json.loads(_PREFS.read_text())
    except Exception:
        return {}


class OrderPrefs(BaseModel):
    pinned: list[str] = []
    manual: Optional[list[str]] = None
    at: int = 0  # client clock, ms: newest wins


@router.post("/refresh-logins")
async def refresh_logins():
    """Refresh an expired Claude-subscription token so the model picker can ask Anthropic for the live list.
    Hermes's own list fetch is read-only and never refreshes (only a real Claude request does), so after a day on
    another model the token is stale, the fetch 401s and the picker falls back to Hermes's built-in (older) list."""
    import asyncio

    def work() -> dict:
        try:
            from agent.credential_pool import load_pool

            available, _pending = load_pool("anthropic")._available_entries(clear_expired=True, refresh=True)
            return {"ok": True, "anthropic": len(available)}
        except Exception as e:  # no Anthropic login, or Hermes changed its internals: the picker just shows what it can
            return {"ok": False, "error": str(e)[:200]}

    return await asyncio.to_thread(work)


@router.get("/prefs")
async def get_prefs(profile: Optional[str] = None):
    return {"order": _read_prefs().get(profile or "default", {}).get("order")}


@router.put("/prefs")
async def put_prefs(body: OrderPrefs, profile: Optional[str] = None):
    data = _read_prefs()
    key = profile or "default"
    cur = data.get(key, {}).get("order") or {}
    if body.at >= int(cur.get("at", 0)):
        data[key] = {"order": body.model_dump()}
        _PREFS.parent.mkdir(parents=True, exist_ok=True)
        tmp = _PREFS.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(_PREFS)
    return {"order": data.get(key, {}).get("order")}


# ── background apps (the phone_app tool's settings) ──

def _phone_app_mod():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_phone_app")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_phone_app", Path(__file__).resolve().parent.parent / "phone_app.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_phone_app"] = mod
        spec.loader.exec_module(mod)
    return mod


class BgAppPrefs(BaseModel):
    allow_sensitive: bool = False


@router.get("/bgapps")
async def bgapps_get():
    m = _phone_app_mod()
    ok, why = m.availability()
    out = {"allow_sensitive": bool(m.read_prefs().get("allow_sensitive")), "available": ok}
    if why:
        out["reason"] = why
    return out


@router.put("/bgapps")
async def bgapps_put(body: BgAppPrefs):
    m = _phone_app_mod()
    d = m.write_prefs(body.allow_sensitive)
    ok, why = m.availability()
    out = {"allow_sensitive": bool(d.get("allow_sensitive")), "available": ok}
    if why:
        out["reason"] = why
    return out


# ── cards in replies (OpenUI): on/off for new chats ──

def _openui_mod():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_openui")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_openui", Path(__file__).resolve().parent.parent / "openui.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_openui"] = mod
        spec.loader.exec_module(mod)
    return mod


class OpenUIPrefs(BaseModel):
    enabled: bool = True


@router.get("/openui")
async def openui_get():
    return {"enabled": _openui_mod().enabled()}


@router.put("/openui")
async def openui_put(body: OpenUIPrefs):
    return {"enabled": _openui_mod().set_enabled(body.enabled)}


# ── Auto access (the app's Auto button; which chats block Hermes's dangerous-command list under /yolo) ──

def _auto_mod():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_auto_mode")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_auto_mode", Path(__file__).resolve().parent.parent / "auto_mode.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_auto_mode"] = mod
        spec.loader.exec_module(mod)
    return mod


class AutoMode(BaseModel):
    session: str
    mode: str = ""


@router.get("/auto")
async def auto_get(session: str = ""):
    return {"session": session, "mode": _auto_mod().mode_of(session)}


@router.put("/auto")
async def auto_put(body: AutoMode):
    try:
        mode = _auto_mod().set_mode(body.session, body.mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"session": body.session, "mode": mode}


# ── canvas (documents shared by Hermes and the user, per chat) ──

def _canvas():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_canvas")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_canvas", Path(__file__).resolve().parent.parent / "canvas.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_canvas"] = mod
        spec.loader.exec_module(mod)
    return mod


def _cv(fn, *a, **k):
    """Run a canvas call, turning its errors into HTTP errors (409 for edit conflicts)."""
    c = _canvas()
    try:
        return fn(c)(*a, **k)
    except c.CanvasError as e:
        msg = str(e)
        raise HTTPException(status_code=409 if msg.startswith("conflict") else 400, detail=msg)


class CanvasCreate(BaseModel):
    session: str
    title: str = "Untitled"
    content: str = ""
    type: str = ""
    lang: str = ""


class CanvasWrite(BaseModel):
    session: str
    id: str
    content: str
    base_rev: Optional[int] = None
    title: str = ""
    type: str = ""
    lang: str = ""
    note: str = ""


class CanvasRef(BaseModel):
    session: str
    id: str = ""
    rev: int = 0
    title: str = ""
    path: str = ""


@router.get("/canvas")
async def canvas_list(session: str):
    return {"docs": _canvas().list_docs(session)}


@router.get("/canvas/doc")
async def canvas_get(session: str, id: str):
    return _cv(lambda c: c.get, session, id)


@router.get("/canvas/version")
async def canvas_version(session: str, id: str, rev: int):
    return _cv(lambda c: c.get_version, session, id, rev)


@router.post("/canvas/doc")
async def canvas_create(body: CanvasCreate):
    return _cv(lambda c: c.create, body.session, body.title, body.content, body.type, body.lang, by="user")


@router.put("/canvas/doc")
async def canvas_write(body: CanvasWrite):
    return _cv(lambda c: c.write, body.session, body.id, body.content, by="user", note=body.note, base_rev=body.base_rev,
               title=body.title, type=body.type, lang=body.lang)


@router.post("/canvas/restore")
async def canvas_restore(body: CanvasRef):
    return _cv(lambda c: c.restore, body.session, body.id, body.rev, by="user")


@router.post("/canvas/rename")
async def canvas_rename(body: CanvasRef):
    return _cv(lambda c: c.rename, body.session, body.id, body.title)


@router.post("/canvas/open-file")
async def canvas_open_file(body: CanvasRef):
    return _cv(lambda c: c.open_file, body.session, body.path, by="user")


@router.post("/canvas/save-file")
async def canvas_save_file(body: CanvasRef):
    return _cv(lambda c: c.save_file, body.session, body.id)


@router.delete("/canvas/doc")
async def canvas_delete(session: str, id: str):
    _cv(lambda c: c.delete, session, id)
    return {"ok": True}


# ── canvas gallery (every chat's canvas documents in one list, by type, searchable, with their chat) ──

def _gallery():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_gallery")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_gallery", Path(__file__).resolve().parent.parent / "gallery.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_gallery"] = mod
        spec.loader.exec_module(mod)
    return mod


@router.get("/gallery")
def gallery_list(q: str = ""):
    """Every chat's canvas documents by type; `q` searches titles and text."""
    return _gallery().list_all(q)


# ── library (saved copies from older app versions; the gallery lists them, nothing new is saved) ──

def _library():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_library")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_library", Path(__file__).resolve().parent.parent / "library.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_library"] = mod
        spec.loader.exec_module(mod)
    return mod


def _lb(fn, *a, **k):
    """Run a library call, turning its errors into HTTP 400s."""
    lib = _library()
    try:
        return fn(lib)(*a, **k)
    except lib.LibraryError as e:
        raise HTTPException(status_code=400, detail=str(e))


class LibrarySave(BaseModel):
    session: str
    id: str
    category: str = ""


class LibraryUpdate(BaseModel):
    id: str
    title: str = ""
    category: str = ""


@router.get("/library")
async def library_list():
    lib = _library()
    return {"items": lib.list_items(), "categories": lib.categories()}


@router.get("/library/item")
async def library_get(id: str):
    return _lb(lambda lib: lib.get, id)


@router.post("/library")
async def library_save(body: LibrarySave):
    doc = _cv(lambda c: c.get, body.session, body.id, with_versions=False)
    return _lb(lambda lib: lib.save, doc, body.category, body.session)


@router.put("/library/item")
async def library_update(body: LibraryUpdate):
    return _lb(lambda lib: lib.update, body.id, body.title, body.category)


@router.delete("/library/item")
async def library_delete(id: str):
    _lb(lambda lib: lib.delete, id)
    return {"ok": True}


def _chat_search():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_chat_search")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_chat_search", Path(__file__).resolve().parent.parent / "chat_search.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_chat_search"] = mod
        spec.loader.exec_module(mod)
    return mod


class CleanupBody(BaseModel):
    keep: list[str] = []


@router.post("/cleanup")
def cleanup(body: Optional[CleanupBody] = None, dry_run: bool = False):
    """Delete uploads (photos, attached files) and canvas folders that no existing chat uses.
    The app calls this after deleting a chat, with `keep` = names attached in its composer.
    Uploads newer than 15 min are always kept."""
    try:
        return _chat_search().cleanup(dry_run=dry_run, keep=(body.keep if body else []))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


# ── file checkpoints per chat (snapshots Hermes takes before write_file / patch) ──

def _checkpoints():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_checkpoints")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_checkpoints", Path(__file__).resolve().parent.parent / "checkpoints.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_checkpoints"] = mod
        spec.loader.exec_module(mod)
    return mod


def _snapshot_of(session: str, workdir: str, snap: str):
    try:
        found = _checkpoints().find(session, workdir, snap)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not found:
        raise HTTPException(status_code=404, detail="This snapshot is gone (Hermes keeps 20 per folder).")
    return found


@router.get("/checkpoints")
def checkpoints_list(session: str):
    """The chat's snapshots, grouped by the folder Hermes snapshotted (newest first)."""
    try:
        return _checkpoints().list_for_session(session)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/checkpoints/diff")
def checkpoints_diff(session: str, workdir: str, snap: str):
    base, wd, commit, _ = _snapshot_of(session, workdir, snap)
    r = _checkpoints().diff(base, wd, commit)
    if "error" in r:
        raise HTTPException(status_code=409, detail=r["error"])
    return r


class CheckpointRestore(BaseModel):
    session: str
    workdir: str
    snap: str
    file: str = ""


@router.post("/checkpoints/restore")
def checkpoints_restore(body: CheckpointRestore):
    base, wd, commit, files = _snapshot_of(body.session, body.workdir, body.snap)
    if body.file and body.file not in files:
        raise HTTPException(status_code=400, detail="This chat didn't edit that file in this snapshot.")
    r = _checkpoints().restore(base, wd, commit, body.file, session=body.session)
    if "error" in r:
        raise HTTPException(status_code=409, detail=r["error"])
    return r


@router.delete("/checkpoints")
def checkpoints_forget(session: str):
    """Forget a deleted chat's list (Hermes's folder snapshots stay for other chats)."""
    try:
        _checkpoints().delete_ledger(session)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


# ── live data in cards (OpenUI Query): read-only, allow-listed tools (openui_tools.json) ──

def _openui_query_mod():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_openui_query")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_openui_query", Path(__file__).resolve().parent.parent / "openui_query.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_openui_query"] = mod
        spec.loader.exec_module(mod)
    return mod


class OpenUICall(BaseModel):
    name: str
    args: dict = {}


@router.post("/openui/call")
async def openui_call(body: OpenUICall):
    """A card's Query(): 403 for a tool not on the list, 504 after 30 s, 502 when the tool itself failed."""
    import asyncio

    m = _openui_query_mod()
    try:
        return await asyncio.wait_for(asyncio.to_thread(m.call_tool, body.name, body.args), timeout=30)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="timed out")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])


# ── Claude (Pro/Max) sign-in in the app's own UI: the PKCE login `hermes auth add anthropic` runs in a terminal,
# as two calls (claude_login.py). Saved to the ?profile= profile's credential pool; tokens are never returned. ──


def _claude_login_mod():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_claude_login")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_claude_login", Path(__file__).resolve().parent.parent / "claude_login.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_claude_login"] = mod
        spec.loader.exec_module(mod)
    return mod


async def _in_profile(profile: Optional[str], fn):
    """Run fn on a worker thread inside the profile's home + secret scope, like Hermes's own credential routes."""
    try:
        from hermes_cli.web_routers._common import config_scoped_to_thread
    except Exception:  # older Hermes: the plugin route's own ?profile= scope still applies (copied into the thread)
        import asyncio

        return await asyncio.to_thread(fn)
    return await config_scoped_to_thread(profile, fn)


class ClaudeFinish(BaseModel):
    session_id: str
    code: str


@router.post("/claude-login/start")
async def claude_login_start(profile: Optional[str] = None):
    m = _claude_login_mod()
    try:
        return await _in_profile(profile, lambda: m.start(profile))
    except Exception as e:  # Hermes moved its helpers: the app falls back to Termux
        raise HTTPException(status_code=501, detail=f"In-app Claude sign-in isn't available with this Hermes ({str(e)[:120]})")


@router.post("/claude-login/finish")
async def claude_login_finish(body: ClaudeFinish, profile: Optional[str] = None):
    m = _claude_login_mod()
    try:
        return await _in_profile(profile, lambda: m.finish(body.session_id, body.code, profile))
    except m.LoginError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Saving the Claude login failed ({type(e).__name__})")


@router.post("/claude-login/cancel")
async def claude_login_cancel(body: dict):
    return {"ok": _claude_login_mod().cancel(str((body or {}).get("session_id") or ""))}
