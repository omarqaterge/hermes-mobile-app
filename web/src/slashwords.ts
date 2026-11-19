// How Hermes reads a slash command, so the app judges the same word Hermes will run. Hermes takes
// `cmd.strip().lstrip('/').split(maxsplit=1)`, and Python's split() also breaks on separators a JavaScript `\s` doesn't
// know (U+001C to U+001F, U+0085), while `\s` knows one Python doesn't (U+FEFF). Its worker then expands a unique beginning
// of a command name.

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

/** The first word that isn't an option (an option's value is skipped with it). */
function subcommand(words: string[]): string {
  for (let i = 0; i < words.length; i++) {
    if (!words[i].startsWith('-')) return words[i].toLowerCase()
    if (!words[i].includes('=')) i++
  }
  return ''
}

/** What this command would start that runs apart from the chat, in words for a sentence; null for anything else. These are
 *  the commands of Hermes's slash worker that hand typed text to a new agent. Listing, editing nothing or removing is left
 *  alone, and so is every command that runs inside the chat itself, which the chat's own rules cover. */
export function detachedWork(typedName: string, arg: string): string | null {
  const name = typedName.toLowerCase()
  const words = shellWords(arg)
  if (name === 'bg' || names(name, 'background', 3)) return 'a background task'
  if (names(name, 'cron', 2) && ['add', 'create', 'edit'].includes(words[0]?.toLowerCase() ?? '')) return 'a scheduled job'
  if (names(name, 'kanban', 1) && ['create', 'dispatch', 'daemon'].includes(subcommand(words))) return 'a board task'
  if (names(name, 'blueprint', 2) && words.slice(1).some(w => w.includes('='))) return 'an automation'
  return null
}

export const detachedRefusal = (what: string, state: 'read' | 'unknown'): string =>
  state === 'read'
    ? `This chat has read data from your phone, so ${what} can’t be started from it: it would run where Hermux can’t ask you before something is sent out. You can start one from a new chat, which doesn’t have this chat’s messages.`
    : `Hermux couldn’t check whether this chat has read data from your phone, so ${what} can’t be started from it right now. Try again in a moment, or start one from a new chat.`
