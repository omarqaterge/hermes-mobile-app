"""The plugin's session token guard (dashboard/plugin_api.py _TokenGuard).

Every app on an Android phone shares 127.0.0.1, so a page holding the dashboard's session token must only go to a caller
with the app's event key (until ~/.hermes-mobile/enforced exists). Local authentication: the guard's own
GET /hermux/hello and GET /hermux/token routes and the X-Hermux-Proof header on REST answers.
tools/hermes-contract checks the page part against the real, pinned Hermes.
Run: python3 tools/test_token_guard.py (needs fastapi, like the other REST tests; skipped without it).
"""
import importlib.util
import os
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile")
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  {detail}"))
    if not cond:
        fails += 1


try:
    import fastapi
    from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
    from fastapi.testclient import TestClient
except ImportError:
    print("skipped: no fastapi")
    sys.exit(0)

PAGE = '<html><head><script>window.__HERMES_SESSION_TOKEN__="s3cret";window.__HERMES_AUTH_REQUIRED__=false;</script></head></html>'

# A stand-in for Hermes's module, as it is when the dashboard imports the plugin: the app exists and hasn't started.
app = fastapi.FastAPI()
sys.modules["hermes_cli"] = types.ModuleType("hermes_cli")
sys.modules["hermes_cli.web_server"] = types.SimpleNamespace(app=app)


@app.get("/api/thing")
def thing():
    return JSONResponse({"s": 'window.__HERMES_SESSION_TOKEN__="s3cret";'})


@app.get("/note.txt")
def note():
    return PlainTextResponse('window.__HERMES_SESSION_TOKEN__="s3cret";')


@app.get("/{path:path}")
def spa(path: str):
    return HTMLResponse(PAGE)


tmp = tempfile.mkdtemp()
keyfile = os.path.join(tmp, "key")
with open(keyfile, "w") as f:
    f.write("the-key\n")
os.environ["HM_DASH_KEY_FILE"] = keyfile

spec = importlib.util.spec_from_file_location("plugin_api", os.path.join(PLUGIN, "dashboard", "plugin_api.py"))
papi = importlib.util.module_from_spec(spec)
sys.modules["plugin_api"] = papi
spec.loader.exec_module(papi)

check("the guard is installed on import", any(m.cls is papi._TokenGuard for m in app.user_middleware))
papi._install_token_guard()
check("importing twice installs it once", sum(m.cls is papi._TokenGuard for m in app.user_middleware) == 1)

client = TestClient(app)
HEADER = "X-Hermes-Mobile-Key"


def withheld(r):
    return "s3cret" not in r.text and "__HERMUX_TOKEN_WITHHELD__" in r.text


r = client.get("/")
check("no key: the token is withheld", withheld(r), r.text)
check("no key: the rest of the page stays", "__HERMES_AUTH_REQUIRED__=false" in r.text and r.status_code == 200)
check("no key: Content-Length matches the shorter page", int(r.headers["content-length"]) == len(r.content))
check("no key: any other page too", withheld(client.get("/chat")))
check("a wrong key: withheld", withheld(client.get("/", headers={HEADER: "nope"})))
check("an empty key: withheld", withheld(client.get("/", headers={HEADER: ""})))
r = client.get("/", headers={HEADER: "the-key"})
check("the right key: the page has the token", 'window.__HERMES_SESSION_TOKEN__="s3cret";' in r.text, r.text)

check("REST answers pass unchanged", "s3cret" in client.get("/api/thing").text)
check("non-HTML passes unchanged", "s3cret" in client.get("/note.txt").text)

os.remove(keyfile)
check("key file missing: withheld, even for a caller sending a key", withheld(client.get("/", headers={HEADER: "the-key"})))
check("key file missing: an empty header doesn't match", withheld(client.get("/", headers={HEADER: ""})))
with open(keyfile, "w") as f:
    f.write("new-key")
check("a new key counts at once", "s3cret" in client.get("/", headers={HEADER: "new-key"}).text)
check("the old key stops counting", withheld(client.get("/", headers={HEADER: "the-key"})))

# Off a phone, loopback isn't shared: nothing to withhold (desktop development).
del os.environ["HM_DASH_KEY_FILE"]
real_isdir = os.path.isdir
os.path.isdir = lambda p: False if p == papi._TERMUX_HOME else real_isdir(p)
check("off a phone: pages stay as Hermes serves them", "s3cret" in client.get("/").text)
os.path.isdir = lambda p: True if p == papi._TERMUX_HOME else real_isdir(p)
check("on a phone, with no key file yet: withheld", withheld(client.get("/")))
os.path.isdir = real_isdir
os.environ["HM_DASH_KEY_FILE"] = keyfile

# The plugin's own calls (/approve, /stop): the token in process, else from a verified dashboard; never the key.
import urllib.request  # noqa: E402

sent = []


def no_page(*a, **k):
    sent.append(a)
    raise OSError("no loopback page here")


urllib.request.urlopen = no_page
sys.modules["hermes_cli.web_server"]._SESSION_TOKEN = "in-process-token"
check("_own_page_token takes the token in process", papi._own_page_token() == "in-process-token")
check("...and makes no request at all", sent == [])
sys.modules["hermes_cli.web_server"]._SESSION_TOKEN = "has a space"
sys.path.insert(0, HERE)
from local_auth_cases import TokenServer  # noqa: E402

_V = __import__("json").loads(open(os.path.join(HERE, "local-auth-vectors.json"), encoding="utf-8").read())
_la = papi._local_auth()
with open(keyfile, "w") as f:
    f.write(_V["key"])
for case in _V["token_cases"][:2]:
    ts = TokenServer(_la, _V["key"], _V["other_key"], case)
    got = papi._own_page_token(ts.port)
    want = case["token"] if case["expect"].startswith("token ") else ""
    check(f"no usable token in process: a verified dashboard's token only ({case['name']})", got == want and sent == [], got)
check("nothing listening: no token, nothing sent", papi._own_page_token(1) == "" and sent == [])
os.remove(keyfile)
check("no key: no token", papi._own_page_token(1) == "")
with open(keyfile, "w") as f:
    f.write("new-key")
del sys.modules["hermes_cli.web_server"]._SESSION_TOKEN
check("_own_port: the port of the dashboard that got the request",
      papi._own_port(types.SimpleNamespace(scope={"server": ("127.0.0.1", 9333)})) == 9333
      and papi._own_port(types.SimpleNamespace(scope={"server": ("::1", 9333)})) == 9119 and papi._own_port(None) == 9119)

# ── local authentication: GET /hermux/hello and GET /hermux/token, the REST proof, the enforced file ──
import json  # noqa: E402

la = papi._local_auth()
V = json.loads(open(os.path.join(HERE, "local-auth-vectors.json"), encoding="utf-8").read())
KEY, OTHER = V["key"], V["other_key"]
with open(keyfile, "w") as f:
    f.write(KEY + "\n")
WHERE = "127.0.0.1:9119"
server_seen = {"addr": ("127.0.0.1", 9119)}


async def on_loopback(scope, receive, send):
    """What uvicorn gives the app: the address of the socket the request came in on."""
    if scope["type"] == "http":
        scope = {**scope, "server": server_seen["addr"]}
    await app(scope, receive, send)


lc = TestClient(on_loopback)
hermes_saw = []


async def record(request, call_next):  # stands in for Hermes's own middleware: what reached Hermes
    hermes_saw.append(request.url.path)
    return await call_next(request)


from starlette.middleware import Middleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

app.user_middleware.append(Middleware(BaseHTTPMiddleware, dispatch=record))  # inside the guard, as Hermes's own are
app.middleware_stack = None  # rebuilt with it
lc.get("/api/thing")
check("the guard stays outside Hermes's middleware", hermes_saw == ["/api/thing"], hermes_saw)


def guard():
    g = app.middleware_stack
    while g is not None and not isinstance(g, papi._TokenGuard):
        g = getattr(g, "app", None)
    return g


def say_hello(nc=None):
    nc = nc or la.nonce()
    r = lc.get(f"/hermux/hello?v=1&nc={nc}")
    return nc, r


def token_auth(nc, ns, key=KEY, path="/hermux/token", body=b"", kid=None, hdr_nc=None, where=WHERE):
    m = la.mac(key, "client", "dashboard", where, nc, ns, f"GET {path}", la.sha256hex(body))
    return f"1 {kid or la.kid(key)} {ns} {hdr_nc or nc} {m}"


hermes_saw.clear()
nc, r = say_hello()
j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
check("hello: 200 JSON", r.status_code == 200 and j.get("hermux") == 1 and j.get("role") == "dashboard", r.text)
check("hello: names this server's own address and the key id", j.get("addr") == WHERE and j.get("kid") == V["kid"], j)
check("hello: the proof is over our nonce, its nonce and the address",
      la.same(j.get("proof"), la.mac(KEY, "server", "dashboard", WHERE, nc, j.get("ns"), "hello", la.EMPTY_HASH)))
check("hello: never cached", r.headers.get("cache-control") == "no-store")
check("hello: answered by the guard, Hermes never sees it", hermes_saw == [], hermes_saw)
for name, q in (("no nonce", "v=1"), ("no version", f"nc={la.nonce()}"), ("version 0", f"v=0&nc={la.nonce()}"),
                ("an upper-case nonce", f"v=1&nc={la.nonce().upper()}"), ("a short nonce", "v=1&nc=0011"),
                ("the nonce twice", f"v=1&nc={la.nonce()}&nc={la.nonce()}"), ("another argument", f"v=1&nc={la.nonce()}&x=1"),
                ("a bare argument", f"v=1&nc={la.nonce()}&x")):
    r = lc.get(f"/hermux/hello?{q}")
    check(f"hello with {name}: 400", r.status_code == 400 and "proof" not in r.text, r.status_code)
r = lc.get(f"/hermux/hello?v=1&nc={la.nonce()}&kid={V['kid']}&kid={V['kid']}")
check("hello with the kid hint twice: 400", r.status_code == 400 and "proof" not in r.text, r.status_code)
for name, h in (("its own kid", V["kid"]), ("another key's kid (one key here: ignored)", V["other_kid"]),
                ("a malformed hint (absent)", "XYZ"), ("an empty hint (absent)", "")):
    nc = la.nonce()
    r = lc.get(f"/hermux/hello?v=1&nc={nc}&kid={h}")
    j = r.json() if r.status_code == 200 else {}
    check(f"hello with {name}: the proof under its one key", r.status_code == 200 and j.get("kid") == V["kid"]
          and la.same(j.get("proof"), la.mac(KEY, "server", "dashboard", WHERE, nc, j.get("ns"), "hello", la.EMPTY_HASH)), r.text)
r = lc.post(f"/hermux/hello?v=1&nc={la.nonce()}")
check("hello: only GET", r.status_code == 405)
server_seen["addr"] = ("::1", 9119)
check("hello reached on another address: no proof", say_hello()[1].status_code == 503)
server_seen["addr"] = ("testserver", 80)
check("hello with no socket address: no proof", say_hello()[1].status_code == 503)
server_seen["addr"] = ("127.0.0.1", 9119)
with open(keyfile, "w") as f:
    f.write("too-short")
check("hello with a key too short to prove with: no proof", say_hello()[1].status_code == 503)
os.remove(keyfile)
check("hello with no key file: no proof", say_hello()[1].status_code == 503)
with open(keyfile, "w") as f:
    f.write(KEY + "\n")
check("the hello routes need no session token and pass nothing on", hermes_saw == [], hermes_saw)

web = sys.modules["hermes_cli.web_server"]
web._SESSION_TOKEN = "in-process-token-0123456789"
nc, r = say_hello()
ns = r.json()["ns"]
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)})
j = r.json()
check("token: 200 with the session token, taken in process", r.status_code == 200 and j.get("token") == web._SESSION_TOKEN, r.text)
check("token: the proof covers the token",
      la.same(j.get("proof"), la.mac(KEY, "answer", "dashboard", WHERE, nc, ns, "token", la.sha256hex(web._SESSION_TOKEN.encode()))))
check("token: never cached", r.headers.get("cache-control") == "no-store")
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)})
check("token: the same server nonce a second time is refused", r.status_code == 403 and r.json() == {"hermux": 1, "error": "refused"})
nc = la.nonce()
ns = lc.get(f"/hermux/hello?v=1&nc={nc}&kid={V['kid']}").json()["ns"]
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)})
check("token: after a hello with the kid hint, the token step works", r.status_code == 200 and r.json().get("token") == web._SESSION_TOKEN, r.text)
del web._SESSION_TOKEN
nc, r = say_hello()
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, r.json()["ns"])})
check("token: without the module variable, from the page Hermes renders", r.status_code == 200 and r.json().get("token") == "s3cret", r.text)
web._SESSION_TOKEN = "in-process-token-0123456789"


def refused(name, make, **kw):
    nc, r = say_hello()
    ns = r.json()["ns"]
    headers, body = make(nc, ns)
    r = lc.request("GET", kw.get("path", "/hermux/token"), headers=headers, content=body)
    check(f"token refused: {name}", r.status_code == 403 and "token" not in r.json(), (r.status_code, r.text))
    return nc, ns


refused("no X-Hermux-Auth", lambda nc, ns: ({}, b""))
refused("the same-connection form (no client nonce)",
        lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns).replace(f" {nc} ", " ")}, b""))
refused("signed with another key", lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns, key=OTHER, kid=V["kid"])}, b""))
refused("another key id", lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns, kid=V["other_kid"])}, b""))
refused("another client nonce", lambda nc, ns: ({"X-Hermux-Auth": token_auth(la.nonce(), ns)}, b""))
refused("the client nonce in the header differs from the signed one",
        lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns, hdr_nc=la.nonce())}, b""))
refused("an unknown server nonce", lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, la.nonce())}, b""))
refused("signed for another path", lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns, path="/hermux/token?x=1")}, b""))
refused("a query added after signing", lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns)}, b""), path="/hermux/token?x=1")
refused("a body changed after the MAC", lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns, body=b"abc")}, b"abd"))
nc, r = say_hello()
ns = r.json()["ns"]
r = lc.request("GET", "/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns, body=b"abc")}, content=b"abc")
check("token: the MAC is over the raw body bytes", r.status_code == 200, r.text)
nc, ns = refused("a wrong MAC", lambda nc, ns: ({"X-Hermux-Auth": token_auth(nc, ns, key=OTHER, kid=V["kid"])}, b""))
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)})
check("token: a refused attempt uses the server nonce up", r.status_code == 403)
nc, r = say_hello()
ns = r.json()["ns"]
r = lc.get("/hermux/token", headers=[("X-Hermux-Auth", token_auth(nc, ns)), ("X-Hermux-Auth", token_auth(nc, ns))])
check("token: X-Hermux-Auth twice is refused", r.status_code == 403)
nc, r = say_hello()
ns = r.json()["ns"]
r = lc.request("GET", "/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)}, content=b"x" * 5000)
check("token: a body over 4 KiB is refused", r.status_code == 413)
nc, r = say_hello()
ns = r.json()["ns"]
with open(keyfile, "w") as f:
    f.write(OTHER + "\n")
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)})
check("token: a key changed since the hello is refused", r.status_code == 403)
nc, r = say_hello()  # proved under the new key ...
ns = r.json()["ns"]
with open(keyfile, "w") as f:
    f.write(KEY + "\n")  # ... which changes back before the token step, signed under the key now in the file
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns, kid=V["other_kid"])})
check("token: the key id of the hello must still be the current one", r.status_code == 403)
with open(keyfile, "w") as f:
    f.write(OTHER + "\n")
nc, r = say_hello()
ns = r.json()["ns"]
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns, key=OTHER)})
check("token: ... and the new key works at once", r.status_code == 200)
with open(keyfile, "w") as f:
    f.write(KEY + "\n")
nc, r = say_hello()
ns = r.json()["ns"]
server_seen["addr"] = ("127.0.0.1", 9229)
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns, where="127.0.0.1:9229")})
check("token: asked on another address than the hello (signed for that address)", r.status_code == 403)
server_seen["addr"] = ("127.0.0.1", 9119)
check("token: only GET", lc.post("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)}).status_code == 405)

g = guard()
now = [5000.0]
g._pending = la.PendingHellos(clock=lambda: now[0])
nc, r = say_hello()
ns = r.json()["ns"]
now[0] += 10.5
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, ns)})
check("token: a server nonce older than 10 s is refused", r.status_code == 403)
first = say_hello()
first = (first[0], first[1].json()["ns"])
for _ in range(256):
    last = say_hello()
last = (last[0], last[1].json()["ns"])
check("a flood of hellos keeps at most 256", len(g._pending) == 256, len(g._pending))
check("... dropping the oldest", lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(*first)}).status_code == 403)
check("... and the newest still works", lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(*last)}).status_code == 200)

hermes_saw.clear()
nc = la.nonce()
r = lc.get("/api/thing", headers={"X-Hermux-Nonce": nc})
proof = r.headers.get("x-hermux-proof", "")
kid_, _, m = proof.partition(" ")[2].partition(" ")
check("REST: the answer carries a proof", proof.startswith("1 ") and kid_ == V["kid"]
      and la.same(m, la.mac(KEY, "answer", "dashboard", WHERE, nc, "-", "rest 200", la.EMPTY_HASH)), proof)
check("REST: the body is untouched and Hermes answered it", "s3cret" in r.text and hermes_saw == ["/api/thing"])
r = lc.post("/api/thing", headers={"X-Hermux-Nonce": nc})  # GET only: 405
m = r.headers.get("x-hermux-proof", "").split(" ")[-1]
check("REST: the proof covers the status", r.status_code == 405
      and la.same(m, la.mac(KEY, "answer", "dashboard", WHERE, nc, "-", "rest 405", la.EMPTY_HASH))
      and not la.same(m, la.mac(KEY, "answer", "dashboard", WHERE, nc, "-", "rest 200", la.EMPTY_HASH)), (r.status_code, m))
check("REST: no nonce, no proof", "x-hermux-proof" not in lc.get("/api/thing").headers)
check("REST: a malformed nonce, no proof", "x-hermux-proof" not in lc.get("/api/thing", headers={"X-Hermux-Nonce": "abc"}).headers)
check("REST: the nonce twice, no proof", "x-hermux-proof" not in lc.get("/api/thing", headers=[("X-Hermux-Nonce", nc)] * 2).headers)
server_seen["addr"] = ("::1", 9119)
check("REST: reached on another address, no proof", "x-hermux-proof" not in lc.get("/api/thing", headers={"X-Hermux-Nonce": nc}).headers)
server_seen["addr"] = ("127.0.0.1", 9119)
check("REST: pages get no proof", "x-hermux-proof" not in lc.get("/", headers={"X-Hermux-Nonce": nc}).headers)

r = lc.get("/", headers={HEADER: KEY})
check("the page: the raw key still gets the token before enforcement", 's3cret' in r.text, r.text)
enforced = os.path.join(tmp, "enforced")
open(enforced, "w").close()
check("the page: once enforced, the raw key gets it withheld", withheld(lc.get("/", headers={HEADER: KEY})))
nc, r = say_hello()
r = lc.get("/hermux/token", headers={"X-Hermux-Auth": token_auth(nc, r.json()["ns"])})
check("once enforced, the token step still works", r.status_code == 200 and r.json().get("token"))
# The raw key after the switch: refused like anyone else, and reported at most once a day (a diagnostic event and a
# signed local_legacy event to the app, which then replaces the key).
notes, reports = [], []
real_diag, real_report = papi._diag_mod, papi._report_legacy
papi._diag_mod = lambda: types.SimpleNamespace(event=lambda *a, **k: notes.append((a, k)))
papi._report_legacy = lambda la_, key: reports.append(key)
papi._legacy_daily = None


def settle():
    import time as _t
    end = _t.time() + 3
    while _t.time() < end and len(reports) < len(notes):
        _t.sleep(0.02)


check("once enforced, the raw key gets the withheld page", withheld(lc.get("/", headers={HEADER: KEY})))
settle()
check("... reported: local legacy_key port=dashboard side=plugin, and the app told with the current key",
      notes == [(("local", "legacy_key"), {"port": "dashboard", "side": "plugin"})] and reports == [KEY], (notes, reports))
check("... a second time that day: withheld, not reported again", withheld(lc.get("/", headers={HEADER: KEY})) and len(notes) == 1)
papi._legacy_daily.last -= 86400
check("... the next day: reported again", withheld(lc.get("/", headers={HEADER: KEY})) and len(notes) == 2)
settle()
check("... each report tells the app once", len(reports) == 2, reports)
papi._legacy_daily.last -= 86400
check("a wrong raw key after the switch: withheld, not reported (it is no key of ours)", withheld(lc.get("/", headers={HEADER: KEY + "x"})) and len(notes) == 2)
check("no key after the switch: withheld, not reported", withheld(lc.get("/")) and len(notes) == 2)
os.remove(enforced)
check("before the switch the raw key is never reported", "s3cret" in lc.get("/", headers={HEADER: KEY}).text and len(notes) == 2)
open(enforced, "w").close()
calls = []
papi._report_legacy = real_report
la_mod = papi._local_auth()
real_rl = la_mod.report_legacy
la_mod.report_legacy = lambda port, key, *a, **k: calls.append((port, key)) or True
papi._legacy_daily = None
lc.get("/", headers={HEADER: KEY})
import time as _time
for _ in range(100):
    if calls:
        break
    _time.sleep(0.02)
check("the report goes through local_auth.report_legacy as port dashboard", calls == [("dashboard", KEY)], calls)
la_mod.report_legacy = real_rl
papi._diag_mod = real_diag
os.remove(enforced)
check("the page: the raw key works again without the file", "s3cret" in lc.get("/", headers={HEADER: KEY}).text)

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
