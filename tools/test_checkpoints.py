#!/usr/bin/env python3
"""Unit tests for per-chat file checkpoints (hermes-plugin/hermes-mobile/checkpoints.py).
Builds a shadow store the way Hermes does (bare repo, refs/hermes/<hash>) in a temp dir; the Hermes
parts (working-dir resolution, CheckpointManager) are stubbed.
    python3 tools/test_checkpoints.py
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="hm-cp-test-")).resolve()
os.environ["HERMES_HOME"] = str(TMP / "home")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("hm_checkpoints", os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile", "checkpoints.py"))
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


BASE = TMP / "home" / "checkpoints"
STORE = BASE / "store"
ENV = {**os.environ, "GIT_DIR": str(STORE), "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
       "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
subprocess.run(["git", "init", "-q", "--bare", str(STORE)], check=True, env={k: v for k, v in ENV.items() if k != "GIT_DIR"})
LEDGER = TMP / "ledger"


def git(wd, *args, env=None):
    e = {**ENV, "GIT_WORK_TREE": str(wd), "GIT_INDEX_FILE": str(TMP / f"idx-{cp.project_hash(str(wd))}"), **(env or {})}
    return subprocess.run(["git", *args], env=e, capture_output=True, text=True, check=True).stdout.strip()


def snapshot(wd, msg="before write_file", date=None):
    """What Hermes's _take does: add -A, write-tree, commit-tree on the folder's ref."""
    ref = cp.ref_name(str(wd))
    git(wd, "add", "-A")
    tree = git(wd, "write-tree")
    parent = subprocess.run(["git", "rev-parse", "--verify", "-q", ref], env=ENV, capture_output=True, text=True).stdout.strip()
    env = {"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date} if date else {}
    sha = git(wd, "commit-tree", tree, "-m", msg, *(["-p", parent] if parent else []), env=env)
    git(wd, "update-ref", ref, sha)
    return sha


A = TMP / "proj-a"
B = TMP / "scratch"
for d in (A, B):
    d.mkdir()
(A / "x.py").write_text("one\n")
(B / "note.md").write_text("hi\n")

# Hook flow with Hermes's parts stubbed: the folder is the file's parent; the "take" happens
# between pre and post, like _begin_tool_execution between the two hooks.
cp._target = lambda path, task_id: (path, str(Path(path).parent.resolve()), str(BASE))


def edit(sid, turn, call, path, new_text, take=True, date=None):
    args = {"path": str(path)}
    cp.pre_tool("write_file", args, sid, "t", call)
    if take:
        snapshot(Path(path).parent, date=date)
    Path(path).write_text(new_text)
    cp.post_tool("write_file", args, sid, turn, call, path=LEDGER)


print("ledger from hooks")
check("no ref: tip empty", cp.ref_tip(str(BASE), str(A)) == "")
edit("s1", "t1", "c1", A / "x.py", "two\n", date="2026-10-07T10:00:00+02:00")
check("tip read from loose ref", len(cp.ref_tip(str(BASE), str(A))) == 40)
edit("s1", "t1", "c2", A / "y.py", "new\n", take=False)  # same turn: Hermes takes no second snapshot
edit("s1", "t2", "c3", A / "x.py", "three\n", date="2026-10-07T10:05:00+02:00")
edit("s1", "t2", "c4", B / "note.md", "hello\n", date="2026-10-07T10:06:00+02:00")
edit("s1", "t3", "c5", A / "x.py", "four\n", take=False)  # new turn, no snapshot (store busy): not recorded
edit("s2", "u1", "d1", A / "x.py", "five\n", date="2026-10-07T11:00:00+02:00")  # another chat
led = cp.read_ledger("s1", LEDGER)
check("4 entries for s1", len(led) == 4, len(led))
check("same-turn edit reuses the snapshot", led[1]["tree"] == led[0]["tree"] and led[1]["file"].endswith("y.py"))
check("other chat not in s1", all(e["file"] != str(A / "x.py") or e["turn"] != "u1" for e in led))
check("non-file tools ignored", cp.pre_tool("terminal", {"path": "x"}, "s1", "", "z") is None and "z" not in cp._pending)

print("grouping")
res = cp.list_for_session("s1", LEDGER)["folders"]
check("two folders, newest activity first", [f["workdir"] for f in res] == [str(B), str(A)], [f["workdir"] for f in res])
fa = res[1]
check("A has 2 snapshots newest first", [s["date"] for s in fa["snapshots"]] == ["2026-10-07T10:05:00+02:00", "2026-10-07T10:00:00+02:00"])
check("files relative to the folder", fa["snapshots"][1]["files"] == ["x.py", "y.py"], fa["snapshots"][1]["files"])
check("hash = current commit", fa["snapshots"][0]["hash"] == cp.history(str(BASE), str(A))[1]["hash"])

print("pruning rewrites the chain")
# Hermes's Pruner keeps the newest N: re-commits them with the same tree/dates/message, new ids.
hist = cp.history(str(BASE), str(A))[::-1]  # oldest first
parent = None
for h in hist[1:]:
    tree = git(A, "log", "-1", "--format=%T", h["hash"])
    args = ["commit-tree", tree, "-m", h["reason"]] + (["-p", parent] if parent else [])
    parent = git(A, *args, env={"GIT_AUTHOR_DATE": h["date"], "GIT_COMMITTER_DATE": h["date"]})
git(A, "update-ref", cp.ref_name(str(A)), parent)
fa = next(f for f in cp.list_for_session("s1", LEDGER)["folders"] if f["workdir"] == str(A))
check("oldest pruned, counted", len(fa["snapshots"]) == 1 and fa["pruned"] == 1, fa)
new = cp.history(str(BASE), str(A))
check("kept one found by tree+date with its new id",
      fa["snapshots"][0]["hash"] == new[1]["hash"] and new[1]["hash"] != hist[1]["hash"])

print("packed refs")
subprocess.run(["git", "pack-refs", "--all"], env=ENV, check=True)
check("tip read from packed-refs", cp.ref_tip(str(BASE), str(A)) == parent)

print("find (only the chat's own snapshots)")
sid_b = cp.list_for_session("s1", LEDGER)["folders"][0]["snapshots"][0]["id"]
check("own snapshot found", cp.find("s1", str(B), sid_b, LEDGER)[2] == cp.ref_tip(str(BASE), str(B)))
check("other folder rejected", cp.find("s1", "/etc", sid_b, LEDGER) is None)
check("other chat's snapshot rejected", cp.find("s2", str(B), sid_b, LEDGER) is None)
for bad in ("../x", "", ".hidden", "a/b"):
    try:
        cp.read_ledger(bad, LEDGER)
        check(f"bad id {bad!r} rejected", False)
    except ValueError:
        check(f"bad id {bad!r} rejected", True)
cp.delete_ledger("s2", LEDGER)
check("delete_ledger", cp.read_ledger("s2", LEDGER) == [])

print("restore joins the pre-restore snapshot to the chat's list")


class FakeMgr:
    """Hermes's restore: snapshot the current state ("pre-rollback"), then check out."""
    written = []

    def record_agent_write(self, p):
        FakeMgr.written.append(p)

    def restore(self, wd, commit, file_path=None, safe=False):
        snapshot(Path(wd), msg=f"pre-rollback snapshot (restoring to {commit[:8]})", date="2026-10-07T12:00:00+02:00")
        return {"success": True, "restored_files": ["x.py"]} if not file_path else {"success": True}


class FakeHome:
    def __init__(self, base):
        pass

    def __enter__(self):
        return FakeMgr()

    def __exit__(self, *e):
        pass


cp._Home = FakeHome
(A / "x.py").write_text("six\n")
target = cp.list_for_session("s1", LEDGER)["folders"][1]["snapshots"][0]
r = cp.restore(str(BASE), str(A), target["hash"], session="s1", path=LEDGER)
check("restore ok", r.get("ok") and r.get("restored_files") == ["x.py"], r)
fa = next(f for f in cp.list_for_session("s1", LEDGER)["folders"] if f["workdir"] == str(A))
check("restored files recorded as Hermes-written", FakeMgr.written == [str(A / "x.py")], FakeMgr.written)
check("pre-restore snapshot listed first", fa["snapshots"][0]["reason"].startswith("pre-rollback") and fa["snapshots"][0]["files"] == ["x.py"], fa["snapshots"][0])
check("no session: nothing recorded", cp.restore(str(BASE), str(A), target["hash"], path=LEDGER).get("ok")
      and len(cp.read_ledger("s1", LEDGER)) == 5)

print("split_diff")
d = ("diff --git a/x.py b/x.py\nindex 1..2 100644\n--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-one\n+four\n"
     "diff --git a/y.py b/y.py\nnew file mode 100644\n--- /dev/null\n+++ b/y.py\n@@ -0,0 +1 @@\n+new\n"
     "diff --git a/z.py b/z.py\ndeleted file mode 100644\n--- a/z.py\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n")
files = cp.split_diff(d)
check("3 files", [f["file"] for f in files] == ["x.py", "y.py", "z.py"])
check("statuses", [f["status"] for f in files] == ["modified", "added", "deleted"])
check("counts", [(f["added"], f["removed"]) for f in files] == [(1, 1), (1, 0), (0, 2)])
check("each diff is its own", files[1]["diff"].startswith("diff --git a/y.py") and "+four" not in files[1]["diff"])

print("\nALL PASSED" if not fails else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
