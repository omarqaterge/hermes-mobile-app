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
STATE = {"session_ok": set(), "broken": False}


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
ctx.get_current_session_key = lambda default="": "key-1"
tools_pkg.approval, tools_pkg.approval_detection, tools_pkg.approval_context = ap, det, ctx
sys.modules.update({"tools": tools_pkg, "tools.approval": ap, "tools.approval_detection": det, "tools.approval_context": ctx})

tmp = tempfile.mkdtemp()
am.PATH = Path(tmp) / "auto.json"

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

print("PASSED" if not fails else f"FAILED ({fails})")
sys.exit(1 if fails else 0)
