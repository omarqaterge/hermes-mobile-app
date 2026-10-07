#!/usr/bin/env python3
"""Approval checks (no phone needed): the notification's approval event carries the id of the exact
request it shows, so its buttons can never answer a different waiting approval.
    python3 tools/test_approval.py
"""
import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


# A stand-in for Hermes's tools.approval queue (the hook fires after the request is queued).
queue = {}
tools = types.ModuleType("tools")
approval = types.ModuleType("tools.approval")
approval.list_gateway_approvals = lambda key: [dict(e) for e in queue.get(key, [])]
tools.approval = approval
sys.modules["tools"], sys.modules["tools.approval"] = tools, approval

spec = importlib.util.spec_from_file_location("hermes_mobile_plugin", ROOT / "hermes-plugin" / "hermes-mobile" / "__init__.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)
sent = []
plugin._send = lambda kind, *a, **kw: sent.append((kind, kw))
plugin._set_status = lambda *a, **kw: None

print("approval request id")
queue["k"] = [{"command": "chmod 777 /tmp/a", "request_id": "A"}, {"command": "chmod 777 /tmp/b", "request_id": "B"}]
plugin._on_pre_approval_request(command="chmod 777 /tmp/b", description="world-writable", session_key="k", session_id="s")
check("event carries the shown command's id, not the oldest", sent[-1][1].get("request_id") == "B", sent[-1])
queue["k"].append({"command": "chmod 777 /tmp/a", "request_id": "A2"})
check("same command queued twice → the newest", plugin._approval_request_id("k", "chmod 777 /tmp/a") == "A2")
check("an id Hermes passes wins", plugin._approval_request_id("k", "chmod 777 /tmp/a", "X") == "X")
check("not queued → empty (the app then refuses to answer)", plugin._approval_request_id("k", "rm x") == "")
check("unknown session → empty", plugin._approval_request_id("other", "chmod 777 /tmp/a") == "")
del sys.modules["tools.approval"]
approval.list_gateway_approvals = None
check("Hermes without the queue API → empty, no crash", plugin._approval_request_id("k", "chmod 777 /tmp/a") == "")

api = (ROOT / "hermes-plugin" / "hermes-mobile" / "dashboard" / "plugin_api.py").read_text()
check("/approve refuses an answer without a request id", "if not body.request_id:" in api)

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
