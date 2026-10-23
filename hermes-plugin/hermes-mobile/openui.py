"""Cards in replies (OpenUI): the prompt section, the openui_reference tool and the on/off setting.

The app draws ```openui-lang blocks in Hermes's replies with OpenUI's chat component library
(web/src/openui-lib.ts). Every app chat gets a short system-prompt section saying the blocks exist. The full
language + component reference (generated from the same library by `npm run gen:openui` in web/, file
openui_reference.txt) comes from the openui_reference tool, so a chat pays for it only when Hermes draws UI.
Settings → Replies writes ~/.hermes/mobile/openui.json (dashboard PUT /openui). Hermes freezes the sections into
each NEW chat's prompt, so the switch affects new chats only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Optional

PATH = Path.home() / ".hermes" / "mobile" / "openui.json"
REFERENCE = Path(__file__).resolve().parent / "openui_reference.txt"
# A fenced openui-lang block (opening fence at a line start), up to its closing fence or the end of an unfinished reply.
_FENCE = re.compile(r"^[ \t]*```openui(?:-lang)?(?![\w-])[^\n]*\n[\s\S]*?(?:^[ \t]*```[ \t]*$|\Z)", re.M)

PROMPT = (
    "The phone app draws interactive UI inside your replies. When a card, table, chart, list of tappable choices, "
    "steps or a short form would help the user more than prose, put it in a fenced ```openui-lang block (text "
    "outside the fence shows as normal chat). Before your FIRST openui-lang block in a chat, call the "
    "openui_reference tool once (load it with tool_describe if needed) and follow it exactly. Buttons send their "
    "words back to you as the user's next message, with any form values listed under them. Use only real data; "
    "never invent numbers or links. Keep plain Markdown for short answers. Documents, reports, code files and "
    "things the user asks you to build or write go on the canvas."
)

TOOL_SCHEMA = {
    "name": "openui_reference",
    "description": "Get the openui-lang reference (syntax, every component, actions, forms, rules) for drawing "
                   "cards, tables, charts and forms in your reply. Call it once per chat, before your first "
                   "```openui-lang block.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}


def enabled() -> bool:
    """On unless the user switched it off (owner, 2026-10-23: on by default). A broken file counts as on."""
    try:
        return json.loads(PATH.read_text()).get("enabled", True) is not False
    except Exception:
        return True


def set_enabled(on: bool) -> bool:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"enabled": bool(on)}))
    tmp.replace(PATH)
    return bool(on)


def prompt_section(info: Optional[Dict[str, Any]]) -> str:
    """Only app chats (they log as `mobile`, or `tui` once resumed, like the canvas section) and only when on."""
    try:
        if str((info or {}).get("platform", "")) not in ("mobile", "tui") or not enabled():
            return ""
        return PROMPT
    except Exception:
        return ""


def tool_handler(args: Optional[Dict[str, Any]] = None, **_: Any) -> str:
    try:
        return REFERENCE.read_text(encoding="utf-8")
    except Exception as e:
        return json.dumps({"error": f"openui reference missing ({type(e).__name__}); answer without cards"})


def strip_ui(text: Optional[str]) -> str:
    """Reply text for notifications and read-aloud: each openui-lang block becomes [card]."""
    return _FENCE.sub("[card]", text or "")
