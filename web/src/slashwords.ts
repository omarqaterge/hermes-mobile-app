// How Hermes reads a slash command, so the app judges the same word Hermes will run (the lock screen's list, and the
// /approvals that need the Full access confirmation). Hermes takes
// `cmd.strip().lstrip('/').split(maxsplit=1)`, and Python's split() also breaks on separators a JavaScript `\s` doesn't
// know (U+001C to U+001F, U+0085), while `\s` knows one Python doesn't (U+FEFF). Its slash worker then resolves an alias
// (`/bp` is /blueprint) and expands a beginning (`/cr` is /cron), both from Hermes's own command table, copied from the
// pinned build into web/vendor/hermes-commands.json by tools/hermes-commands.py.
import hermesTable from '../vendor/hermes-commands.json'

const NAMES: readonly string[] = hermesTable.names
const ALIASES: Readonly<Record<string, string>> = hermesTable.aliases

const SPACES = new Set([9, 10, 11, 12, 13, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000])
for (let c = 0x2000; c <= 0x200a; c++) SPACES.add(c)

const isSpace = (ch: string): boolean => SPACES.has(ch.charCodeAt(0))

function strip(s: string): string {
  let from = 0
  let to = s.length
  while (from < to && isSpace(s[from])) from++
  while (to > from && isSpace(s[to - 1])) to--
  return s.slice(from, to)
}

/** How the page reads a slash command, and the text it sends for it (`slash.exec`'s `command`): every slash and space in
 *  front taken off (any mix of them, repeated), then the name up to the first space, then the rest with the spaces around
 *  taken off. Spaces are Python's set, never JavaScript's `trim` (which also drops U+FEFF, which Python keeps).
 *
 *  Hermes reads a command twice, differently: its gateway takes `strip().lstrip('/').split(maxsplit=1)` (so `/ /x` names
 *  `/x`), its slash worker `strip().split()[0].lstrip('/')` (so `/ /x` names nothing). Rather than guess which one acts,
 *  the page sends `body`, the name and the rest joined by one space: both read exactly `name` and `arg` from it, and so
 *  does this function (it gives the same answer for `body` as for the text). Every check, at every alias step, judges these
 *  same words. */
export function hermesSlash(text: string): { name: string; arg: string; body: string } {
  const s = strip(text)
  let from = 0
  while (from < s.length && (s[from] === '/' || isSpace(s[from]))) from++
  let end = from
  while (end < s.length && !isSpace(s[end])) end++
  const name = s.slice(from, end)
  const arg = strip(s.slice(end))
  return { name, arg, body: arg ? `${name} ${arg}` : name }
}

/** `/yolo`'s argument that turns Full access off. */
export const yoloOffArg = (arg: string): boolean => /^(off|0|false|no)$/i.test(arg)

/** The built-in command Hermes's slash worker runs for this typed name, '' for none: the name itself or the command of an
 *  alias, else the one name a beginning expands to (the only match, or the only shortest one; then its alias resolved).
 *  Skills a phone has installed only add matches, so a beginning that names a built-in here names that built-in or a
 *  skill there, never another built-in. A quick command or a plugin command of the same name isn't known here. */
export function hermesCommand(typed: string): string {
  const n = typed.toLowerCase()
  if (!n) return ''
  if (Object.prototype.hasOwnProperty.call(ALIASES, n)) return ALIASES[n]
  if (NAMES.includes(n)) return n
  let m = NAMES.filter(c => c.startsWith(n))
  if (m.length > 1) {
    const min = Math.min(...m.map(c => c.length))
    m = m.filter(c => c.length === min)
  }
  if (m.length !== 1) return ''
  return Object.prototype.hasOwnProperty.call(ALIASES, m[0]) ? ALIASES[m[0]] : m[0]
}

/** Python's `shlex.split(text)` (POSIX), which Hermes's /kanban runs on its arguments, then a fully wrapping pair of quotes
 *  taken off each word as /kanban does. null when a quote isn't closed or the text ends in a backslash: Hermes refuses such
 *  text, and nothing is taken as read-only. */
export function hermesShlex(text: string): string[] | null {
  const out: string[] = []
  let cur = ''
  let has = false
  let q: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q === "'") {
      if (c === "'") q = null
      else cur += c
      continue
    }
    if (q === '"') {
      if (c === '"') q = null
      else if (c === '\\' && i + 1 < text.length && (text[i + 1] === '"' || text[i + 1] === '\\')) cur += text[++i]
      else if (c === '\\' && i + 1 >= text.length) return null
      else cur += c
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else if (c === "'" || c === '"') {
      q = c
      has = true
    } else if (c === '\\') {
      if (i + 1 >= text.length) return null
      cur += text[++i]
      has = true
    } else {
      cur += c
      has = true
    }
  }
  if (q) return null
  if (has) out.push(cur)
  return out.map(t => (t.length >= 2 && t[0] === t[t.length - 1] && (t[0] === "'" || t[0] === '"') ? t.slice(1, -1) : t))
}

// What /kanban does without changing a board or starting anything (Hermes's kanban parser, pinned build). Anything else,
// including a subcommand added later, counts as a change.
const KANBAN_READ = new Set(['list', 'ls', 'show', 'stats', 'log', 'runs', 'attachments', 'assignees', 'context', 'notify-list', 'diagnostics', 'diag'])
const KANBAN_BOARDS_READ = new Set(['list', 'ls', 'show', 'current'])
const HELP = new Set(['help', '--help', '-h', '?'])
const isHelpOption = (t: string) => t === '-h' || (t.length >= 3 && '--help'.startsWith(t)) // argparse takes a beginning
const isBoardOption = (t: string) => t.length >= 3 && '--board'.startsWith(t)

/** Whether `/kanban <arg>` only reads: its help, or a subcommand of KANBAN_READ (for `boards`: list, ls, show, current). The
 *  arguments are read as Hermes reads them: shlex, the `--board` option (a beginning of it too, its value as the next word
 *  or after `=`) before the subcommand, and `--` ending the options. An option it doesn't know means no. */
export function kanbanReadOnly(arg: string): boolean {
  const t = hermesShlex(arg)
  if (!t) return false
  if (!t.length || HELP.has(t[0])) return true
  let i = 0
  for (;;) {
    const w = t[i]
    if (w === undefined) return true // only options: argparse shows the usage
    if (w === '--') {
      i++
      break
    }
    if (isHelpOption(w)) return true
    if (isBoardOption(w)) {
      const v = t[i + 1]
      if (v === undefined || v.startsWith('-')) return false
      i += 2
      continue
    }
    if (w.startsWith('--') && isBoardOption(w.split('=')[0])) {
      i++
      continue
    }
    if (w.startsWith('-')) return false
    break
  }
  const sub = t[i]
  if (sub === undefined) return true
  if (sub === 'boards') {
    const next = t[i + 1]
    return next === undefined || KANBAN_BOARDS_READ.has(next) || isHelpOption(next)
  }
  return KANBAN_READ.has(sub)
}

// Over the lock screen a slash command runs only when it is on this list, by its exact name: an alias, a beginning Hermes
// would expand, a quick command or a plugin command waits for an unlock. Each only shows something; none changes a setting
// or starts work. /yolo is handled apart: there it can only turn access off.
const LOCK_BARE = new Set(['status', 'version', 'whoami', 'agents', 'usage'])

/** Whether this command may run over the lock screen (what it would run must also be no quick command, plugin command or
 *  skill: gateway.ts notBuiltIn). */
export function lockSafeCommand(typedName: string, arg: string): boolean {
  const name = typedName.toLowerCase()
  if (name === 'help') return true
  if (LOCK_BARE.has(name)) return arg === ''
  if (name === 'context') return arg === '' || arg.toLowerCase() === 'all'
  if (name === 'kanban') return kanbanReadOnly(arg)
  return false
}

/** `/approvals off` or `/approvals smart`, also by a beginning Hermes expands to it (`/ap` and longer): the mode that lets
 *  commands run without asking, in every chat of the bot. null for anything else (`manual`, a bare `/approvals`). */
export function loosensApprovals(typedName: string, arg: string): 'off' | 'smart' | null {
  // Invisible format characters (U+FEFF, U+200B and the like) are left out before comparing: asking once too often is
  // harmless, missing one is not, and Hermes's own handling of them may change.
  const clean = (t: string) => t.replace(/\p{Cf}/gu, '')
  if (hermesCommand(clean(typedName)) !== 'approvals') return null
  const w = strip(clean(arg)).toLowerCase()
  return w === 'off' || w === 'smart' ? w : null
}
