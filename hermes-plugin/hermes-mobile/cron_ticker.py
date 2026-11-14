"""Runs Hermes's cron scheduler on the phone (same ticker Hermes Desktop runs in its backend).

The phone runs `hermes dashboard`, not the messaging gateway, so without this daemon cron jobs
would never fire. Ticks every local profile's store every 60 s; the per-store tick lock makes it
safe next to any other scheduler.

Battery: nothing holds a permanent wake lock any more, so the phone sleeps between jobs and this
ticker sleeps with it. It reports the next due job to the Hermux app (`wake_at`), which sets an
alarm that wakes the phone for it; once the job runs, its status beats keep the phone awake.
When the alarm fires the app pokes this ticker (127.0.0.1:9122) so the job starts at once (Hermes's
ticker sleeps on a monotonic clock that stops while the phone sleeps, so it would start up to 60 s
late), and once no job is running the ticker says so (`cron_idle`), so the app drops its cron wake
lock instead of holding it for a fixed 150 s.

The poke listener proves itself before it acts (local authentication, local_auth.ticker_serve_one): the
app sends `HELLO 1 <nonce>` (optionally followed by its key id, a hint), the ticker answers with a proof under the shared key, and only a
`POKE 1 <mac>` over both nonces pokes it. A first line that is the shared key itself (the app's
protocol before this one) still pokes it until ~/.hermes-mobile/enforced exists; after that it pokes nothing and is
reported once a day (`local legacy_key port=ticker`, and a signed `local_legacy` event to the app). When the port is
in use the listener tries again (5 s, doubling to 5 min) for as long as the ticker runs, and notes
each change in ~/logs/loop-events.log for the diagnostic log (and tells the app, `local_port`).

As a client of the app (`wake_at`, `cron_idle`, `local_port`) it verifies the app's listener first (local
authentication, local_auth.session, role events): the request is signed on the connection that proved itself, the key
is never sent, and a listener that doesn't prove it gets nothing (then it waits, 1 s doubling to 5 min). Without
local_auth.py next to it, it sends nothing and says so once in its log.

Ships inside the plugin folder; the supervisor runs this copy when it is there.
"""
import os  # both already loaded by the interpreter itself, so no file in this folder can stand in for them
import sys


def _drop_own_folder(entries, script):
    """``entries`` (sys.path) without the folder this script is in. Run from the plugin folder, Python puts that folder
    first, where the plugin's own modules could stand in for a module of the same name from the standard library or
    Hermes. Compared by real path on both sides (Python resolves a symlinked script), and ``''`` or ``.`` count as the
    current folder."""
    here = os.path.dirname(os.path.realpath(os.path.abspath(script)))
    return [p for p in entries if os.path.realpath(p or os.curdir) != here]


if __name__ == "__main__":
    sys.path[:] = _drop_own_folder(sys.path, __file__)  # before any other import; local_auth.py is loaded by its path

import hmac
import json
import logging
import socket
import threading
import time
from datetime import datetime
from pathlib import Path

EVENTS_PORT = 9121  # the app's listener
TERMUX_HOME = Path("/data/data/com.termux/files/home")
KEY_FILE = TERMUX_HOME / ".hermes-mobile" / "key"
ENFORCED = TERMUX_HOME / ".hermes-mobile" / "enforced"  # once there, the raw key no longer pokes
LOOP_EVENTS = TERMUX_HOME / "logs" / "loop-events.log"  # the supervisor's file of fixed lines (diag.py reads it)
DIAG_OFF = TERMUX_HOME / ".hermes-mobile" / "diag-off"
WAKE_CHECK = 60  # seconds between looks at the job stores (only while the phone is awake anyway)
WAKE_RESEND = 1200  # re-send an unchanged wake time now and then (alarms are lost on reboot/app update)
POKE_PORT = 9122  # the app connects here when its cron alarm fires
JOB_CHECK = 2.0  # while a job runs, look this often whether it is done (only while a job runs)
BIND_RETRY_FIRST = 5.0  # the poke port is in use: try again after this long, doubling each time ...
BIND_RETRY_MAX = 300.0  # ... up to this; a sleeping thread, so no wake-ups while the phone sleeps
ACCEPT_RETRY_S = 0.5  # a failed accept() is tried again on the same socket after this long ...
ACCEPT_GIVE_UP = 20  # ... and the port is opened again only after this many failures in a row


def _local_auth():
    """The plugin's local_auth.py, next to this file; None when it isn't there (then only the raw key pokes)."""
    mod = sys.modules.get("hm_local_auth")
    if mod is not None:
        return mod
    try:
        import importlib.util

        spec = importlib.util.spec_from_file_location("hm_local_auth", Path(__file__).resolve().with_name("local_auth.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:
        return None
    sys.modules["hm_local_auth"] = mod
    return mod


def _runnable(job: dict) -> bool:
    """Hermes's is_job_runnable plus terminal states (cron/jobs.py)."""
    if not job.get("enabled", True) or job.get("paused_at"):
        return False
    return str(job.get("state") or "").strip() not in ("paused", "completed", "error")


def next_wake(homes, now: float):
    """Earliest future next_run_at (epoch seconds) over the profiles' cron stores, or 0 when none is due."""
    best = 0.0
    for home in homes:
        try:
            data = json.loads((Path(home) / "cron" / "jobs.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        jobs = data.get("jobs", []) if isinstance(data, dict) else data
        if isinstance(jobs, dict):
            jobs = list(jobs.values())
        for job in jobs if isinstance(jobs, list) else []:
            if not isinstance(job, dict) or not _runnable(job) or not job.get("next_run_at"):
                continue
            try:
                at = datetime.fromisoformat(str(job["next_run_at"]).replace("Z", "+00:00")).timestamp()
            except ValueError:
                continue
            if at > now and (not best or at < best):
                best = at
    return best


def _homes():
    try:
        from hermes_cli.profiles import profiles_to_serve
        return [home for _name, home in profiles_to_serve(multiplex=True)]  # the set the ticker ticks
    except Exception:
        root = Path("/root/.hermes")
        return [root, *sorted(p for p in (root / "profiles").glob("*") if (p / "config.yaml").exists())]


_key_file = None


def _key() -> str:
    """The shared key, read again only when the file changes (local_auth.KeyFile); "" when there is none."""
    global _key_file
    la = _local_auth()
    if la is None:
        try:
            return KEY_FILE.read_text().strip()
        except OSError:
            return ""
    if _key_file is None:
        _key_file = la.KeyFile(lambda: KEY_FILE)
    return _key_file.read()


_client: dict = {"backoff": None, "said": set()}


def _say_once(what: str, text: str) -> None:
    if what not in _client["said"]:
        _client["said"].add(what)
        logging.warning("%s", text)


def _post(event: dict) -> bool:
    """One event to the app, after its listener proved it holds the key (same connection, signed request). True on a
    2xx answer. Never sends the key, and nothing at all to a listener that doesn't verify. Logs only fixed words."""
    la = _local_auth()
    if la is None:
        _say_once("module", "events: local_auth.py is missing next to this file; nothing is sent to the app")
        return False
    key = _key()
    if not key:
        return False
    if _client["backoff"] is None:
        _client["backoff"] = la.Backoff()
    backoff = _client["backoff"]
    if not backoff.ready():
        return False
    try:
        answer = la.session("events", EVENTS_PORT, key, timeout=2).request("POST", "/event", json.dumps(event).encode())
    except la.Unverified as e:
        if e.why != "no_answer":
            backoff.failed()
            _say_once("why:" + e.why, f"events: the app's listener was not verified ({e.why}); nothing was sent")
        return False
    except Exception:
        return False
    backoff.ok()
    _client["said"].discard("module")
    return 200 <= answer.status < 300


class WakeReporter:
    """Tells the app when the next job is due (only when that changes, plus a resend now and then)."""

    def __init__(self, homes=None, post=None):
        self.homes = homes or _homes
        self.post = post or _post
        self.sent, self.sent_at = None, 0.0
        self.lock = threading.Lock()

    def report(self, force=False) -> None:
        with self.lock:
            at = next_wake(self.homes(), time.time())
            if (force or at != self.sent or time.time() - self.sent_at > WAKE_RESEND) and self.post({"kind": "wake_at", "at": at}):
                if at != self.sent:
                    logging.info("next wake %s", time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(at)) if at else "none")
                self.sent, self.sent_at = at, time.time()

    def loop(self, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                self.report()
            except Exception:
                logging.exception("wake reporter")
            stop.wait(WAKE_CHECK)


class Ticker(threading.Event):
    """The stop event Hermes's ticker loop waits on between cycles (it only calls is_set() and wait()), so each
    wait() marks the end of a tick cycle. There, once no job is running after a poke or a job, it reports
    `cron_idle` with the cycle's start time; the app then lets the phone sleep. poke() ends one wait early
    (the loop ticks as if the interval had passed); set() still stops the loop."""

    def __init__(self, running=None, idle=None):
        super().__init__()
        self._poke = threading.Event()
        self._running = running or (lambda: False)
        self._idle = idle or (lambda since: None)
        self._cycle = time.time()  # when the current cycle began
        self._owed = False  # report cron_idle at the end of this cycle (after a poke or a running job)

    def poke(self) -> None:
        self._poke.set()

    def set(self) -> None:
        super().set()
        self._poke.set()

    def wait(self, timeout=None) -> bool:
        end = None if timeout is None else time.monotonic() + timeout
        while not self.is_set():
            busy = self._safe(self._running, False)
            if busy:
                self._owed = True
            elif self._owed:
                self._owed = False
                self._safe(lambda: self._idle(self._cycle))
            left = None if end is None else end - time.monotonic()
            if left is not None and left <= 0:
                break
            step = (JOB_CHECK if left is None else min(JOB_CHECK, left)) if busy else left
            if self._poke.wait(step):
                self._poke.clear()
                if not self.is_set():
                    self._owed = True  # the cycle a poke starts must say when it is done
                break
        self._cycle = time.time()
        return self.is_set()

    @staticmethod
    def _safe(fn, default=None):
        try:
            return fn()
        except Exception:
            logging.exception("cron ticker hook")
            return default


def bootstrap() -> None:
    """Load Hermes's launch bootstrap in the MAIN thread at start, as the `hermes` launcher does. Otherwise the
    first agent job imports it (via run_agent) in a worker thread, where its launch check re-execs the process
    into Hermes's own interpreter: os.execv from a non-main thread, which kills the ticker under proot
    (signal 11) and loses the job. Here the re-exec, if any, happens once before any thread exists."""
    import os

    from hermes_constants import get_default_hermes_root

    os.environ.pop("PYTHONHOME", None)
    os.environ["HERMES_HOME"] = os.environ.get("HERMES_HOME") or str(get_default_hermes_root())
    import hermes_bootstrap  # noqa: F401


def running_jobs() -> bool:
    import cron.scheduler as sched
    return bool(sched.get_running_job_ids())


def note_port(state: str) -> None:
    """A change of the poke port's state as one fixed line in the supervisor's loop-events log (diag.py checks it again
    when it reads it): `local port_taken port=ticker` or `local port_ok port=ticker`. Only appends to a file that is
    already there (the supervisor, running as Termux's user, owns it); respects the diagnostic log's off switch."""
    _loop_line(f"local {'port_taken' if state == 'taken' else 'port_ok'} port=ticker")


def _loop_line(text: str) -> None:
    """One fixed line (``<time> <text>``) appended to the loop-events log, only to a file already there, never through
    a link, and not while the diagnostic log is off."""
    if DIAG_OFF.exists():
        return
    line = f"{int(time.time())} {text}\n"
    try:
        fd = os.open(LOOP_EVENTS, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return
    try:
        os.write(fd, line.encode())
    except OSError:
        pass
    finally:
        os.close(fd)


def _bind(port: int) -> socket.socket:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", port))
        srv.listen(4)
    except OSError:
        srv.close()
        raise
    return srv


_legacy_daily = None


def note_legacy(key: str) -> bool:
    """A raw key reached the poke port after the switch (it poked nothing): at most once a day, the fixed line
    `local legacy_key port=ticker side=ticker` in the loop-events log (like note_port) and a signed `local_legacy` event
    to the app under ``key`` (local_auth.report_legacy, on a thread of its own), which then replaces the key. True when
    it was due."""
    global _legacy_daily
    la = _local_auth()
    if la is None:
        return False
    if _legacy_daily is None:
        _legacy_daily = la.Daily()
    if not _legacy_daily.due():
        return False
    _loop_line("local legacy_key port=ticker side=ticker")
    if key:
        threading.Thread(target=la.report_legacy, args=("ticker", key, EVENTS_PORT), daemon=True).start()
    return True


def serve_one(conn, key: str, where) -> bool:
    """One poke connection: True when it pokes. A verified `POKE` after the hello always does; the raw key as the
    first line does until ENFORCED exists, and after that is refused and reported (note_legacy). Without local_auth.py
    only the raw key is understood, and never once ENFORCED exists."""
    la = _local_auth()
    if la is not None and where:
        got = la.ticker_serve_one(conn, key, where, legacy=not ENFORCED.exists())
        if got == "legacy_refused":
            note_legacy(key)
        return got in ("poke", "legacy")
    try:  # the protocol before local authentication
        conn.settimeout(2)
        got = conn.recv(256).strip()
    except OSError:
        return False
    want = (key or "").encode()
    return bool(want) and hmac.compare_digest(got, want) and not ENFORCED.exists()


def _accept_loop(srv, ticker, key, where, state: dict) -> tuple:
    """Serves connections on ``srv`` until the ticker stops. A failing accept() (interrupted, a connection aborted
    before it was taken, no file descriptor left) is tried again on the same socket after ACCEPT_RETRY_S; only after
    ACCEPT_GIVE_UP failures in a row does it return, so the caller opens the port again. Returns ``(gave_up,
    accepted)``. Logs only a change, kept in ``state`` across sockets: failing, then accepting again."""
    failures, accepted = 0, False
    while not ticker.is_set():
        try:
            conn, _ = srv.accept()
        except OSError:
            failures += 1
            if not state.get("failing"):
                state["failing"] = True
                logging.warning("poke listener: accepting a connection failed; trying again")
            if failures >= ACCEPT_GIVE_UP:
                return True, accepted
            threading.Event.wait(ticker, ACCEPT_RETRY_S)  # bounded: a lasting error costs a few wake-ups, not a spin
            continue
        failures, accepted = 0, True
        if state.get("failing"):
            state["failing"] = False
            logging.info("poke listener: accepting again")
        with conn:
            try:
                if serve_one(conn, key(), where):
                    ticker.poke()
            except Exception:
                pass  # one connection's bytes never stop the listener
    return False, accepted


def poke_listener(ticker: Ticker, port: int = POKE_PORT, key=_key, note=None) -> None:
    """Accepts the app's poke on loopback (see serve_one). Blocks in accept() (no wake-ups). When the port is in use it
    tries again after BIND_RETRY_FIRST, doubling up to BIND_RETRY_MAX, for as long as the ticker runs; it logs and
    notes (`note`, default note_port) only a change: taken, then free again. A socket that keeps failing to accept is
    opened again with the same back-off (see _accept_loop)."""
    note = note or note_port
    delay, taken = BIND_RETRY_FIRST, None
    state: dict = {}
    while not ticker.is_set():
        try:
            srv = _bind(port)
        except OSError:
            if taken is not True:
                taken = True
                logging.warning("poke listener: its port is in use; trying again (meanwhile a job may start up to 60 s "
                                "after its alarm)")
                note("taken")
        else:
            if taken is True:
                logging.info("poke listener: listening again")
                note("ok")
            taken = False
            with srv:
                la = _local_auth()
                host, bound = srv.getsockname()[:2]
                where = la.server_addr(host, bound) if la is not None else None
                _gave_up, accepted = _accept_loop(srv, ticker, key, where, state)
            if accepted:  # it worked for a while: a new failure starts the back-off again
                delay = BIND_RETRY_FIRST  # (a socket that never accepted keeps the back-off growing)
        if threading.Event.wait(ticker, delay):  # the plain wait: Ticker.wait runs the cycle logic
            break
        delay = min(delay * 2, BIND_RETRY_MAX)


if __name__ == "__main__":
    import faulthandler

    faulthandler.enable()  # a crash prints every thread's stack to the log
    sys.path.insert(0, "/root/.hermes/hermes-agent")  # this script's own folder left the path at the top
    bootstrap()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    from hermes_cli.web_server import _start_desktop_cron_ticker  # noqa: E402

    wake = WakeReporter()

    def idle(since: float) -> None:
        wake.report(force=True)  # the next due time first: the app may let the phone sleep right after cron_idle
        _post({"kind": "cron_idle", "since": since})

    def note(state: str) -> None:
        note_port(state)
        _post({"kind": "local_port", "port": "ticker", "state": "taken" if state == "taken" else "ok"})

    stop = Ticker(running=running_jobs, idle=idle)
    threading.Thread(target=poke_listener, args=(stop,), kwargs={"note": note}, daemon=True, name="cron-poke").start()
    threading.Thread(target=_start_desktop_cron_ticker, args=(stop,), daemon=True, name="cron-ticker").start()
    reporter_stop = threading.Event()
    threading.Thread(target=wake.loop, args=(reporter_stop,), daemon=True, name="wake-reporter").start()
    threading.Event.wait(stop)  # the main thread just parks (a plain wait: it must not run the cycle logic)
