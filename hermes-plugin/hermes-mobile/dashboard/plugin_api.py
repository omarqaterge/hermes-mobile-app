"""Dashboard API for the Hermux app: built-in memory entries (MEMORY.md / USER.md).

Mounted at /api/plugins/hermes-mobile/. Uses Hermes's own MemoryStore so writes take the same
file locks, character limits and threat scanning as the agent's memory tool — and the memory
sync script sees ordinary, canonical files.
"""

import hmac
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()
_log = logging.getLogger(__name__)

# ── who may read the dashboard's session token ──
# Hermes puts its session token into every page it serves, which is fine on a computer. On Android every app shares
# 127.0.0.1, so any installed app with internet access could read that page and then drive Hermes. Pages keep the token
# only for a caller holding the app's event key (a file only Termux's user can read); everyone else gets a page saying
# it was withheld. This lives in the plugin, not in a Hermes patch, because the plugin follows every app update.
#
# Local authentication (local_auth.py): the guard also answers GET /hermux/hello (a proof that it holds the key, over the
# caller's nonce and the address it listens on) and GET /hermux/token (the session token, for a request signed with the
# key over the hello's nonces, with a proof over the token), and adds X-Hermux-Proof to the answer of any /api/ request
# that sends X-Hermux-Nonce. Both routes are answered here, before Hermes, so they need no session token. Pages keep
# the token for the raw key only until ~/.hermes-mobile/enforced exists (the app writes it when it ends the
# compatibility window); after that the raw key gets the withheld page and is reported once a day.
_TERMUX_HOME = "/data/data/com.termux/files/home"
_KEY_HEADER = "X-Hermes-Mobile-Key"
_PAGE_TOKEN = re.compile(rb"window\.__HERMES_SESSION_TOKEN__\s*=\s*[^;<]*;")
_WITHHELD = b"window.__HERMUX_TOKEN_WITHHELD__=1;"
_HELLO_PATH = "/hermux/hello"
_TOKEN_PATH = "/hermux/token"
_AUTH_HEADER = b"x-hermux-auth"
_NONCE_HEADER = b"x-hermux-nonce"
_PROOF_HEADER = b"x-hermux-proof"
_MAX_LOCAL_BODY = 4096  # a token request has no body; anything larger is refused unread
_MAX_PAGE = 4 << 20  # the page rendered to find the token, when Hermes keeps it nowhere else
_TOKEN_TEXT = re.compile(r"[\x21-\x7e]{1,512}")
_PAGE_TOKEN_VALUE = re.compile(rb'__HERMES_SESSION_TOKEN__\s*=\s*"([^"\\<]{1,512})"')


def _key_file() -> Optional[Path]:
    """The event key's file, or None off a phone, where loopback isn't shared and nothing needs withholding."""
    override = os.environ.get("HM_DASH_KEY_FILE")  # the contract check's throwaway Hermes
    if override:
        return Path(override)
    return Path(_TERMUX_HOME, ".hermes-mobile", "key") if os.path.isdir(_TERMUX_HOME) else None


def _enforced() -> bool:
    """The app has switched the raw key off: ~/.hermes-mobile/enforced (next to the key file) exists."""
    path = _key_file()
    return path is not None and path.with_name("enforced").exists()


_legacy_daily = None


def _note_legacy() -> bool:
    """The raw key reached the page after the switch (the token was withheld): at most once a day in this process, the
    diagnostic event `local legacy_key port=dashboard side=plugin` and a signed `local_legacy` event to the app
    (``local_auth.report_legacy``, on a thread of its own), which then replaces the key. True when it was due."""
    global _legacy_daily
    la = _local_auth()
    if la is None:
        return False
    if _legacy_daily is None:
        _legacy_daily = la.Daily()
    if not _legacy_daily.due():
        return False
    try:
        _diag_mod().event("local", "legacy_key", port="dashboard", side="plugin")
    except Exception:
        pass
    key = _event_key()
    if key:
        import threading

        threading.Thread(target=_report_legacy, args=(la, key), daemon=True).start()
    return True


def _report_legacy(la, key: str) -> None:
    la.report_legacy("dashboard", key)


def _local_auth():
    """The plugin's local_auth.py (one folder up), or None when it can't be loaded: then the hello routes answer 503 and
    everything else works as before."""
    import importlib.util

    mod = sys.modules.get("hm_local_auth")
    if mod is None:
        try:
            spec = importlib.util.spec_from_file_location("hm_local_auth", Path(__file__).resolve().parent.parent / "local_auth.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        except Exception:
            return None
        sys.modules["hm_local_auth"] = mod
    return mod


_key_reader = None


def _event_key() -> str:
    """The event key, read again only when its file changes (local_auth.KeyFile: inode, mtime in ns and size; an empty
    file is never kept). Every request reads it, so a new key counts at once."""
    global _key_reader
    la = _local_auth()
    if la is None:
        path = _key_file()
        try:
            return path.read_text().strip() if path else ""
        except OSError:
            return ""
    if _key_reader is None:
        _key_reader = la.KeyFile(_key_file)
    return _key_reader.read()


def _session_token() -> str:
    """Hermes's session token, taken in process: the pinned Hermes keeps it in hermes_cli.web_server._SESSION_TOKEN
    (read at every call: Hermes may replace it). "" when it isn't there."""
    tok = getattr(sys.modules.get("hermes_cli.web_server"), "_SESSION_TOKEN", None)
    return tok if isinstance(tok, str) and _TOKEN_TEXT.fullmatch(tok) else ""


def _one_header(scope, name: bytes):
    """A request header's value when it is there exactly once, else None (twice is ambiguous: not used)."""
    found = [v for k, v in (scope.get("headers") or []) if k.lower() == name]
    return found[0] if len(found) == 1 else None


async def _answer(send, status: int, obj: dict, extra=()) -> None:
    body = json.dumps(obj, separators=(",", ":")).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
               (b"cache-control", b"no-store"), *extra]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


async def _read_body(receive, limit: int):
    """The request body, or None when it is larger than ``limit`` or the client went away."""
    body = b""
    while True:
        message = await receive()
        if message.get("type") != "http.request":
            return None
        body += message.get("body", b"")
        if len(body) > limit:
            return None
        if not message.get("more_body"):
            return body


def _hello_nonce(la, query: bytes):
    """``(nc, kid hint)`` of ``v=1&nc=<nonce>[&kid=<kid>]`` (``local_auth.hello_args``: each once, nothing else; a
    malformed hint counts as absent), else None."""
    return la.hello_args(query)


class _TokenGuard:
    """ASGI middleware: takes the session token out of HTML pages unless the request carries the event key (and the
    raw key is not switched off yet), and answers local authentication's hello and token routes itself."""

    def __init__(self, app):
        self.app = app
        la = _local_auth()
        self._pending = la.PendingHellos() if la is not None else None

    def _allowed(self, scope) -> bool:
        """The page may keep its token: off a phone, or for the raw key before the switch. The raw key after it is
        refused like any other caller and reported (``_note_legacy``)."""
        path = _key_file()
        if path is None:
            return True
        key = _event_key().encode()
        given = dict(scope.get("headers") or []).get(_KEY_HEADER.lower().encode(), b"")
        if not (key and hmac.compare_digest(given, key)):
            return False
        if _enforced():
            _note_legacy()
            return False
        return True

    @staticmethod
    def _addr(la, scope):
        """This server's own address as the proof names it (from the connection, not from anything the client sent)."""
        server = scope.get("server")
        if not isinstance(server, (tuple, list)) or len(server) != 2:
            return None
        return la.server_addr(server[0], server[1])

    def _proving(self, scope, send):
        """``send``, adding X-Hermux-Proof (``1 <kid> <proof over the nonce, this address and the status>``) to the answer
        when the request sent a well-formed X-Hermux-Nonce. Only the start of the answer is touched: bodies stream as
        before."""
        nc = _one_header(scope, _NONCE_HEADER)
        la = _local_auth() if nc is not None else None
        where = self._addr(la, scope) if la is not None else None
        if where is None:
            return send
        try:
            nc = nc.decode("ascii").strip(" \t")
            key = _event_key()
            kid = la.kid(key)
        except (UnicodeDecodeError, ValueError):
            return send
        if not la.is_nonce(nc):
            return send

        async def proving(message):
            if message.get("type") == "http.response.start":
                try:
                    proof = la.answer_proof(key, "dashboard", where, nc, la.NO_NONCE, f"rest {int(message['status'])}")
                except (ValueError, KeyError, TypeError):
                    return await send(message)
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != _PROOF_HEADER]
                headers.append((_PROOF_HEADER, f"1 {kid} {proof}".encode()))
                message = {**message, "headers": headers}
            await send(message)

        return proving

    async def _page_token(self, scope) -> str:
        """The session token from the page Hermes serves at /, rendered here without leaving the process: only when
        Hermes keeps it in no module variable this file knows."""
        host = _one_header(scope, b"host") or b"127.0.0.1"
        sub = {**scope, "method": "GET", "path": "/", "raw_path": b"/", "query_string": b"", "headers": [(b"host", host)]}
        status, chunks, size = [0], [], [0]
        sent = [False]

        async def receive():
            if not sent[0]:
                sent[0] = True
                return {"type": "http.request", "body": b"", "more_body": False}
            return {"type": "http.disconnect"}

        async def collect(message):
            if message.get("type") == "http.response.start":
                status[0] = int(message.get("status", 0))
            elif message.get("type") == "http.response.body" and size[0] <= _MAX_PAGE:
                b = message.get("body", b"")
                size[0] += len(b)
                chunks.append(b)

        try:
            await self.app(sub, receive, collect)
        except Exception:
            return ""
        if status[0] != 200 or size[0] > _MAX_PAGE:
            return ""
        m = _PAGE_TOKEN_VALUE.search(b"".join(chunks))
        tok = m.group(1).decode("ascii", "replace") if m else ""
        return tok if _TOKEN_TEXT.fullmatch(tok) else ""

    async def _local(self, scope, receive, send):
        """GET /hermux/hello and GET /hermux/token (local authentication), answered here and never passed to Hermes."""
        if scope.get("method") != "GET":
            return await _answer(send, 405, {"hermux": 1, "error": "method"}, [(b"allow", b"GET")])
        la = _local_auth()
        where = self._addr(la, scope) if la is not None else None
        key = _event_key()
        try:
            kid = la.kid(key) if where is not None and self._pending is not None else None
        except ValueError:
            kid = None
        if kid is None:  # no key to prove with, or not reached on 127.0.0.1
            return await _answer(send, 503, {"hermux": 1, "error": "unavailable"})
        if scope["path"] == _HELLO_PATH:
            args = _hello_nonce(la, scope.get("query_string") or b"")
            if args is None:
                return await _answer(send, 400, {"hermux": 1, "error": "bad_request"})
            nc, hint = args
            key = la.hello_key([key], hint)  # the key file holds one key: a hint for any other is ignored
            ns, j = la.hello_answer(key, "dashboard", where, nc)
            self._pending.add(ns, nc, kid, where)
            return await _answer(send, 200, j)
        refused = {"hermux": 1, "error": "refused"}
        auth = la.parse_auth(_one_header(scope, _AUTH_HEADER), with_nc=True)
        if auth is None:
            return await _answer(send, 403, refused)
        a_kid, ns, nc, given = auth
        pending = self._pending.take(ns)  # used up here, whatever the request proves
        body = await _read_body(receive, _MAX_LOCAL_BODY)
        if body is None:
            return await _answer(send, 413, {"hermux": 1, "error": "too_large"})
        if pending is None:
            return await _answer(send, 403, refused)
        p_nc, p_kid, p_where = pending
        query = scope.get("query_string") or b""
        target = (scope.get("raw_path") or scope["path"].encode()).decode("latin-1") + ("?" + query.decode("latin-1") if query else "")
        if not (la.same(p_nc, nc) and la.same(p_kid, a_kid) and la.same(a_kid, kid) and p_where == where
                and la.request_ok(key, "dashboard", where, nc, ns, "GET", target, body, given)):
            return await _answer(send, 403, refused)
        token = _session_token() or await self._page_token(scope)
        if not token:
            return await _answer(send, 503, {"hermux": 1, "error": "unavailable"})
        proof = la.answer_proof(key, "dashboard", where, nc, ns, "token", token.encode())
        return await _answer(send, 200, {"hermux": 1, "token": token, "proof": proof})

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] in (_HELLO_PATH, _TOKEN_PATH):
            return await self._local(scope, receive, send)
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            return await self.app(scope, receive, self._proving(scope, send))
        if scope["type"] != "http" or self._allowed(scope):
            return await self.app(scope, receive, send)
        start = None
        body = []

        async def guarded(message):
            nonlocal start
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers") or [])
                if not headers.get(b"content-type", b"").startswith(b"text/html"):
                    return await send(message)
                start = message
                return
            if start is None:
                return await send(message)
            body.append(message.get("body", b""))
            if message.get("more_body"):
                return
            html = _PAGE_TOKEN.sub(_WITHHELD, b"".join(body))
            headers = [(k, v) for k, v in start.get("headers", []) if k != b"content-length"]
            headers.append((b"content-length", str(len(html)).encode()))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": html})

        await self.app(scope, receive, guarded)


def _install_token_guard() -> None:
    """Runs when the dashboard imports this file, before its server starts. Without the guard, pages stay as Hermes
    serves them, so say so in the log: tools/hermes-contract fails if the pinned Hermes ever stops allowing this."""
    server = sys.modules.get("hermes_cli.web_server")
    app = getattr(server, "app", None)
    if app is None or any(getattr(m.cls, "__name__", "") == "_TokenGuard" for m in app.user_middleware):
        return
    try:
        app.add_middleware(_TokenGuard)
    except Exception as e:
        _log.error("hermes-mobile: session token guard not installed: %s", e)


_install_token_guard()


def _own_port(request) -> int:
    """The port of the dashboard that received ``request``: this very process. Its own WebSocket goes there."""
    server = getattr(request, "scope", {}).get("server") if request is not None else None
    if isinstance(server, (tuple, list)) and len(server) == 2 and server[0] == "127.0.0.1" \
            and isinstance(server[1], int) and 1 <= server[1] <= 65535:
        return server[1]
    return 9119


def _own_page_token(port: int = 9119) -> str:
    """The session token for the plugin's own calls to the gateway (/approve, /stop). Taken in process: this is the
    dashboard's own process (``_session_token``). Only if Hermes keeps it nowhere this file knows, from a verified
    dashboard on ``port`` (``local_auth.dashboard_token``: the hello, the signed token request and the proof over the
    answer); the key itself is never sent. "" when neither works. Blocking: call it in a thread."""
    tok = _session_token()
    if tok:
        return tok
    la = _local_auth()
    key = _event_key()
    if la is None or not key:
        return ""
    try:
        return la.dashboard_token(port, key, timeout=5)
    except (la.Unverified, OSError, ValueError):
        return ""


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
async def approve(body: Approve, request: Request):
    """Answer a pending approval from the app's notification buttons: the same ``approval.respond``
    the gateway offers every client, over this dashboard's own WebSocket."""
    import asyncio
    import json

    import websockets

    if body.choice not in ("once", "session", "always", "deny"):
        raise HTTPException(status_code=400, detail="bad choice")
    if not body.request_id:
        # Without an id Hermes answers the session's oldest waiting approval, which may not be the one shown.
        raise HTTPException(status_code=409, detail="no request id: answer in the app")
    port = _own_port(request)
    token = await asyncio.to_thread(_own_page_token, port)
    if not token:
        raise HTTPException(status_code=503, detail="no dashboard token")
    last = None
    async with websockets.connect(f"ws://127.0.0.1:{port}/api/ws?token={token}", max_size=None) as ws:
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
async def stop(body: Stop, request: Request):
    """Stop a running turn from the status chip's Stop button: find the live runtime that holds this stored
    chat (``session.active_list``) and send it the same ``session.interrupt`` the app's stop button sends."""
    import asyncio
    import json

    import websockets

    if not body.session:
        raise HTTPException(status_code=400, detail="no session")
    port = _own_port(request)
    token = await asyncio.to_thread(_own_page_token, port)
    if not token:
        raise HTTPException(status_code=503, detail="no dashboard token")

    async with websockets.connect(f"ws://127.0.0.1:{port}/api/ws?token={token}", max_size=None) as ws:
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

        last = [float("-inf")]  # not 0.0: monotonic() counts from boot, so the first check would wait out the first 30 s

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


# ── which plugin this is (the app's plugin update compares it with the copy in its APK) ──

def plugin_info(folder: Optional[Path] = None) -> dict:
    """BUILD_STAMP ("STAMP HASH SOURCE", written by android/build.sh and install.sh): stamp 0 = a copy without one."""
    folder = folder or Path(__file__).resolve().parent.parent
    try:
        stamp, digest, source = (folder / "BUILD_STAMP").read_text().split()[:3]
        return {"stamp": int(stamp), "hash": digest, "source": source}
    except (OSError, ValueError):
        return {"stamp": 0, "hash": "", "source": ""}


@router.get("/plugin-info")
async def get_plugin_info():
    return plugin_info()


# ── the diagnostic log on this side (diag.py): only for Report a problem, and only checked lines leave ──

def _diag_mod():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_diag")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_diag", Path(__file__).resolve().parent.parent / "diag.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_diag"] = mod
        spec.loader.exec_module(mod)
    return mod


class DiagPrefs(BaseModel):
    enabled: bool = True


@router.get("/diag")
async def get_diag():
    import asyncio

    return await asyncio.to_thread(lambda: _diag_mod().snapshot(plugin_info()["stamp"]))


@router.put("/diag")
async def put_diag(body: DiagPrefs):
    import asyncio

    await asyncio.to_thread(_diag_mod().set_enabled, body.enabled)
    return {"ok": True}


@router.delete("/diag")
async def delete_diag():
    import asyncio

    await asyncio.to_thread(_diag_mod().clear)
    return {"ok": True}


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
        # The Termux:API app may be asleep (frozen in the background) and miss the first call: one retry, so the
        # Setup check doesn't flash "Hermes can't reach it" for one round.
        for _ in range(2):
            try:
                out = subprocess.run([cmd], capture_output=True, text=True, timeout=10).stdout
                api = "percentage" in out
            except Exception:
                api = False
            if api:
                break
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


_phone_lock = None


@router.get("/phone-access")
async def phone_access():
    """Runs two short commands; cached 15 s (5 s while Shizuku doesn't work yet, so a fix shows soon), since the Setup
    screens ask every few seconds while they are open. One check at a time: rish can wait 20 s on Shizuku's "Allow Termux?"
    prompt, and overlapping calls would each ask again."""
    import asyncio
    import time

    global _phone_lock
    if _phone_lock is None:
        _phone_lock = asyncio.Lock()

    def fresh():
        v = _phone_cache.get("v")
        ttl = 15 if v is not None and v.get("shizuku") in ("ok", "missing") else 5
        return v is not None and time.monotonic() - _phone_cache.get("t", 0) < ttl

    if fresh():
        return _phone_cache["v"]
    async with _phone_lock:
        if fresh():  # a call that waited for the lock gets the answer the one before it just found
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
        raise HTTPException(status_code=404, detail="This snapshot is gone (Hermux keeps 20 per folder).")
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
        raise HTTPException(status_code=501, detail=f"In-app Claude sign-in isn't available with this agent version ({str(e)[:120]})")


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


# ── the plugin in every profile ──
# Each Hermes profile loads plugins from its own plugins/ folder, so a profile made later (Bots page, `hermes profile
# create`) has no status chip, approvals or canvas until ours is linked in. phone/install.sh links it into the profiles
# that exist at install time; this covers the ones made after (on every dashboard start and after the app creates one).


def link_profiles(root: Optional[Path] = None) -> list[str]:
    """Point <profile>/plugins/hermes-mobile at the main home's copy in every profile; returns the profiles changed.
    A copy left there (a cloned profile) is replaced: it would never be updated."""
    import shutil

    root = root or _home(None)
    target = root / "plugins" / "hermes-mobile"
    changed: list[str] = []
    if not target.is_dir():
        return changed
    try:
        profiles = sorted(p for p in (root / "profiles").iterdir() if p.is_dir())
    except OSError:
        return changed
    for p in profiles:
        link = p / "plugins" / "hermes-mobile"
        try:
            if link.is_symlink() and link.resolve() == target.resolve():
                continue
            if link.is_symlink() or link.is_file():
                link.unlink()
            elif link.is_dir():
                shutil.rmtree(link)
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(target)
            changed.append(p.name)
        except OSError:
            continue
    return changed


@router.post("/profiles/link")
async def profiles_link():
    return {"linked": link_profiles()}


# Rows Hermes stores as role=user that the user never typed: model-switch notices, compaction summaries, background
# and delegation reports, auto-continue nudges. Hermes hides them in the transcript too (session_history.py).
_NOT_TYPED_KINDS = ("hidden", "model_switch", "async_delegation_complete", "auto_continue", "internal_notification",
                    "process_complete")
_NOT_TYPED_PREFIXES = ("[System:", "[System note:", "[CONTEXT COMPACTION", "[ASYNC DELEGATION", "[IMPORTANT:",
                       "[Your active task list", "[STILL IN PROGRESS", "[Note: model was just switched")


def sent_counts(db_path: Path, ids: list) -> dict:
    """{chat id: messages the user sent}, over each chat's compression lineage. Read-only, one query per call."""
    import sqlite3

    ids = [i for i in ids if isinstance(i, str) and i][:500]
    if not ids or not db_path.exists():
        return {}
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    try:
        marks = ",".join("?" * len(ids))
        kinds = ",".join("?" * len(_NOT_TYPED_KINDS))
        prefixes = " ".join("AND m.content NOT LIKE ? || '%'" for _ in _NOT_TYPED_PREFIXES)
        rows = con.execute(
            f"""WITH RECURSIVE chain(root, sid) AS (
                  SELECT id, id FROM sessions WHERE id IN ({marks})
                  UNION SELECT chain.root, c.id FROM chain JOIN sessions p ON p.id = chain.sid
                    JOIN sessions c ON c.parent_session_id = p.id WHERE p.end_reason = 'compression')
                SELECT chain.root, COUNT(m.id) FROM chain JOIN messages m ON m.session_id = chain.sid
                WHERE m.role = 'user' AND COALESCE(m.display_kind, '') NOT IN ({kinds})
                  AND TRIM(COALESCE(m.content, '')) != '' {prefixes}
                GROUP BY chain.root""",
            (*ids, *_NOT_TYPED_KINDS, *_NOT_TYPED_PREFIXES),
        ).fetchall()
    except sqlite3.Error:
        return {}
    finally:
        con.close()
    return {i: 0 for i in ids} | {r[0]: r[1] for r in rows}


class SentCountsBody(BaseModel):
    ids: list[str]


@router.post("/sent-counts")
def post_sent_counts(body: SentCountsBody, profile: Optional[str] = None):
    """How many messages the user sent in each listed chat, for the drawer's "N msgs" (session.list's
    message_count also counts replies and tool calls)."""
    return {"counts": sent_counts(_home(profile) / "state.db", body.ids)}


try:  # the dashboard imports this file once at start
    link_profiles()
except Exception:
    pass


# ── Google Workspace (Settings → Connectors): Hermes's google-workspace skill script, run for the ?profile= home
# (google_workspace.py). Plain defs: the script blocks, so FastAPI runs them on its thread pool. ──

def _google_mod():
    import importlib.util
    import sys

    mod = sys.modules.get("hm_google_workspace")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_google_workspace", Path(__file__).resolve().parent.parent / "google_workspace.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_google_workspace"] = mod
        spec.loader.exec_module(mod)
    return mod


def _google(profile: Optional[str], fn):
    m = _google_mod()
    home = _home(profile)
    try:
        warning = fn(m, home)
    except m.GoogleError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {**m.status(home), **({"warning": warning} if warning else {})}


class GoogleClient(BaseModel):
    text: str


class GoogleFinish(BaseModel):
    url: str


@router.get("/google")
def google_get(profile: Optional[str] = None):
    return _google(profile, lambda m, home: None)


@router.put("/google/client")
def google_client(body: GoogleClient, profile: Optional[str] = None):
    return _google(profile, lambda m, home: m.save_client_secret(home, body.text))


@router.post("/google/start")
def google_start(profile: Optional[str] = None):
    m = _google_mod()
    try:
        return {"url": m.start(_home(profile))}
    except m.GoogleError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/google/finish")
def google_finish(body: GoogleFinish, profile: Optional[str] = None):
    return _google(profile, lambda m, home: m.finish(home, body.url))


@router.post("/google/install")
def google_install(profile: Optional[str] = None):
    return _google(profile, lambda m, home: m.install_deps(home))


@router.delete("/google")
def google_delete(profile: Optional[str] = None):
    return _google(profile, lambda m, home: m.revoke(home))
