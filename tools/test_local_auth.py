"""Local authentication, Python side (hermes-plugin/hermes-mobile/local_auth.py): the shared vectors in
tools/local-auth-vectors.json, same() and the nonce shape, and the client against fake local servers on loopback sockets:
an honest one, one with the wrong key, the wrong address, the wrong role, an old version, garbage, too much, silence, a
slow trickle, an early close and a replayed proof. After a failed hello the fake server must have received nothing but
the hello. Then the server halves: the hello answer, the request MAC over the raw body, the dashboard guard's pending
server nonces (single use, 10 s, at most 256) and the key file cache (an empty file is never kept). Stdlib only.
Run: python3 tools/test_local_auth.py"""
import importlib.util
import json
import os
import re
import socket
import sys
import threading
import time
import tracemalloc
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "hermes-plugin" / "hermes-mobile"
spec = importlib.util.spec_from_file_location("hm_local_auth", PLUGIN / "local_auth.py")
la = importlib.util.module_from_spec(spec)
sys.modules["hm_local_auth"] = la
spec.loader.exec_module(la)

V = json.loads((HERE / "local-auth-vectors.json").read_text(encoding="utf-8"))
KEY, OTHER = V["key"], V["other_key"]
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (f" ({detail})" if detail and not cond else ""))
    if not cond:
        fails += 1


FIELDS = ("key", "dir", "role", "addr", "nc", "ns", "what", "hash")

print("vectors")
check("EMPTY_HASH matches the vectors", la.EMPTY_HASH == V["empty_hash"] == la.sha256hex(b""))
check("kid of the key", la.kid(KEY) == V["kid"], la.kid(KEY))
check("kid of the other key", la.kid(OTHER) == V["other_kid"])
check("kid of the padded key is the same", la.kid("  " + KEY + "\n") == V["kid"])
for s in V["sha256"]:
    check(f"sha256: {s['name']}", la.sha256hex(s["text"].encode("utf-8")) == s["hex"])
for m in V["macs"]:
    got = la.mac(*(m[f] for f in FIELDS))
    check(f"mac: {m['name']}", got == m["mac"], got)
    check(f"message text: {m['name']}", "\n".join([V["version"]] + [m[f] for f in FIELDS[1:]]) == m["msg"])
for m in V["mismatch"]:
    got = la.mac(*(m[f] for f in FIELDS))
    check(f"mismatch: {m['name']}", not la.same(got, m["mac"]))
base = V["macs"][0]
for r in V["rejected"]:
    f = {k: base[k] for k in FIELDS}
    f[r["field"]] = r["set"]
    try:
        la.mac(*(f[k] for k in FIELDS))
        check(f"rejected: {r['name']}", False, "no error")
    except ValueError as e:
        check(f"rejected: {r['name']}", str(e) == r["field"], str(e))
for s in V["not_nonce"]:
    check(f"not a nonce: {s!r}", not la.is_nonce(s))
for c in V["not_same"]:
    check(f"not same: {c['name']}", not la.same(c["a"], c["b"]))

print("same() and nonces")
m0 = base["mac"]
check("same: equal", la.same(m0, str(m0)))
check("same: different", not la.same(m0, V["macs"][1]["mac"]))
check("same: different length", not la.same(m0, m0[:-2]))
check("same: None", not la.same(None, m0) and not la.same(m0, None) and not la.same(None, None))
check("same: bytes are not text", not la.same(m0.encode(), m0))
check("same: non-ASCII text does not raise", not la.same("é" * 64, m0))
ns = {la.nonce() for _ in range(200)}
check("nonce: shape and freshness", len(ns) == 200 and all(la.is_nonce(n) for n in ns))
check("nonce: 32 lowercase hex", la.is_nonce("0" * 32) and not la.is_nonce("0" * 32 + "\n") and not la.is_nonce(None))
check("Unverified: an unknown reason becomes no_hello", la.Unverified("whatever").why == "no_hello")


# ---- fake servers ----

def read_request(c, limit=65536):
    """One HTTP request from a socket: (head bytes, body bytes), or None if the client closed."""
    buf = b""
    while b"\r\n\r\n" not in buf:
        d = c.recv(4096)
        if not d:
            return None
        buf += d
        if len(buf) > limit:
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


class Fake:
    """A one-connection-at-a-time loopback server. ``behave(conn, srv)`` plays the server; everything received is kept."""

    def __init__(self, behave):
        self.behave = behave
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 16)  # small, so large sends block everywhere
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(4)
        self.port = self.sock.getsockname()[1]
        self.received = b""
        self.verified = None
        self.proofs = []
        self.connections = 0
        self.done = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            while True:
                c, _ = self.sock.accept()
                self.connections += 1
                c.settimeout(8)
                rec = _Rec(c, self)
                try:
                    self.behave(rec, self)
                except Exception:
                    pass
                finally:
                    try:
                        # take whatever else the client sends before it closes, so a late request would be seen
                        c.settimeout(0.3)
                        while True:
                            d = c.recv(4096)
                            if not d:
                                break
                            self.received += d
                    except OSError:
                        pass
                    c.close()
                    self.done.set()
        except OSError:
            pass

    def close(self):
        self.sock.close()


class _Rec:
    def __init__(self, c, srv):
        self.c, self.srv = c, srv

    def recv(self, n):
        d = self.c.recv(n)
        self.srv.received += d
        return d

    def sendall(self, b):
        self.c.sendall(b)

    def settimeout(self, t):
        self.c.settimeout(t)


def hello_body(srv, nc, *, key=KEY, kid=None, role="events", addr=None, version=1, ns=None, proof=None, drop=None, extra=None,
               upper=False):
    ns = ns or la.nonce()
    addr = addr or f"127.0.0.1:{srv.port}"
    p = proof or la.mac(key, "server", role, addr, nc, ns, "hello", la.EMPTY_HASH)
    if upper:
        p = p.upper()
    srv.proofs.append((ns, p))
    j = {"hermux": version, "role": role, "kid": kid or la.kid(key), "ns": ns, "addr": addr, "proof": p}
    for k in drop or ():
        j.pop(k, None)
    j.update(extra or {})
    return json.dumps(j).encode(), ns


def http_answer(body, status="200 OK", extra_headers=b"", length=None):
    n = len(body) if length is None else length
    return (b"HTTP/1.1 " + status.encode() + b"\r\nContent-Type: application/json\r\nContent-Length: " + str(n).encode()
            + b"\r\n" + extra_headers + b"\r\n" + body)


def nc_of(head):
    m = re.match(rb"GET /hermux/hello\?v=1&nc=([0-9a-f]{32}) HTTP/1\.1\r\n", head)
    return m.group(1).decode() if m else None


def server(answer_status=b"204 No Content", answer=None, after=None, **hello):
    """An honest server (with options to make it dishonest): answers the hello, then checks the one request.
    ``answer`` replaces the answer to the request; ``after(c, srv)`` replaces everything after the hello."""
    def behave(c, srv):
        r = read_request(c)
        if r is None:
            return
        nc = nc_of(r[0])
        srv.hello_line_ok = nc is not None and b"\r\nHost: 127.0.0.1:%d" % srv.port in r[0]
        body, ns = hello_body(srv, nc, **hello)
        c.sendall(http_answer(body))
        if after:
            return after(c, srv)
        r2 = read_request(c)
        if r2 is None:
            return
        head, rbody = r2
        line = head.split(b"\r\n", 1)[0].decode()
        method, path, _ = line.split(" ")
        m = re.search(rb"\r\nX-Hermux-Auth: 1 ([0-9a-f]{8}) ([0-9a-f]{32}) ([0-9a-f]{64})(\r\n|$)", head)
        want = la.mac(KEY, "client", "events", f"127.0.0.1:{srv.port}", nc, ns, f"{method} {path}", la.sha256hex(rbody))
        srv.verified = bool(m) and m.group(2).decode() == ns and la.same(m.group(3).decode(), want)
        srv.request_body = rbody
        c.sendall(answer if answer is not None else b"HTTP/1.1 " + answer_status + b"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    return behave


def raw(data_fn):
    """Reads the hello, then sends whatever data_fn(srv, nc) returns (bytes), then waits a little."""
    def behave(c, srv):
        r = read_request(c)
        if r is None:
            return
        out = data_fn(srv, nc_of(r[0]))
        if out:
            c.sendall(out)
        time.sleep(0.3)
    return behave


def silent(c, srv):
    read_request(c)
    time.sleep(2.5)


def trickle(c, srv):
    read_request(c)
    for b in b"HTTP/1.1 200 OK\r\nContent-Length: 4000\r\n\r\n" + b"x" * 4000:
        c.sendall(bytes([b]))
        time.sleep(0.4)


def close_at_once(c, srv):
    pass


def only_hello_received(srv):
    return srv.received.count(b" HTTP/1.1\r\n") <= 1 and b"X-Hermux-Auth" not in srv.received and b"secret" not in srv.received


def expect(name, behave, why, timeout=3, max_s=None):
    srv = Fake(behave)
    t0 = time.monotonic()
    got = None
    try:
        s = la.session("events", srv.port, KEY, timeout=timeout)
        try:
            s.request("POST", "/event", b'{"secret":1}')
        except Exception:
            pass
        got = "verified"
    except la.Unverified as e:
        got = e.why
        check(f"{name}: the error text is only the reason", str(e) == e.why and KEY not in repr(e))
    took = time.monotonic() - t0
    srv.done.wait(5)
    check(f"{name}: {why}", got == why, got)
    check(f"{name}: nothing sent after the hello", only_hello_received(srv), srv.received[-200:])
    if max_s is not None:
        check(f"{name}: within {max_s} s", took < max_s, f"{took:.1f} s")
    srv.close()


print("client against fake servers")
srv = Fake(server())
s = la.session("events", srv.port, KEY)
a = s.request("POST", "/event", b'{"kind":"reply"}')
srv.done.wait(5)
check("honest: the hello request line and Host header", getattr(srv, "hello_line_ok", False))
check("honest: verified, one request sent, answer 204", a.status == 204 and srv.verified is True, (a.status, srv.verified))
check("honest: the server saw the body as sent", srv.request_body == b'{"kind":"reply"}')
check("honest: kid is the key's", s.kid == V["kid"])
try:
    s.request("POST", "/event", b"{}")
    check("a session sends one request only", False)
except RuntimeError:
    check("a session sends one request only", True)
srv.close()

srv = Fake(server(answer_status=b"403 Forbidden"))
try:
    la.session("events", srv.port, KEY).request("POST", "/event", b"{}")
    check("refused: a 403 after a good hello", False, "no error")
except la.Unverified as e:
    check("refused: a 403 after a good hello", e.why == "refused", e.why)
srv.close()

srv = Fake(server())
s = la.session("events", srv.port, KEY)
try:
    s.request("POST", "/event\r\nX-Injected: 1", b"{}")
    check("a path with CR LF is refused before sending", False)
except ValueError:
    srv.done.wait(5)
    check("a path with CR LF is refused before sending", only_hello_received(srv) and b"X-Injected" not in srv.received)
srv.close()

expect("wrong key, its own kid", server(key=OTHER), "unknown_kid")
expect("wrong key, our kid", server(key=OTHER, kid=V["kid"]), "bad_proof")
expect("wrong address (a proof for another port)", server(addr="127.0.0.1:9121"), "bad_addr")
expect("wrong role", server(role="ticker"), "bad_proof")
expect("old version", server(version=0), "old_version")
expect("version that is not a number", server(extra={"hermux": "1"}), "no_hello")
expect("version true", server(extra={"hermux": True}), "no_hello")
expect("missing proof", server(drop=["proof"]), "no_hello")
expect("ns of the wrong shape", server(ns="ABC", proof="0" * 64), "bad_proof")
expect("proof in upper case", server(upper=True), "bad_proof")
expect("kid of the wrong shape", server(kid="KID"), "unknown_kid")
expect("garbage", raw(lambda srv, nc: b"hello there\r\n\r\n"), "no_hello")
expect("not found", raw(lambda srv, nc: b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"), "no_hello")
expect("HTML instead of JSON", raw(lambda srv, nc: http_answer(b"<html>hi</html>")), "no_hello")
expect("JSON with a repeated name", raw(lambda srv, nc: http_answer(
    hello_body(srv, nc)[0][:-1] + b', "addr": "127.0.0.1:1"}')), "no_hello")
expect("too much", raw(lambda srv, nc: http_answer(b'{"hermux":1,"pad":"' + b"x" * 5000 + b'"}')), "no_hello")
expect("too many header bytes", raw(lambda srv, nc: b"HTTP/1.1 200 OK\r\n" + b"X-Pad: " + b"y" * 5000 + b"\r\n\r\n"), "no_hello")
expect("no Content-Length", raw(lambda srv, nc: b"HTTP/1.1 200 OK\r\n\r\n" + hello_body(srv, nc)[0]), "no_hello")
expect("Connection: close", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0], extra_headers=b"Connection: close\r\n")), "no_hello")
expect("chunked", raw(lambda srv, nc: b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n"), "no_hello")
expect("HTTP/1.0", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0]).replace(b"HTTP/1.1", b"HTTP/1.0", 1)), "no_hello")
expect("extra bytes after the answer", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0]) + b"HTTP/1.1 200 OK\r\n"), "no_hello")
expect("closes mid-answer", raw(lambda srv, nc: b"HTTP/1.1 200 OK\r\nContent-Le"), "no_hello")
expect("short body, then close", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0], length=900)), "no_hello")
expect("closes at once", close_at_once, "no_answer")
expect("never answers", silent, "no_answer", timeout=1, max_s=2.5)
expect("trickles slowly", trickle, "no_answer", timeout=3, max_s=la.HELLO_DEADLINE_S + 1.5)

# A proof recorded from an earlier honest exchange is worthless: the client's nonce is new each time.
srv = Fake(server())
la.session("events", srv.port, KEY).request("GET", "/x")
srv.done.wait(5)
old_ns, old_proof = srv.proofs[0]
srv.close()
expect("a replayed proof", server(ns=old_ns, proof=old_proof), "bad_proof")

# The same-connection rule: a server that closes after a good hello gets no request on a new connection.
def hello_then_close(c, srv):
    r = read_request(c)
    c.sendall(http_answer(hello_body(srv, nc_of(r[0]))[0]))


srv = Fake(hello_then_close)
s = la.session("events", srv.port, KEY)
srv.done.wait(5)
time.sleep(0.2)
try:
    s.request("POST", "/event", b'{"secret":1}')
    check("closed after the hello: the request fails", False, "no error")
except OSError:
    check("closed after the hello: the request fails", True)
time.sleep(0.5)
check("closed after the hello: no new connection is made", srv.connections == 1, srv.connections)
srv.close()

# Nothing listening.
probe = socket.socket()
probe.bind(("127.0.0.1", 0))
free = probe.getsockname()[1]
probe.close()
try:
    la.session("events", free, KEY)
    check("nothing listening: no_answer", False)
except la.Unverified as e:
    check("nothing listening: no_answer", e.why == "no_answer", e.why)

try:
    la.session("web", 9121, KEY)
    check("an unknown role is refused before dialling", False)
except ValueError:
    check("an unknown role is refused before dialling", True)
try:
    la.session("events", free, "short")
    check("an unusable key: unknown_kid, as on the Java side", False)
except (la.Unverified, ValueError) as e:
    check("an unusable key: unknown_kid, as on the Java side", getattr(e, "why", None) == "unknown_kid", repr(e))

print("bounds, strict heads, sends")
tracemalloc.start()
expect("hello with a huge Content-Length", raw(lambda srv, nc: b"HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\n\r\n"
                                              + b"x" * 100), "no_hello", max_s=2)
peak = tracemalloc.get_traced_memory()[1]
tracemalloc.stop()
check("hello with a huge Content-Length: nothing large is allocated", peak < 8 << 20, peak)
expect("hello after a 100 Continue", raw(lambda srv, nc: b"HTTP/1.1 100 Continue\r\n\r\n" + http_answer(hello_body(srv, nc)[0])),
       "no_hello")
expect("hello with a folded header line", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0],
                                                                         extra_headers=b"X-A: 1\r\n continued\r\n")), "no_hello")
expect("hello with bare LF line endings", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0]).replace(b"\r\n", b"\n")),
       "no_hello")
expect("hello with a header line without a colon", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0],
                                                                                  extra_headers=b"nonsense\r\n")), "no_hello")
expect("hello with too many header lines", raw(lambda srv, nc: http_answer(hello_body(srv, nc)[0],
                                                                          extra_headers=b"X-A: 1\r\n" * 65)), "no_hello")


def answer_case(name, answer, want_text):
    srv = Fake(server(answer=answer))
    try:
        a = la.session("events", srv.port, KEY).request("POST", "/event", b"{}")
        check(name, False, f"answer {a.status}")
    except la.Unverified as e:
        check(name, False, e.why)
    except OSError as e:
        check(name, str(e) == want_text, str(e))
    srv.close()


answer_case("answer with a huge Content-Length", b"HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\n\r\nxx", "answer too large")
answer_case("answer after a 100 Continue",
            b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n", "bad answer")
answer_case("answer of 101", b"HTTP/1.1 101 Switching Protocols\r\n\r\n", "bad answer")
answer_case("answer that ends inside its head", b"HTTP/1.1 200 OK\r\nX-A: 1\r\n", "bad answer")
answer_case("answer with a folded header line", b"HTTP/1.1 204 No Content\r\nX-A: 1\r\n\tmore\r\n\r\n", "bad answer")

# A verified server that never reads: the send gives up at the deadline.
BIG = b"[" + b"0," * (8 << 20) + b"0]"
srv = Fake(server(after=lambda c, srv: time.sleep(la.ANSWER_DEADLINE_S + 3)))
s = la.session("events", srv.port, KEY)
t0 = time.monotonic()
try:
    s.request("POST", "/event", BIG)
    check("a peer that never reads: the send fails", False, "no error")
except OSError:
    took = time.monotonic() - t0
    check("a peer that never reads: the send fails within the deadline", took < la.ANSWER_DEADLINE_S + 2, f"{took:.1f} s")
srv.close()


def slow_reader(c, srv):
    time.sleep(4)  # longer than one read timeout, well inside the answer deadline
    srv.read_started = time.monotonic()
    r = read_request(c)
    srv.request_body = r[1] if r else b""
    c.sendall(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")


# The fake server's receive buffer is small (Fake sets SO_RCVBUF), so 16 MB cannot fit in the socket buffers on
# macOS or Linux: the send really blocks until the server reads. The last send's end time proves it.
sends_done = []
plain_send = la._Connection.send


def timed_send(self, data):
    plain_send(self, data)
    sends_done.append(time.monotonic())


la._Connection.send = timed_send
srv = Fake(server(after=slow_reader))
try:
    a = la.session("events", srv.port, KEY).request("POST", "/event", BIG)
    check("a peer that starts reading late: the send waits for it", a.status == 204, a.status)
    check("a peer that starts reading late: the send did block until the server read",
          sends_done and sends_done[-1] > getattr(srv, "read_started", float("inf")))
except OSError as e:
    check("a peer that starts reading late: the send waits for it", False, repr(e))
la._Connection.send = plain_send
srv.close()


# One deadline for every send of a request: http.client sends the head and the body separately.
class _SlowSock:
    """Each sendall takes its whole timeout, then fails, like a peer that never reads."""

    def __init__(self):
        self.t = 1.0  # as if the whole deadline had been set once before the request

    def settimeout(self, t):
        self.t = t

    def sendall(self, data):
        time.sleep(self.t or 0)
        raise socket.timeout()


conn = la._Connection("127.0.0.1", 1)
conn.sock = _SlowSock()
conn.send_deadline = time.monotonic() + 1.0
t0 = time.monotonic()
for part in (b"head", b"body"):
    try:
        conn.send(part)
    except OSError:
        pass
took = time.monotonic() - t0
check("the head and body sends share one deadline", took < 1.4, f"{took:.1f} s")

print("shared client cases (local-auth-vectors.json)")


def case_body(srv, nc, sets):
    ns = la.nonce()
    where = f"127.0.0.1:{srv.port}"
    vals = {"hermux": "1", "role": '"events"', "kid": f'"{la.kid(KEY)}"', "ns": f'"{ns}"', "addr": f'"{where}"',
            "proof": '"' + la.mac(KEY, "server", "events", where, nc, ns, "hello", la.EMPTY_HASH) + '"'}
    vals.update(sets or {})
    return "{" + ",".join(f'"{k}":{v}' for k, v in vals.items()) + "}"


def expand(template, body=""):
    t = re.sub(r"\{PAD:(\d+)\}", lambda m: "x" * int(m.group(1)), template)
    return t.replace("{LEN}", str(len(body.encode()))).replace("{BODY}", body).encode("latin-1")


for case in V["hello_cases"]:
    if case["expect"] != "verified":
        expect(f"hello case: {case['name']}",
               raw(lambda srv, nc, case=case: expand(case["answer"], case_body(srv, nc, case.get("set")))), case["expect"])
    else:
        def behave(c, srv, case=case):
            r = read_request(c)
            c.sendall(expand(case["answer"], case_body(srv, nc_of(r[0]), case.get("set"))))
            read_request(c)
            c.sendall(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")

        srv = Fake(behave)
        try:
            a = la.session("events", srv.port, KEY).request("POST", "/event", b"{}")
            check(f"hello case: {case['name']}: verified", a.status == 204, a.status)
        except Exception as e:
            check(f"hello case: {case['name']}: verified", False, repr(e))
        srv.close()

for case in V["answer_cases"]:
    srv = Fake(server(answer=expand(case["answer"])))
    try:
        a = la.session("events", srv.port, KEY).request("POST", "/event", b"{}")
        got = f"ok {a.status} {len(a.body)}"
    except la.Unverified as e:
        got = e.why
    except OSError as e:
        got = f"error {e}"
    check(f"answer case: {case['name']}: {case['expect']}", got == case["expect"], got)
    srv.close()

check("same: a lone surrogate does not raise", not la.same("\ud800" * 64, m0) and not la.same(m0, "\ud800"))

# Proxy settings in the environment play no part.
saved = {k: os.environ.get(k) for k in ("HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy")}
for k in saved:
    os.environ[k] = "http://127.0.0.1:1"
srv = Fake(server())
try:
    a = la.session("events", srv.port, KEY).request("POST", "/event", b"{}")
    check("proxy settings are ignored", a.status == 204)
except Exception as e:
    check("proxy settings are ignored", False, repr(e))
srv.close()
for k, v in saved.items():
    if v is None:
        os.environ.pop(k, None)
    else:
        os.environ[k] = v

# ---- the server halves ----

print("server halves: hello answer and request MAC")
A9 = "127.0.0.1:9119"
NC = "00112233445566778899aabbccddeeff"
ns1, j = la.hello_answer(KEY, "dashboard", A9, NC)
check("hello answer: fields", set(j) == {"hermux", "role", "kid", "ns", "addr", "proof"} and j["hermux"] == 1
      and j["role"] == "dashboard" and j["kid"] == V["kid"] and j["ns"] == ns1 and j["addr"] == A9, j)
check("hello answer: a fresh server nonce each time", la.is_nonce(ns1) and la.hello_answer(KEY, "dashboard", A9, NC)[0] != ns1)
check("hello answer: the proof is the server MAC over both nonces and the address",
      la.same(j["proof"], la.mac(KEY, "server", "dashboard", A9, NC, ns1, "hello", la.EMPTY_HASH)))
check("hello answer: the proof does not verify for another address",
      not la.same(j["proof"], la.mac(KEY, "server", "dashboard", "127.0.0.1:9229", NC, ns1, "hello", la.EMPTY_HASH)))
for bad_nc in ("", NC.upper(), NC[:-1], NC + "0", None):
    try:
        la.hello_answer(KEY, "dashboard", A9, bad_nc)
        check(f"hello answer: refuses the client nonce {bad_nc!r}", False)
    except ValueError:
        check(f"hello answer: refuses the client nonce {bad_nc!r}", True)
for bad_key in ("", "short-key", "   ", None):
    try:
        la.hello_answer(bad_key, "dashboard", A9, NC)
        check(f"hello answer: refuses the key {bad_key!r}", False)
    except ValueError:
        check(f"hello answer: refuses the key {bad_key!r}", True)
try:
    la.hello_answer(KEY, "dashboard", "[::1]:9119", NC)
    check("hello answer: refuses an address other than 127.0.0.1", False)
except ValueError:
    check("hello answer: refuses an address other than 127.0.0.1", True)
check("server_addr: loopback", la.server_addr("127.0.0.1", 9119) == A9)
check("server_addr: anything else is None", la.server_addr("::1", 9119) is None and la.server_addr("testserver", 80) is None
      and la.server_addr("127.0.0.1", 0) is None and la.server_addr("127.0.0.1", True) is None
      and la.server_addr("127.0.0.1", "9119") is None)

m = V["macs"][5]  # request MAC, GET /hermux/token
hdr = f"1 {V['kid']} {m['ns']} {m['nc']} {m['mac']}"
check("parse_auth: the dashboard form", la.parse_auth(hdr, with_nc=True) == (V["kid"], m["ns"], m["nc"], m["mac"]))
check("parse_auth: bytes and surrounding spaces", la.parse_auth((" " + hdr + " ").encode(), with_nc=True) is not None)
check("parse_auth: the same-connection form", la.parse_auth(f"1 {V['kid']} {m['ns']} {m['mac']}") == (V["kid"], m["ns"], None, m["mac"]))
for name, bad in (("version 2", "2" + hdr[1:]), ("one part short", hdr.rsplit(" ", 1)[0]), ("a part too many", hdr + " x"),
                  ("upper-case MAC", hdr.upper()), ("double space", hdr.replace(" ", "  ", 1)), ("no kid", hdr.replace(V["kid"], "")),
                  ("short kid", hdr.replace(V["kid"], V["kid"][:7])), ("not ASCII", hdr.replace("1", "١", 1)), ("none", None),
                  ("too long", hdr + "0" * 300)):
    check(f"parse_auth: refuses {name}", la.parse_auth(bad, with_nc=True) is None)
check("parse_auth: the dashboard form is not the same-connection form", la.parse_auth(hdr) is None)

b = V["macs"][9]  # request MAC, UTF-8 body
body = next(s["text"] for s in V["sha256"] if s["hex"] == b["hash"]).encode("utf-8")
tgt = b["what"].split(" ", 1)[1]
check("request_ok: the vector", la.request_ok(KEY, b["role"], b["addr"], b["nc"], b["ns"], "POST", tgt, body, b["mac"]))
check("request_ok: a body changed after the MAC", not la.request_ok(KEY, b["role"], b["addr"], b["nc"], b["ns"], "POST", tgt,
                                                                   body + b" ", b["mac"]))
check("request_ok: the body is the raw bytes, not decoded text",
      not la.request_ok(KEY, b["role"], b["addr"], b["nc"], b["ns"], "POST", tgt, body.decode("utf-8").encode("utf-16"), b["mac"]))
check("request_ok: another path", not la.request_ok(KEY, b["role"], b["addr"], b["nc"], b["ns"], "POST", "/event", body, b["mac"]))
check("request_ok: another method", not la.request_ok(KEY, b["role"], b["addr"], b["nc"], b["ns"], "PUT", tgt, body, b["mac"]))
check("request_ok: another server nonce", not la.request_ok(KEY, b["role"], b["addr"], b["nc"], NC, "POST", tgt, body, b["mac"]))
check("request_ok: another key", not la.request_ok(OTHER, b["role"], b["addr"], b["nc"], b["ns"], "POST", tgt, body, b["mac"]))
check("request_ok: another address", not la.request_ok(KEY, b["role"], "127.0.0.1:9122", b["nc"], b["ns"], "POST", tgt, body, b["mac"]))
check("request_ok: a text body is not bytes", not la.request_ok(KEY, b["role"], b["addr"], b["nc"], b["ns"], "POST", tgt,
                                                                 body.decode("utf-8"), b["mac"]))
check("request_ok: an unusable key is False, not an error", not la.request_ok("x", b["role"], b["addr"], b["nc"], b["ns"], "POST",
                                                                               tgt, body, b["mac"]))
t = V["macs"][6]  # answer proof, dashboard token
tok = next(s["text"] for s in V["sha256"] if s["hex"] == t["hash"])
check("answer_proof: the token vector", la.answer_proof(KEY, "dashboard", t["addr"], t["nc"], t["ns"], "token", tok.encode()) == t["mac"])
r = V["macs"][7]  # answer proof, REST
check("answer_proof: the REST vector", la.answer_proof(KEY, "dashboard", r["addr"], r["nc"], la.NO_NONCE, "rest 200") == r["mac"])

print("server halves: pending hellos")
now = [1000.0]
p = la.PendingHellos(clock=lambda: now[0])
p.add("a" * 32, NC, V["kid"], A9)
check("pending: taken once", p.take("a" * 32) == (NC, V["kid"], A9))
check("pending: not twice", p.take("a" * 32) is None)
check("pending: an unknown nonce", p.take("b" * 32) is None)
p.add("c" * 32, NC, V["kid"], A9)
now[0] += la.HELLO_TTL_S - 0.01
check("pending: still there just before 10 s", la.HELLO_TTL_S == 10.0 and len(p) == 1)
p.add("d" * 32, NC, V["kid"], A9)
now[0] += 0.02
check("pending: gone after 10 s", p.take("c" * 32) is None)
check("pending: a later one lives on", p.take("d" * 32) is not None)
p = la.PendingHellos(clock=lambda: now[0])
for i in range(300):
    p.add(f"{i:032x}", NC, V["kid"], A9)
check("pending: at most 256", la.MAX_PENDING == 256 and len(p) == 256, len(p))
check("pending: a flood drops the oldest", p.take(f"{0:032x}") is None and p.take(f"{43:032x}") is None)
check("pending: and keeps the newest", p.take(f"{44:032x}") is not None and p.take(f"{299:032x}") is not None)
p = la.PendingHellos()
errors = []


def adder(base):
    try:
        for i in range(500):
            p.add(f"{base + i:032x}", NC, V["kid"], A9)
            p.take(f"{base + i - 3:032x}")
    except Exception as e:  # noqa: BLE001
        errors.append(e)


ts = [threading.Thread(target=adder, args=(k * 10000,)) for k in range(8)]
for x in ts:
    x.start()
for x in ts:
    x.join()
check("pending: many threads at once", not errors and len(p) <= 256, (errors, len(p)))

print("server halves: the key file")
import tempfile  # noqa: E402

kdir = Path(tempfile.mkdtemp())
kpath = kdir / "key"
kf = la.KeyFile(kpath)
check("key file: missing reads as nothing", kf.read() == "")
kpath.write_text(KEY + "\n")
check("key file: read and trimmed", kf.read() == KEY)
reads = []
real_open = la.open if hasattr(la, "open") else open


def counting_open(*a, **k):
    reads.append(a[0])
    return real_open(*a, **k)


la.open = counting_open
kf.read()
kf.read()
check("key file: an unchanged file is not read again", reads == [], reads)
tmp = kdir / "key.tmp"
tmp.write_text(OTHER + "\n")  # the same length and, below, the same time: only the inode tells it apart
before = kpath.stat()
os.utime(tmp, ns=(before.st_atime_ns, before.st_mtime_ns))
os.replace(tmp, kpath)
check("key file: a file replaced by a rename (same size) is read again", kf.read() == OTHER)
st = kpath.stat()
with open(kpath, "r+") as f:  # rewritten in place, the same size, the modification time put back
    f.write(KEY + "\n")
os.utime(kpath, ns=(st.st_atime_ns, st.st_mtime_ns + 1))
check("key file: a rewrite in place with a new time (ns) is read again", kf.read() == KEY)
del la.open
kpath.write_text("")
same_sig = la.KeyFile(kpath)
same_sig._sig = lambda _st: ("fixed",)  # a file system whose times and sizes never tell a change
check("key file: empty reads as nothing", same_sig.read() == "")
kpath.write_text(KEY)
check("key file: an empty file is never kept", same_sig.read() == KEY)
kpath.write_text(OTHER)
check("key file: a key is kept while nothing changes", same_sig.read() == KEY)
check("key file: a path function and None", la.KeyFile(lambda: None).read() == "" and la.KeyFile(lambda: kpath).read() == OTHER)
kpath.unlink()
check("key file: removed reads as nothing", kf.read() == "")

# The plugin's own reader uses the same cache.
os.environ.setdefault("HOME", str(kdir))
pspec = importlib.util.spec_from_file_location("hm_plugin_for_key", PLUGIN / "__init__.py")
plugin = importlib.util.module_from_spec(pspec)
pspec.loader.exec_module(plugin)
plugin.KEY_FILE = kpath
kpath.write_text("")
check("plugin _key: empty file", plugin._key() == "")
plugin._key_cache["reader"]._sig = lambda _st: ("fixed",)
kpath.write_text(KEY + "\n")
check("plugin _key: an empty file is never kept", plugin._key() == KEY)
check("plugin _key: the same reader (local_auth.KeyFile)", isinstance(plugin._key_cache["reader"], la.KeyFile))

print("\nALL PASSED" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
