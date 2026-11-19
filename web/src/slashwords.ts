// How Hermes reads a slash command, so the app judges the same word Hermes will run. Hermes takes
// `cmd.strip().lstrip('/').split(maxsplit=1)`, and Python's split() also breaks on separators a JavaScript `\s` doesn't
// know (U+001C to U+001F, U+0085), while `\s` knows one Python doesn't (U+FEFF). Its worker then expands the beginning of
// some command names (seen on the pinned build: /cr, /k and /bl do, /b and /bac don't start a background task).

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

/** The command's name, as typed (Hermes compares it in lower case), and the text after it. */
export function hermesWords(text: string): { name: string; arg: string } {
  let s = strip(text)
  let i = 0
  while (s[i] === '/') i++
  s = strip(s.slice(i))
  let end = 0
  while (end < s.length && !isSpace(s[end])) end++
  return { name: s.slice(0, end), arg: strip(s.slice(end)) }
}

/** The arguments as Hermes's shlex sees them, near enough to compare a subcommand: quotes and backslashes gone. */
const shellWords = (arg: string): string[] =>
  arg
    .split(/[ \t\r\n]+/)
    .filter(Boolean)
    .map(w => w.replace(/['"\\]/g, ''))

/** `typed` names this command: all of it, or the beginning Hermes would expand to it. */
const names = (typed: string, full: string, shortest: number): boolean => typed.length >= shortest && full.startsWith(typed)

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

/** What this command would start or change that runs apart from the chat, in words for a sentence; null for anything else.
 *  These are the commands of Hermes's slash worker that hand typed text to a new agent, or change a board other agents
 *  work from. Listing is left alone, and so is every command that runs inside the chat itself, which the chat's own rules
 *  cover. */
export function detachedWork(typedName: string, arg: string): string | null {
  const name = typedName.toLowerCase()
  const words = shellWords(arg)
  if (name === 'bg' || name === 'background') return 'a background task' // Hermes expands neither from a beginning
  if (names(name, 'cron', 2) && ['add', 'create', 'edit'].includes(words[0]?.toLowerCase() ?? '')) return 'a scheduled job'
  if (names(name, 'kanban', 1) && !kanbanReadOnly(arg)) return 'a board command'
  if ((name === 'bp' || names(name, 'blueprint', 2)) && words.slice(1).some(w => w.includes('='))) return 'an automation'
  return null
}

// Over the lock screen a slash command runs only when it is on this list (exact names: a beginning Hermes would expand,
// a quick command or an alias is not known here, so it waits for an unlock). Each only shows something; none changes a
// setting or starts work. /yolo is handled apart: there it can only turn access off.
const LOCK_BARE = new Set(['status', 'version', 'v', 'whoami', 'agents', 'tasks', 'usage'])

/** Whether this command may run over the lock screen. */
export function lockSafeCommand(typedName: string, arg: string): boolean {
  const name = typedName.toLowerCase()
  if (name === 'help') return true
  if (LOCK_BARE.has(name)) return arg === ''
  if (name === 'context' || name === 'ctx') return arg === '' || arg.toLowerCase() === 'all'
  if (name === 'kanban') return kanbanReadOnly(arg)
  return false
}

/** `/approvals off` or `/approvals smart`, also by a beginning Hermes expands to it (`/ap` and longer): the mode that lets
 *  commands run without asking, in every chat of the bot. null for anything else (`manual`, a bare `/approvals`). */
export function loosensApprovals(typedName: string, arg: string): 'off' | 'smart' | null {
  if (!names(typedName.toLowerCase(), 'approvals', 2)) return null
  const w = arg.toLowerCase()
  return w === 'off' || w === 'smart' ? w : null
}

export const detachedRefusal = (what: string, state: 'read' | 'unknown'): string =>
  state === 'read'
    ? `This chat has read data from your phone, so ${what} can’t be started from it: it would run where Hermux can’t ask you before something is sent out. You can start one from a new chat, which doesn’t have this chat’s messages.`
    : `Hermux couldn’t check whether this chat has read data from your phone, so ${what} can’t be started from it right now. Try again in a moment, or start one from a new chat.`
