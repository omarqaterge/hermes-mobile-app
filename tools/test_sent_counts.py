"""The drawer's "N msgs": messages the user sent in each chat (dashboard/plugin_api.py sent_counts, POST /sent-counts).

session.list's message_count also counts replies, tool calls and Hermes's own role=user notices; this counts only what
the user typed, across a chat's compression lineage.
Run: python3 tools/test_sent_counts.py (needs fastapi, like the other REST tests; skipped without it).
"""
import importlib.util
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile")
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (f" ({detail})" if detail and not cond else ""))
    if not cond:
        fails += 1


try:
    import fastapi  # noqa: F401
except ImportError:
    print("  [SKIP] fastapi not installed (CI installs it)")
    sys.exit(0)

os.environ["HOME"] = tempfile.mkdtemp()
os.environ.pop("HERMES_HOME", None)
spec = importlib.util.spec_from_file_location("plugin_api_sc", os.path.join(PLUGIN, "dashboard", "plugin_api.py"))
api = importlib.util.module_from_spec(spec)
sys.modules["plugin_api_sc"] = api
spec.loader.exec_module(api)

db = Path(tempfile.mkdtemp()) / "state.db"
con = sqlite3.connect(db)
con.executescript("""
CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, end_reason TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, display_kind TEXT);
""")
con.executemany("INSERT INTO sessions VALUES (?, ?, ?)", [
    ("a", None, "compression"), ("a2", "a", None),  # a chat compressed once: its count goes on
    ("b", None, "tui_close"), ("b-sub", "b", None),  # a sub-agent run under b is not b's
    ("empty", None, None),
])
rows = [
    ("a", "user", "hello", None), ("a", "assistant", "hi", None), ("a", "tool", "{}", None),
    ("a", "user", "[System: The active model for this chat changed]", None),
    ("a", "user", "[System: switched]", "model_switch"),
    ("a", "user", "[Pasted text #1: 3 lines] look at this", None),
    ("a2", "user", "[CONTEXT COMPACTION — REFERENCE ONLY] earlier turns", None),
    ("a2", "user", "and now?", None), ("a2", "user", "   ", None),
    ("a2", "user", "[ASYNC DELEGATION BATCH COMPLETE]", "async_delegation_complete"),
    ("b", "user", "one", None), ("b", "user", "keep going", "steer"),
    ("b-sub", "user", "sub-agent task", None),
]
con.executemany("INSERT INTO messages (session_id, role, content, display_kind) VALUES (?, ?, ?, ?)", rows)
con.commit()
con.close()

c = api.sent_counts(db, ["a", "b", "empty", "missing"])
check("only what the user typed counts, across the compression lineage", c.get("a") == 3, str(c))
check("a steer is a message the user sent; a sub-agent's task is not", c.get("b") == 2, str(c))
check("chats with nothing sent, or not in the database, answer 0", c.get("empty") == 0 and c.get("missing") == 0, str(c))
check("no ids, no query", api.sent_counts(db, []) == {})
check("no database answers nothing", api.sent_counts(db.parent / "none.db", ["a"]) == {})

print("FAIL" if fails else "OK")
sys.exit(1 if fails else 0)
