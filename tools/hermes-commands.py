#!/usr/bin/env python3
"""Writes web/vendor/hermes-commands.json: the slash command names Hermes's own command table knows (COMMAND_REGISTRY in
hermes_cli/commands.py), each with the command it runs, so the app reads a typed name (an alias, a beginning Hermes expands)
as Hermes will. Read from the source without running it: every CommandDef's name and aliases. `names` are those of Hermes's
COMMANDS table (gateway-only commands left out), which its slash worker expands a beginning against; `aliases` holds every
alias, gateway-only ones too, as `resolve_command` does.

Usage: tools/hermes-commands.py <hermes-agent checkout> [--check]
  The checkout must be at the pinned commit (web/vendor/hermes-shared/.hermes-commit). --check compares with the file
  instead of writing it, and exits 1 when they differ.
"""
import ast
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "vendor" / "hermes-commands.json"
PIN = (ROOT / "web" / "vendor" / "hermes-shared" / ".hermes-commit").read_text().strip()


def _const(node):
    return node.value if isinstance(node, ast.Constant) else None


def table(source: str) -> dict:
    names: list = []
    aliases: dict = {}
    for node in ast.walk(ast.parse(source)):
        if not (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "CommandDef"):
            continue
        name = _const(node.args[0]) if node.args else None
        if not isinstance(name, str):
            raise SystemExit(f"a CommandDef whose name is not plain text (line {node.lineno})")
        kw = {k.arg: k.value for k in node.keywords}
        als = []
        if "aliases" in kw:
            if not isinstance(kw["aliases"], (ast.Tuple, ast.List)) or any(not isinstance(_const(e), str) for e in kw["aliases"].elts):
                raise SystemExit(f"/{name}: aliases that are not plain text")
            als = [_const(e) for e in kw["aliases"].elts]
        gateway_only = kw.get("gateway_only")
        if gateway_only is not None and not isinstance(_const(gateway_only), bool):
            raise SystemExit(f"/{name}: gateway_only that is not True or False")
        for a in als:
            aliases[a] = name
        if not (gateway_only is not None and _const(gateway_only)):
            names += [name, *als]
    if len(names) < 50 or "blueprint" not in names:
        raise SystemExit("this doesn't look like Hermes's command table")
    return {"commit": PIN, "names": sorted(set(names)), "aliases": dict(sorted(aliases.items()))}


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--check"]
    if len(args) != 1:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    repo = Path(args[0])
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    src = repo / "hermes_cli" / "commands.py"
    if head and not head.startswith(PIN):
        # A checkout at another commit: read the pinned file from its history instead.
        r = subprocess.run(["git", "-C", str(repo), "show", f"{PIN}:hermes_cli/commands.py"], capture_output=True, text=True)
        if r.returncode != 0:
            print(f"{repo} has no commit {PIN}", file=sys.stderr)
            return 2
        text = r.stdout
    else:
        text = src.read_text()
    out = json.dumps(table(text), indent=1) + "\n"
    if "--check" in sys.argv:
        if OUT.read_text() != out:
            print(f"{OUT.relative_to(ROOT)} differs from Hermes {PIN}'s command table: run tools/hermes-commands.py {repo}")
            return 1
        print(f"{OUT.relative_to(ROOT)} matches Hermes {PIN}")
        return 0
    OUT.write_text(out)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(json.loads(out)['names'])} names)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
