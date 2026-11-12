"""phone/hm-local against the plugin's real dashboard guard (dashboard/plugin_api.py _TokenGuard), on a real loopback
socket: a small HTTP/1.1 server (keep-alive, one request at a time per connection) runs a stand-in Hermes app with the
guard installed, as the dashboard does, and hm-local runs as a shell would run it. `hm-local token` must get the session
token (its request names both nonces, as the guard requires), `hm-local hello dashboard` must verify, and a wrong key
must give its own exit code with no token. Needs fastapi, like tools/test_token_guard.py (skipped without it).
Run: python3 tools/test_hm_local_guard.py
"""
import asyncio
import importlib.util
import os
import subprocess
import sys
import tempfile
import threading
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PLUGIN = os.path.join(REPO, "hermes-plugin", "hermes-mobile")
HM = os.path.join(REPO, "phone", "hm-local")
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  {detail}"))
    fails += not cond


try:
    import fastapi
    from fastapi.responses import HTMLResponse
except ImportError:
    print("skipped: no fastapi")
    sys.exit(0)

TOKEN = "tok-guard_123.x"
app = fastapi.FastAPI()
sys.modules["hermes_cli"] = types.ModuleType("hermes_cli")
sys.modules["hermes_cli.web_server"] = types.SimpleNamespace(app=app, _SESSION_TOKEN=TOKEN)


@app.get("/{path:path}")
def spa(path: str):
    return HTMLResponse(f'<script>window.__HERMES_SESSION_TOKEN__="{TOKEN}";</script>')


tmp = tempfile.mkdtemp()
KEY = "4c1f0e7a9b2d5c8e3f6a1b4d7e0c3f6a9b2d5e8c1f4a7b0d"
os.makedirs(os.path.join(tmp, "home", ".hermes-mobile"))
with open(os.path.join(tmp, "home", ".hermes-mobile", "key"), "w") as f:  # hm-local's
    f.write(KEY)
keyfile = os.path.join(tmp, "guard.key")  # the guard's (the same key until the last case)
with open(keyfile, "w") as f:
    f.write(KEY + "\n")
os.environ["HM_DASH_KEY_FILE"] = keyfile
spec = importlib.util.spec_from_file_location("plugin_api", os.path.join(PLUGIN, "dashboard", "plugin_api.py"))
papi = importlib.util.module_from_spec(spec)
sys.modules["plugin_api"] = papi
spec.loader.exec_module(papi)
check("the guard is installed", any(m.cls is papi._TokenGuard for m in app.user_middleware))


async def handle(reader, writer):
    """HTTP/1.1 for one connection: requests one after another (keep-alive), each passed to the ASGI app."""
    port = writer.get_extra_info("sockname")[1]
    try:
        while True:
            try:
                head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
            except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError):
                return
            lines = head.decode("latin-1").split("\r\n")
            method, target, _ = lines[0].split(" ")
            headers = []
            for line in lines[1:]:
                if line:
                    k, _, v = line.partition(":")
                    headers.append((k.strip().lower().encode(), v.strip(" \t").encode("latin-1")))
            n = int(dict(headers).get(b"content-length", b"0") or 0)
            body = await reader.readexactly(n) if n else b""
            path, _, query = target.partition("?")
            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
                     "path": path, "raw_path": path.encode(), "query_string": query.encode(), "root_path": "",
                     "headers": headers, "server": ("127.0.0.1", port), "client": ("127.0.0.1", 1)}
            got = {"status": 500, "headers": [], "body": b""}
            sent = [False]

            async def receive():
                if not sent[0]:
                    sent[0] = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return {"type": "http.disconnect"}

            async def send(m):
                if m["type"] == "http.response.start":
                    got["status"], got["headers"] = m["status"], list(m.get("headers", []))
                elif m["type"] == "http.response.body":
                    got["body"] += m.get("body", b"")

            await app(scope, receive, send)
            hs = [(k, v) for k, v in got["headers"] if k.lower() not in (b"content-length", b"connection")]
            out = f"HTTP/1.1 {got['status']} X\r\n".encode() + b"".join(k + b": " + v + b"\r\n" for k, v in hs)
            out += b"Content-Length: %d\r\n\r\n" % len(got["body"]) + got["body"]
            writer.write(out)
            await writer.drain()
    finally:
        writer.close()


loop = asyncio.new_event_loop()
ready = threading.Event()
box = {}


def serve():
    asyncio.set_event_loop(loop)
    srv = loop.run_until_complete(asyncio.start_server(handle, "127.0.0.1", 0))
    box["port"] = srv.sockets[0].getsockname()[1]
    ready.set()
    loop.run_forever()


threading.Thread(target=serve, daemon=True).start()
ready.wait(10)
port = str(box["port"])
env = dict(os.environ, HOME=os.path.join(tmp, "home"))


def hm(*args):
    r = subprocess.run(["bash", HM, *args], capture_output=True, env=env, timeout=30, stdin=subprocess.DEVNULL)
    return r.returncode, r.stdout.decode(), r.stderr.decode()


rc, out, err = hm("hello", "dashboard", port)
check("hm-local hello dashboard: the guard verifies", rc == 0, f"{rc} {err}")
rc, out, err = hm("token", port)
check("hm-local token: the guard's session token", (rc, out) == (0, TOKEN + "\n"), f"{rc} {out!r} {err}")
check("nothing private on stderr", err == "")

# The four-field form of the header (the one a request on its hello's connection uses elsewhere) is refused here.
ls = importlib.util.spec_from_loader("hm_local", importlib.machinery.SourceFileLoader("hm_local", HM))
h = importlib.util.module_from_spec(ls)
ls.loader.exec_module(h)
try:
    a = h.session("dashboard", int(port), KEY).request("GET", "/hermux/token")
    four = a.status
except h.Unverified as e:
    four = e.why
check("the token step refuses the four-field header", four == "refused", four)

with open(keyfile + ".tmp", "w") as f:  # the guard now proves with another key (written as the app writes it)
    f.write("0b8e1c4f7a2d5e9036c1f8a4d7b2e6093c5a8f1e4d7b0a26\n")
os.replace(keyfile + ".tmp", keyfile)
rc, out, err = hm("token", port)
check("a guard with another key: unknown_kid (exit 7), no token", (rc, out) == (7, ""), f"{rc} {out!r}")

print("\nALL PASSED" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
