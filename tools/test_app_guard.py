"""The app's own dashboard clients (android/.../LocalClient.java and LocalDashboard.java, compiled here with javac)
against the plugin's real dashboard guard (dashboard/plugin_api.py _TokenGuard), on a real loopback socket: a small
HTTP/1.1 server (keep-alive, one request at a time per connection) runs a stand-in Hermes app with the guard installed,
as the dashboard does. The app's token step must get the session token; a REST call must say hello and then send its
request on that same connection, get an answer whose proof verifies, and reach the app with the token and the body; a
streamed answer must arrive whole. With the guard on another key, the token step and a REST call must fail, and no REST
request may reach the app. Needs fastapi (skipped without it) and a JDK's javac: skipped without one locally, but a
failure when the CI environment variable is set (the CI job sets up a JDK, so a missing one is an error there).
Run: python3 tools/test_app_guard.py
"""
import asyncio
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PLUGIN = os.path.join(REPO, "hermes-plugin", "hermes-mobile")
SRC = os.path.join(REPO, "android", "src", "com", "omarqaterge", "hermesmobile")
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  {detail}"))
    fails += not cond


try:
    import fastapi
    from fastapi.responses import JSONResponse, StreamingResponse
except ImportError:
    print("skipped: no fastapi")
    sys.exit(0)
if not shutil.which("javac") or not shutil.which("java"):
    if os.environ.get("CI"):  # CI sets up a JDK for this job: a missing one must not pass unnoticed
        print("FAIL no javac in CI")
        sys.exit(1)
    print("skipped: no javac")
    sys.exit(0)

TOKEN = "tok-app_guard.123"
KEY = "4c1f0e7a9b2d5c8e3f6a1b4d7e0c3f6a9b2d5e8c1f4a7b0d"
app = fastapi.FastAPI()
sys.modules["hermes_cli"] = types.ModuleType("hermes_cli")
sys.modules["hermes_cli.web_server"] = types.SimpleNamespace(app=app, _SESSION_TOKEN=TOKEN)
reached = []  # (path, token header, body) of every REST request that got to the app


@app.post("/api/echo")
async def echo(req: fastapi.Request):
    body = await req.body()
    reached.append(("/api/echo", req.headers.get("x-hermes-session-token"), body))
    return JSONResponse({"token_ok": req.headers.get("x-hermes-session-token") == TOKEN, "len": len(body)})


@app.get("/api/stream")
async def stream(req: fastapi.Request):
    reached.append(("/api/stream", req.headers.get("x-hermes-session-token"), b""))

    async def parts():
        for p in (b"one;", b"two;", b"three;"):
            yield p

    return StreamingResponse(parts(), media_type="text/plain")


tmp = tempfile.mkdtemp()
keyfile = os.path.join(tmp, "guard.key")
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
            # ASGI spec 2.4: a streamed answer isn't cut short by watching receive() for a disconnect (as with uvicorn).
            scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1", "method": method, "scheme": "http",
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

            # In a task of its own (as a server runs each request), bounded: a streamed answer then completes here.
            await asyncio.wait_for(app(scope, receive, send), 30)
            hs =[(k, v) for k, v in got["headers"] if k.lower() not in (b"content-length", b"connection", b"transfer-encoding")]
            out = f"HTTP/1.1 {got['status']} X\r\n".encode() + b"".join(k + b": " + v + b"\r\n" for k, v in hs)
            out += b"Content-Length: %d\r\n\r\n" % len(got["body"]) + got["body"]
            writer.write(out)
            await writer.drain()
            if dict(headers).get(b"connection", b"").lower() == b"close":
                return  # as a real server does when the client asks
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

# The app's client classes, as they are, with a small driver.
build = os.path.join(tmp, "java")
pkg = os.path.join(build, "src", "com", "omarqaterge", "hermesmobile")
os.makedirs(pkg)
for name in ("LocalAuth.java", "LocalClient.java", "LocalDashboard.java"):
    shutil.copy(os.path.join(SRC, name), pkg)
with open(os.path.join(pkg, "AppGuardDriver.java"), "w") as f:
    f.write("""package com.omarqaterge.hermesmobile;
public class AppGuardDriver {
    public static void main(String[] a) {
        int port = Integer.parseInt(a[0]);
        LocalClient.KeySet keys = LocalClient.single(a[1]);
        String tok;
        try { tok = LocalClient.dashboardToken(port, keys); System.out.println("token " + tok); }
        catch (LocalClient.Unverified e) { System.out.println("token-why " + e.why); tok = a[2]; }
        catch (Exception e) { System.out.println("token-error " + e.getMessage()); tok = a[2]; }
        try {
            String[] r = LocalDashboard.call(port, keys, "POST", "/api/echo", tok, "{\\"note\\":\\"body\\"}", 10000);
            System.out.println("rest " + r[0] + " " + r[1]);
        } catch (LocalDashboard.NotVerified e) { System.out.println("rest-dropped " + e.why + " " + e.helloFailed); }
        catch (Exception e) { System.out.println("rest-error " + e); }
        try {
            String[] r = LocalDashboard.call(port, keys, "GET", "/api/stream", tok, null, 10000);
            System.out.println("stream " + r[0] + " " + r[1]);
        } catch (LocalDashboard.NotVerified e) { System.out.println("stream-dropped " + e.why + " " + e.helloFailed); }
        catch (Exception e) { System.out.println("stream-error " + e); }
    }
}
""")
srcs = [os.path.join(pkg, n) for n in os.listdir(pkg)]
r = subprocess.run(["javac", "-nowarn", "-encoding", "UTF-8", "-d", os.path.join(build, "out"), *srcs], capture_output=True, text=True)
check("the app's client classes compile", r.returncode == 0, r.stderr[-500:])


def drive(key):
    out = subprocess.run(["java", "-cp", os.path.join(build, "out"), "com.omarqaterge.hermesmobile.AppGuardDriver", port, key, TOKEN],
                         capture_output=True, text=True, timeout=120)
    return out.stdout.splitlines()


lines = drive(KEY)
check("the token step: the guard's session token", f"token {TOKEN}" in lines, lines)
check("REST after the hello on one connection: the answer's proof verifies and the app saw the token and the body",
      'rest 200 {"token_ok":true,"len":15}' in lines and reached[:1] == [("/api/echo", TOKEN, b'{"note":"body"}')], (lines, reached))
check("a streamed answer arrives whole, its proof verified", "stream 200 one;two;three;" in lines, lines)

before = len(reached)
with open(keyfile + ".tmp", "w") as f:  # the guard now proves with another key (written as the app writes it)
    f.write("0b8e1c4f7a2d5e9036c1f8a4d7b2e6093c5a8f1e4d7b0a26\n")
os.replace(keyfile + ".tmp", keyfile)
lines = drive(KEY)
check("a guard with another key: the token step fails (unknown_kid)", "token-why unknown_kid" in lines, lines)
check("... and a REST call is dropped at its hello", "rest-dropped unknown_kid true" in lines and "stream-dropped unknown_kid true" in lines, lines)
check("... and no REST request reached the app", len(reached) == before, reached[before:])

print("\nALL PASSED" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
