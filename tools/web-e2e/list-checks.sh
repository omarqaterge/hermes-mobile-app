#!/bin/bash
# The list of every browser check: one line per check() call in checks/*.cjs, as "FILE:LINE<TAB>TEXT", TEXT being the
# check's description (its last argument) as written in the source, on one line. baseline-checks.txt is this list as it
# was when the interface redesign started, so a later change can be compared with it:
#   tools/web-e2e/list-checks.sh                     print the list from the current files
#   tools/web-e2e/list-checks.sh --missing [FILE]    the checks of FILE (default baseline-checks.txt) whose file and text
#                                                    no longer appear (a check removed or reworded); exit 1 when any
# --missing compares file and text only, so checks that merely moved to other lines, and new checks, are not reported.
set -euo pipefail
cd "$(dirname "$0")"
list() {
  node - checks <<'JS'
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
// Skips a string, template (with ${…} nesting), comment or regex literal starting at i; returns the index after it.
function skip(s, i) {
  const c = s[i]
  if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); return e < 0 ? s.length : e }
  if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); return e < 0 ? s.length : e + 2 }
  if (c === "'" || c === '"') {
    for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++
    return i + 1
  }
  if (c === '`') {
    for (i++; i < s.length && s[i] !== '`'; i++) {
      if (s[i] === '\\') i++
      else if (s[i] === '$' && s[i + 1] === '{') i = block(s, i + 1) - 1
    }
    return i + 1
  }
  if (c === '/') { // a regex literal (the caller decided it is not a division)
    let cls = false
    for (i++; i < s.length; i++) {
      if (s[i] === '\\') i++
      else if (s[i] === '[') cls = true
      else if (s[i] === ']') cls = false
      else if (s[i] === '/' && !cls) break
    }
    for (i++; /[a-z]/.test(s[i] || ''); i++);
    return i
  }
  return i + 1
}
const regexAfter = ch => !ch || /[(,=:[!&|?{};+\-*%<>~^\n]/.test(ch)
// From an opening bracket at i to just after its match; `parts` collects the top-level comma-separated pieces.
function block(s, i, parts) {
  const open = s[i], close = { '(': ')', '[': ']', '{': '}' }[open]
  let depth = 0, start = i + 1, prev = ''
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`' || (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*' || regexAfter(prev)))) {
      i = skip(s, i); prev = 'x'; continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0 && c === close) { if (parts) parts.push(s.slice(start, i)); return i + 1 }
    } else if (c === ',' && depth === 1 && parts) { parts.push(s.slice(start, i)); start = i + 1 }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return i
}
const out = []
for (const f of fs.readdirSync(dir).filter(f => /^\d\d-.*\.cjs$/.test(f)).sort()) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8')
  let i = 0, prev = ''
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`' || (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*' || regexAfter(prev)))) {
      i = skip(s, i); prev = 'x'; continue
    }
    if (s.startsWith('check(', i) && !/[\w$.]/.test(s[i - 1] || '')) {
      const parts = []
      const end = block(s, i + 5, parts)
      const line = s.slice(0, i).split('\n').length
      const text = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').replace(/\s+/g, ' ').trim()
      out.push(`checks/${f}:${line}\t${text}`)
      i = end; prev = ')'; continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
}
process.stdout.write(out.join('\n') + '\n')
JS
}
case "${1:-}" in
  "") list ;;
  --missing)
    base=${2:-baseline-checks.txt}
    [ -f "$base" ] || { echo "list-checks.sh: no $base" >&2; exit 2; }
    # file and text, each kept as often as it occurs; a baseline entry is missing when the current list has fewer copies
    key() { sed -E 's/^([^:]*):[0-9]+\t/\1\t/' | sort; }
    gone=$(comm -23 <(key < "$base") <(list | key))
    [ -z "$gone" ] && { echo "Every check of $base is still there."; exit 0; }
    printf '%s\n' "$gone"
    echo "$(printf '%s\n' "$gone" | grep -c .) check(s) of $base are gone or reworded." >&2
    exit 1 ;;
  *) echo "usage: list-checks.sh [--missing [BASELINE]]" >&2; exit 2 ;;
esac
