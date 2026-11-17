#!/usr/bin/env python3
"""No emoji and no icon glyph in the app's interface code (owner's decision, docs/decisions/no-emoji.md).

Fails when a non-test source file under web/src has an emoji, or one of the glyphs people used to draw an icon with
(a cross, a tick, a hamburger, a star, a play triangle, a chevron, a gear, ...), in a string or in JSX text. Comments are
not looked at. Icons come from web/src/components/icons.tsx; words stay words; ordinary punctuation (arrows in
"Settings → Voice", the middle dot, the ellipsis, quotes, the multiplication sign) is fine.

A character that is DATA, not interface (a marker the app stores in a chat title, a legacy prefix it strips from old
messages), is written as a \\u escape in the source, which this check does not see.

Usage: tools/check-no-emoji.py [--list] [DIR ...]   (default DIR: web/src; --list prints every hit instead of failing)
"""
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


def strip_comments(text: str) -> str:
    """Blank out /* */ blocks and // line comments (not the // of a URL) so their characters are not looked at."""
    text = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text, flags=re.S)
    out = []
    for line in text.split('\n'):
        m = re.search(r'(^|[\s;,{(])//', line)
        out.append(line[: m.end() - 2] if m else line)
    return '\n'.join(out)


def hits(path: Path):
    text = strip_comments(path.read_text(encoding='utf-8'))
    for n, line in enumerate(text.split('\n'), 1):
        found = PATTERN.findall(line)
        if found:
            yield n, ''.join(dict.fromkeys(found)), line.strip()[:100]


def main(argv):
    listing = '--list' in argv
    dirs = [a for a in argv if not a.startswith('--')] or ['web/src']
    bad = 0
    for d in dirs:
        base = (ROOT / d) if not Path(d).is_absolute() else Path(d)
        for path in sorted(base.rglob('*')):
            if path.suffix not in ('.ts', '.tsx') or path.name.endswith(SKIP_SUFFIX):
                continue
            for n, chars, line in hits(path):
                bad += 1
                print(f'{path.relative_to(ROOT)}:{n}: {chars}  {line}')
    if bad and not listing:
        print(f'\n{bad} line(s) with an emoji or icon glyph. Use an icon from web/src/components/icons.tsx or words.', file=sys.stderr)
        return 1
    if not bad:
        print('no emoji or icon glyphs in the interface code')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
