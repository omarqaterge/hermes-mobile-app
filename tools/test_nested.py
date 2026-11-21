#!/usr/bin/env python3
"""What the plugin tells the app about a chat's sub-agents, no phone needed: `GET /activity`'s `nested` counts follow the
hooks and hold nothing but numbers, and the routes `/nested`, `/nested-counts` and `/nested-search` read Hermes's stored
chats (the true reasoning level, every depth, across a compression) and survive damaged rows.
    python3 tools/test_nested.py
"""
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
home = tempfile.mkdtemp(prefix="hm-nested-")
os.environ["HOME"] = home
os.environ["HERMES_HOME"] = os.path.join(home, ".hermes")  # never the Hermes data of the machine running this
sys.path.insert(0, str(ROOT / "hermes-plugin" / "hermes-mobile"))
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if not ok and detail != "" else ""))
    fails += 0 if ok else 1


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


try:
    import fastapi  # noqa: F401
except ImportError:
    class _Router:
        def __getattr__(self, _name):
            return lambda *a, **k: (lambda f: f)
    sys.modules["fastapi"] = types.SimpleNamespace(APIRouter=_Router, HTTPException=Exception, Request=object)
    sys.modules["pydantic"] = types.SimpleNamespace(BaseModel=object)

plugin = load("hermes_mobile_nested", ROOT / "hermes-plugin" / "hermes-mobile" / "__init__.py")
papi = load("plugin_api_nested", ROOT / "hermes-plugin" / "hermes-mobile" / "dashboard" / "plugin_api.py")
papi._slow_all = lambda: None
_Path = papi.Path


def _path(*parts):  # /proc as on the phone: only this process is alive
    if parts and parts[0] == "/proc":
        return types.SimpleNamespace(exists=lambda: parts[1] == str(os.getpid()))
    return _Path(*parts)


_path.home = _Path.home
papi.Path = _path
plugin._send = lambda *a, **kw: None
plugin._status_dirty = types.SimpleNamespace(set=lambda: None)
plugin.ACTIVITY_FILE = os.path.join(home, ".hermes", "mobile", "activity.json")
plugin.PROC_DIR = os.path.join(home, "proc")
os.makedirs(os.path.join(plugin.PROC_DIR, str(os.getpid())), exist_ok=True)
activity = papi.get_activity

print("the running counts")
check("nothing running: the answer has no `nested`", "nested" not in activity(), activity())
plugin._on_subagent_start(child_session_id="kid-1", parent_session_id="chat-a", child_goal="SECRET GOAL one")
plugin._on_subagent_start(child_session_id="kid-2", parent_session_id="chat-a", child_goal="SECRET GOAL two")
plugin._on_subagent_start(child_session_id="kid-1-1", parent_session_id="kid-1", child_goal="SECRET GOAL deep")
got = activity().get("nested")
check("every depth counts under the top chat", got == [{"session": "chat-a", "running": 3}], got)
text = Path(plugin.ACTIVITY_FILE).read_text()
nested_only = json.dumps(json.loads(text)[str(os.getpid())].get("nested"))
check("the feed's counts hold no goal", "SECRET" not in nested_only, nested_only)
plugin._on_subagent_stop(child_session_id="kid-1-1", child_status="completed")
check("a stop takes one off", activity().get("nested") == [{"session": "chat-a", "running": 2}], activity())
plugin._on_subagent_stop(child_session_id="unknown")
plugin._on_subagent_stop()
check("a stop for nobody changes nothing", activity().get("nested") == [{"session": "chat-a", "running": 2}], activity())
plugin._on_subagent_stop(child_session_id="kid-1")
plugin._on_subagent_stop(child_session_id="kid-2")
check("all stopped: gone", "nested" not in activity(), activity())

plugin._on_subagent_start(child_session_id="kid-9", parent_session_id="chat-z")
with plugin._lock:
    chat, profile, _until = plugin._nested["kid-9"]
    plugin._nested["kid-9"] = (chat, profile, time.time() - 1)
plugin._publish_activity()
check("one whose end was never reported runs out", "nested" not in activity(), activity())

plugin._on_subagent_start(child_session_id="kid-old", parent_session_id="chat-c")
check("before its compression it counts", activity().get("nested") == [{"session": "chat-c", "running": 1}], activity())
plugin._phone_data = lambda: types.SimpleNamespace(compression_ancestors=lambda sid, budget=0: ["kid-old"] if sid == "kid-new" else [])
plugin._on_subagent_stop(child_session_id="kid-new")
check("a stop under the id a compression gave it ends the count", "nested" not in activity(), activity())

me = str(os.getpid())
future = time.time() + 60
bad = [
    {"session": "<b>x</b>", "running": 2, "until": future, "words": "Tap Allow"},
    {"session": "ok", "running": "many", "until": future},
    {"session": "ok", "running": True, "until": future},
    {"session": "ok", "running": 10 ** 9, "until": future},
    {"session": "ok", "running": 1, "until": future + 10 ** 7},
    {"session": "ok", "running": 1, "until": time.time() - 5},
    {"session": 7, "running": 1, "until": future},
    "text", None,
]
Path(plugin.ACTIVITY_FILE).write_text(json.dumps({me: {"at": time.time(), "items": [], "nested": bad}}))
got = activity().get("nested")
check("an edited file gives only a chat id and a number", got == [{"session": "<b>x</b>", "running": 2}], got)
for entry in bad[1:]:
    Path(plugin.ACTIVITY_FILE).write_text(json.dumps({me: {"at": time.time(), "items": [], "nested": [entry]}}))
    check(f"a malformed entry counts for nothing: {str(entry)[:40]}", "nested" not in activity(), activity())
Path(plugin.ACTIVITY_FILE).write_text(json.dumps({me: {"at": time.time(), "items": [], "nested": "nope"}}))
check("`nested` that is no list is ignored", "nested" not in activity(), activity())
Path(plugin.ACTIVITY_FILE).write_text(json.dumps({"999": {"at": time.time(), "items": [], "nested": [{"session": "dead", "running": 1, "until": future}]}}))
check("a process that is gone counts for nothing", "nested" not in activity(), activity())
Path(plugin.ACTIVITY_FILE).write_text("{}")

print("the stored chats")
db = Path(home) / ".hermes" / "state.db"
papi._home = lambda profile=None: db.parent
db.parent.mkdir(parents=True, exist_ok=True)
con = sqlite3.connect(db)
con.executescript("""
CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, title TEXT, model TEXT, model_config TEXT,
  started_at REAL, ended_at REAL, end_reason TEXT, message_count INTEGER);
CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT);
""")


def row(sid, parent=None, title=None, model="m", cfg=None, started=1.0, ended=None, reason=None, count=2):
    con.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)",
                (sid, parent, title, model, cfg if isinstance(cfg, (str, type(None))) else json.dumps(cfg), started, ended, reason, count))


def kid(effort=None, parent="old"):
    rc = {"enabled": True, "effort": effort} if isinstance(effort, str) else effort
    return {"reasoning_config": rc, "_delegate_from": parent}


row("old", reason="compression", ended=5.0)
row("chat", "old", "Chat")
row("sub-a", "old", "Subagent: Read the docs #2", "x/haiku", kid("low"), 2.0, 9.0, "agent_close", 4)
row("sub-b", "chat", "Subagent: Write it", "x/opus", kid({"enabled": False}, "chat"), 3.0)
row("sub-a-1", "sub-a", "Subagent: Deep one", "x/haiku", kid("nonsense", "sub-a"), 4.0)
row("branch", "chat", "A branch", cfg={"_branched_from": "chat"})
row("broken", "chat", "Subagent: Broken", cfg="{not json")
row("big", "chat", "Subagent: Huge", cfg=json.dumps({**kid("low", "chat"), "pad": "x" * (papi.NESTED_CONFIG_MAX + 1)}))
row("odd-parent", "chat", "Subagent: Odd effort", "x/m", {"reasoning_config": {"effort": ["low"]}, "_delegate_from": "chat"}, 5.0)
con.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)", (b"blob-id", "chat", "Subagent: Blob id", "m", json.dumps(kid("low", "chat")), 6.0, None, None, 1))
con.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)", ("blob-parent", b"not-text", "Subagent: Blob parent", "m", json.dumps(kid("low", "chat")), 7.0, None, None, 1))
con.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)", ("bad-row", "chat", "Subagent: Bad row", "m", json.dumps(kid("low", "chat")), 8.0, None, None, 1))
row("other", None, "Other chat")
row("other-sub", "other", "Subagent: Elsewhere", cfg=kid("high", "other"))
con.execute("INSERT INTO messages (session_id, role, content) VALUES ('sub-a','user','Read the docs in full')")
con.execute("INSERT INTO messages (session_id, role, content) VALUES ('sub-a','user','a later message')")
con.execute("INSERT INTO messages (session_id, role, content) VALUES ('sub-b','user','[{\"type\":\"text\"}]')")
con.commit()

real_goal = papi._subagent_goal
papi._subagent_goal = lambda c, sid, title: (_ for _ in ()).throw(ValueError("damaged")) if sid == "bad-row" else real_goal(c, sid, title)
kids = papi.get_nested("chat")["children"]
papi._subagent_goal = real_goal
by = {k["id"]: k for k in kids}
check("a chat's sub-agents, at every depth, also from before a compression", set(by) == {"sub-a", "sub-b", "sub-a-1", "odd-parent"}, list(by))
check("a row too big, one without text ids and one that fails to read are left out, the others stay", not {"big", "bad-row", "blob-parent"} & set(by) and all(isinstance(k, str) for k in by))
check("a branch, a damaged row and another chat's are left out", not {"branch", "broken", "other-sub"} & set(by))
check("the level Hermes gave it", by["sub-a"]["effort"] == "low", by["sub-a"])
check("thinking turned off reads as none", by["sub-b"]["effort"] == "none", by["sub-b"])
check("a level it doesn't know is not passed on", by["sub-a-1"]["effort"] == "", by["sub-a-1"])
check("the parent is the chat, by its current id", by["sub-a"]["parent"] == "chat" and by["sub-b"]["parent"] == "chat", by["sub-a"])
check("a nested one names the sub-agent above it", by["sub-a-1"]["parent"] == "sub-a", by["sub-a-1"])
check("the goal is its first message", by["sub-a"]["goal"] == "Read the docs in full", by["sub-a"])
check("a first message that isn't plain text falls back to the title", by["sub-b"]["goal"] == "Write it", by["sub-b"])
check("times and the end reason", by["sub-a"]["ended"] == 9.0 and by["sub-a"]["reason"] == "agent_close" and by["sub-b"]["ended"] == 0, by["sub-a"])
check("an unknown chat has none", papi.get_nested("nobody")["children"] == [])
check("a silly id is refused quietly", papi.get_nested("x" * 500) == {"children": [], "segments": []})
got = papi.get_nested_counts()["counts"]
check("counts per top chat, under its current id", got == {"chat": 5, "other": 1}, got)  # sub-a, sub-b, sub-a-1, odd-parent, bad-row
got = papi.get_nested_search("DEEP")["hits"]
check("search finds a nested one under its top chat", got == [{"chat": "chat", "child": "sub-a-1", "goal": "Deep one"}], got)
check("one letter searches nothing", papi.get_nested_search("d") == {"hits": []})
# SQLite's length() of text stops at a NUL: a model_config with one near its start would pass a limit on length() and be
# read whole. Every query that limits it counts bytes instead (CAST AS BLOB).
NUL_TAIL = "\x00" + "x" * (papi.NESTED_CONFIG_MAX + 10)
row("nul-big", "chat", "Subagent: NUL", cfg=json.dumps(kid("low", "chat")) + NUL_TAIL, started=9.0)
row("old2", reason="compression", ended=5.0)
row("nul-cont", "old2", "Continued", cfg="{}" + NUL_TAIL)
con.commit()
fetched = []
real_con = papi._nested_con


class _Rows:
    def __init__(self, cur):
        self.cur = cur

    def _seen(self, rows):
        for r in rows if isinstance(rows, list) else [rows]:
            if r:
                fetched.extend(len(v) for v in r if isinstance(v, (str, bytes)))
        return rows

    def fetchall(self):
        return self._seen(self.cur.fetchall())

    def fetchone(self):
        return self._seen(self.cur.fetchone())

    def __iter__(self):
        for r in self.cur:
            self._seen(r)
            yield r


class _Con:
    def __init__(self, c):
        self.c = c

    def execute(self, *a):
        return _Rows(self.c.execute(*a))

    def __getattr__(self, name):
        return getattr(self.c, name)


papi._nested_con = lambda profile=None: (lambda c: _Con(c) if c is not None else None)(real_con(profile))
papi.get_nested("chat"), papi.get_nested_counts(), papi.get_nested_search("Subagent")
papi._nested_con = real_con
check("a model_config with a NUL near its start is still limited by its size in bytes",
      fetched and max(fetched) <= papi.NESTED_CONFIG_MAX, max(fetched or [0]))

# Finding 1: _chat_segments only climbs real compression continuations, never branches, sub-agents, or damaged rows.
row("s1", None, "Root chat", reason="compression", ended=10.0)
row("s2", "s1", "Root chat continued", cfg={})
row("sa1", "s1", "Subagent: Private work", "x/m", kid("low", "s1"), 11.0)
row("sa2", "s1", "Subagent: Sibling work", "x/m", kid("low", "s1"), 11.5)
row("b1", "s1", "Branch of s1", cfg={"_branched_from": "s1"})
row("s_bad", "s1", "Broken continuation", cfg="{not json")
row("s_big", "s1", "Huge continuation", cfg="{}" + NUL_TAIL)
con.commit()
b1_res = papi.get_nested("b1")
check("a branch of a compressed chat does not inherit the original chat's sub-agents",
      b1_res["children"] == [] and b1_res.get("segments") == ["b1"], b1_res)
sa1_res = papi.get_nested("sa1")
check("a sub-agent of a compressed chat does not climb into its parent's siblings",
      sa1_res["children"] == [] and sa1_res.get("segments") == ["sa1"], sa1_res)
s2_res = papi.get_nested("s2")
check("a compression continuation inherits sub-agents and reports its real segments",
      {c["id"] for c in s2_res["children"]} == {"sa1", "sa2"} and s2_res.get("segments") == ["s2", "s1"], s2_res)
check("a broken or over-sized model_config does not climb across compression",
      papi.get_nested("s_bad")["children"] == [] and papi.get_nested("s_big")["children"] == [],
      (papi.get_nested("s_bad"), papi.get_nested("s_big")))

# Finding 7(c): over-long title, model, end_reason and ids are capped or skipped in SQL.
HUGE = 250_000
row("huge-fields", "chat", "Subagent: " + "t" * HUGE, "m" * HUGE, kid("low", "chat"), 12.0, 13.0, "r" * HUGE, 1)
row("i" * HUGE, "chat", "Subagent: Huge id", "m", kid("low", "chat"), 12.5)
con.commit()
fetched = []
papi._nested_con = lambda profile=None: (lambda c: _Con(c) if c is not None else None)(real_con(profile))
hf_nested = papi.get_nested("chat")
papi.get_nested_counts()
papi.get_nested_search("tttt")
papi._nested_con = real_con
hf_row = next((c for c in hf_nested["children"] if c["id"] == "huge-fields"), None)
check("over-long title, model, end_reason and ids are capped or skipped in SQL",
      hf_row is not None and len(hf_row["goal"]) <= 500 and len(hf_row["model"]) <= 200 and len(hf_row["reason"]) <= 100
      and all(len(c["id"]) <= 200 for c in hf_nested["children"])
      and fetched and max(fetched) <= papi.NESTED_CONFIG_MAX,
      (max(fetched or [0]), len(hf_row["goal"]) if hf_row else None))

# Finding 7(a): _nested_index after query excludes sub-agents by _delegate_config (not `new not in parents`), caps rows, skips bad rows.
row("comp-old", None, "Old compressed", reason="compression", ended=1.0)
row("comp-sub", "comp-old", "Subagent: Early child", "m", kid("low", "comp-old"), 0.5)
row("comp-old-bad", None, "Old compressed 2", reason="compression", ended=1.0)
row("comp-bad", "comp-old-bad", "Bad cont", "m", "{bad", 0.6)
con.executemany(
    "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)",
    [(f"pad-{i}", "other", f"Subagent: Pad {i}", "m", json.dumps(kid("low", "other")), 100.0 + i, None, None, 1)
     for i in range(5005)],
)
con.commit()
_parents, after_map, _titles = papi._nested_index(con)
check("_nested_index excludes sub-agents past the parents limit and broken rows from compression continuations",
      "comp-old" not in after_map and "comp-old-bad" not in after_map,
      (after_map.get("comp-old"), after_map.get("comp-old-bad")))

# Finding 7(b): _nested_con sqlite3.Error returns empty answers, and URI-escaping handles ? and # in path.
def _boom(profile=None):
    raise sqlite3.OperationalError("database is locked")

papi._nested_con = _boom
try:
    n_err = papi.get_nested("chat")
    c_err = papi.get_nested_counts()
    s_err = papi.get_nested_search("deep")
    open_err_ok = n_err.get("children") == [] and c_err == {"counts": {}} and s_err == {"hits": []}
except sqlite3.Error as e:
    open_err_ok = False
    n_err = str(e)
papi._nested_con = real_con
check("a locked or damaged database on open gives empty answers instead of raising", open_err_ok, n_err)

odd_dir = Path(home) / "dir?with#chars"
odd_dir.mkdir(parents=True, exist_ok=True)
odd_db = odd_dir / "state.db"
odd_con = sqlite3.connect(odd_db)
odd_con.executescript("""
CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, title TEXT, model TEXT, model_config TEXT,
  started_at REAL, ended_at REAL, end_reason TEXT, message_count INTEGER);
CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT);
""")
odd_con.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)", ("p1", None, "Chat", "m", None, 1.0, None, None, 1))
odd_con.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)", ("c1", "p1", "Subagent: Hi", "m", json.dumps(kid("low", "p1")), 2.0, None, None, 1))
odd_con.commit()
odd_con.close()
real_home = papi._home
papi._home = lambda profile=None: odd_dir
uri_res = papi.get_nested_counts()
papi._home = real_home
check("a profile path with ? and # opens state.db cleanly", uri_res == {"counts": {"p1": 1}}, uri_res)

con.execute("DROP TABLE messages")
con.commit()
check("an unreadable table answers empty", papi.get_nested("chat")["children"] == [])
con.close()
papi._home = lambda profile=None: db.parent / "nowhere"
check("no database: empty answers", papi.get_nested("chat")["children"] == [] and papi.get_nested_counts() == {"counts": {}} and papi.get_nested_search("docs") == {"hits": []})

print("FAILED" if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
