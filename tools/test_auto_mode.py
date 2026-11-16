#!/usr/bin/env python3
"""Tests for the plugin's Auto access (auto_mode.py), with Hermes's approval modules faked:
    python3 tools/test_auto_mode.py
"""
import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("auto_mode", os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile", "auto_mode.py"))
am = importlib.util.module_from_spec(spec)
spec.loader.exec_module(am)

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


# ── fake Hermes: "chmod 777" and "rm -r" are on the dangerous list; "rm -r" is allowed "always" ──
STATE = {"session_ok": set(), "broken": False, "key": "key-1", "yolo": set()}


def detect(cmd):
    if STATE["broken"]:
        raise RuntimeError("detector broke")
    if "chmod 777" in cmd:
        return True, "world/other-writable permissions", "world/other-writable permissions"
    if "rm -r" in cmd:
        return True, "recursive delete", "recursive delete"
    if "git push --force" in cmd:
        return True, "force push", "force push"
    return False, None, None


tools_pkg = types.ModuleType("tools")
det = types.ModuleType("tools.approval_detection")
det.detect_dangerous_command = detect
ap = types.ModuleType("tools.approval")
ap._command_matches_permanent_allowlist = lambda c: False
ap._is_permanently_approved = lambda k: k == "recursive delete"
ap.is_approved = lambda sk, k: (sk, k) in STATE["session_ok"]
ctx = types.ModuleType("tools.approval_context")
ap.is_session_yolo_enabled = lambda k: k in STATE["yolo"]
ctx.get_current_session_key = lambda default="": STATE["key"]
ctx._get_approval_mode = lambda: "manual"
tools_pkg.approval, tools_pkg.approval_detection, tools_pkg.approval_context = ap, det, ctx
sys.modules.update({"tools": tools_pkg, "tools.approval": ap, "tools.approval_detection": det, "tools.approval_context": ctx})

tmp = tempfile.mkdtemp()
am.PATH = Path(tmp) / "auto.json"
DB = Path(tmp) / "state.db"
am._state_db = lambda: DB   # no session database until the lineage tests make one

print("auto_mode")
check("a chat not in Auto access is never touched", am.check("terminal", {"command": "chmod 777 /tmp/x"}, "s1") is None)
check("set_mode auto stores the chat", am.set_mode("s1", "auto") == "auto" and am.mode_of("s1") == "auto")
check("other chats stay off", am.mode_of("s2") == "")
v = am.check("terminal", {"command": "chmod 777 /tmp/x"}, "s1")
check("dangerous command blocked in Auto access", isinstance(v, dict) and v.get("action") == "block" and "world/other-writable" in v.get("message", ""), str(v))
check("block message says how the user can allow it", v and "Full access" in v["message"] and "Do not try to get around it" in v["message"])
check("a normal command runs", am.check("terminal", {"command": "ls -la"}, "s1") is None)
check("a pattern allowed 'always' runs", am.check("terminal", {"command": "rm -r /tmp/x"}, "s1") is None)
STATE["session_ok"].add(("key-1", "force push"))
check("a pattern allowed for this session runs", am.check("terminal", {"command": "git push --force"}, "s1") is None)
v = am.check("execute_code", {"code": "import os; os.system('chmod 777 /tmp/x')"}, "s1")
check("execute_code scanned too", isinstance(v, dict) and "script" in v.get("message", ""), str(v))
check("other tools untouched", am.check("write_file", {"path": "/tmp/x", "content": "chmod 777"}, "s1") is None)
v = am.check("tool_call", {"calls": [{"name": "web_search", "arguments": {"query": "x"}}, {"name": "terminal", "arguments": {"command": "chmod 777 /x"}}]}, "s1")
check("a dangerous call inside the Tool Search bridge is blocked", isinstance(v, dict) and v.get("action") == "block", str(v))
STATE["broken"] = True
v = am.check("terminal", {"command": "ls"}, "s1")
check("detector broken: fails closed", isinstance(v, dict) and v.get("action") == "block", str(v))
check("detector broken: other chats unaffected", am.check("terminal", {"command": "ls"}, "s2") is None)
STATE["broken"] = False
check("set_mode off removes the chat", am.set_mode("s1", "") == "" and am.mode_of("s1") == "" and am.check("terminal", {"command": "chmod 777 /x"}, "s1") is None)
try:
    am.set_mode("", "auto")
    check("empty session id refused", False)
except ValueError:
    check("empty session id refused", True)
am.PATH.write_text("not json")
check("a broken file reads as no chats", am.mode_of("s1") == "")
am.MAX_CHATS = 3
for k in range(5):
    am.set_mode(f"c{k}", "auto")
check("list trimmed to the newest chats", am.mode_of("c0") == "" and am.mode_of("c4") == "auto")

print("auto_mode: the chat's lineage")
import sqlite3
am.MAX_CHATS = 500
am.PATH.unlink()
con = sqlite3.connect(DB)
con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, end_reason TEXT)")
con.executemany("INSERT INTO sessions VALUES (?, ?, ?)", [
    ("seg1", None, "compression"), ("seg2", "seg1", "compression"), ("seg3", "seg2", None),
    ("br1", None, "branched"), ("br2", "br1", None), ("full1", None, None)])
con.commit()
con.close()
chmod = {"command": "chmod 777 /tmp/x"}
am.set_mode("seg1", "auto")
v = am.check("terminal", chmod, "seg2")
check("a chat in Auto access stays in Auto access after a compression gave it a new id",
      isinstance(v, dict) and v.get("action") == "block", str(v))
check("and after a second compression", isinstance(am.check("terminal", chmod, "seg3"), dict))
check("a normal command still runs there", am.check("terminal", {"command": "ls"}, "seg3") is None)
am.set_mode("br1", "auto")
check("a chat branched from one in Auto access is not in Auto access", am.check("terminal", chmod, "br2") is None)
am.set_mode("br1", "")
check("a chat in Full access still runs dangerous commands", am.check("terminal", chmod, "full1") is None)
check("set_mode off under the newest id also clears the older segments",
      am.set_mode("seg3", "") == "" and am.mode_of("seg1") == "" and am.check("terminal", chmod, "seg3") is None)
am.set_mode("parent1", "auto")
STATE["key"] = "parent1"   # a subagent runs under its parent's approval key, where Hermes keeps /yolo
v = am.check("terminal", chmod, "child1")
check("a subagent of a chat in Auto access is in Auto access", isinstance(v, dict) and v.get("action") == "block", str(v))
STATE["key"] = "key-1"
am.set_mode("parent1", "")
am.set_mode("other", "auto")
DB.write_text("not a database")
am._lineage_cache.clear()
STATE["yolo"].add("key-1")
v = am.check("terminal", chmod, "unknown1")
check("lineage unreadable under /yolo while chats are in Auto access: dangerous commands are blocked",
      isinstance(v, dict) and v.get("action") == "block", str(v))
check("and normal commands still run", am.check("terminal", {"command": "ls"}, "unknown1") is None)
STATE["yolo"].clear()
check("lineage unreadable without /yolo: Hermes asks as usual", am.check("terminal", chmod, "unknown1") is None)
DB.unlink()
am._lineage_cache.clear()
STATE["yolo"].add("key-1")
check("no session database: no older segments", am.check("terminal", chmod, "unknown2") is None)
STATE["yolo"].clear()
am.set_mode("other", "")
check("no chat in Auto access: nothing is looked up", am.check("terminal", chmod, "unknown3") is None)

print("PASSED" if not fails else f"FAILED ({fails})")
sys.exit(1 if fails else 0)
