"""Live data in cards (OpenUI Query): the read-only tools a card may call, and the call itself.

Cards only read (no Mutation): anything that changes something goes through a chat turn, where the usual approvals
apply. The allow-list is openui_tools.json (OpenUI ToolSpec shape; the web app feeds it to the model's reference).

Cards read no files (owner's decision, 2026-11-16, docs/decisions/cards-read-no-files.md): a card runs its Query calls
by itself, with no approval, and can join one answer into the next call's arguments (a file into web_search's query)
or into a picture's address. Hermes's read denylist covers only its own credential files, not ~/.ssh or the app's
key. So the file tools are never served here, even if openui_tools.json lists them again (NEVER).
The dashboard serves it as POST /api/plugins/hermes-mobile/openui/call.
"""
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

HERE = Path(__file__).resolve().parent
TOOLS = HERE / "openui_tools.json"

# Card calls run under their own task id, apart from any chat's (Hermes keeps per-task state such as read trackers).
# Hermes maps the id to its shared terminal environment (terminal_tool._resolve_container_task_id): no extra shell.
TASK_ID = "hm-openui-card"

# Tools a card may never call, whatever openui_tools.json says: they read or change the phone's files or run commands.
NEVER = frozenset({"read_file", "search_files", "write_file", "patch", "terminal", "execute_code", "process_manage"})


def query_tools() -> Dict[str, Dict[str, Any]]:
    """Tools a card's Query() may call: the readOnlyHint entries of openui_tools.json, minus NEVER. A broken file
    allows nothing."""
    try:
        return {t["name"]: t for t in json.loads(TOOLS.read_text())
                if t.get("annotations", {}).get("readOnlyHint") and t.get("name") not in NEVER}
    except Exception:
        return {}


def _chat_search():
    """The plugin's own find_chats (Hermes's session_search only runs inside the agent loop). Same module name as
    dashboard/plugin_api.py's loader, so the dashboard keeps one copy."""
    mod = sys.modules.get("hm_chat_search")
    if mod is None:
        spec = importlib.util.spec_from_file_location("hm_chat_search", HERE / "chat_search.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hm_chat_search"] = mod
        spec.loader.exec_module(mod)
    return mod


def _parse(out: Any) -> Any:
    try:
        return json.loads(out)
    except Exception:
        return {"text": out}


def call_tool(name: str, args: Optional[Dict[str, Any]] = None) -> Any:
    """Run one allow-listed tool for a card and return its parsed result (a tool's own {"error": …}, e.g. Hermes's
    read denylist, comes back as data). PermissionError for any tool not on the list."""
    if not name or name not in query_tools():
        raise PermissionError(f"{name or 'This tool'} is not available to cards")
    args = dict(args or {})
    if name == "find_chats":
        return _parse(_chat_search().tool_handler(args))
    import model_tools  # Hermes's dispatcher (hooks + registry); the dashboard runs in Hermes's venv
    # session_id=None: no status chip / turn bookkeeping for a card's background read.
    return _parse(model_tools.handle_function_call(name, args, task_id=TASK_ID, session_id=None, enabled_tools=[name]))
