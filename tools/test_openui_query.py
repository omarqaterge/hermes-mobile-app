#!/usr/bin/env python3
"""Tests for live data in cards (openui_query.py): the read-only allow-list and call_tool, with Hermes's
model_tools faked and find_chats run on a fake ~/.hermes:
    python3 tools/test_openui_query.py
"""
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile")
root = tempfile.mkdtemp()
os.environ["HERMES_HOME_ROOT"] = root  # chat_search reads <root>/.hermes/state.db

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


# ── fake Hermes: model_tools.handle_function_call ──
CALLS = []


def handle_function_call(name, args, task_id=None, session_id=None, enabled_tools=None, **kw):
    CALLS.append({"name": name, "args": args, "task_id": task_id, "session_id": session_id, "enabled_tools": enabled_tools})
    if name == "web_search":
        return json.dumps({"success": True, "data": {"web": [{"url": "https://e.test/1", "title": "One", "description": "d"}]}})
    return json.dumps({"error": f"unknown tool {name}"})


mt = types.ModuleType("model_tools")
mt.handle_function_call = handle_function_call
sys.modules["model_tools"] = mt

# a fake ~/.hermes with one chat for the real find_chats
H = os.path.join(root, ".hermes")
os.makedirs(H)
c = sqlite3.connect(os.path.join(H, "state.db"))
c.execute("CREATE TABLE sessions (id TEXT, title TEXT, started_at REAL, last_activity_at REAL)")
c.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT)")
c.execute("INSERT INTO sessions VALUES ('s_zebra', 'Zebra chat', 1, 2)")
c.execute("INSERT INTO messages (session_id, role, content, tool_calls) VALUES ('s_zebra', 'user', 'tell me about zebras', NULL)")
c.commit()
c.close()

spec = importlib.util.spec_from_file_location("openui_query", os.path.join(PLUGIN, "openui_query.py"))
oq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oq)

# ── the allow-list ──
raw = json.loads(Path(PLUGIN, "openui_tools.json").read_text())
names = [t["name"] for t in raw]
check("openui_tools.json lists exactly the two read-only tools (cards read no files)",
      sorted(names) == ["find_chats", "web_search"], names)
check("every entry: readOnlyHint, description, inputSchema, outputSchema",
      all(t.get("annotations", {}).get("readOnlyHint") is True and t.get("description") and t.get("inputSchema", {}).get("type") == "object"
          and t.get("outputSchema", {}).get("type") == "object" for t in raw))
check("query_tools() = the readOnlyHint entries", sorted(oq.query_tools()) == sorted(names), sorted(oq.query_tools()))

tmp = Path(tempfile.mkdtemp(), "tools.json")
tmp.write_text(json.dumps([{"name": "web_search", "annotations": {"readOnlyHint": True}},
                           {"name": "write_file", "annotations": {"readOnlyHint": False}}, {"name": "terminal"}]))
real_tools, oq.TOOLS = oq.TOOLS, tmp
check("entries without readOnlyHint are left out", list(oq.query_tools()) == ["web_search"], list(oq.query_tools()))
tmp.write_text("not json")
check("a broken file allows nothing", oq.query_tools() == {})
tmp.write_text(json.dumps([{"name": n, "annotations": {"readOnlyHint": True}} for n in ("read_file", "search_files", "terminal", "web_search")]))
check("file and command tools are never served, even marked read-only", list(oq.query_tools()) == ["web_search"], list(oq.query_tools()))
oq.TOOLS = real_tools

cs_spec = importlib.util.spec_from_file_location("cs_check", os.path.join(PLUGIN, "chat_search.py"))
cs = importlib.util.module_from_spec(cs_spec)
cs_spec.loader.exec_module(cs)
by = {t["name"]: t for t in raw}
check("find_chats inputSchema = chat_search.TOOL_SCHEMA parameters", by["find_chats"]["inputSchema"] == cs.TOOL_SCHEMA["parameters"])

# Hermes's own schemas at the pinned commit (only where a Hermes checkout exists; CI has none).
pin = Path(HERE, "..", "web", "vendor", "hermes-shared", ".hermes-commit")
hermes = Path(os.path.expanduser("~/.hermes/hermes-agent"))
if pin.exists() and (hermes / ".git").exists():
    commit = pin.read_text().strip()
    ns = {}
    try:
        for f in ("tools/web_tools.py",):
            src = subprocess.run(["git", "-C", str(hermes), "show", f"{commit}:{f}"], capture_output=True, text=True, check=True).stdout
            for var in ("WEB_SEARCH_SCHEMA",):
                start = src.find(f"\n{var} = {{")
                if start >= 0:
                    end = src.find("\n}\n", start) + 2
                    exec(src[start:end], {"DEFAULT_READ_LIMIT": 2000}, ns)
        for var, tool in (("WEB_SEARCH_SCHEMA", "web_search"),):
            check(f"{tool} inputSchema = pinned Hermes {var} parameters", ns.get(var, {}).get("parameters") == by[tool]["inputSchema"])
    except Exception as e:
        check("pinned Hermes schemas readable", False, f"{type(e).__name__}: {e}")
else:
    print("  [SKIP] pinned Hermes schema comparison (no Hermes checkout)")

# ── call_tool ──
r = oq.call_tool("web_search", {"query": "openui", "limit": 2})
last = CALLS[-1]
check("web_search goes through model_tools with enabled_tools=['web_search']", last["name"] == "web_search" and last["enabled_tools"] == ["web_search"], last)
check("web_search: session_id=None (no chat bookkeeping)", last["session_id"] is None and "session_id" in last, last)
check("web_search: args passed as given", last["args"] == {"query": "openui", "limit": 2}, last["args"])
check("web_search: JSON parsed", r == {"success": True, "data": {"web": [{"url": "https://e.test/1", "title": "One", "description": "d"}]}}, r)

check("web_search runs under the cards' own task id", last["task_id"] == oq.TASK_ID and oq.TASK_ID != "default", last["task_id"])

real_hfc = mt.handle_function_call
mt.handle_function_call = lambda *a, **kw: "plain text, not JSON"
check("non-JSON output -> {'text': ...}", oq.call_tool("web_search", {"query": "x"}) == {"text": "plain text, not JSON"})
mt.handle_function_call = real_hfc
check("no args -> {}", oq.call_tool("web_search") is not None and CALLS[-1]["args"] == {}, CALLS[-1]["args"])

for bad in ("read_file", "search_files", "terminal", "chat_history_lookup", "write_file", "session_search", ""):
    k = len(CALLS)
    try:
        oq.call_tool(bad, {"command": "chmod 777 /tmp/x"})
        check(f"{bad or '(empty)'} refused", False, "no PermissionError")
    except PermissionError:
        check(f"{bad or '(empty)'} refused with PermissionError, Hermes not called", len(CALLS) == k)

k = len(CALLS)
r = oq.call_tool("find_chats", {"text": "zebras"})
check("find_chats answered by the plugin's chat_search, not model_tools", len(CALLS) == k)
check("find_chats finds the chat", r.get("ok") is True and [x["id"] for x in r.get("chats", [])] == ["s_zebra"], r)
check("find_chats shares the dashboard's chat_search module", "hm_chat_search" in sys.modules)

print("PASSED" if not fails else f"FAILED ({fails})")
sys.exit(1 if fails else 0)
