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


# ── what Hermes is doing right now (feeds the app's banner) ──

@router.get("/activity")
async def get_activity():
    """Live work reported by the plugin hooks in every Hermes process, including background self-review."""
    import time

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
