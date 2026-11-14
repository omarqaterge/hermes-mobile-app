"""The shared token cases of tools/local-auth-vectors.json (``token_cases``), played by a one-connection loopback server.

The server answers the dashboard hello and checks the token request with the server half of local_auth.py
(``hello_answer``, ``parse_auth(..., with_nc=True)`` and ``request_ok``, as the dashboard guard does): a request it would
refuse gets the guard's 403, whatever the case says. Only then does it send the case's answer. Used by
tools/test_local_auth.py (the plugin's client) and tools/test_hm_local.sh (hm-local). Stdlib only.
"""
import json
import re
import socket
import threading


def _read_request(c):
    buf = b""
    while b"\r\n\r\n" not in buf:
        d = c.recv(4096)
        if not d:
            return None
        buf += d
        if len(buf) > 65536:
            return None
    head, _, rest = buf.partition(b"\r\n\r\n")
    m = re.search(rb"\r\ncontent-length: *(\d+)", head, re.I)
    n = int(m.group(1)) if m else 0
    while len(rest) < n:
        d = c.recv(4096)
        if not d:
            break
        rest += d
    return head, rest[:n]


def _header(head, name):
    for line in head.split(b"\r\n")[1:]:
        k, _, v = line.partition(b":")
        if k.strip().lower() == name:
            return v.strip(b" \t")
    return None


def token_answer(la, key, other_key, case, where, nc, ns):
    """The raw bytes of the case's answer for this exchange."""
    tok = case["token"]
    how = case.get("proof", "good")
    if how == "other_key":
        p = la.mac(other_key, "answer", "dashboard", where, nc, ns, "token", la.sha256hex(tok.encode()))
    elif how == "other_token":
        p = la.mac(key, "answer", "dashboard", where, nc, ns, "token", la.sha256hex((tok + "-other").encode()))
    elif how == "client_dir":
        p = la.mac(key, "client", "dashboard", where, nc, ns, "token", la.sha256hex(tok.encode()))
    elif how == "swapped":
        p = la.mac(key, "answer", "dashboard", where, ns, nc, "token", la.sha256hex(tok.encode()))
    elif how == "other_addr":  # as a server on another port would prove it
        port = int(where.rsplit(":", 1)[1])
        p = la.mac(key, "answer", "dashboard", la.addr(port + 1 if port < 65535 else port - 1), nc, ns, "token",
                   la.sha256hex(tok.encode()))
    elif how == "other_role":
        p = la.mac(key, "answer", "events", where, nc, ns, "token", la.sha256hex(tok.encode()))
    elif how == "replay":  # a proof recorded from an earlier exchange: its own pair of nonces
        p = la.mac(key, "answer", "dashboard", where, la.nonce(), la.nonce(), "token", la.sha256hex(tok.encode()))
    else:
        p = la.mac(key, "answer", "dashboard", where, nc, ns, "token", la.sha256hex(tok.encode()))
        if how == "upper":
            p = p.upper()
    vals = {"hermux": "1", "token": json.dumps(tok), "proof": json.dumps(p)}
    vals.update(case.get("set") or {})
    body = "{" + ",".join(f'"{k}":{v}' for k, v in vals.items())
    if case.get("repeat"):
        body += f',"{case["repeat"]}":"x"'
    body += "}"
    t = re.sub(r"\{PAD:(\d+)\}", lambda m: "x" * int(m.group(1)), case["answer"])
    return t.replace("{LEN}", str(len(body.encode()))).replace("{BODY}", body).encode("latin-1")


class TokenServer:
    """One connection: the dashboard hello, then the token request checked as the guard checks it, then the case."""

    def __init__(self, la, key, other_key, case):
        self.la, self.key, self.other, self.case = la, key, other_key, case
        self.header_ok = None  # the token request's X-Hermux-Auth passed parse_auth(with_nc=True) and request_ok
        self.hint = None  # the kid hint the client's hello named
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(2)
        self.port = self.sock.getsockname()[1]
        self.done = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            c, _ = self.sock.accept()
            c.settimeout(10)
            try:
                self._play(c)
            except OSError:
                pass
            finally:
                c.close()
        finally:
            self.sock.close()
            self.done.set()

    def _play(self, c):
        la, key = self.la, self.key
        where = la.server_addr("127.0.0.1", self.port)
        r = _read_request(c)
        m = re.match(rb"GET /hermux/hello\?(\S+) HTTP/1\.1\r\n", r[0] if r else b"")
        args = la.hello_args(m.group(1)) if m else None  # the guard's own parsing (the kid hint is optional)
        if not args:
            return
        nc, self.hint = args
        ns, j = la.hello_answer(la.hello_key([key], self.hint), "dashboard", where, nc)
        body = json.dumps(j).encode()
        c.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n" % len(body) + body)
        r = _read_request(c)
        if r is None:
            return
        head, data = r
        line = head.split(b"\r\n")[0].decode("latin-1").split(" ")
        auth = la.parse_auth(_header(head, b"x-hermux-auth"), with_nc=True)
        self.header_ok = bool(
            auth and len(line) == 3 and line[0] == "GET" and line[1] == "/hermux/token" and la.same(auth[1], ns)
            and la.same(auth[2], nc) and la.same(auth[0], la.kid(key))
            and la.request_ok(key, "dashboard", where, nc, ns, "GET", line[1], data, auth[3]))
        if not self.header_ok:
            out = b'{"hermux":1,"error":"refused"}'
            c.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n" % len(out) + out)
            return
        c.sendall(token_answer(la, key, self.other, self.case, where, nc, ns))


def outcome(fn):
    """What a client call gave, in the vectors' words: 'token <t>', a reason, 'error <message>' or 'escaped <type>'."""
    try:
        return "token " + fn()
    except Exception as e:  # noqa: BLE001 - the point is to name whatever came out
        why = getattr(e, "why", None)
        if why:
            return why
        if isinstance(e, OSError):
            return f"error {e}"
        return f"escaped {type(e).__name__}"
