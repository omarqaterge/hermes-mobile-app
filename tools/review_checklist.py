#!/usr/bin/env python3
"""The review checklist items a change touches: each item in docs/review-checklist/ names a trigger that can be read
off a diff, and this prints only the items whose trigger fires, so a change is read against the three or four rules
it can break instead of all of them.

An item is docs/review-checklist/<name>.md: a `# Title`, trigger lines, then what to check and why.

  - paths: `REGEX`      (required) a changed file's path matches
  - adds: `REGEX`       a line the change adds in such a file matches
  - removes: `REGEX`    a line the change removes from such a file matches
  - without: `REGEX`    no changed file's path matches (for "changed X but not Y")

With `adds` and `removes` both given, either is enough. Regexes are Python's, searched anywhere in the path or line.

Usage:
  python3 tools/review_checklist.py            items for this branch's changes since origin/main, uncommitted included
  python3 tools/review_checklist.py --base REF the same against another base
  python3 tools/review_checklist.py --all      every item with its trigger
  python3 tools/review_checklist.py --check    the item files are well formed (CI)      exit 1 = a bad item
It lists what to read; it never fails a change (only --check has a failing exit code).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS = "docs/review-checklist"
KEYS = ("paths", "adds", "removes", "without")
_TRIGGER = re.compile(r"^- (\w+): `(.*)`\s*$")


class Item:
    def __init__(self, name: str, text: str):
        self.name = name
        self.title = ""
        self.rx: dict[str, re.Pattern[str]] = {}
        self.errors: list[str] = []
        body: list[str] = []
        for line in text.splitlines():
            m = _TRIGGER.match(line)
            if not self.title and line.startswith("# "):
                self.title = line[2:].strip()
            elif m and not body:
                key, rx = m.group(1), m.group(2)
                if key not in KEYS:
                    self.errors.append(f"unknown trigger `{key}` (one of {', '.join(KEYS)})")
                    continue
                try:
                    self.rx[key] = re.compile(rx)
                except re.error as e:
                    self.errors.append(f"`{key}` is not a regular expression: {e}")
            elif line.strip() or body:
                body.append(line)
        self.body = "\n".join(body).strip()
        if not self.title:
            self.errors.append("no `# Title` line")
        if "paths" not in self.rx and not any("`paths`" in e for e in self.errors):
            self.errors.append("no `- paths:` trigger")
        if not self.body:
            self.errors.append("no text saying what to check")

    def match(self, changes: dict[str, tuple[list[str], list[str]]]) -> list[str]:
        """The reasons this item fires for these changes ({path: (added lines, removed lines)}); empty = it doesn't."""
        paths = self.rx.get("paths")
        if not paths:
            return []
        files = [p for p in sorted(changes) if paths.search(p)]
        without = self.rx.get("without")
        if not files or (without and any(without.search(p) for p in changes)):
            return []
        adds, removes = self.rx.get("adds"), self.rx.get("removes")
        if not adds and not removes:
            return files
        why = []
        for p in files:
            added, removed = changes[p]
            hit = next((line for line in added if adds and adds.search(line)), None)
            sign = "+"
            if hit is None:
                hit = next((line for line in removed if removes and removes.search(line)), None)
                sign = "-"
            if hit is not None:
                why.append(f"{p}: {sign} {hit.strip()[:90]}")
        return why


def load(root: Path) -> list[Item]:
    return [Item(f.stem, f.read_text(encoding="utf-8"))
            for f in sorted((root / ITEMS).glob("*.md")) if f.name != "README.md"]


def parse_diff(diff: str) -> dict[str, tuple[list[str], list[str]]]:
    """{path: (added lines, removed lines)} from `git diff` output; a deleted file keeps its old path."""
    changes: dict[str, tuple[list[str], list[str]]] = {}
    old = cur = None
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            old = cur = None
        elif line.startswith("--- "):
            old = line[6:] if line.startswith("--- a/") else None
        elif line.startswith("+++ "):
            cur = line[6:] if line.startswith("+++ b/") else old
            if cur:
                changes.setdefault(cur, ([], []))
        elif line.startswith("Binary files ") and " differ" in line:
            m = re.match(r"Binary files (?:a/(.*?)|/dev/null) and (?:b/(.*?)|/dev/null) differ$", line)
            if m and (m.group(2) or m.group(1)):
                changes.setdefault(m.group(2) or m.group(1), ([], []))
        elif cur and line.startswith("+"):
            changes[cur][0].append(line[1:])
        elif cur and line.startswith("-"):
            changes[cur][1].append(line[1:])
    return changes


def _git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, errors="replace").stdout


def changes_since(root: Path, base: str | None) -> dict[str, tuple[list[str], list[str]]]:
    if not base:
        base = _git(root, "merge-base", "HEAD", "origin/main").strip() or "origin/main"
    changes = parse_diff(_git(root, "diff", "--unified=0", "--no-color", "--no-ext-diff", base))
    for p in _git(root, "ls-files", "--others", "--exclude-standard").splitlines():
        try:
            lines = (root / p).read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            lines = []
        changes.setdefault(p, (lines, []))
    return changes


def report(items: list[Item], changes: dict[str, tuple[list[str], list[str]]]) -> str:
    fired = [(it, why) for it in items if (why := it.match(changes))]
    out = [f"Review checklist: {len(fired)} of {len(items)} items match this change ({ITEMS}/)"]
    for it, why in fired:
        out.append("")
        out.append(f"[{it.name}] {it.title}")
        out.extend(f"    {w}" for w in why[:3])
        if len(why) > 3:
            out.append(f"    and {len(why) - 3} more")
        out.extend(f"  {line}" if line else "" for line in it.body.splitlines())
    return "\n".join(out)


def main(argv: list[str]) -> int:
    root = ROOT
    args = argv[1:]
    items = load(root)
    if args == ["--check"]:
        bad = [(it.name, e) for it in items for e in it.errors]
        for name, e in bad:
            print(f"  {ITEMS}/{name}.md: {e}")
        if not items:
            print(f"review_checklist: no items in {ITEMS}/")
            return 1
        print(f"review_checklist: {len(bad)} problem(s) in the item files." if bad
              else f"review_checklist: {len(items)} items, all well formed.")
        return 1 if bad else 0
    if args == ["--all"]:
        for it in items:
            print(f"[{it.name}] {it.title}")
            for k in KEYS:
                if k in it.rx:
                    print(f"    {k}: {it.rx[k].pattern}")
        return 0
    base = None
    if len(args) == 2 and args[0] == "--base":
        base = args[1]
    elif args:
        print(__doc__)
        return 2
    print(report(items, changes_since(root, base)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
