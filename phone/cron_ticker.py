"""Runs Hermes's cron scheduler on the phone (same ticker Hermes Desktop runs in its backend).

The phone runs `hermes dashboard`, not the messaging gateway, so without this daemon cron jobs
would never fire. Ticks every local profile's store every 60 s; the per-store tick lock makes it
safe next to any other scheduler.

Battery: nothing holds a permanent wake lock any more, so the phone sleeps between jobs and this
ticker sleeps with it. It reports the next due job to the Hermes app (`wake_at`), which sets an
alarm that wakes the phone for it; once the job runs, its status beats keep the phone awake.
When the alarm fires the app pokes this ticker (127.0.0.1:9122) so the job starts at once (Hermes's
ticker sleeps on a monotonic clock that stops while the phone sleeps, so it would start up to 60 s
late), and once no job is running the ticker says so (`cron_idle`), so the app drops its cron wake
lock instead of holding it for a fixed 150 s.
"""
import hmac
import json
import logging
import socket
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

APP_URL = "http://127.0.0.1:9121/event"
KEY_FILE = Path("/data/data/com.termux/files/home/.hermes-mobile/key")
WAKE_CHECK = 60  # seconds between looks at the job stores (only while the phone is awake anyway)
WAKE_RESEND = 1200  # re-send an unchanged wake time now and then (alarms are lost on reboot/app update)
POKE_PORT = 9122  # the app connects here (with the shared key) when its cron alarm fires
JOB_CHECK = 2.0  # while a job runs, look this often whether it is done (only while a job runs)


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


def _key() -> str:
    try:
        return KEY_FILE.read_text().strip()
    except OSError:
        return ""


def _post(event: dict) -> bool:
    try:
        req = urllib.request.Request(APP_URL, data=json.dumps(event).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "X-Hermes-Mobile-Key": _key()})
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.status < 300
    except Exception:
        return False


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


def poke_listener(ticker: Ticker, port: int = POKE_PORT, key=_key) -> None:
    """Accepts the app's poke on loopback: one line with the shared key. Blocks in accept() (no wake-ups)."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind(("127.0.0.1", port))
    except OSError as e:
        logging.warning("poke listener not started (port %d: %s): jobs may start up to 60 s after the alarm", port, e)
        return
    srv.listen(4)
    while not ticker.is_set():
        conn, _ = srv.accept()
        with conn:
            try:
                conn.settimeout(2)
                got = conn.recv(256).strip()
            except OSError:
                continue
            want = key().encode()
            if want and hmac.compare_digest(got, want):
                ticker.poke()


if __name__ == "__main__":
    import faulthandler

    faulthandler.enable()  # a crash prints every thread's stack to the log
    sys.path.insert(0, "/root/.hermes/hermes-agent")
    bootstrap()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    from hermes_cli.web_server import _start_desktop_cron_ticker  # noqa: E402

    wake = WakeReporter()

    def idle(since: float) -> None:
        wake.report(force=True)  # the next due time first: the app may let the phone sleep right after cron_idle
        _post({"kind": "cron_idle", "since": since})

    stop = Ticker(running=running_jobs, idle=idle)
    threading.Thread(target=poke_listener, args=(stop,), daemon=True, name="cron-poke").start()
    threading.Thread(target=_start_desktop_cron_ticker, args=(stop,), daemon=True, name="cron-ticker").start()
    reporter_stop = threading.Event()
    threading.Thread(target=wake.loop, args=(reporter_stop,), daemon=True, name="wake-reporter").start()
    threading.Event.wait(stop)  # the main thread just parks (a plain wait: it must not run the cycle logic)
