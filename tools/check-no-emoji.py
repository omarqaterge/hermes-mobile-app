#!/usr/bin/env python3
"""No emoji and no icon glyph in the app's interface code, notifications, plugin messages and phone scripts (owner's decision, docs/decisions/no-emoji.md).

Looks at non-test .ts/.tsx (web/src), .java and .xml (android/), .py (hermes-plugin/, phone/: string constants, not docstrings
or comments) and shell scripts (phone/, android/). Fails when one has an emoji, or one of the glyphs people used to draw an icon with
(a cross, a tick, a hamburger, a star, a play triangle, a chevron, a gear, ...), in a string or in JSX text. Comments are
not looked at. Icons come from web/src/components/icons.tsx; words stay words; ordinary punctuation (arrows in
"Settings → Voice", the middle dot, the ellipsis, quotes, the multiplication sign) is fine.

A character that is DATA, not interface (the marker the app stores in a chat title), is written as a \\u escape in the source (U+2387, the branch mark; U+200D, a joiner stripped from text), which this check does not see.

Usage: tools/check-no-emoji.py [--list] [DIR ...]   (default DIRs: web/src android hermes-plugin phone; --list prints every hit instead of failing)
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Emoji blocks, plus the variation selector and the zero-width joiner that glue emoji sequences.
EMOJI = '\U0001F000-\U0001FAFF☀-⛿✀-➿️‍⃣'
# Glyphs used as icons: arrows (not the plain right arrow), geometric shapes, dingbats, technical symbols, chevron quotes.
GLYPHS = '←↑↓↔-⇿⌀-⏿■-◿⤀-⯿✓✔✕✖✗›‹⋯⋮☰＋－★☆☐☑☒⭐'
PATTERN = re.compile('[' + EMOJI + GLYPHS + ']')
SKIP_SUFFIX = ('.test.ts', '.test.tsx')
DEFAULT_DIRS = ['web/src', 'android', 'hermes-plugin', 'phone']


def strip_comments(text: str) -> str:
    """Blank out /* */ blocks and // line comments (not the // of a URL) so their characters are not looked at."""
    text = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text, flags=re.S)
    out = []
    for line in text.split('\n'):
        m = re.search(r'(^|[\s;,{(])//', line)
        out.append(line[: m.end() - 2] if m else line)
    return '\n'.join(out)


def strip_xml_comments(text: str) -> str:
    return re.sub(r'<!--.*?-->', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text, flags=re.S)


def strip_hash_comments(text: str) -> str:
    """Shell: a # at the start of a line or after a space, with no open quote before it, begins a comment."""
    out = []
    for line in text.split('\n'):
        cut = len(line)
        for m in re.finditer(r'(^|\s)#', line):
            before = line[: m.start() + len(m.group(1))]
            if before.count('"') % 2 == 0 and before.count("'") % 2 == 0:
                cut = m.start() + len(m.group(1))
                break
        out.append(line[:cut])
    return '\n'.join(out)


def python_strings(text: str):
    """(line, string) for each string constant of a Python file that is not a docstring (comments never are strings)."""
    tree = ast.parse(text)
    docs = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docs.add(id(first.value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs:
            # The source as written, so a \\u escape stays an escape (the value would be the character itself).
            yield node.lineno, ast.get_source_segment(text, node) or node.value


def is_test(path: Path) -> bool:
    n = path.name
    return (n.endswith(SKIP_SUFFIX) or n.startswith('test_') or n.endswith(('_test.py', 'Test.java'))
            or any(part in ('tests', 'test', '__tests__') for part in path.parts))


def is_shell(path: Path) -> bool:
    if path.suffix == '.sh':
        return True
    if path.suffix:
        return False
    try:
        return path.read_bytes()[:64].startswith((b'#!/bin/sh', b'#!/bin/bash', b'#!/usr/bin/env sh', b'#!/usr/bin/env bash', b'#!/system/bin/sh', b'#!/data/data'))
    except OSError:
        return False


def hits(path: Path):
    text = path.read_text(encoding='utf-8', errors='replace')
    if path.suffix == '.py':
        try:
            for n, s in python_strings(text):
                found = PATTERN.findall(s)
                if found:
                    yield n, ''.join(dict.fromkeys(found)), s.strip().split('\n')[0][:100]
        except SyntaxError:
            pass
        return
    if path.suffix == '.xml':
        text = strip_xml_comments(text)
    elif path.suffix in ('.ts', '.tsx', '.java'):
        text = strip_comments(text)
    else:
        text = strip_hash_comments(text)
    for n, line in enumerate(text.split('\n'), 1):
        found = PATTERN.findall(line)
        if found:
            yield n, ''.join(dict.fromkeys(found)), line.strip()[:100]


def wanted(path: Path) -> bool:
    if is_test(path):
        return False
    if path.suffix in ('.ts', '.tsx', '.java', '.xml', '.py'):
        return True
    return is_shell(path)


def main(argv):
    listing = '--list' in argv
    dirs = [a for a in argv if not a.startswith('--')] or DEFAULT_DIRS
    bad = 0
    for d in dirs:
        base = (ROOT / d) if not Path(d).is_absolute() else Path(d)
        for path in sorted(base.rglob('*')):
            if not path.is_file() or 'node_modules' in path.parts or not wanted(path):
                continue
            for n, chars, line in hits(path):
                bad += 1
                print(f'{path.relative_to(ROOT)}:{n}: {chars}  {line}')
    if bad and not listing:
        print(f'\n{bad} line(s) with an emoji or icon glyph. Use an icon from web/src/components/icons.tsx (web), a drawable (Android) or words.', file=sys.stderr)
        return 1
    if not bad:
        print('no emoji or icon glyphs in the interface, notifications, plugin or phone scripts')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
