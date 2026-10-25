#!/usr/bin/env python3
"""Tests for the plugin's /media endpoint (byte ranges for the app's players). Needs fastapi + httpx:
    python3 tools/test_media.py
"""
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("plugin_api", os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile", "dashboard", "plugin_api.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


pr = api.parse_range
check("no header → whole file", pr(None, 100) is None)
check("bytes=0- → all", pr("bytes=0-", 100) == (0, 99))
check("bytes=10-19", pr("bytes=10-19", 100) == (10, 19))
check("end clamped", pr("bytes=90-500", 100) == (90, 99))
check("suffix bytes=-10", pr("bytes=-10", 100) == (90, 99))
check("suffix larger than file", pr("bytes=-500", 100) == (0, 99))
check("start past end → 416", pr("bytes=100-", 100) == "bad")
check("reversed → 416", pr("bytes=20-10", 100) == "bad")
check("multi-range ignored (whole file)", pr("bytes=0-1,5-6", 100) is None)
check("garbage ignored", pr("items=0-5", 100) is None)

# The plugin's own WebSocket calls (/approve, /stop) take the token from the dashboard process, not from its page.
import types  # noqa: E402

page_calls = []
fake_page = lambda: page_calls.append(1) or '<script>window.__HERMES_SESSION_TOKEN__="from-page";</script>'
os.environ.pop("HERMES_DASHBOARD_SESSION_TOKEN", None)
saved = sys.modules.get("hermes_cli.web_server")
sys.modules["hermes_cli.web_server"] = types.SimpleNamespace(_SESSION_TOKEN="in-process")
check("token: the dashboard process's own, page untouched", api.dashboard_token(fake_page) == "in-process" and not page_calls)
sys.modules.pop("hermes_cli.web_server")
os.environ["HERMES_DASHBOARD_SESSION_TOKEN"] = "minted"
check("token: the minted env token when the module isn't loaded", api.dashboard_token(fake_page) == "minted" and not page_calls)
os.environ.pop("HERMES_DASHBOARD_SESSION_TOKEN")
check("token: an older Hermes's page as the last resort", api.dashboard_token(fake_page) == "from-page")
check("token: none at all → empty (503)", api.dashboard_token(lambda: "<html></html>") == "" and api.dashboard_token() == "")
if saved is not None:
    sys.modules["hermes_cli.web_server"] = saved

app = FastAPI()
app.include_router(api.router, prefix="/api/plugins/hermes-mobile")
c = TestClient(app)
d = tempfile.mkdtemp()
f = os.path.join(d, "clip.mp4")
data = bytes(range(256)) * 4000  # 1 MB
open(f, "wb").write(data)
r = c.get("/api/plugins/hermes-mobile/media", params={"path": f})
check("200 whole file", r.status_code == 200 and r.content == data and r.headers["accept-ranges"] == "bytes", r.status_code)
check("content type from extension", r.headers["content-type"].startswith("video/mp4"), r.headers.get("content-type"))
r = c.get("/api/plugins/hermes-mobile/media", params={"path": f}, headers={"Range": "bytes=1000-1999"})
check("206 range", r.status_code == 206 and r.content == data[1000:2000] and r.headers["content-range"] == f"bytes 1000-1999/{len(data)}", r.headers)
check("range length header", r.headers["content-length"] == "1000")
r = c.get("/api/plugins/hermes-mobile/media", params={"path": f}, headers={"Range": f"bytes={len(data)}-"})
check("416 past the end", r.status_code == 416 and r.headers["content-range"] == f"bytes */{len(data)}")
r = c.get("/api/plugins/hermes-mobile/media", params={"path": os.path.join(d, "nope.mp4")})
check("404 missing", r.status_code == 404)
r = c.get("/api/plugins/hermes-mobile/media", params={"path": d})
check("404 for a directory", r.status_code == 404)

print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
