"""Live data in cards (OpenUI Query): the read-only tools a card may call, and the call itself.

Cards only read (no Mutation): anything that changes something goes through a chat turn, where the usual approvals
apply. The allow-list is openui_tools.json (OpenUI ToolSpec shape; the web app feeds it to the model's reference).
The dashboard serves it as POST /api/plugins/hermes-mobile/openui/call.
"""
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

HERE = Path(__file__).resolve().parent
TOOLS = HERE / "openui_tools.json"

# Hermes tracks reads per task to stop a model re-reading an unchanged file: the 2nd identical read_file returns an
# "unchanged" stub, the 3rd is BLOCKED. A card has no conversation holding the earlier result, so card reads run
# under their own task id and its tracker is cleared after each call. Hermes maps the id to its shared terminal
# environment (terminal_tool._resolve_container_task_id), so this starts no extra shell.
TASK_ID = "hm-openui-card"


def query_tools() -> Dict[str, Dict[str, Any]]:
    """Tools a card's Query() may call: the readOnlyHint entries of openui_tools.json. A broken file allows nothing."""
    try:
        return {t["name"]: t for t in json.loads(TOOLS.read_text()) if t.get("annotations", {}).get("readOnlyHint")}
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


def _forget_reads() -> None:
    try:
        from tools.file_tools import clear_file_ops_cache
        clear_file_ops_cache(TASK_ID)
    except Exception:
        pass


def call_tool(name: str, args: Optional[Dict[str, Any]] = None) -> Any:
    """Run one allow-listed tool for a card and return its parsed result (a tool's own {"error": …}, e.g. Hermes's
    read denylist, comes back as data). PermissionError for any tool not on the list."""
    if not name or name not in query_tools():
        raise PermissionError(f"{name or 'This tool'} is not available to cards")
    args = dict(args or {})
    if name == "find_chats":
        return _parse(_chat_search().tool_handler(args))
    import model_tools  # Hermes's dispatcher (hooks + registry); the dashboard runs in Hermes's venv
    try:
        # session_id=None: no status chip / turn bookkeeping for a card's background read.
        return _parse(model_tools.handle_function_call(name, args, task_id=TASK_ID, session_id=None, enabled_tools=[name]))
    finally:
        if name in ("read_file", "search_files"):
            _forget_reads()
