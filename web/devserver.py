#!/usr/bin/env python3
"""Development server: serves dist/index.html on 127.0.0.1:5180 and injects the Hermes
dashboard session token (read from http://127.0.0.1:9119, e.g. the phone via
`adb forward tcp:9119 tcp:9119`) into sessionStorage — the same job the Android shell's
bridge does. The token never appears in a URL. Loopback only."""
import http.server
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

DIST = Path(__file__).resolve().parent / "dist" / "index.html"
HERMES = "http://127.0.0.1:9119"
_phone_token = None  # read once from the phone (an ssh round trip)


def hermes_token() -> str:
    try:
        html = urllib.request.urlopen(HERMES + "/", timeout=5).read().decode()
        m = re.search(r'__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"', html)
        if m:  # an older Hermes: the token is in its page
            return m.group(1)
    except Exception:
        return ""
    # The page no longer carries it (hermes/patches/0004): $HM_DASH_TOKEN, else Termux's file over tools/phone (ssh).
    if os.environ.get("HM_DASH_TOKEN"):
        return os.environ["HM_DASH_TOKEN"]
    global _phone_token
    if _phone_token is None:
        try:
            phone = Path(__file__).resolve().parent.parent / "tools" / "phone"
            _phone_token = subprocess.run([str(phone), "cat ~/.hermes-mobile/dash-token"], capture_output=True, text=True, timeout=30).stdout.strip()
        except Exception:
            _phone_token = ""
    return _phone_token


class Handler(http.server.BaseHTTPRequestHandler):
    def _proxy(self):
        """/__api/<path> → Hermes dashboard with the session token (the bridge's httpAsync job)."""
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(HERMES + self.path[len("/__api"):], data=body, method=self.command,
                                     headers={"X-Hermes-Session-Token": hermes_token(),
                                              "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                status, data = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, data = e.code, e.read()
        except Exception as e:  # unreachable
            status, data = 502, json.dumps({"detail": str(e)}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self._proxy() if self.path.startswith("/__api/") else self.send_error(404)

    def do_PUT(self):
        self._proxy() if self.path.startswith("/__api/") else self.send_error(404)

    def do_PATCH(self):
        self._proxy() if self.path.startswith("/__api/") else self.send_error(404)

    def do_DELETE(self):
        self._proxy() if self.path.startswith("/__api/") else self.send_error(404)

    def do_GET(self):
        if self.path.startswith("/__api/"):
            self._proxy()
            return
        path = self.path.split("?")[0]
        if path == "/__token":  # fresh token per connect, like the Android bridge
            body = json.dumps({"token": hermes_token()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path not in ("/", "/index.html"):
            self.send_error(404)
            return
        token = hermes_token()
        inject = (
            "<script>sessionStorage.setItem('hm.devToken',%s);sessionStorage.setItem('hm.devBase',%s)</script>"
            % (json.dumps(token), json.dumps(HERMES))
        )
        body = DIST.read_text(encoding="utf-8").replace("<head>", "<head>" + inject, 1).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", 5180), Handler).serve_forever()
