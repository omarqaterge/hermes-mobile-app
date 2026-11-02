// Tool calls in plain words: "Ran git", "Read 3 files and ran 2 commands". Ideas from t3code's work log (MIT),
// rewritten for Hermes's tool names; see docs/research/t3code-chat-visuals.md.
import type { ChatItem } from './store'

type Tool = Extract<ChatItem, { kind: 'tool' }>

/** What a tool does, for summing a run up. */
export type ToolKind = 'command' | 'read' | 'edit' | 'search' | 'web' | 'browser' | 'tasks' | 'other'

const KINDS: Record<string, ToolKind> = {
  terminal: 'command',
  execute_code: 'command',
  read_file: 'read',
  write_file: 'edit',
  patch: 'edit',
  search_files: 'search',
  web_search: 'web',
  web_extract: 'web',
  todo: 'tasks',
  todo_list: 'tasks'
}

export function toolKind(name: string): ToolKind {
  return (Object.hasOwn(KINDS, name) ? KINDS[name] : null) || (name.startsWith('browser_') ? 'browser' : 'other')
}

/** The command without the shell wrapper around it: `bash -lc 'git status'` → `git status`, no `sudo`, no `FOO=1`. */
export function commandText(cmd: string): string {
  let c = cmd.trim()
  const wrap = /^(?:\/\S*\/)?(?:ba|z|da)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(c)
  if (wrap) c = wrap[2].trim()
  c = c.replace(/^sudo\s+(?:-[ugh]\s+\S+\s+|-\S+\s+)*/, '')
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')
  return c
}

/** The program a command runs: `cd x && npm test` → `npm`, `/usr/bin/git log` → `git`. */
export function programName(cmd: string): string {
  const parts = commandText(cmd).split(/\s*(?:&&|;|\|\|)\s*/)
  const main = parts.find(p => !/^cd\s/.test(p)) ?? parts[0] ?? ''
  const first = commandText(main).split(/\s+/)[0] || ''
  return first.split('/').pop() || ''
}

/** The tool card's header words: "Ran git", "Running npm", "Failed git", "Read", "Edited", "Searched"…; the raw name otherwise. */
export function toolTitle(t: Pick<Tool, 'name' | 'status' | 'args'>): string {
  const live = t.status === 'running' || t.status === 'generating'
  const failed = t.status === 'error'
  const verb = (running: string, done: string, fail = 'Failed') => (live ? running : failed ? fail : done)
  switch (t.name) {
    case 'terminal': {
      const cmd = typeof t.args?.command === 'string' ? t.args.command : ''
      const prog = cmd ? programName(cmd) : ''
      return verb('Running', 'Ran') + (prog ? ` ${prog}` : ' a command')
    }
    case 'execute_code':
      return verb('Running code', 'Ran code', 'Code failed')
    case 'read_file':
      return verb('Reading', 'Read', "Couldn't read")
    case 'write_file':
      return verb('Writing', 'Wrote', "Couldn't write")
    case 'patch':
      return verb('Editing', 'Edited', "Couldn't edit")
    case 'search_files':
      return verb('Searching', 'Searched', 'Search failed')
    case 'web_search':
      return verb('Searching the web', 'Searched the web', 'Web search failed')
    case 'web_extract':
      return verb('Reading the page', 'Read the page', "Couldn't read the page")
    case 'browser_navigate':
      return verb('Opening', 'Opened', "Couldn't open")
    case 'todo':
    case 'todo_list':
      return verb('Updating tasks', 'Updated tasks', 'Tasks failed')
    default:
      return t.name
  }
}

/** The tool row's detail when Hermes gives no context line: the command without its shell wrapper. */
export function commandLabel(t: Pick<Tool, 'name' | 'args'>): string {
  const cmd = t.name === 'terminal' && typeof t.args?.command === 'string' ? t.args.command : ''
  return cmd ? commandText(cmd) : ''
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/** "ran 2 commands and changed 3 files", "read 4 files, searched 2 times and used 3 other tools" (lower case;
 * at most two kinds by name, commands and edits first, the rest counted together). */
export function runSummary(tools: Pick<Tool, 'name' | 'args'>[]): string {
  const counts = new Map<ToolKind, number>()
  const edited = new Set<string>()
  for (const t of tools) {
    const k = toolKind(t.name)
    if (k === 'edit' && typeof t.args?.path === 'string') {
      if (edited.has(t.args.path)) continue
      edited.add(t.args.path)
    }
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const say: Record<ToolKind, (k: number) => string> = {
    command: k => `ran ${n(k, 'command')}`,
    edit: k => `changed ${n(k, 'file')}`,
    read: k => `read ${n(k, 'file')}`,
    search: k => `searched ${k === 1 ? 'once' : `${k} times`}`,
    web: k => `used the web ${k === 1 ? 'once' : `${k} times`}`,
    browser: k => `used the browser ${k === 1 ? 'once' : `${k} times`}`,
    tasks: () => 'updated the tasks',
    other: k => `used ${n(k, 'tool')}`
  }
  const rank = (k: ToolKind) => (k === 'command' ? 0 : k === 'edit' ? 1 : k === 'other' ? 3 : 2)
  const kinds = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || (counts.get(b) || 0) - (counts.get(a) || 0))
  const named = kinds.length > 3 ? kinds.slice(0, 2) : kinds
  const parts = named.map(k => say[k](counts.get(k) || 0))
  const rest = kinds.slice(named.length).reduce((s, k) => s + (counts.get(k) || 0), 0)
  if (rest) parts.push(`used ${n(rest, 'other tool')}`)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || ''
}

/** One line of a thought: its latest (or first) `**Heading**`, else its first (or last) sentence; at most 140 characters. */
export function thoughtLine(text: string, latest = false): string {
  // While a thought streams this runs on every batch: only its tail can hold the latest heading or sentence.
  if (latest && text.length > 2000) text = text.slice(-2000)
  const heads = [...text.matchAll(/\*\*([^*\n]{2,120})\*\*/g)].map(m => m[1].trim())
  let line = heads.length ? heads[latest ? heads.length - 1 : 0] : ''
  if (!line) {
    const flat = text.replace(/\s+/g, ' ').trim()
    const sentences = flat.match(/[^.!?]+[.!?]*/g) || [flat]
    line = (latest ? sentences.filter(s => s.trim()).pop() : sentences[0])?.trim() || ''
  }
  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}

export interface TaskStep {
  content: string
  status: string
}

/** The task list a todo call carries (in its result, else its arguments), or null. */
export function todoSteps(t: Pick<Tool, 'name' | 'args' | 'resultText'>): TaskStep[] | null {
  if (toolKind(t.name) !== 'tasks') return null
  const pick = (v: unknown): TaskStep[] | null =>
    Array.isArray(v) ? v.filter(x => x && typeof x === 'object').map(x => ({ content: String((x as TaskStep).content ?? ''), status: String((x as TaskStep).status ?? 'pending') })) : null
  if (t.resultText) {
    try {
      const r = JSON.parse(t.resultText) as { todos?: unknown }
      const s = pick(r?.todos)
      if (s) return s
    } catch {
      // not JSON: fall back to the arguments
    }
  }
  return pick(t.args?.todos)
}

/** ✓ done, ◐ in progress, ✕ cancelled, ○ to do. */
export function stepMark(status: string): string {
  return status === 'completed' || status === 'done' ? '✓' : status === 'in_progress' ? '◐' : status === 'cancelled' ? '✕' : '○'
}

/** 950 → "950", 1234 → "1.2k", 25000 → "25k": diff counts that stay short on a phone. */
export function compactCount(v: number): string {
  if (v < 1000) return String(v)
  const k = v / 1000
  return `${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k`
}
