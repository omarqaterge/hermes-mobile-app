#!/usr/bin/env python3
"""Check that the spec (docs/SPEC.md and docs/spec/*.md) mentions everything the code has.

Pulls names out of the code (files, bridge methods, plugin routes/hooks/tools, gateway RPCs, localStorage keys,
screens, Settings sections, row titles, aria-labels, service events, notification channels, permissions) and
lists every one no spec file mentions. Identifiers must appear in backticks (`speak`, `GET /canvas`);
UI copy (section/row titles, aria-labels) as plain text.

Usage: python3 tools/check_spec.py [repo_root]     exit 0 = complete, 1 = something is missing
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Kinds matched as plain text (what the user reads on screen); everything else must be in backticks.
PLAIN = {"Section title", "row title", "aria-label"}


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""


def _files(d: Path, *globs: str) -> list[Path]:
    if not d.is_dir():
        return []
    out: set[Path] = set()
    for g in globs:
        out |= {p for p in d.glob(g) if p.is_file()}
    return sorted(out)


def _join(paths: list[Path]) -> str:
    return "\n".join(_read(p) for p in paths)


def inventory(root: Path) -> dict[str, set[str]]:
    web = root / "web" / "src"
    comp = web / "components"
    java = root / "android" / "src" / "com" / "omarqaterge" / "hermesmobile"
    plug = root / "hermes-plugin" / "hermes-mobile"

    web_code = [p for p in _files(web, "*.ts", "*.tsx") + _files(comp, "*.ts", "*.tsx") if ".test." not in p.name]
    java_files = sorted(java.rglob("*.java")) if java.is_dir() else []
    plug_py = _files(plug, "*.py") + _files(plug / "dashboard", "*.py")
    wc, py = _join(web_code), _join(plug_py)
    svc = _read(java / "HermesService.java")

    inv: dict[str, set[str]] = {}
    inv["web file"] = {p.name for p in web_code if p.name != "vite-env.d.ts"}
    inv["Java class"] = {p.stem for p in java_files}
    inv["plugin file"] = {p.name for p in plug_py}
    inv["phone script"] = {p.name for p in _files(root / "phone", "*") if not p.name.startswith(".")}
    inv["tools file"] = {p.name for p in _files(root / "tools", "*")}
    inv["workflow"] = {p.name for p in _files(root / ".github" / "workflows", "*.yml")}
    inv["Hermes patch"] = {p.name for p in _files(root / "hermes" / "patches", "*.patch")}

    m = re.search(r"const METHODS = \[(.*?)\]", _read(web / "secure-bridge.ts"), re.S)
    inv["bridge method"] = set(re.findall(r"'(\w+)'", m.group(1))) if m else set()
    inv["gateway RPC"] = set(re.findall(r"\brpc(?:<[^>]*>)?\(\s*['\"]([a-z_.]+)['\"]", wc))
    inv["localStorage key"] = set(re.findall(r"['\"`](hm\.[A-Za-z]+(?:\.v\d+)?)", wc))
    sm = re.search(r"export type Screen = ([^\n]+)", _read(web / "store.ts"))
    inv["screen"] = set(re.findall(r"'(\w+)'", sm.group(1))) if sm else set()
    inv["Section title"] = set(re.findall(r"""<Section[^>]*\btitle=["']([^"']+)["']""", wc))
    inv["row title"] = set(re.findall(r'<(?:Row|ToggleRow|SelectRow|SliderRow)\b[^>]*?\btitle="([^"]+)"', wc))
    inv["aria-label"] = set(re.findall(r'aria-label="([^"]+)"', wc)) | set(re.findall(r"aria-label=\{'([^']+)'\}", wc))

    inv["plugin route"] = {f"{v.upper()} {p}" for v, p in re.findall(r'@router\.(get|post|put|delete)\("([^"]+)"', py)}
    inv["plugin hook"] = set(re.findall(r'register_hook\("(\w+)"', py))
    inv["plugin tool"] = set(re.findall(r'register_tool\(name="(\w+)"', py))
    inv["prompt section"] = set(re.findall(r'register_system_prompt_section\("([\w.-]+)"', py))

    inv["service event"] = set(re.findall(r'case "([a-z_]+)"', svc))
    inv["notification channel"] = set(re.findall(r'new NotificationChannel\([\w.]+, "([^"]+)"', svc))
    inv["permission"] = set(re.findall(r"android\.permission\.(\w+)", _read(root / "android" / "AndroidManifest.xml")))
    return inv


def missing(spec: str, inv: dict[str, set[str]]) -> list[str]:
    gaps = []
    for kind in sorted(inv):
        for item in sorted(inv[kind]):
            needle = item if kind in PLAIN else f"`{item}`"
            if needle not in spec:
                gaps.append(f"{kind}: {item}")
    return gaps


def spec_text(root: Path) -> str:
    """The whole spec: the index docs/SPEC.md and every docs/spec/*.md section file, in name order."""
    parts = [_read(root / "docs" / "SPEC.md")]
    parts += [_read(p) for p in sorted((root / "docs" / "spec").glob("*.md"))]
    return "\n".join(parts)


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent
    spec_path = root / "docs" / "SPEC.md"
    if not spec_path.is_file():
        print("docs/SPEC.md is missing")
        return 1
    inv = inventory(root)
    total = sum(len(v) for v in inv.values())
    gaps = missing(spec_text(root), inv)
    if gaps:
        print(f"The spec (docs/SPEC.md + docs/spec/) is missing {len(gaps)} of {total} items:")
        for g in gaps:
            print("  " + g)
        print("Add each one to the spec file for its area in docs/spec/ (identifiers in backticks, UI text as shown on screen).")
        return 1
    print(f"The spec (docs/SPEC.md + docs/spec/) covers all {total} items.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
