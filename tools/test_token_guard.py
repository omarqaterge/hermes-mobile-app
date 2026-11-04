"""The plugin's session token guard (dashboard/plugin_api.py _TokenGuard).

Every app on an Android phone shares 127.0.0.1, so a page holding the dashboard's session token must only go to a caller
with the app's event key. tools/hermes-contract checks the same against the real, pinned Hermes.
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

# The plugin's own calls (/approve, /stop) send the key.
import urllib.request  # noqa: E402

seen = {}


class Page:
    def read(self):
        return PAGE.encode()


def fake_open(req, timeout=None):
    seen["key"] = req.get_header(HEADER.capitalize())
    return Page()


urllib.request.urlopen = fake_open
check("_own_page_token reads the token", papi._own_page_token() == "s3cret")
check("_own_page_token sends the key", seen.get("key") == "new-key", seen)

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
