"""A loopback stand-in for a local server (the app's listener, the background host, the dashboard guard) for the client
tests of local authentication, built from the server halves of hermes-plugin/hermes-mobile/local_auth.py. Stdlib only.

It records every byte it receives, so a test can check what a client sent before and after the hello. ``mode`` says how
it answers the hello:

    honest      proves with its key for the address it listens on, then checks the request's X-Hermux-Auth (the same
                connection, local_auth.request_ok) and hands a good request to ``handler``; anything else gets 403
    wrong_key   proves with another key (so it names another key id)
    bad_proof   names the right key id but proves with another key
    wrong_addr  proves for another port (a server elsewhere, relayed)
    wrong_role  proves for another role
    silent      reads, never answers
    garbage     answers bytes that aren't HTTP, then closes
    no_hello    an old server: 403 to the hello, as the app's listener before local authentication
    refuse      a good hello, then 403 to the request

``handler(method, target, headers, body)`` returns ``(status, body bytes)``, ``(status, body bytes, content type)``, or a
function that writes the whole answer to the connection itself.
``key`` may be a function (the background host's key changes with every start). Use in-process (``FakeLocal``) or
as a program for the shell tests:

    python3 tools/local_fake_server.py ROLE MODE KEYFILE DIR [STATUS]

which writes its port to DIR/port, each request it receives to DIR/req.N (head and body as received) and each
verified request's body to DIR/body.N, answers verified requests with STATUS (default 204), and runs until killed.
"""
import importlib.util
import json
import os
import re
import socket
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "hermes-plugin" / "hermes-mobile"
MODES = ("honest", "wrong_key", "bad_proof", "wrong_addr", "wrong_role", "silent", "garbage", "no_hello", "refuse")
OTHER_KEY = "0b8e1c4f7a2d5e9036c1f8a4d7b2e6093c5a8f1e4d7b0a26"


def load_local_auth():
    mod = sys.modules.get("hm_local_auth")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_local_auth", PLUGIN / "local_auth.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sys.modules["hm_local_auth"] = mod
    return mod


def _read_request(c, buf: bytes):
    """(head, body, rest) of one request from ``buf`` plus what ``c`` sends, or None when the stream ends first."""
    while b"\r\n\r\n" not in buf:
        d = c.recv(65536)
        if not d:
            return None
        buf += d
        if len(buf) > 1 << 20:
            return None
    head, _, rest = buf.partition(b"\r\n\r\n")
    m = re.search(rb"\r\ncontent-length: *(\d+)", head, re.I)
    n = int(m.group(1)) if m else 0
    while len(rest) < n:
        d = c.recv(65536)
        if not d:
            break
        rest += d
    return head, rest[:n], rest[n:]


def _headers(head: bytes) -> dict:
    out = {}
    for line in head.split(b"\r\n")[1:]:
        k, _, v = line.partition(b":")
        out[k.strip().lower().decode("latin-1")] = v.strip(b" \t").decode("latin-1")
    return out


def _answer(c, status: int, body: bytes, ctype: str = "application/json", close: bool = True) -> None:
    head = f"HTTP/1.1 {status} X\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
    if close:
        head += "Connection: close\r\n"
    c.sendall(head.encode() + b"\r\n" + body)


class FakeLocal:
    def __init__(self, role: str, key, mode: str = "honest", handler=None, port: int = 0):
        assert mode in MODES, mode
        self.la = load_local_auth()
        self.role, self._key, self.mode = role, key, mode
        self.handler = handler or (lambda method, target, headers, body: (204, b""))
        self.raw = []        # every request as received: (head bytes, body bytes)
        self.verified = []   # (method, target, body) of every request that passed the MAC check
        self.hellos = 0
        self._lock = threading.Lock()
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", port))
        self.srv.listen(16)
        self.port = self.srv.getsockname()[1]
        self._stop = False
        threading.Thread(target=self._loop, daemon=True).start()

    @property
    def key(self) -> str:
        return self._key() if callable(self._key) else self._key

    def received(self) -> bytes:
        """Every byte any client sent, joined."""
        with self._lock:
            return b"".join(h + b"\r\n\r\n" + b for h, b in self.raw)

    def close(self) -> None:
        self._stop = True
        try:
            self.srv.close()
        except OSError:
            pass

    def _loop(self) -> None:
        while not self._stop:
            try:
                c, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(c,), daemon=True).start()

    def _serve(self, c) -> None:
        with c:
            try:
                c.settimeout(10)
                self._exchange(c)
            except Exception:  # a key it can't prove with, a client gone: the connection just ends
                pass

    def _exchange(self, c) -> None:
        la = self.la
        got = _read_request(c, b"")
        if got is None:
            return
        head, body, rest = got
        with self._lock:
            self.raw.append((head, body))
        line = head.split(b"\r\n", 1)[0].decode("latin-1")
        parts = line.split(" ")
        target = parts[1] if len(parts) == 3 else ""
        where = la.addr(self.port)
        if not target.startswith("/hermux/hello?"):
            # No hello first: as the servers do for a request without one (the raw key is never taken here).
            if self.mode != "silent":
                _answer(c, 403, b'{"ok":false,"error":"forbidden"}')
            return
        if self.mode == "silent":
            c.settimeout(3)
            try:
                c.recv(1)
            except OSError:
                pass
            return
        if self.mode == "garbage":
            c.sendall(b"\x00\x01 not http at all\r\n\r\n")
            return
        if self.mode == "no_hello":
            _answer(c, 403, b"")
            return
        args = la.hello_args(target.split("?", 1)[1])
        if args is None:
            _answer(c, 400, b"{}")
            return
        nc, _hint = args
        key = self.key
        self.hellos += 1
        if self.mode == "wrong_key":
            ns, j = la.hello_answer(OTHER_KEY, self.role, where, nc)
        elif self.mode == "bad_proof":
            ns, j = la.hello_answer(OTHER_KEY, self.role, where, nc)
            j["kid"] = la.kid(key)
        elif self.mode == "wrong_addr":
            other = la.addr(self.port + 1 if self.port < 65535 else self.port - 1)
            ns, j = la.hello_answer(key, self.role, other, nc)
        elif self.mode == "wrong_role":
            other = next(r for r in la.ROLES if r != self.role)
            ns, j = la.hello_answer(key, other, where, nc)
        else:
            ns, j = la.hello_answer(key, self.role, where, nc)
        _answer(c, 200, json.dumps(j).encode(), close=False)
        got = _read_request(c, rest)
        if got is None:
            return
        head, body, _ = got
        with self._lock:
            self.raw.append((head, body))
        line = head.split(b"\r\n", 1)[0].decode("latin-1")
        parts = line.split(" ")
        if len(parts) != 3:
            return _answer(c, 400, b"{}")
        method, target = parts[0], parts[1]
        headers = _headers(head)
        auth = la.parse_auth(headers.get("x-hermux-auth"))
        ok = (self.mode == "honest" and auth is not None and la.same(auth[0], la.kid(key)) and la.same(auth[1], ns)
              and la.request_ok(key, self.role, where, nc, ns, method, target, body, auth[3]))
        if not ok:
            return _answer(c, 403, b'{"ok":false,"error":"forbidden"}')
        with self._lock:
            self.verified.append((method, target, body))
        out = self.handler(method, target, headers, body)
        if callable(out):
            return out(c)  # it writes the whole answer itself (a slow one, say)
        status, data = out[0], out[1]
        ctype = out[2] if len(out) > 2 else "application/json"
        _answer(c, status, data, ctype)


def main(argv) -> int:
    role, mode, keyfile, out = argv[:4]
    status = int(argv[4]) if len(argv) > 4 else 204
    out = Path(out)
    n = [0]

    def key():
        return Path(keyfile).read_text().strip()

    def handler(method, target, headers, body):
        (out / f"body.{len(srv.verified) - 1}").write_bytes(body)
        return status, b""

    srv = FakeLocal(role, key, mode, handler)
    orig = srv._exchange

    def recording(c):
        before = len(srv.raw)
        try:
            orig(c)
        finally:
            for h, b in srv.raw[before:]:
                (out / f"req.{n[0]}").write_bytes(h + b"\r\n\r\n" + b)
                n[0] += 1

    srv._exchange = recording
    tmp = out / "port.tmp"
    tmp.write_text(str(srv.port))
    os.replace(tmp, out / "port")
    threading.Event().wait()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
