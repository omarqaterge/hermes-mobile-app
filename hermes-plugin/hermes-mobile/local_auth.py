"""Local authentication (hermux-local-v1): verify the local server before sending it anything private, and the server
halves that let the plugin's own servers (the dashboard guard, the cron ticker) prove themselves.

A client sends ``GET /hermux/hello?v=1&nc=<nonce>``; the server answers with JSON naming its role, key id (``kid``), its own
nonce (``ns``), the address it listens on (``addr``) and a ``proof``: an HMAC-SHA256 under the shared key over the client's
nonce. Only when every check passes does the client send its one request, on the same connection, with the header
``X-Hermux-Auth: 1 <kid> <ns> <mac>``. Any failure raises ``Unverified(why)`` with one reason from ``REASONS`` and nothing
is sent. The Java twin is ``LocalAuth``/``LocalClient`` in the app; both are checked against tools/local-auth-vectors.json.

A MAC is lowercase hex HMAC-SHA256 over eight fields joined by newlines: ``hermux-local-v1``, dir, role, addr, nc, ns,
what, hash. ``mac`` refuses a field outside its alphabet (a newline above all), so one field can never spill into the
next. Bounded: 2 s to connect, ``timeout`` per read, a whole-exchange deadline (sends included), 4 KiB for the hello
answer (a larger Content-Length is refused before reading), a head as strict as the Java side's; no proxy
(``http.client`` never reads proxy settings) and no redirect is followed. Nothing here logs. Stdlib only. The client
half is not used yet.

The server halves (see "the server halves" below): ``hello_answer`` (the proof over the client's nonce, a fresh server
nonce, the server's own listening address and the key id), ``parse_auth`` and ``request_ok`` (a request MAC over the
method, the path with its query and the raw body bytes), ``answer_proof``, ``PendingHellos`` (the dashboard guard's
single-use server nonces), ``KeyFile`` (the key file, re-read only when it changes) and ``ticker_serve_one`` (the cron
ticker's line protocol). Servers still accept the raw key alongside: nothing is refused yet that worked before.
"""
from __future__ import annotations

import functools
import hashlib
import hmac
import http.client
import json
import os
import re
import secrets
import socket
import threading
import time
from collections import OrderedDict

VERSION = "hermux-local-v1"
EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
DIRS = ("server", "client", "answer")
ROLES = ("dashboard", "events", "ticker", "bghost")
NO_NONCE = "-"
MIN_KEY = 16
MAX_WHAT = 2048
REASONS = ("no_answer", "no_hello", "old_version", "bad_addr", "unknown_kid", "bad_proof", "refused")

HOST = "127.0.0.1"
CONNECT_S = 2.0
HELLO_DEADLINE_S = 5.0
ANSWER_DEADLINE_S = 10.0
MAX_HELLO = 4096
MAX_HEAD = 8192
MAX_HEADERS = 64
MAX_ANSWER = 1 << 20
MAX_PATH = 2000
MIN_VERSION = 1

_HEX = re.compile(r"[0-9a-f]+")
_ADDR = re.compile(r"127\.0\.0\.1:([1-9][0-9]{0,4})")
_WHAT = re.compile(r"[\x20-\x7e]+")
_KEY = re.compile(r"[\x21-\x7e]+")
_METHOD = re.compile(r"[A-Z]{1,16}")
_PATH = re.compile(r"/[\x21-\x7e]*")
_DIGITS = re.compile(r"[0-9]{1,9}")
# The head of an answer, line by line, as strict as the Java side: CRLF endings only, no NUL, no folded header lines,
# a token before every colon, HTTP/1.1 and no 1xx status (refused, not skipped).
_STATUS = re.compile(rb"HTTP/1\.1 [2-9][0-9]{2}(?: [^\r\n\x00]*)?\r\n")
_HEADER = re.compile(rb"[!#$%&'*+\-.^_`|~0-9A-Za-z]+:[^\r\n\x00]*\r\n")


class Unverified(Exception):
    """The server was not verified (or refused our request). ``why`` (also the message) is the reason code, nothing else."""

    def __init__(self, why: str):
        why = why if why in REASONS else "no_hello"
        super().__init__(why)
        self.why = why


def _hex(s, n: int) -> bool:
    return isinstance(s, str) and len(s) == n and _HEX.fullmatch(s) is not None


def is_nonce(s) -> bool:
    """True for exactly 32 lowercase hex characters."""
    return _hex(s, 32)


def is_kid(s) -> bool:
    return _hex(s, 8)


def is_addr(s) -> bool:
    m = _ADDR.fullmatch(s) if isinstance(s, str) else None
    return m is not None and 1 <= int(m.group(1)) <= 65535


def addr(port: int) -> str:
    return f"{HOST}:{port}"


def nonce() -> str:
    """16 random bytes as 32 lowercase hex characters."""
    return secrets.token_hex(16)


def _key_text(key) -> str:
    """Surrounding ASCII whitespace removed (the same set as the Java side), then at least 16 printable ASCII characters."""
    if not isinstance(key, str):
        raise ValueError("key")
    k = key.strip(" \t\r\n\x0b\x0c")
    if len(k) < MIN_KEY or _KEY.fullmatch(k) is None:
        raise ValueError("key")
    return k


def sha256hex(b: bytes | None) -> str:
    return hashlib.sha256(b or b"").hexdigest()


def kid(key: str) -> str:
    """First 8 hex characters of SHA-256 over ``hermux-kid-v1\\n`` and the trimmed key text."""
    return sha256hex(("hermux-kid-v1\n" + _key_text(key)).encode())[:8]


def mac(key: str, dir: str, role: str, addr: str, nc: str, ns: str, what: str, hash: str) -> str:
    """The MAC of one message. ValueError (naming the field, never its value) for a field outside its alphabet."""
    k = _key_text(key).encode()
    if dir not in DIRS:
        raise ValueError("dir")
    if role not in ROLES:
        raise ValueError("role")
    if not is_addr(addr):
        raise ValueError("addr")
    if not is_nonce(nc):
        raise ValueError("nc")
    if ns != NO_NONCE and not is_nonce(ns):
        raise ValueError("ns")
    if not isinstance(what, str) or len(what) > MAX_WHAT or _WHAT.fullmatch(what) is None:
        raise ValueError("what")
    if not _hex(hash, 64):
        raise ValueError("hash")
    msg = "\n".join((VERSION, dir, role, addr, nc, ns, what, hash))
    return hmac.new(k, msg.encode(), hashlib.sha256).hexdigest()


def same(a, b) -> bool:
    """Constant-time equality; False when either is not text or the lengths differ. Never raises (a lone surrogate
    is encoded as it is, so it simply differs)."""
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    return hmac.compare_digest(a.encode("utf-8", "surrogatepass"), b.encode("utf-8", "surrogatepass"))


# ---- the client ----

class _TooMuch(Exception):
    pass


class _Malformed(Exception):
    pass


class _Wire:
    """A socket's input for one answer, read as the Java side reads it: at most ``limit`` bytes consumed (``limit(n)``
    sets a new budget, for the body), each read bounded by ``per_read`` and the whole by ``deadline`` (a trickle of
    bytes cannot hold the caller), and no read or allocation for a length beyond the budget. Stands in for the file
    ``http.client`` reads from."""

    def __init__(self, sock: socket.socket, limit: int, deadline: float, per_read: float):
        self._sock, self._left, self._deadline, self._per_read = sock, limit, deadline, per_read
        self._buf = b""
        self.taken = 0
        self.extra = False  # bytes were left over when the answer was done
        self.closed = False
        self._lines = 0
        self._in_head = True

    def limit(self, n: int) -> None:
        self._left = n

    def _fill(self) -> bool:
        remaining = self._deadline - time.monotonic()
        if remaining <= 0:
            raise socket.timeout()
        self._sock.settimeout(min(self._per_read, remaining))
        data = self._sock.recv(4096)
        if not data:
            return False
        self._buf += data
        return True

    def _take(self, n: int) -> bytes:
        out = self._buf[:n]
        if len(out) > self._left:
            raise _TooMuch()
        self._buf = self._buf[len(out):]
        self._left -= len(out)
        self.taken += len(out)
        return out

    def readline(self, limit: int = -1) -> bytes:
        line = self._readline(limit)
        if self._in_head:
            if not line:
                if self._lines:
                    raise _Malformed()  # the stream ended inside the head
                return line  # nothing at all: http.client reports it, and taken == 0 says no_answer
            if self._lines == 0:
                ok = _STATUS.fullmatch(line) is not None
            elif line == b"\r\n":
                ok, self._in_head = True, False
            else:
                ok = self._lines <= MAX_HEADERS and _HEADER.fullmatch(line) is not None
            self._lines += 1
            if not ok:
                raise _Malformed()
        return line

    def _readline(self, limit: int) -> bytes:
        while True:
            i = self._buf.find(b"\n")
            if i >= 0 and (limit < 0 or i < limit):
                return self._take(i + 1)
            if 0 <= limit <= len(self._buf):
                return self._take(limit)
            if len(self._buf) >= self._left:
                raise _TooMuch()  # no line end within the budget
            if not self._fill():
                return self._take(len(self._buf))

    def read(self, n: int | None = -1) -> bytes:
        if n is None or n < 0:
            while len(self._buf) <= self._left and self._fill():
                pass
            return self._take(len(self._buf))
        if n > self._left:
            raise _TooMuch()  # refused before reading or allocating anything for it
        while len(self._buf) < n and self._fill():
            pass
        return self._take(n)

    def readinto(self, b) -> int:
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)

    def flush(self) -> None:
        pass

    def close(self) -> None:
        if self._buf:
            self.extra = True
        self.closed = True
        keep, self.keep = getattr(self, "keep", None), None
        if keep is not None:
            keep.close()


class _Response(http.client.HTTPResponse):
    def __init__(self, sock, debuglevel=0, method=None, url=None, *, wire: _Wire):
        super().__init__(sock, debuglevel, method, url)
        # Keep the file http.client opened (unused) until the answer is done: while it is open, closing the connection
        # (http.client does that before reading an answer that ends at the close) leaves the socket readable.
        wire.keep = self.fp
        self.fp = wire

    def _check_close(self):
        # Token by token, as the Java side: "Connection: keep-alive, close" closes, "Connection: closed" does not.
        for v in self.headers.get_all("Connection") or ():
            if any(t.strip(" \t").lower() == "close" for t in v.split(",")):
                return True
        return False


class _Connection(http.client.HTTPConnection):
    """Dials the literal loopback address within CONNECT_S; never reconnects by itself (see ``session``)."""

    send_deadline = None  # time.monotonic() by which every send of the current request must be done

    def connect(self):
        self.sock = socket.create_connection((HOST, self.port), timeout=CONNECT_S)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def send(self, data):
        # http.client sends the head and the body separately: each gets only what is left of one deadline.
        if self.send_deadline is not None and self.sock is not None:
            remaining = self.send_deadline - time.monotonic()
            if remaining <= 0:
                raise socket.timeout()
            self.sock.settimeout(remaining)
        super().send(data)


class Answer:
    def __init__(self, status: int, body: bytes):
        self.status, self.body = status, body


class Session:
    """A verified connection: ``request`` sends exactly one request on it, then it is closed."""

    def __init__(self, conn: _Connection, role: str, port: int, key: str, kid_: str, nc: str, ns: str, timeout: float):
        self._conn, self._sock, self._role, self._port = conn, conn.sock, role, port
        self._key, self.kid, self._nc, self._ns, self._timeout = key, kid_, nc, ns, timeout
        self._used = False

    def request(self, method: str, path: str, body: bytes | str | None = None) -> Answer:
        """Send one request (a body goes as application/json). 403 raises ``Unverified("refused")``; a broken or
        oversized answer raises OSError with a neutral message. The session is closed afterwards."""
        if self._used:
            raise RuntimeError("used")
        self._used = True
        try:
            if not isinstance(method, str) or not _METHOD.fullmatch(method):
                raise ValueError("request")
            if not isinstance(path, str) or len(path) > MAX_PATH or not _PATH.fullmatch(path):
                raise ValueError("request")
            b = body.encode() if isinstance(body, str) else (body or b"")
            what = f"{method} {path}"
            m = mac(self._key, "client", self._role, addr(self._port), self._nc, self._ns, what, sha256hex(b))
            # The same socket as the hello, or nothing: never a fresh connection to whatever listens now.
            if self._conn.sock is None or self._conn.sock is not self._sock:
                raise OSError("no answer")
            headers = {"X-Hermux-Auth": f"1 {self.kid} {self._ns} {m}", "Content-Length": str(len(b)), "Connection": "close"}
            if b:
                headers["Content-Type"] = "application/json"
            deadline = time.monotonic() + ANSWER_DEADLINE_S
            wire = _Wire(self._sock, MAX_HEAD, deadline, self._timeout)
            try:
                # One deadline for sending and for the answer; a send must not inherit a short read timeout.
                self._conn.send_deadline = deadline
                self._conn.request(method, path, body=b, headers=headers)
                self._conn.response_class = functools.partial(_Response, wire=wire)
                r = self._conn.getresponse()
                # The same checks, in the same order, as LocalClient.Session.request.
                if r.status == 403:
                    raise Unverified("refused")
                lengths = r.headers.get_all("Content-Length") or []
                if (r.headers.get_all("Transfer-Encoding") or len(lengths) > 1
                        or (lengths and not _DIGITS.fullmatch(lengths[0].strip(" \t")))):
                    raise OSError("bad answer")
                n = int(lengths[0].strip(" \t")) if lengths else None
                if r.status in (204, 304):
                    return Answer(r.status, b"")
                if n is not None and n > MAX_ANSWER:
                    raise OSError("answer too large")
                wire.limit(MAX_ANSWER if n is None else n)
                return Answer(r.status, r.read())
            except (Unverified, socket.timeout):
                raise
            except _TooMuch:
                raise OSError("answer too large") from None
            except (_Malformed, http.client.HTTPException, ValueError):
                # Nothing at all is "no answer" (Java's Silent); anything else broken is "bad answer".
                raise OSError("no answer" if wire.taken == 0 else "bad answer") from None
        finally:
            self.close()

    def close(self) -> None:
        try:
            self._conn.close()
        except OSError:
            pass


def session(role: str, port: int, key: str, timeout: float = 3) -> Session:
    """Verify the server on 127.0.0.1:port for ``role`` with ``key``; the session may send one request."""
    if role not in ROLES or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("session")
    try:
        want_kid = kid(key)
    except ValueError:
        raise Unverified("unknown_kid") from None  # an unusable key: the same reason as the Java side, and nothing is sent
    deadline = time.monotonic() + HELLO_DEADLINE_S
    where = addr(port)
    nc = nonce()
    conn = _Connection(HOST, port, timeout=timeout)
    ok = False
    try:
        try:
            conn.connect()
            conn.auto_open = 0  # a closed socket must never be replaced by a new connection behind our back
            conn.send_deadline = deadline  # the send, within the hello deadline
            conn.request("GET", f"/hermux/hello?v=1&nc={nc}", headers={"Connection": "keep-alive"})
        except OSError:
            raise Unverified("no_answer") from None
        wire = _Wire(conn.sock, MAX_HELLO, deadline, timeout)
        conn.response_class = functools.partial(_Response, wire=wire)
        try:
            r = conn.getresponse()
            lengths = r.headers.get_all("Content-Length") or []
            if (r.status != 200 or r.headers.get_all("Transfer-Encoding") or r.will_close or r.version != 11
                    or len(lengths) != 1
                    or not _DIGITS.fullmatch(lengths[0].strip(" \t")) or r.length is None or r.length > MAX_HELLO):
                raise Unverified("no_hello")
            body = r.read()
            if wire.extra or conn.sock is None:
                raise Unverified("no_hello")
        except Unverified:
            raise
        except socket.timeout:
            raise Unverified("no_answer") from None
        except (OSError, http.client.HTTPException, _TooMuch, _Malformed, ValueError):
            raise Unverified("no_answer" if wire.taken == 0 else "no_hello") from None
        try:
            def pairs(items):
                d = {}
                for k, v in items:
                    if k in d:
                        raise ValueError("json")
                    d[k] = v
                return d

            def no_constant(_):
                raise ValueError("json")

            j = json.loads(body.decode("utf-8"), object_pairs_hook=pairs, parse_constant=no_constant)
        except (UnicodeDecodeError, ValueError, RecursionError):
            raise Unverified("no_hello") from None
        if not isinstance(j, dict):
            raise Unverified("no_hello")
        ver = j.get("hermux")
        if not isinstance(ver, int) or isinstance(ver, bool):
            raise Unverified("no_hello")
        if ver < MIN_VERSION:
            raise Unverified("old_version")
        fields = [j.get(n) for n in ("role", "kid", "ns", "addr", "proof")]
        if not all(isinstance(f, str) for f in fields):
            raise Unverified("no_hello")
        s_role, s_kid, ns, s_addr, proof = fields
        if s_role != role or not is_nonce(ns):
            raise Unverified("bad_proof")
        if s_addr != where:
            raise Unverified("bad_addr")
        if not is_kid(s_kid) or not same(s_kid, want_kid):
            raise Unverified("unknown_kid")
        # Over the address this client dialled, not the server's text (equal here, by the check above).
        if not _hex(proof, 64) or not same(mac(key, "server", role, where, nc, ns, "hello", EMPTY_HASH), proof):
            raise Unverified("bad_proof")
        ok = True
        return Session(conn, role, port, key, s_kid, nc, ns, timeout)
    except Unverified:
        raise
    except Exception:
        raise Unverified("no_hello") from None  # last resort: nothing outside the closed list of reasons leaves session()
    finally:
        if not ok:
            try:
                conn.close()
            except OSError:
                pass


# ---- the server halves ----
# A server answers a hello with a proof over the client's nonce, a fresh nonce of its own, the address it listens on and
# its key id, then checks one request MAC over that pair of nonces. The raw key is still accepted next to this by each
# server's own code, so a client that has not learnt the hello keeps working.

HELLO_TTL_S = 10.0  # how long the dashboard guard keeps a server nonce for the token step
MAX_PENDING = 256  # ... and how many at most (the oldest is dropped first)
MAX_LINE = 256  # the ticker's lines, the newline included
LINE_READ_S = 2.0  # each read of a ticker line
LINE_DEADLINE_S = 5.0  # the whole ticker exchange, however slowly the bytes come
_VERSION_ARG = re.compile(r"[1-9][0-9]{0,2}")


def server_addr(host, port) -> str | None:
    """The address a server names in its proof: ``127.0.0.1:<port>`` for a socket on the loopback address, else None
    (a server reached any other way, ``::1`` say, gives no proof: the client dialled something else)."""
    if host != HOST or not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        return None
    return addr(port)


def is_version(s) -> bool:
    """A hello's version argument: a positive decimal number without leading zeros (this server answers version 1)."""
    return isinstance(s, str) and _VERSION_ARG.fullmatch(s) is not None


def hello_answer(key: str, role: str, server: str, nc: str) -> tuple[str, dict]:
    """A fresh server nonce and the hello answer (as JSON fields) for the client nonce ``nc``. ValueError for a bad
    nonce, an unusable key, an unknown role or an address that is not ``127.0.0.1:<port>``."""
    if not is_nonce(nc):
        raise ValueError("nc")
    ns = nonce()
    proof = mac(key, "server", role, server, nc, ns, "hello", EMPTY_HASH)
    return ns, {"hermux": 1, "role": role, "kid": kid(key), "ns": ns, "addr": server, "proof": proof}


def parse_auth(value, with_nc: bool = False):
    """``X-Hermux-Auth`` as ``(kid, ns, nc, mac)``, or None when it is malformed. The same-connection form is
    ``1 <kid> <ns> <mac>`` (``nc`` comes back None: the server kept it from the hello); the dashboard's token step, which
    runs on a connection of its own, also names the client nonce: ``1 <kid> <ns> <nc> <mac>``."""
    if isinstance(value, bytes):
        try:
            value = value.decode("ascii")
        except UnicodeDecodeError:
            return None
    if not isinstance(value, str) or len(value) > 256:
        return None
    parts = value.strip(" \t").split(" ")
    if len(parts) != (5 if with_nc else 4) or parts[0] != "1":
        return None
    k, ns, m = parts[1], parts[2], parts[-1]
    nc = parts[3] if with_nc else None
    if not is_kid(k) or not is_nonce(ns) or (with_nc and not is_nonce(nc)) or not _hex(m, 64):
        return None
    return k, ns, nc, m


def request_ok(key: str, role: str, server: str, nc: str, ns: str, method: str, target: str, body: bytes,
               given_mac: str) -> bool:
    """True when ``given_mac`` is the client MAC over ``<method> <target>`` (the path with its query, as sent) and the
    SHA-256 of the raw body bytes. Anything malformed, an unusable key included, is simply False."""
    if not isinstance(body, (bytes, bytearray)):
        return False
    try:
        want = mac(key, "client", role, server, nc, ns, f"{method} {target}", sha256hex(bytes(body)))
    except (ValueError, TypeError):
        return False
    return same(want, given_mac)


def answer_proof(key: str, role: str, server: str, nc: str, ns: str, what: str, data: bytes = b"") -> str:
    """A proof over an answer: the token (``what`` ``token``, ``data`` the token) or a REST status (``rest <status>``,
    no data). ValueError like ``mac``."""
    return mac(key, "answer", role, server, nc, ns, what, sha256hex(data))


class PendingHellos:
    """The dashboard guard's server nonces between the hello and the token step, which arrive on two connections. Each
    lives ``ttl`` seconds and is used once (``take`` removes it, whatever the request then proves); at most ``limit``
    are kept and a new one drops the oldest, so a flood of hellos costs a bounded amount of memory and can only make an
    honest client's token step fail (it then says hello again). Thread-safe."""

    def __init__(self, ttl: float = HELLO_TTL_S, limit: int = MAX_PENDING, clock=time.monotonic):
        self._ttl, self._limit, self._clock = ttl, limit, clock
        self._items: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def _expire(self, now: float) -> None:
        while self._items:
            ns, entry = next(iter(self._items.items()))
            if entry[0] > now:
                return
            del self._items[ns]

    def add(self, ns: str, nc: str, kid_: str, server: str) -> None:
        with self._lock:
            now = self._clock()
            self._expire(now)
            self._items.pop(ns, None)
            while len(self._items) >= self._limit:
                self._items.popitem(last=False)
            self._items[ns] = (now + self._ttl, nc, kid_, server)

    def take(self, ns: str):
        """``(nc, kid, addr)`` for a live ``ns``, once; None when it is unknown, used or expired."""
        with self._lock:
            now = self._clock()
            self._expire(now)
            entry = self._items.pop(ns, None)
        return None if entry is None else entry[1:]

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)


class KeyFile:
    """The shared key's file, read again only when it changes: by inode, modification time (ns) and size, so a file
    replaced by a rename, or rewritten in place with another length or time, is read again. An empty or unreadable file
    is never cached (the next call looks again) and reads as ``""``. ``path`` is a path or a function giving one (None:
    no file)."""

    def __init__(self, path):
        self._path = path
        self._cache = None  # (path, signature, key)

    @staticmethod
    def _sig(st) -> tuple:
        return st.st_ino, st.st_mtime_ns, st.st_size

    def read(self) -> str:
        path = self._path() if callable(self._path) else self._path
        if path is None:
            return ""
        path = str(path)
        try:
            sig = self._sig(os.stat(path))
        except OSError:
            return ""
        cached = self._cache
        if cached is not None and cached[0] == path and cached[1] == sig:
            return cached[2]
        try:
            with open(path, "rb") as f:
                sig = self._sig(os.fstat(f.fileno()))  # the signature of the file actually read
                data = f.read(4096)
        except OSError:
            return ""
        key = data.decode("utf-8", "replace").strip()
        self._cache = (path, sig, key) if key else None  # one assignment: a reader on another thread sees old or new
        return key


class _Lines:
    """A ticker connection's input, one line at a time: at most MAX_LINE bytes a line, LINE_READ_S a read, and one
    deadline for the whole exchange. ``next`` gives ``(line, complete)``; an incomplete line is what came before the
    end of the stream or the deadline (nothing at all for a line too long)."""

    def __init__(self, conn, deadline: float):
        self._conn, self.deadline, self._buf = conn, deadline, b""

    def next(self) -> tuple[bytes, bool]:
        while True:
            i = self._buf.find(b"\n")
            if i >= 0:
                if i + 1 > MAX_LINE:
                    return b"", False
                line, self._buf = self._buf[:i], self._buf[i + 1:]
                return line, True
            if len(self._buf) >= MAX_LINE:
                return b"", False
            left = self.deadline - time.monotonic()
            if left <= 0:
                return self._rest(), False
            try:
                self._conn.settimeout(min(LINE_READ_S, left))
                data = self._conn.recv(MAX_LINE - len(self._buf))
            except OSError:  # socket.timeout included
                return self._rest(), False
            if not data:
                return self._rest(), False
            self._buf += data

    def _rest(self) -> bytes:
        out, self._buf = self._buf, b""
        return out


def ticker_serve_one(conn, key: str, server: str, legacy: bool = True) -> str:
    """One connection to the cron ticker's poke listener. The line protocol (each line ends in a newline):

        C: HELLO 1 <nc>
        S: HERMUX 1 ticker <kid> <ns> <addr> <proof>
        C: POKE 1 <mac>          (the client MAC with what ``POKE`` and no body)

    Returns ``"poke"`` for a verified POKE, ``"legacy"`` for a first line that is the raw key itself (the protocol
    before this one; refused when ``legacy`` is False), ``""`` for anything else. Never answers anything but the
    HERMUX line, and only when the key is usable. The caller closes the connection."""
    lines = _Lines(conn, time.monotonic() + LINE_DEADLINE_S)
    first, complete = lines.next()
    if first.startswith(b"HELLO "):
        parts = first.split(b" ")
        if not complete or len(parts) != 3:
            return ""
        try:
            ver, nc = parts[1].decode("ascii"), parts[2].decode("ascii")
        except UnicodeDecodeError:
            return ""
        if not is_version(ver) or not is_nonce(nc):
            return ""
        try:
            ns, j = hello_answer(key, "ticker", server, nc)
        except ValueError:
            return ""  # no usable key (or no loopback address): no proof, and nothing else either
        line = f"HERMUX 1 ticker {j['kid']} {ns} {server} {j['proof']}\n".encode("ascii")
        try:
            conn.settimeout(max(0.001, min(LINE_READ_S, lines.deadline - time.monotonic())))
            conn.sendall(line)
        except OSError:
            return ""
        second, complete = lines.next()
        parts = second.split(b" ")
        if not complete or len(parts) != 3 or parts[0] != b"POKE" or parts[1] != b"1":
            return ""
        try:
            given = parts[2].decode("ascii")
        except UnicodeDecodeError:
            return ""
        if not _hex(given, 64):
            return ""
        want = mac(key, "client", "ticker", server, nc, ns, "POKE", EMPTY_HASH)
        return "poke" if same(want, given) else ""
    if not legacy:
        return ""
    want = (key or "").strip().encode()
    got = first.strip()
    return "legacy" if want and hmac.compare_digest(got, want) else ""
