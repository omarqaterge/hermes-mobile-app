"""The end of local authentication's compatibility window, end to end on real loopback sockets: the plugin's real
dashboard guard (dashboard/plugin_api.py _TokenGuard, behind a small HTTP/1.1 server as in test_app_guard.py), the
cron ticker's real poke server (cron_ticker.serve_one), and the app's real key owner, listener and client
(LocalKey, EventsListener, LocalClient, compiled here with javac and driven over a pipe). The app's key commands run
in a real sh, in a temporary home that plays Termux's, so the key file and the enforced file the guard reads are the
ones the app's own command wrote.

Before the switch the raw key still gets the page's token; during the grace after the switch's rotation (the new key
not yet in Termux) the app picks the old key by the server's kid and the Termux side signs with it; once the command
ran, the guard proves with the new key, the raw key gets the withheld page and is reported (a signed local_legacy
event the app's listener takes), and the first request signed with the new key makes the listener refuse the raw key.
After the grace only the new key counts. Needs fastapi (skipped without it) and a JDK's javac (skipped locally without
one, a failure in CI). Run: python3 tools/test_local_switch.py
"""
import asyncio
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
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
    from fastapi.responses import HTMLResponse
except ImportError:
    print("skipped: no fastapi")
    sys.exit(0)
if not shutil.which("javac") or not shutil.which("java") or not shutil.which("sh"):
    if os.environ.get("CI"):
        print("FAIL no javac in CI")
        sys.exit(1)
    print("skipped: no javac")
    sys.exit(0)

TOKEN = "tok-switch.123"
PAGE = '<html><script>window.__HERMES_SESSION_TOKEN__="%s";</script></html>' % TOKEN
app = fastapi.FastAPI()
sys.modules["hermes_cli"] = types.ModuleType("hermes_cli")
sys.modules["hermes_cli.web_server"] = types.SimpleNamespace(app=app, _SESSION_TOKEN=TOKEN)


@app.get("/{path:path}")
def spa(path: str):
    return HTMLResponse(PAGE)


tmp = tempfile.mkdtemp()
home = os.path.join(tmp, "home")  # Termux's home: the app's key commands write here
os.makedirs(home)
keyfile = os.path.join(home, ".hermes-mobile", "key")
enforced = os.path.join(home, ".hermes-mobile", "enforced")
os.environ["HM_DASH_KEY_FILE"] = keyfile
spec = importlib.util.spec_from_file_location("plugin_api", os.path.join(PLUGIN, "dashboard", "plugin_api.py"))
papi = importlib.util.module_from_spec(spec)
sys.modules["plugin_api"] = papi
spec.loader.exec_module(papi)
la = papi._local_auth()
diag_events = []
papi._diag_mod = lambda: types.SimpleNamespace(event=lambda *a, **k: diag_events.append((a, k)))


async def handle(reader, writer):
    """HTTP/1.1, keep-alive, each request passed to the ASGI app (as in test_app_guard.py)."""
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
            scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1", "method": method,
                     "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": query.encode(), "root_path": "",
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

            await asyncio.wait_for(app(scope, receive, send), 30)
            hs = [(k, v) for k, v in got["headers"] if k.lower() not in (b"content-length", b"connection", b"transfer-encoding")]
            out = f"HTTP/1.1 {got['status']} X\r\n".encode() + b"".join(k + b": " + v + b"\r\n" for k, v in hs)
            out += b"Content-Length: %d\r\n\r\n" % len(got["body"]) + got["body"]
            writer.write(out)
            await writer.drain()
            if dict(headers).get(b"connection", b"").lower() == b"close":
                return
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
DASH = box["port"]

# The app's side: its real classes, with a driver that reads one command per line and answers one line.
build = os.path.join(tmp, "java")
pkg = os.path.join(build, "src", "com", "omarqaterge", "hermesmobile")
os.makedirs(pkg)
for name in ("LocalAuth.java", "LocalClient.java", "LocalDashboard.java", "LocalKey.java", "LocalServer.java", "EventsListener.java"):
    shutil.copy(os.path.join(SRC, name), pkg)
with open(os.path.join(pkg, "SwitchDriver.java"), "w") as f:
    f.write(r"""package com.omarqaterge.hermesmobile;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
public class SwitchDriver {
    static volatile long now = 1_800_000_000_000L;
    static final Map<String, Object> m = new HashMap<>();
    static final LocalKey keys = new LocalKey(new LocalKey.Store() {
        public synchronized String getString(String n) { Object v = m.get(n); return v instanceof String ? (String) v : null; }
        public synchronized long getLong(String n) { Object v = m.get(n); return v instanceof Long ? (Long) v : 0; }
        public synchronized boolean getBoolean(String n) { return Boolean.TRUE.equals(m.get(n)); }
        public synchronized Object get(String n) { return m.get(n); }
        public synchronized boolean save(Map<String, Object> c) {
            for (Map.Entry<String, Object> e : c.entrySet()) { if (e.getValue() == null) m.remove(e.getKey()); else m.put(e.getKey(), e.getValue()); }
            return true;
        }
    }, () -> now, 1);
    static final AtomicInteger legacyMac = new AtomicInteger(), legacyRaw = new AtomicInteger(), events = new AtomicInteger();
    static final List<String> pending = Collections.synchronizedList(new ArrayList<>());
    static String home;
    static int sh(String cmd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder("sh", "-c", cmd);
        pb.environment().put("HOME", home);
        pb.redirectErrorStream(true);
        Process p = pb.start();
        p.getInputStream().readAllBytes();
        return p.waitFor();
    }
    static void serve(Socket c) {
        try (Socket s = c) {
            s.setSoTimeout(3000);
            EventsListener.Request r = EventsListener.read(s, keys, "{}", "{}", legacyRaw::incrementAndGet);
            if (r == null) return;
            if (r.auth() == LocalServer.Auth.MAC) keys.confirm(r.kid());
            OutputStream out = s.getOutputStream();
            if (EventsListener.verdict(r) == EventsListener.Verdict.EVENT) {
                LocalServer.answer(out, 204, "text/plain", new byte[0]);
                events.incrementAndGet();
                if (r.auth() == LocalServer.Auth.MAC && r.text().matches("(?s).*\"kind\"\\s*:\\s*\"local_legacy\".*")) legacyMac.incrementAndGet();
            } else LocalServer.answer(out, 403, "text/plain", new byte[0]);
        } catch (Exception ignored) { }
    }
    public static void main(String[] a) throws Exception {
        home = a[0];
        ServerSocket ss = new ServerSocket(0, 8, InetAddress.getByAddress(new byte[] {127, 0, 0, 1}));
        Thread t = new Thread(() -> { while (true) { try { Socket c = ss.accept(); new Thread(() -> serve(c)).start(); } catch (IOException e) { return; } } });
        t.setDaemon(true);
        t.start();
        LocalKey.Facts ready = new LocalKey.Facts(true, "current", "1800000000", "1800000000", false);
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintStream out = new PrintStream(System.out, true, "UTF-8");
        for (String line; (line = in.readLine()) != null; ) {
            String[] p = line.split(" ");
            switch (p[0]) {
                case "port": out.println("port " + ss.getLocalPort()); break;
                case "share": out.println("shared " + keys.share(cmd -> { if (sh(cmd) != 0) throw new Exception("sh"); })); break;
                case "scripts": keys.scriptsCopied(true); keys.tickerSeen(true); out.println("ok"); break;
                case "tick": {
                    LocalKey.Result r = keys.tick(ready, pending::add); // handed over, not yet run by Termux
                    out.println("tick " + r.rotated + " " + r.shared + " " + r.enforced);
                    break;
                }
                case "run": { int n = 0; synchronized (pending) { for (String c : pending) { sh(c); n++; } pending.clear(); } out.println("ran " + n); break; }
                case "token": {
                    try { out.println("token " + LocalClient.dashboardToken(Integer.parseInt(p[1]), keys)); }
                    catch (LocalClient.Unverified u) { out.println("why " + u.why); }
                    catch (Exception e) { out.println("error " + e.getClass().getSimpleName()); }
                    break;
                }
                case "raw": out.println("raw " + keys.rawAccepted()); break;
                case "clock": now += Long.parseLong(p[1]); out.println("ok"); break;
                case "count": out.println("count " + events.get() + " " + legacyMac.get() + " " + legacyRaw.get()); break;
                case "accepted": out.println("accepted " + keys.accepted().size()); break;
                default: out.println("?");
            }
        }
    }
}
""")
srcs = [os.path.join(pkg, n) for n in os.listdir(pkg)]
r = subprocess.run(["javac", "-nowarn", "-encoding", "UTF-8", "-d", os.path.join(build, "out"), *srcs], capture_output=True, text=True)
check("the app's classes compile", r.returncode == 0, r.stderr[-800:])
if r.returncode != 0:
    sys.exit(1)
drv = subprocess.Popen(["java", "-cp", os.path.join(build, "out"), "com.omarqaterge.hermesmobile.SwitchDriver", home],
                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)


def ask(cmd):
    drv.stdin.write(cmd + "\n")
    drv.stdin.flush()
    return drv.stdout.readline().strip()


EVENTS = int(ask("port").split()[1])
papi._report_legacy = lambda la_, key: la_.report_legacy("dashboard", key, events_port=EVENTS)


def file_key():
    with open(keyfile) as fh:
        return fh.read().strip()


def page(key):
    """The / page fetched with the raw key, as an old client would: True when it still carried the token."""
    with socket.create_connection(("127.0.0.1", DASH), 3) as s:
        s.sendall(f"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Hermes-Mobile-Key: {key}\r\nConnection: close\r\n\r\n".encode())
        data = b""
        while True:
            b = s.recv(65536)
            if not b:
                break
            data += b
    return TOKEN.encode() in data


def signed_event(key, event):
    """A Termux-side client: verify the app's listener, then one signed POST /event (local_auth.session)."""
    try:
        return la.session("events", EVENTS, key, timeout=3).request("POST", "/event", json.dumps(event).encode()).status
    except la.Unverified as e:
        return e.why


def raw_event(key):
    with socket.create_connection(("127.0.0.1", EVENTS), 3) as s:
        body = b'{"kind":"status"}'
        s.sendall(b"POST /event HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Hermes-Mobile-Key: " + key.encode()
                  + b"\r\nContent-Length: %d\r\n\r\n" % len(body) + body)
        return s.recv(64).split(b" ")[1].decode()


def wait_for(fn, s=5.0):
    end = time.time() + s
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.05)
    return fn()


# ── before: the app's share writes the key; the window is open ──
check("the app's key command, run by sh, writes Termux's key file", ask("share") == "shared true" and len(file_key()) == 48)
k0 = file_key()
check("before: the app's client gets the token from the verified guard", ask(f"token {DASH}") == f"token {TOKEN}")
check("before: the raw key still gets the page's token", page(k0))
check("before: a Termux-side client's signed event reaches the app", signed_event(k0, {"kind": "status"}) == 204)
check("before: the raw key still reaches the app's listener", raw_event(k0) == "204" and ask("raw") == "raw true")

# ── the switch's steps 1 and 2: a new key, the command handed over but not yet run by Termux (the grace) ──
ask("scripts")
check("a signed event after the scripts line", signed_event(k0, {"kind": "status"}) == 204)
check("ready: step 1 rotates, step 2 hands over the command", ask("tick") == "tick enforce true null")
check("... Termux still holds the old key, no enforced file yet", file_key() == k0 and not os.path.exists(enforced))
check("during the grace the app picks the old key by the guard's kid: its token step works", ask(f"token {DASH}") == f"token {TOKEN}")
check("during the grace a Termux-side client with the old key completes its signed event (kid hint)", signed_event(k0, {"kind": "status"}) == 204)
check("... which is not step 3: the listener still accepts the raw key", ask("raw") == "raw true")
check("during the grace the guard still gives the raw key the token (no enforced file in Termux)", page(k0))

# ── Termux runs the command: the new key and the enforced file ──
check("Termux runs the handed-over command", ask("run") == "ran 1")
k1 = file_key()
check("... the key file holds the new key and the enforced file exists", k1 != k0 and os.path.exists(enforced))
check("the guard proves with the new key at once: the app's token step works", ask(f"token {DASH}") == f"token {TOKEN}")
check("the raw new key gets the withheld page", not page(k1))
check("... the raw old key too", not page(k0))
check("... reported once (local legacy_key port=dashboard side=plugin)",
      [e for e in diag_events if e[0][:2] == ("local", "legacy_key")] == [(("local", "legacy_key"), {"port": "dashboard", "side": "plugin"})], diag_events)
check("... and the app's listener took the guard's signed local_legacy event", wait_for(lambda: ask("count").split()[2] == "1"), ask("count"))
check("a Termux-side client with the new key: its signed event is step 3", signed_event(k1, {"kind": "status"}) == 204 and ask("raw") == "raw false")
check("after step 3 the raw key gets 403 from the app's listener, and is reported", raw_event(k1) == "403" and ask("count").split()[3] == "1")

# ── the ticker: the raw key after the enforced file pokes nothing and is reported ──
spec = importlib.util.spec_from_file_location("hm_cron_ticker", os.path.join(PLUGIN, "cron_ticker.py"))
ct = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ct)
ct.KEY_FILE = type(ct.KEY_FILE)(keyfile)
ct.ENFORCED = type(ct.ENFORCED)(enforced)
ct.EVENTS_PORT = EVENTS
ct.LOOP_EVENTS = type(ct.LOOP_EVENTS)(os.path.join(tmp, "loop-events.log"))
ct.DIAG_OFF = type(ct.DIAG_OFF)(os.path.join(tmp, "diag-off"))
open(ct.LOOP_EVENTS, "w").close()
srv = socket.socket()
srv.bind(("127.0.0.1", 0))
srv.listen(2)
where = la.server_addr("127.0.0.1", srv.getsockname()[1])


def ticker_try(line):
    res = {}

    def run():
        c, _ = srv.accept()
        with c:
            res["poked"] = ct.serve_one(c, ct._key(), where)

    th = threading.Thread(target=run)
    th.start()
    with socket.create_connection(srv.getsockname(), 3) as s:
        s.sendall(line)
        time.sleep(0.2)
    th.join(10)
    return res.get("poked")


check("ticker: the raw key after the enforced file pokes nothing", ticker_try(k1.encode() + b"\n") is False)
check("... it is noted in the loop-events log", " local legacy_key port=ticker side=ticker" in open(ct.LOOP_EVENTS).read())
check("... and the app's listener took the ticker's signed local_legacy event", wait_for(lambda: ask("count").split()[2] == "2"), ask("count"))
check("ticker: the second raw key that day is refused without another report", ticker_try(k1.encode() + b"\n") is False
      and open(ct.LOOP_EVENTS).read().count("legacy_key") == 1)
srv.close()

# ── after the grace: only the new key counts ──
ask(f"clock {120_000}")
check("after the grace the app holds one key", ask("accepted") == "accepted 1")
check("a Termux-side client still holding the old key gets unknown_kid and sends nothing", signed_event(k0, {"kind": "status"}) == "unknown_kid")
check("a client with the new key keeps working", signed_event(k1, {"kind": "status"}) == 204)
with open(keyfile + ".tmp", "w") as fh:  # a second Hermes process still proving with the old key
    fh.write(k0)
os.replace(keyfile + ".tmp", keyfile)
check("a guard that still proves with the old key: the app's token step fails (unknown_kid)", ask(f"token {DASH}") == "why unknown_kid")
os.replace(keyfile, keyfile + ".old")
with open(keyfile, "w") as fh:
    fh.write(k1)
check("the app shares the key again (an enforced share): the guard and the app agree again",
      ask("share") == "shared true" and file_key() == k1 and os.path.exists(enforced) and ask(f"token {DASH}") == f"token {TOKEN}")
check("the raw key stays refused: nothing reopens the window", ask("raw") == "raw false" and not page(k1))

drv.stdin.close()
drv.wait(10)
print("\nALL PASSED" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
