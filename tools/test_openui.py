#!/usr/bin/env python3
"""Tests for the plugin's cards-in-replies support (openui.py and its wiring in __init__.py):
    python3 tools/test_openui.py
"""
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..", "hermes-plugin", "hermes-mobile")
tmp = Path(tempfile.mkdtemp())
os.environ["HOME"] = str(tmp)
os.environ["HERMES_HOME"] = str(tmp)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ou = load("openui", os.path.join(PLUGIN, "openui.py"))

fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    fails += 0 if cond else 1


print("openui.py")
ou.PATH = tmp / "openui-test" / "openui.json"
check("on by default (no file)", ou.enabled())
check("no register_skill: the section names the tool", ou.prompt_section({"platform": "mobile"}) == ou.PROMPT_TOOL)
ou.skill_registered = True
check("app chats get the section", ou.prompt_section({"platform": "mobile"}) == ou.PROMPT)
check("resumed app chats (tui) too", ou.prompt_section({"platform": "tui"}) == ou.PROMPT)
check("other platforms don't", ou.prompt_section({"platform": "telegram"}) == "")
check("a broken info mapping gives nothing", ou.prompt_section(None) == "")
ou.set_enabled(False)
check("off: no section", ou.prompt_section({"platform": "mobile"}) == "")
check("off is stored", json.loads(ou.PATH.read_text()) == {"enabled": False})
ou.set_enabled(True)
check("back on", ou.enabled())
ou.PATH.write_text("{broken")
check("a broken file counts as on", ou.enabled())
ou.PATH.write_text("[]")
check("a file that isn't an object counts as on", ou.enabled())
for name, text in (("PROMPT", ou.PROMPT), ("PROMPT_TOOL", ou.PROMPT_TOOL)):
    check(f"{name} fits its 900-char budget", len(text) <= 900, len(text))
check("section names the fence and the skill",
      "```openui-lang" in ou.PROMPT and 'skill_view("hermes-mobile:openui")' in ou.PROMPT
      and ou.PROMPT.index("skill_view") < ou.PROMPT.index("openui_reference"), ou.PROMPT)
check("fallback section names the tool", "openui_reference" in ou.PROMPT_TOOL and "skill_view" not in ou.PROMPT_TOOL)
ref = ou.tool_handler({})
check("tool returns the reference", "```openui-lang" in ref and "Card(" in ref, ref[:80])
check("tool leaves out the skill's frontmatter", ref.startswith("You are answering") and "\nname: openui" not in ref, ref[:80])
check("reference within budget", len(ref) < 52_000, len(ref))
check("schema name", ou.TOOL_SCHEMA["name"] == "openui_reference")
real_md = ou.SKILL_MD
ou.SKILL_MD = tmp / "missing" / "SKILL.md"
miss = ou.tool_handler({})
check("missing skill file: a JSON error, no exception", "error" in json.loads(miss), miss)
ou.SKILL_MD = real_md

print("skills/openui/SKILL.md (a Hermes skill)")
md = ou.SKILL_MD.read_text(encoding="utf-8")
check("SKILL.md sits in skills/openui/", ou.SKILL_MD.parent.name == "openui" and ou.SKILL_MD.parent.parent.name == "skills")
check("starts with frontmatter and closes it", md.startswith("---\n") and "\n---\n" in md[4:])
fm = dict(l.split(": ", 1) for l in md[4:md.index("\n---\n", 4)].splitlines() if ": " in l and not l.startswith(" "))
check("frontmatter name is the registered name", fm.get("name") == ou.SKILL_NAME, fm)
check("frontmatter has a description skill_view doesn't cut", 40 < len(fm.get("description", "")) <= 1024, fm)
check("SKILL.md within the 100,000 chars Hermes allows a skill it authors", len(md) <= 100_000, len(md))
low = md.lower()
check("no text Hermes flags as prompt injection", not any(p in low for p in (
    "ignore previous instructions", "ignore all previous", "you are now", "disregard your",
    "forget your instructions", "new instructions:", "system prompt:", "<system>", "]]>")))
check("nothing Hermes's skill preprocessing would rewrite", "${HERMES_" not in md and "!`" not in md)
manifest = (ou.SKILL_MD.parent.parent.parent / "plugin.yaml").read_text(encoding="utf-8")
check("plugin.yaml: no second ': ' in a plain line (YAML would reject the manifest and Hermes skip the plugin)",
      not [l for l in manifest.splitlines() if l.split(": ", 1)[-1].count(": ") and not l.lstrip().startswith("#")])
check("the old reference file is gone (one copy only)", not (ou.SKILL_MD.parent.parent.parent / "openui_reference.txt").exists())
s = ou.strip_ui("Here:\n```openui-lang\nroot = Card([])\n```\nDone")
check("strip_ui: a block becomes [card]", s == "Here:\n[card]\nDone", repr(s))
check("strip_ui: an unclosed block too", ou.strip_ui("x\n```openui-lang\nroot = Card(") == "x\n[card]")
check("strip_ui: other code untouched", ou.strip_ui("```py\nx=1\n```") == "```py\nx=1\n```")
check("strip_ui: None", ou.strip_ui(None) == "")
two = ou.strip_ui("```openui-lang\na = 1\n```\nmid\n```openui-lang\nb = 2\n```")
check("strip_ui: two blocks, text between kept", two == "[card]\nmid\n[card]", repr(two))

print("plugin wiring (__init__.py)")
plugin = load("hermes_mobile_plugin_openui", os.path.join(PLUGIN, "__init__.py"))


class Ctx:
    def __init__(self):
        self.tools, self.sections, self.hooks = {}, {}, {}

    def register_tool(self, name, toolset, schema, handler, **kw):
        self.tools[name] = dict(toolset=toolset, schema=schema, handler=handler, **kw)

    def register_system_prompt_section(self, id, content, *, position="after_memory", max_chars=4000):
        self.sections[id] = dict(content=content, position=position, max_chars=max_chars)

    def register_hook(self, name, fn):
        self.hooks[name] = fn


class SkillCtx(Ctx):
    def __init__(self):
        super().__init__()
        self.skills = {}

    def register_skill(self, name, path, description="", frontmatter=None):
        self.skills[name] = dict(path=Path(path), description=description)


old = Ctx()
plugin.register(old)
mod = sys.modules.get("hm_openui")
check("older Hermes (no register_skill): still loads, section names the tool",
      mod is not None and not mod.skill_registered and "openui_reference" in old.tools
      and old.sections["hermes-mobile.openui"]["content"]({"platform": "mobile"}) == mod.PROMPT_TOOL)

ctx = SkillCtx()
plugin.register(ctx)
sk = ctx.skills.get("openui") or {}
check("registers the openui skill with Hermes", sk.get("path") == mod.SKILL_MD and sk["path"].is_file(), ctx.skills)
check("skills_list shows the frontmatter's description", sk.get("description") == fm.get("description"), sk)
check("skill registered: the section points at skill_view",
      ctx.sections["hermes-mobile.openui"]["content"]({"platform": "mobile"}) == mod.PROMPT)


class BadSkillCtx(Ctx):
    def register_skill(self, *a, **k):
        raise ValueError("refused")


bad = BadSkillCtx()
plugin.register(bad)
check("a refused skill: tool and section still there, section names the tool",
      "openui_reference" in bad.tools and not mod.skill_registered
      and bad.sections["hermes-mobile.openui"]["content"]({"platform": "mobile"}) == mod.PROMPT_TOOL)
plugin.register(ctx)  # back to a Hermes with skills for the checks below
t = ctx.tools.get("openui_reference") or {}
check("registers the openui_reference tool", t.get("schema", {}).get("name") == "openui_reference", list(ctx.tools))
check("tool in the canvas toolset", t.get("toolset") == "canvas", t.get("toolset"))
check("tool handler returns the reference", "Card(" in (t.get("handler") or (lambda a: ""))({}))
sec = ctx.sections.get("hermes-mobile.openui") or {}
check("registers the openui prompt section", callable(sec.get("content")), list(ctx.sections))
check("section budget 900", sec.get("max_chars") == 900, sec.get("max_chars"))
mod = sys.modules.get("hm_openui")
if mod is not None:
    mod.PATH = tmp / "openui-wiring" / "openui.json"
    check("the section follows the setting", sec["content"]({"platform": "mobile"}) == mod.PROMPT)
    mod.set_enabled(False)
    check("the section is empty when off", sec["content"]({"platform": "mobile"}) == "")
    mod.set_enabled(True)
cp = plugin._CANVAS_PROMPT
check("canvas prompt: things the user asks to build or write", "asks you to build, make or write" in cp, cp[:120])
check("canvas prompt: tables no longer sent to the canvas", "a table" not in cp)
check("canvas prompt fits its 900-char budget", len(cp) <= 900, len(cp))

sent = []
plugin._send = lambda kind, title="Hermes", body="", session="", urgent=False, **kw: sent.append(
    dict(kind=kind, title=title, body=body, **kw))
plugin._last_text["s-ui"] = "Here are your options:\n```openui-lang\nroot = Card([Button(\"Yes\")])\n```\nPick one."
plugin._on_session_end(session_id="s-ui", turn_id="s-ui:1", completed=True)
reply = next((e for e in sent if e["kind"] == "reply"), {})
flash = next((e for e in sent if e["kind"] == "flash"), {})
want = "Here are your options:\n[card]\nPick one."
check("reply notification shows [card]", reply.get("body") == want, repr(reply.get("body")))
check("read-aloud text shows [card]", reply.get("speak_text") == want, repr(reply.get("speak_text")))
check("Done chip shows [card], no openui-lang code",
      "[card]" in flash.get("body", "") and "openui" not in flash.get("body", "") + flash.get("reply", ""),
      repr(flash))

print("FAILED" if fails else "PASSED")
sys.exit(1 if fails else 0)
