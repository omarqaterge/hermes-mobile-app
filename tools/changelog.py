#!/usr/bin/env python3
"""CHANGELOG fragments: each branch adds its user-facing entries as its own file in changes/ instead of editing the
top of CHANGELOG.md, so parallel branches never conflict there. A release folds them into CHANGELOG.md.

A fragment is changes/YYYY-MM-DD-short-name.md holding one or more CHANGELOG bullets ("- **Title.** Text…", continuation
lines indented). Newer dates come first in the release section; changes/README.md is not a fragment.

Usage:
  python3 tools/changelog.py check            fragments are well formed (CI)          exit 0 = fine, 1 = a bad fragment
  python3 tools/changelog.py show             the next release's notes: fragments, then CHANGELOG.md's "## Unreleased"
  python3 tools/changelog.py release vX.Y.Z [YYYY-MM-DD]
                                              writes "## vX.Y.Z (date)" with those notes under an emptied
                                              "## Unreleased" and deletes the fragments (commit both)
"""
from __future__ import annotations

import datetime
import re
import sys
from pathlib import Path

NAME = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$")


def fragments(root: Path) -> list[Path]:
    d = root / "changes"
    if not d.is_dir():
        return []
    # newest first: the date leads the name
    return sorted((p for p in d.iterdir() if p.is_file() and p.name != "README.md"), key=lambda p: p.name, reverse=True)


def problems(root: Path) -> list[str]:
    out = []
    for p in fragments(root):
        text = p.read_text(encoding="utf-8").strip()
        if not NAME.match(p.name):
            out.append(f"{p.name}: name it YYYY-MM-DD-short-name.md (lower case, dashes)")
        if not text:
            out.append(f"{p.name}: empty")
        elif not text.startswith("- "):
            out.append(f"{p.name}: must start with a CHANGELOG bullet (\"- **Title.** …\")")
        elif any(line.startswith("#") for line in text.splitlines()):
            out.append(f"{p.name}: no headings; the release adds the version heading")
    return out


def _split(changelog: str) -> tuple[str, str, str]:
    """(everything up to and including the "## Unreleased" line, the Unreleased body, the rest from the next "## ")."""
    m = re.search(r"^## Unreleased[ \t]*\n", changelog, re.M)
    if not m:
        raise SystemExit("CHANGELOG.md has no '## Unreleased' section")
    nxt = re.search(r"^## ", changelog[m.end():], re.M)
    end = m.end() + nxt.start() if nxt else len(changelog)
    return changelog[: m.end()], changelog[m.end(): end].strip(), changelog[end:]


def notes(root: Path) -> str:
    _, unreleased, _ = _split((root / "CHANGELOG.md").read_text(encoding="utf-8"))
    parts = [p.read_text(encoding="utf-8").strip() for p in fragments(root)]
    return "\n".join(x for x in parts + [unreleased] if x)


def release(root: Path, version: str, date: str) -> str:
    if not re.fullmatch(r"v\d+\.\d+\.\d+", version):
        raise SystemExit(f"version must look like v0.8.70, not {version!r}")
    cl = root / "CHANGELOG.md"
    text = cl.read_text(encoding="utf-8")
    if re.search(rf"^## {re.escape(version)} ", text, re.M):
        raise SystemExit(f"CHANGELOG.md already has {version}")
    body = notes(root)
    if not body:
        raise SystemExit("nothing to release: no fragments and an empty '## Unreleased'")
    head, _, rest = _split(text)
    cl.write_text(f"{head}\n## {version} ({date})\n\n{body}\n\n{rest}", encoding="utf-8")
    for p in fragments(root):
        p.unlink()
    return body


def main(argv: list[str], root: Path | None = None) -> int:
    root = root or Path(__file__).resolve().parent.parent
    cmd = argv[0] if argv else "show"
    if cmd == "check":
        bad = problems(root)
        for b in bad:
            print(f"changes/{b}")
        print(f"changelog: {len(fragments(root))} fragment(s), {'OK' if not bad else f'{len(bad)} problem(s)'}")
        return 1 if bad else 0
    if cmd == "show":
        print(notes(root))
        return 0
    if cmd == "release" and len(argv) in (2, 3):
        bad = problems(root)
        if bad:
            print("\n".join(f"changes/{b}" for b in bad))
            return 1
        release(root, argv[1], argv[2] if len(argv) == 3 else datetime.date.today().isoformat())
        print(f"CHANGELOG.md: wrote {argv[1]}; fragments removed")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
