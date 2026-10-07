"""File checkpoints per chat, for the app's "File checkpoints" sheet.

Hermes snapshots a folder (shadow git store, `tools/checkpoint_manager.py`) before `write_file` /
`patch`, but per FOLDER, not per chat: the folder is the edited file's project root (nearest
.git / pyproject / package.json / an already-checkpointed root, else the file's own folder), and
the gateway's `rollback.*` methods only look at the session's cwd. So a chat that edits files
elsewhere never sees its snapshots there.

This module (stdlib only; Hermes imports are lazy):
  * `pre_tool` / `post_tool` (plugin hooks, inside the Hermes process) read the folder's ref tip
    before and after the call. A new tip = the snapshot Hermes took for this edit; it is written
    to the chat's ledger `~/.hermes/mobile/checkpoints/<session>.jsonl`. Snapshots are identified
    by tree + author date, because Hermes's pruning rewrites the chain (new commit ids, same
    trees and dates) each time a folder goes past its snapshot limit.
  * `list_for_session`, `diff`, `restore` (dashboard API) group a chat's snapshots by folder and
    run Hermes's own CheckpointManager on them (its store lock, safe restore, undo snapshot).
  * `install_git_env_shim` makes every checkpoint git call ~40x cheaper: Hermes asks its package
    manager for a private git before EACH call, and on Linux that spawns a worker interpreter
    (~1.5 s inside proot) only to learn "POSIX uses system git". The answer is cached per process.
  * `maintain` (once a day, after a turn ends): `git gc` when Hermes left one pending, and drops
    project entries that never got a snapshot (`~/.hermes` itself: >50k files, so every edit
    under it counted files for ~3 s and then skipped).
"""

import hashlib
import json
import os
import subprocess
import threading
import time
from pathlib import Path

FILE_TOOLS = ("write_file", "patch")
GC_EVERY = 24 * 3600
_pending: dict = {}  # tool_call_id -> (session, tool, file, workdir, base, tip before)
_lock = threading.Lock()


def _root_home() -> Path:
    """The default profile's home (ledgers are shared by all profiles; each entry names its store)."""
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    return home.parent.parent if home.parent.name == "profiles" else home


def ledger_dir() -> Path:
    return _root_home() / "mobile" / "checkpoints"


def _safe_sid(session_id: str) -> str:
    sid = str(session_id or "")
    if not sid or "/" in sid or sid.startswith(".") or len(sid) > 120:
        raise ValueError("bad session id")
    return sid


# ── store helpers (same layout as tools/checkpoint_manager.py) ──

def project_hash(workdir: str) -> str:
    return hashlib.sha256(str(Path(workdir).expanduser().resolve()).encode()).hexdigest()[:16]


def ref_name(workdir: str) -> str:
    return f"refs/hermes/{project_hash(workdir)}"


def ref_tip(base: str, workdir: str) -> str:
    """Current commit of the folder's ref, read from the files (no git process), '' if none."""
    store = Path(base) / "store"
    ref = ref_name(workdir)
    try:
        return (store / ref).read_text().strip()
    except OSError:
        pass
    try:
        for line in (store / "packed-refs").read_text().splitlines():
            sha, _, name = line.partition(" ")
            if name.strip() == ref:
                return sha
    except OSError:
        pass
    return ""


def _git(base: str, *args: str, timeout: int = 30) -> str:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "GIT_DIR": str(Path(base) / "store"),
           "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    r = subprocess.run(["git", *args], capture_output=True, text=True, errors="replace", env=env,
                       timeout=timeout, stdin=subprocess.DEVNULL)
    return r.stdout if r.returncode == 0 else ""


def history(base: str, workdir: str) -> list:
    """The folder's snapshots, newest first: [{hash, tree, date, reason}]."""
    out = _git(base, "log", ref_name(workdir), "--format=%H%x00%T%x00%aI%x00%s")
    rows = []
    for line in out.splitlines():
        parts = line.split("\x00")
        if len(parts) == 4:
            rows.append({"hash": parts[0], "tree": parts[1], "date": parts[2], "reason": parts[3]})
    return rows


# ── recording (plugin hooks, inside Hermes) ──

def _resolve(path: str, task_id: str) -> str:
    try:
        from tools.file_tools_paths import _resolve_path_for_task
        return str(_resolve_path_for_task(path, task_id or "default"))
    except Exception:
        return os.path.abspath(os.path.expanduser(path))


def _target(path: str, task_id: str):
    """(file, workdir, checkpoint base) the way Hermes's file tools checkpoint it, or None."""
    try:
        from tools.checkpoint_manager import CheckpointManager, _resolve_checkpoint_base
    except Exception:
        return None
    f = _resolve(path, task_id)
    wd = CheckpointManager().get_working_dir_for_path(f)
    return f, str(Path(wd).resolve()), str(_resolve_checkpoint_base())


def pre_tool(tool_name, args, session_id, task_id, tool_call_id) -> None:
    if tool_name not in FILE_TOOLS or not isinstance(args, dict) or not args.get("path") or not session_id:
        return
    install_git_env_shim()  # no-op after the first call; register() may have run before Hermes's tools imported
    t = _target(str(args["path"]), task_id)
    if t:
        f, wd, base = t
        with _lock:
            _pending[tool_call_id or f"{session_id}:{f}"] = (session_id, tool_name, f, wd, base, ref_tip(base, wd))


def post_tool(tool_name, args, session_id, turn_id, tool_call_id, path=None) -> None:
    """Record which snapshot came before this edit (a new tip), or that the turn's earlier one did."""
    if tool_name not in FILE_TOOLS or not isinstance(args, dict):
        return
    with _lock:
        p = _pending.pop(tool_call_id or f"{session_id}:{_resolve(str(args.get('path', '')), '')}", None)
    if not p:
        return
    sid, tool, f, wd, base, before = p
    after = ref_tip(base, wd)
    if not after:
        return
    entry = {"ts": time.time(), "turn": turn_id or "", "tool": tool, "file": f, "workdir": wd, "base": base}
    if after != before:
        info = _git(base, "log", "-1", "--format=%T%x00%aI%x00%s", after).strip().split("\x00")
        if len(info) != 3:
            return
        entry.update(tree=info[0], date=info[1], reason=info[2])
    else:
        # No new snapshot: a second edit of this folder in the same turn (Hermes takes one per turn).
        prev = next((e for e in reversed(read_ledger(sid, path)) if e.get("workdir") == wd and e.get("base") == base), None)
        if not prev or not turn_id or prev.get("turn") != turn_id:
            return
        entry.update(tree=prev["tree"], date=prev["date"], reason=prev.get("reason", ""))
    write_entry(sid, entry, path)


def write_entry(session_id: str, entry: dict, path=None) -> None:
    d = Path(path) if path else ledger_dir()
    d.mkdir(parents=True, exist_ok=True)
    with open(d / f"{_safe_sid(session_id)}.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def read_ledger(session_id: str, path=None) -> list:
    d = Path(path) if path else ledger_dir()
    try:
        lines = (d / f"{_safe_sid(session_id)}.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict) and e.get("workdir") and e.get("base") and e.get("tree") and e.get("date"):
            out.append(e)
    return out


def delete_ledger(session_id: str, path=None) -> None:
    d = Path(path) if path else ledger_dir()
    try:
        (d / f"{_safe_sid(session_id)}.jsonl").unlink()
    except OSError:
        pass


# ── listing (dashboard API) ──

def snap_id(tree: str, date: str) -> str:
    return f"{tree[:16]}@{date}"


def group(entries: list, histories: dict) -> list:
    """Folders (newest activity first), each with the chat's snapshots newest first.
    `histories[(base, workdir)]` = `history()` rows. A snapshot no longer in the history was
    pruned by Hermes; it is counted in `pruned`, not listed."""
    folders: dict = {}
    for e in entries:
        key = (e["base"], e["workdir"])
        f = folders.setdefault(key, {"workdir": e["workdir"], "base": e["base"], "snaps": {}, "last": 0})
        sid = snap_id(e["tree"], e["date"])
        s = f["snaps"].setdefault(sid, {"id": sid, "date": e["date"], "reason": e.get("reason", ""),
                                        "tree": e["tree"], "files": [], "ts": e.get("ts", 0)})
        if e["file"] not in s["files"]:
            s["files"].append(e["file"])
        f["last"] = max(f["last"], e.get("ts", 0))
    out = []
    for key, f in folders.items():
        by_id = {snap_id(h["tree"], h["date"]): h for h in histories.get(key, [])}
        snaps, pruned = [], 0
        for s in sorted(f["snaps"].values(), key=lambda s: s["ts"], reverse=True):
            h = by_id.get(s["id"])
            if not h:
                pruned += 1
                continue
            snaps.append({"id": s["id"], "hash": h["hash"], "date": s["date"], "reason": h["reason"],
                          "files": [_rel(p, f["workdir"]) for p in s["files"]]})
        out.append({"workdir": f["workdir"], "snapshots": snaps, "pruned": pruned, "last": f["last"]})
    out.sort(key=lambda f: f["last"], reverse=True)
    return out


def _rel(p: str, wd: str) -> str:
    try:
        return str(Path(p).relative_to(wd))
    except ValueError:
        return p


def list_for_session(session_id: str, path=None) -> dict:
    entries = read_ledger(session_id, path)
    keys = {(e["base"], e["workdir"]) for e in entries}
    return {"folders": group(entries, {k: history(*k) for k in keys})}


def find(session_id: str, workdir: str, snap: str, path=None):
    """(base, workdir, current commit, files) of a snapshot this chat recorded, or None.
    Only folders and snapshots from the chat's own ledger are accepted from the app."""
    for f in list_for_session(session_id, path)["folders"]:
        if f["workdir"] != workdir:
            continue
        for s in f["snapshots"]:
            if s["id"] == snap:
                base = next(e["base"] for e in read_ledger(session_id, path) if e["workdir"] == workdir)
                return base, workdir, s["hash"], s["files"]
    return None


# ── diff / restore through Hermes's CheckpointManager ──

class _Home:
    """Run CheckpointManager against the store under `base` (each profile has its own)."""

    def __init__(self, base: str):
        self.home = str(Path(base).parent)

    def __enter__(self):
        install_git_env_shim()
        from hermes_constants import set_hermes_home_override
        self.token = set_hermes_home_override(self.home)
        from tools.checkpoint_manager import CheckpointManager
        # No count/size pruning from here: a restore must never drop snapshots by itself.
        return CheckpointManager(enabled=True, max_snapshots=10_000, max_total_size_mb=0)

    def __exit__(self, *exc):
        from hermes_constants import reset_hermes_home_override
        reset_hermes_home_override(self.token)


def split_diff(text: str) -> list:
    """Unified diff -> [{file, status, added, removed, diff}]; status added/deleted/modified since
    the snapshot (a restore deletes an added file and brings a deleted one back)."""
    files, cur = [], None
    for line in text.splitlines(keepends=True):
        if line.startswith("diff --git "):
            name = line.rstrip("\n").split(" b/", 1)[-1]
            cur = {"file": name, "status": "modified", "added": 0, "removed": 0, "diff": ""}
            files.append(cur)
        if cur is None:
            continue
        cur["diff"] += line
        if line.startswith("new file mode"):
            cur["status"] = "added"
        elif line.startswith("deleted file mode"):
            cur["status"] = "deleted"
        elif line.startswith("+") and not line.startswith("+++"):
            cur["added"] += 1
        elif line.startswith("-") and not line.startswith("---"):
            cur["removed"] += 1
    return files


def diff(base: str, workdir: str, commit: str, limit: int = 300_000) -> dict:
    """Changes in the folder since the snapshot, per file (what a restore undoes)."""
    with _Home(base) as mgr:
        r = mgr.diff(workdir, commit)
    if not r.get("success"):
        return {"error": r.get("error") or "Could not compute the diff"}
    files = split_diff(r.get("diff") or "")
    for f in files:
        f["diff"] = f["diff"][:limit]
    return {"files": files}


def restore(base: str, workdir: str, commit: str, file: str = "", session: str = "", path=None) -> dict:
    """Put the folder (or one file) back to the snapshot. Files the user changed by hand after
    Hermes last wrote them are kept (Hermes's safe restore). Hermes snapshots the current state
    first; that snapshot joins the chat's list, so the restore itself can be undone."""
    before = ref_tip(base, workdir)
    with _Home(base) as mgr:
        if file:
            r = mgr.restore(workdir, commit, file_path=file)
            if r.get("success"):
                r["restored_files"] = [file]
        else:
            r = mgr.restore(workdir, commit, safe=True)
        # Hermes put these files back, so they count as Hermes-written: otherwise its safe restore
        # takes them for the user's own edits next time and keeps them.
        for rel in r.get("restored_files") or [] if r.get("success") else []:
            mgr.record_agent_write(str(Path(workdir) / rel))
    if not r.get("success"):
        return {"error": r.get("error") or "Restore failed"}
    after = ref_tip(base, workdir)
    if session and after and after != before and r.get("restored_files"):
        info = _git(base, "log", "-1", "--format=%T%x00%aI%x00%s", after).strip().split("\x00")
        if len(info) == 3:
            for rel in r["restored_files"]:
                write_entry(session, {"ts": time.time(), "turn": "", "tool": "restore", "file": str(Path(workdir) / rel),
                                      "workdir": workdir, "base": base, "tree": info[0], "date": info[1], "reason": info[2]}, path)
    keep = ("restored_to", "restored_files", "skipped_user_edits", "skipped_oversize", "failed_deletes")
    return {"ok": True, **{k: r[k] for k in keep if k in r}}


# ── speed: skip the package manager's git lookup ──

def install_git_env_shim() -> bool:
    """Checkpoint git calls build their env with `selected_git_env`, which calls `pm.ensure("git")`
    every time. When PM has no git of its own here (Linux: "system git by choice"), that raises
    after a worker spawn and the original falls back to the plain env, so we return the plain env
    directly after the first check. Only the checkpoint module's reference is replaced."""
    try:
        import tools.checkpoint_manager as cm
    except Exception:
        return False
    orig = cm.selected_git_env
    if getattr(orig, "_hm_fast", False):
        return True
    state: dict = {}

    def fast(base=None):
        if "system" not in state:
            try:
                from pm import ensure
                ensure("git", base_env=dict(base if base is not None else os.environ))
                state["system"] = False
            except Exception:
                state["system"] = True
        if state["system"]:
            return dict(base if base is not None else os.environ)
        return orig(base)

    fast._hm_fast = True
    cm.selected_git_env = fast
    return True


# ── daily maintenance ──

def maintain(force: bool = False) -> dict:
    """gc the store when Hermes left one pending (its own auto-prune only runs in the messaging
    gateway, so app chats never reclaim), and forget projects that have no snapshot. Once a day,
    in a background thread, skipped when the store is busy."""
    try:
        install_git_env_shim()
        import tools.checkpoint_manager as cm
        from tools.checkpoint_pruning import PruneError, Pruner, store_lock
    except Exception as e:
        return {"skipped": f"no hermes: {e}"}
    base = cm._resolve_checkpoint_base()
    store = base / "store"
    marker = base / ".hm_maintained"
    try:
        if not force and time.time() - marker.stat().st_mtime < GC_EVERY:
            return {"skipped": "recent"}
    except OSError:
        pass
    if not (store / "HEAD").exists():
        return {"skipped": "no store"}
    done: dict = {"forgot": [], "gc": False}
    try:
        with store_lock(base):
            marker.touch()
            refs = set(_git(str(base), "for-each-ref", "--format=%(refname)", "refs/hermes").split())
            for meta in (store / "projects").glob("*.json"):
                if f"refs/hermes/{meta.stem}" not in refs:
                    meta.unlink(missing_ok=True)
                    (store / "indexes" / meta.stem).unlink(missing_ok=True)
                    done["forgot"].append(meta.stem)
            pruner = Pruner(cm._run_git, store, str(base), cm._GIT_TIMEOUT, cm._dir_size_bytes, cm._REFS_PREFIX)
            loose = sum(1 for _ in (store / "objects").glob("??/*"))
            if pruner.gc_pending() or loose > 2000 or force:
                pruner.reclaim()
                done["gc"] = True
    except (PruneError, OSError) as e:
        done["error"] = str(e)
    return done


_maint_started = 0.0


def maybe_maintain_async() -> None:
    global _maint_started
    if time.time() - _maint_started < 3600:
        return
    _maint_started = time.time()
    threading.Thread(target=maintain, name="hm-checkpoint-maint", daemon=True).start()
