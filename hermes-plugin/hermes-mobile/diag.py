"""The diagnostic log on Hermes's side of the phone: what happened in the agent, never what was said or done.

The rule is the same as the app's (android/.../DiagLog.java, web/src/diaglog.ts): an event is an area, a name and short
fields, each checked against a fixed shape when it is written AND when it is read back, so free text can't get in or
out. Nothing here sends anything: the app reads GET /diag only while the user prepares a problem report.

What the app gets from the raw service logs (~/logs/<loop>.log, which can hold anything a program printed) is only the
shape of a Python traceback: the exception's type and the frames in Hermes, the plugin or an installed package. Never
the exception's words, a code line or a frame in any other file.
"""
import hashlib
import os
import re
import secrets
import sys
import time
from pathlib import Path

MAX_BYTES = 128 * 1024  # each of the two files
MAX_AGE_SEC = 7 * 86_400
RATE_MAX = 60  # events a minute, per process
MAX_FIELDS = 8
MAX_READ_LINES = 400  # what one read answers with
TRACE_TAIL_BYTES = 256 * 1024  # of each service log
MAX_TRACES = 10
MAX_FRAMES = 8
LOOPS = ("dashboard", "memory-sync", "cron-ticker", "app-keeper")

_NAME = re.compile(r"[a-z][a-z0-9_]{0,23}\Z")
_VALUE = re.compile(r"[A-Za-z0-9_.:+-]{1,32}\Z")  # holds a model's name, not a sentence, a path or the common keys (40 and more)
_LINE = re.compile(r"(\d{9,11}) ([a-z][a-z0-9_]{0,23}) ([a-z][a-z0-9_]{0,23})((?: [a-z][a-z0-9_]{0,23}=(?:\?|[A-Za-z0-9_.:+-]{1,32}))*)\Z")
_FRAME = re.compile(r'\s+File "([^"]+)", line (\d+), in ([\w<>.]+)\s*\Z')
_ERROR_TYPE = re.compile(r"([A-Za-z_][\w.]{0,80})(?::|\s*\Z)")
_CODE_ROOTS = ("/site-packages/", "/hermes-agent/", "/hermes-mobile/")

_salt = secrets.token_hex(8)  # chat aliases mean nothing outside this process
_rate = {"minute": 0, "count": 0, "dropped": 0}


def termux_home() -> Path:
    """Termux's home as Hermes's Debian sees it (the same path under proot and chroot)."""
    return Path(os.environ.get("HM_TERMUX_HOME") or "/data/data/com.termux/files/home")


def _dir() -> Path:
    return Path.home() / ".hermes" / "mobile"


def log_path() -> Path:
    return _dir() / "diag.log"


def off_path() -> Path:
    """Off is a file in Termux's home: hermes-services, which runs there, respects it too."""
    return termux_home() / ".hermes-mobile" / "diag-off"


def enabled() -> bool:
    return not off_path().exists()


def alias(session_id) -> str:
    """A short name for a chat, so one chat's events can be followed: not its ID."""
    return hashlib.sha256(f"{_salt}|{session_id}".encode()).hexdigest()[:8] if session_id else "none"


def format_line(at: int, area: str, name: str, fields: dict) -> str:
    """One checked line; anything the wrong shape is written as "?" (a name as "unknown")."""
    def good_name(s):
        return s if isinstance(s, str) and _NAME.match(s) else "unknown"

    parts = [str(int(at)), good_name(area), good_name(name)]
    for k, v in list(fields.items())[:MAX_FIELDS]:
        if v is None:
            continue
        v = "true" if v is True else "false" if v is False else str(v)
        parts.append(f"{good_name(k)}={v if _VALUE.match(v) else '?'}")
    return " ".join(parts)


def event(area: str, name: str, **fields) -> None:
    """Adds one event. Never raises: logging must not take a turn down."""
    try:
        if not enabled():
            return
        now = int(time.time())
        minute = now // 60
        if minute != _rate["minute"]:
            _rate.update(minute=minute, count=0)
        _rate["count"] += 1
        if _rate["count"] > RATE_MAX:
            _rate["dropped"] += 1
            return
        text = format_line(now, area, name, fields) + "\n"
        if _rate["dropped"]:
            text = format_line(now, "log", "dropped", {"count": _rate["dropped"]}) + "\n" + text
            _rate["dropped"] = 0
        path = log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size + len(text) > MAX_BYTES:
            os.replace(path, f"{path}.1")
        # O_APPEND: several Hermes processes write here, each line whole.
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, text.encode())
        finally:
            os.close(fd)
    except Exception:
        pass


def _pretty(at: int) -> str:
    return time.strftime("%m-%d %H:%M:%S", time.gmtime(at))  # UTC, no year and no time zone


def read_lines(paths, now=None) -> list:
    """The checked lines of these files, oldest first, without any line that isn't one of ours or is too old."""
    now = now or time.time()
    out = []
    for p in paths:
        try:
            text = Path(p).read_text(errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            m = _LINE.match(line)
            if not m or now - int(m.group(1)) > MAX_AGE_SEC:
                continue
            out.append((int(m.group(1)), f"{_pretty(int(m.group(1)))} {line[m.end(1) + 1:]}"))
    out.sort(key=lambda x: x[0])
    return [text for _, text in out][-MAX_READ_LINES:]


def _clean_frame(path: str, line: str, func: str):
    for root in _CODE_ROOTS:
        at = path.find(root)
        if at >= 0:
            rel = path[at + len(root):]
            if re.fullmatch(r"[A-Za-z0-9_./-]{1,80}\.py", rel):
                return f"{rel}:{line}"
    return None  # any other file: its name can be the user's own


def traceback_shapes(text: str) -> list:
    """[{type, at: [frames], count}], latest last: the shape of each Python traceback in the text, nothing else."""
    found = {}
    frames = None
    for line in text.splitlines():
        if line.startswith("Traceback (most recent call last):"):
            frames = []
            continue
        if frames is None:
            continue
        if line[:1] in (" ", "\t"):
            m = _FRAME.match(line)
            if m:
                frame = _clean_frame(m.group(1), m.group(2), m.group(3))
                if frame:
                    frames.append(frame)
            continue  # a code line, or an indented part of the error: never kept
        m = _ERROR_TYPE.match(line)
        kind = m.group(1) if m else "unknown"
        at = tuple(frames[-MAX_FRAMES:])
        item = found.pop((kind, at), {"type": kind, "at": list(at), "count": 0})
        item["count"] += 1
        found[(kind, at)] = item  # re-added: the order is by the latest time it happened
        frames = None
    return list(found.values())


def _tail(path: Path, n: int) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - n))
            return f.read().decode(errors="replace")
    except OSError:
        return ""


def _alive(pid_file: Path) -> bool:
    try:
        os.kill(int(pid_file.read_text().strip()), 0)
        return True
    except PermissionError:
        return True  # it exists, and belongs to someone else
    except (OSError, ValueError):
        return False


def services() -> list:
    logs = termux_home() / "logs"
    out = []
    for name in LOOPS:
        pid = logs / f"{name}.pid"
        if not pid.exists():
            continue
        try:
            kb = (logs / f"{name}.log").stat().st_size // 1024
        except OSError:
            kb = 0
        out.append({"name": name, "alive": _alive(pid), "log_kb": kb})
    return out


def crashes() -> list:
    """The traceback shapes of the service logs, with the service's name."""
    logs = termux_home() / "logs"
    out = []
    for name in LOOPS:
        for t in traceback_shapes(_tail(logs / f"{name}.log", TRACE_TAIL_BYTES)):
            out.append({"service": name, **t})
    return out[-MAX_TRACES:]


def facts(plugin_stamp: int = 0) -> dict:
    distro = ""
    try:
        d = (termux_home() / ".hermes-mobile" / "distro").read_text().strip()
        distro = d if d in ("proot", "chroot") else ""
    except OSError:
        pass
    return {
        "plugin_stamp": plugin_stamp,
        "python": ".".join(str(n) for n in sys.version_info[:3]),
        "debian": distro or "proot",
    }


def snapshot(plugin_stamp: int = 0) -> dict:
    """What GET /diag answers. While the log is off: nothing but that it is off."""
    if not enabled():
        return {"enabled": False, "facts": {}, "events": [], "services": [], "crashes": []}
    path = log_path()
    return {
        "enabled": True,
        "facts": facts(plugin_stamp),
        "events": read_lines([f"{path}.1", path, termux_home() / "logs" / "loop-events.log"]),
        "services": services(),
        "crashes": crashes(),
    }


def clear() -> None:
    """Deletes the log, and empties the service logs the crash shapes come from. A service still writing to one carries
    on at its new end: they are opened for appending."""
    path = log_path()
    for p in (path, Path(f"{path}.1"), termux_home() / "logs" / "loop-events.log"):
        try:
            p.unlink()
        except OSError:
            pass
    for name in LOOPS:
        try:
            os.truncate(termux_home() / "logs" / f"{name}.log", 0)
        except OSError:
            pass


def set_enabled(on: bool) -> None:
    """Off also deletes what was kept."""
    off = off_path()
    if on:
        try:
            off.unlink()
        except OSError:
            pass
        return
    off.parent.mkdir(parents=True, exist_ok=True)
    off.write_text("")
    clear()
