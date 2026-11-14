"""The cron ticker's poke listener (hermes-plugin/hermes-mobile/cron_ticker.py) on real loopback sockets: local
authentication's line protocol (HELLO, the HERMUX proof, POKE) pokes the ticker only for a MAC over this connection's
nonces under the shared key; the raw key as the first line still pokes until the enforced file exists; a server nonce
is single use; long, slow or malformed lines are refused; a held port is retried with a bounded back-off and each
change is noted once, in the loop-events log's fixed shape. Stdlib only. Run: python3 tools/test_cron_ticker.py"""
import importlib.util
import json
import logging
import re
import socket
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "hermes-plugin" / "hermes-mobile"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


ct = load("cron_ticker", PLUGIN / "cron_ticker.py")
la = ct._local_auth()
diag = load("hm_diag_for_ticker", PLUGIN / "diag.py")
V = json.loads((HERE / "local-auth-vectors.json").read_text(encoding="utf-8"))
KEY, OTHER = V["key"], V["other_key"]
tmp = Path(tempfile.mkdtemp())
ct.ENFORCED = tmp / "enforced"
ct.LOOP_EVENTS = tmp / "loop-events.log"
ct.DIAG_OFF = tmp / "diag-off"
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (f" ({detail})" if detail and not cond else ""))
    if not cond:
        fails += 1


check("local_auth.py loads from the ticker's own folder", la is not None and hasattr(la, "ticker_serve_one"))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


key_now = [KEY]
tk = ct.Ticker()
port = free_port()
where = f"127.0.0.1:{port}"
notes = []
threading.Thread(target=ct.poke_listener, args=(tk, port, lambda: key_now[0], notes.append), daemon=True, name="first-listener").start()
for _ in range(50):
    try:
        socket.create_connection(("127.0.0.1", port), 0.2).close()
        break
    except OSError:
        time.sleep(0.05)


def poked(wait=0.3):
    """True once the ticker was poked since the last call."""
    deadline = time.time() + wait
    while time.time() < deadline:
        if tk._poke.is_set():
            tk._poke.clear()
            return True
        time.sleep(0.01)
    return False


def lines_of(c):
    buf = b""
    c.settimeout(3)
    while b"\n" not in buf:
        d = c.recv(512)
        if not d:
            return buf, False
        buf += d
    return buf, True


def hello(c, nc=None, key=KEY, hint=None):
    """Say hello (with an optional kid hint); returns (ns, the server's line, verified) where verified checks the proof
    as the app will."""
    nc = nc or la.nonce()
    c.sendall((f"HELLO 1 {nc}" + (f" {hint}" if hint is not None else "") + "\n").encode())
    line, complete = lines_of(c)
    parts = line.decode().rstrip("\n").split(" ")
    ok = (complete and len(parts) == 7 and parts[:3] == ["HERMUX", "1", "ticker"] and parts[3] == la.kid(key)
          and parts[5] == where and la.same(parts[6], la.mac(key, "server", "ticker", where, nc, parts[4], "hello", la.EMPTY_HASH)))
    return (parts[4] if len(parts) == 7 else None), line, ok, nc


def poke_line(nc, ns, key=KEY):
    return f"POKE 1 {la.mac(key, 'client', 'ticker', where, nc, ns, 'POKE', la.EMPTY_HASH)}\n".encode()


print("line protocol")
with socket.create_connection(("127.0.0.1", port), 2) as c:
    ns, line, ok, nc = hello(c)
    check("hello: a HERMUX line with a proof over our nonce and the listening address", ok, line)
    check("hello: nothing else before the POKE", not poked(0.2))
    c.sendall(poke_line(nc, ns))
check("a verified POKE pokes", poked())
saved = (nc, ns)

with socket.create_connection(("127.0.0.1", port), 2) as c:
    ns, line, ok, nc = hello(c)
    c.sendall(poke_line(nc, ns, key=OTHER))
check("a POKE under another key does not", not poked())

with socket.create_connection(("127.0.0.1", port), 2) as c:
    ns, line, ok, nc = hello(c)
    c.sendall(poke_line(*saved))
check("a POKE over an earlier connection's nonces does not (server nonces are single use)", not poked())

with socket.create_connection(("127.0.0.1", port), 2) as c:
    ns, line, ok, nc = hello(c)
    m = la.mac(KEY, "client", "ticker", "127.0.0.1:9", nc, ns, "POKE", la.EMPTY_HASH)
    c.sendall(f"POKE 1 {m}\n".encode())
check("a POKE over another address does not", not poked())

with socket.create_connection(("127.0.0.1", port), 2) as c:
    ns, line, ok, nc = hello(c)
    c.sendall(f"POKE 1 {la.mac(KEY, 'server', 'ticker', where, nc, ns, 'POKE', la.EMPTY_HASH)}\n".encode())
check("a server-direction MAC is not a POKE", not poked())

with socket.create_connection(("127.0.0.1", port), 2) as c:
    ns, line, ok, nc = hello(c)
    c.sendall(poke_line(nc, ns).rstrip(b"\n"))
    c.shutdown(socket.SHUT_WR)
check("a POKE line without its newline does not", not poked())

with socket.create_connection(("127.0.0.1", port), 2) as c:
    nc = la.nonce()
    c.sendall(f"POKE 1 {la.mac(KEY, 'client', 'ticker', where, nc, nc, 'POKE', la.EMPTY_HASH)}\n".encode())
check("a POKE without a hello does not", not poked())

for name, text in (("an upper-case nonce", f"HELLO 1 {la.nonce().upper()}\n"), ("a short nonce", "HELLO 1 0011\n"),
                   ("version 0", f"HELLO 0 {la.nonce()}\n"), ("two fields after the nonce", f"HELLO 1 {la.nonce()} {la.kid(KEY)} x\n"),
                   ("a line far too long", "HELLO 1 " + "0" * 400 + "\n")):
    with socket.create_connection(("127.0.0.1", port), 2) as c:
        c.sendall(text.encode())
        c.settimeout(3)
        try:
            got = c.recv(512)
        except OSError:  # closed with our bytes unread: a reset, still no answer
            got = b""
    check(f"no answer to a hello with {name}", got == b"", got)
check("... and no poke", not poked())

print("the kid hint")
for name, h in (("its own kid", la.kid(KEY)), ("another key's kid (it has one key: ignored)", la.kid(OTHER)),
                ("a malformed hint (absent)", "x"), ("an upper-case hint (absent)", la.kid(KEY).upper())):
    with socket.create_connection(("127.0.0.1", port), 2) as c:
        ns, line, ok, nc = hello(c, hint=h)
        c.sendall(poke_line(nc, ns))
    check(f"a hello with {name}: the proof is under its key, and the POKE works", ok and poked(), line)

print("the raw key (the protocol before this one)")
with socket.create_connection(("127.0.0.1", port), 2) as c:
    c.sendall((KEY + "\n").encode())
check("the raw key pokes", poked())
with socket.create_connection(("127.0.0.1", port), 2) as c:
    c.sendall(KEY.encode())
check("the raw key without a newline pokes (as before)", poked())
with socket.create_connection(("127.0.0.1", port), 2) as c:
    c.sendall((OTHER + "\n").encode())
check("another key does not", not poked())
ct.ENFORCED.write_text("")
with socket.create_connection(("127.0.0.1", port), 2) as c:
    c.sendall((KEY + "\n").encode())
check("once enforced, the raw key does not", not poked())
with socket.create_connection(("127.0.0.1", port), 2) as c:
    ns, line, ok, nc = hello(c)
    c.sendall(poke_line(nc, ns))
check("once enforced, a verified POKE still does", ok and poked())
# ... and the raw key is reported at most once a day: a fixed loop-events line and a signed local_legacy event.
reports = []
real_report = la.report_legacy
la.report_legacy = lambda port_name, key, events_port=9121, timeout=2: reports.append((port_name, key, events_port)) or True
ct._legacy_daily = None
ct.LOOP_EVENTS.write_text("")


def raw_poke(text):
    with socket.create_connection(("127.0.0.1", port), 2) as c:
        c.sendall(text.encode())
    return poked()


check("once enforced, the raw key pokes nothing", not raw_poke(KEY + "\n"))
for _ in range(100):
    if reports:
        break
    time.sleep(0.02)
check("... reported: one loop-events line local legacy_key port=ticker side=ticker (which diag.py accepts)",
      [l.split(" ", 1)[1] for l in ct.LOOP_EVENTS.read_text().splitlines()] == ["local legacy_key port=ticker side=ticker"]
      and diag.local_line_ok("local legacy_key port=ticker side=ticker"), ct.LOOP_EVENTS.read_text())
check("... and the app told once, as port ticker under the ticker's key", reports == [("ticker", KEY, ct.EVENTS_PORT)], reports)
check("... the raw key again that day: nothing poked, nothing reported", not raw_poke(KEY + "\n") and len(reports) == 1
      and ct.LOOP_EVENTS.read_text().count("legacy_key") == 1)
ct._legacy_daily.last -= 86400
check("... the next day: reported again", not raw_poke(KEY + "\n") and ct.LOOP_EVENTS.read_text().count("legacy_key") == 2)
ct._legacy_daily.last -= 86400
check("another key once enforced: nothing poked, not reported", not raw_poke(OTHER + "\n") and ct.LOOP_EVENTS.read_text().count("legacy_key") == 2)
ct.DIAG_OFF.write_text("")
ct._legacy_daily = None
raw_poke(KEY + "\n")
check("with the diagnostic log off: no line written (the app is still told)", ct.LOOP_EVENTS.read_text().count("legacy_key") == 2)
ct.DIAG_OFF.unlink()
ct.ENFORCED.unlink()
time.sleep(0.2)
n = len(reports)
ct._legacy_daily = None
with socket.create_connection(("127.0.0.1", port), 2) as c:
    c.sendall((KEY + "\n").encode())
check("without the enforced file the raw key pokes again, and is never reported", poked() and len(reports) == n
      and ct.LOOP_EVENTS.read_text().count("legacy_key") == 2)
ct.LOOP_EVENTS.unlink()
la.report_legacy = real_report

key_now[0] = "k3y"
with socket.create_connection(("127.0.0.1", port), 2) as c:
    c.sendall(b"HELLO 1 " + la.nonce().encode() + b"\n")
    c.settimeout(3)
    got = c.recv(512)
check("a key too short to prove with: no answer to a hello", got == b"", got)
with socket.create_connection(("127.0.0.1", port), 2) as c:
    c.sendall(b"k3y\n")
check("... while the raw short key still pokes", poked())
key_now[0] = KEY

print("slow and silent clients")
la.LINE_DEADLINE_S, la.LINE_READ_S = 1.0, 0.5
t0 = time.monotonic()
with socket.create_connection(("127.0.0.1", port), 3) as c:
    nc = la.nonce()
    text = f"HELLO 1 {nc}\n".encode()
    got = b""
    try:
        for i in range(len(text)):  # one byte every 0.1 s: past the whole-exchange deadline
            c.sendall(text[i:i + 1])
            time.sleep(0.1)
        c.settimeout(2)
        got = c.recv(512)
    except OSError:
        pass
check("a trickled hello gets no answer once the deadline passes", got == b"", got)
with socket.create_connection(("127.0.0.1", port), 3) as c:
    ns, line, ok, nc = hello(c)
    time.sleep(1.2)
    try:
        c.sendall(poke_line(nc, ns))
    except OSError:
        pass
check("a POKE after the deadline does not", ok and not poked())
with socket.create_connection(("127.0.0.1", port), 3) as c:
    time.sleep(1.2)  # a client that says nothing holds the listener no longer than the deadline
with socket.create_connection(("127.0.0.1", port), 3) as c:
    ns, line, ok, nc = hello(c)
    c.sendall(poke_line(nc, ns))
check("the listener carries on after slow clients", ok and poked())
la.LINE_DEADLINE_S, la.LINE_READ_S = 5.0, 2.0
check("no port change noted while all went well", notes == [], notes)
tk.set()

print("a port that is in use")
delays = []
real_wait = threading.Event.wait


def recording_wait(ev, timeout=None):
    if threading.current_thread().name != "first-listener":  # the first listener may still be winding down, on its own clock
        delays.append(timeout)
    return real_wait(ev, 0.02 if timeout is None else min(timeout, 0.02))


tk2 = ct.Ticker()
ct.threading = types.SimpleNamespace(Event=types.SimpleNamespace(wait=recording_wait), Thread=threading.Thread)
holder = socket.socket()
holder.bind(("127.0.0.1", 0))
holder.listen(1)
held = holder.getsockname()[1]
notes2 = []
th = threading.Thread(target=ct.poke_listener, args=(tk2, held, lambda: KEY, notes2.append), daemon=True)
th.start()
for _ in range(200):
    if len(delays) >= 10:
        break
    time.sleep(0.01)
check("retries with 5 s, doubling up to 5 min", delays[:9] == [5.0, 10.0, 20.0, 40.0, 80.0, 160.0, 300.0, 300.0, 300.0], delays[:10])
check("notes 'taken' once, not at every retry", notes2 == ["taken"], notes2)
holder.close()
for _ in range(300):
    if notes2[-1:] == ["ok"]:
        break
    time.sleep(0.01)
check("notes 'ok' once it listens again", notes2 == ["taken", "ok"], notes2)
for _ in range(50):
    try:
        with socket.create_connection(("127.0.0.1", held), 0.5) as c:
            nc = la.nonce()
            c.sendall(f"HELLO 1 {nc}\n".encode())
            line, complete = lines_of(c)
            parts = line.decode().split()
            c.sendall(f"POKE 1 {la.mac(KEY, 'client', 'ticker', f'127.0.0.1:{held}', nc, parts[4], 'POKE', la.EMPTY_HASH)}\n".encode())
        break
    except (OSError, IndexError):
        time.sleep(0.02)
deadline = time.time() + 1
while time.time() < deadline and not tk2._poke.is_set():
    time.sleep(0.01)
check("... and then pokes as usual", tk2._poke.is_set())
tk2.set()
th.join(2)  # its last wait must not land in the records below

print("accept() failures")
patched, ct.threading = ct.threading, threading
tk3, tk4 = ct.Ticker(), ct.Ticker()
ct.threading = patched  # the recording wait again
logged = []


class Keep(logging.Handler):
    def emit(self, record):
        logged.append((record.levelname, record.getMessage()))


root = logging.getLogger()
root.addHandler(Keep())
root.setLevel(logging.INFO)


class FakeSrv:
    """A listening socket whose accept() follows a script: an exception to raise, or a function giving a connection."""

    def __init__(self, script):
        self.script = script

    def getsockname(self):
        return ("127.0.0.1", 9122)

    def accept(self):
        step = self.script.pop(0) if self.script else OSError(24, "Too many open files")
        if isinstance(step, BaseException):
            raise step
        return step(), None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def key_conn():
    a, b = socket.socketpair()
    b.sendall((KEY + "\n").encode())
    b.close()
    return a


def stop_conn(t):
    def make():
        t.set()
        a, b = socket.socketpair()
        b.close()
        return a
    return make


real_bind = ct._bind
binds = []
script = [ConnectionAbortedError(53, "aborted"), InterruptedError(4, "interrupted"), OSError(24, "Too many open files"),
          key_conn, OSError(24, "Too many open files"), key_conn, stop_conn(tk3)]
ct._bind = lambda port: binds.append(port) or FakeSrv(script)
delays.clear()
logged.clear()
ct.poke_listener(tk3, 9122, lambda: KEY, lambda s: None)
check("transient accept() errors keep the listening socket", binds == [9122], binds)
check("... each tried again after a short, bounded wait (then only the stop)",
      delays == [ct.ACCEPT_RETRY_S] * 4 + [ct.BIND_RETRY_FIRST] and ct.ACCEPT_RETRY_S <= 1, delays)
check("... and the connections after them are served", tk3._poke.is_set())
warns = [m for lvl, m in logged if lvl == "WARNING"]
check("... logged once per change: failing, then accepting again",
      len(warns) == 2 and sum("accepting again" in m for _, m in logged) == 2, logged)

binds.clear()
delays.clear()
logged.clear()


def counting_bind(port):
    binds.append(port)
    if len(binds) == 4:
        tk4.set()
    return FakeSrv([])  # accept() always fails


ct._bind = counting_bind
ct.poke_listener(tk4, 9122, lambda: KEY, lambda s: None)
retries = [d for d in delays if d == ct.ACCEPT_RETRY_S]
reopen = [d for d in delays if d != ct.ACCEPT_RETRY_S]
check("a lasting accept() error opens the port again only after ACCEPT_GIVE_UP failures",
      len(binds) == 4 and len(retries) == 3 * (ct.ACCEPT_GIVE_UP - 1), (len(binds), len(retries)))
check("... with the bind back-off between, growing while nothing is accepted", reopen[:3] == [5.0, 10.0, 20.0], reopen)
check("... and one warning in all, not one per pass", len([1 for lvl, _ in logged if lvl == "WARNING"]) == 1, logged)
ct._bind = real_bind
ct.threading = threading
root.setLevel(logging.WARNING)

print("the script's own folder leaves sys.path first")
import os  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402

real_dir = tmp / "real"
real_dir.mkdir()
shutil.copy(PLUGIN / "cron_ticker.py", real_dir / "cron_ticker.py")
(real_dir / "json.py").write_text("import sys\nsys.stderr.write('PLANTED json\\n')\n")  # a stand-in for a stdlib module
link_dir = tmp / "link"
link_dir.mkdir()
(link_dir / "cron_ticker.py").symlink_to(real_dir / "cron_ticker.py")  # Python puts the resolved folder on the path
(tmp / "alias").symlink_to(real_dir)
for name, script, cwd in (("run by its path", real_dir / "cron_ticker.py", tmp), ("run through a symlink", link_dir / "cron_ticker.py", tmp),
                          ("run from its folder", Path("cron_ticker.py"), real_dir)):
    r = subprocess.run([sys.executable, str(script)], cwd=cwd, capture_output=True, text=True, timeout=60,
                       env={k: v for k, v in os.environ.items() if k != "PYTHONPATH"})
    check(f"{name}: no module of its folder is imported, not even before its own imports",
          "PLANTED" not in r.stderr and "hermes_constants" in r.stderr, r.stderr[-300:])
here_cwd = os.getcwd()
os.chdir(real_dir)
try:
    kept = ct._drop_own_folder(["", ".", str(real_dir), str(tmp / "alias"), str(tmp / "alias") + "/", "/usr/lib"],
                               str(link_dir / "cron_ticker.py"))
finally:
    os.chdir(here_cwd)
check("_drop_own_folder: '', '.', the folder and a symlinked name for it all go", kept == ["/usr/lib"], kept)

print("the loop-events line")
ct.note_port("taken")
check("no file: nothing is created (the supervisor owns it)", not ct.LOOP_EVENTS.exists())
ct.LOOP_EVENTS.write_text("")
ct.note_port("taken")
ct.note_port("ok")
got = ct.LOOP_EVENTS.read_text().splitlines()
check("two fixed lines", len(got) == 2 and re.fullmatch(r"\d{10} local port_taken port=ticker", got[0]) is not None
      and re.fullmatch(r"\d{10} local port_ok port=ticker", got[1]) is not None, got)
check("both pass the diagnostic log's own check", all(diag._LINE.match(x) for x in got))
ct.DIAG_OFF.write_text("")
ct.note_port("taken")
check("the diagnostic log's off switch is respected", len(ct.LOOP_EVENTS.read_text().splitlines()) == 2)

print("\nALL PASSED" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
