"""Cards in replies (OpenUI): the prompt section, the openui skill and the on/off setting.

The app draws ```openui-lang blocks in Hermes's replies with OpenUI's chat component library
(web/src/openui-lib.ts). The full language + component reference is a Hermes skill, skills/openui/SKILL.md
(generated from the same library by `npm run gen:openui` in web/). The plugin registers it with
ctx.register_skill, Hermes's own way for a plugin to ship a skill: Hermes serves it as
skill_view("hermes-mobile:openui") and lists it in skills_list, but keeps plugin skills out of the
<available_skills> index, so the short system-prompt section below is the index entry. A chat pays for the
reference only when Hermes draws UI. On a Hermes without register_skill the section names the openui_reference
tool instead (it returns the same text and also serves chats whose frozen prompt still names it).
Settings → Replies writes ~/.hermes/mobile/openui.json (dashboard PUT /openui). Hermes freezes the sections into
each NEW chat's prompt, so the switch affects new chats only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Optional

PATH = Path.home() / ".hermes" / "mobile" / "openui.json"
SKILL_NAME = "openui"  # Hermes namespaces it with the plugin's name: hermes-mobile:openui
SKILL_MD = Path(__file__).resolve().parent / "skills" / SKILL_NAME / "SKILL.md"
_FRONTMATTER = re.compile(r"\A---\n[\s\S]*?\n---\n+")
# A fenced openui-lang block (opening fence at a line start), up to its closing fence or the end of an unfinished reply.
_FENCE = re.compile(r"^[ \t]*```openui(?:-lang)?(?![\w-])[^\n]*\n[\s\S]*?(?:^[ \t]*```[ \t]*$|\Z)", re.M)

_PROMPT = (
    "The phone app draws interactive UI inside your replies. When a card, table, chart, list of tappable choices, "
    "steps or a short form would help the user more than prose, put it in a fenced ```openui-lang block (text "
    "outside the fence shows as normal chat). Before your FIRST openui-lang block in a chat, {load} once and "
    "follow it exactly. Buttons send their words back to you as the user's next message, with any form values "
    "listed under them. Use only real data; never invent numbers or links. Keep plain Markdown for short answers. "
    "Documents, reports, code files and things the user asks you to build or write go on the canvas."
)
# The skill (pinned Hermes and newer); PROMPT_TOOL when this Hermes has no ctx.register_skill.
PROMPT = _PROMPT.format(load='load the skill with skill_view("hermes-mobile:openui") (no skill_view: call the '
                            'openui_reference tool, same text)')
PROMPT_TOOL = _PROMPT.format(load="call the openui_reference tool (load it with tool_describe if needed)")
skill_registered = False  # set by the plugin's register() once ctx.register_skill accepted the skill

TOOL_SCHEMA = {
    "name": "openui_reference",
    "description": "Get the openui-lang reference (syntax, every component, actions, forms, rules) for drawing "
                   "cards, tables, charts and forms in your reply; the same text as skill_view(\"hermes-mobile:openui\"). "
                   "Call one of them once per chat, before your first ```openui-lang block.",
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
        return PROMPT if skill_registered else PROMPT_TOOL
    except Exception:
        return ""


def register_skill(ctx: Any) -> bool:
    """Hand skills/openui/SKILL.md to Hermes (ctx.register_skill, in Hermes since 2026-09). False when this Hermes
    has no such call or refused the skill; the section then points at the openui_reference tool."""
    global skill_registered
    reg = getattr(ctx, "register_skill", None)
    skill_registered = False
    if callable(reg):
        reg(SKILL_NAME, SKILL_MD, description=description())
        skill_registered = True
    return skill_registered


def description() -> str:
    """The frontmatter's description, so skills_list (registered description) and skill_view say the same."""
    m = re.search(r"^description: (.+)$", SKILL_MD.read_text(encoding="utf-8").split("\n---\n", 1)[0], re.M)
    return m.group(1).strip() if m else ""


def reference() -> str:
    """The reference without the skill's frontmatter."""
    return _FRONTMATTER.sub("", SKILL_MD.read_text(encoding="utf-8"), count=1)


def tool_handler(args: Optional[Dict[str, Any]] = None, **_: Any) -> str:
    try:
        return reference()
    except Exception as e:
        return json.dumps({"error": f"openui reference missing ({type(e).__name__}); answer without cards"})


def strip_ui(text: Optional[str]) -> str:
    """Reply text for notifications and read-aloud: each openui-lang block becomes [card]."""
    return _FENCE.sub("[card]", text or "")
